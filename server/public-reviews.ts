// Public reviews and ratings. Kept apart from the database code so tests can
// run it against rows that carry IDs, full names and contact details, and
// prove none of them get out. Only eligible reviews (shared/review-eligibility)
// are shown or counted.
import { reviewTargetTypes } from "../shared/schema.ts";
import { toPublicReview, type PublicReview } from "../shared/public-review.ts";
import { isEligibleReview, summarizeRatings, type RatingSummary } from "../shared/review-eligibility.ts";

/** A stored review with what's needed to decide whether it counts. Never sent as is. */
export type ReviewRow = {
  reviewId: string;
  reviewUserId: string;
  targetType: string;
  targetId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewStatus: string | null;
  providerReply: string | null;
  providerReplyStatus: string | null;
  providerReplyAt: string | null;
  guestName: string | null;
  booking: { userId: string | null; status: string | null; paymentStatus: string | null } | null;
  listingManagerUserId: string | null;
  reviewerRole: string | null;
};

export type PublicReviewSource = {
  getReviewRows(targetType: string, targetId: string): Promise<ReviewRow[]>;
};

export function isPublicReviewTarget(value: string): value is (typeof reviewTargetTypes)[number] {
  return (reviewTargetTypes as readonly string[]).includes(value);
}

export function isEligibleRow(row: ReviewRow) {
  return isEligibleReview({
    reviewUserId: row.reviewUserId,
    reviewStatus: row.reviewStatus,
    booking: row.booking,
    listingManagerUserId: row.listingManagerUserId,
    reviewerRole: row.reviewerRole,
  });
}

export function toPublicReviewList(rows: ReviewRow[]): PublicReview[] {
  return rows
    .filter(isEligibleRow)
    .map((row) => toPublicReview(row, row.guestName))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listPublicReviews(source: PublicReviewSource, targetType: string, targetId: string): Promise<PublicReview[]> {
  return toPublicReviewList(await source.getReviewRows(targetType, targetId));
}

export const ratingKey = (targetType: string, targetId: string) => `${targetType}:${targetId}`;

/** Rating summaries per listing, from eligible reviews only. */
export function summarizeRows(rows: ReviewRow[]): Map<string, RatingSummary> {
  const ratings = new Map<string, number[]>();
  for (const row of rows) {
    if (!isEligibleRow(row)) continue;
    const key = ratingKey(row.targetType, row.targetId);
    ratings.set(key, [...(ratings.get(key) ?? []), row.rating]);
  }
  return new Map(Array.from(ratings, ([key, values]) => [key, summarizeRatings(values)]));
}

/** What public listing responses carry: the average (0 below the threshold) and the eligible count. */
export function publicRatingFields(summary: RatingSummary | undefined) {
  return { rating: summary?.average ?? 0, reviewCount: summary?.count ?? 0 };
}
