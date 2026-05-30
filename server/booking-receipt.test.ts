import assert from "node:assert/strict";
import test from "node:test";
import type { Booking } from "../shared/schema.ts";
import {
  buildBookingReceiptHtml,
  getReceiptDownloadFilename,
} from "./booking-receipt.ts";

function createBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "booking-12345678",
    bookingType: "accommodation",
    serviceMode: null,
    accommodationId: "stay-1",
    selectedServices: [],
    guestName: "Jane <Guest>",
    guestEmail: "guest@example.com",
    guestPhone: "+254700000000",
    checkIn: "2026-05-05",
    checkOut: "2026-05-07",
    guests: 2,
    totalPrice: 800,
    paymentStatus: "pending",
    paymentProvider: "paystack",
    paymentReference: "PAY-&-12345",
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

test("buildBookingReceiptHtml renders paid booking details safely", () => {
  const html = buildBookingReceiptHtml(createBooking());

  assert.match(html, /Payment Receipt/);
  assert.match(html, /BOOKING-/);
  assert.match(html, /Jane &lt;Guest&gt;/);
  assert.match(html, /PAY-&amp;-12345/);
  assert.match(html, /USD 400/);
  assert.match(html, /Balance remaining: USD 400/);
});

test("getReceiptDownloadFilename uses the short booking reference", () => {
  assert.equal(
    getReceiptDownloadFilename("550e8400-e29b-41d4-a716-446655440000"),
    "tembea-bila-matata-receipt-550E8400.html",
  );
});
