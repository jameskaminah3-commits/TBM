import assert from "node:assert/strict";
import test from "node:test";
import type { Booking } from "../shared/schema.ts";
import {
  buildBookingReceiptPdf,
  getReceiptCode,
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

test("buildBookingReceiptPdf renders paid booking details into a PDF", () => {
  const pdf = buildBookingReceiptPdf(createBooking());
  const pdfText = pdf.toString("latin1");

  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.match(pdfText, /Payment Receipt/);
  assert.match(pdfText, /Official payment receipt/);
  assert.match(pdfText, /BOOKING-/);
  assert.match(pdfText, /Jane <Guest>/);
  assert.match(pdfText, /CLIENT CONTACT/);
  assert.match(pdfText, /\+254700000000 \/ guest@example.com/);
  assert.match(pdfText, /TBM-BOOKING-/);
  assert.match(pdfText, /PAY-&-12345/);
  assert.match(pdfText, /USD 400/);
  assert.match(pdfText, /BALANCE REMAINING/);
  assert.match(pdfText, /Thank you/);
});

test("getReceiptCode creates a stable unique receipt code", () => {
  const booking = createBooking();
  assert.equal(getReceiptCode(booking), getReceiptCode(booking));
  assert.match(getReceiptCode(booking), /^TBM-BOOKING-[A-Z0-9]{6}$/);
});

test("getReceiptDownloadFilename uses the short booking reference", () => {
  assert.equal(
    getReceiptDownloadFilename("550e8400-e29b-41d4-a716-446655440000"),
    "tembea-bila-matata-receipt-550E8400.pdf",
  );
});
