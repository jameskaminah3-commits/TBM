// Phase 4 without a database: payment providers' formats and signatures,
// the payment block Zaina's replies carry, and reading what the model sends.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { findRoomType } from "../../src/connectors/hospitality/index.ts";
import type { Offering } from "../../src/db/schema.ts";
import { deriveIdempotencyKey, withServerIdempotencyKey } from "../../src/engine/idempotency.ts";
import { composeCustomerReply, paymentDetailsFromToolResult } from "../../src/engine/reply-policy.ts";
import { darajaPassword, darajaTimestamp, mpesaCode, mpesaPhone, readStkCallback } from "../../src/payments/mpesa.ts";
import { chargeFromWebhook, validWebhookSignature } from "../../src/payments/paystack.ts";
import { amountDue } from "../../src/payments/checkout.ts";
import { PAGE_MESSAGES, renderPayPage } from "../../src/payments/page.ts";
import { holdUntil, stayDates } from "../../src/booking/notices.ts";
import { checkDepositRule, defaultBookingSettings, depositText, onlineWays, paymentMethodsText, paymentOptionsOf, paymentOrderOf, validatePolicyPatch } from "../../src/booking/settings.ts";
import type { PaymentWay } from "../../src/db/schema.ts";

test("Paystack webhooks are believed only with the account's own signature", () => {
  const body = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "zb_1", amount: 585000, currency: "KES", status: "success", id: 42 } }));
  const signature = createHmac("sha512", "sk_test_account_one_000").update(body).digest("hex");
  assert.equal(validWebhookSignature("sk_test_account_one_000", body, signature), true);
  assert.equal(validWebhookSignature("sk_test_account_two_000", body, signature), false);
  assert.equal(validWebhookSignature("sk_test_account_one_000", Buffer.from(body.toString().replace("585000", "1")), signature), false, "a changed amount");
  assert.equal(validWebhookSignature("sk_test_account_one_000", body, undefined), false);
  assert.equal(validWebhookSignature("sk_test_account_one_000", body, "abc"), false);
  assert.deepEqual(chargeFromWebhook(JSON.parse(body.toString())), { status: "success", amountMinor: 585000, currency: "KES", reference: "zb_1", id: "42", channel: null, message: null });
  assert.equal(chargeFromWebhook({ event: "transfer.success", data: {} }), null);
});

test("Daraja's timestamp is Kenya time, its password is base64 of shortcode, passkey and timestamp", () => {
  assert.equal(darajaTimestamp(new Date("2026-09-25T21:05:09Z")), "20260926000509");
  assert.equal(darajaPassword("174379", "passkey", "20260926000509"), Buffer.from("174379passkey20260926000509").toString("base64"));
});

test("phone numbers and M-Pesa codes are read the way customers type them", () => {
  for (const [typed, phone] of [["0712 345 678", "254712345678"], ["+254 712 345 678", "254712345678"], ["254110000111", "254110000111"], ["712345678", "254712345678"]]) {
    assert.equal(mpesaPhone(typed), phone, typed);
  }
  for (const bad of ["0812345678", "12345", "+1 202 555 0100", ""]) assert.equal(mpesaPhone(bad), null, bad);
  assert.equal(mpesaCode(" qk12abc34d "), "QK12ABC34D");
  assert.equal(mpesaCode("QK12 ABC34D"), "QK12ABC34D");
  for (const bad of ["QKABCDEFGH", "1K12ABC34D", "QK12ABC34", "QK12ABC34DE"]) assert.equal(mpesaCode(bad), null, bad);
});

test("Safaricom's callback is read: success with its receipt, or the reason it failed", () => {
  const paid = readStkCallback({ Body: { stkCallback: {
    MerchantRequestID: "m-1", CheckoutRequestID: "ws_CO_1", ResultCode: 0, ResultDesc: "The service request is processed successfully.",
    CallbackMetadata: { Item: [{ Name: "Amount", Value: 16000 }, { Name: "MpesaReceiptNumber", Value: "SJ12345678" }, { Name: "TransactionDate", Value: 20261001120000 }, { Name: "PhoneNumber", Value: 254712000111 }] },
  } } });
  assert.deepEqual(paid, { checkoutRequestId: "ws_CO_1", resultCode: 0, resultDesc: "The service request is processed successfully.", amount: 16000, receipt: "SJ12345678", phone: "254712000111" });
  const cancelled = readStkCallback({ Body: { stkCallback: { CheckoutRequestID: "ws_CO_2", ResultCode: 1032, ResultDesc: "Request cancelled by user" } } });
  assert.deepEqual(cancelled, { checkoutRequestId: "ws_CO_2", resultCode: 1032, resultDesc: "Request cancelled by user", amount: null, receipt: null, phone: null });
  assert.equal(readStkCallback({ hello: "world" }), null);
});

test("what a customer can pay now: the deposit still due, then the balance", () => {
  const booking = { totalMinor: 3_200_000, depositMinor: 1_600_000, paidMinor: 0 };
  assert.equal(amountDue({ ...booking, status: "held" }), 1_600_000);
  assert.equal(amountDue({ ...booking, status: "awaiting_payment", paidMinor: 600_000 }), 1_000_000);
  assert.equal(amountDue({ ...booking, status: "confirmed", paidMinor: 1_600_000 }), 1_600_000);
  assert.equal(amountDue({ ...booking, status: "cancelled" }), 0);
});

test("a room booking's payment block is the server's: the link, deposit, hold and steps, in English or Swahili", () => {
  const result = {
    ok: true, booking_id: "b-1", reference: "K7Q2MPXA", status: "held_for_deposit", payment_link: "https://zaina.example/pay/abcdefghijklmnopqrstuvwx",
    deposit_display: "KSh 5,850", deposit_percent: 30, total_display: "KSh 19,500", hold_until: "5:30 PM on Mon 26 Oct (Kenya time)", pay_by: "card or M-Pesa",
  };
  const details = paymentDetailsFromToolResult("create_booking", result);
  assert.ok(details);
  const english = composeCustomerReply("**Booked!**\nPay here: [Pay now](https://zaina.example/pay/abcdefghijklmnopqrstuvwx)\n\nWhat happens next:\n• Send M-Pesa to 0799111222.", [details]);
  assert.equal(english, [
    "Booked!",
    "",
    "Booking K7Q2MPXA is held for you. Pay the 30% deposit of KSh 5,850 here to confirm it:",
    "https://zaina.example/pay/abcdefghijklmnopqrstuvwx",
    "",
    "What happens next:",
    "• The page shows your booking and its total (KSh 19,500). Pay by card or M-Pesa.",
    "• Once the deposit arrives, your booking is confirmed and you'll get a message here. The rest is paid at the property.",
    "• The rooms are held until 5:30 PM on Mon 26 Oct (Kenya time); after that they may go to someone else.",
    "• Always check the address starts with zaina.example before you pay.",
  ].join("\n"));
  const swahili = composeCustomerReply("Nimekuhifadhia.", [details], "sw");
  assert.match(swahili, /Uhifadhi K7Q2MPXA umeshikiliwa kwa ajili yako\. Lipa amana ya asilimia 30, yaani KSh 5,850, hapa ili kuuthibitisha:/);
  assert.match(swahili, /Lipa kwa kadi au M-Pesa\./);
  assert.equal(paymentDetailsFromToolResult("create_booking", { ok: true, status: "requested", reference: "X" }), null, "a request has nothing to pay");
});

test("a booking retried with the same details reuses its key; different details or chats don't", () => {
  const args = { room_type: "Ocean double", check_in: "2026-10-26", check_out: "2026-10-28", guests: 2, customer_name: "Jane Wanjiru" };
  const first = withServerIdempotencyKey("create_booking", args, "chat-1");
  assert.equal(first.idempotency_key, deriveIdempotencyKey("chat-1", "create_booking", { ...args, room_type: " ocean  DOUBLE " }));
  assert.notEqual(first.idempotency_key, withServerIdempotencyKey("create_booking", { ...args, guests: 3 }, "chat-1").idempotency_key);
  assert.notEqual(first.idempotency_key, withServerIdempotencyKey("create_booking", args, "chat-2").idempotency_key);
});

test("the model names a room type loosely; only an unambiguous name is taken", () => {
  const rooms = [{ name: "Ocean double" }, { name: "Garden double" }, { name: "Family cottage" }] as Offering[];
  assert.equal(findRoomType(rooms, "ocean double")?.name, "Ocean double");
  assert.equal(findRoomType(rooms, "the family cottage please")?.name, "Family cottage", "extra words around one name");
  assert.equal(findRoomType(rooms, "cottage")?.name, "Family cottage");
  assert.equal(findRoomType(rooms, "double"), null, "two doubles: ambiguous");
  assert.equal(findRoomType(rooms, ""), null);
});

test("booking dates and holds read naturally, in the business's time", () => {
  assert.equal(stayDates("2026-10-26", "2026-10-28"), "Mon 26 Oct – Wed 28 Oct 2026");
  assert.equal(stayDates("2026-12-30", "2027-01-02"), "Wed 30 Dec 2026 – Sat 2 Jan 2027");
  assert.equal(holdUntil(new Date("2026-10-26T14:30:00Z"), "Africa/Nairobi"), "5:30 PM on Mon 26 Oct (Kenya time)");
  assert.match(holdUntil(new Date("2026-10-26T14:30:00Z"), "Africa/Nairobi", "sw"), /^saa 17:30, Jumatatu, 26 Okt \(saa za Kenya\)$/);
});

test("the payment page escapes what customers typed, and shows only fixed messages", () => {
  const html = renderPayPage({
    businessName: "Coral <Cove>",
    offeringName: "Ocean \"double\"",
    booking: {
      id: "b", businessId: "coral", reference: "K7Q2MPXA", offeringId: "o", checkIn: "2026-10-26", checkOut: "2026-10-28", units: 1, guests: 2,
      status: "held", holdExpiresAt: new Date(Date.now() + 600_000), customerName: "<script>alert(1)</script>", customerEmail: null, customerPhone: "0712345678",
      customerNotes: null, quote: { lines: [{ label: "2 nights", amount: 1800000, display: "KSh 18,000", kind: "rooms" }], deposit_percent: 30 } as never,
      currency: "KES", totalMinor: 1800000, depositMinor: 540000, paidMinor: 0, payToken: "t".repeat(24), source: "chat", sessionId: null, idempotencyKey: null,
      conflict: null, staffNote: null, decidedBy: null, confirmedAt: null, cancelledAt: null, createdAt: new Date(), updatedAt: new Date(),
    },
    settings: { checkInTime: "14:00", checkOutTime: "10:00", cancellationPolicy: "No refunds <b>ever</b>" },
    options: { paystack: true, mpesaExpress: true, mpesaManual: { type: "paybill", number: "123456", account: null }, payAtVenue: false, order: ["paystack", "mpesa_express", "mpesa_manual", "pay_at_venue"], maxMinor: {} },
    due: 540000,
    pending: null,
    lastFailure: null,
    message: "rooms_gone",
    contactLine: "call or WhatsApp +254 700 000 000",
    timeZone: "Africa/Nairobi",
    now: new Date(),
    host: "zaina.example",
    token: "t".repeat(24),
  });
  assert.ok(!html.includes("<script>"), "no markup from the customer");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("No refunds &lt;b&gt;ever&lt;/b&gt;"));
  assert.ok(html.includes(PAGE_MESSAGES.rooms_gone.text));
  assert.ok(html.includes("Email for your receipt"), "Paystack needs an email the booking doesn't have");
  assert.ok(html.includes("account <strong>K7Q2MPXA</strong>"), "the paybill's account is the booking reference");
  assert.ok(html.includes('value="0712345678"'));
});

test("the payment page offers the business's ways to pay in its order, within its limits", () => {
  const view = (order: PaymentWay[], maxMinor: Partial<Record<PaymentWay, number>>) => renderPayPage({
    businessName: "Coral Cove", offeringName: "Ocean double",
    booking: {
      id: "b", businessId: "coral", reference: "K7Q2MPXA", offeringId: "o", checkIn: "2026-10-26", checkOut: "2026-10-28", units: 1, guests: 2,
      status: "held", holdExpiresAt: new Date(Date.now() + 600_000), customerName: "Jane", customerEmail: "jane@example.com", customerPhone: "0712345678",
      customerNotes: null, quote: { lines: [], deposit_rule: "fixed", deposit_percent: null } as never,
      currency: "KES", totalMinor: 1800000, depositMinor: 500000, paidMinor: 0, payToken: "t".repeat(24), source: "chat", sessionId: null, idempotencyKey: null,
      conflict: null, staffNote: null, decidedBy: null, confirmedAt: null, cancelledAt: null, createdAt: new Date(), updatedAt: new Date(),
    },
    settings: { checkInTime: "14:00", checkOutTime: "10:00", cancellationPolicy: null },
    options: { paystack: true, mpesaExpress: true, mpesaManual: { type: "till", number: "123456", account: null }, payAtVenue: false, order: paymentOrderOf(order), maxMinor },
    due: 500000, pending: null, lastFailure: null, message: null, contactLine: "call us", timeZone: "Africa/Nairobi", now: new Date(), host: "zaina.example", token: "t".repeat(24),
  });
  const mpesaFirst = view(["mpesa_express"], {});
  assert.ok(mpesaFirst.indexOf("Send the M-Pesa prompt") < mpesaFirst.indexOf("by card"), "the business's order");
  assert.match(mpesaFirst, /<th scope="row">Deposit<\/th>/, "a fixed deposit has no percentage");
  const cardFirst = view([], {});
  assert.ok(cardFirst.indexOf("by card") < cardFirst.indexOf("Send the M-Pesa prompt"));
  const limited = view([], { paystack: 100000 });
  assert.ok(!limited.includes("by card"), "over the business's card limit");
  assert.ok(limited.includes("Send the M-Pesa prompt"));
});

test("business rules in words, and the ways to pay within limits", () => {
  const settings = { ...defaultBookingSettings("x"), paystackMode: "own_keys" as const, mpesaExpress: true, mpesaType: "paybill" as const, mpesaShortcode: "123456" };
  assert.match(depositText(settings), /not set by the business/);
  assert.equal(depositText({ ...settings, depositType: "percent", depositPercent: 25 }), "25% to confirm, the rest at the venue");
  assert.equal(depositText({ ...settings, depositType: "fixed", depositFixedMinor: 200000 }), "KSh 2,000 to confirm, the rest at the venue");
  assert.equal(depositText({ ...settings, depositType: "full" }), "paid in full to confirm");
  const options = paymentOptionsOf({ ...settings, paymentOrder: ["mpesa_express"], methodMaxMinor: { mpesa_express: 5_000_00 } });
  assert.deepEqual(onlineWays(options, 1_000_00), ["mpesa_express", "paystack"]);
  assert.deepEqual(onlineWays(options, 10_000_00), ["paystack"]);
  assert.equal(paymentMethodsText(options, 1_000_00), "M-Pesa or card");
  assert.equal(paymentMethodsText({ ...options, paystack: false }, 10_000_00), "");
  assert.equal(checkDepositRule({ depositType: "percent", depositPercent: 0, depositFixedMinor: null }), "a percentage deposit is 1 to 99 (use none or full otherwise)");
  assert.equal(checkDepositRule({ depositType: "fixed", depositPercent: 30, depositFixedMinor: null }), "a fixed deposit needs deposit_fixed_minor");
  const patch = validatePolicyPatch({ deposit_percent: 0, code_check_hours: 6, payment_order: ["mpesa_manual", "paystack"] });
  assert.ok(patch.ok && patch.patch.depositType === "none" && patch.patch.codeCheckHours === 6);
  const bad = validatePolicyPatch({ code_check_hours: 200 });
  assert.ok(!bad.ok && /code_check_hours is 1 to 72/.test(bad.error));
  assert.ok(!validatePolicyPatch({ deposit_type: "not_set" }).ok, "a business can't un-choose");
  assert.ok(!validatePolicyPatch({ payment_order: ["paystack", "paystack"] }).ok);
});
