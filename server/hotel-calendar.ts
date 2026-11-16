// server/hotel-calendar.ts
//
// Keeping a hotel's calendar in step with other booking sites.
//
// Booking.com, Airbnb and most other sites publish each listing's calendar as
// an iCal link, and take one back. TBM reads the link a hotel gives it and
// blocks the nights taken there; and it gives the hotel a link of its own for
// each room type, listing the nights that are taken here, to paste into the
// other site.
//
// What TBM's own link lists is only what was taken on TBM (its bookings, and
// the nights the hotel blocked by hand). Nights that came in from another
// site's calendar are never sent back out: two calendars that copied each
// other's blocks would keep a night closed after the booking behind it was
// cancelled.

import crypto from "node:crypto";
import { addCalendarDays, isCalendarDate, todayInKenya } from "../shared/calendar-dates.ts";
import { countRoomsLeft, type RoomClaim } from "../shared/hotel-rooms.ts";
import { fetchPublic, publicUrl, PublicFetchError } from "./public-fetch.ts";

/** A stretch of nights taken on a calendar. Like a check-out, `endDate` is the day they're free again. */
export type CalendarEvent = { uid: string; startDate: string; endDate: string };

// How far ahead a calendar is read, and how much of it.
const MAX_DAYS_AHEAD = 730;
const MAX_EVENTS = 1000;
const MAX_CALENDAR_BYTES = 2 * 1024 * 1024;
const CALENDAR_TIMEOUT_MS = 15_000;

/** A calendar file's lines, with long lines that were folded over several joined up again. */
function unfoldLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

/**
 * The calendar day of an iCal date or date-time, in Kenya. A plain date
 * ("20261201") and a time with a time zone of its own or none are read as
 * written; a UTC time ("…Z") is the day it falls on in Kenya.
 */
function toCalendarDay(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second, utc] = match;
  let date = `${year}-${month}-${day}`;
  if (utc) {
    const moment = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    if (Number.isNaN(moment.getTime())) {
      return null;
    }
    date = todayInKenya(moment);
  }
  return isCalendarDate(date) ? date : null;
}

/**
 * The nights a calendar file says are taken, from today on. Every event
 * counts, whatever its wording: sites write "Reserved", "Not available" or
 * "CLOSED". Cancelled events are left out.
 */
export function parseCalendarEvents(text: string, today: string = todayInKenya()): CalendarEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new PublicFetchError("That link didn't return a calendar. Copy the calendar (iCal) link from the other site's calendar sync settings.");
  }
  const horizon = addCalendarDays(today, MAX_DAYS_AHEAD);
  const events: CalendarEvent[] = [];
  let current: { uid?: string; start?: string; end?: string; cancelled?: boolean } | null = null;

  for (const line of unfoldLines(text)) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (upper === "END:VEVENT") {
      const event = current;
      current = null;
      if (!event?.start || event.cancelled) {
        continue;
      }
      const startDate = event.start;
      let endDate = event.end && event.end > startDate ? event.end : addCalendarDays(startDate, 1);
      if (endDate <= today || startDate > horizon) {
        continue;
      }
      if (endDate > horizon) {
        endDate = horizon;
      }
      events.push({ uid: event.uid || `${startDate}/${endDate}`, startDate, endDate });
      if (events.length >= MAX_EVENTS) {
        break;
      }
      continue;
    }
    if (!current) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const name = line.slice(0, colon).split(";")[0].trim().toUpperCase();
    const value = line.slice(colon + 1).trim();
    if (name === "UID") {
      current.uid = value.slice(0, 300);
    } else if (name === "DTSTART") {
      current.start = toCalendarDay(value) ?? undefined;
    } else if (name === "DTEND") {
      current.end = toCalendarDay(value) ?? undefined;
    } else if (name === "STATUS") {
      current.cancelled = value.toUpperCase() === "CANCELLED";
    }
  }
  return events.sort((left, right) => left.startDate.localeCompare(right.startDate));
}

const compactDay = (date: string) => date.replace(/-/g, "");
const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/**
 * A calendar file of taken nights, for another booking site to read. It says
 * only that the nights aren't available: never who booked them.
 */
export function buildCalendar(params: { name: string; events: CalendarEvent[]; now?: Date }): string {
  const stamp = (params.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tembea Bila Matata//Availability//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(params.name)}`,
  ];
  for (const event of params.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDay(event.startDate)}`,
      `DTEND;VALUE=DATE:${compactDay(event.endDate)}`,
      "SUMMARY:Not available",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * The nights no room of a type is left because of what was taken on TBM,
 * from today on, as stretches of nights for the calendar TBM gives out.
 */
export function getTakenStretches(
  roomType: { id: string; roomCount: number },
  ownClaims: RoomClaim[],
  today: string = todayInKenya(),
): CalendarEvent[] {
  const lastHeld = ownClaims.reduce((latest, claim) => (claim.lastNight > latest ? claim.lastNight : latest), today);
  const lastNight = lastHeld < addCalendarDays(today, MAX_DAYS_AHEAD) ? lastHeld : addCalendarDays(today, MAX_DAYS_AHEAD);
  const stretches: CalendarEvent[] = [];
  let open: CalendarEvent | null = null;
  for (let night = today; night <= lastNight; night = addCalendarDays(night, 1)) {
    const taken = roomType.roomCount > 0 && countRoomsLeft(roomType, ownClaims, night, night) === 0;
    if (taken && open) {
      open.endDate = addCalendarDays(night, 1);
    } else if (taken) {
      open = { uid: `tbm-${roomType.id}-${night}`, startDate: night, endDate: addCalendarDays(night, 1) };
      stretches.push(open);
    } else {
      open = null;
    }
  }
  return stretches;
}

// ─── Links ──────────────────────────────────────────────────────────────

function calendarSecret(): string {
  return process.env.SESSION_SECRET || "tbm-calendar-links";
}

/**
 * The key in a room type's calendar link. Anyone with the link can read which
 * nights are taken (and nothing else), so the link can't be guessed from the
 * hotel's and room's ids.
 */
export function calendarLinkToken(stayId: string, roomTypeId: string): string {
  return crypto.createHmac("sha256", calendarSecret()).update(`stay-calendar:${stayId}:${roomTypeId}`).digest("hex").slice(0, 32);
}

export function isCalendarLinkToken(stayId: string, roomTypeId: string, token: string): boolean {
  const expected = Buffer.from(calendarLinkToken(stayId, roomTypeId));
  const given = Buffer.from(String(token));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** A calendar link someone pasted, as the https address to read, or why it can't be used. */
export function normalizeCalendarUrl(input: string): string {
  const text = String(input ?? "").trim().replace(/^webcals?:\/\//i, "https://");
  if (!text) {
    throw new PublicFetchError("Paste the calendar (iCal) link from the other site.");
  }
  return publicUrl(text).toString();
}

/** The site a calendar link belongs to ("airbnb.com"): shown instead of the link, which is private. */
export function calendarLinkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Reads a calendar link on the public internet. */
export async function readCalendar(url: string): Promise<string> {
  const response = await fetchPublic(url, {
    accept: "text/calendar, text/plain;q=0.8, */*;q=0.5",
    maxBytes: MAX_CALENDAR_BYTES,
    timeoutMs: CALENDAR_TIMEOUT_MS,
    userAgent: "TembeaBilaMatata-CalendarSync/1.0",
  });
  if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 410) {
    throw new PublicFetchError("The other site refused the link. Copy a fresh calendar (iCal) link from its calendar sync settings.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new PublicFetchError("The other site couldn't give its calendar just now. We'll try again shortly.");
  }
  return response.body.toString("utf8");
}

/**
 * Reads a calendar and says which nights it has taken, or why it couldn't be
 * read. Never throws: a calendar that can't be read keeps the nights it
 * blocked before, and the reason is shown to the hotel.
 */
export async function loadCalendarEvents(
  url: string,
  read: (url: string) => Promise<string> = readCalendar,
): Promise<{ events: CalendarEvent[]; error: null } | { events: null; error: string }> {
  try {
    return { events: parseCalendarEvents(await read(url)), error: null };
  } catch (error) {
    if (error instanceof PublicFetchError) {
      return { events: null, error: error.message };
    }
    console.error("[CALENDAR_SYNC] Could not read a calendar:", error instanceof Error ? error.message : error);
    return { events: null, error: "The calendar couldn't be read just now. We'll try again shortly." };
  }
}
