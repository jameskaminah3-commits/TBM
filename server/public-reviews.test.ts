import assert from "node:assert/strict";
import test from "node:test";
import { publicReviewFields, publicReviewerName, toPublicReview } from "../shared/public-review.ts";
import { isPublicReviewTarget, listPublicReviews, publicRatingFields, summarizeRows, toPublicReviewList, type PublicReviewSource, type ReviewRow } from "./public-reviews.ts";

// Stored rows carry everything a leak could expose: IDs, the full guest name,
// contact details in the text, and who owns the listing.
function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    reviewId: "rev-1",
    reviewUserId: "user-aaa",
    targetType: "stay",
    targetId: "villa-1",
    rating: 5,
    comment: " Lovely pool. ",
    createdAt: "2026-09-02T08:00:00.000Z",
    reviewStatus: "published",
    providerReply: null,
    providerReplyStatus: null,
    providerReplyAt: null,
    guestName: "Amina Wanjiru",
    booking: { userId: "user-aaa", status: "completed", paymentStatus: "paid" },
    listingManagerUserId: "provider-1",
    reviewerRole: "customer",
    ...overrides,
  };
}

const rows: ReviewRow[] = [
  row(),
  row({ reviewId: "rev-2", reviewUserId: "user-bbb", rating: 4, comment: null, createdAt: "2026-09-10T08:00:00.000Z", guestName: "John Kamau Otieno", booking: { userId: "user-bbb", status: "completed", paymentStatus: "paid" } }),
  row({ reviewId: "rev-3", reviewUserId: "user-ccc", rating: 3, comment: "Call me on 0712 345 678 or amina@example.com", createdAt: "2026-08-01T08:00:00.000Z", guestName: null, booking: { userId: "user-ccc", status: "completed", paymentStatus: "paid" } }),
  // Not eligible: no booking, the provider's own review, an admin, hidden, refunded.
  row({ reviewId: "rev-4", reviewUserId: "user-ddd", booking: null }),
  row({ reviewId: "rev-5", reviewUserId: "provider-1", booking: { userId: "provider-1", status: "completed", paymentStatus: "paid" } }),
  row({ reviewId: "rev-6", reviewUserId: "admin-1", reviewerRole: "admin", booking: { userId: "admin-1", status: "completed", paymentStatus: "paid" } }),
  row({ reviewId: "rev-7", reviewUserId: "user-eee", reviewStatus: "hidden", booking: { userId: "user-eee", status: "completed", paymentStatus: "paid" } }),
  row({ reviewId: "rev-8", reviewUserId: "user-fff", booking: { userId: "user-fff", status: "completed", paymentStatus: "refunded" } }),
];

const source: PublicReviewSource = {
  async getReviewRows(targetType, targetId) {
    return rows.filter((item) => item.targetType === targetType && item.targetId === targetId);
  },
};

test("publicReviewerName shows a first name and a surname initial only", () => {
  assert.equal(publicReviewerName("Amina Wanjiru"), "Amina W.");
  assert.equal(publicReviewerName("John Kamau Otieno"), "John O.");
  assert.equal(publicReviewerName("  amina   wanjiru "), "amina W.");
  assert.equal(publicReviewerName("Amina"), "Amina");
  assert.equal(publicReviewerName(""), "Verified guest");
  assert.equal(publicReviewerName(null), "Verified guest");
  assert.equal(publicReviewerName(undefined), "Verified guest");
  assert.equal(publicReviewerName("Zoë Ñúñez"), "Zoë Ñ.");
});

test("publicReviewerName drops emails, numbers and other non-name text", () => {
  assert.equal(publicReviewerName("amina@example.com"), "amina C.");
  assert.doesNotMatch(publicReviewerName("Amina 0712345678"), /\d/);
  assert.doesNotMatch(publicReviewerName("Amina Wanjiru <amina@example.com>"), /@/);
});

test("toPublicReview returns only the allowlisted fields", () => {
  const output = toPublicReview(rows[0], "Amina Wanjiru");
  assert.deepEqual(Object.keys(output).sort(), [...publicReviewFields].sort());
  assert.deepEqual(output, { rating: 5, comment: "Lovely pool.", createdAt: "2026-09-02T08:00:00.000Z", guestName: "Amina W.", reply: null });
});

test("the public reviews endpoint never returns IDs, full names or contact details", async () => {
  const output = await listPublicReviews(source, "stay", "villa-1");
  const json = JSON.stringify(output);
  for (const leaked of ["rev-", "user-", "provider-1", "admin-1", "villa-1", "Wanjiru", "Kamau", "Otieno", "amina@example.com", "0712 345 678", "updatedAt", "userId", "bookingId", "targetId", "reviewId", "\"id\""]) {
    assert.ok(!json.includes(leaked), `public reviews leaked ${leaked}`);
  }
  for (const review of output) {
    assert.deepEqual(Object.keys(review).sort(), [...publicReviewFields].sort());
  }
  assert.match(output.find((review) => review.rating === 3)!.comment!, /\[contact details removed\]/);
});

test("only eligible reviews are shown, newest first", async () => {
  const output = await listPublicReviews(source, "stay", "villa-1");
  assert.deepEqual(output.map((review) => review.guestName), ["John O.", "Amina W.", "Verified guest"]);
  assert.equal(output[0].comment, null);
});

test("a provider reply is public only once TBM has approved it", () => {
  const pending = toPublicReviewList([row({ providerReply: "Asante!", providerReplyStatus: "pending" })]);
  assert.equal(pending[0].reply, null);
  const approved = toPublicReviewList([row({ providerReply: "Asante! Call 0712345678", providerReplyStatus: "approved", providerReplyAt: "2026-09-03T08:00:00.000Z" })]);
  assert.deepEqual(approved[0].reply, { text: "Asante! Call [contact details removed]", createdAt: "2026-09-03T08:00:00.000Z" });
});

test("ratings count eligible reviews only, from three, to one decimal place", () => {
  const summaries = summarizeRows(rows);
  assert.deepEqual(summaries.get("stay:villa-1"), { count: 3, average: 4 });
  assert.deepEqual(publicRatingFields(summaries.get("stay:villa-1")), { rating: 4, reviewCount: 3 });
  const two = summarizeRows(rows.slice(0, 2));
  assert.deepEqual(publicRatingFields(two.get("stay:villa-1")), { rating: 0, reviewCount: 2 });
  assert.deepEqual(publicRatingFields(undefined), { rating: 0, reviewCount: 0 });
  const many = summarizeRows([5, 5, 4, 5, 4].map((rating, index) => row({ reviewId: `r${index}`, reviewUserId: `u${index}`, rating, booking: { userId: `u${index}`, status: "completed", paymentStatus: "paid" } })));
  assert.deepEqual(many.get("stay:villa-1"), { count: 5, average: 4.6 });
});

test("only known listing kinds are accepted", () => {
  for (const kind of ["stay", "car", "cook", "errand", "experience"]) assert.ok(isPublicReviewTarget(kind));
  for (const kind of ["user", "booking", "", "stays", "__proto__"]) assert.ok(!isPublicReviewTarget(kind));
});
