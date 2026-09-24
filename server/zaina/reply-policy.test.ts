import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMissingCustomerLink,
  buildPaymentSection,
  composeCustomerReply,
  paymentDetailsFromToolResult,
  paymentRecoveryMessage,
  replaceMediaUrls,
  stripMarkdownEmphasis,
} from "./reply-policy.ts";

const BOOKING_URL = "https://tembeabilamatata.com/bookings?bookingId=b-123";

const bookingPayment = paymentDetailsFromToolResult("create_service_booking", {
  ok: true,
  booking_id: "b-123",
  payment_link: BOOKING_URL,
  total: "KSh 14,040",
  deposit_display: "KSh 7,020",
})!;

test("payment details are taken only from successful payable tool results", () => {
  assert.deepEqual(bookingPayment, {
    kind: "booking",
    url: BOOKING_URL,
    bookingId: "b-123",
    depositDisplay: "KSh 7,020",
    feeDisplay: undefined,
  });
  assert.equal(paymentDetailsFromToolResult("create_service_booking", { ok: false, error: "service_not_available" }), null);
  assert.equal(paymentDetailsFromToolResult("search_stays", { ok: true, payment_link: BOOKING_URL }), null);
  assert.equal(
    paymentDetailsFromToolResult("create_listing_verification_request", { ok: true, payment_link: BOOKING_URL, fee_display: "KSh 2,500" })?.kind,
    "listing_verification",
  );
});

test("the booking section carries the exact link, the deposit, and neutral sign-in steps", () => {
  const section = buildPaymentSection(bookingPayment);
  assert.match(section, /^You can pay your 50% deposit of KSh 7,020 securely here:\nhttps:\/\/tembeabilamatata\.com\/bookings\?bookingId=b-123\n/);
  assert.match(section, /What happens next:/);
  assert.match(section, /Sign in, or create an account using the same email you gave for this booking/);
  assert.match(section, /address bar starts with tembeabilamatata\.com/);
  assert.doesNotMatch(section, /already have an account|returning/i);
});

test("a booking without a separate deposit asks for the payment, not a deposit", () => {
  const section = buildPaymentSection({ kind: "booking", url: BOOKING_URL });
  assert.match(section, /^You can complete your payment securely here:/);
  assert.doesNotMatch(section, /deposit/);
});

test("custom requests and verifications explain their own fee terms", () => {
  const request = buildPaymentSection({ kind: "custom_request", url: BOOKING_URL, feeDisplay: "KSh 650" });
  assert.match(request, /pay the request fee of KSh 650 here/);
  assert.match(request, /credited in full against your final quotation/);
  assert.match(request, /Nothing is confirmed until you accept and pay that quotation/);

  const verification = buildPaymentSection({ kind: "listing_verification", url: BOOKING_URL, feeDisplay: "KSh 2,500" });
  assert.match(verification, /pay the verification fee of KSh 2,500 here/);
  assert.match(verification, /dispatched only after the payment clears/);
  assert.match(verification, /verified outcome or a warning flag/);
});

test("the model's own link copies and payment steps are replaced by exactly one server section", () => {
  const modelText = [
    "**Booked!** Your Toyota Noah is reserved for 10–12 October. Total: KSh 14,040.",
    "Pay here: /bookings?bookingId=b-123",
    `Or here: [Pay now](${BOOKING_URL})`,
    "",
    "What happens next:",
    "• Log in and pay a 30% deposit.",
  ].join("\n");

  const reply = composeCustomerReply(modelText, [bookingPayment]);
  assert.ok(reply.startsWith("Booked! Your Toyota Noah is reserved for 10–12 October. Total: KSh 14,040.\n\nYou can pay your 50% deposit"));
  assert.equal(reply.split(BOOKING_URL).length - 1, 1, "link appears exactly once");
  assert.equal((reply.match(/What happens next/g) || []).length, 1);
  assert.doesNotMatch(reply, /30%|Pay here:|Or here:|\[Pay now\]/);
});

test("a sentence that mentions the link keeps its words", () => {
  const reply = composeCustomerReply(`All set — your booking ${BOOKING_URL} is waiting for you in My Bookings.`, [bookingPayment]);
  assert.match(reply, /^All set — your booking is waiting for you in My Bookings\./);
});

test("replies without payments are only cleaned of markdown emphasis", () => {
  assert.equal(composeCustomerReply("**Studio** in Diani — __great__ value", []), "Studio in Diani — great value");
  assert.equal(stripMarkdownEmphasis("a ** stray"), "a  stray");
});

test("the same payment link is never appended twice", () => {
  const reply = composeCustomerReply("Done.", [bookingPayment, { ...bookingPayment }]);
  assert.equal(reply.split(BOOKING_URL).length - 1, 1);
});

test("a failed turn still hands over the payment link", () => {
  const message = paymentRecoveryMessage([bookingPayment]);
  assert.match(message, /^Your request was saved/);
  assert.match(message, /bookings\?bookingId=b-123/);
});

test("storage image URLs are replaced without breaking the surrounding markdown", () => {
  const replaced = replaceMediaUrls(
    "[photo](https://abc.supabase.co/storage/v1/object/public/media/a.jpg) ok",
    "https://tembeabilamatata.com/accommodation/x",
  );
  assert.equal(replaced, "[photo](https://tembeabilamatata.com/accommodation/x) ok");
});

test("a missing listing link is still appended as before", () => {
  const reply = appendMissingCustomerLink("Here it is.", [{ kind: "listing", url: "https://tembeabilamatata.com/accommodation/x" }]);
  assert.equal(reply, "Here it is.\n\nView the full listing here:\nhttps://tembeabilamatata.com/accommodation/x");
});
