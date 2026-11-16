import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalendar,
  calendarLinkHost,
  calendarLinkToken,
  getTakenStretches,
  isCalendarLinkToken,
  loadCalendarEvents,
  normalizeCalendarUrl,
  parseCalendarEvents,
} from "./hotel-calendar.ts";
import { PublicFetchError, privateAddress, publicUrl } from "./public-fetch.ts";
import type { RoomClaim } from "../shared/hotel-rooms.ts";

const TODAY = "2026-12-01";

// The shapes other sites publish: all-day events with an exclusive end date
// (Airbnb, Booking.com), long lines folded, and now and then a time of day.
const otherSite = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Other Site//Hosting Calendar 1.0//EN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261208",
  "DTSTART;VALUE=DATE:20261205",
  "UID:abc-123@othersite.example",
  "SUMMARY:Reserved",
  "DESCRIPTION:Reservation URL: https://othersite.example/r/1\\nPhone",
  "  Number (Last 4 Digits): 1234",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261220",
  "DTEND;VALUE=DATE:20261227",
  "UID:closed-1@othersite.example",
  "SUMMARY:CLOSED - Not available",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261110",
  "DTEND;VALUE=DATE:20261112",
  "UID:long-gone@othersite.example",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261214",
  "DTEND;VALUE=DATE:20261216",
  "UID:cancelled@othersite.example",
  "STATUS:CANCELLED",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Africa/Nairobi:20270102T140000",
  "DTEND;TZID=Africa/Nairobi:20270104T100000",
  "UID:timed@othersite.example",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20270110T220000Z",
  "UID:late-evening-utc@othersite.example",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("a calendar's taken nights are read: dates as written, the end date is the day it's free again", () => {
  const events = parseCalendarEvents(otherSite, TODAY);
  assert.deepEqual(events, [
    { uid: "abc-123@othersite.example", startDate: "2026-12-05", endDate: "2026-12-08" },
    { uid: "closed-1@othersite.example", startDate: "2026-12-20", endDate: "2026-12-27" },
    { uid: "timed@othersite.example", startDate: "2027-01-02", endDate: "2027-01-04" },
    // 22:00 UTC is already the next day in Kenya; with no end, one night.
    { uid: "late-evening-utc@othersite.example", startDate: "2027-01-11", endDate: "2027-01-12" },
  ]);
});

test("past and cancelled events are left out, and nothing is read further than two years ahead", () => {
  const events = parseCalendarEvents(otherSite, TODAY);
  assert.equal(events.some((event) => /long-gone|cancelled/.test(event.uid)), false);
  const farAhead = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261203\nDTEND;VALUE=DATE:20991231\nUID:x\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20300101\nDTEND;VALUE=DATE:20300105\nUID:y\nEND:VEVENT\nEND:VCALENDAR";
  assert.deepEqual(parseCalendarEvents(farAhead, TODAY), [{ uid: "x", startDate: "2026-12-03", endDate: "2028-11-30" }]);
});

test("a link that isn't a calendar is refused in words", () => {
  assert.throws(() => parseCalendarEvents("<html><body>Sign in</body></html>", TODAY), /didn't return a calendar/);
});

test("the calendar TBM gives out lists taken nights only, never who booked", () => {
  const text = buildCalendar({
    name: "Coral Cove Hotel, Deluxe Double",
    events: [{ uid: "tbm-rt-1-2026-12-05", startDate: "2026-12-05", endDate: "2026-12-08" }],
    now: new Date("2026-12-01T09:30:00Z"),
  });
  assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(text, /X-WR-CALNAME:Coral Cove Hotel\\, Deluxe Double\r\n/);
  assert.match(text, /DTSTART;VALUE=DATE:20261205\r\nDTEND;VALUE=DATE:20261208\r\nSUMMARY:Not available\r\n/);
  assert.match(text, /DTSTAMP:20261201T093000Z/);
  assert.match(text, /END:VCALENDAR\r\n$/);
  // And it reads back as the same nights.
  assert.deepEqual(parseCalendarEvents(text, TODAY), [{ uid: "tbm-rt-1-2026-12-05", startDate: "2026-12-05", endDate: "2026-12-08" }]);
});

test("a room type is taken on the nights TBM's own bookings and blocks hold every room", () => {
  const roomType = { id: "rt-1", roomCount: 2 };
  const claims: RoomClaim[] = [
    { roomTypeId: "rt-1", rooms: 1, firstNight: "2026-12-03", lastNight: "2026-12-06" },
    { roomTypeId: "rt-1", rooms: 1, firstNight: "2026-12-05", lastNight: "2026-12-07" },
    { roomTypeId: "rt-other", rooms: 5, firstNight: "2026-12-03", lastNight: "2026-12-09" },
    // The hotel closed for a night.
    { roomTypeId: null, rooms: null, firstNight: "2026-12-12", lastNight: "2026-12-12" },
  ];
  assert.deepEqual(getTakenStretches(roomType, claims, TODAY), [
    { uid: "tbm-rt-1-2026-12-05", startDate: "2026-12-05", endDate: "2026-12-07" },
    { uid: "tbm-rt-1-2026-12-12", startDate: "2026-12-12", endDate: "2026-12-13" },
  ]);
  assert.deepEqual(getTakenStretches(roomType, [], TODAY), []);
});

test("a room's calendar link carries a key that can't be guessed from its ids", () => {
  const token = calendarLinkToken("stay-1", "rt-1");
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(isCalendarLinkToken("stay-1", "rt-1", token), true);
  assert.equal(isCalendarLinkToken("stay-1", "rt-2", token), false);
  assert.equal(isCalendarLinkToken("stay-1", "rt-1", "nope"), false);
});

test("a pasted calendar link becomes an https address on the public internet, or is refused", () => {
  assert.equal(normalizeCalendarUrl(" webcal://calendar.othersite.example/ical/1.ics?s=abc "), "https://calendar.othersite.example/ical/1.ics?s=abc");
  assert.equal(calendarLinkHost("https://www.othersite.example/ical/1.ics?s=abc"), "othersite.example");
  for (const bad of ["", "ftp://othersite.example/x.ics", "https://localhost/x.ics", "https://127.0.0.1/x.ics", "https://10.0.0.8/x.ics", "https://169.254.169.254/latest", "https://user:pass@othersite.example/x.ics", "https://othersite.example:8443/x.ics", "https://db.internal/x.ics"]) {
    assert.throws(() => normalizeCalendarUrl(bad), PublicFetchError, bad);
  }
  assert.equal(privateAddress("192.168.1.4"), true);
  assert.equal(privateAddress("::ffff:10.0.0.1"), true);
  assert.equal(privateAddress("8.8.8.8"), false);
  assert.equal(publicUrl("othersite.example/x.ics").protocol, "https:");
});

test("a calendar that can't be read says why instead of failing", async () => {
  const read = await loadCalendarEvents("https://othersite.example/x.ics", async () => otherSite);
  assert.equal(read.error, null);
  assert.ok((read.events ?? []).length >= 2);
  const refused = await loadCalendarEvents("https://othersite.example/x.ics", async () => { throw new PublicFetchError("The other site refused the link."); });
  assert.deepEqual(refused, { events: null, error: "The other site refused the link." });
  const notCalendar = await loadCalendarEvents("https://othersite.example/x.ics", async () => "<html>");
  assert.match(notCalendar.error ?? "", /didn't return a calendar/);
});
