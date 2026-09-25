// shared/calendar-dates.ts
//
// Everything TBM sells happens on the Kenyan coast, so its dates and times are
// Kenya's. A booking's dates are calendar dates, stored as "YYYY-MM-DD": a
// check-in on 20 December is 20 December for a guest browsing from New York,
// London or Mombasa. Calendar dates must never pass through a time-zone
// conversion — new Date("2026-12-20") is midnight UTC, which a browser in the
// US shows as 19 December. Times of day (a pickup, a tour departure) are Kenya
// time and are shown as Kenya time, labelled for visitors on another clock.
// Moments that aren't tied to the coast (when a payment was made, how long
// dates are held) are shown on the viewer's own clock.

export const KENYA_TIME_ZONE = "Africa/Nairobi";
// Kenya is UTC+3 all year: no daylight saving time.
const KENYA_UTC_OFFSET_MINUTES = 180;

function calendarParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim().slice(0, 10));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? [year, month, day] : null;
}

/** Whether a value is a plain calendar date, "YYYY-MM-DD". */
export function isCalendarDate(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && calendarParts(value) !== null;
}

/** A calendar date as a Date at local midnight of that same day — for date pickers and date-fns. */
export function parseCalendarDate(value: string): Date | null {
  const parts = calendarParts(value);
  return parts ? new Date(parts[0], parts[1] - 1, parts[2]) : null;
}

/** A picked day (a local Date) as "YYYY-MM-DD", by its own calendar day. */
export function toCalendarDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const DEFAULT_DATE_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

/** A calendar date, formatted the same in every time zone ("Dec 20, 2026"). */
export function formatCalendarDate(
  value: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_FORMAT,
  locale = "en-US",
): string {
  const parts = calendarParts(value);
  if (!parts) return value;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toLocaleDateString(locale, { ...options, timeZone: "UTC" });
}

/** A range of calendar dates: "Dec 20 – 27, 2026", "Dec 30, 2026 – Jan 2, 2027". */
export function formatCalendarDateRange(start: string, end: string | null | undefined, locale = "en-US"): string {
  const from = calendarParts(start);
  const to = end ? calendarParts(end) : null;
  if (!from) return end ? `${start} – ${end}` : start;
  if (!to || end === start) return formatCalendarDate(start, DEFAULT_DATE_FORMAT, locale);
  const monthDay: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (from[0] === to[0] && from[1] === to[1]) {
    return `${formatCalendarDate(start, monthDay, locale)} – ${to[2]}, ${to[0]}`;
  }
  if (from[0] === to[0]) {
    return `${formatCalendarDate(start, monthDay, locale)} – ${formatCalendarDate(end!, DEFAULT_DATE_FORMAT, locale)}`;
  }
  return `${formatCalendarDate(start, DEFAULT_DATE_FORMAT, locale)} – ${formatCalendarDate(end!, DEFAULT_DATE_FORMAT, locale)}`;
}

/** Whole days from one calendar date to another (nights, for a stay). */
export function daysBetweenCalendarDates(start: string, end: string): number {
  const from = calendarParts(start);
  const to = calendarParts(end);
  if (!from || !to) return NaN;
  return Math.round((Date.UTC(to[0], to[1] - 1, to[2]) - Date.UTC(from[0], from[1] - 1, from[2])) / 86_400_000);
}

/** A calendar date moved by whole days: addCalendarDays("2026-12-31", 1) is "2027-01-01". */
export function addCalendarDays(value: string, days: number): string {
  const parts = calendarParts(value);
  if (!parts) throw new Error("Invalid calendar date");
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days)).toISOString().slice(0, 10);
}

/** Today's date in Kenya, "YYYY-MM-DD" — the earliest day anything can be booked. */
export function todayInKenya(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KENYA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A date and wall-clock time in Kenya ("2026-10-10", "09:00") as an exact moment, in ISO (UTC). */
export function kenyaDateTimeToIso(date: string, time: string): string {
  const clock = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  const parsed = new Date(`${date}T${clock}+03:00`);
  if (!calendarParts(date) || Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date or time");
  }
  return parsed.toISOString();
}

/** Minutes since midnight on Kenya's clock, to compare with Kenya times such as "09:00". */
export function kenyaClockMinutes(now: Date = new Date()): number {
  const kenya = new Date(now.getTime() + KENYA_UTC_OFFSET_MINUTES * 60_000);
  return kenya.getUTCHours() * 60 + kenya.getUTCMinutes();
}

/** Whether a clock is on Kenya time right now (so a "Kenya time" label would add nothing). */
export function isOnKenyaTime(now: Date = new Date()): boolean {
  return -now.getTimezoneOffset() === KENYA_UTC_OFFSET_MINUTES;
}

/** A moment shown as Kenya time: "Sat, Oct 10, 9:00 AM". */
export function formatKenyaDateTime(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  locale = "en-US",
): string {
  const moment = value instanceof Date ? value : new Date(value);
  return Number.isNaN(moment.getTime()) ? String(value) : moment.toLocaleString(locale, { ...options, timeZone: KENYA_TIME_ZONE });
}

/** A Kenya wall-clock time, "HH:MM", as "9:00 AM" — never shifted to another zone. */
export function formatKenyaClockTime(time: string, locale = "en-US"): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return time;
  return new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2]))).toLocaleTimeString(locale, {
    hour: "numeric", minute: "2-digit", timeZone: "UTC",
  });
}
