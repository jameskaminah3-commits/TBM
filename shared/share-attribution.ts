// Crediting bookings to the provider whose share link brought the guest.
// The rules (R1 to R13 in the provider audit), as plain functions so the
// browser and the server agree and each rule can be tested on its own.
import { getBookingAmountPaid, hasLockedInBookingDeposit, isBookingFullyPaid } from "./booking-payments.ts";
import type { PublicListingKind } from "./seo.ts";

export const shareChannels = ["whatsapp", "copy", "native", "qr"] as const;
export type ShareChannel = typeof shareChannels[number];

// What a share link points at: one listing, or a provider's whole page
// (listing_kind 'provider', listing_id = the page code).
export type ShareTargetKind = PublicListingKind | "provider";
// Visits, Book taps, and taps on "Ask TBM about this provider".
export const shareEventTypes = ["visit", "book", "enquire"] as const;
export type ShareEventType = typeof shareEventTypes[number];

// R3: credit lasts 30 days from the latest share visit on the device.
export const SHARE_CREDIT_DAYS = 30;
const dayMs = 24 * 60 * 60 * 1000;
// R2: a device counts once per link per 24 hours.
export const SHARE_EVENT_DEDUPE_MS = dayMs;
const maxTouches = 10;

// R1: a random code that names no account or listing.
const shareCodePattern = /^[a-z0-9]{10}$/;
export function isShareCode(value: unknown): value is string {
  return typeof value === "string" && shareCodePattern.test(value);
}

// One visit from one source: a share link, an ad, a promo link. Direct visits
// (a typed address, a bookmark) don't make one, so they keep the last source.
export type AttributionTouch = {
  at: number;
  shareCode?: string | null;
  listingKind?: PublicListingKind | null;
  listingId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceSlug?: string | null;
  sourcePath?: string | null;
  sourceTitle?: string | null;
  promoCode?: string | null;
  landingPath?: string | null;
  entryPath?: string | null;
  referrerPath?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
};

const clean = (value: string | null | undefined, max = 120) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

// A page load counts as a tagged visit when its address carries a share code,
// tracking tags or a promo. Returns null for a direct visit.
export function touchFromParams(
  params: URLSearchParams,
  context: { listingKind?: PublicListingKind | null; listingId?: string | null; path?: string | null; referrerPath?: string | null },
  now: number,
): AttributionTouch | null {
  const ref = params.get("ref")?.trim().toLowerCase() ?? "";
  const promoCode = clean(params.get("promoCode") || params.get("promo"))?.toUpperCase() ?? null;
  const touch: AttributionTouch = {
    at: now,
    shareCode: isShareCode(ref) ? ref : null,
    listingKind: context.listingKind ?? null,
    listingId: context.listingId ?? null,
    sourceType: clean(params.get("sourceType")),
    sourceId: clean(params.get("sourceId")),
    sourceSlug: clean(params.get("sourceSlug"), 200),
    promoCode,
    utmSource: clean(params.get("utm_source")),
    utmMedium: clean(params.get("utm_medium")),
    utmCampaign: clean(params.get("utm_campaign")),
    utmContent: clean(params.get("utm_content")),
    landingPath: clean(context.path, 240),
    entryPath: clean(context.path, 240),
    referrerPath: clean(context.referrerPath, 240),
  };
  const tagged = touch.shareCode || touch.promoCode || touch.sourceType || touch.sourceId || touch.sourceSlug
    || touch.utmSource || touch.utmMedium || touch.utmCampaign || touch.utmContent;
  return tagged ? touch : null;
}

function touchKey(touch: AttributionTouch) {
  if (touch.shareCode) return `share:${touch.shareCode}`;
  return ["tag", touch.sourceType, touch.sourceId, touch.sourceSlug, touch.promoCode, touch.utmSource, touch.utmMedium, touch.utmCampaign, touch.utmContent, touch.listingId]
    .map((part) => part ?? "")
    .join(":");
}

const isLive = (touch: AttributionTouch, now: number) => now - touch.at <= SHARE_CREDIT_DAYS * dayMs && touch.at <= now + 60_000;

// Record a visit. The same source again (a refresh, or a second visit from the
// same link) moves it to the end with the new time instead of adding a copy.
export function addTouch(touches: AttributionTouch[], touch: AttributionTouch, now: number): AttributionTouch[] {
  const key = touchKey(touch);
  const kept = touches.filter((existing) => isLive(existing, now) && touchKey(existing) !== key);
  const previous = touches.find((existing) => touchKey(existing) === key);
  // Keep where the visitor first landed from this source.
  const merged = previous ? { ...touch, entryPath: previous.entryPath ?? touch.entryPath } : touch;
  return [...kept, merged].slice(-maxTouches);
}

// R5: the latest tagged source wins; untagged visits don't count.
export function currentTouch(touches: AttributionTouch[], now: number): AttributionTouch | null {
  const live = touches.filter((touch) => isLive(touch, now));
  return live.length ? live[live.length - 1] : null;
}

// An older share link sent before codes existed: the listing's provider tagged
// it, but it carries no code. R1: credited to the listing's provider, unverified.
export function isOlderProviderShare(touch: AttributionTouch) {
  return !touch.shareCode && touch.utmSource === "provider" && touch.utmCampaign === "listing_share" && Boolean(touch.listingKind && touch.listingId);
}

export type ShareClaim = {
  code: string | null;
  olderLink: { kind: PublicListingKind; id: string } | null;
  // R4: earlier share links on this device, recorded as having helped.
  assistedCodes: string[];
};

// What the browser tells the server at booking time. The server checks all of it.
export function getShareClaim(touches: AttributionTouch[], now: number): ShareClaim {
  const live = touches.filter((touch) => isLive(touch, now));
  const latest = live.length ? live[live.length - 1] : null;
  const code = latest?.shareCode ?? null;
  const olderLink = latest && isOlderProviderShare(latest) ? { kind: latest.listingKind!, id: latest.listingId! } : null;
  const assistedCodes = Array.from(new Set(live.map((touch) => touch.shareCode).filter((value): value is string => Boolean(value) && value !== code)));
  return { code, olderLink, assistedCodes };
}

export type ShareCredit = "credited" | "assisted" | "unverified" | "none";
export type ShareCreditReason =
  | "no-share"
  | "unknown-link"
  | "stopped"
  | "no-recent-visit"
  | "own-link"
  | "not-public"
  | "other-listing"
  | "credited"
  | "older-link";

export type ShareCreditDecision = {
  credit: ShareCredit;
  reason: ShareCreditReason;
  creditedUserId: string | null;
  code: string | null;
  listingKind: ShareTargetKind | null;
  listingId: string | null;
};

type BookedListingFields = {
  bookingType?: string | null;
  accommodationId?: string | null;
  selectedServices?: string[] | null;
};

// R9: does this booking include the listing?
export function bookingIncludesListing(booking: BookedListingFields, kind: PublicListingKind, id: string) {
  if (kind === "stay") return booking.accommodationId === id;
  return (booking.selectedServices ?? []).includes(id);
}

// R9b: does this booking include any listing the provider manages now?
export function bookingIncludesProvider(bookingManagerUserIds: string[] | null | undefined, providerUserId: string | null) {
  return Boolean(providerUserId && (bookingManagerUserIds ?? []).includes(providerUserId));
}

export function decideShareCredit(input: {
  claim: ShareClaim;
  link: { code: string; listingKind: ShareTargetKind; listingId: string; createdByUserId: string; stoppedAt: string | null } | null;
  // The link's listing (or, for an older link, the listing it names), as it is
  // now. For a provider page link: whether the page is live, and whose it is.
  listing: { isPublic: boolean; managerUserId: string | null } | null;
  // Who manages each listing in the booking, at booking time (for R9b).
  bookingManagerUserIds?: string[];
  // The latest visit recorded on the server for this code from this device or address.
  lastVisitAt: string | null;
  bookerUserId: string;
  booking: BookedListingFields;
  now: Date;
}): ShareCreditDecision {
  const { claim, link, listing } = input;
  const none = (reason: ShareCreditReason, extra: Partial<ShareCreditDecision> = {}): ShareCreditDecision => ({
    credit: "none", reason, creditedUserId: null, code: claim.code, listingKind: null, listingId: null, ...extra,
  });

  if (claim.code) {
    if (!link || link.code !== claim.code) return none("unknown-link");
    const where = { listingKind: link.listingKind, listingId: link.listingId };
    // R8: a stopped link earns nothing.
    if (link.stoppedAt) return none("stopped", where);
    // R2, R3, R7: the server saw this device or address open the link in the last 30 days.
    const visitedAt = input.lastVisitAt ? Date.parse(input.lastVisitAt) : NaN;
    if (!Number.isFinite(visitedAt) || input.now.getTime() - visitedAt > SHARE_CREDIT_DAYS * dayMs) return none("no-recent-visit", where);
    // R10: nobody earns credit for booking through their own link.
    if (link.createdByUserId === input.bookerUserId) return none("own-link", where);
    // R8: the listing must be public when the booking is made.
    if (!listing?.isPublic) return none("not-public", where);
    // R9: the shared listing is in the booking; anything else counts as assisted.
    // R9b: a provider page link covers any listing that provider manages.
    const covered = link.listingKind === "provider"
      ? bookingIncludesProvider(input.bookingManagerUserIds, listing.managerUserId)
      : bookingIncludesListing(input.booking, link.listingKind, link.listingId);
    if (!covered) {
      return { credit: "assisted", reason: "other-listing", creditedUserId: null, code: link.code, ...where };
    }
    return { credit: "credited", reason: "credited", creditedUserId: link.createdByUserId, code: link.code, ...where };
  }

  if (claim.olderLink) {
    const where = { listingKind: claim.olderLink.kind, listingId: claim.olderLink.id, code: null };
    if (!listing?.isPublic || !listing.managerUserId) return none("not-public", where);
    if (listing.managerUserId === input.bookerUserId) return none("own-link", where);
    if (!bookingIncludesListing(input.booking, claim.olderLink.kind, claim.olderLink.id)) return none("other-listing", where);
    return { credit: "unverified", reason: "older-link", creditedUserId: listing.managerUserId, ...where };
  }

  return none("no-share");
}

export type ShareBookingState = "confirmed" | "pending" | "cancelled";

export type ShareBookingSnapshot = {
  status?: string | null;
  paymentStatus?: string | null;
  paymentAmountPaid?: number | null;
  totalPrice?: number | null;
  paymentDepositAmount?: number | null;
  serviceMode?: string | null;
};

// R11, the paid-booking rule: a credited booking counts as paid once TBM has
// received money for it and that money is either the full amount or the
// deposit the booking requires (bookings that take full payment only need the
// full amount). A smaller part-payment, an unpaid booking and a booking with
// nothing to pay count as "not paid yet"; cancelled or refunded ones count
// apart. The state is read from the booking each time, so payment or
// cancellation updates the numbers but never adds or moves credit. Reporting
// only: it changes no price, payout or earnings.
export function getShareBookingState(booking: ShareBookingSnapshot): ShareBookingState {
  if (booking.status === "cancelled" || booking.paymentStatus === "cancelled" || booking.paymentStatus === "refunded") return "cancelled";
  if (getBookingAmountPaid(booking) > 0 && (isBookingFullyPaid(booking) || hasLockedInBookingDeposit(booking))) return "confirmed";
  return "pending";
}

export function shareBookingReference(bookingId: string) {
  return bookingId.slice(0, 8).toUpperCase();
}
