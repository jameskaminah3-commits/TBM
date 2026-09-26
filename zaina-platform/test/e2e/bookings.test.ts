// End-to-end, Phase 4: the hospitality pilot, simulated. Three places to stay
// take bookings through Zaina and deposits into their own accounts:
//
//   Coral Cove Guesthouse (Diani)  booked instantly, deposits by card or
//                                  M-Pesa through its own Paystack account;
//                                  customers on its website
//   Lakeview Lodge (Naivasha)      rooms from a spreadsheet, a conservancy fee,
//                                  deposits by M-Pesa Express on its own till;
//                                  customers on WhatsApp
//   Old Town House (Lamu)          booked on request: the team agrees a price;
//                                  the guest pays a till by hand and the team
//                                  checks the M-Pesa code
//
// The platform runs as in production, with stand-ins at the network edge
// (scripted-model.mjs): the model, email, WhatsApp, Paystack and Safaricom's
// Daraja API. Paystack's webhooks are signed as Paystack signs them, and
// Safaricom's callbacks arrive from the stand-in. The plan's exit check
// ("three pilot businesses live for 30 days, with bookings and deposits
// flowing") is then read from the platform's own overview, with the pilot's
// first chats moved 31 days back.

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { addDays, isoDate, parseDate } from "../../src/booking/pricing.ts";
import { businessDay } from "../../src/gateway/spend-cap.ts";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5075;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_SECRET = "meta-app-secret-for-tests-0123456789";
const VERIFY_TOKEN = "verify-token-for-tests-123";
const CORAL_KEY = "sk_test_coralcove0000000001";
const ORIGINS = { coral: "https://coralcove.example", lakeview: "https://lakeview.example", oldtown: "https://oldtown.example" };
const LAKEVIEW_NUMBER_ID = "100200300500";
const KSH = (major: number) => major * 100;

let platform: Platform;
let api: Api;
const tokens: Record<string, string> = {};
const keys: Record<string, string> = {};

/** The first Monday at least `days` from today (Kenya): weekday nights, one price. */
function mondayAfter(days: number): string {
  let date = addDays(parseDate(businessDay("Africa/Nairobi"))!, days);
  while (date.getUTCDay() !== 1) date = addDays(date, 1);
  return isoDate(date);
}
const plus = (date: string, days: number) => isoDate(addDays(parseDate(date)!, days));
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

const staff = (business: string, method: string, route: string, body?: unknown, token = tokens[business]) => api(method, `/v1/staff/businesses/${business}${route}`, body, token);

type Chat = { business: string; token: string; origin: string };

async function openChat(business: keyof typeof ORIGINS): Promise<Chat> {
  const response = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGINS[business] },
    body: JSON.stringify({ business_key: keys[business], display_currency: "KES" }),
  });
  const body = await response.json() as any;
  assert.equal(response.status, 201, JSON.stringify(body));
  return { business, token: body.token, origin: ORIGINS[business] };
}

async function say(chat: Chat, message: string): Promise<string> {
  const response = await fetch(`${BASE}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${chat.token}`, origin: chat.origin },
    body: JSON.stringify({ message }),
  });
  const body = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.reply as string;
}

async function messages(chat: Chat): Promise<Array<{ from: string; text: string }>> {
  const response = await fetch(`${BASE}/v1/chat/messages`, { headers: { authorization: `Bearer ${chat.token}` } });
  return ((await response.json()) as any).messages;
}

const payToken = (reply: string) => /\/pay\/([A-Za-z0-9_-]{24,64})/.exec(reply)?.[1] ?? assert.fail(`no payment link in: ${reply}`);
const booking = async (token: string) => (await platform.db.query("select * from bookings where pay_token = $1", [token])).rows[0];
const paymentsOf = async (bookingId: string) => (await platform.db.query("select * from payments where booking_id = $1 order by created_at", [bookingId])).rows;

async function page(token: string, query = "") {
  const response = await fetch(`${BASE}/pay/${token}${query}`, { redirect: "manual" });
  return { status: response.status, html: await response.text(), headers: response.headers };
}

async function post(path: string, fields: Record<string, string> = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: response.status, location: response.headers.get("location") ?? "" };
}

async function paystackWebhook(path: string, secretKey: string, event: unknown) {
  const raw = JSON.stringify(event);
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": createHmac("sha512", secretKey).update(raw).digest("hex") },
    body: raw,
  });
  return response.status;
}

let messageCounter = 0;
async function whatsapp(from: string, body: string, name = "Otieno Kamau") {
  messageCounter += 1;
  const id = `wamid.in-${messageCounter}-${randomBytes(4).toString("hex")}`;
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ id: "900800700601", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "254700500500", phone_number_id: LAKEVIEW_NUMBER_ID },
      contacts: [{ profile: { name }, wa_id: from }],
      messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
    } }] }],
  };
  const raw = JSON.stringify(payload);
  const response = await fetch(`${BASE}/v1/whatsapp/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}` },
    body: raw,
  });
  assert.equal(response.status, 200);
}
const whatsappTexts = (to: string) => platform.log("whatsapp").filter((entry) => entry.to === to && entry.kind === "text").map((entry) => entry.text as string);

before(async () => {
  platform = await startPlatform({
    port: PORT,
    env: {
      PUBLIC_BASE_URL: BASE,
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      WHATSAPP_BATCH_MS: "0",
      RESEND_API_KEY: "re_scripted",
      ALERT_FROM_EMAIL: "alerts@example.com",
      BOOKING_SWEEP_INTERVAL_MS: "700",
      PAYMENT_CHECK_AFTER_MS: "1500",
    },
  });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = await login("ops@example.com");
  const owners = { coral: ["Coral Cove Guesthouse", "amani@example.com", "Amani Mwangi"], lakeview: ["Lakeview Lodge", "wanjiru@example.com", "Wanjiru Njoroge"], oldtown: ["Old Town House", "fatma@example.com", "Fatma Ali"] } as const;
  for (const [id, [name, email, owner]] of Object.entries(owners)) {
    const created = await api("POST", "/v1/platform/businesses", {
      id, name, business_type: "guesthouse", allowed_origins: [ORIGINS[id as keyof typeof ORIGINS]], owner: { email, name: owner, password: PASSWORD },
    }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    keys[id] = created.body.business.public_key;
    tokens[id] = await login(email);
  }
  tokens.ops = ops;
});

after(async () => {
  await platform?.stop();
});

// ── Coral Cove: instant booking, Paystack on its own account, the website ──

const coralCheckIn = mondayAfter(21);
let coralPay = "";

test("Coral Cove sets up its rooms, its policy and its own Paystack account (Paystack checks the key)", async () => {
  const ocean = await staff("coral", "POST", "/offerings", {
    name: "Ocean double", units: 2, max_guests: 2, description: "Queen bed, sea view, balcony.",
    pricing: { nightly: KSH(9000), weekend_nightly: KSH(11000), fees: [{ name: "Cleaning", amount: KSH(1500), per: "room" }] },
  });
  assert.equal(ocean.status, 201, JSON.stringify(ocean.body));
  assert.equal(ocean.body.offering.from_nightly_display, "KSh 9,000");
  assert.equal((await staff("coral", "POST", "/offerings", { name: "ocean DOUBLE", units: 1, max_guests: 2, pricing: { nightly: KSH(1) } })).status, 409, "names are unique");
  assert.equal((await staff("coral", "POST", "/offerings", { name: "Bad", units: 1, max_guests: 2, pricing: { nightly: KSH(1), surprise: 1 } })).status, 400);
  const before = await staff("coral", "GET", "/booking-settings");
  assert.equal(before.body.deposit_type, "not_set", "Zaina doesn't choose a deposit for the business");
  assert.equal(before.body.rules_confirmed_at, null);
  assert.deepEqual(before.body.bounds.code_check_hours, [1, 72]);
  assert.equal((await staff("coral", "PATCH", "/booking-settings", { deposit_type: "fixed" })).status, 400, "a fixed deposit needs its amount");
  assert.equal((await staff("coral", "PATCH", "/booking-settings", { pay_attempts_limit: 500 })).status, 400, "within the platform's bounds");
  const policy = await staff("coral", "PATCH", "/booking-settings", { deposit_percent: 30, hold_minutes: 30, cancellation_policy: "Free cancellation up to 14 days before arrival." });
  assert.equal(policy.status, 200, JSON.stringify(policy.body));
  assert.equal(policy.body.payments.takes_deposits, false);
  assert.equal(policy.body.deposit_type, "percent");
  assert.ok(policy.body.rules_confirmed_at, "the business chose");

  const refused = await staff("coral", "PUT", "/payments/paystack", { mode: "own_keys", secret_key: "sk_test_refused000000000001" });
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /Paystack didn't accept the key/);
  const connected = await staff("coral", "PUT", "/payments/paystack", { mode: "own_keys", secret_key: CORAL_KEY });
  assert.equal(connected.status, 200, JSON.stringify(connected.body));
  assert.deepEqual(connected.body.payments.paystack, { mode: "own_keys", subaccount: null, key_saved: true });
  assert.equal(connected.body.payments.takes_deposits, true);
  assert.equal(connected.body.webhooks.paystack, `${BASE}/v1/payments/paystack/coral`);
  const secrets = await staff("coral", "GET", "/secrets");
  assert.ok(secrets.body.secrets.some((secret: any) => secret.name === "paystack_secret_key"), "kept as an encrypted secret");
  assert.ok(!JSON.stringify(secrets.body).includes(CORAL_KEY), "never shown again");
  // Only the owner connects payment accounts.
  assert.equal((await staff("coral", "POST", "/members", { email: "baraka@example.com", name: "Baraka Otieno", password: PASSWORD, role: "manager" })).status, 201);
  const manager = await login("baraka@example.com");
  assert.equal((await staff("coral", "PUT", "/payments/paystack", { mode: "own_keys", secret_key: CORAL_KEY }, manager)).status, 403);
});

test("a website customer asks, gets the exact price, books, and is held a room for the deposit", async () => {
  const chat = await openChat("coral");
  await say(chat, "Hi! Do you have a room for two?");
  await say(chat, raw64("check_availability", { check_in: coralCheckIn, check_out: plus(coralCheckIn, 2), guests: 2 }));
  const { rows: [checked] } = await platform.db.query("select tool_response from chat_events where tool_name = 'check_availability' order by id desc limit 1");
  assert.deepEqual(checked.tool_response.results[0], {
    room_type: "Ocean double", available: true, rooms_left: 2, nights: 2, total: "KSh 19,500",
    price_lines: ["2 nights (KSh 9,000 a night): KSh 18,000", "Cleaning: KSh 1,500"], deposit: "KSh 5,850", booked: "online",
  });

  // Details the customer didn't type are refused.
  const refused = await say(chat, raw64("create_booking", { room_type: "Ocean double", check_in: coralCheckIn, check_out: plus(coralCheckIn, 2), guests: 2, customer_name: "Guest", customer_email: "guest@example.com" }));
  assert.match(refused, /may I have your name, and a phone number or email/);

  await say(chat, "I'm Jane Wanjiru, jane@example.com, 0712345678");
  const args = { room_type: "ocean double", check_in: coralCheckIn, check_out: plus(coralCheckIn, 2), guests: 2, customer_name: "Jane Wanjiru", customer_email: "jane@example.com", customer_phone: "0712345678" };
  const reply = await say(chat, raw64("create_booking", args));
  const reference = /Booking ([A-Z0-9]{8}) is held for you/.exec(reply)?.[1] ?? assert.fail(reply);
  assert.match(reply, /Pay the 30% deposit of KSh 5,850 here to confirm it:/);
  assert.match(reply, /The page shows your booking and its total \(KSh 19,500\)\. Pay by card or M-Pesa\./);
  assert.match(reply, /The rooms are held until .+ \(Kenya time\)/);
  assert.equal(reply.match(/What happens next:/g)?.length, 1, "one set of steps, the server's");
  assert.doesNotMatch(reply, /0799111222|\/bookings\?bookingId|\*\*/, "the model's own payment steps are gone");
  coralPay = payToken(reply);

  const held = await booking(coralPay);
  assert.equal(held.reference, reference);
  assert.equal(held.status, "held");
  assert.equal(held.customer_phone, "0712345678");
  // The same call again (a retried turn) gets the same booking.
  const again = await say(chat, raw64("create_booking", args));
  assert.equal(payToken(again), coralPay);
  assert.equal((await platform.db.query("select count(*)::int as n from bookings where business_id = 'coral'")).rows[0].n, 1);
});

test("the payment page shows the booking, and hands the deposit to Paystack for the business's own account", async () => {
  const shown = await page(coralPay);
  assert.equal(shown.status, 200);
  assert.match(shown.headers.get("content-security-policy") ?? "", /default-src 'none'.*form-action 'self' https:\/\/checkout\.paystack\.com/);
  assert.equal(shown.headers.get("cache-control"), "no-store");
  for (const text of ["Coral Cove Guesthouse", "Ocean double", "KSh 19,500", "Pay the deposit: KSh 5,850", "Pay KSh 5,850 by card or M-Pesa", "Free cancellation up to 14 days before arrival.", "Your rooms are held until"]) {
    assert.ok(shown.html.includes(text), `page shows "${text}"`);
  }
  assert.doesNotMatch(shown.html, /<script/i, "no scripts on the page");
  assert.equal((await page("not-a-real-token-at-all-0000000")).status, 404);

  const started = await post(`/pay/${coralPay}/paystack`);
  assert.equal(started.status, 303);
  const reference = /^https:\/\/checkout\.paystack\.com\/fake_(zb_[0-9a-f]{24})$/.exec(started.location)?.[1] ?? assert.fail(started.location);
  const initialized = platform.log("paystack").find((entry) => entry.kind === "initialize" && entry.reference === reference);
  assert.deepEqual({ ...initialized, at: undefined, callback: undefined }, {
    at: undefined, callback: undefined, kind: "initialize", reference, amount: KSH(5850), currency: "KES", email: "jane@example.com",
    channels: ["card", "mobile_money"], subaccount: null, key: CORAL_KEY.slice(0, 16),
  });
  assert.equal(initialized.callback, `${BASE}/pay/${coralPay}/done`);

  // A webhook that isn't Paystack's changes nothing.
  const event = { event: "charge.success", data: { id: 777, status: "success", reference, amount: KSH(5850), currency: "KES", gateway_response: "Successful" } };
  assert.equal(await paystackWebhook("/v1/payments/paystack/coral", "sk_test_somebodyelse00000001", event), 401);
  assert.equal((await booking(coralPay)).status, "held");

  platform.payOnPaystack(reference);
  assert.equal(await paystackWebhook("/v1/payments/paystack/coral", CORAL_KEY, event), 200);
  const confirmed = await eventually(async () => {
    const row = await booking(coralPay);
    return row.status === "confirmed" ? row : null;
  }, "the booking is confirmed by Paystack's webhook");
  assert.equal(Number(confirmed.paid_minor), KSH(5850));
  const [paid] = await paymentsOf(confirmed.id);
  assert.deepEqual([paid.method, paid.status], ["paystack", "succeeded"]);
  assert.ok(paid.receipt, "Paystack's transaction id is kept");
  // The same webhook again (Paystack retries) changes nothing.
  assert.equal(await paystackWebhook("/v1/payments/paystack/coral", CORAL_KEY, event), 200);
  assert.equal(Number((await booking(coralPay)).paid_minor), KSH(5850));
});

test("the guest hears it's confirmed in the chat and by email; the team is told", async () => {
  const row = await booking(coralPay);
  const chatToken = await platform.db.query("select session_id from bookings where id = $1", [row.id]);
  assert.ok(chatToken.rows[0].session_id);
  const guestEmail = await eventually(() => platform.log("emails").find((email) => email.subject === `Booking confirmed: ${row.reference} at Coral Cove Guesthouse`), "the guest's confirmation email");
  assert.match(guestEmail.text, /Paid: KSh 5,850\. The balance of KSh 13,650 is paid at the property\. Check-in from 14:00, check-out by 10:00\./);
  await eventually(() => platform.log("emails").find((email) => /\[Coral Cove Guesthouse\] New booking confirmed/.test(email.subject) && email.text.includes(row.reference)), "the team's alert");
  const page2 = await page(coralPay);
  assert.ok(page2.html.includes("Your booking is confirmed."));
  assert.ok(!page2.html.includes("Pay the deposit"), "nothing more to pay online for the deposit");
});

test("a booking the team made is paid through the link, and confirmed when the guest comes back from Paystack", async () => {
  const [room] = (await staff("coral", "GET", "/offerings")).body.offerings;
  const made = await staff("coral", "POST", "/bookings", {
    offering_id: room.id, check_in: plus(coralCheckIn, 7), check_out: plus(coralCheckIn, 9), guests: 2, rooms: 1,
    customer_name: "Peter Kariuki", customer_email: "peter@example.com",
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.booking.status, "awaiting_payment");
  const token = /\/pay\/(.+)$/.exec(made.body.booking.pay_link)![1];
  const started = await post(`/pay/${token}/paystack`);
  const reference = /fake_(zb_[0-9a-f]{24})$/.exec(started.location)![1];
  platform.payOnPaystack(reference);
  const back = await fetch(`${BASE}/pay/${token}/done?reference=${reference}&trxref=${reference}`, { redirect: "manual" });
  assert.equal(back.status, 303);
  assert.equal(back.headers.get("location"), `/pay/${token}?returned=1`);
  assert.equal((await booking(token)).status, "confirmed", "no webhook needed: Paystack was asked");
});

// ── Lakeview: a spreadsheet, a conservancy fee, M-Pesa Express, WhatsApp ──

const lakeviewCheckIn = mondayAfter(30);
const guestNumber = "254712000111";
let lakeviewPay = "";

test("Lakeview imports its rooms from a spreadsheet and connects M-Pesa Express on its own till (Safaricom checks the keys)", async () => {
  const imported = await staff("lakeview", "POST", "/offerings/import", {
    csv: "name,units,max_guests,nightly,min_nights,booking_mode,description\nLake view tent,3,2,\"14,000\",2,instant,\"Tent with a deck over the lake\"\nFamily banda,1,5,22000,2,request,Two rooms and a fireplace\n",
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.deepEqual(imported.body, { created: 2, updated: 0 });
  const { offerings } = (await staff("lakeview", "GET", "/offerings")).body;
  const tent = offerings.find((offering: any) => offering.name === "Lake view tent");
  const updated = await staff("lakeview", "PUT", `/offerings/${tent.id}`, { pricing: { ...tent.pricing, fees: [{ name: "Conservancy fee", amount: KSH(1000), per: "guest_night" }], deposit_percent: 50 } });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));

  const account = { environment: "sandbox", type: "till", shortcode: "174379", till: "600100", consumer_key: "pilot-consumer-key", consumer_secret: "wrong-secret", passkey: "pilot-passkey" };
  const refused = await staff("lakeview", "PUT", "/payments/mpesa-express", account);
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /M-Pesa didn't accept the keys: Invalid Authentication passed/);
  const connected = await staff("lakeview", "PUT", "/payments/mpesa-express", { ...account, consumer_secret: "pilot-consumer-secret" });
  assert.equal(connected.status, 200, JSON.stringify(connected.body));
  assert.deepEqual(connected.body.payments.mpesa_express, { on: true, environment: "sandbox", type: "till", shortcode: "174379", till: "600100", keys_saved: true });

  const number = await staff("lakeview", "PUT", "/whatsapp", { phone_number_id: LAKEVIEW_NUMBER_ID, waba_id: "900800700601", access_token: "EAAG-test-token-0000000000" });
  assert.equal(number.status, 200, JSON.stringify(number.body));
});

test("a WhatsApp customer books a tent; the fee is per guest per night, and their WhatsApp number is their contact", async () => {
  await whatsapp(guestNumber, "Hi, I'm Otieno Kamau. Do you have a tent for two?");
  await eventually(() => whatsappTexts(guestNumber).length >= 1, "Zaina answers on WhatsApp");
  await whatsapp(guestNumber, raw64("create_booking", {
    room_type: "Lake view tent", check_in: lakeviewCheckIn, check_out: plus(lakeviewCheckIn, 2), guests: 2,
    customer_name: "Otieno Kamau", customer_phone: guestNumber,
  }));
  const reply = await eventually(() => whatsappTexts(guestNumber).find((text) => text.includes("is held for you")), "the booking reply on WhatsApp");
  assert.match(reply, /Pay the 50% deposit of KSh 16,000 here to confirm it:/, "(2 nights × 14,000) + (2 guests × 2 nights × 1,000) = 32,000; half is 16,000");
  lakeviewPay = payToken(reply);
  const held = await booking(lakeviewPay);
  assert.equal(held.customer_phone, guestNumber);
  assert.equal(held.customer_email, null);
});

test("the guest pays with an M-Pesa prompt on their phone; Safaricom's callback, checked with Safaricom, confirms the booking on WhatsApp", async () => {
  const shown = await page(lakeviewPay);
  assert.ok(shown.html.includes(`value="${guestNumber}"`), "the phone is filled in");
  assert.ok(shown.html.includes("Send the M-Pesa prompt for KSh 16,000"));
  const sent = await post(`/pay/${lakeviewPay}/mpesa`, { phone: "0712 000 111" });
  assert.deepEqual(sent, { status: 303, location: `/pay/${lakeviewPay}?m=sent` });
  const stk = await eventually(() => platform.log("mpesa").find((entry) => entry.kind === "stk" && entry.phone === guestNumber), "the prompt");
  assert.deepEqual({ amount: stk.amount, shortcode: stk.shortcode, partyB: stk.partyB, type: stk.type }, { amount: 16000, shortcode: "174379", partyB: "600100", type: "CustomerBuyGoodsOnline" });
  const waiting = await page(lakeviewPay, "?m=sent");
  assert.ok(waiting.html.includes("Check your phone.") || waiting.html.includes("Your booking is confirmed."));

  const confirmed = await eventually(async () => {
    const row = await booking(lakeviewPay);
    return row.status === "confirmed" ? row : null;
  }, "the booking is confirmed after Safaricom's callback");
  const [payment] = await paymentsOf(confirmed.id);
  assert.equal(payment.method, "mpesa_express");
  assert.match(payment.receipt, /^SJ\d{8}$/);
  assert.ok(platform.log("mpesa").some((entry) => entry.kind === "query" && entry.checkoutRequestId === payment.provider_reference), "the callback was checked with Safaricom");
  await eventually(() => whatsappTexts(guestNumber).find((text) => text.includes(`your booking ${confirmed.reference} at Lakeview Lodge is confirmed`)), "the confirmation on WhatsApp");
});

test("a prompt the guest cancels fails cleanly; one whose callback never comes is found by asking; prompts are limited", async () => {
  const [tent] = (await staff("lakeview", "GET", "/offerings")).body.offerings.filter((offering: any) => offering.name === "Lake view tent");
  const make = async (phone: string, offset: number) => {
    const made = await staff("lakeview", "POST", "/bookings", { offering_id: tent.id, check_in: plus(lakeviewCheckIn, offset), check_out: plus(lakeviewCheckIn, offset + 2), guests: 2, customer_name: "Achieng Odhiambo", customer_phone: phone });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    return /\/pay\/(.+)$/.exec(made.body.booking.pay_link)![1];
  };
  const cancelled = await make("0700000032", 10);
  await post(`/pay/${cancelled}/mpesa`, { phone: "0700000032" });
  const failedPayment = await eventually(async () => (await paymentsOf((await booking(cancelled)).id)).find((payment) => payment.status === "failed"), "the cancelled prompt fails");
  assert.equal(failedPayment.failure, "Request cancelled by user");
  assert.equal((await booking(cancelled)).status, "awaiting_payment", "the booking waits for another try");
  assert.ok((await page(cancelled)).html.includes("Your last payment didn't go through: Request cancelled by user."));

  const lost = await make("0700000044", 20);
  await post(`/pay/${lost}/mpesa`, { phone: "0700000044" });
  await eventually(async () => (await booking(lost)).status === "confirmed", "a lost callback: the sweep asks Safaricom and confirms", 12_000);

  // (A number whose prompts are cancelled, so nothing gets paid.)
  const limited = await make("0700000032", 30);
  for (let attempt = 0; attempt < 3; attempt += 1) assert.match((await post(`/pay/${limited}/mpesa`, { phone: "0700000032" })).location, /m=sent$/);
  assert.match((await post(`/pay/${limited}/mpesa`, { phone: "0700000032" })).location, /m=too_many$/, "a link can't flood a phone with prompts");
});

// ── Old Town House: on request, an agreed price, M-Pesa paid by hand ──────

const oldtownCheckIn = mondayAfter(40);
let oldtownChat: Chat;
let oldtownBookingId = "";

test("Old Town House takes requests, pays by hand to its till, and lets guests pay the rest at the house", async () => {
  const suite = await staff("oldtown", "POST", "/offerings", { name: "Swahili suite", units: 1, max_guests: 3, booking_mode: "request", pricing: { nightly: KSH(16000) } });
  assert.equal(suite.status, 201);
  assert.equal((await staff("oldtown", "PATCH", "/booking-settings", { deposit_percent: 20, pay_at_venue: true, tax_name: "VAT", tax_percent: 16, tax_included: true })).status, 200);
  const till = await staff("oldtown", "PUT", "/payments/mpesa-manual", { type: "till", number: "5566778" });
  assert.equal(till.status, 200, JSON.stringify(till.body));
  assert.deepEqual(till.body.payments.mpesa_manual, { type: "till", number: "5566778", account: null });
});

test("a request goes to the team, who accept it at an agreed price; the guest is sent the payment link", async () => {
  oldtownChat = await openChat("oldtown");
  await say(oldtownChat, "Hello! I'm Hassan Omar, 0722333444. We'd like the suite for three nights.");
  const reply = await say(oldtownChat, raw64("create_booking", { room_type: "Swahili suite", check_in: oldtownCheckIn, check_out: plus(oldtownCheckIn, 3), guests: 2, customer_name: "Hassan Omar", customer_phone: "0722333444", notes: "Arriving by dhow in the afternoon" }));
  assert.doesNotMatch(reply, /\/pay\//, "a request has nothing to pay yet");
  const { rows: [request] } = await platform.db.query("select * from bookings where business_id = 'oldtown'");
  oldtownBookingId = request.id;
  assert.equal(request.status, "requested");
  assert.equal(Number(request.total_minor), KSH(48000));
  await eventually(() => platform.log("emails").find((email) => /\[Old Town House\] A booking request to answer/.test(email.subject) && email.text.includes("Arriving by dhow")), "the team is asked");

  const requests = await staff("oldtown", "GET", "/bookings?filter=requests");
  assert.deepEqual(requests.body.bookings.map((row: any) => row.reference), [request.reference]);
  const accepted = await staff("oldtown", "POST", `/bookings/${request.id}/accept`, { total: "40,000", note: "returning guests" });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.booking.status, "awaiting_payment");
  assert.equal(accepted.body.booking.total_display, "KSh 40,000");
  assert.equal(accepted.body.booking.deposit_display, "KSh 8,000");
  assert.deepEqual(accepted.body.booking.quote.lines.map((line: any) => line.label), ["3 nights (KSh 16,000 a night)", "Agreed price: returning guests", "Includes VAT 16%"]);
  const told = await eventually(async () => (await messages(oldtownChat)).find((message) => message.from === "zaina" && message.text.includes("has accepted your booking request")), "the guest is told in the chat");
  assert.match(told.text, /Total: KSh 40,000\. To confirm it, pay the deposit of KSh 8,000 here: http:\/\/127\.0\.0\.1:5075\/pay\//);
});

test("the guest sends the M-Pesa code in the chat; the team checks it and confirms; the rest is paid at the house", async () => {
  const reply = await say(oldtownChat, "Done, I paid the deposit by M-Pesa. Code QK12ABC34D");
  const { rows: [request] } = await platform.db.query("select reference from bookings where id = $1", [oldtownBookingId]);
  assert.equal(reply, `Thanks! I've passed M-Pesa code QK12ABC34D to our team to match with booking ${request.reference} (KSh 8,000). You'll get a confirmation here once it's verified. Your dates are held while they check.`);
  await eventually(() => platform.log("emails").find((email) => /An M-Pesa payment to check/.test(email.subject) && email.text.includes("QK12ABC34D")), "the team is asked to check the code");
  const attention = await staff("oldtown", "GET", "/bookings?filter=attention");
  assert.equal(attention.body.bookings[0].code_to_check, true);
  const detail = await staff("oldtown", "GET", `/bookings/${oldtownBookingId}`);
  const code = detail.body.payments.find((payment: any) => payment.method === "mpesa_code");
  assert.deepEqual([code.status, code.reference, code.amount_display], ["pending", "QK12ABC34D", "KSh 8,000"]);

  // Another business can't touch it.
  assert.equal((await staff("oldtown", "POST", `/payments/${code.id}/confirm`, {}, tokens.coral)).status, 404);
  assert.equal((await staff("coral", "POST", `/payments/${code.id}/confirm`)).status, 404);

  const confirmed = await staff("oldtown", "POST", `/payments/${code.id}/confirm`, {});
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.booking.status, "confirmed");
  const told = await eventually(async () => (await messages(oldtownChat)).find((message) => message.from === "zaina" && message.text.includes("is confirmed")), "the guest hears in the chat");
  assert.match(told.text, /Paid: KSh 8,000\. The balance of KSh 32,000 is paid at the property\./);
  // The same code sent again is recognised, not recorded twice.
  const again = await post(`/pay/${(await platform.db.query("select pay_token from bookings where id = $1", [oldtownBookingId])).rows[0].pay_token}/mpesa-code`, { code: "qk12abc34d" });
  assert.match(again.location, /m=code$/);
  assert.equal((await platform.db.query("select count(*)::int as n from payments where provider_reference = 'QK12ABC34D'")).rows[0].n, 1);
});

// ── Across the pilot ──────────────────────────────────────────────────

test("each business's report shows its stays: bookings, nights, value and deposits by how they were paid", async () => {
  const coral = (await staff("coral", "GET", "/reports?days=7")).body.stays;
  assert.deepEqual({ confirmed: coral.confirmed, nights: coral.nightsSold, booked: coral.booked, deposits: coral.depositsCollected, by: coral.collectedBy.map((entry: any) => [entry.method, entry.payments]) }, {
    confirmed: 2, nights: 4, booked: [{ currency: "KES", amount: 39000 }], deposits: [{ currency: "KES", amount: 11700 }], by: [["paystack", 2]],
  });
  const lakeview = (await staff("lakeview", "GET", "/reports?days=7")).body.stays;
  assert.equal(lakeview.depositsCollected[0].amount, 32000, "two tents paid by M-Pesa prompt");
  assert.equal(lakeview.fromChat, 1);
  const oldtown = (await staff("oldtown", "GET", "/reports?days=7")).body.stays;
  assert.deepEqual(oldtown.collectedBy.map((entry: any) => [entry.method, entry.amount]), [["mpesa_code", 8000]]);
  assert.equal(oldtown.chatToBooking, 1);
});

test("the plan's exit check: three places to stay live for 30 days, with bookings and deposits flowing", async () => {
  const before = (await api("GET", "/v1/platform/overview", undefined, tokens.ops)).body.businesses.filter((business: any) => business.stays);
  assert.equal(before.length, 3);
  for (const business of before) {
    assert.ok(business.stays.bookings_30d >= 1, `${business.id} has confirmed bookings`);
    assert.ok(business.stays.deposits_30d.some((entry: any) => entry.amount > 0), `${business.id} has deposits`);
    assert.equal(business.stays.pilot_ready, false, "live for less than 30 days");
  }
  // The pilot's first chats, 31 days ago.
  await platform.db.query("update chat_sessions set created_at = created_at - interval '31 days' where business_id in ('coral', 'lakeview', 'oldtown')");
  const afterMonth = (await api("GET", "/v1/platform/overview", undefined, tokens.ops)).body.businesses.filter((business: any) => business.stays);
  assert.deepEqual(afterMonth.map((business: any) => [business.id, business.stays.live_days >= 31, business.stays.pilot_ready]).sort(), [["coral", true, true], ["lakeview", true, true], ["oldtown", true, true]]);
  // Only the platform's admins see it.
  assert.equal((await api("GET", "/v1/platform/overview", undefined, tokens.coral)).status, 403);
});

test("each business sees only its own rooms and bookings", async () => {
  assert.equal((await staff("lakeview", "GET", "/bookings?filter=all", undefined, tokens.coral)).status, 404);
  assert.equal((await staff("coral", "GET", "/bookings?filter=all")).body.bookings.every((row: any) => row.pay_link.includes("/pay/")), true);
  const coralIds = (await staff("coral", "GET", "/bookings?filter=all")).body.bookings.map((row: any) => row.id);
  const lakeviewIds = (await staff("lakeview", "GET", "/bookings?filter=all")).body.bookings.map((row: any) => row.id);
  assert.equal(coralIds.filter((id: string) => lakeviewIds.includes(id)).length, 0);
  assert.equal((await staff("coral", "GET", `/bookings/${lakeviewIds[0]}`)).status, 404);
});
