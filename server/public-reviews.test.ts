import assert from "node:assert/strict";
import test from "node:test";
import type { Review } from "../shared/schema.ts";
import { publicReviewFields, publicReviewerName, toPublicReview } from "../shared/public-review.ts";
import { isPublicReviewTarget, listPublicReviews, type PublicReviewSource } from "./public-reviews.ts";

// Stored rows carry everything a leak could expose: IDs, the full guest name,
// the guest's email and phone on the booking.
const rows: Review[] = [
  { id: "rev-1", bookingId: "booking-111", userId: "user-aaa", targetType: "stay", targetId: "villa-1", rating: 5, comment: " Lovely pool. ", createdAt: "2026-09-02T08:00:00.000Z", updatedAt: "2026-09-02T08:00:00.000Z" },
  { id: "rev-2", bookingId: "booking-222", userId: "user-bbb", targetType: "stay", targetId: "villa-1", rating: 4, comment: null, createdAt: "2026-09-10T08:00:00.000Z", updatedAt: "2026-09-10T08:00:00.000Z" },
  { id: "rev-3", bookingId: "booking-missing", userId: "user-ccc", targetType: "stay", targetId: "villa-1", rating: 3, comment: "Fine", createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:00:00.000Z" },
];

const bookings: Record<string, { guestName: string; guestEmail: string; guestPhone: string; userId: string }> = {
  "booking-111": { guestName: "Amina Wanjiru", guestEmail: "amina@example.com", guestPhone: "+254700000001", userId: "user-aaa" },
  "booking-222": { guestName: "John Kamau Otieno", guestEmail: "john@example.com", guestPhone: "+254700000002", userId: "user-bbb" },
};

const source: PublicReviewSource = {
  async getReviewsByTarget(targetType, targetId) {
    return rows.filter((row) => row.targetType === targetType && row.targetId === targetId);
  },
  async getBooking(bookingId) {
    return bookings[bookingId];
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
  assert.deepEqual(output, { rating: 5, comment: "Lovely pool.", createdAt: "2026-09-02T08:00:00.000Z", guestName: "Amina W." });
});

test("the public reviews endpoint never returns IDs, full names or guest contact", async () => {
  const output = await listPublicReviews(source, "stay", "villa-1");
  assert.equal(output.length, 3);
  const json = JSON.stringify(output);
  for (const leaked of ["rev-1", "booking-111", "booking-222", "booking-missing", "user-aaa", "user-bbb", "user-ccc", "villa-1", "Wanjiru", "Kamau", "Otieno", "amina@example.com", "+2547", "updatedAt", "userId", "bookingId", "targetId", "\"id\""]) {
    assert.ok(!json.includes(leaked), `public reviews leaked ${leaked}`);
  }
  for (const review of output) {
    assert.deepEqual(Object.keys(review).sort(), [...publicReviewFields].sort());
  }
});

test("the public reviews endpoint sorts newest first and labels unknown guests", async () => {
  const output = await listPublicReviews(source, "stay", "villa-1");
  assert.deepEqual(output.map((review) => review.guestName), ["John O.", "Amina W.", "Verified guest"]);
  assert.equal(output[0].comment, null);
});

test("only known listing kinds are accepted", () => {
  for (const kind of ["stay", "car", "cook", "errand", "experience"]) assert.ok(isPublicReviewTarget(kind));
  for (const kind of ["user", "booking", "", "stays", "__proto__"]) assert.ok(!isPublicReviewTarget(kind));
});
