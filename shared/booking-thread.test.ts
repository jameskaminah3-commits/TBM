import assert from "node:assert/strict";
import test from "node:test";
import { canSeeThreadMessage, getThreadSenderLabel, isPaymentThreadMessage } from "./booking-thread.ts";

const guestMessage = { userId: "jane-1", senderRole: "customer", message: "Is early check-in possible?" };
const adminMessage = { userId: "admin-1", senderRole: "admin", message: "Yes, from noon." };
const partnerMessage = { userId: "provider-1", senderRole: "provider", message: "The villa is ready." };
const paymentMessage = { userId: "jane-1", senderRole: "payment", message: "Customer submitted a temporary manual M-Pesa payment for review.\nM-Pesa code: QSTA136124" };
const olderPaymentMessage = { userId: "jane-1", senderRole: "customer", message: "Customer submitted a temporary manual M-Pesa payment for review." };
const olderAdminPaymentNote = { userId: "admin-1", senderRole: "admin", message: "Admin note: temporary M-Pesa payment confirmed." };

test("payment messages are recognised, including older ones", () => {
  assert.equal(isPaymentThreadMessage(paymentMessage), true);
  assert.equal(isPaymentThreadMessage(olderPaymentMessage), true);
  assert.equal(isPaymentThreadMessage(olderAdminPaymentNote), true);
  assert.equal(isPaymentThreadMessage(guestMessage), false);
  assert.equal(isPaymentThreadMessage(adminMessage), false);
});

test("providers don't see payment messages; the guest and admin do", () => {
  for (const message of [paymentMessage, olderPaymentMessage, olderAdminPaymentNote]) {
    assert.equal(canSeeThreadMessage("provider", message), false);
    assert.equal(canSeeThreadMessage("customer", message), true);
    assert.equal(canSeeThreadMessage("admin", message), true);
  }
  assert.equal(canSeeThreadMessage("provider", guestMessage), true);
});

test("the reader is You; others are named by their part in the booking", () => {
  const partner = { id: "provider-1", role: "provider" };
  assert.equal(getThreadSenderLabel(guestMessage, partner), "Guest");
  assert.equal(getThreadSenderLabel(adminMessage, partner), "TBM team");
  assert.equal(getThreadSenderLabel(partnerMessage, partner), "You");

  const guest = { id: "jane-1", role: "customer" };
  assert.equal(getThreadSenderLabel(guestMessage, guest), "You");
  assert.equal(getThreadSenderLabel(partnerMessage, guest), "Partner");

  const admin = { id: "admin-1", role: "admin" };
  assert.equal(getThreadSenderLabel(guestMessage, admin), "Guest");
  assert.equal(getThreadSenderLabel(adminMessage, admin), "You");
  assert.equal(getThreadSenderLabel(paymentMessage, admin), "Payment update");
});
