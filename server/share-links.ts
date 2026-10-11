// Provider share links: issuing codes, recording visits and Book taps, deciding
// a booking's credit once when it is made, and the numbers providers and TBM see.
// The rules themselves are in shared/share-attribution.ts.
import crypto from "node:crypto";
import { pool } from "./db";
import {
  SHARE_EVENT_DEDUPE_MS,
  decideShareCredit,
  getShareBookingState,
  isShareCode,
  shareBookingReference,
  shareChannels,
  type ShareBookingState,
  type ShareChannel,
  type ShareClaim,
  type ShareCreditDecision,
} from "@shared/share-attribution";
import { getPublicListingPath, type PublicListingKind } from "@shared/seo";
import { getCarDisplayName } from "@shared/listing-share";

export const shareListingKinds = ["stay", "car", "cook", "errand", "experience"] as const satisfies readonly PublicListingKind[];

const listingTables: Record<PublicListingKind, { table: string; name: string }> = {
  stay: { table: "stays", name: "title" },
  car: { table: "cars", name: "model" },
  cook: { table: "cooks", name: "title" },
  errand: { table: "errands", name: "service_name" },
  experience: { table: "experiences", name: "title" },
};

let tablesReady: Promise<void> | null = null;

export function ensureShareTables(): Promise<void> {
  tablesReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS listing_share_links (
      code varchar PRIMARY KEY,
      listing_kind varchar NOT NULL,
      listing_id varchar NOT NULL,
      created_by_user_id varchar NOT NULL,
      channel varchar,
      created_at text NOT NULL,
      shared_at text,
      stopped_at text,
      stopped_by_user_id varchar
    );
    CREATE INDEX IF NOT EXISTS listing_share_links_owner_idx ON listing_share_links (created_by_user_id, listing_kind, listing_id);
    CREATE TABLE IF NOT EXISTS listing_share_events (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar NOT NULL,
      event_type varchar NOT NULL,
      device_hash varchar,
      ip_hash varchar,
      created_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS listing_share_events_code_idx ON listing_share_events (code, event_type, created_at);
  `).then(() => undefined).catch((error) => {
    tablesReady = null;
    throw error;
  });
  return tablesReady;
}

// Devices and addresses are only ever stored as keyed hashes.
function keyedHash(value: string | null | undefined) {
  const clean = value?.trim();
  if (!clean) return null;
  const secret = process.env.SESSION_SECRET || "tbm-share-links";
  return crypto.createHmac("sha256", secret).update(clean).digest("hex").slice(0, 32);
}

function newShareCode() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 10 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
}

export type ShareListing = { kind: PublicListingKind; id: string; name: string; isPublic: boolean; managerUserId: string | null };

export async function getShareListing(kind: PublicListingKind, id: string): Promise<ShareListing | null> {
  const config = listingTables[kind];
  if (!config) return null;
  const { rows } = await pool.query(
    `SELECT id, ${config.name} AS name, ${kind === "car" ? "make" : "NULL"} AS make, is_public, manager_user_id FROM ${config.table} WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  const name = kind === "car" ? getCarDisplayName({ make: row?.make, model: row?.name }) : row?.name;
  return row ? { kind, id: row.id, name: name ?? "Listing", isPublic: Boolean(row.is_public), managerUserId: row.manager_user_id ?? null } : null;
}

type ShareLinkRow = {
  code: string;
  listing_kind: PublicListingKind;
  listing_id: string;
  created_by_user_id: string;
  channel: ShareChannel | null;
  created_at: string;
  shared_at: string | null;
  stopped_at: string | null;
};

async function getShareLink(code: string): Promise<ShareLinkRow | null> {
  if (!isShareCode(code)) return null;
  await ensureShareTables();
  const { rows } = await pool.query<ShareLinkRow>("SELECT * FROM listing_share_links WHERE code = $1", [code]);
  return rows[0] ?? null;
}

// R1: a code for the listing's own provider. An unused code from the last day
// is handed back instead of making another, so opening the sheet twice
// doesn't fill the list.
export async function issueShareLink(userId: string, kind: PublicListingKind, listingId: string) {
  const listing = await getShareListing(kind, listingId);
  if (!listing || listing.managerUserId !== userId) {
    return { error: "Only the listing's provider gets a tracked link." as const };
  }
  if (!listing.isPublic) {
    return { error: "This listing isn't public yet." as const };
  }
  await ensureShareTables();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const unused = await pool.query<{ code: string }>(
    `SELECT l.code FROM listing_share_links l
     WHERE l.created_by_user_id = $1 AND l.listing_kind = $2 AND l.listing_id = $3
       AND l.shared_at IS NULL AND l.stopped_at IS NULL AND l.created_at > $4
       AND NOT EXISTS (SELECT 1 FROM listing_share_events e WHERE e.code = l.code)
     ORDER BY l.created_at DESC LIMIT 1`,
    [userId, kind, listingId, since],
  );
  if (unused.rows[0]) return { code: unused.rows[0].code };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newShareCode();
    const inserted = await pool.query(
      `INSERT INTO listing_share_links (code, listing_kind, listing_id, created_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING`,
      [code, kind, listingId, userId, new Date().toISOString()],
    );
    if (inserted.rowCount) return { code };
  }
  throw new Error("Couldn't make a share link.");
}

// The provider sent it: WhatsApp, Copy link or the phone's share menu.
export async function markShareLinkShared(code: string, userId: string, channel: ShareChannel) {
  const link = await getShareLink(code);
  if (!link || link.created_by_user_id !== userId) return false;
  await pool.query(
    "UPDATE listing_share_links SET shared_at = COALESCE(shared_at, $2), channel = COALESCE(channel, $3) WHERE code = $1",
    [code, new Date().toISOString(), channel],
  );
  return true;
}

// R8: a stopped link earns nothing more. Its provider or TBM can stop it.
export async function stopShareLink(code: string, userId: string, isAdmin: boolean) {
  const link = await getShareLink(code);
  if (!link || (!isAdmin && link.created_by_user_id !== userId)) return false;
  await pool.query(
    "UPDATE listing_share_links SET stopped_at = COALESCE(stopped_at, $2), stopped_by_user_id = COALESCE(stopped_by_user_id, $3) WHERE code = $1",
    [code, new Date().toISOString(), userId],
  );
  return true;
}

// R2: a visit or Book tap counts once per device (or, without one, per
// address) per link per 24 hours, and only while the link and listing are live.
export async function recordShareEvent(args: { code: string; eventType: "visit" | "book"; deviceId?: string | null; ip: string; channel?: string | null }) {
  const link = await getShareLink(args.code);
  if (!link || link.stopped_at) return { recorded: false };
  const listing = await getShareListing(link.listing_kind, link.listing_id);
  if (!listing?.isPublic) return { recorded: false };

  const deviceHash = keyedHash(args.deviceId);
  const ipHash = keyedHash(args.ip);
  const now = new Date();
  const since = new Date(now.getTime() - SHARE_EVENT_DEDUPE_MS).toISOString();
  const duplicate = await pool.query(
    `SELECT 1 FROM listing_share_events
     WHERE code = $1 AND event_type = $2 AND created_at > $3
       AND (($4::varchar IS NOT NULL AND device_hash = $4) OR ($4::varchar IS NULL AND device_hash IS NULL AND ip_hash = $5))
     LIMIT 1`,
    [link.code, args.eventType, since, deviceHash, ipHash],
  );
  if (!duplicate.rowCount) {
    await pool.query(
      "INSERT INTO listing_share_events (code, event_type, device_hash, ip_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
      [link.code, args.eventType, deviceHash, ipHash, now.toISOString()],
    );
  }
  // A link opened before the provider tapped a share button was still shared.
  if (!link.shared_at) {
    const channel = shareChannels.includes(args.channel as ShareChannel) ? args.channel : "copy";
    await pool.query("UPDATE listing_share_links SET shared_at = $2, channel = COALESCE(channel, $3) WHERE code = $1", [link.code, now.toISOString(), channel]);
  }
  return { recorded: !duplicate.rowCount };
}

async function getLastShareVisit(code: string, deviceId: string | null | undefined, ip: string) {
  const { rows } = await pool.query<{ last: string | null }>(
    `SELECT max(created_at) AS last FROM listing_share_events
     WHERE code = $1 AND event_type = 'visit' AND (device_hash = $2 OR ip_hash = $3)`,
    [code, keyedHash(deviceId), keyedHash(ip)],
  );
  return rows[0]?.last ?? null;
}

// Decided once, when the booking is made (R9). Never throws: a problem here
// must not stop a guest booking.
export async function decideBookingShareCredit(args: {
  claim: ShareClaim;
  deviceId?: string | null;
  ip: string;
  bookerUserId: string;
  booking: { bookingType?: string | null; accommodationId?: string | null; selectedServices?: string[] | null };
}): Promise<{ decision: ShareCreditDecision; assistedCodes: string[] }> {
  await ensureShareTables();
  const link = args.claim.code ? await getShareLink(args.claim.code) : null;
  const listing = link
    ? await getShareListing(link.listing_kind, link.listing_id)
    : args.claim.olderLink ? await getShareListing(args.claim.olderLink.kind, args.claim.olderLink.id) : null;
  const lastVisitAt = link ? await getLastShareVisit(link.code, args.deviceId, args.ip) : null;
  const decision = decideShareCredit({
    claim: args.claim,
    link: link ? { code: link.code, listingKind: link.listing_kind, listingId: link.listing_id, createdByUserId: link.created_by_user_id, stoppedAt: link.stopped_at } : null,
    listing: listing ? { isPublic: listing.isPublic, managerUserId: listing.managerUserId } : null,
    lastVisitAt,
    bookerUserId: args.bookerUserId,
    booking: args.booking,
    now: new Date(),
  });

  // R4: earlier links on this device helped, if they are real, live and not the guest's own.
  const assistedCodes: string[] = [];
  for (const code of args.claim.assistedCodes.filter(isShareCode).slice(0, 5)) {
    if (code === decision.code) continue;
    const earlier = await getShareLink(code);
    if (earlier && !earlier.stopped_at && earlier.created_by_user_id !== args.bookerUserId) {
      assistedCodes.push(code);
    }
  }
  return { decision, assistedCodes };
}

// ---- Reporting --------------------------------------------------------------

type ShareCounts = Record<ShareBookingState, number>;
const emptyCounts = (): ShareCounts => ({ confirmed: 0, pending: 0, cancelled: 0 });

export type ShareLinkSummary = {
  code: string;
  channel: ShareChannel | null;
  createdAt: string;
  sharedAt: string | null;
  stoppedAt: string | null;
  visits: number;
  bookTaps: number;
  bookings: ShareCounts;
  assisted: number;
  lastActivityAt: string | null;
};

export type ShareBookingSummary = {
  reference: string;
  bookedOn: string;
  startDate: string;
  endDate: string;
  state: ShareBookingState;
  via: "link" | "older-link";
  linkCode: string | null;
};

export type ListingShareSummary = {
  kind: PublicListingKind;
  id: string;
  name: string;
  isPublic: boolean;
  path: string;
  linksShared: Record<ShareChannel, number>;
  visits: number;
  bookTaps: number;
  bookings: ShareCounts;
  olderLinkBookings: ShareCounts;
  assisted: number;
  lastActivityAt: string | null;
  links: ShareLinkSummary[];
  creditedBookings: ShareBookingSummary[];
};

type AttributionRow = {
  booking_id: string;
  share_code: string | null;
  share_credit: string | null;
  share_listing_kind: PublicListingKind | null;
  share_listing_id: string | null;
  credited_user_id: string | null;
  assisted_share_codes: string[] | null;
  created_at: string;
  check_in: string;
  check_out: string;
  status: string | null;
  payment_status: string | null;
  payment_amount_paid: number | null;
};

const latest = (...values: Array<string | null | undefined>) => values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

// Counts, booking references and dates only: no guest names, contact or amounts (R12).
async function summarise(ownerUserIds: string[] | null) {
  await ensureShareTables();
  const links = (await pool.query<ShareLinkRow>(
    ownerUserIds
      ? "SELECT * FROM listing_share_links WHERE created_by_user_id = ANY($1) ORDER BY created_at DESC"
      : "SELECT * FROM listing_share_links ORDER BY created_at DESC",
    ownerUserIds ? [ownerUserIds] : [],
  )).rows;
  const codes = links.map((link) => link.code);
  const events = codes.length
    ? (await pool.query<{ code: string; event_type: string; count: string; last: string }>(
      "SELECT code, event_type, count(*) AS count, max(created_at) AS last FROM listing_share_events WHERE code = ANY($1) GROUP BY code, event_type",
      [codes],
    )).rows
    : [];
  const attributions = (await pool.query<AttributionRow>(
    `SELECT ba.booking_id, ba.share_code, ba.share_credit, ba.share_listing_kind, ba.share_listing_id, ba.credited_user_id,
            ba.assisted_share_codes, b.created_at, b.check_in, b.check_out, b.status, b.payment_status, b.payment_amount_paid
     FROM booking_attributions ba JOIN bookings b ON b.id = ba.booking_id
     WHERE (ba.share_credit IS NOT NULL AND ba.share_credit <> 'none')
       AND ($1::varchar[] IS NULL OR ba.credited_user_id = ANY($1) OR ba.share_code = ANY($2) OR ba.assisted_share_codes && $2)
     ORDER BY b.created_at DESC`,
    [ownerUserIds, codes],
  )).rows;
  return { links, events, attributions };
}

export async function getShareSummaries(ownerUserIds: string[] | null) {
  const { links, events, attributions } = await summarise(ownerUserIds);
  const linkOwner = new Map(links.map((link) => [link.code, link.created_by_user_id]));
  const listings = new Map<string, ListingShareSummary & { ownerUserId: string }>();
  const listingKey = (ownerUserId: string, kind: PublicListingKind, id: string) => `${ownerUserId}|${kind}|${id}`;
  const ensureListing = (ownerUserId: string, kind: PublicListingKind, id: string) => {
    const key = listingKey(ownerUserId, kind, id);
    let entry = listings.get(key);
    if (!entry) {
      entry = {
        ownerUserId, kind, id, name: "", isPublic: false, path: "",
        linksShared: { whatsapp: 0, copy: 0, native: 0 }, visits: 0, bookTaps: 0,
        bookings: emptyCounts(), olderLinkBookings: emptyCounts(), assisted: 0, lastActivityAt: null, links: [], creditedBookings: [],
      };
      listings.set(key, entry);
    }
    return entry;
  };

  const linkSummaries = new Map<string, ShareLinkSummary>();
  for (const link of links) {
    const linkEvents = events.filter((event) => event.code === link.code);
    const visits = Number(linkEvents.find((event) => event.event_type === "visit")?.count ?? 0);
    // Codes made when a sheet opened but never sent or opened aren't shares.
    if (!link.shared_at && !visits) continue;
    const summary: ShareLinkSummary = {
      code: link.code,
      channel: link.channel,
      createdAt: link.created_at,
      sharedAt: link.shared_at,
      stoppedAt: link.stopped_at,
      visits,
      bookTaps: Number(linkEvents.find((event) => event.event_type === "book")?.count ?? 0),
      bookings: emptyCounts(),
      assisted: 0,
      lastActivityAt: latest(link.shared_at, ...linkEvents.map((event) => event.last)),
    };
    linkSummaries.set(link.code, summary);
    const listing = ensureListing(link.created_by_user_id, link.listing_kind, link.listing_id);
    listing.links.push(summary);
    listing.linksShared[link.channel ?? "copy"] += 1;
    listing.visits += summary.visits;
    listing.bookTaps += summary.bookTaps;
    listing.lastActivityAt = latest(listing.lastActivityAt, summary.lastActivityAt);
  }

  for (const row of attributions) {
    const state = getShareBookingState({ status: row.status, paymentStatus: row.payment_status, paymentAmountPaid: row.payment_amount_paid });
    const booking = {
      reference: shareBookingReference(row.booking_id),
      bookedOn: row.created_at,
      startDate: row.check_in,
      endDate: row.check_out,
      state,
    };
    if (row.share_credit === "credited" && row.share_code && row.share_listing_kind && row.share_listing_id && row.credited_user_id) {
      const listing = ensureListing(row.credited_user_id, row.share_listing_kind, row.share_listing_id);
      listing.bookings[state] += 1;
      listing.creditedBookings.push({ ...booking, via: "link", linkCode: row.share_code });
      listing.lastActivityAt = latest(listing.lastActivityAt, row.created_at);
      const link = linkSummaries.get(row.share_code);
      if (link) {
        link.bookings[state] += 1;
        link.lastActivityAt = latest(link.lastActivityAt, row.created_at);
      }
    } else if (row.share_credit === "unverified" && row.share_listing_kind && row.share_listing_id && row.credited_user_id) {
      const listing = ensureListing(row.credited_user_id, row.share_listing_kind, row.share_listing_id);
      listing.olderLinkBookings[state] += 1;
      listing.creditedBookings.push({ ...booking, via: "older-link", linkCode: null });
      listing.lastActivityAt = latest(listing.lastActivityAt, row.created_at);
    }
    // Assisted: the link brought the guest, who booked something else, or a later link took the credit.
    const assistedCodes = new Set([...(row.share_credit === "assisted" && row.share_code ? [row.share_code] : []), ...(row.assisted_share_codes ?? [])]);
    for (const code of Array.from(assistedCodes)) {
      const link = linkSummaries.get(code);
      const owner = linkOwner.get(code);
      const sourceLink = links.find((entry) => entry.code === code);
      if (!link || !owner || !sourceLink) continue;
      link.assisted += 1;
      ensureListing(owner, sourceLink.listing_kind, sourceLink.listing_id).assisted += 1;
    }
  }

  const result = Array.from(listings.values());
  await Promise.all(result.map(async (entry) => {
    const listing = await getShareListing(entry.kind, entry.id);
    entry.name = listing?.name ?? "Listing no longer available";
    entry.isPublic = Boolean(listing?.isPublic);
    entry.path = listing ? getPublicListingPath(entry.kind, entry.id, listing.name) : "";
  }));
  return result.sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));
}

// "Your shares": only the signed-in provider's own links and credit (R12).
export async function getProviderShares(userId: string) {
  const listings = await getShareSummaries([userId]);
  return { listings: listings.map(({ ownerUserId: _owner, ...listing }) => listing) };
}

// TBM's view: every provider's shares, with the provider's name.
export async function getAdminShareSummary() {
  const listings = await getShareSummaries(null);
  const ownerIds = Array.from(new Set(listings.map((listing) => listing.ownerUserId)));
  const names = ownerIds.length
    ? (await pool.query<{ id: string; name: string }>(
      "SELECT id, trim(concat_ws(' ', first_name, last_name)) AS name FROM users WHERE id = ANY($1)",
      [ownerIds],
    )).rows
    : [];
  const nameById = new Map(names.map((row) => [row.id, row.name || "Provider"]));
  return {
    rows: listings.map(({ links, creditedBookings, ownerUserId, ...listing }) => ({
      ...listing,
      providerName: nameById.get(ownerUserId) ?? "Provider",
      linkCount: links.length,
      stoppedLinks: links.filter((link) => link.stoppedAt).length,
      bookingCount: creditedBookings.length,
    })),
  };
}
