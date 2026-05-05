import assert from "node:assert/strict";
import test from "node:test";
import type { Booking } from "../shared/schema.ts";
import { buildBookingPaymentNotificationContent } from "./notifications.ts";

function createBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "booking-12345678",
    bookingType: "accommodation",
    serviceMode: null,
    accommodationId: "stay-1",
    selectedServices: [],
    guestName: "Jane Doe",
    guestEmail: "guest@example.com",
    guestPhone: "+254700000000",
    checkIn: "2026-05-05",
    checkOut: "2026-05-07",
    guests: 2,
    totalPrice: 800,
    paymentStatus: "pending",
    paymentProvider: "paystack",
    paymentReference: "PAY-12345",
    paymentCurrency: "KES",
    paymentAmount: 51600,
    paymentCheckoutAmount: 400,
    paymentDepositAmount: 400,
    paymentAmountPaid: 400,
    paymentHoldExpiresAt: null,
    paidAt: "2026-05-05T09:30:00.000Z",
    paymentFailedAt: null,
    ...overrides,
  } as Booking;
}

test("buildBookingPaymentNotificationContent creates a receipt for deposit payments", () => {
  const email = buildBookingPaymentNotificationContent(createBooking(), {
    previousStatus: "pending",
    previousAmountPaid: 0,
  });

  assert.ok(email);
  assert.match(email.customerSubject, /payment receipt/i);
  assert.match(email.body, /deposit payment/i);
  assert.ok(email.sharedLines.includes("Receipt amount: $400"));
  assert.ok(email.sharedLines.includes("Balance remaining: $400"));
  assert.ok(email.sharedLines.some((line) => line.startsWith("Provider charge: KES")));
});

test("buildBookingPaymentNotificationContent keeps failed updates distinct from receipts", () => {
  const email = buildBookingPaymentNotificationContent(createBooking({
    paymentStatus: "failed",
    paymentAmountPaid: 0,
    paymentAmount: null,
    paymentCurrency: "USD",
    paidAt: null,
  }), {
    previousStatus: "processing",
    previousAmountPaid: 0,
  });

  assert.ok(email);
  assert.match(email.customerSubject, /payment failed/i);
  assert.match(email.body, /failed/i);
  assert.equal(email.sharedLines.some((line) => line.startsWith("Receipt amount:")), false);
});
