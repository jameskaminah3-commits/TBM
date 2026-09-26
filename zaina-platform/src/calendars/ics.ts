// zaina-platform/src/calendars/ics.ts
//
// iCalendar (RFC 5545), the format every calendar app, channel manager,
// Airbnb and Booking.com share calendars in.
//
//   readBusy     the busy times in a calendar someone else publishes: each
//                event's start and end (a whole-day event keeps its dates),
//                skipping cancelled events and ones marked free. Repeating
//                events count once, at their first date: the calendars
//                businesses import (bookings from a channel) don't repeat.
//   renderFeed   the business's bookings as a calendar to subscribe to.

import { zonedInstant } from "../booking/local-time.ts";
import { addDays, isoDate, parseDate } from "../booking/pricing.ts";

export type BusyTime = {
  uid: string;
  /** A whole-day event: its first day and the day after its last (like a stay's check-in and check-out). */
  days: { from: string; to: string } | null;
  start: Date;
  end: Date;
};

/** Undoes line folding: a line starting with a space or tab continues the one before. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

type Property = { name: string; params: Record<string, string>; value: string };

function property(line: string): Property | null {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 1) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const param of rawParams) {
    const [key, value = ""] = param.split("=");
    params[key.toUpperCase()] = value.replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** A DATE or DATE-TIME value: UTC ("…Z"), in a named zone (TZID), or floating (the business's own time). */
function when(prop: Property, timeZone: string): { date: string | null; instant: Date } | null {
  const value = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || prop.params.VALUE === "DATE") {
    if (!dateOnly) return null;
    const date = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    if (!parseDate(date)) return null;
    return { date, instant: zonedInstant(date, "00:00", timeZone) };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utc] = match;
  if (utc) {
    const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    return Number.isNaN(instant.getTime()) ? null : { date: null, instant };
  }
  let zone = prop.params.TZID || timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    zone = timeZone;
  }
  return { date: null, instant: zonedInstant(`${year}-${month}-${day}`, `${hour}:${minute}`, zone) };
}

/** An ISO 8601 duration like PT1H30M or P1D, in milliseconds. */
function duration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const total = ((Number(weeks ?? 0) * 7 + Number(days ?? 0)) * 24 * 3600 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1000;
  return sign === "-" ? -total : total;
}

/** The busy times in a calendar, in [from, to). Floating times are read in the business's time zone. */
export function readBusy(text: string, options: { timeZone: string; from: Date; to: Date; limit?: number }): BusyTime[] {
  const busy: BusyTime[] = [];
  let event: Property[] | null = null;
  for (const line of unfold(text)) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      event = [];
      continue;
    }
    if (upper === "END:VEVENT") {
      const found = event ? toBusy(event, options.timeZone) : null;
      if (found && found.start < options.to && found.end > options.from) busy.push(found);
      event = null;
      if (busy.length >= (options.limit ?? 5000)) break;
      continue;
    }
    if (event) {
      const prop = property(line);
      if (prop) event.push(prop);
    }
  }
  return busy;
}

function toBusy(props: Property[], timeZone: string): BusyTime | null {
  const get = (name: string) => props.find((prop) => prop.name === name);
  if ((get("STATUS")?.value ?? "").toUpperCase() === "CANCELLED") return null;
  if ((get("TRANSP")?.value ?? "").toUpperCase() === "TRANSPARENT") return null;
  const startProp = get("DTSTART");
  const start = startProp ? when(startProp, timeZone) : null;
  if (!start) return null;
  const uid = (get("UID")?.value ?? "").trim().slice(0, 200) || `${startProp!.value}`;
  const endProp = get("DTEND");
  let end = endProp ? when(endProp, timeZone) : null;
  if (!end) {
    const length = get("DURATION") ? duration(get("DURATION")!.value) : null;
    if (length !== null && length > 0) {
      end = start.date
        ? { date: isoDate(addDays(parseDate(start.date)!, Math.max(1, Math.round(length / 86_400_000)))), instant: new Date(start.instant.getTime() + length) }
        : { date: null, instant: new Date(start.instant.getTime() + length) };
    } else if (start.date) {
      // A whole-day event with no end is one day.
      const next = isoDate(addDays(parseDate(start.date)!, 1));
      end = { date: next, instant: zonedInstant(next, "00:00", timeZone) };
    }
  }
  if (!end || end.instant <= start.instant) return null;
  const days = start.date ? { from: start.date, to: end.date ?? isoDate(addDays(parseDate(start.date)!, 1)) } : null;
  return { uid, days, start: start.instant, end: end.instant };
}

// ── Writing ───────────────────────────────────────────────────────────

/** Escapes text for a property value. */
const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a line at 75 octets, as the format asks. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateValue = (date: string) => date.replace(/-/g, "");

export type FeedEvent = {
  uid: string;
  summary: string;
  description: string;
  /** A stay: whole days, check-in to check-out. */
  days?: { from: string; to: string };
  /** A time slot. */
  start?: Date;
  end?: Date;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  updated: Date;
};

/** A calendar of events to subscribe to. */
export function renderFeed(name: string, events: FeedEvent[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zaina//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${stamp(now)}`, `LAST-MODIFIED:${stamp(event.updated)}`);
    if (event.days) lines.push(`DTSTART;VALUE=DATE:${dateValue(event.days.from)}`, `DTEND;VALUE=DATE:${dateValue(event.days.to)}`);
    else lines.push(`DTSTART:${stamp(event.start!)}`, `DTEND:${stamp(event.end!)}`);
    lines.push(`SUMMARY:${escapeText(event.summary)}`, `DESCRIPTION:${escapeText(event.description)}`, `STATUS:${event.status}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
