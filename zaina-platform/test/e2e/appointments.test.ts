// End-to-end, Phase 5: a second kind of business, booking time instead of
// nights. Two businesses set themselves up through the console's API and take
// bookings through Zaina:
//
//   Studio Nywele (a salon)   services with stylists, each with their own
//                             hours; a 50% deposit by M-Pesa paid by hand,
//                             which the team checks
//   Bistro Kaa (a restaurant) tables for parties, open past midnight on
//                             Fridays; no deposit is chosen at first (so chat
//                             bookings are requests), then none
//
// The model, email and payments are the stand-ins of scripted-model.mjs.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addDays, isoDate, parseDate } from "../../src/booking/pricing.ts";
import { businessDay } from "../../src/gateway/spend-cap.ts";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5076;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGINS = { studio: "https://studio.example", bistro: "https://bistro.example" };
const KSH = (major: number) => major * 100;

let platform: Platform;
let api: Api;
const tokens: Record<string, string> = {};
const keys: Record<string, string> = {};
const ids: Record<string, string> = {};

/** The first weekday (0 Sunday … 6 Saturday) at least `days` from today, in Kenya. */
function next(weekday: number, days: number): string {
  let date = addDays(parseDate(businessDay("Africa/Nairobi"))!, days);
  while (date.getUTCDay() !== weekday) date = addDays(date, 1);
  return isoDate(date);
}
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;
const staff = (business: string, method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/${business}${route}`, body, tokens[business]);

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

type Chat = { token: string; origin: string };

async function openChat(business: keyof typeof ORIGINS): Promise<Chat> {
  const response = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGINS[business] },
    body: JSON.stringify({ business_key: keys[business], display_currency: "KES" }),
  });
  const body = await response.json() as any;
  assert.equal(response.status, 201, JSON.stringify(body));
  return { token: body.token, origin: ORIGINS[business] };
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

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, BOOKING_SWEEP_INTERVAL_MS: "700" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = await login("ops@example.com");
  const owners = { studio: ["Studio Nywele", "salon", "neema@example.com", "Neema Achieng"], bistro: ["Bistro Kaa", "restaurant", "baraka@example.com", "Baraka Oduor"] } as const;
  for (const [id, [name, type, email, owner]] of Object.entries(owners)) {
    const created = await api("POST", "/v1/platform/businesses", {
      id, name, business_type: type, allowed_origins: [ORIGINS[id as keyof typeof ORIGINS]], owner: { email, name: owner, password: PASSWORD },
    }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    keys[id] = created.body.business.public_key;
    tokens[id] = await login(email);
  }
});

after(async () => {
  await platform?.stop();
});

test("a salon sets itself up: hours, stylists, services, its own deposit and payments", async () => {
  const weekdays = Object.fromEntries(["1", "2", "3", "4", "5", "6"].map((day) => [day, [["09:00", "18:00"]]]));
  const hours = await staff("studio", "PATCH", "/booking-settings", { opening_hours: weekdays, slot_interval_minutes: 30, deposit_type: "percent", deposit_percent: 50, cancellation_policy: "Tell us a day before to move or cancel." });
  assert.equal(hours.status, 200, JSON.stringify(hours.body));
  assert.equal(hours.body.opening_hours_text, "Mon–Sat 09:00–18:00; Sun closed");
  assert.equal((await staff("studio", "PATCH", "/booking-settings", { opening_hours: { 1: [["09:00", "12:00"], ["11:00", "14:00"]] } })).status, 400, "overlapping hours");
  assert.equal((await staff("studio", "PUT", "/payments/mpesa-manual", { type: "paybill", number: "522522", account: null })).status, 200);

  const amina = await staff("studio", "POST", "/resources", { name: "Amina", kind: "staff" });
  assert.equal(amina.status, 201, JSON.stringify(amina.body));
  const brian = await staff("studio", "POST", "/resources", { name: "Brian", kind: "staff", hours: { 1: [["12:00", "18:00"]], 2: [["12:00", "18:00"]], 3: [["12:00", "18:00"]], 4: [["12:00", "18:00"]], 5: [["12:00", "18:00"]] } });
  assert.equal(brian.body.resource.hours_text, "Mon–Fri 12:00–18:00; Sat–Sun closed");
  ids.amina = amina.body.resource.id;
  ids.brian = brian.body.resource.id;
  const haircut = await staff("studio", "POST", "/offerings", { name: "Haircut", duration_minutes: 60, buffer_minutes: 15, pricing: { price: KSH(1500) } });
  assert.equal(haircut.status, 201, JSON.stringify(haircut.body));
  assert.equal(haircut.body.offering.kind, "service", "a salon's offerings are services");
  assert.equal(haircut.body.offering.price_display, "KSh 1,500");
  ids.haircut = haircut.body.offering.id;
  const braids = await staff("studio", "POST", "/offerings", { name: "Box braids", duration_minutes: 240, pricing: { price: KSH(6000) }, resource_ids: [ids.amina] });
  assert.deepEqual(braids.body.offering.resource_ids, [ids.amina]);
  assert.equal((await staff("studio", "POST", "/offerings", { name: "Bad", duration_minutes: 2 })).status, 400);
  assert.equal((await staff("studio", "POST", "/offerings", { name: "Nails", duration_minutes: 30, resource_ids: ["00000000-0000-4000-8000-000000000000"] })).status, 400, "someone else's resource");

  const monday = next(1, 7);
  const slots = await staff("studio", "GET", `/slots?offering_id=${ids.haircut}&date=${monday}`);
  assert.equal(slots.status, 200, JSON.stringify(slots.body));
  assert.equal(slots.body.slots[0].time, "09:00");
  assert.deepEqual(slots.body.slots[0].free.map((entry: any) => entry.name), ["Amina"]);
  assert.equal(slots.body.slots.find((slot: any) => slot.time === "12:00").free.length, 2);
});

test("Zaina books a haircut: times from the tool, the deposit held, paid by M-Pesa, confirmed", async () => {
  const chat = await openChat("studio");
  const whoami = await say(chat, "TEST:whoami");
  assert.match(whoami, /Studio Nywele, a salon/);
  assert.match(whoami, /list_services, check_times, create_appointment, get_booking, create_lead/);
  const menu = await say(chat, raw64("list_services", {}));
  assert.match(menu, /Haircut \(1 h, KSh 1,500\)/);
  assert.match(menu, /50% to confirm/);

  const monday = next(1, 7);
  const times = await say(chat, raw64("check_times", { service: "haircut", date: monday }));
  assert.match(times, /Free on .*: 09:00, 09:30/);
  await say(chat, "I'm Jane Wanjiru, 0712345678. 2pm with Brian please.");
  const booked = await say(chat, raw64("create_appointment", { service: "Haircut", date: monday, time: "14:00", with: "Brian", customer_name: "Jane Wanjiru", customer_phone: "0712345678" }));
  assert.match(booked, /Booking [A-Z0-9]{8} is held for you\. Pay the 50% deposit of KSh 750 here to confirm it:/);
  assert.match(booked, /This time is held until/);
  assert.match(booked, /The rest is paid when you arrive/);
  assert.doesNotMatch(booked, /0799111222|rooms/, "the server's payment block, not the model's");
  const token = payToken(booked);
  const row = (await platform.db.query("select * from bookings where pay_token = $1", [token])).rows[0];
  assert.equal(row.status, "held");
  assert.equal(row.resource_id, ids.brian);

  const again = await say(chat, raw64("create_appointment", { service: "Haircut", date: monday, time: "14:00", with: "Brian", customer_name: "Jane Wanjiru", customer_phone: "0712345678" }));
  assert.equal(payToken(again), token, "the same request twice is one booking");
  const taken = await say(chat, raw64("create_appointment", { service: "Haircut", date: monday, time: "14:30", with: "Brian", customer_name: "Jane Wanjiru", customer_phone: "0712345678" }));
  assert.match(taken, /resource_unavailable/);

  const page = await fetch(`${BASE}/pay/${token}`);
  const html = await page.text();
  assert.match(html, /<dt>When<\/dt><dd>Mon \d+ \w+ \d{4} at 2:00 PM<\/dd>/);
  assert.match(html, /<dt>Length<\/dt><dd>1 hour<\/dd>/);
  assert.match(html, /This time is held until/);
  assert.match(html, /Deposit \(50%\)/);
  assert.match(html, /Balance, paid when you arrive after the deposit/);
  assert.doesNotMatch(html, /Check-in|Nights|rooms/);

  const code = await fetch(`${BASE}/pay/${token}/mpesa-code`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "code=QK12ABC34D" });
  assert.equal(code.status, 303);
  const detail = await staff("studio", "GET", `/bookings/${row.id}`);
  assert.equal(detail.body.booking.resource_name, "Brian");
  assert.equal(detail.body.booking.time_range, "14:00–15:00");
  const pending = detail.body.payments.find((payment: any) => payment.method === "mpesa_code");
  assert.equal((await staff("studio", "POST", `/payments/${pending.id}/confirm`, {})).status, 200);
  const confirmed = await staff("studio", "GET", `/bookings/${row.id}`);
  assert.equal(confirmed.body.booking.status, "confirmed");
  const told = (await messages(chat)).map((message) => message.text).join("\n");
  assert.match(told, /is confirmed\. Haircut, Mon \d+ \w+ \d{4} at 2:00 PM\. Paid: KSh 750\. The balance of KSh 750 is paid when you arrive\./);
  assert.doesNotMatch(told, /Check-in/);

  const schedule = await staff("studio", "GET", `/schedule?date=${monday}`);
  assert.equal(schedule.body.bookings.length, 1);
  assert.equal(schedule.body.bookings[0].resource_name, "Brian");
});

test("a restaurant: tables for parties, open past midnight, and its own choice of deposit", async () => {
  const friday = next(5, 7);
  await staff("bistro", "PATCH", "/booking-settings", { opening_hours: { 5: [["18:00", "01:00"]], 6: [["18:00", "23:00"]] } });
  for (const [name, seats, minParty] of [["Window", 2, 1], ["Corner", 4, 1], ["Long table", 10, 6]] as const) {
    assert.equal((await staff("bistro", "POST", "/resources", { name, kind: "table", seats, min_party: minParty })).status, 201);
  }
  const dinner = await staff("bistro", "POST", "/offerings", { name: "Dinner", duration_minutes: 90, buffer_minutes: 15, min_party: 1, max_party: 10 });
  assert.equal(dinner.body.offering.kind, "table");
  assert.equal(dinner.body.offering.price_display, "free");

  const chat = await openChat("bistro");
  const late = await say(chat, raw64("check_times", { service: "dinner", date: friday, party_size: 4 }));
  assert.match(late, /23:30\. It's free/, "the last seating ends at 01:00");
  await say(chat, "Table for 4 please, I'm Otieno Kamau, otieno@example.com");
  const asked = await say(chat, raw64("create_appointment", { service: "Dinner", date: friday, time: "20:00", party_size: 4, customer_name: "Otieno Kamau", customer_email: "otieno@example.com" }));
  assert.match(asked, /Booked: Dinner, .* \(requested\)/, "no deposit chosen yet: a request for the team");
  const requested = (await platform.db.query("select status, resource_id from bookings where business_id = 'bistro' order by created_at desc limit 1")).rows[0];
  assert.equal(requested.status, "requested");

  assert.equal((await staff("bistro", "PATCH", "/booking-settings", { deposit_type: "none" })).status, 200);
  const booked = await say(chat, raw64("create_appointment", { service: "Dinner", date: friday, time: "21:00", party_size: 2, customer_name: "Otieno Kamau", customer_email: "otieno@example.com" }));
  assert.match(booked, /Booked: Dinner, .* \(confirmed\)/);
  const table = (await platform.db.query("select r.name from bookings b join resources r on r.id = b.resource_id where b.business_id = 'bistro' order by b.created_at desc limit 1")).rows[0];
  assert.equal(table.name, "Window", "the smallest table that seats two");
  const big = await say(chat, raw64("create_appointment", { service: "Dinner", date: friday, time: "21:00", party_size: 12, customer_name: "Otieno Kamau", customer_email: "otieno@example.com" }));
  assert.match(big, /too_many_guests/);

  const walkIn = await staff("bistro", "POST", "/bookings", { offering_id: dinner.body.offering.id, date: friday, time: "19:00", party: 8, customer_name: "Fatma Ali", customer_phone: "0722000111", confirm_now: true });
  assert.equal(walkIn.status, 201, JSON.stringify(walkIn.body));
  assert.equal(walkIn.body.booking.resource_name, "Long table");
  assert.equal(walkIn.body.booking.status, "confirmed");
  const list = await staff("bistro", "GET", "/bookings?filter=upcoming");
  assert.ok(list.body.bookings.some((row: any) => row.when && /at 7:00 PM/.test(row.when)));

  const closure = await staff("bistro", "POST", "/closures", { starts_at: `${friday}T15:00:00Z`, ends_at: `${friday}T23:00:00Z`, reason: "Private event" });
  assert.equal(closure.status, 201);
  const closed = await staff("bistro", "GET", `/slots?offering_id=${dinner.body.offering.id}&date=${friday}&party=2`);
  assert.deepEqual(closed.body.slots, [], "closed for a private event from 18:00 to 02:00 Kenya time");
});

test("each business's slots, people and tables are its own", async () => {
  assert.equal((await api("GET", "/v1/staff/businesses/bistro/resources", undefined, tokens.studio)).status, 404, "another business is not found");
  const studioSees = await staff("studio", "GET", "/resources");
  assert.deepEqual(studioSees.body.resources.map((resource: any) => resource.name), ["Amina", "Brian"]);
});
