// zaina-platform/src/booking/local-time.ts
//
// Dates and times on a business's own clock. Opening hours, check-in times
// and appointments are local ("09:30 on 2026-10-26 in Nairobi"); the
// database keeps instants. Kenya has no daylight saving, but the platform
// doesn't assume it: conversions go through the time zone's rules.

export type LocalParts = {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, 24-hour */
  time: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 Sunday … 6 Saturday */
  weekday: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** An instant as the business's clock shows it. */
export function localParts(timeZone: string, instant: Date): LocalParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    minutes: hour * 60 + minute,
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** The UTC offset of a time zone at an instant, in minutes (Nairobi: +180). */
function offsetMinutes(timeZone: string, instant: Date): number {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a local date and time happen in a time zone ("2026-10-26", "09:30"). */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset, even across a daylight-saving change.
  let instant = new Date(guess - offsetMinutes(timeZone, new Date(guess)) * 60_000);
  instant = new Date(guess - offsetMinutes(timeZone, instant) * 60_000);
  return instant;
}

export const minutesOf = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

export const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
