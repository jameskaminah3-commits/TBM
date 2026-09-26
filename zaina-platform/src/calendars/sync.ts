// zaina-platform/src/calendars/sync.ts
//
// Keeping a business's bookings and its other calendars in step, every few
// minutes (and when the team asks):
//
//   Busy times in   each calendar source (a Google calendar, or an iCal link
//                   from a channel manager, Airbnb or Booking.com) is read
//                   for the window the business takes bookings in, and its
//                   busy times replace the closures it made last time: nights
//                   of a room type (one room per event), or time for a
//                   person, a table or the whole business. A calendar that
//                   can't be read keeps its last busy times (safer than
//                   forgetting them) and shows the problem in the console.
//   Bookings out    with a Google account connected and a calendar chosen,
//                   each confirmed booking is an event there; a change is
//                   written again, and a booking cancelled (or no longer
//                   confirmed) has its event removed. The platform's own
//                   events are marked, so reading busy times skips them.
//
// One sync per business at a time (in this process).

import { and, eq, gte } from "drizzle-orm";
import { allBusinesses } from "../businesses/registry.ts";
import { getSecret } from "../businesses/secrets.ts";
import { bookings, calendarConnections, calendarEvents, calendarSources, offeringBlocks, offerings, resourceBlocks, resources, takesBookings, type Booking, type Business, type CalendarConnection, type CalendarSource } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { businessDay } from "../gateway/spend-cap.ts";
import { localParts, zonedInstant } from "../booking/local-time.ts";
import { addDays, isoDate, parseDate } from "../booking/pricing.ts";
import { getBookingSettings } from "../booking/settings.ts";
import { feedEvent } from "./feed.ts";
import { fetchIcs } from "./fetch-ics.ts";
import { accessToken, busyEvents, deleteEvent, GOOGLE_SECRET, GoogleAuthError, googleConfigured, insertEvent, updateEvent } from "./google.ts";
import { readBusy } from "./ics.ts";

/** The business secret holding an iCal source's link. */
export const icsSecretName = (sourceId: string) => `ics_${sourceId.replace(/-/g, "")}`;

/** The most busy times one source contributes, and booking events written in one sync. */
const MAX_BUSY = 2000;
const MAX_WRITES = 100;

let consoleBase: string | null = null;

export function configureCalendarSync(next: { publicBaseUrl: string | null }) {
  consoleBase = next.publicBaseUrl;
}

type Busy = { uid: string; days: { from: string; to: string } | null; start: Date; end: Date };

export type SourceResult = { sourceId: string; ok: boolean; busy: number; error?: string };
export type SyncSummary = { sources: SourceResult[]; events: { written: number; removed: number; errors: number }; connection: "none" | "connected" | "error" };

const running = new Set<string>();

export async function getConnection(businessId: string): Promise<CalendarConnection | undefined> {
  const [row] = await inBusiness((db) => db.select().from(calendarConnections).where(eq(calendarConnections.businessId, businessId)).limit(1), businessId);
  return row;
}

export async function listSources(businessId: string): Promise<CalendarSource[]> {
  return inBusiness((db) => db.select().from(calendarSources).where(eq(calendarSources.businessId, businessId)).orderBy(calendarSources.createdAt), businessId);
}

async function markConnection(businessId: string, fields: Partial<CalendarConnection>): Promise<void> {
  await inBusiness((db) => db.update(calendarConnections).set({ ...fields, updatedAt: new Date() }).where(eq(calendarConnections.businessId, businessId)), businessId);
}

/** An access token for the business's Google account, or null (none connected, or Google refused it: the connection is marked). */
export async function googleTokenFor(businessId: string): Promise<string | null> {
  if (!googleConfigured()) return null;
  const connection = await getConnection(businessId);
  if (!connection) return null;
  const refresh = await getSecret(businessId, GOOGLE_SECRET);
  if (!refresh) {
    await markConnection(businessId, { status: "error", lastError: "The Google sign-in is missing: connect again." });
    return null;
  }
  try {
    return await accessToken(refresh);
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await markConnection(businessId, { status: "error", lastError: error.message });
      return null;
    }
    throw error;
  }
}

/** The nights of a busy time: its days, or (a timed event) the nights of the days it touches. */
function nightsOf(busy: Busy, timeZone: string): { from: string; to: string } | null {
  if (busy.days) return busy.days.to > busy.days.from ? busy.days : null;
  const start = localParts(timeZone, busy.start);
  const end = localParts(timeZone, busy.end);
  const to = end.minutes === 0 ? end.date : isoDate(addDays(parseDate(end.date)!, 1));
  return to > start.date ? { from: start.date, to } : null;
}

/** A busy time's instants: a whole-day one from midnight to midnight on the business's clock. */
function instantsOf(busy: Busy, timeZone: string): { start: Date; end: Date } {
  return busy.days ? { start: zonedInstant(busy.days.from, "00:00", timeZone), end: zonedInstant(busy.days.to, "00:00", timeZone) } : { start: busy.start, end: busy.end };
}

async function readSource(business: Business, source: CalendarSource, token: string | null, from: Date, to: Date): Promise<Busy[]> {
  if (source.kind === "google") {
    if (!token) throw new Error("No Google account is connected (or it needs connecting again).");
    return (await busyEvents(token, source.calendarId!, from, to, business.timeZone)).slice(0, MAX_BUSY).map((event) => ({ uid: event.id, days: event.days, start: event.start, end: event.end }));
  }
  const link = await getSecret(business.id, icsSecretName(source.id));
  if (!link) throw new Error("The calendar link is missing: add the calendar again.");
  return readBusy(await fetchIcs(link), { timeZone: business.timeZone, from, to, limit: MAX_BUSY });
}

/** Replaces a source's closures with its busy times now. */
async function writeBusy(business: Business, source: CalendarSource, busy: Busy[], now: Date): Promise<number> {
  const reason = `Busy in ${source.label}`.slice(0, 200);
  return inBusiness(async (db) => {
    let count = 0;
    if (source.offeringId) {
      await db.delete(offeringBlocks).where(and(eq(offeringBlocks.businessId, business.id), eq(offeringBlocks.calendarSourceId, source.id)));
      const rows = busy.map((entry) => ({ entry, nights: nightsOf(entry, business.timeZone) })).filter((row) => row.nights !== null).map(({ entry, nights }) => {
        // At most a year of nights from one event.
        const last = isoDate(addDays(parseDate(nights!.from)!, 366));
        return {
          businessId: business.id, offeringId: source.offeringId!, startsOn: nights!.from, endsOn: nights!.to < last ? nights!.to : last, units: 1,
          reason, source: "calendar" as const, calendarSourceId: source.id, externalId: entry.uid.slice(0, 200),
        };
      });
      for (let index = 0; index < rows.length; index += 500) await db.insert(offeringBlocks).values(rows.slice(index, index + 500));
      count = rows.length;
    } else {
      await db.delete(resourceBlocks).where(and(eq(resourceBlocks.businessId, business.id), eq(resourceBlocks.calendarSourceId, source.id)));
      const seen = new Set<string>();
      const rows = busy.flatMap((entry) => {
        const { start, end } = instantsOf(entry, business.timeZone);
        const capped = new Date(Math.min(end.getTime(), start.getTime() + 366 * 86_400_000));
        const externalId = `${source.id}:${start.toISOString()}:${entry.uid}`.slice(0, 300);
        if (capped <= start || seen.has(externalId)) return [];
        seen.add(externalId);
        return [{ businessId: business.id, resourceId: source.resourceId, startsAt: start, endsAt: capped, reason, source: "calendar" as const, calendarSourceId: source.id, externalId }];
      });
      for (let index = 0; index < rows.length; index += 500) await db.insert(resourceBlocks).values(rows.slice(index, index + 500));
      count = rows.length;
    }
    await db.update(calendarSources).set({ status: "ok", lastError: null, lastSyncAt: now, busyCount: count }).where(eq(calendarSources.id, source.id));
    return count;
  }, business.id);
}

/** Reads one source now (a new one, or the team asked). */
export async function syncSource(business: Business, source: CalendarSource, now = new Date()): Promise<SourceResult> {
  const settings = await getBookingSettings(business.id);
  const from = new Date(now.getTime() - 86_400_000);
  const to = new Date(now.getTime() + (Math.min(settings.bookingHorizonDays, 400) + 2) * 86_400_000);
  try {
    const token = source.kind === "google" ? await googleTokenFor(business.id) : null;
    const busy = await readSource(business, source, token, from, to);
    return { sourceId: source.id, ok: true, busy: await writeBusy(business, source, busy, now) };
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    await inBusiness((db) => db.update(calendarSources).set({ status: "error", lastError: message, lastSyncAt: now }).where(eq(calendarSources.id, source.id)), business.id);
    return { sourceId: source.id, ok: false, busy: 0, error: message };
  }
}

/** Writes confirmed bookings to the business's chosen Google calendar, and removes the ones no longer confirmed. */
async function writeBookings(business: Business, connection: CalendarConnection, token: string, now: Date): Promise<SyncSummary["events"]> {
  const calendarId = connection.writeCalendarId!;
  const from = isoDate(addDays(parseDate(businessDay(business.timeZone, now))!, -1));
  const [confirmed, written, names, people] = await inBusiness(async (db) => Promise.all([
    db.select().from(bookings).where(and(eq(bookings.businessId, business.id), eq(bookings.status, "confirmed"), gte(bookings.checkOut, from))).limit(1000),
    db.select({ event: calendarEvents, status: bookings.status }).from(calendarEvents)
      .innerJoin(bookings, and(eq(bookings.businessId, calendarEvents.businessId), eq(bookings.id, calendarEvents.bookingId)))
      .where(eq(calendarEvents.businessId, business.id)),
    db.select({ id: offerings.id, name: offerings.name }).from(offerings).where(eq(offerings.businessId, business.id)),
    db.select({ id: resources.id, name: resources.name }).from(resources).where(eq(resources.businessId, business.id)),
  ]), business.id);
  const offeringName = new Map(names.map((row) => [row.id, row.name]));
  const personName = new Map(people.map((row) => [row.id, row.name]));
  const byBooking = new Map(written.map((row) => [row.event.bookingId, row]));
  const result = { written: 0, removed: 0, errors: 0 };
  let budget = MAX_WRITES;
  const input = (booking: Booking) => {
    const event = feedEvent(business.id, booking, offeringName.get(booking.offeringId) ?? "Booking", booking.resourceId ? personName.get(booking.resourceId) ?? null : null, consoleBase);
    return { summary: event.summary, description: event.description, days: event.days, start: event.start, end: event.end, timeZone: business.timeZone, bookingId: booking.id, tentative: false };
  };
  const forget = (bookingId: string) => inBusiness((db) => db.delete(calendarEvents).where(and(eq(calendarEvents.businessId, business.id), eq(calendarEvents.bookingId, bookingId))), business.id);
  const remember = (booking: Booking, eventId: string) => inBusiness((db) => db.insert(calendarEvents).values({ businessId: business.id, bookingId: booking.id, calendarId, eventId, syncedVersion: booking.updatedAt, syncedAt: now })
    .onConflictDoUpdate({ target: [calendarEvents.businessId, calendarEvents.bookingId], set: { calendarId, eventId, syncedVersion: booking.updatedAt, syncedAt: now } }), business.id);

  // Bookings no longer confirmed, or written to a calendar no longer chosen: their events go.
  for (const row of written) {
    if (budget <= 0) break;
    if (row.status === "confirmed" && row.event.calendarId === calendarId) continue;
    try {
      budget -= 1;
      await deleteEvent(token, row.event.calendarId, row.event.eventId);
      await forget(row.event.bookingId);
      byBooking.delete(row.event.bookingId);
      result.removed += 1;
    } catch (error) {
      if (error instanceof GoogleAuthError) throw error;
      result.errors += 1;
    }
  }
  for (const booking of confirmed) {
    if (budget <= 0) break;
    const existing = byBooking.get(booking.id);
    if (existing && existing.event.calendarId === calendarId && existing.event.syncedVersion.getTime() >= booking.updatedAt.getTime()) continue;
    try {
      budget -= 1;
      if (existing && existing.event.calendarId === calendarId) {
        await updateEvent(token, calendarId, existing.event.eventId, input(booking));
        await remember(booking, existing.event.eventId);
      } else {
        await remember(booking, await insertEvent(token, calendarId, input(booking)));
      }
      result.written += 1;
    } catch (error) {
      if (error instanceof GoogleAuthError) throw error;
      // An event deleted in Google by hand: write it again next time.
      if ((error as { status?: number }).status === 404 || (error as { status?: number }).status === 410) await forget(booking.id);
      result.errors += 1;
    }
  }
  return result;
}

/** Syncs one business's calendars: busy times in, bookings out. */
export async function syncBusiness(business: Business, now = new Date()): Promise<SyncSummary> {
  const summary: SyncSummary = { sources: [], events: { written: 0, removed: 0, errors: 0 }, connection: "none" };
  if (running.has(business.id)) return summary;
  running.add(business.id);
  try {
    const [connection, sources] = await Promise.all([getConnection(business.id), listSources(business.id)]);
    for (const source of sources) summary.sources.push(await syncSource(business, source, now));
    if (connection) {
      const token = await googleTokenFor(business.id);
      if (!token) {
        summary.connection = "error";
      } else {
        summary.connection = "connected";
        try {
          if (connection.writeCalendarId) summary.events = await writeBookings(business, connection, token, now);
          await markConnection(business.id, { status: "connected", lastError: summary.events.errors ? `${summary.events.errors} booking${summary.events.errors === 1 ? "" : "s"} couldn't be written; trying again next time.` : null, lastSyncAt: now });
        } catch (error) {
          summary.connection = "error";
          await markConnection(business.id, { status: error instanceof GoogleAuthError ? "error" : "connected", lastError: (error as Error).message.slice(0, 500), lastSyncAt: now });
        }
      }
    }
    return summary;
  } finally {
    running.delete(business.id);
  }
}

/** Every business with calendars to keep in step. */
export async function syncAllCalendars(now = new Date()): Promise<number> {
  let synced = 0;
  for (const business of await allBusinesses()) {
    if (!takesBookings(business.businessType)) continue;
    try {
      // Only the business's own rows are visible in its scope.
      const { rows: [row] } = await inBusiness((_db, client) => client.query<{ n: string }>("select (select count(*) from calendar_sources) + (select count(*) from calendar_connections) as n"), business.id);
      if (Number(row?.n ?? 0) === 0) continue;
      await syncBusiness(business, now);
      synced += 1;
    } catch (error) {
      console.error(`[calendars] syncing ${business.id} failed:`, error);
    }
  }
  return synced;
}

/** Removes what a Google connection brought: its sources (and their closures) and the record of events written. */
export async function forgetGoogle(businessId: string): Promise<void> {
  await inBusiness(async (db) => {
    await db.delete(calendarSources).where(and(eq(calendarSources.businessId, businessId), eq(calendarSources.kind, "google")));
    await db.delete(calendarEvents).where(eq(calendarEvents.businessId, businessId));
    await db.delete(calendarConnections).where(eq(calendarConnections.businessId, businessId));
  }, businessId);
}

export const publicSource = (source: CalendarSource) => ({
  id: source.id,
  kind: source.kind,
  calendar_id: source.calendarId,
  label: source.label,
  offering_id: source.offeringId,
  resource_id: source.resourceId,
  status: source.status,
  last_error: source.lastError,
  last_sync_at: source.lastSyncAt,
  busy_count: source.busyCount,
});
