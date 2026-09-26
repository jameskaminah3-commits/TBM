// End-to-end, Phase 5: the calendar connector. A salon and a guesthouse keep
// their bookings and their other calendars in step:
//
//   feed links     private iCal links to the bookings, for any calendar app
//   Google         the owner signs in with Google; a person's calendar blocks
//                  their times, and confirmed bookings are written as events
//                  (and removed when cancelled)
//   iCal links     a guesthouse imports a channel's calendar (Airbnb-style):
//                  its bookings close the room type's nights
//
// Google and the calendar links are the stand-ins of scripted-model.mjs.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { zonedInstant } from "../../src/booking/local-time.ts";
import { addDays, isoDate, parseDate } from "../../src/booking/pricing.ts";
import { businessDay } from "../../src/gateway/spend-cap.ts";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5078;
const BASE = `http://127.0.0.1:${PORT}`;
const ZONE = "Africa/Nairobi";
const KSH = (major: number) => major * 100;

let platform: Platform;
let api: Api;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

function next(weekday: number, days: number): string {
  let date = addDays(parseDate(businessDay(ZONE))!, days);
  while (date.getUTCDay() !== weekday) date = addDays(date, 1);
  return isoDate(date);
}
const monday = next(1, 7);
const staff = (business: string, method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/${business}${route}`, body, tokens[business]);
const times = async (date: string) => (await staff("studio", "GET", `/slots?offering_id=${ids.haircut}&date=${date}`)).body.slots.map((slot: any) => slot.time) as string[];
const feed = async (url: string) => {
  const response = await fetch(url);
  return { status: response.status, type: response.headers.get("content-type") ?? "", text: await response.text() };
};

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

before(async () => {
  platform = await startPlatform({
    port: PORT,
    env: {
      PUBLIC_BASE_URL: BASE,
      PLATFORM_GOOGLE_CLIENT_ID: "123-zaina.apps.googleusercontent.com",
      PLATFORM_GOOGLE_CLIENT_SECRET: "google-test-secret",
      CALENDAR_SYNC_INTERVAL_MS: "3600000",
    },
  });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = await login("ops@example.com");
  for (const [id, name, type, email] of [["studio", "Studio Nywele", "salon", "neema@example.com"], ["coral", "Coral Cove Guesthouse", "guesthouse", "amani@example.com"]]) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, business_type: type, allowed_origins: [`https://${id}.example`], owner: { email, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    tokens[id] = await login(email);
  }
  const weekdays = Object.fromEntries(["1", "2", "3", "4", "5", "6"].map((day) => [day, [["09:00", "18:00"]]]));
  assert.equal((await staff("studio", "PATCH", "/booking-settings", { opening_hours: weekdays, deposit_type: "none" })).status, 200);
  ids.amina = (await staff("studio", "POST", "/resources", { name: "Amina", kind: "staff" })).body.resource.id;
  ids.haircut = (await staff("studio", "POST", "/offerings", { name: "Haircut", duration_minutes: 60, pricing: { price: KSH(1500) } })).body.offering.id;
  ids.cottage = (await staff("coral", "POST", "/offerings", { name: "Garden cottage", units: 1, max_guests: 4, pricing: { nightly: KSH(12000) } })).body.offering.id;
  assert.equal((await staff("coral", "PATCH", "/booking-settings", { deposit_type: "none" })).status, 200);
});

after(async () => {
  await platform?.stop();
});

const book = async (time: string, name = "Jane Wanjiru") => {
  const created = await staff("studio", "POST", "/bookings", { offering_id: ids.haircut, date: monday, time, customer_name: name, customer_phone: "0712345678", confirm_now: true });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.booking;
};

test("private feed links: the bookings for any calendar app, one person's, and revoking a link", async () => {
  const all = await staff("studio", "POST", "/calendars/feeds", { label: "Front desk" });
  assert.equal(all.status, 201, JSON.stringify(all.body));
  assert.match(all.body.url, new RegExp(`^${BASE}/calendar/[A-Za-z0-9_-]{32}\\.ics$`));
  assert.match(all.body.note, /isn't shown again/);
  const amina = await staff("studio", "POST", "/calendars/feeds", { resource_id: ids.amina, label: "Amina" });
  const booking = await book("10:00");

  const read = await feed(all.body.url);
  assert.equal(read.status, 200);
  assert.match(read.type, /^text\/calendar/);
  assert.match(read.text, /X-WR-CALNAME:Studio Nywele bookings/);
  assert.match(read.text, /SUMMARY:Haircut · Jane Wanjiru/);
  assert.match(read.text, new RegExp(`DTSTART:${zonedInstant(monday, "10:00", ZONE).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`));
  assert.match(read.text, /STATUS:CONFIRMED/);
  assert.doesNotMatch(read.text, /0712345678/, "no phone numbers in a feed");
  assert.match((await feed(amina.body.url)).text, /X-WR-CALNAME:Studio Nywele: Amina[\s\S]*SUMMARY:Haircut · Jane Wanjiru/);

  assert.equal((await staff("studio", "POST", `/bookings/${booking.id}/cancel`, { reason: "Ill" })).status, 200);
  assert.doesNotMatch((await feed(all.body.url)).text, /Jane Wanjiru/, "cancelled bookings drop out");
  assert.equal((await feed(`${BASE}/calendar/${"x".repeat(32)}.ics`)).status, 404);
  const listed = await staff("studio", "GET", "/calendars");
  assert.equal(listed.body.feeds.length, 2);
  assert.ok(listed.body.feeds.every((entry: any) => !("url" in entry) && !("token_hash" in entry)), "links aren't shown again");
  assert.equal((await staff("studio", "DELETE", `/calendars/feeds/${amina.body.feed.id}`)).status, 200);
  assert.equal((await feed(amina.body.url)).status, 404, "a deleted link stops working");
});

test("Google: the owner signs in, a person's calendar blocks their times", async () => {
  const before = await staff("studio", "GET", "/calendars");
  assert.equal(before.body.google.available, true);
  assert.equal(before.body.google.connected, false);
  const start = await staff("studio", "POST", "/calendars/google/start");
  const consent = new URL(start.body.url);
  assert.equal(consent.searchParams.get("client_id"), "123-zaina.apps.googleusercontent.com");
  assert.equal(consent.searchParams.get("redirect_uri"), `${BASE}/v1/calendar/google/callback`);
  const state = consent.searchParams.get("state")!;

  const forged = await fetch(`${BASE}/v1/calendar/google/callback?code=consent-ok&state=${encodeURIComponent(state.replace(/.$/, (c) => (c === "A" ? "B" : "A")))}`, { redirect: "manual" });
  assert.equal(forged.status, 303);
  assert.equal(forged.headers.get("location"), `${BASE}/console/`, "a state that isn't ours connects nothing");
  const back = await fetch(`${BASE}/v1/calendar/google/callback?code=consent-ok&state=${encodeURIComponent(state)}`, { redirect: "manual" });
  assert.equal(back.status, 303);
  assert.equal(back.headers.get("location"), `${BASE}/console/#/b/studio/settings/calendars?google=connected`);
  const connected = await staff("studio", "GET", "/calendars");
  assert.equal(connected.body.google.connected, true);
  assert.equal(connected.body.google.account, "owner@example.com");
  const secret = await platform.db.query("select name from business_secrets where business_id = 'studio'");
  assert.deepEqual(secret.rows.map((row) => row.name), ["google_refresh_token"], "the sign-in is a business secret");

  const calendars = await staff("studio", "GET", "/calendars/google/calendars");
  assert.deepEqual(calendars.body.calendars.map((calendar: any) => [calendar.id, calendar.canWrite]), [["primary", true], ["amina-calendar", true], ["holidays", false]]);
  platform.setGoogleEvents({
    "amina-calendar": [
      { id: "lunch", status: "confirmed", start: { dateTime: zonedInstant(monday, "12:00", ZONE).toISOString() }, end: { dateTime: zonedInstant(monday, "14:00", ZONE).toISOString() } },
      { id: "maybe", status: "confirmed", transparency: "transparent", start: { dateTime: zonedInstant(monday, "16:00", ZONE).toISOString() }, end: { dateTime: zonedInstant(monday, "17:00", ZONE).toISOString() } },
    ],
  });
  assert.equal((await staff("studio", "POST", "/calendars/sources", { kind: "google", calendar_id: "someone-else", label: "?", resource_id: ids.amina })).status, 400);
  const source = await staff("studio", "POST", "/calendars/sources", { kind: "google", calendar_id: "amina-calendar", label: "Amina's calendar", resource_id: ids.amina });
  assert.equal(source.status, 201, JSON.stringify(source.body));
  assert.equal(source.body.synced.busy, 1, "an event marked free doesn't block");
  const free = await times(monday);
  assert.ok(free.includes("11:00") && free.includes("14:00") && free.includes("16:00"));
  for (const time of ["11:30", "12:00", "12:30", "13:00", "13:30"]) assert.ok(!free.includes(time), `${time} is busy in Amina's calendar`);
  const schedule = await staff("studio", "GET", `/schedule?date=${monday}`);
  assert.ok(schedule.body.closures.some((closure: any) => closure.source === "calendar" && closure.reason === "Busy in Amina's calendar"));
});

test("Google: confirmed bookings become events in the chosen calendar, and leave when cancelled", async () => {
  assert.equal((await staff("studio", "PATCH", "/calendars/google", { write_calendar_id: "holidays" })).status, 400, "a calendar the account can only read");
  assert.equal((await staff("studio", "PATCH", "/calendars/google", { write_calendar_id: "primary" })).status, 200);
  const booking = await book("15:00", "Achieng Odhiambo");
  const synced = await staff("studio", "POST", "/calendars/sync");
  assert.equal(synced.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.summary.events.written, 1);
  const inserted = platform.log("google").filter((entry) => entry.kind === "insert");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].calendarId, "primary");
  assert.equal(inserted[0].summary, "Haircut · Achieng Odhiambo");
  assert.equal(inserted[0].booking, booking.id);
  assert.equal(inserted[0].start.dateTime, zonedInstant(monday, "15:00", ZONE).toISOString());

  // The platform's own events in a calendar it also reads aren't busy times.
  const whole = await staff("studio", "POST", "/calendars/sources", { kind: "google", calendar_id: "primary", label: "Shop calendar" });
  assert.equal(whole.status, 201);
  assert.equal(whole.body.synced.busy, 0);

  const again = await staff("studio", "POST", "/calendars/sync");
  assert.equal(again.body.summary.events.written, 0, "nothing changed, nothing written");
  assert.equal((await staff("studio", "POST", `/bookings/${booking.id}/cancel`, { reason: "Moved" })).status, 200);
  const removed = await staff("studio", "POST", "/calendars/sync");
  assert.equal(removed.body.summary.events.removed, 1);
  assert.equal(platform.log("google").filter((entry) => entry.kind === "delete" && entry.existed).length, 1);
  assert.equal((await platform.db.query("select count(*)::int as n from calendar_events")).rows[0].n, 0);
});

test("a guesthouse imports a channel's iCal link: its bookings close the room type's nights", async () => {
  const arrive = next(1, 20);
  const leave = isoDate(addDays(parseDate(arrive)!, 3));
  const compact = (date: string) => date.replace(/-/g, "");
  platform.publishIcs("cottage", ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Airbnb Inc//Hosting Calendar//EN", "BEGIN:VEVENT", `DTSTART;VALUE=DATE:${compact(arrive)}`, `DTEND;VALUE=DATE:${compact(leave)}`, "UID:abc-reserved@airbnb.com", "SUMMARY:Reserved", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
  assert.equal((await staff("coral", "POST", "/calendars/sources", { kind: "ics", url: "https://ical.example/cottage.ics", label: "Airbnb" })).status, 400, "a guesthouse's calendar is for a room type");
  for (const [url, why] of [["http://ical.example/cottage.ics", /https/], ["https://private.example/cottage.ics", /public internet/], ["https://10.0.0.5/cottage.ics", /public internet/], ["https://ical.example/moved.ics", /public internet/], ["https://ical.example/missing.ics", /answered 404/]] as const) {
    const refused = await staff("coral", "POST", "/calendars/sources", { kind: "ics", url, label: "Airbnb", offering_id: ids.cottage });
    assert.equal(refused.status, 400, url);
    assert.match(refused.body.message, why, url);
  }
  const added = await staff("coral", "POST", "/calendars/sources", { kind: "ics", url: "webcal://ical.example/cottage.ics", label: "Airbnb: Garden cottage", offering_id: ids.cottage });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.synced.busy, 1);
  assert.equal((await platform.db.query("select count(*)::int as n from calendar_sources where business_id = 'coral'")).rows[0].n, 1, "refused links aren't kept");
  const secrets = await platform.db.query("select name from business_secrets where business_id = 'coral'");
  assert.equal(secrets.rows.length, 1, "the link is kept as a secret");
  assert.match(secrets.rows[0].name, /^ics_[0-9a-f]{32}$/);

  const blocks = await staff("coral", "GET", `/blocks?from=${arrive}&days=5`);
  const block = blocks.body.blocks.find((entry: any) => entry.source === "calendar");
  assert.deepEqual([block.starts_on, block.ends_on, block.units, block.reason], [arrive, leave, 1, "Busy in Airbnb: Garden cottage"]);
  assert.equal((await staff("coral", "DELETE", `/blocks/${block.id}`)).status, 404, "a calendar's closures leave with the calendar");
  const taken = await staff("coral", "POST", "/bookings", { offering_id: ids.cottage, check_in: arrive, check_out: leave, guests: 2, customer_name: "Peter Kariuki", customer_phone: "0722000111" });
  assert.equal(taken.status, 409, "booked on the other channel");

  platform.publishIcs("cottage", "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR");
  await staff("coral", "POST", "/calendars/sync");
  const freed = await staff("coral", "POST", "/bookings", { offering_id: ids.cottage, check_in: arrive, check_out: leave, guests: 2, customer_name: "Peter Kariuki", customer_phone: "0722000111" });
  assert.equal(freed.status, 201, "cancelled on the other channel: free again");
  assert.equal((await staff("coral", "DELETE", `/calendars/sources/${added.body.source.id}`)).status, 200);
  assert.equal((await platform.db.query("select count(*)::int as n from business_secrets where business_id = 'coral'")).rows[0].n, 0);
});

test("Google access revoked: the console says to connect again; disconnecting revokes and forgets", async () => {
  const refresh = platform.log("google").find((entry) => entry.kind === "refresh")?.refresh;
  assert.ok(refresh);
  platform.revokeGoogle(refresh);
  await book("09:00", "Wafula Chebet");
  const synced = await staff("studio", "POST", "/calendars/sync");
  assert.equal(synced.body.summary.connection, "error");
  const view = await staff("studio", "GET", "/calendars");
  assert.equal(view.body.google.status, "error");
  assert.match(view.body.google.last_error, /connect again/);
  assert.ok(view.body.sources.some((source: any) => source.status === "error"), "its calendars say so too");

  const disconnected = await staff("studio", "DELETE", "/calendars/google");
  assert.equal(disconnected.status, 200);
  assert.equal(disconnected.body.google.connected, false);
  assert.deepEqual(disconnected.body.sources, [], "Google calendars go with the account");
  assert.ok(platform.log("google").some((entry) => entry.kind === "revoke" && entry.token === refresh));
  assert.equal((await platform.db.query("select count(*)::int as n from business_secrets where business_id = 'studio'")).rows[0].n, 0);
  assert.equal((await platform.db.query("select count(*)::int as n from resource_blocks where business_id = 'studio' and source = 'calendar'")).rows[0].n, 0, "and their busy times");
});
