import { test } from "node:test";
import assert from "node:assert/strict";
import { isPayoutRateAgreed, payoutStatusNeedsAgreedRate } from "./payout-rate.ts";

test("a payout counts once a rate is recorded, and paid payouts are final", () => {
  assert.equal(isPayoutRateAgreed("pending", false), false);
  assert.equal(isPayoutRateAgreed("approved", false), false);
  assert.equal(isPayoutRateAgreed("pending", true), true);
  assert.equal(isPayoutRateAgreed("paid", false), true);
});

test("approving or paying needs a recorded rate; other changes don't", () => {
  assert.equal(payoutStatusNeedsAgreedRate("approved", "pending", false), true);
  assert.equal(payoutStatusNeedsAgreedRate("paid", "pending", false), true);
  assert.equal(payoutStatusNeedsAgreedRate("paid", "approved", false), true);
  assert.equal(payoutStatusNeedsAgreedRate("approved", "pending", true), false);
  assert.equal(payoutStatusNeedsAgreedRate("cancelled", "pending", false), false);
  assert.equal(payoutStatusNeedsAgreedRate("pending", "approved", false), false);
  assert.equal(payoutStatusNeedsAgreedRate(undefined, "pending", false), false);
  // Saving a note on a payout already paid before this rule isn't blocked.
  assert.equal(payoutStatusNeedsAgreedRate("paid", "paid", false), false);
});
