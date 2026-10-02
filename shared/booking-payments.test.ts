import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBookingDepositAmount,
  getBookingCheckoutAmount,
  getRequestFeeKes,
  getRequestFeeKesDue,
  hasActiveAdminLock,
  hasLockedInBookingDeposit,
  resolveAgreedCommitment,
} from "./booking-payments.ts";

const verification = {
  serviceMode: "listing-verification",
  totalPrice: 20,
  paymentStatus: "pending",
  paymentAmountPaid: 0,
  serviceRequestFeeKes: 2500,
};

test("a request fee quoted in KSh is due exactly as quoted", () => {
  assert.equal(getRequestFeeKesDue(verification), 2500);
  assert.equal(getRequestFeeKesDue({ ...verification, serviceMode: "experience-custom-offer", totalPrice: 5, serviceRequestFeeKes: 646 }), 646);
});

test("nothing is due in KSh once paid, after a quote is accepted, or for USD-priced bookings", () => {
  assert.equal(getRequestFeeKesDue({ ...verification, paymentStatus: "paid", paymentAmountPaid: 20 }), null);
  assert.equal(getRequestFeeKesDue({
    ...verification,
    serviceMode: "experience-custom-offer",
    totalPrice: 395,
    experienceCustomOfferClientDecision: "accepted",
  }), null);
  assert.equal(getRequestFeeKesDue({ ...verification, serviceRequestFeeKes: null }), null);
  assert.equal(getRequestFeeKesDue({ ...verification, serviceMode: "accommodation" }), null);
});

test("a paid request fee still reads as quoted", () => {
  const paid = { ...verification, paymentStatus: "paid", paymentAmountPaid: 20 };
  assert.equal(getRequestFeeKes(paid), 2500);
  assert.equal(getRequestFeeKesDue(paid), null);
});

test("dates the team locks by hand stay locked until the moment it chose", () => {
  const now = Date.parse("2026-10-02T09:00:00Z");
  assert.equal(hasActiveAdminLock({ adminLockUntil: "2026-10-05T20:59:00Z" }, now), true);
  assert.equal(hasActiveAdminLock({ adminLockUntil: "2026-10-02T08:59:00Z" }, now), false, "it ends on its own");
  assert.equal(hasActiveAdminLock({ adminLockUntil: null }, now), false);
  assert.equal(hasActiveAdminLock({}, now), false);
  assert.equal(hasActiveAdminLock({ adminLockUntil: "not a date" }, now), false);
});

test("the commitment is 50% unless the team agreed another percentage or amount", () => {
  assert.equal(calculateBookingDepositAmount(186), 93);
  assert.equal(calculateBookingDepositAmount(186, 30), 56, "rounded up to a whole dollar");
  assert.deepEqual(resolveAgreedCommitment(186, { percent: 30 }), { amount: 56 });
  assert.deepEqual(resolveAgreedCommitment(186, { percent: 50 }), { amount: 93 });
  assert.deepEqual(resolveAgreedCommitment(100, { percent: 99.5 }), { error: "The commitment is between 1% and 99% of the total." });
  assert.deepEqual(resolveAgreedCommitment(100, { percent: 99 }), { amount: 99 });
  assert.deepEqual(resolveAgreedCommitment(3, { percent: 99 }), { amount: 2 }, "always less than the total");
  assert.deepEqual(resolveAgreedCommitment(186, { amount: 40 }), { amount: 40 });
});

test("a commitment outside the total, or given both ways or neither, is refused", () => {
  for (const agreed of [{ percent: 0 }, { percent: 100 }, { percent: Number.NaN }, { amount: 0 }, { amount: 186 }, { amount: 200 }, { amount: 12.5 }, { percent: 30, amount: 40 }, {}]) {
    const result = resolveAgreedCommitment(186, agreed);
    assert.ok("error" in result, JSON.stringify(agreed));
  }
  assert.ok("error" in resolveAgreedCommitment(1, { percent: 50 }), "nothing to split");
});

test("an agreed commitment is what the guest pays to lock the dates, and paying it locks them", () => {
  const booking = { totalPrice: 186, paymentStatus: "pending", paymentAmountPaid: 0, paymentDepositAmount: 56, serviceMode: null };
  assert.equal(getBookingCheckoutAmount(booking), 56);
  assert.equal(hasLockedInBookingDeposit(booking), false);
  assert.equal(hasLockedInBookingDeposit({ ...booking, paymentAmountPaid: 56 }), true);
  assert.equal(getBookingCheckoutAmount({ ...booking, paymentAmountPaid: 56 }), 130, "then the balance");
});
