import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTACT_REMOVED,
  getProviderPaymentStage,
  removeContactDetails,
  toProviderAssignment,
  toProviderBooking,
  toProviderPaymentData,
} from "./provider-booking-view.ts";

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
  serviceRequestDetails: "Gluten-free menu please. Call me on 0712 345 678 or jane@example.com if anything changes.",
  serviceResponseMessage: "TBM: we'll send two menu options by Friday.",
  stayServiceSelections: [{ serviceId: "cook-1", category: "cooks", serviceRequestDetails: "WhatsApp +254 712-345-678" }],
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
  assert.equal(view.checkIn, "2026-11-20");
  assert.equal(view.serviceLocation, "Galu Beach, Diani");
  assert.equal(view.paymentStage, "paid");
});

test("a provider never sees the guest's email, payment details, totals or TBM's notes", () => {
  const view = toProviderBooking(booking) as Record<string, unknown>;
  for (const field of ["guestPhone", "guestEmail", "userId", "serviceResponseMessage", "paymentStatus", "paymentProvider", "paymentReference", "paymentAmount", "paymentAmountPaid", "totalPrice", "adminLockNote", "providerStatusRequestNote", "customMenuReviewedByUserId"]) {
    assert.equal(field in view, false, `${field} should be hidden`);
  }
});

test("payment stage: paid, deposit paid, or unpaid", () => {
  assert.equal(getProviderPaymentStage({ paymentStatus: "paid" }), "paid");
  assert.equal(getProviderPaymentStage({ paymentStatus: "pending", paymentAmountPaid: 320 }), "deposit-paid");
  assert.equal(getProviderPaymentStage({ paymentStatus: "pending", paymentAmountPaid: 0 }), "unpaid");
  assert.equal(getProviderPaymentStage({}), "paid", "older bookings without payment fields were paid");
});

test("contact details a guest types into a request are removed before a provider reads it", () => {
  const view = toProviderBooking(booking);
  assert.equal(view.serviceRequestDetails, `Gluten-free menu please. Call me on ${CONTACT_REMOVED} or ${CONTACT_REMOVED} if anything changes.`);
  assert.deepEqual((view.stayServiceSelections as Array<{ serviceRequestDetails: string }>)[0].serviceRequestDetails, `WhatsApp ${CONTACT_REMOVED}`);
  assert.doesNotMatch(JSON.stringify(view), /0712|712-345|jane@example\.com/);
});

test("dates, times, amounts and short numbers in a request are kept", () => {
  const text = "Arriving 2026-11-20 at 14:30, 4 guests, budget KSh 25,000, gate code 4471, room 12.";
  assert.equal(removeContactDetails(text), text);
  assert.equal(removeContactDetails("wa.me/254712345678"), `wa.me/${CONTACT_REMOVED}`);
  assert.equal(removeContactDetails(null), null);
});

test("a provider's job leaves out the guest's price and contact details in the request", () => {
  const job = toProviderAssignment({
    id: "a-1",
    bookingId: "b-1",
    grossAmount: 640,
    serviceConfig: { serviceId: "cook-1", serviceRequestDetails: "My number is 0712345678" },
  }) as Record<string, unknown>;
  assert.equal("grossAmount" in job, false);
  assert.equal((job.serviceConfig as { serviceRequestDetails: string }).serviceRequestDetails, `My number is ${CONTACT_REMOVED}`);
});

test("a provider's payout statement shows their payouts, not the guest's price, TBM's fee amount or notes", () => {
  const data = toProviderPaymentData({
    totalGrossTracked: 1000,
    totalCommissionRetained: 150,
    totalProjectedPayouts: 850,
    totalPendingPayouts: 850,
    totalApprovedPayouts: 0,
    totalPaidOut: 0,
    unpaidPayoutCount: 1,
    paidPayoutCount: 0,
    serviceFeePercents: [15],
    payouts: [{
      id: "p-1", assignmentId: "a-1", bookingId: "b-1", providerUserId: "kassim-1", providerName: "Kassim", providerEmail: "kassim@example.com",
      providerCategory: "cooks", serviceId: "cook-1", serviceName: "Chef Amina", guestName: "Jane Test",
      grossAmount: 1000, commissionPercent: 15, commissionAmount: 150, payoutAmount: 850, status: "pending",
      dueAt: null, paidAt: null, paymentMethod: null, paymentReference: null, notes: "Guest disputed the bill",
      createdAt: "2026-10-01", updatedAt: "2026-10-01", marketingAttribution: { source: "instagram" },
    }],
  } as Parameters<typeof toProviderPaymentData>[0]) as Record<string, unknown>;
  assert.equal("totalGrossTracked" in data, false);
  assert.equal("totalCommissionRetained" in data, false);
  assert.equal(data.totalProjectedPayouts, 850);
  const [payout] = data.payouts as Array<Record<string, unknown>>;
  assert.equal(payout.payoutAmount, 850);
  assert.equal(payout.commissionPercent, 15);
  for (const field of ["grossAmount", "commissionAmount", "guestName", "notes", "providerEmail", "providerName", "marketingAttribution", "providerUserId"]) {
    assert.equal(field in payout, false, `${field} should be hidden`);
  }
});
