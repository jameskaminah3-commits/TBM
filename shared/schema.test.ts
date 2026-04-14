import assert from "node:assert/strict";
import test from "node:test";
import { publicBookingRequestSchema, resendVerificationSchema, verifyEmailSchema } from "./schema.ts";

test("verifyEmailSchema accepts a valid verification payload", () => {
  const payload = verifyEmailSchema.parse({
    email: "jane@example.com",
    otp: "123456",
  });

  assert.deepEqual(payload, {
    email: "jane@example.com",
    otp: "123456",
  });
});

test("verifyEmailSchema rejects invalid OTP lengths", () => {
  assert.throws(() => verifyEmailSchema.parse({
    email: "jane@example.com",
    otp: "12345",
  }));
});

test("resendVerificationSchema requires a valid email", () => {
  assert.throws(() => resendVerificationSchema.parse({ email: "not-an-email" }));
});

test("publicBookingRequestSchema strips lifecycle and payment fields from client input", () => {
  const payload = publicBookingRequestSchema.parse({
    accommodationId: "stay-123",
    guestName: "Jane Doe",
    guestPhone: "+254700000000",
    checkIn: "2026-05-01",
    checkOut: "2026-05-03",
    guests: 2,
    selectedServices: [],
    serviceAddonSelections: [],
    stayServiceSelections: [],
    status: "completed",
    bookingType: "service",
    totalPrice: 999999,
    paymentAmount: 999999,
    providerStatusRequest: "completed",
  });

  assert.equal("status" in payload, false);
  assert.equal("bookingType" in payload, false);
  assert.equal("totalPrice" in payload, false);
  assert.equal("paymentAmount" in payload, false);
  assert.equal("providerStatusRequest" in payload, false);
  assert.equal(payload.accommodationId, "stay-123");
  assert.equal(payload.guestName, "Jane Doe");
});
