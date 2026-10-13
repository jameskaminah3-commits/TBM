// The one place a public provider response is built. It takes everything the
// server knows about a provider (IDs, contact details, payout fields and all)
// and returns only the allowlisted fields in shared/provider-public.ts. Kept
// apart from the database code so tests can feed it rows full of private data
// and prove none of it gets out.
import { removeContactRoutes } from "../shared/contact-redaction.ts";
import { summarizeRatings } from "../shared/review-eligibility.ts";
import { toPublicReview } from "../shared/public-review.ts";
import { slugifyForUrl, type PublicListingKind } from "../shared/seo.ts";
import {
  canShowPublicPhoto,
  monthOf,
  providerPageBlockers,
  providerPublicPath,
  providerServiceLabels,
  publicArea,
  publicProviderDisplayName,
  type ProviderPageBlocker,
  type ProviderPhotoKind,
  type PublicProviderListing,
  type PublicProviderProfile,
  type PublicProviderReview,
  type PublicProviderSummary,
} from "../shared/provider-public.ts";
import { isEligibleRow, type ReviewRow } from "./public-reviews.ts";

export type ProviderPageListing = {
  kind: PublicListingKind;
  id: string;
  name: string;
  path: string;
  area: string | null;
  priceFrom: number | null;
  priceUnit: string | null;
  imageUrl: string | null;
};

// What the database layer hands over. Much of it must never be sent.
export type ProviderPageSource = {
  userId: string;
  role: string | null;
  isSuspended: boolean;
  firstName: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  accountCreatedAt: string | null;
  profile: {
    publicCode: string;
    publicEnabled: boolean;
    publicBlockedAt: string | null;
    businessName: string;
    bio: string;
    photoUrl: string;
    photoApprovedAt: string | null;
    photoKind: string | null;
    languages: string[];
    serviceAreas: string[];
    verificationStatus: string;
    verifiedAt: string | null;
    foundingProviderAt: string | null;
    [privateField: string]: unknown;
  };
  listings: ProviderPageListing[];
  reviewRows: ReviewRow[];
};

const orderedKinds: PublicListingKind[] = ["stay", "car", "cook", "errand", "experience"];
const MAX_PUBLIC_REVIEWS = 30;

// Bios lose phone numbers, emails, links and social handles: guests reach
// providers through TBM.
export function publicAbout(bio: string | null | undefined) {
  const trimmed = (bio ?? "").replace(/\s+\n/g, "\n").trim();
  return trimmed ? removeContactRoutes(trimmed).slice(0, 800) : "";
}

export function getProviderPageBlockers(source: ProviderPageSource): ProviderPageBlocker[] {
  return providerPageBlockers({
    role: source.role,
    isSuspended: source.isSuspended,
    blockedByTbm: Boolean(source.profile.publicBlockedAt),
    publicEnabled: source.profile.publicEnabled,
    publicListingCount: source.listings.length,
  });
}

function offersHomeHelp(source: ProviderPageSource) {
  return source.listings.some((listing) => listing.kind === "errand");
}

function publicPhoto(source: ProviderPageSource): { photoUrl: string | null; photoKind: ProviderPhotoKind | null } {
  const { photoApprovedAt, photoKind, photoUrl } = source.profile;
  if (!canShowPublicPhoto({ photoApprovedAt, photoKind, photoUrl, offersHomeHelp: offersHomeHelp(source) })) {
    return { photoUrl: null, photoKind: null };
  }
  const kind = (["logo", "work", "face"] as const).find((value) => value === photoKind) ?? null;
  return { photoUrl: photoUrl.trim(), photoKind: kind };
}

function eligibleRows(source: ProviderPageSource) {
  const listingKeys = new Set(source.listings.map((listing) => `${listing.kind}:${listing.id}`));
  return source.reviewRows.filter((row) => listingKeys.has(`${row.targetType}:${row.targetId}`) && isEligibleRow(row));
}

export function providerRating(source: ProviderPageSource) {
  const summary = summarizeRatings(eligibleRows(source).map((row) => row.rating));
  return summary.average === null ? null : { average: summary.average, count: summary.count };
}

function baseFields(source: ProviderPageSource) {
  const displayName = publicProviderDisplayName({ businessName: source.profile.businessName, firstName: source.firstName });
  const kinds = new Set(source.listings.map((listing) => listing.kind));
  const verified = source.profile.verificationStatus === "verified";
  return {
    code: source.profile.publicCode,
    slug: slugifyForUrl(displayName),
    path: providerPublicPath(source.profile.publicCode, displayName),
    displayName,
    serviceTypes: orderedKinds.filter((kind) => kinds.has(kind)).map((kind) => providerServiceLabels[kind]),
    languages: source.profile.languages.filter((value) => typeof value === "string").slice(0, 10),
    ...publicPhoto(source),
    verified,
    memberSince: monthOf(source.accountCreatedAt),
    // Shown only while the page itself is live (the caller checks that first).
    foundingProvider: Boolean(source.profile.foundingProviderAt),
    rating: providerRating(source),
  };
}

function toListing(listing: ProviderPageListing): PublicProviderListing {
  return {
    kind: listing.kind,
    path: listing.path,
    name: listing.name,
    area: publicArea(listing.area),
    priceFrom: listing.priceFrom && listing.priceFrom > 0 ? listing.priceFrom : null,
    priceUnit: listing.priceFrom && listing.priceFrom > 0 ? listing.priceUnit : null,
    imageUrl: listing.imageUrl?.trim() || null,
  };
}

export function toPublicProviderReviews(source: ProviderPageSource): PublicProviderReview[] {
  const names = new Map(source.listings.map((listing) => [`${listing.kind}:${listing.id}`, listing.name]));
  return eligibleRows(source)
    .map((row) => ({ ...toPublicReview(row, row.guestName), listingName: names.get(`${row.targetType}:${row.targetId}`) ?? "" }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_PUBLIC_REVIEWS);
}

// Every public provider page response is this object, built field by field.
export function toPublicProviderProfile(source: ProviderPageSource): PublicProviderProfile {
  const base = baseFields(source);
  return {
    code: base.code,
    slug: base.slug,
    path: base.path,
    displayName: base.displayName,
    serviceTypes: base.serviceTypes,
    serviceAreas: source.profile.serviceAreas.filter((value) => typeof value === "string").slice(0, 20),
    languages: base.languages,
    about: publicAbout(source.profile.bio),
    photoUrl: base.photoUrl,
    photoKind: base.photoKind,
    verified: base.verified,
    verifiedSince: base.verified ? monthOf(source.profile.verifiedAt) : null,
    memberSince: base.memberSince,
    foundingProvider: base.foundingProvider,
    rating: base.rating,
    listings: source.listings.map(toListing),
    reviews: toPublicProviderReviews(source),
  };
}

// The "Your host" block on a listing page.
export function toPublicProviderSummary(source: ProviderPageSource): PublicProviderSummary {
  const base = baseFields(source);
  return {
    code: base.code,
    path: base.path,
    displayName: base.displayName,
    serviceTypes: base.serviceTypes,
    languages: base.languages,
    photoUrl: base.photoUrl,
    photoKind: base.photoKind,
    verified: base.verified,
    memberSince: base.memberSince,
    foundingProvider: base.foundingProvider,
    rating: base.rating,
  };
}
