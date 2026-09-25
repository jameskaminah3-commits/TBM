import assert from "node:assert/strict";
import test from "node:test";
import { getRequestFeeKes, getRequestFeeKesDue } from "./booking-payments.ts";

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
