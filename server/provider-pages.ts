// Public provider pages from the database: the page code, the provider's
// switch and TBM's, photo approval, and the data the allowlist builder
// (provider-public.ts) turns into a public response. Status is read on every
// request; the "Your host" summaries alone are kept for a minute.
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cars, cooks, errands, experiences, stays } from "@shared/schema";
import { getCarDisplayName, getListingSharePrice } from "@shared/listing-share";
import { getPublicListingPath, type PublicListingKind } from "@shared/seo";
import {
  isProviderPublicCode,
  makeProviderPublicCode,
  providerPhotoKinds,
  providerPublicPath,
  publicProviderDisplayName,
  type ProviderPageBlocker,
  type ProviderPhotoKind,
  type PublicProviderProfile,
  type PublicProviderSummary,
} from "@shared/provider-public";
import { db, pool } from "./db";
import { ensureProviderHubTables } from "./provider-hub";
import { getReviewRows } from "./review-ratings";
import { privateFileUrl, publishPrivatePhoto, savePrivateUpload } from "./private-files";
import { getProviderPageBlockers, toPublicProviderProfile, toPublicProviderSummary, type ProviderPageListing, type ProviderPageSource } from "./provider-public";

let columnsReady: Promise<void> | null = null;

// The columns from migrations 0026 to 0028, added here too so an older database keeps
// working before the deploy step has run.
export function ensureProviderPageColumns(): Promise<void> {
  columnsReady ??= ensureProviderHubTables().then(() => pool.query(`
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_code varchar;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_enabled boolean NOT NULL DEFAULT false;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_enabled_at text;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_blocked_at text;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_blocked_by varchar;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_blocked_note text;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_status varchar NOT NULL DEFAULT 'none';
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_kind varchar;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_approved_at text;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_pending_key varchar;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_pending_kind varchar;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_submitted_at text;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_reviewed_at text;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_reviewed_by varchar;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_review_note text;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS founding_provider_at text;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS founding_cohort varchar;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS founding_revoked_at text;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS founding_revoked_reason varchar;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_private_key varchar;
    ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS spotlight_opt_out_at text;
    CREATE UNIQUE INDEX IF NOT EXISTS provider_profiles_public_code_idx ON provider_profiles (public_code);
  `)).then(() => undefined).catch((error) => {
    columnsReady = null;
    throw error;
  });
  return columnsReady;
}

type PageRow = {
  user_id: string;
  public_code: string | null;
  public_enabled: boolean;
  public_enabled_at: string | null;
  public_blocked_at: string | null;
  public_blocked_note: string | null;
  business_name: string;
  bio: string;
  photo_url: string;
  photo_status: string;
  photo_kind: string | null;
  photo_approved_at: string | null;
  photo_pending_key: string | null;
  photo_pending_kind: string | null;
  photo_submitted_at: string | null;
  photo_reviewed_at: string | null;
  photo_review_note: string | null;
  languages: string[] | null;
  service_areas: string[] | null;
  verification_status: string;
  verified_at: string | null;
  founding_provider_at: string | null;
  spotlight_opt_out_at: string | null;
  role: string | null;
  is_suspended: boolean | null;
  first_name: string | null;
  account_created_at: Date | string | null;
};

const pageRowSql = `
  SELECT p.user_id, p.public_code, p.public_enabled, p.public_enabled_at, p.public_blocked_at, p.public_blocked_note,
         p.business_name, p.bio, p.photo_url, p.photo_status, p.photo_kind, p.photo_approved_at, p.photo_pending_key,
         p.photo_pending_kind, p.photo_submitted_at, p.photo_reviewed_at, p.photo_review_note, p.languages, p.service_areas,
         p.verification_status, p.verified_at, p.founding_provider_at, p.spotlight_opt_out_at,
         u.role, u.is_suspended, u.first_name, u.created_at AS account_created_at
  FROM provider_profiles p JOIN users u ON u.id = p.user_id`;

async function getPageRow(where: { code: string } | { userId: string }): Promise<PageRow | null> {
  await ensureProviderPageColumns();
  const { rows } = "code" in where
    ? await pool.query<PageRow>(`${pageRowSql} WHERE p.public_code = $1`, [where.code])
    : await pool.query<PageRow>(`${pageRowSql} WHERE p.user_id = $1`, [where.userId]);
  return rows[0] ?? null;
}

const kindOrder: PublicListingKind[] = ["stay", "car", "cook", "errand", "experience"];

// The provider's public listings, as cards: name, link, area, starting price, photo.
export async function getProviderPublicListings(userId: string): Promise<ProviderPageListing[]> {
  const [stayRows, carRows, cookRows, errandRows, experienceRows] = await Promise.all([
    db.select().from(stays).where(and(eq(stays.managerUserId, userId), eq(stays.isPublic, true))),
    db.select().from(cars).where(and(eq(cars.managerUserId, userId), eq(cars.isPublic, true))),
    db.select().from(cooks).where(and(eq(cooks.managerUserId, userId), eq(cooks.isPublic, true))),
    db.select().from(errands).where(and(eq(errands.managerUserId, userId), eq(errands.isPublic, true))),
    db.select().from(experiences).where(and(eq(experiences.managerUserId, userId), eq(experiences.isPublic, true))),
  ]);
  const card = (kind: PublicListingKind, listing: { id: string; imageUrl: string | null; location: string }, name: string): ProviderPageListing => {
    const price = getListingSharePrice(kind, listing as Parameters<typeof getListingSharePrice>[1]);
    return {
      kind,
      id: listing.id,
      name,
      path: getPublicListingPath(kind, listing.id, name),
      area: listing.location,
      priceFrom: price?.priceUsd ?? null,
      priceUnit: price?.priceUnit ?? null,
      imageUrl: listing.imageUrl,
    };
  };
  const listings = [
    ...stayRows.map((row) => card("stay", row, row.title)),
    ...carRows.map((row) => card("car", row, getCarDisplayName(row))),
    ...cookRows.map((row) => card("cook", row, row.title)),
    ...errandRows.map((row) => card("errand", row, row.serviceName)),
    ...experienceRows.map((row) => card("experience", row, row.title)),
  ];
  return listings.sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.name.localeCompare(b.name));
}

function toSource(row: PageRow, listings: ProviderPageListing[], reviewRows: ProviderPageSource["reviewRows"]): ProviderPageSource {
  const created = row.account_created_at instanceof Date ? row.account_created_at.toISOString() : row.account_created_at;
  return {
    userId: row.user_id,
    role: row.role,
    isSuspended: Boolean(row.is_suspended),
    firstName: row.first_name,
    accountCreatedAt: created ?? null,
    profile: {
      publicCode: row.public_code ?? "",
      publicEnabled: Boolean(row.public_enabled),
      publicBlockedAt: row.public_blocked_at,
      businessName: row.business_name ?? "",
      bio: row.bio ?? "",
      photoUrl: row.photo_url ?? "",
      photoApprovedAt: row.photo_approved_at,
      photoKind: row.photo_kind,
      languages: row.languages ?? [],
      serviceAreas: row.service_areas ?? [],
      verificationStatus: row.verification_status,
      verifiedAt: row.verified_at,
      foundingProviderAt: row.founding_provider_at,
    },
    listings,
    reviewRows,
  };
}

async function loadSource(row: PageRow | null, options: { reviews: boolean }): Promise<ProviderPageSource | null> {
  if (!row?.public_code) return null;
  const listings = await getProviderPublicListings(row.user_id);
  const reviewRows = options.reviews
    ? (await Promise.all(listings.map((listing) => getReviewRows(listing.kind, listing.id)))).flat()
    : [];
  return toSource(row, listings, reviewRows);
}

export async function getProviderPageSourceByCode(code: string, options = { reviews: true }) {
  if (!isProviderPublicCode(code)) return null;
  return loadSource(await getPageRow({ code }), options);
}

// ── Public responses ────────────────────────────────────────────────────────

export type PublicProviderPageResult =
  | { status: "ok"; profile: PublicProviderProfile }
  | { status: "preview"; profile: PublicProviderProfile; blockers: ProviderPageBlocker[] }
  | { status: "unavailable" }
  | { status: "not-found" };

// The owner and TBM can preview a page that isn't live yet (switched off, or
// waiting for a published listing). A suspended account has no preview.
export async function getPublicProviderPage(code: string, viewer: { userId: string | null; isAdmin: boolean }): Promise<PublicProviderPageResult> {
  const source = await getProviderPageSourceByCode(code);
  if (!source) return { status: "not-found" };
  const blockers = getProviderPageBlockers(source);
  if (!blockers.length) return { status: "ok", profile: toPublicProviderProfile(source) };
  const previewable: ProviderPageBlocker[] = viewer.isAdmin ? ["switched-off", "no-public-listings", "blocked-by-tbm"] : ["switched-off", "no-public-listings"];
  const canPreview = (viewer.isAdmin || viewer.userId === source.userId) && blockers.every((blocker) => previewable.includes(blocker));
  return canPreview ? { status: "preview", profile: toPublicProviderProfile(source), blockers } : { status: "unavailable" };
}

const summaryCache = new Map<string, { at: number; summary: PublicProviderSummary | null }>();
const SUMMARY_CACHE_MS = 60_000;

export function clearProviderPageCache() {
  summaryCache.clear();
}

const listingTables: Record<PublicListingKind, string> = { stay: "stays", car: "cars", cook: "cooks", errand: "errands", experience: "experiences" };

// "Your host" on a listing page: only while the provider's page is live.
export async function getPublicProviderSummaryForListing(kind: PublicListingKind, listingId: string): Promise<PublicProviderSummary | null> {
  const key = `${kind}:${listingId}`;
  const cached = summaryCache.get(key);
  if (cached && Date.now() - cached.at < SUMMARY_CACHE_MS) return cached.summary;
  const { rows } = await pool.query<{ manager_user_id: string | null }>(
    `SELECT manager_user_id FROM ${listingTables[kind]} WHERE id = $1 AND is_public = true`,
    [listingId],
  );
  const managerUserId = rows[0]?.manager_user_id;
  let summary: PublicProviderSummary | null = null;
  if (managerUserId) {
    const source = await loadSource(await getPageRow({ userId: managerUserId }), { reviews: true });
    if (source && !getProviderPageBlockers(source).length) summary = toPublicProviderSummary(source);
  }
  if (summaryCache.size > 2000) summaryCache.clear();
  summaryCache.set(key, { at: Date.now(), summary });
  return summary;
}

// TBM's queue: every provider with a photo waiting, newest sent last, and
// photos saved before checks began (never public until approved).
export async function listWaitingProviderPhotos() {
  await ensureProviderPageColumns();
  const { rows } = await pool.query<{ user_id: string; business_name: string | null; first_name: string | null; last_name: string | null; photo_pending_key: string | null; photo_submitted_at: string | null; legacy: boolean }>(`
    SELECT p.user_id, p.business_name, u.first_name, u.last_name, p.photo_pending_key, p.photo_submitted_at,
           (p.photo_pending_key IS NULL) AS legacy
    FROM provider_profiles p JOIN users u ON u.id = p.user_id
    WHERE p.photo_pending_key IS NOT NULL
       OR (p.photo_approved_at IS NULL AND COALESCE(p.photo_url, '') <> '' AND p.photo_status <> 'rejected')
    ORDER BY (p.photo_pending_key IS NULL), p.photo_submitted_at NULLS LAST, p.user_id`);
  return rows.map((row) => ({
    providerId: row.user_id,
    name: row.business_name?.trim() || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Provider",
    submittedAt: row.photo_submitted_at,
    legacy: row.legacy,
  }));
}

// Live pages for the sitemap: switched on, not blocked by TBM, a provider in
// good standing, and at least one public listing (the same rules as the page).
export async function listLiveProviderPages(): Promise<Array<{ path: string; lastmod: string | null }>> {
  await ensureProviderPageColumns();
  const { rows } = await pool.query<{ public_code: string; business_name: string | null; first_name: string | null; updated_at: string | null }>(`
    SELECT p.public_code, p.business_name, u.first_name, p.updated_at
    FROM provider_profiles p JOIN users u ON u.id = p.user_id
    WHERE p.public_code IS NOT NULL AND p.public_enabled AND p.public_blocked_at IS NULL
      AND u.role = 'provider' AND NOT COALESCE(u.is_suspended, false)
      AND (EXISTS (SELECT 1 FROM stays WHERE manager_user_id = p.user_id AND is_public)
        OR EXISTS (SELECT 1 FROM cars WHERE manager_user_id = p.user_id AND is_public)
        OR EXISTS (SELECT 1 FROM cooks WHERE manager_user_id = p.user_id AND is_public)
        OR EXISTS (SELECT 1 FROM errands WHERE manager_user_id = p.user_id AND is_public)
        OR EXISTS (SELECT 1 FROM experiences WHERE manager_user_id = p.user_id AND is_public))
    ORDER BY p.public_code`);
  return rows
    .filter((row) => isProviderPublicCode(row.public_code))
    .map((row) => ({
      path: providerPublicPath(row.public_code, publicProviderDisplayName({ businessName: row.business_name ?? "", firstName: row.first_name })),
      lastmod: row.updated_at,
    }));
}

// For provider share links (share-links.ts): who the page belongs to, and
// whether it's live. No reviews needed.
export async function getProviderShareTarget(code: string) {
  const source = await getProviderPageSourceByCode(code, { reviews: false });
  if (!source) return null;
  return {
    userId: source.userId,
    name: publicProviderDisplayName({ businessName: source.profile.businessName, firstName: source.firstName }),
    isLive: getProviderPageBlockers(source).length === 0,
    path: providerPublicPath(source.profile.publicCode, publicProviderDisplayName({ businessName: source.profile.businessName, firstName: source.firstName })),
  };
}

// ── The provider's settings, and TBM's ──────────────────────────────────────

async function ensureProfileRow(userId: string) {
  const now = new Date().toISOString();
  await pool.query("INSERT INTO provider_profiles (user_id, created_at, updated_at) VALUES ($1, $2, $2) ON CONFLICT (user_id) DO NOTHING", [userId, now]);
}

// A page code is given out once, the first time the provider (or TBM) opens
// the page settings, and never changes.
export async function ensurePublicCode(userId: string): Promise<string> {
  await ensureProviderPageColumns();
  await ensureProfileRow(userId);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = await pool.query<{ public_code: string | null }>("SELECT public_code FROM provider_profiles WHERE user_id = $1", [userId]);
    if (existing.rows[0]?.public_code) return existing.rows[0].public_code;
    const code = makeProviderPublicCode((max) => crypto.randomInt(max));
    try {
      await pool.query("UPDATE provider_profiles SET public_code = $2 WHERE user_id = $1 AND public_code IS NULL", [userId, code]);
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
    }
  }
  throw new Error("Couldn't make a page address.");
}

export type ProviderPageSettings = {
  code: string;
  path: string;
  displayName: string;
  enabled: boolean;
  live: boolean;
  blockers: ProviderPageBlocker[];
  blockedNote: string | null;
  publicListingCount: number;
  offersHomeHelp: boolean;
  verified: boolean;
  // Whether TBM may feature the page in its Spotlight (the provider's choice).
  spotlightAllowed: boolean;
  photo: {
    status: string;
    approvedUrl: string | null;
    approvedKind: ProviderPhotoKind | null;
    pendingUrl: string | null;
    pendingKind: ProviderPhotoKind | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewNote: string | null;
    // A photo saved before reviews began: private until TBM approves it.
    unreviewedUrl: string | null;
  };
};

const asPhotoKind = (value: string | null): ProviderPhotoKind | null => providerPhotoKinds.find((kind) => kind === value) ?? null;

export async function getProviderPageSettings(userId: string): Promise<ProviderPageSettings> {
  const code = await ensurePublicCode(userId);
  const row = (await getPageRow({ userId }))!;
  const source = (await loadSource(row, { reviews: false }))!;
  const blockers = getProviderPageBlockers(source);
  const displayName = publicProviderDisplayName({ businessName: row.business_name, firstName: row.first_name });
  return {
    code,
    path: providerPublicPath(code, displayName),
    displayName,
    enabled: Boolean(row.public_enabled),
    live: blockers.length === 0,
    blockers,
    blockedNote: row.public_blocked_at ? row.public_blocked_note : null,
    publicListingCount: source.listings.length,
    offersHomeHelp: source.listings.some((listing) => listing.kind === "errand"),
    verified: row.verification_status === "verified",
    spotlightAllowed: !row.spotlight_opt_out_at,
    photo: {
      status: row.photo_status,
      approvedUrl: row.photo_approved_at && row.photo_url ? row.photo_url : null,
      approvedKind: row.photo_approved_at ? asPhotoKind(row.photo_kind) : null,
      pendingUrl: row.photo_pending_key ? privateFileUrl(row.photo_pending_key) : null,
      pendingKind: asPhotoKind(row.photo_pending_kind),
      submittedAt: row.photo_submitted_at,
      reviewedAt: row.photo_reviewed_at,
      reviewNote: row.photo_review_note,
      unreviewedUrl: !row.photo_approved_at && row.photo_url ? row.photo_url : null,
    },
  };
}

export async function setPublicPageEnabled(userId: string, enabled: boolean) {
  await ensurePublicCode(userId);
  const now = new Date().toISOString();
  await pool.query(
    "UPDATE provider_profiles SET public_enabled = $2, public_enabled_at = CASE WHEN $2 THEN $3 ELSE public_enabled_at END, updated_at = $3 WHERE user_id = $1",
    [userId, enabled, now],
  );
  clearProviderPageCache();
}

// The provider's say over TBM's Spotlight: on unless they turn it off.
export async function setSpotlightAllowed(userId: string, allowed: boolean) {
  await ensurePublicCode(userId);
  const now = new Date().toISOString();
  await pool.query(
    "UPDATE provider_profiles SET spotlight_opt_out_at = CASE WHEN $2 THEN NULL ELSE COALESCE(spotlight_opt_out_at, $3) END, updated_at = $3 WHERE user_id = $1",
    [userId, allowed, now],
  );
}

// TBM's switch wins over the provider's: a blocked page stays off until TBM unblocks it.
export async function setPublicPageBlocked(userId: string, blocked: boolean, adminId: string, note: string | null) {
  await ensurePublicCode(userId);
  const now = new Date().toISOString();
  await pool.query(
    blocked
      ? "UPDATE provider_profiles SET public_blocked_at = $2, public_blocked_by = $3, public_blocked_note = $4, updated_at = $2 WHERE user_id = $1"
      : "UPDATE provider_profiles SET public_blocked_at = NULL, public_blocked_by = NULL, public_blocked_note = NULL, updated_at = $2 WHERE user_id = $1",
    blocked ? [userId, now, adminId, note] : [userId, now],
  );
  clearProviderPageCache();
}

// A new photo goes to private storage and waits for TBM. Any approved photo
// stays public meanwhile.
export async function submitProviderPhoto(userId: string, input: { dataUrl: string; mimeType: string; kind: ProviderPhotoKind }) {
  await ensurePublicCode(userId);
  const { key } = await savePrivateUpload({ dataUrl: input.dataUrl, mimeType: input.mimeType, kind: "provider-photo", ownerUserId: userId });
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE provider_profiles SET photo_pending_key = $2, photo_pending_kind = $3, photo_status = 'pending', photo_submitted_at = $4,
       photo_review_note = NULL, updated_at = $4 WHERE user_id = $1`,
    [userId, key, input.kind, now],
  );
}

// The provider takes their photo down, public or waiting.
export async function removeProviderPhoto(userId: string) {
  await ensureProviderPageColumns();
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE provider_profiles SET photo_url = '', photo_kind = NULL, photo_approved_at = NULL, photo_pending_key = NULL,
       photo_pending_kind = NULL, photo_private_key = NULL, photo_status = 'none', photo_review_note = NULL, updated_at = $2 WHERE user_id = $1`,
    [userId, now],
  );
  clearProviderPageCache();
}

// TBM approves the waiting photo (copied to public storage only now), or an
// older unreviewed one; or turns it down with a note. Turning down with
// nothing waiting takes the current photo down.
export async function reviewProviderPhoto(userId: string, args: { decision: "approve" | "reject"; note: string | null; adminId: string; kind?: ProviderPhotoKind | null }) {
  await ensureProviderPageColumns();
  const row = await getPageRow({ userId });
  if (!row) return { ok: false as const, error: "Provider not found" };
  const now = new Date().toISOString();
  if (args.decision === "approve") {
    let url: string;
    let kind: ProviderPhotoKind;
    // The private copy stays too: a confirmed home-help guest sees the photo
    // from there, without a public link.
    let privateKey: string | null = null;
    if (row.photo_pending_key) {
      url = await publishPrivatePhoto(row.photo_pending_key);
      kind = args.kind ?? asPhotoKind(row.photo_pending_kind) ?? "face";
      privateKey = row.photo_pending_key;
    } else if (row.photo_url && !row.photo_approved_at) {
      url = row.photo_url;
      // An older photo has no kind: treated as a face unless TBM says otherwise.
      kind = args.kind ?? asPhotoKind(row.photo_kind) ?? "face";
    } else {
      return { ok: false as const, error: "There's no photo waiting for review." };
    }
    await pool.query(
      `UPDATE provider_profiles SET photo_url = $2, photo_kind = $3, photo_approved_at = $4, photo_status = 'approved',
         photo_pending_key = NULL, photo_pending_kind = NULL, photo_private_key = $7, photo_reviewed_at = $4, photo_reviewed_by = $5,
         photo_review_note = $6, updated_at = $4 WHERE user_id = $1`,
      [userId, url, kind, now, args.adminId, args.note, privateKey],
    );
  } else if (row.photo_pending_key) {
    await pool.query(
      `UPDATE provider_profiles SET photo_status = 'rejected', photo_pending_key = NULL, photo_pending_kind = NULL,
         photo_reviewed_at = $2, photo_reviewed_by = $3, photo_review_note = $4, updated_at = $2 WHERE user_id = $1`,
      [userId, now, args.adminId, args.note],
    );
  } else {
    await pool.query(
      `UPDATE provider_profiles SET photo_url = '', photo_kind = NULL, photo_approved_at = NULL, photo_private_key = NULL, photo_status = 'rejected',
         photo_reviewed_at = $2, photo_reviewed_by = $3, photo_review_note = $4, updated_at = $2 WHERE user_id = $1`,
      [userId, now, args.adminId, args.note],
    );
  }
  clearProviderPageCache();
  return { ok: true as const };
}
