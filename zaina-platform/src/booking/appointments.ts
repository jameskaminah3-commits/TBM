// zaina-platform/src/booking/appointments.ts
//
// Time slots as Zaina and the console ask for them: the times free for a
// service or table on a day, the next days with times free, and a day's
// schedule for the team. The rules for what is free are in slots.ts; making
// the booking is bookings.ts (createSlotBooking).

import { and, asc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { bookings, offeringResources, offerings, resources, type Booking, type Business, type Offering, type Resource } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { localParts, zonedInstant } from "./local-time.ts";
import { addDays, isoDate, parseDate } from "./pricing.ts";
import { getBookingSettings } from "./settings.ts";
import { busyBetween, dayProblem, dayWindow, eligibleResources, freeSlots, type SlotOffer } from "./slots.ts";

export type DaySlots =
  | { ok: true; date: string; slots: SlotOffer[]; resources: Resource[] }
  | { ok: false; error: "invalid_dates" | "too_soon" | "too_far" | "no_resources"; message: string };

/**
 * The times an offering can start on a day for a party: optionally only with
 * one resource (a stylist the customer asked for). Staff see times inside
 * the notice too.
 */
export async function slotsOn(business: Pick<Business, "id" | "timeZone">, offering: Offering, date: string, party: number, options: { resourceId?: string | null; staff?: boolean; now?: Date } = {}): Promise<DaySlots> {
  const now = options.now ?? new Date();
  const settings = await getBookingSettings(business.id);
  const problem = dayProblem(date, business.timeZone, settings, now);
  if (problem) return { ok: false, ...problem };
  return inBusiness(async (db, client) => {
    const [all, links] = await Promise.all([
      db.select().from(resources).where(eq(resources.businessId, business.id)),
      db.select({ offeringId: offeringResources.offeringId, resourceId: offeringResources.resourceId }).from(offeringResources).where(eq(offeringResources.businessId, business.id)),
    ]);
    let eligible = eligibleResources(offering, all, links, party);
    if (options.resourceId) eligible = eligible.filter((resource) => resource.id === options.resourceId);
    if (!eligible.length) return { ok: false, error: "no_resources", message: `Nobody is set up to take ${offering.name}${offering.kind === "table" ? ` for ${party}` : ""}.` } as const;
    const window = dayWindow(date, business.timeZone);
    const busy = await busyBetween(client, business.id, window.from, window.to);
    const slots = freeSlots({ date, timeZone: business.timeZone, policy: settings, offering, resources: eligible, busy, now, skipNotice: options.staff });
    return { ok: true, date, slots, resources: eligible } as const;
  }, business.id);
}

/** The next days (from `from`, up to two weeks) that have a time free, with their first few times. */
export async function nextFreeDays(business: Pick<Business, "id" | "timeZone">, offering: Offering, from: string, party: number, options: { resourceId?: string | null; days?: number; perDay?: number } = {}): Promise<Array<{ date: string; times: string[] }>> {
  const start = parseDate(from);
  if (!start) return [];
  const found: Array<{ date: string; times: string[] }> = [];
  for (let offset = 0; offset < (options.days ?? 14) && found.length < 3; offset += 1) {
    const date = isoDate(addDays(start, offset));
    const day = await slotsOn(business, offering, date, party, { resourceId: options.resourceId });
    if (!day.ok) {
      if (day.error === "too_far" || day.error === "no_resources") break;
      continue;
    }
    if (day.slots.length) found.push({ date, times: day.slots.slice(0, options.perDay ?? 4).map((slot) => slot.time) });
  }
  return found;
}

/** The instant a local date and time ("2026-10-26", "14:30") happen for a business. */
export const slotInstant = (date: string, time: string, timeZone: string) => zonedInstant(date, time, timeZone);

export type ScheduleEntry = { booking: Booking; offeringName: string };

/** A day for the team: each resource and the bookings it has that day (taking it or not). */
export async function daySchedule(business: Pick<Business, "id" | "timeZone">, date: string): Promise<{ resources: Resource[]; entries: ScheduleEntry[] }> {
  const from = zonedInstant(date, "00:00", business.timeZone);
  const to = zonedInstant(isoDate(addDays(parseDate(date)!, 1)), "00:00", business.timeZone);
  return inBusiness(async (db) => {
    const [list, rows] = await Promise.all([
      db.select().from(resources).where(eq(resources.businessId, business.id)).orderBy(asc(resources.sortOrder), asc(resources.name)),
      db.select({ booking: bookings, offeringName: offerings.name }).from(bookings)
        .innerJoin(offerings, and(eq(offerings.businessId, bookings.businessId), eq(offerings.id, bookings.offeringId)))
        .where(and(eq(bookings.businessId, business.id), isNotNull(bookings.startsAt), gte(bookings.startsAt, from), lt(bookings.startsAt, to),
          sql`${bookings.status} not in ('declined', 'expired')`))
        .orderBy(asc(bookings.startsAt)),
    ]);
    return { resources: list, entries: rows };
  }, business.id);
}

/** Today's date on the business's clock. */
export const todayFor = (timeZone: string, now = new Date()) => localParts(timeZone, now).date;
