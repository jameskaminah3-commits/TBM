// Which reviews count, and how a rating is shown. One set of rules for the
// server (public reviews, listing ratings, provider pages, search-engine data)
// and the pages, so they always agree.

/** A rating number is shown only from this many eligible reviews. */
export const RATING_MIN_REVIEWS = 3;

export const reviewStatuses = ["published", "hidden"] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

export const reviewHideReasons = ["abuse", "personal-details", "wrong-booking"] as const;
export type ReviewHideReason = (typeof reviewHideReasons)[number];

export const reviewHideReasonLabels: Record<ReviewHideReason, string> = {
  abuse: "Abusive or offensive",
  "personal-details": "Contains personal details",
  "wrong-booking": "Not about this booking or listing",
};

export type ReviewEligibilityInput = {
  reviewUserId: string;
  reviewStatus?: string | null;
  booking: { userId?: string | null; status?: string | null; paymentStatus?: string | null } | null | undefined;
  listingManagerUserId?: string | null;
  reviewerRole?: string | null;
};

/**
 * A review counts when it comes from a genuine booking: the booking exists and
 * belongs to the reviewer, it isn't cancelled or refunded, the reviewer isn't
 * the listing's own provider or a TBM admin account, and TBM hasn't hidden it.
 * (Only completed bookings can be reviewed, and only once per item: both are
 * checked when the review is written.)
 */
export function isEligibleReview(input: ReviewEligibilityInput): boolean {
  if ((input.reviewStatus ?? "published") !== "published") return false;
  const booking = input.booking;
  if (!booking?.userId || booking.userId !== input.reviewUserId) return false;
  if (booking.status === "cancelled") return false;
  if (booking.paymentStatus === "cancelled" || booking.paymentStatus === "refunded") return false;
  if (input.listingManagerUserId && input.listingManagerUserId === input.reviewUserId) return false;
  if (input.reviewerRole === "admin") return false;
  return true;
}

export type RatingSummary = {
  /** Eligible reviews counted. */
  count: number;
  /** The average to one decimal place, or null below RATING_MIN_REVIEWS. */
  average: number | null;
};

export function summarizeRatings(ratings: number[]): RatingSummary {
  const valid = ratings.filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);
  const count = valid.length;
  if (count < RATING_MIN_REVIEWS) return { count, average: null };
  const average = valid.reduce((sum, rating) => sum + rating, 0) / count;
  return { count, average: Math.round(average * 10) / 10 };
}

/**
 * What the listing tables store in `rating` (a whole number; 0 below the
 * threshold) and `review_count` (eligible reviews). Public pages never read
 * these; they recompute from eligible reviews.
 */
export function storedRatingFields(summary: RatingSummary) {
  return { rating: summary.average === null ? 0 : Math.round(summary.average), reviewCount: summary.count };
}

/** Public listings carry `rating` (the average, or 0 below the threshold) and `reviewCount`. */
export function hasPublicRating(listing: { rating?: number | null; reviewCount?: number | null }) {
  return Number(listing.reviewCount) >= RATING_MIN_REVIEWS && Number(listing.rating) > 0;
}

export function formatRating(average: number) {
  return average.toFixed(1);
}

/** "4.6 · 12 reviews", or "New on TBM" below the threshold. */
export function ratingLabel(summary: { rating?: number | null; reviewCount?: number | null }) {
  if (!hasPublicRating(summary)) return "New on TBM";
  const count = Number(summary.reviewCount);
  return `${formatRating(Number(summary.rating))} · ${count} review${count === 1 ? "" : "s"}`;
}
