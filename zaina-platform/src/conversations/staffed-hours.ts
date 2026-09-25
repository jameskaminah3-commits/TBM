// zaina-platform/src/conversations/staffed-hours.ts
//
// When a business's staff answer chats (C4c). A handoff outside those hours
// would leave the customer waiting all night, so Zaina tells them when the
// team is back and keeps helping meanwhile.
//
// Hours are wall-clock times in the business's time zone. A window whose
// close is at or before its open runs past midnight (20:00–02:00).

import type { StaffedHours } from "../db/schema.ts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesOf(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`Invalid time "${time}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Weekday (Sunday = 0) and minutes since midnight on a zone's wall clock. */
function wallClock(timeZone: string, at: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: WEEKDAYS.indexOf(get("weekday")), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function isStaffedAt(hours: StaffedHours | null, timeZone: string, at: Date = new Date()): boolean {
  if (!hours) return true;
  const open = minutesOf(hours.open);
  const close = minutesOf(hours.close);
  const { weekday, minutes } = wallClock(timeZone, at);
  if (close > open) return hours.days.includes(weekday) && minutes >= open && minutes < close;
  // Past midnight: the evening part belongs to today, the early hours to yesterday.
  const yesterday = (weekday + 6) % 7;
  return (hours.days.includes(weekday) && minutes >= open) || (hours.days.includes(yesterday) && minutes < close);
}

/** The next moment staff come on, or null when they are always on. */
export function nextStaffedAt(hours: StaffedHours | null, timeZone: string, from: Date = new Date()): Date | null {
  if (!hours || isStaffedAt(hours, timeZone, from)) return hours ? from : null;
  // Step through the week a minute-aligned quarter hour at a time: simple, and
  // exact for opening times on the quarter hour.
  const step = 15 * 60_000;
  let at = new Date(Math.ceil(from.getTime() / step) * step);
  for (let i = 0; i < (8 * 24 * 60) / 15; i += 1) {
    if (isStaffedAt(hours, timeZone, at)) return at;
    at = new Date(at.getTime() + step);
  }
  return null;
}

/** "Kenya time" for Africa/Nairobi; otherwise the zone's city ("Dar es Salaam time"). */
export function timeZoneLabel(timeZone: string): string {
  if (timeZone === "Africa/Nairobi") return "Kenya time";
  const city = timeZone.split("/").pop()?.replace(/_/g, " ");
  return city ? `${city} time` : timeZone;
}

/** "at 7:00 AM", "tomorrow at 7:00 AM" or "on Monday at 7:00 AM" (business time). */
export function describeOpening(opening: Date, timeZone: string, now: Date = new Date()): string {
  const time = opening.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const day = (at: Date) => at.toLocaleDateString("en-CA", { timeZone });
  if (day(opening) === day(now)) return `at ${time}`;
  if (day(opening) === day(new Date(now.getTime() + 24 * 60 * 60_000))) return `tomorrow at ${time}`;
  return `on ${opening.toLocaleDateString("en-US", { timeZone, weekday: "long" })} at ${time}`;
}
