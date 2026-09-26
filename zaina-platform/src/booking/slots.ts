// zaina-platform/src/booking/slots.ts
//
// Which times are free, for businesses that book time (salons, restaurants).
// A booking takes one resource (a stylist, a chair, a table) from its start
// until its end plus the service's buffer (busy_until). A resource is free
// at a time when:
//   - the business is open then, and so is the resource (its own hours, if
//     it has them, inside the business's);
//   - no booking that takes it overlaps (confirmed, or unpaid or requested
//     while its hold lasts, as for rooms);
//   - no closure covers it: the resource's own, or the whole business's
//     (time off, a private event, a busy time from a connected calendar).
// A table must seat the party, and not be kept for bigger parties
// (min_party). Booking locks the business's slots for one short
// transaction, so two customers can't both get the last table at 8pm.

import type pg from "pg";
import type { Offering, Resource, WeekHours } from "../db/schema.ts";
import { localParts, minutesOf, TIME_PATTERN, timeOf, zonedInstant } from "./local-time.ts";
import { addDays, isoDate, parseDate } from "./pricing.ts";

const WEEKDAYS = ["0", "1", "2", "3", "4", "5", "6"] as const;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Checks a week of opening hours; a closing time before the opening one runs past midnight. */
export function validateWeekHours(input: unknown): { ok: true; hours: WeekHours } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "hours is an object of weekdays (0 Sunday to 6 Saturday)" };
  const hours: WeekHours = {};
  for (const [day, value] of Object.entries(input as Record<string, unknown>)) {
    if (!WEEKDAYS.includes(day as (typeof WEEKDAYS)[number])) return { ok: false, error: `hours: ${day} isn't a weekday (0 Sunday to 6 Saturday)` };
    if (!Array.isArray(value) || value.length > 4) return { ok: false, error: `hours for ${DAY_NAMES[Number(day)]} is a list of up to 4 [opens, closes]` };
    const spans: Array<[string, string]> = [];
    for (const span of value) {
      if (!Array.isArray(span) || span.length !== 2 || !span.every((time) => typeof time === "string" && TIME_PATTERN.test(time)) || span[0] === span[1]) {
        return { ok: false, error: `hours for ${DAY_NAMES[Number(day)]}: each span is [opens, closes], like ["09:00", "18:00"]` };
      }
      spans.push([span[0], span[1]]);
    }
    const minutes = spans.map(([opens, closes]) => spanMinutes(opens, closes)).sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < minutes.length; index += 1) {
      if (minutes[index][0] < minutes[index - 1][1]) return { ok: false, error: `hours for ${DAY_NAMES[Number(day)]} overlap` };
    }
    if (spans.length) hours[day as (typeof WEEKDAYS)[number]] = spans;
  }
  return { ok: true, hours };
}

/** A span in minutes from the day's midnight; closing past midnight counts on (up to 48:00). */
function spanMinutes(opens: string, closes: string): [number, number] {
  const start = minutesOf(opens);
  let end = minutesOf(closes);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

/** The spans a week is open on a weekday, in minutes, in order. */
export function openSpans(week: WeekHours | null | undefined, weekday: number): Array<[number, number]> {
  const spans = week?.[String(weekday) as (typeof WEEKDAYS)[number]] ?? [];
  return spans.map(([opens, closes]) => spanMinutes(opens, closes)).sort((a, b) => a[0] - b[0]);
}

/** Where two lists of spans overlap. */
export function intersectSpans(a: Array<[number, number]>, b: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [aStart, aEnd] of a) {
    for (const [bStart, bEnd] of b) {
      const start = Math.max(aStart, bStart);
      const end = Math.min(aEnd, bEnd);
      if (end > start) out.push([start, end]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** The week in words, for Zaina and the console: "Mon–Fri 09:00–18:00; Sat 10:00–16:00; Sun closed". */
export function describeWeek(week: WeekHours): string {
  const short = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const text = (day: number) => (week[String(day) as (typeof WEEKDAYS)[number]] ?? []).map(([opens, closes]) => `${opens}–${closes}`).join(", ") || "closed";
  const groups: Array<{ days: number[]; text: string }> = [];
  for (const day of order) {
    const last = groups.at(-1);
    if (last && last.text === text(day)) last.days.push(day);
    else groups.push({ days: [day], text: text(day) });
  }
  return groups.map((group) => `${short[group.days[0]]}${group.days.length > 1 ? `–${short[group.days.at(-1)!]}` : ""} ${group.text}`).join("; ");
}

// ── What a booking can take ───────────────────────────────────────────

/** The resources that can take an offering for a party: the ones linked to it, or any that fits its kind. */
export function eligibleResources(offering: Pick<Offering, "id" | "kind">, all: Resource[], links: Array<{ offeringId: string; resourceId: string }>, party: number): Resource[] {
  const linked = new Set(links.filter((link) => link.offeringId === offering.id).map((link) => link.resourceId));
  const active = all.filter((resource) => resource.status === "active");
  const candidates = linked.size
    ? active.filter((resource) => linked.has(resource.id))
    : active.filter((resource) => (offering.kind === "table" ? resource.kind === "table" : resource.kind !== "table"));
  const fits = candidates.filter((resource) => offering.kind !== "table" || (resource.seats >= party && resource.minParty <= party));
  // Tables: the smallest that seats the party first, so big tables stay free for big parties.
  return fits.sort((a, b) => (offering.kind === "table" ? a.seats - b.seats : 0) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export type Busy = {
  /** Bookings that take a resource: from their start until busy_until. */
  bookings: Array<{ id: string; resourceId: string | null; start: Date; end: Date }>;
  /** Closures: a resource's, or the whole business's (resourceId null). */
  blocks: Array<{ resourceId: string | null; start: Date; end: Date }>;
};

/** Locks a business's time slots until the end of the transaction. */
export async function lockSlots(client: pg.PoolClient, businessId: string): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`slots:${businessId}`]);
}

/** Everything that takes resources between two instants. */
export async function busyBetween(client: pg.PoolClient, businessId: string, from: Date, to: Date, excludeBookingId: string | null = null): Promise<Busy> {
  const [bookings, blocks] = await Promise.all([
    client.query<{ id: string; resource_id: string | null; starts_at: Date; busy_until: Date }>(
      `select b.id, b.resource_id, b.starts_at, b.busy_until from bookings as b
        where b.business_id = $1 and b.starts_at is not null and b.starts_at < $3 and b.busy_until > $2
          and (b.status = 'confirmed' or (b.status in ('held', 'requested', 'awaiting_payment') and b.hold_expires_at > now()))
          and ($4::uuid is null or b.id <> $4::uuid)`,
      [businessId, from, to, excludeBookingId],
    ),
    client.query<{ resource_id: string | null; starts_at: Date; ends_at: Date }>(
      "select resource_id, starts_at, ends_at from resource_blocks where business_id = $1 and starts_at < $3 and ends_at > $2",
      [businessId, from, to],
    ),
  ]);
  return {
    bookings: bookings.rows.map((row) => ({ id: row.id, resourceId: row.resource_id, start: row.starts_at, end: row.busy_until })),
    blocks: blocks.rows.map((row) => ({ resourceId: row.resource_id, start: row.starts_at, end: row.ends_at })),
  };
}

const overlaps = (start: Date, end: Date, other: { start: Date; end: Date }) => other.start < end && other.end > start;

/** Whether a resource is taken or closed for a booking from start until end (busyUntil: plus its buffer). */
export function resourceBusy(resourceId: string, start: Date, end: Date, busyUntil: Date, busy: Busy): boolean {
  return busy.bookings.some((booking) => booking.resourceId === resourceId && overlaps(start, busyUntil, booking))
    || busy.blocks.some((block) => (block.resourceId === null || block.resourceId === resourceId) && overlaps(start, end, block));
}

/** Whether a resource works the whole of a booking: inside the business's hours and its own. */
export function resourceWorks(resource: Resource, businessHours: WeekHours, start: Date, end: Date, timeZone: string): boolean {
  const local = localParts(timeZone, start);
  const length = Math.round((end.getTime() - start.getTime()) / 60_000);
  // The booking's minutes from its local midnight, checked against that day's spans and the previous day's (past midnight).
  for (const [offset, weekday] of [[0, local.weekday], [24 * 60, (local.weekday + 6) % 7]] as const) {
    const from = local.minutes + offset;
    let spans = openSpans(businessHours, weekday);
    if (resource.hours) spans = intersectSpans(spans, openSpans(resource.hours, weekday));
    if (spans.some(([opens, closes]) => from >= opens && from + length <= closes)) return true;
  }
  return false;
}

export type SlotOffer = {
  /** HH:MM on the business's clock. */
  time: string;
  startsAt: Date;
  endsAt: Date;
  busyUntil: Date;
  /** The resources free for it, best first. */
  resourceIds: string[];
};

export type SlotPolicy = { openingHours: WeekHours; slotIntervalMinutes: number; minNoticeHours: number; bookingHorizonDays: number };

/** Whether a day is one customers can book: not past, and within how far ahead the business takes bookings. */
export function dayProblem(date: string, timeZone: string, policy: Pick<SlotPolicy, "bookingHorizonDays">, now: Date): { error: "invalid_dates" | "too_soon" | "too_far"; message: string } | null {
  const day = parseDate(date);
  if (!day) return { error: "invalid_dates", message: "The date is YYYY-MM-DD." };
  const today = localParts(timeZone, now).date;
  if (date < today) return { error: "too_soon", message: `That day has passed (today is ${today}).` };
  const last = isoDate(addDays(parseDate(today)!, policy.bookingHorizonDays));
  if (date > last) return { error: "too_far", message: `Bookings can be made up to ${last}.` };
  return null;
}

/**
 * The times an offering can start on a day, for a party: every
 * slot_interval_minutes from when each span opens, while the booking ends by
 * closing time, not sooner than the business's notice, with at least one
 * resource free.
 */
export function freeSlots(input: {
  date: string;
  timeZone: string;
  policy: SlotPolicy;
  offering: Pick<Offering, "durationMinutes" | "bufferMinutes">;
  resources: Resource[];
  busy: Busy;
  now: Date;
  skipNotice?: boolean;
}): SlotOffer[] {
  const day = parseDate(input.date);
  if (!day) return [];
  const duration = input.offering.durationMinutes ?? 60;
  const buffer = input.offering.bufferMinutes;
  const step = input.policy.slotIntervalMinutes;
  const earliest = new Date(input.now.getTime() + (input.skipNotice ? 0 : input.policy.minNoticeHours * 3_600_000));
  const weekday = day.getUTCDay();
  const spans = openSpans(input.policy.openingHours, weekday);
  const nextDay = isoDate(addDays(day, 1));
  const offers: SlotOffer[] = [];
  for (const [opens, closes] of spans) {
    for (let minute = opens; minute + duration <= closes; minute += step) {
      const startsAt = minute >= 24 * 60 ? zonedInstant(nextDay, timeOf(minute - 24 * 60), input.timeZone) : zonedInstant(input.date, timeOf(minute), input.timeZone);
      if (startsAt < earliest) continue;
      const endsAt = new Date(startsAt.getTime() + duration * 60_000);
      const busyUntil = new Date(endsAt.getTime() + buffer * 60_000);
      const free = input.resources.filter((resource) => resourceWorks(resource, input.policy.openingHours, startsAt, endsAt, input.timeZone) && !resourceBusy(resource.id, startsAt, endsAt, busyUntil, input.busy));
      if (free.length) offers.push({ time: timeOf(minute % (24 * 60)), startsAt, endsAt, busyUntil, resourceIds: free.map((resource) => resource.id) });
    }
  }
  return offers;
}

/** The window of instants a local day's slots can touch (with room for spans past midnight and buffers). */
export function dayWindow(date: string, timeZone: string): { from: Date; to: Date } {
  const start = zonedInstant(date, "00:00", timeZone);
  return { from: new Date(start.getTime() - 12 * 3_600_000), to: new Date(start.getTime() + 60 * 3_600_000) };
}
