import assert from "node:assert/strict";
import test from "node:test";
import { hasPublicRating, isEligibleReview, ratingLabel, summarizeRatings, RATING_MIN_REVIEWS } from "./review-eligibility.ts";

const ok = { reviewUserId: "guest-1", booking: { userId: "guest-1", status: "completed", paymentStatus: "paid" }, listingManagerUserId: "provider-1", reviewerRole: "customer" };

test("a review from the guest's own completed booking counts", () => {
  assert.equal(isEligibleReview(ok), true);
});

test("reviews that don't come from a genuine booking don't count", () => {
  assert.equal(isEligibleReview({ ...ok, booking: null }), false, "no booking");
  assert.equal(isEligibleReview({ ...ok, booking: { ...ok.booking, userId: "someone-else" } }), false, "someone else's booking");
  assert.equal(isEligibleReview({ ...ok, booking: { ...ok.booking, userId: null } }), false, "booking with no account");
  assert.equal(isEligibleReview({ ...ok, booking: { ...ok.booking, status: "cancelled" } }), false, "cancelled");
  assert.equal(isEligibleReview({ ...ok, booking: { ...ok.booking, paymentStatus: "refunded" } }), false, "refunded");
  assert.equal(isEligibleReview({ ...ok, booking: { ...ok.booking, paymentStatus: "cancelled" } }), false, "payment cancelled");
});

test("self-reviews, admin reviews and hidden reviews don't count", () => {
  assert.equal(isEligibleReview({ ...ok, listingManagerUserId: "guest-1" }), false, "the listing's own provider");
  assert.equal(isEligibleReview({ ...ok, reviewerRole: "admin" }), false, "a TBM admin account");
  assert.equal(isEligibleReview({ ...ok, reviewStatus: "hidden" }), false, "hidden by TBM");
  assert.equal(isEligibleReview({ ...ok, reviewStatus: "published" }), true);
});

test("a rating needs three eligible reviews", () => {
  assert.equal(RATING_MIN_REVIEWS, 3);
  assert.deepEqual(summarizeRatings([]), { count: 0, average: null });
  assert.deepEqual(summarizeRatings([5, 5]), { count: 2, average: null });
  assert.deepEqual(summarizeRatings([5, 4, 5]), { count: 3, average: 4.7 });
});

test("the average keeps one decimal place: 4.6 is never shown as 5.0", () => {
  assert.equal(summarizeRatings([5, 5, 4, 5, 4]).average, 4.6);
  assert.equal(summarizeRatings([4, 4, 5]).average, 4.3);
  assert.equal(summarizeRatings([1, 2, 3]).average, 2);
  assert.equal(summarizeRatings([5, 5, 5, 0, 9, Number.NaN]).count, 3, "out-of-range ratings are ignored");
});

test("labels: a number from three reviews, otherwise New on TBM", () => {
  assert.equal(ratingLabel({ rating: 4.6, reviewCount: 12 }), "4.6 · 12 reviews");
  assert.equal(ratingLabel({ rating: 5, reviewCount: 3 }), "5.0 · 3 reviews");
  assert.equal(ratingLabel({ rating: 0, reviewCount: 2 }), "New on TBM");
  assert.equal(ratingLabel({ rating: 5, reviewCount: 2 }), "New on TBM", "a stored rating below the threshold isn't shown");
  assert.equal(hasPublicRating({ rating: 4.2, reviewCount: 3 }), true);
  assert.equal(hasPublicRating({ rating: 0, reviewCount: 7 }), false);
});
