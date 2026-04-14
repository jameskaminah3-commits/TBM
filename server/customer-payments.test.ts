import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBookingPaymentReference,
  getBookingIdFromPaymentReference,
  getVerifiedPaymentCheckoutAmount,
} from "./customer-payments.ts";

test("booking payment references round-trip the booking id", () => {
  const bookingId = "550e8400-e29b-41d4-a716-446655440000";
  const reference = buildBookingPaymentReference("pesapal", bookingId);

  assert.equal(getBookingIdFromPaymentReference(reference), bookingId);
});

test("getVerifiedPaymentCheckoutAmount uses the verified USD amount for matching active sessions", () => {
  const reference = buildBookingPaymentReference("paystack", "550e8400-e29b-41d4-a716-446655440000");

  const creditedAmount = getVerifiedPaymentCheckoutAmount({
    paymentReference: reference,
    paymentProvider: "paystack",
    paymentCurrency: "USD",
    paymentAmount: 120,
    paymentCheckoutAmount: 120,
  }, {
    provider: "paystack",
    reference,
    currency: "USD",
    amount: 85,
  });

  assert.equal(creditedAmount, 85);
});

test("getVerifiedPaymentCheckoutAmount scales verified KES settlements against the stored checkout amount", () => {
  const reference = buildBookingPaymentReference("pesapal", "550e8400-e29b-41d4-a716-446655440000");

  const creditedAmount = getVerifiedPaymentCheckoutAmount({
    paymentReference: reference,
    paymentProvider: "pesapal",
    paymentCurrency: "KES",
    paymentAmount: 12900,
    paymentCheckoutAmount: 100,
  }, {
    provider: "pesapal",
    reference,
    currency: "KES",
    amount: 6450,
  });

  assert.equal(creditedAmount, 50);
});

test("getVerifiedPaymentCheckoutAmount rejects mismatched references", () => {
  const activeReference = buildBookingPaymentReference("pesapal", "550e8400-e29b-41d4-a716-446655440000");
  const differentReference = buildBookingPaymentReference("pesapal", "123e4567-e89b-12d3-a456-426614174000");

  const creditedAmount = getVerifiedPaymentCheckoutAmount({
    paymentReference: activeReference,
    paymentProvider: "pesapal",
    paymentCurrency: "KES",
    paymentAmount: 12900,
    paymentCheckoutAmount: 100,
  }, {
    provider: "pesapal",
    reference: differentReference,
    currency: "KES",
    amount: 12900,
  });

  assert.equal(creditedAmount, null);
});
