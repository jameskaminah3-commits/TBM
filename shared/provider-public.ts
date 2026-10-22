// A provider's public page on TBM: its address, when it's shown, which photo
// may be shown, and the exact fields a public response may carry. The server
// builds every response from these lists (server/provider-public.ts); nothing
// is hidden in the browser.
import { slugifyForUrl, type PublicListingKind } from "./seo.ts";

// ── Address ─────────────────────────────────────────────────────────────────

// 8 random characters, without look-alikes (no i, l, o, 0 or 1). Never an account ID.
export const PROVIDER_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const providerCodePattern = /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/;

export function makeProviderPublicCode(randomIndex: (max: number) => number) {
  return Array.from({ length: 8 }, () => PROVIDER_CODE_ALPHABET[randomIndex(PROVIDER_CODE_ALPHABET.length)]).join("");
}

export function isProviderPublicCode(value: unknown): value is string {
  return typeof value === "string" && providerCodePattern.test(value);
}

// "/p/k7m2q9xw/mwinyi-coast-stays". The code finds the page; the slug is only for reading.
export function providerPublicPath(code: string, displayName?: string | null) {
  const slug = displayName ? slugifyForUrl(displayName) : "";
  return slug ? `/p/${code}/${slug}` : `/p/${code}`;
}

// ── Photo ───────────────────────────────────────────────────────────────────

// The latest photo the provider sent: waiting, approved or turned down. The
// approved photo stays public while a newer one waits for TBM.
export const providerPhotoStatuses = ["none", "pending", "approved", "rejected"] as const;
export type ProviderPhotoStatus = typeof providerPhotoStatuses[number];
export const providerPhotoKinds = ["logo", "work", "face"] as const;
export type ProviderPhotoKind = typeof providerPhotoKinds[number];
export const providerPhotoKindLabels: Record<ProviderPhotoKind, string> = {
  logo: "A logo",
  work: "A photo of my work",
  face: "A photo of me",
};

// What TBM checks before a photo is public.
export const providerPhotoChecklist = [
  "It's the provider or their business",
  "No phone numbers, QR codes, links or ID documents",
  "No children's faces",
  "Nothing inappropriate",
] as const;

// Only a photo TBM approved, and home help (which includes childcare) never
// shows a carer's face publicly.
export function canShowPublicPhoto(input: { photoApprovedAt: string | null | undefined; photoKind: string | null | undefined; photoUrl: string | null | undefined; offersHomeHelp: boolean }) {
  if (!input.photoApprovedAt || !input.photoUrl?.trim()) return false;
  if (input.offersHomeHelp && input.photoKind !== "logo" && input.photoKind !== "work") return false;
  return true;
}

// ── When the page is shown ──────────────────────────────────────────────────

export type ProviderPageBlocker = "not-provider" | "suspended" | "blocked-by-tbm" | "switched-off" | "no-public-listings";

export const providerPageBlockerLabels: Record<ProviderPageBlocker, string> = {
  "not-provider": "This account isn't a provider account.",
  suspended: "Your account is suspended.",
  "blocked-by-tbm": "TBM has switched your page off. Message TBM to find out why.",
  "switched-off": "Your page is switched off.",
  "no-public-listings": "You need at least one listing that TBM has published.",
};

// All must be true: a provider, not suspended, not switched off by TBM, switched
// on by the provider, and at least one public listing. Read on every request.
export function providerPageBlockers(input: {
  role: string | null | undefined;
  isSuspended: boolean;
  blockedByTbm: boolean;
  publicEnabled: boolean;
  publicListingCount: number;
}): ProviderPageBlocker[] {
  const blockers: ProviderPageBlocker[] = [];
  if (input.role !== "provider") blockers.push("not-provider");
  if (input.isSuspended) blockers.push("suspended");
  if (input.blockedByTbm) blockers.push("blocked-by-tbm");
  if (!input.publicEnabled) blockers.push("switched-off");
  if (input.publicListingCount < 1) blockers.push("no-public-listings");
  return blockers;
}

// ── What a public response may carry ────────────────────────────────────────

export const publicProviderFields = [
  "code",
  "slug",
  "path",
  "displayName",
  "serviceTypes",
  "serviceAreas",
  "languages",
  "about",
  "photoUrl",
  "photoKind",
  "verified",
  "verifiedSince",
  "memberSince",
  "foundingProvider",
  "rating",
  "listings",
  "reviews",
] as const;

export const publicProviderListingFields = ["kind", "path", "name", "area", "priceFrom", "priceUnit", "imageUrl"] as const;
export const publicProviderReviewFields = ["rating", "comment", "createdAt", "guestName", "reply", "listingName"] as const;
// The "Your host" block on a listing page: a short version of the same.
export const publicProviderSummaryFields = [
  "code",
  "path",
  "displayName",
  "serviceTypes",
  "languages",
  "photoUrl",
  "photoKind",
  "verified",
  "memberSince",
  "foundingProvider",
  "rating",
] as const;

export type PublicProviderListing = {
  kind: PublicListingKind;
  path: string;
  name: string;
  area: string | null;
  priceFrom: number | null;
  priceUnit: string | null;
  imageUrl: string | null;
};

export type PublicProviderReview = {
  rating: number;
  comment: string | null;
  createdAt: string;
  guestName: string;
  reply: { text: string; createdAt: string | null } | null;
  listingName: string;
};

export type PublicProviderRating = { average: number; count: number } | null;

export type PublicProviderProfile = {
  code: string;
  slug: string;
  path: string;
  displayName: string;
  serviceTypes: string[];
  serviceAreas: string[];
  languages: string[];
  about: string;
  photoUrl: string | null;
  photoKind: ProviderPhotoKind | null;
  verified: boolean;
  verifiedSince: string | null;
  memberSince: string | null;
  foundingProvider: boolean;
  rating: PublicProviderRating;
  listings: PublicProviderListing[];
  reviews: PublicProviderReview[];
};

export type PublicProviderSummary = Pick<PublicProviderProfile, (typeof publicProviderSummaryFields)[number]>;

// ── Wording ─────────────────────────────────────────────────────────────────

export const providerServiceLabels: Record<PublicListingKind, string> = {
  stay: "Stays",
  car: "Car hire",
  cook: "Private chef",
  errand: "Home help",
  experience: "Experiences",
};

// The business name, or the first name. Never a surname.
export function publicProviderDisplayName(input: { businessName?: string | null; firstName?: string | null }) {
  const business = input.businessName?.replace(/\s+/g, " ").trim();
  if (business) return business.slice(0, 80);
  const first = input.firstName?.trim().split(/\s+/)[0]?.replace(/[^A-Za-zÀ-ɏ'-]/g, "");
  return first ? first.slice(0, 40) : "TBM provider";
}

// An area name, never a street or plot: "Plot 12, Links Road, Nyali" → "Nyali".
const knownAreas = ["Nyali", "Bamburi", "Shanzu", "Mtwapa", "Vipingo", "Kilifi", "Watamu", "Malindi", "Diani", "Tiwi", "Lamu", "Likoni", "Kisauni", "Mambrui", "Tudor", "Mombasa"];
export function publicArea(location: string | null | undefined) {
  const text = (location ?? "").trim();
  if (!text) return null;
  const known = knownAreas.find((area) => new RegExp(`\\b${area}\\b`, "i").test(text));
  if (known) return known;
  const parts = text.split(",").map((part) => part.trim()).filter((part) => part && !/^(kenya|ke)$/i.test(part) && !/\d/.test(part));
  return parts.length ? parts[parts.length - 1].slice(0, 40) : null;
}

// "2026-03", from an ISO date. A month is all a public page needs.
export function monthOf(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})/.exec(value ?? "");
  return match ? `${match[1]}-${match[2]}` : null;
}

export function formatMonth(month: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!match) return "";
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

export const providerVerifiedMeaning =
  "TBM checked this provider's ID and that the service is theirs to offer. It isn't a guarantee of quality, and it doesn't remove every risk. Reviews come from guests who booked through TBM.";
export const providerHowToBook =
  "Pick a service and your dates, and book here. You pay through TBM by M-Pesa or card, and TBM confirms the details with you before the day.";
// Said the same way on the page and the business card: why paying through
// the checkout protects both sides, rather than a warning about the provider.
export const providerPaySafelyHeading = "Book with confidence";
export const providerPaySafely =
  "Use the payment options in your My Bookings checkout. It protects you and the provider from impersonation and scams.";
export const providerFoundingMeaning = "One of the first providers to join TBM. It says when they joined, not how good they are.";
