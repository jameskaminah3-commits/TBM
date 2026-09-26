// zaina-platform/src/booking/availability.ts
//
// Which rooms are free. On any night, a room is taken by:
//   - a confirmed booking;
//   - an unpaid booking, or a request, while its hold lasts;
//   - a block (repairs, or a room sold elsewhere).
// Booking locks the room type for one short transaction, so two customers
// can't both get the last room: the same lock-and-hold the C1 fix gave TBM.

import type pg from "pg";
import { inBusiness } from "../db/tenant.ts";
import { addDays, isoDate, parseDate } from "./pricing.ts";

/** A booking that takes its rooms right now (SQL, over bookings as b). */
export const TAKES_ROOMS = `(b.status = 'confirmed' or (b.status in ('held', 'requested', 'awaiting_payment') and b.hold_expires_at > now()))`;

/** Locks a room type until the end of the transaction. */
export async function lockOffering(client: pg.PoolClient, offeringId: string): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`offering:${offeringId}`]);
}

/** The most rooms of a type taken on any night of a stay. */
export async function roomsTaken(
  client: pg.PoolClient,
  input: { businessId: string; offeringId: string; checkIn: string; checkOut: string; excludeBookingId?: string | null },
): Promise<number> {
  const { rows: [row] } = await client.query<{ taken: number }>(
    `select coalesce(max(
        coalesce((select sum(b.units) from bookings as b
          where b.business_id = $1 and b.offering_id = $2
            and b.check_in <= n.night and b.check_out > n.night
            and ${TAKES_ROOMS}
            and ($5::uuid is null or b.id <> $5::uuid)), 0)
      + coalesce((select sum(k.units) from offering_blocks as k
          where k.business_id = $1 and k.offering_id = $2
            and k.starts_on <= n.night and k.ends_on > n.night), 0)
      ), 0)::int as taken
     from (select d::date as night from generate_series($3::date, $4::date - 1, interval '1 day') as d) as n`,
    [input.businessId, input.offeringId, input.checkIn, input.checkOut, input.excludeBookingId ?? null],
  );
  return row?.taken ?? 0;
}

export type CalendarNight = { night: string; booked: number; held: number; blocked: number; free: number };
export type CalendarRoom = { offering_id: string; name: string; units: number; status: string; nights: CalendarNight[] };

/** Rooms booked, held, blocked and free, per room type and night, for the console's calendar. */
export async function calendar(businessId: string, from: string, days: number): Promise<{ nights: string[]; rooms: CalendarRoom[] }> {
  const start = parseDate(from);
  if (!start) throw new Error("from is a date");
  const nights = Array.from({ length: days }, (_, index) => isoDate(addDays(start, index)));
  const end = isoDate(addDays(start, days));
  return inBusiness(async (_db, client) => {
    const { rows: rooms } = await client.query<{ id: string; name: string; units: number; status: string }>(
      "select id, name, units, status from offerings where business_id = $1 order by sort_order, name",
      [businessId],
    );
    const { rows: stays } = await client.query<{ offering_id: string; check_in: string; check_out: string; units: number; status: string }>(
      `select b.offering_id, b.check_in::text, b.check_out::text, b.units, b.status
       from bookings as b
       where b.business_id = $1 and b.check_in < $3::date and b.check_out > $2::date and ${TAKES_ROOMS}`,
      [businessId, from, end],
    );
    const { rows: blocks } = await client.query<{ offering_id: string; starts_on: string; ends_on: string; units: number }>(
      `select offering_id, starts_on::text, ends_on::text, units from offering_blocks
       where business_id = $1 and starts_on < $3::date and ends_on > $2::date`,
      [businessId, from, end],
    );
    const covers = (night: string, first: string, after: string) => first <= night && after > night;
    return {
      nights,
      rooms: rooms.map((room) => ({
        offering_id: room.id,
        name: room.name,
        units: room.units,
        status: room.status,
        nights: nights.map((night) => {
          const booked = stays.filter((stay) => stay.offering_id === room.id && stay.status === "confirmed" && covers(night, stay.check_in, stay.check_out))
            .reduce((sum, stay) => sum + stay.units, 0);
          const held = stays.filter((stay) => stay.offering_id === room.id && stay.status !== "confirmed" && covers(night, stay.check_in, stay.check_out))
            .reduce((sum, stay) => sum + stay.units, 0);
          const blocked = blocks.filter((block) => block.offering_id === room.id && covers(night, block.starts_on, block.ends_on))
            .reduce((sum, block) => sum + block.units, 0);
          return { night, booked, held, blocked, free: Math.max(0, room.units - booked - held - blocked) };
        }),
      })),
    };
  }, businessId);
}
