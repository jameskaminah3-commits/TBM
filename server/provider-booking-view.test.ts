import assert from "node:assert/strict";
import test from "node:test";
import { getProviderPaymentStage, toProviderBooking } from "./provider-booking-view.ts";

const booking = {
  id: "b-1",
  status: "upcoming",
  checkIn: "2026-11-20",
  checkOut: "2026-11-24",
  guests: 2,
  guestName: "Jane Test",
  guestPhone: "0712345678",
  guestEmail: "jane@example.com",
  userId: "jane-1",
  serviceLocation: "Galu Beach, Diani",
  paymentStatus: "paid",
  paymentProvider: "mpesa-manual",
  paymentReference: "QSTA136124",
  paymentAmount: 640,
  paymentAmountPaid: 1280,
  totalPrice: 1280,
  adminLockNote: "Held for the owner",
  providerStatusRequestNote: "internal",
  customMenuReviewedByUserId: "admin-1",
};

test("a provider sees who is coming, when, and what to deliver", () => {
  const view = toProviderBooking(booking);
  assert.equal(view.guestName, "Jane Test");
  assert.equal(view.guestPhone, "0712345678");
  assert.equal(view.checkIn, "2026-11-20");
  assert.equal(view.serviceLocation, "Galu Beach, Diani");
  assert.equal(view.paymentStage, "paid");
});

test("a provider never sees the guest's email, payment details, totals or TBM's notes", () => {
  const view = toProviderBooking(booking) as Record<string, unknown>;
  for (const field of ["guestEmail", "userId", "paymentStatus", "paymentProvider", "paymentReference", "paymentAmount", "paymentAmountPaid", "totalPrice", "adminLockNote", "providerStatusRequestNote", "customMenuReviewedByUserId"]) {
    assert.equal(field in view, false, `${field} should be hidden`);
  }
});

test("payment stage: paid, deposit paid, or unpaid", () => {
  assert.equal(getProviderPaymentStage({ paymentStatus: "paid" }), "paid");
  assert.equal(getProviderPaymentStage({ paymentStatus: "pending", paymentAmountPaid: 320 }), "deposit-paid");
  assert.equal(getProviderPaymentStage({ paymentStatus: "pending", paymentAmountPaid: 0 }), "unpaid");
  assert.equal(getProviderPaymentStage({}), "paid", "older bookings without payment fields were paid");
});
