// zaina-platform/src/calendars/feed.ts
//
// Private calendar links (iCal feeds) to a business's bookings, for the
// calendar apps its team already uses: Google Calendar, Apple Calendar,
// Outlook. A link shows every booking, or one person's or table's. Whoever
// has a link can read it, so the platform keeps only a hash of its token,
// shows the link once, and a link is revoked by deleting it.
//
// Each booking is an event: a stay as whole days (check-in to check-out),
// a time slot at its time. Unconfirmed bookings are tentative and say so;
// cancelled, declined and lapsed ones drop out. Events carry the booking's
// reference and the customer's name, not their phone or email.

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { appPool } from "../db/platform-db.ts";
import { bookings, calendarFeeds, offerings, resources, type Booking, type Business, type CalendarFeed } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { businessDay } from "../gateway/spend-cap.ts";
import { addDays, isoDate, parseDate } from "../booking/pricing.ts";
import { renderFeed, type FeedEvent } from "./ics.ts";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new feed link: its row, and the token for its address (shown once). */
export async function createFeed(businessId: string, input: { resourceId: string | null; label: string; createdBy: string | null }): Promise<{ feed: CalendarFeed; token: string }> {
  const token = randomBytes(24).toString("base64url");
  const [feed] = await inBusiness((db) => db.insert(calendarFeeds).values({
    businessId, tokenHash: hashToken(token), resourceId: input.resourceId, label: input.label, createdBy: input.createdBy,
  }).returning(), businessId);
  return { feed, token };
}

export async function listFeeds(businessId: string): Promise<CalendarFeed[]> {
  return inBusiness((db) => db.select().from(calendarFeeds).where(eq(calendarFeeds.businessId, businessId)).orderBy(desc(calendarFeeds.createdAt)), businessId);
}

export async function deleteFeed(businessId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await inBusiness((db) => db.delete(calendarFeeds).where(and(eq(calendarFeeds.businessId, businessId), eq(calendarFeeds.id, id))).returning({ id: calendarFeeds.id }), businessId);
  return rows.length > 0;
}

/** The business and feed behind a link's token, found without any business in scope. */
export async function feedForToken(token: string): Promise<{ businessId: string; feedId: string } | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const { rows: [row] } = await appPool().query<{ business_id: string; feed_id: string }>("select business_id, feed_id from calendar_feed_route($1)", [hashToken(token)]);
  return row ? { businessId: row.business_id, feedId: row.feed_id } : null;
}

const SHOWN: Booking["status"][] = ["confirmed", "held", "awaiting_payment", "requested", "conflict"];

const PREFIX: Partial<Record<Booking["status"], string>> = {
  requested: "Request: ",
  held: "Awaiting deposit: ",
  awaiting_payment: "Awaiting deposit: ",
  conflict: "Needs you: ",
};

/** The events of one feed: a month back to a year and a bit ahead. */
export async function feedCalendar(business: Pick<Business, "id" | "name" | "timeZone">, feedId: string, options: { consoleBase?: string | null; now?: Date } = {}): Promise<string | null> {
  const now = options.now ?? new Date();
  return inBusiness(async (db) => {
    const [feed] = await db.select().from(calendarFeeds).where(and(eq(calendarFeeds.businessId, business.id), eq(calendarFeeds.id, feedId))).limit(1);
    if (!feed) return null;
    const from = isoDate(addDays(parseDate(businessDay(business.timeZone, now))!, -31));
    const rows = await db.select({ booking: bookings, offeringName: offerings.name }).from(bookings)
      .innerJoin(offerings, and(eq(offerings.businessId, bookings.businessId), eq(offerings.id, bookings.offeringId)))
      .where(and(
        eq(bookings.businessId, business.id),
        inArray(bookings.status, SHOWN),
        gte(bookings.checkOut, from),
        feed.resourceId ? eq(bookings.resourceId, feed.resourceId) : sql`true`,
      ))
      .orderBy(bookings.checkIn)
      .limit(3000);
    const people = new Map((await db.select({ id: resources.id, name: resources.name }).from(resources).where(eq(resources.businessId, business.id))).map((row) => [row.id, row.name]));
    // Reading the feed is noted at most every 10 minutes.
    if (!feed.lastReadAt || now.getTime() - feed.lastReadAt.getTime() > 10 * 60_000) {
      await db.update(calendarFeeds).set({ lastReadAt: now }).where(eq(calendarFeeds.id, feed.id));
    }
    const events: FeedEvent[] = rows.map(({ booking, offeringName }) => feedEvent(business.id, booking, offeringName, booking.resourceId ? people.get(booking.resourceId) ?? null : null, options.consoleBase ?? null));
    const title = feed.resourceId ? `${business.name}: ${people.get(feed.resourceId) ?? "bookings"}` : `${business.name} bookings`;
    return renderFeed(title, events, now);
  }, business.id);
}

/** One booking as an event, for a feed or a connected calendar. */
export function feedEvent(businessId: string, booking: Booking, offeringName: string, resourceName: string | null, consoleBase: string | null): FeedEvent {
  const who = booking.startsAt ? (booking.guests > 1 ? `${booking.guests} people` : null) : `${booking.guests} guest${booking.guests === 1 ? "" : "s"}${booking.units > 1 ? `, ${booking.units} rooms` : ""}`;
  const description = [
    `Booking ${booking.reference}`,
    who,
    resourceName ? `With ${resourceName}` : null,
    booking.status === "confirmed" ? null : `Not confirmed yet (${booking.status.replace("_", " ")})`,
    booking.customerNotes ? `Notes: ${booking.customerNotes}` : null,
    consoleBase ? `${consoleBase}/console/#/b/${encodeURIComponent(businessId)}/bookings/${booking.id}` : null,
  ].filter(Boolean).join("\n");
  return {
    uid: `${booking.id}@zaina`,
    summary: `${PREFIX[booking.status] ?? ""}${offeringName} · ${booking.customerName}`,
    description,
    ...(booking.startsAt ? { start: booking.startsAt, end: booking.endsAt! } : { days: { from: booking.checkIn, to: booking.checkOut } }),
    status: booking.status === "confirmed" ? "CONFIRMED" : "TENTATIVE",
    updated: booking.updatedAt,
  };
}

export const publicFeed = (feed: CalendarFeed) => ({
  id: feed.id,
  resource_id: feed.resourceId,
  label: feed.label,
  created_at: feed.createdAt,
  last_read_at: feed.lastReadAt,
});
