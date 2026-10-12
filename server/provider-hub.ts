// Provider Hub data that isn't a listing or a booking: a provider's business
// profile and payout details, TBM's verification, date blocks for home help and
// experiences, and applications from every kind of provider. Tables come from
// migration 0022 and are also created on first use.
import { pool } from "./db";
import {
  emptyProviderProfile,
  type ProviderBusinessProfileInput,
  type ProviderPayoutDetailsInput,
  type ProviderProfileView,
  type VerificationStatus,
} from "@shared/provider-profile";
import { expandBlockDates, type ListingBlockKind, type ListingBlockView } from "@shared/listing-blocks";

let tablesReady: Promise<void> | null = null;

export function ensureProviderHubTables(): Promise<void> {
  tablesReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS provider_profiles (
      user_id varchar PRIMARY KEY,
      business_name text NOT NULL DEFAULT '',
      bio text NOT NULL DEFAULT '',
      photo_url text NOT NULL DEFAULT '',
      languages text[] NOT NULL DEFAULT '{}'::text[],
      service_areas text[] NOT NULL DEFAULT '{}'::text[],
      payout_method varchar,
      mpesa_number varchar,
      mpesa_name text,
      bank_name text,
      bank_account_name text,
      bank_account_number varchar,
      bank_branch text,
      payout_details_status varchar NOT NULL DEFAULT 'none',
      payout_details_updated_at text,
      payout_details_confirmed_at text,
      payout_details_confirmed_by varchar,
      verification_status varchar NOT NULL DEFAULT 'not-started',
      verification_note text,
      verified_at text,
      verified_by varchar,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listing_blocks (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_kind varchar NOT NULL,
      listing_id varchar NOT NULL,
      start_date varchar NOT NULL,
      end_date varchar NOT NULL,
      reason text,
      created_by_user_id varchar,
      created_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS listing_blocks_listing_idx ON listing_blocks (listing_kind, listing_id, start_date);
    CREATE TABLE IF NOT EXISTS provider_applications (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      service_type varchar NOT NULL,
      full_name text NOT NULL,
      phone varchar NOT NULL,
      email varchar NOT NULL,
      town text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      photos jsonb NOT NULL DEFAULT '[]'::jsonb,
      documents jsonb NOT NULL DEFAULT '[]'::jsonb,
      status varchar NOT NULL DEFAULT 'new',
      review_note text,
      created_user_id varchar,
      reviewed_by varchar,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS provider_applications_status_idx ON provider_applications (status, created_at);
  `).then(() => undefined).catch((error) => {
    tablesReady = null;
    throw error;
  });
  return tablesReady;
}

// ── Profiles ────────────────────────────────────────────────────────────────

type ProfileRow = {
  business_name: string;
  bio: string;
  photo_url: string;
  languages: string[];
  service_areas: string[];
  payout_method: string | null;
  mpesa_number: string | null;
  mpesa_name: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_branch: string | null;
  payout_details_status: string;
  payout_details_updated_at: string | null;
  verification_status: string;
  verification_note: string | null;
  verified_at: string | null;
};

function toProfileView(row: ProfileRow | undefined): ProviderProfileView {
  if (!row) return { ...emptyProviderProfile };
  return {
    businessName: row.business_name,
    bio: row.bio,
    photoUrl: row.photo_url,
    languages: row.languages ?? [],
    serviceAreas: row.service_areas ?? [],
    payoutMethod: row.payout_method === "mpesa" || row.payout_method === "bank" ? row.payout_method : null,
    mpesaNumber: row.mpesa_number,
    mpesaName: row.mpesa_name,
    bankName: row.bank_name,
    bankAccountName: row.bank_account_name,
    bankAccountNumber: row.bank_account_number,
    bankBranch: row.bank_branch,
    payoutDetailsStatus: row.payout_details_status === "unconfirmed" || row.payout_details_status === "confirmed" ? row.payout_details_status : "none",
    payoutDetailsUpdatedAt: row.payout_details_updated_at,
    verificationStatus: (["not-started", "in-review", "verified"] as const).includes(row.verification_status as VerificationStatus)
      ? row.verification_status as VerificationStatus
      : "not-started",
    verificationNote: row.verification_note,
    verifiedAt: row.verified_at,
  };
}

export async function getProviderProfile(userId: string): Promise<ProviderProfileView> {
  await ensureProviderHubTables();
  const { rows } = await pool.query<ProfileRow>("SELECT * FROM provider_profiles WHERE user_id = $1", [userId]);
  return toProfileView(rows[0]);
}

export async function getProviderProfiles(userIds: string[]): Promise<Map<string, ProviderProfileView>> {
  await ensureProviderHubTables();
  if (!userIds.length) return new Map();
  const { rows } = await pool.query<ProfileRow & { user_id: string }>("SELECT * FROM provider_profiles WHERE user_id = ANY($1)", [userIds]);
  return new Map(rows.map((row) => [row.user_id, toProfileView(row)]));
}

async function ensureProfileRow(userId: string) {
  const now = new Date().toISOString();
  await pool.query(
    "INSERT INTO provider_profiles (user_id, created_at, updated_at) VALUES ($1, $2, $2) ON CONFLICT (user_id) DO NOTHING",
    [userId, now],
  );
}

export async function saveBusinessProfile(userId: string, input: ProviderBusinessProfileInput): Promise<ProviderProfileView> {
  await ensureProviderHubTables();
  await ensureProfileRow(userId);
  await pool.query(
    `UPDATE provider_profiles SET business_name = $2, bio = $3, photo_url = $4, languages = $5, service_areas = $6, updated_at = $7
     WHERE user_id = $1`,
    [userId, input.businessName, input.bio, input.photoUrl, input.languages, input.serviceAreas, new Date().toISOString()],
  );
  return getProviderProfile(userId);
}

// New payout details wait for TBM to confirm them, so a changed account can't
// quietly redirect a payout. The previous details are replaced, not kept.
export async function savePayoutDetails(userId: string, input: ProviderPayoutDetailsInput): Promise<ProviderProfileView> {
  await ensureProviderHubTables();
  await ensureProfileRow(userId);
  const now = new Date().toISOString();
  const mpesa = input.payoutMethod === "mpesa" ? input : null;
  const bank = input.payoutMethod === "bank" ? input : null;
  await pool.query(
    `UPDATE provider_profiles SET
       payout_method = $2, mpesa_number = $3, mpesa_name = $4,
       bank_name = $5, bank_account_name = $6, bank_account_number = $7, bank_branch = $8,
       payout_details_status = 'unconfirmed', payout_details_updated_at = $9,
       payout_details_confirmed_at = NULL, payout_details_confirmed_by = NULL, updated_at = $9
     WHERE user_id = $1`,
    [
      userId,
      input.payoutMethod,
      mpesa?.mpesaNumber ?? null,
      mpesa?.mpesaName ?? null,
      bank?.bankName ?? null,
      bank?.bankAccountName ?? null,
      bank?.bankAccountNumber ?? null,
      bank?.bankBranch || null,
      now,
    ],
  );
  return getProviderProfile(userId);
}

export async function requestVerification(userId: string): Promise<{ profile: ProviderProfileView; changed: boolean }> {
  await ensureProviderHubTables();
  await ensureProfileRow(userId);
  const { rowCount } = await pool.query(
    "UPDATE provider_profiles SET verification_status = 'in-review', verification_note = NULL, updated_at = $2 WHERE user_id = $1 AND verification_status = 'not-started'",
    [userId, new Date().toISOString()],
  );
  return { profile: await getProviderProfile(userId), changed: (rowCount ?? 0) > 0 };
}

export async function confirmPayoutDetails(userId: string, adminId: string): Promise<boolean> {
  await ensureProviderHubTables();
  const now = new Date().toISOString();
  const { rowCount } = await pool.query(
    `UPDATE provider_profiles SET payout_details_status = 'confirmed', payout_details_confirmed_at = $2, payout_details_confirmed_by = $3, updated_at = $2
     WHERE user_id = $1 AND payout_details_status = 'unconfirmed'`,
    [userId, now, adminId],
  );
  return (rowCount ?? 0) > 0;
}

export async function setVerification(userId: string, status: VerificationStatus, note: string | null, adminId: string): Promise<ProviderProfileView> {
  await ensureProviderHubTables();
  await ensureProfileRow(userId);
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE provider_profiles SET verification_status = $2::varchar, verification_note = $3::text,
       verified_at = $4::text, verified_by = $5::varchar, updated_at = $6::text
     WHERE user_id = $1`,
    [userId, status, note, status === "verified" ? now : null, status === "verified" ? adminId : null, now],
  );
  return getProviderProfile(userId);
}

// ── Date blocks for home help and experiences ──────────────────────────────

type BlockRow = { id: string; listing_kind: string; listing_id: string; start_date: string; end_date: string; reason: string | null; created_at: string };

const toBlockView = (row: BlockRow): ListingBlockView => ({
  id: row.id,
  startDate: row.start_date,
  endDate: row.end_date,
  reason: row.reason,
  createdAt: row.created_at,
});

export async function getListingBlocks(kind: ListingBlockKind, listingId: string): Promise<ListingBlockView[]> {
  await ensureProviderHubTables();
  const { rows } = await pool.query<BlockRow>(
    "SELECT * FROM listing_blocks WHERE listing_kind = $1 AND listing_id = $2 ORDER BY start_date",
    [kind, listingId],
  );
  return rows.map(toBlockView);
}

export async function createListingBlock(args: { kind: ListingBlockKind; listingId: string; startDate: string; endDate: string; reason: string | null; userId: string }): Promise<ListingBlockView> {
  await ensureProviderHubTables();
  const { rows } = await pool.query<BlockRow>(
    `INSERT INTO listing_blocks (listing_kind, listing_id, start_date, end_date, reason, created_by_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [args.kind, args.listingId, args.startDate, args.endDate, args.reason, args.userId, new Date().toISOString()],
  );
  return toBlockView(rows[0]);
}

export async function deleteListingBlock(kind: ListingBlockKind, listingId: string, blockId: string): Promise<boolean> {
  await ensureProviderHubTables();
  const { rowCount } = await pool.query(
    "DELETE FROM listing_blocks WHERE id = $1 AND listing_kind = $2 AND listing_id = $3",
    [blockId, kind, listingId],
  );
  return (rowCount ?? 0) > 0;
}

// The first blocked date among the dates a booking asks for, if any.
export async function findBlockedDate(kind: ListingBlockKind, listingId: string, dates: string[]): Promise<string | null> {
  if (!dates.length) return null;
  const blocks = await getListingBlocks(kind, listingId);
  const blocked = new Set(blocks.flatMap((block) => expandBlockDates(block.startDate, block.endDate)));
  return dates.find((date) => blocked.has(date)) ?? null;
}

// ── Applications from hosts, chefs, home help and experience providers ────

type ApplicationRow = {
  id: string;
  service_type: string;
  full_name: string;
  phone: string;
  email: string;
  town: string;
  details: Record<string, unknown>;
  photos: Array<{ label: string; url: string }>;
  documents: Array<{ label: string; url: string }>;
  status: string;
  review_note: string | null;
  created_user_id: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ProviderApplicationRecord = {
  id: string;
  serviceType: string;
  fullName: string;
  phone: string;
  email: string;
  town: string;
  details: Record<string, unknown>;
  photos: Array<{ label: string; url: string }>;
  documents: Array<{ label: string; url: string }>;
  status: "new" | "contacted" | "approved" | "declined";
  reviewNote: string | null;
  createdUserId: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const toApplication = (row: ApplicationRow): ProviderApplicationRecord => ({
  id: row.id,
  serviceType: row.service_type,
  fullName: row.full_name,
  phone: row.phone,
  email: row.email,
  town: row.town,
  details: row.details ?? {},
  photos: row.photos ?? [],
  documents: row.documents ?? [],
  status: (["new", "contacted", "approved", "declined"].includes(row.status) ? row.status : "new") as ProviderApplicationRecord["status"],
  reviewNote: row.review_note,
  createdUserId: row.created_user_id,
  reviewedBy: row.reviewed_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function createProviderApplication(input: Omit<ProviderApplicationRecord, "id" | "status" | "reviewNote" | "createdUserId" | "reviewedBy" | "createdAt" | "updatedAt">): Promise<ProviderApplicationRecord> {
  await ensureProviderHubTables();
  const now = new Date().toISOString();
  const { rows } = await pool.query<ApplicationRow>(
    `INSERT INTO provider_applications (service_type, full_name, phone, email, town, details, photos, documents, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *`,
    [input.serviceType, input.fullName, input.phone, input.email, input.town, JSON.stringify(input.details), JSON.stringify(input.photos), JSON.stringify(input.documents), now],
  );
  return toApplication(rows[0]);
}

export async function listProviderApplications(): Promise<ProviderApplicationRecord[]> {
  await ensureProviderHubTables();
  const { rows } = await pool.query<ApplicationRow>("SELECT * FROM provider_applications ORDER BY created_at DESC LIMIT 500");
  return rows.map(toApplication);
}

export async function getProviderApplication(id: string): Promise<ProviderApplicationRecord | null> {
  await ensureProviderHubTables();
  const { rows } = await pool.query<ApplicationRow>("SELECT * FROM provider_applications WHERE id = $1", [id]);
  return rows[0] ? toApplication(rows[0]) : null;
}

export async function updateProviderApplication(id: string, changes: { status?: ProviderApplicationRecord["status"]; reviewNote?: string | null; createdUserId?: string | null; reviewedBy?: string | null }): Promise<ProviderApplicationRecord | null> {
  await ensureProviderHubTables();
  const current = await getProviderApplication(id);
  if (!current) return null;
  const { rows } = await pool.query<ApplicationRow>(
    `UPDATE provider_applications SET status = $2, review_note = $3, created_user_id = $4, reviewed_by = $5, updated_at = $6 WHERE id = $1 RETURNING *`,
    [
      id,
      changes.status ?? current.status,
      changes.reviewNote === undefined ? current.reviewNote : changes.reviewNote,
      changes.createdUserId === undefined ? current.createdUserId : changes.createdUserId,
      changes.reviewedBy === undefined ? current.reviewedBy : changes.reviewedBy,
      new Date().toISOString(),
    ],
  );
  return rows[0] ? toApplication(rows[0]) : null;
}
