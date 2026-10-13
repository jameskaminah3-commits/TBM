import assert from "node:assert/strict";
import test from "node:test";
import { REVIEW_REPLY_MAX, canEditReviewReply, cleanReviewReply } from "./review-replies.ts";

test("a reply loses phone numbers, emails, links and handles", () => {
  assert.equal(
    cleanReviewReply("  Asante Amina!  Next time WhatsApp me on 0712 345 678, amina@example.com, https://wa.me/254712345678 or @mwinyi_stays "),
    "Asante Amina! Next time WhatsApp me on [contact details removed], [contact details removed], [contact details removed] or [contact details removed]",
  );
});

test("an empty reply is nothing; a long one is cut to 500 characters", () => {
  assert.equal(cleanReviewReply("   "), null);
  assert.equal(cleanReviewReply(42), null);
  assert.equal(cleanReviewReply("a".repeat(900))!.length, REVIEW_REPLY_MAX);
  assert.equal(cleanReviewReply("Asante!\r\n\r\n\r\n\r\nKaribu tena."), "Asante!\n\nKaribu tena.");
});

test("the provider can change a reply until TBM approves it", () => {
  assert.ok(canEditReviewReply(null));
  assert.ok(canEditReviewReply("pending"));
  assert.ok(canEditReviewReply("rejected"));
  assert.ok(!canEditReviewReply("approved"));
});
