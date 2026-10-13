// The public reviews behind GET /api/reviews/:targetType/:targetId. Kept apart
// from routes.ts so a test can run it against reviews that carry IDs and full
// names, and prove none of them get out.
import { reviewTargetTypes, type Review } from "../shared/schema.ts";
import { toPublicReview, type PublicReview } from "../shared/public-review.ts";

export type PublicReviewSource = {
  getReviewsByTarget(targetType: string, targetId: string): Promise<Review[]>;
  getBooking(bookingId: string): Promise<{ guestName?: string | null } | undefined>;
};

export function isPublicReviewTarget(value: string): value is (typeof reviewTargetTypes)[number] {
  return (reviewTargetTypes as readonly string[]).includes(value);
}

export async function listPublicReviews(source: PublicReviewSource, targetType: string, targetId: string): Promise<PublicReview[]> {
  const reviews = await source.getReviewsByTarget(targetType, targetId);
  const publicReviews = await Promise.all(
    reviews.map(async (review) => {
      const booking = await source.getBooking(review.bookingId);
      return toPublicReview(review, booking?.guestName);
    }),
  );
  return publicReviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
