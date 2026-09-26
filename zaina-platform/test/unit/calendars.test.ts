// The calendar connector without a database: reading other calendars' busy
// times (iCal), writing the bookings feed, checking the links businesses
// give us, and the signed state of Google's sign-in.

import assert from "node:assert/strict";
import test from "node:test";
import { icsUrl, IcsFetchError, privateAddress } from "../../src/calendars/fetch-ics.ts";
import { authorizationUrl, configureGoogle, readState } from "../../src/calendars/google.ts";
import { readBusy, renderFeed } from "../../src/calendars/ics.ts";

const ZONE = "Africa/Nairobi";
const window = { timeZone: ZONE, from: new Date("2026-01-01T00:00:00Z"), to: new Date("2027-01-01T00:00:00Z") };

test("busy times from a channel manager's calendar: whole days, times, zones, and what's skipped", () => {
  const text = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Airbnb Inc//Hosting Calendar 0.8.8//EN",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261102",
    "DTEND;VALUE=DATE:20261105",
    "UID:1418fb94e984-reserved@airbnb.com",
    "SUMMARY:Reserved",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:utc-1",
    "DTSTART:20261110T070000Z",
    "DTEND:20261110T090000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:london-1",
    "DTSTART;TZID=Europe/London:20260701T090000",
    "DURATION:PT1H30M",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:floating-1",
    "DTSTART:20261111T140000",
    "DTEND:20261111T150000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:one-day",
    "DTSTART;VALUE=DATE:20261120",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:cancelled",
    "STATUS:CANCELLED",
    "DTSTART;VALUE=DATE:20261201",
    "DTEND;VALUE=DATE:20261203",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:free",
    "TRANSP:TRANSPARENT",
    "DTSTART:20261201T100000Z",
    "DTEND:20261201T110000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:folded-summary-and-",
    " a-long-uid",
    "DTSTART;VALUE=DATE:20270105",
    "DTEND;VALUE=DATE:20270106",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const busy = readBusy(text, window);
  assert.deepEqual(busy.map((entry) => entry.uid), ["1418fb94e984-reserved@airbnb.com", "utc-1", "london-1", "floating-1", "one-day"], "cancelled, free and out-of-window events are skipped");
  assert.deepEqual(busy[0].days, { from: "2026-11-02", to: "2026-11-05" });
  assert.equal(busy[1].start.toISOString(), "2026-11-10T07:00:00.000Z");
  assert.equal(busy[2].start.toISOString(), "2026-07-01T08:00:00.000Z", "London summer time");
  assert.equal(busy[2].end.toISOString(), "2026-07-01T09:30:00.000Z");
  assert.equal(busy[3].start.toISOString(), "2026-11-11T11:00:00.000Z", "floating times are the business's own");
  assert.deepEqual(busy[4].days, { from: "2026-11-20", to: "2026-11-21" }, "a whole-day event with no end is one day");
  const later = readBusy(text, { ...window, to: new Date("2028-01-01T00:00:00Z") });
  assert.equal(later.at(-1)!.uid, "folded-summary-and-a-long-uid", "folded lines are joined");
  assert.deepEqual(readBusy("not a calendar", window), []);
});

test("the bookings feed is a valid calendar: escaped, folded, whole days for stays and times for slots", () => {
  const text = renderFeed("Coral Cove bookings", [
    { uid: "a@zaina", summary: "Ocean double · Jane; \"VIP\", late", description: "Booking K7Q2MPXA\n2 guests", days: { from: "2026-11-02", to: "2026-11-05" }, status: "CONFIRMED", updated: new Date("2026-10-01T10:00:00Z") },
    { uid: "b@zaina", summary: `Request: Haircut · ${"Wanjiru ".repeat(12).trim()}`, description: "Booking B2", start: new Date("2026-11-10T07:00:00Z"), end: new Date("2026-11-10T08:00:00Z"), status: "TENTATIVE", updated: new Date("2026-10-01T10:00:00Z") },
  ], new Date("2026-10-02T00:00:00Z"));
  assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.match(text, /DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261105/);
  assert.match(text, /DTSTART:20261110T070000Z\r\nDTEND:20261110T080000Z/);
  assert.match(text, /SUMMARY:Ocean double · Jane\\; "VIP"\\, late/);
  assert.match(text, /DESCRIPTION:Booking K7Q2MPXA\\n2 guests/);
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line too long: ${line}`);
  // Folded lines read back as they were.
  const back = readBusy(text, window);
  assert.deepEqual(back.map((entry) => entry.uid), ["a@zaina", "b@zaina"]);
});

test("calendar links must be public https addresses", () => {
  assert.equal(icsUrl("webcal://www.airbnb.com/calendar/ical/123.ics?s=abc").toString(), "https://www.airbnb.com/calendar/ical/123.ics?s=abc");
  for (const bad of ["http://example.com/a.ics", "ftp://example.com/a.ics", "https://user:pw@example.com/a.ics", "https://example.com:8443/a.ics", "not a link"]) {
    assert.throws(() => icsUrl(bad), IcsFetchError, bad);
  }
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) {
    assert.equal(privateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "172.32.0.1", "93.184.216.34", "2606:4700::1111"]) assert.equal(privateAddress(address), false, address);
});

test("Google's sign-in state names the business and person, is signed, and expires", () => {
  configureGoogle({ clientId: "123-abc.apps.googleusercontent.com", clientSecret: "secret", redirectUri: "https://zaina.example/v1/calendar/google/callback", stateSecret: "x".repeat(40) });
  const now = new Date("2026-10-01T10:00:00Z");
  const url = new URL(authorizationUrl("coral", "00000000-0000-4000-8000-000000000001", now));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("redirect_uri"), "https://zaina.example/v1/calendar/google/callback");
  assert.match(url.searchParams.get("scope")!, /calendar\.events/);
  const state = url.searchParams.get("state")!;
  assert.deepEqual(readState(state, now), { businessId: "coral", userId: "00000000-0000-4000-8000-000000000001" });
  assert.equal(readState(state, new Date(now.getTime() + 16 * 60_000)), null, "expired after 15 minutes");
  const [payload, signature] = state.split(".");
  const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), b: "lakeview" })).toString("base64url");
  assert.equal(readState(`${other}.${signature}`, now), null, "another business in someone else's state");
  configureGoogle({ clientId: "123-abc.apps.googleusercontent.com", clientSecret: "secret", redirectUri: "https://zaina.example/v1/calendar/google/callback", stateSecret: "y".repeat(40) });
  assert.equal(readState(state, now), null, "signed with another secret");
  configureGoogle(null);
  assert.equal(readState(state, now), null);
});
