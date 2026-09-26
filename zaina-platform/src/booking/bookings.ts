// zaina-platform/src/booking/bookings.ts
//
// A booking, from the first ask to a confirmed stay. A room type is booked
// one of three ways (offerings.booking_mode):
//
//   instant   the customer books and pays the deposit; paying confirms it.
//             Until then the rooms are held (booking settings: hold_minutes).
//   request   the customer asks and the team decides: accept (at the quoted
//             price or an agreed one) or decline. An accepted request waits
//             for the deposit like an instant booking.
//   enquiry   not booked here: Zaina takes the customer's details (a lead).
//
// The deposit, the holds and the limits are the business's own (booking
// settings). With no deposit to pay, a booking is confirmed at once and paid
// at the venue. A business that hasn't chosen its deposit yet, or has no way
// to take it online (or none for this amount), gets requests: the team
// arranges payment. Zaina never decides a deposit.
//
// Money that arrives is applied here too (settlePayment). A payment that
// lands after its hold ended still gets the rooms if they're free; if they've
// gone, the booking is marked "conflict" and the team moves the guest or
// refunds (the C1 lesson from TBM). Starting to pay re-checks the rooms first
// (holdForPayment), so nobody pays for rooms that have gone.
//
// Every function runs in one business's scope; changes to a room type's
// bookings take its lock first (availability.ts).

import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { everyBusiness } from "../businesses/registry.ts";
import type pg from "pg";
import { appPool, type PlatformDb } from "../db/platform-db.ts";
import { bookingSettings, bookings, offeringResources, offerings, payments, resources, takesBookings, type Booking, type BookingSettings, type Offering, type Payment, type Resource } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { businessDay } from "../gateway/spend-cap.ts";
import { lockOffering, roomsTaken } from "./availability.ts";
import { addDays, isoDate, parseDate, quoteSlot, quoteStay, withAgreedTotal, type PricingRules, type SlotPricing, type StayQuote } from "./pricing.ts";
import { busyBetween, dayProblem, eligibleResources, lockSlots, resourceBusy, resourceWorks } from "./slots.ts";
import { localParts } from "./local-time.ts";
import { canTakeDeposits, defaultBookingSettings, depositChosen, depositRuleOf, paymentOptionsOf, taxRuleOf } from "./settings.ts";


// No 0/O or 1/I: references are read out over the phone.
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newReference(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join("");
}

export const newPayToken = () => randomBytes(18).toString("base64url");

export type BookingProblem = {
  ok: false;
  error:
    | "not_found" | "enquiry_only" | "unavailable" | "too_soon" | "too_far" | "invalid_dates" | "min_nights" | "max_nights"
    | "too_many_guests" | "too_few_guests" | "wrong_status" | "rooms_gone";
  message: string;
  rooms_left?: number;
  min_nights?: number;
  max_nights?: number;
  max_guests?: number;
};

const problem = (error: BookingProblem["error"], message: string, extra: Partial<BookingProblem> = {}): BookingProblem => ({ ok: false, error, message, ...extra });

type Db = PlatformDb;
type Client = pg.PoolClient;

async function settingsIn(db: Db, businessId: string): Promise<BookingSettings> {
  const [row] = await db.select().from(bookingSettings).where(eq(bookingSettings.businessId, businessId)).limit(1);
  return row ?? defaultBookingSettings(businessId);
}

export type DatePolicy = Pick<BookingSettings, "bookingHorizonDays" | "minNoticeHours" | "checkInTime">;

/**
 * Checks the dates are bookable in the business's calendar: not past, with
 * the notice the business asks for, and not further ahead than it takes
 * bookings. Staff bookings skip the notice (the team decides for itself).
 */
export function checkStayDates(checkIn: string, checkOut: string, timeZone: string, policy: DatePolicy, now: Date = new Date(), options: { skipNotice?: boolean } = {}): BookingProblem | null {
  const start = parseDate(checkIn);
  const end = parseDate(checkOut);
  if (!start || !end || end <= start) return problem("invalid_dates", "Check-out must be a date after check-in (YYYY-MM-DD).");
  const today = businessDay(timeZone, now);
  if (checkIn < today) return problem("too_soon", `Check-in can't be before today (${today}).`);
  if (policy.minNoticeHours > 0 && !options.skipNotice) {
    // The first check-in (at the business's check-in time) that far ahead.
    const earliest = localParts(timeZone, new Date(now.getTime() + policy.minNoticeHours * 3_600_000));
    const first = policy.checkInTime >= earliest.time ? earliest.date : isoDate(addDays(parseDate(earliest.date)!, 1));
    if (checkIn < first) return problem("too_soon", `Online bookings need ${policy.minNoticeHours} hours' notice: the earliest check-in is ${first}.`);
  }
  const last = isoDate(addDays(parseDate(today)!, policy.bookingHorizonDays));
  if (checkIn > last) return problem("too_far", `Stays can be booked up to ${last}.`);
  return null;
}

/** The quote for a stay in a room type, under the business's settings. */
export function quoteFor(offering: Offering, settings: BookingSettings, stay: { checkIn: string; checkOut: string; guests: number; units: number }) {
  return quoteStay({
    rules: offering.pricing as PricingRules,
    room: { maxGuests: offering.maxGuests },
    stay,
    currency: settings.currency,
    tax: taxRuleOf(settings),
    deposit: depositRuleOf(settings),
    maxNights: settings.maxNights,
  });
}

export type CreateBookingInput = {
  businessId: string;
  timeZone: string;
  offeringId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  units: number;
  customer: { name: string; email: string | null; phone: string | null };
  notes: string | null;
  source: "chat" | "staff";
  sessionId: string | null;
  idempotencyKey: string | null;
  /** Staff only: confirmed now (paid in person, or paying at the venue). */
  confirmNow?: boolean;
  staffUserId?: string | null;
  now?: Date;
};

export type CreatedBooking = { ok: true; booking: Booking; offering: Offering; settings: BookingSettings; replay: boolean };

/** Books rooms: holds them for payment, files a request, or confirms at once (see the top of this file). */
export async function createBooking(input: CreateBookingInput): Promise<CreatedBooking | BookingProblem> {
  const now = input.now ?? new Date();
  return inBusiness(async (db, client) => {
    const [offering] = await db.select().from(offerings)
      .where(and(eq(offerings.businessId, input.businessId), eq(offerings.id, input.offeringId), eq(offerings.status, "active")))
      .limit(1);
    if (!offering) return problem("not_found", "That room type isn't available to book.");
    const settings = await settingsIn(db, input.businessId);
    const dates = checkStayDates(input.checkIn, input.checkOut, input.timeZone, settings, now, { skipNotice: input.source === "staff" });
    if (dates) return dates;
    if (offering.bookingMode === "enquiry" && input.source === "chat") {
      return problem("enquiry_only", `${offering.name} isn't booked online: the team takes enquiries and gets back to the customer.`);
    }
    const priced = quoteFor(offering, settings, input);
    if (!priced.ok) return problem(priced.error, priced.message, { min_nights: priced.min_nights, max_nights: priced.max_nights, max_guests: priced.max_guests });

    await lockOffering(client, offering.id);
    // Under the lock, so the same request twice at once gets one booking.
    if (input.idempotencyKey) {
      const [existing] = await db.select().from(bookings)
        .where(and(eq(bookings.businessId, input.businessId), eq(bookings.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (existing) return { ok: true, booking: existing, offering, settings, replay: true } as const;
    }
    const taken = await roomsTaken(client, { businessId: input.businessId, offeringId: offering.id, checkIn: input.checkIn, checkOut: input.checkOut });
    const free = offering.units - taken;
    if (free < input.units) {
      return problem("unavailable", free > 0
        ? `Only ${free} ${offering.name} room${free === 1 ? " is" : "s are"} free for those dates.`
        : `${offering.name} is fully booked for those dates.`, { rooms_left: Math.max(0, free) });
    }

    const quote = priced.quote;
    const { status, hold } = initialStatus({ ...input, settings, offering, deposit: quote.deposit, now });
    const booking = await insertBooking(db, client, {
      businessId: input.businessId,
      offeringId: offering.id,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      units: input.units,
      guests: input.guests,
      status,
      holdExpiresAt: hold,
      customerName: input.customer.name,
      customerEmail: input.customer.email,
      customerPhone: input.customer.phone,
      customerNotes: input.notes,
      quote: quote as unknown as Record<string, unknown>,
      currency: quote.currency,
      totalMinor: quote.total,
      depositMinor: quote.deposit,
      source: input.source,
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      decidedBy: input.source === "staff" ? input.staffUserId ?? null : null,
      confirmedAt: status === "confirmed" ? now : null,
    });
    return { ok: true, booking, offering, settings, replay: false } as const;
  }, input.businessId);
}

/**
 * Where a new booking starts, by the business's rules: confirmed, held for
 * the deposit, or a request for the team (see the top of this file).
 */
export function initialStatus(input: {
  source: "chat" | "staff";
  confirmNow?: boolean;
  settings: BookingSettings;
  offering: Offering;
  deposit: number;
  now: Date;
}): { status: Booking["status"]; hold: Date | null } {
  const { settings, offering, now } = input;
  const minutes = (count: number) => new Date(now.getTime() + count * 60_000);
  const requestHold = settings.requestHoldHours > 0 ? minutes(settings.requestHoldHours * 60) : null;
  if (input.source === "staff" && input.confirmNow) return { status: "confirmed", hold: null };
  // Booked by the team for a customer who pays the deposit through the link.
  if (input.source === "staff") return input.deposit === 0 ? { status: "confirmed", hold: null } : { status: "awaiting_payment", hold: minutes(settings.acceptedHoldHours * 60) };
  // The business hasn't chosen its deposit: the team decides and arranges payment.
  if (!depositChosen(settings) && !offeringSetsDeposit(offering)) return { status: "requested", hold: requestHold };
  if (input.deposit === 0 && offering.bookingMode !== "request") return { status: "confirmed", hold: null };
  if (offering.bookingMode === "instant" && canTakeDeposits(paymentOptionsOf(settings), input.deposit)) return { status: "held", hold: minutes(settings.holdMinutes) };
  return { status: "requested", hold: requestHold };
}

type NewBooking = Omit<typeof bookings.$inferInsert, "reference" | "payToken">;

/** Inserts a booking with a fresh reference and payment link. */
async function insertBooking(db: Db, client: Client, values: NewBooking): Promise<Booking> {
  for (let attempt = 0; ; attempt += 1) {
    await client.query("savepoint new_booking");
    try {
      const [booking] = await db.insert(bookings).values({ ...values, reference: newReference(), payToken: newPayToken() }).returning();
      await client.query("release savepoint new_booking");
      return booking;
    } catch (error) {
      await client.query("rollback to savepoint new_booking");
      const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
      // A reference already used (rare): pick another.
      if (database.code === "23505" && database.constraint === "bookings_business_id_reference_key" && attempt < 5) continue;
      throw error;
    }
  }
}

// ── Time slots (Phase 5) ──────────────────────────────────────────────

export type CreateSlotBookingInput = {
  businessId: string;
  timeZone: string;
  offeringId: string;
  /** When it starts. */
  startsAt: Date;
  party: number;
  /** A stylist or table the customer asked for; otherwise the best one free. */
  resourceId?: string | null;
  customer: { name: string; email: string | null; phone: string | null };
  notes: string | null;
  source: "chat" | "staff";
  sessionId: string | null;
  idempotencyKey: string | null;
  confirmNow?: boolean;
  staffUserId?: string | null;
  now?: Date;
};

export type SlotProblem = {
  ok: false;
  error: "not_found" | "enquiry_only" | "unavailable" | "too_soon" | "too_far" | "invalid_dates" | "closed" | "too_many_guests" | "too_few_guests" | "resource_unavailable";
  message: string;
  min_party?: number;
  max_party?: number;
};

/**
 * Books a time slot: a service with a stylist or chair, or a table. The
 * business's slots are locked while it checks the time is still free, so two
 * customers can't both get the last table at 8pm.
 */
export async function createSlotBooking(input: CreateSlotBookingInput): Promise<CreatedBooking | SlotProblem> {
  const now = input.now ?? new Date();
  const refuse = (error: SlotProblem["error"], message: string, extra: Partial<SlotProblem> = {}): SlotProblem => ({ ok: false, error, message, ...extra });
  return inBusiness(async (db, client) => {
    const [offering] = await db.select().from(offerings)
      .where(and(eq(offerings.businessId, input.businessId), eq(offerings.id, input.offeringId), eq(offerings.status, "active")))
      .limit(1);
    if (!offering || (offering.kind !== "service" && offering.kind !== "table")) return refuse("not_found", "That isn't available to book.");
    const settings = await settingsIn(db, input.businessId);
    if (offering.bookingMode === "enquiry" && input.source === "chat") {
      return refuse("enquiry_only", `${offering.name} isn't booked online: the team takes enquiries and gets back to the customer.`);
    }
    if (!Number.isInteger(input.party) || input.party < offering.minParty) {
      return refuse("too_few_guests", `${offering.name} is for parties of at least ${offering.minParty}.`, { min_party: offering.minParty, max_party: offering.maxGuests });
    }
    if (input.party > offering.maxGuests) {
      return refuse("too_many_guests", `${offering.name} takes up to ${offering.maxGuests} ${offering.maxGuests === 1 ? "person" : "people"}.`, { min_party: offering.minParty, max_party: offering.maxGuests });
    }
    const local = localParts(input.timeZone, input.startsAt);
    const day = dayProblem(local.date, input.timeZone, settings, now);
    if (day) return refuse(day.error, day.message);
    if (input.startsAt < now) return refuse("too_soon", "That time has passed.");
    if (input.source === "chat" && input.startsAt.getTime() < now.getTime() + settings.minNoticeHours * 3_600_000) {
      return refuse("too_soon", `Online bookings need ${settings.minNoticeHours} hours' notice.`);
    }

    await lockSlots(client, input.businessId);
    if (input.idempotencyKey) {
      const [existing] = await db.select().from(bookings)
        .where(and(eq(bookings.businessId, input.businessId), eq(bookings.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (existing) return { ok: true, booking: existing, offering, settings, replay: true } as const;
    }
    const endsAt = new Date(input.startsAt.getTime() + (offering.durationMinutes ?? 60) * 60_000);
    const busyUntil = new Date(endsAt.getTime() + offering.bufferMinutes * 60_000);
    const [all, links] = await Promise.all([
      db.select().from(resources).where(eq(resources.businessId, input.businessId)),
      db.select({ offeringId: offeringResources.offeringId, resourceId: offeringResources.resourceId }).from(offeringResources).where(eq(offeringResources.businessId, input.businessId)),
    ]);
    const eligible = eligibleResources(offering, all, links, input.party);
    if (!eligible.length) return refuse("unavailable", `Nobody is set up to take ${offering.name}${offering.kind === "table" ? ` for ${input.party}` : ""}.`);
    const working = input.source === "staff" ? eligible : eligible.filter((resource) => resourceWorks(resource, settings.openingHours, input.startsAt, endsAt, input.timeZone));
    if (!working.length) return refuse("closed", `We're not open for ${offering.name} at ${local.time} on ${local.date}.`);
    const busy = await busyBetween(client, input.businessId, new Date(input.startsAt.getTime() - 13 * 3_600_000), new Date(busyUntil.getTime() + 13 * 3_600_000));
    const free = working.filter((resource) => !resourceBusy(resource.id, input.startsAt, endsAt, busyUntil, busy));
    let resource = free[0];
    if (input.resourceId) {
      const wanted = free.find((candidate) => candidate.id === input.resourceId);
      if (!wanted) {
        const name = all.find((candidate) => candidate.id === input.resourceId)?.name ?? "That choice";
        return refuse("resource_unavailable", `${name} isn't free then${free.length ? `; ${free.map((candidate) => candidate.name).join(", ")} ${free.length === 1 ? "is" : "are"}` : ""}.`);
      }
      resource = wanted;
    }
    if (!resource) return refuse("unavailable", `${local.time} on ${local.date} is taken for ${offering.name}.`);

    const quote = quoteSlot({
      rules: offering.pricing as SlotPricing,
      service: offering.name,
      startsAt: input.startsAt,
      durationMinutes: offering.durationMinutes ?? 60,
      party: input.party,
      currency: settings.currency,
      tax: taxRuleOf(settings),
      deposit: depositRuleOf(settings),
    });
    const { status, hold } = initialStatus({ ...input, settings, offering, deposit: quote.deposit, now });
    const nextDay = isoDate(addDays(parseDate(local.date)!, 1));
    const booking = await insertBooking(db, client, {
      businessId: input.businessId,
      offeringId: offering.id,
      // A slot's day, and the day after: lists by date work for stays and slots alike.
      checkIn: local.date,
      checkOut: nextDay,
      units: 1,
      guests: input.party,
      startsAt: input.startsAt,
      endsAt,
      busyUntil,
      resourceId: resource.id,
      status,
      holdExpiresAt: hold,
      customerName: input.customer.name,
      customerEmail: input.customer.email,
      customerPhone: input.customer.phone,
      customerNotes: input.notes,
      quote: quote as unknown as Record<string, unknown>,
      currency: quote.currency,
      totalMinor: quote.total,
      depositMinor: quote.deposit,
      source: input.source,
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      decidedBy: input.source === "staff" ? input.staffUserId ?? null : null,
      confirmedAt: status === "confirmed" ? now : null,
    });
    return { ok: true, booking, offering, settings, replay: false } as const;
  }, input.businessId);
}

/** A room type with its own deposit rule (the business chose it there). */
const offeringSetsDeposit = (offering: Offering) => {
  const rules = offering.pricing as PricingRules;
  return rules.deposit_percent !== undefined || rules.deposit_fixed !== undefined;
};

// ── Reading ───────────────────────────────────────────────────────────

export async function getBooking(businessId: string, id: string): Promise<Booking | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await inBusiness((db) => db.select().from(bookings).where(and(eq(bookings.businessId, businessId), eq(bookings.id, id))).limit(1), businessId);
  return row;
}

export async function getBookingByReference(businessId: string, reference: string): Promise<Booking | undefined> {
  const clean = reference.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(clean)) return undefined;
  const [row] = await inBusiness((db) => db.select().from(bookings).where(and(eq(bookings.businessId, businessId), eq(bookings.reference, clean))).limit(1), businessId);
  return row;
}

/** The bookings made in one chat, newest first. */
export async function bookingsOfSession(businessId: string, sessionId: string): Promise<Booking[]> {
  return inBusiness((db) => db.select().from(bookings)
    .where(and(eq(bookings.businessId, businessId), eq(bookings.sessionId, sessionId)))
    .orderBy(desc(bookings.createdAt)), businessId);
}

export async function paymentsOf(businessId: string, bookingId: string): Promise<Payment[]> {
  return inBusiness((db) => db.select().from(payments)
    .where(and(eq(payments.businessId, businessId), eq(payments.bookingId, bookingId)))
    .orderBy(desc(payments.createdAt)), businessId);
}

/** The business a payment-page token belongs to, found without any business in scope. */
export async function businessForToken(kind: "pay" | "mpesa" | "paystack", token: string): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const { rows: [row] } = await appPool().query<{ business_id: string | null }>("select payment_route($1, $2) as business_id", [kind, token]);
  return row?.business_id ?? null;
}

export async function bookingByPayToken(businessId: string, token: string): Promise<Booking | undefined> {
  const [row] = await inBusiness((db) => db.select().from(bookings).where(and(eq(bookings.businessId, businessId), eq(bookings.payToken, token))).limit(1), businessId);
  return row;
}

export type BookingFilter = "upcoming" | "requests" | "unpaid" | "attention" | "past" | "cancelled" | "all";
export const bookingFilters: BookingFilter[] = ["upcoming", "requests", "unpaid", "attention", "past", "cancelled", "all"];

/** Bookings for the console's list, with their room type's name and whether a code waits for the team. */
export async function listBookings(businessId: string, filter: BookingFilter, timeZone: string, limit = 200): Promise<Array<{ booking: Booking; offeringName: string; codeToCheck: boolean }>> {
  const today = businessDay(timeZone);
  const codeToCheck = sql<boolean>`exists (select 1 from payments as p where p.business_id = ${bookings.businessId} and p.booking_id = ${bookings.id} and p.method = 'mpesa_code' and p.status = 'pending')`;
  const where = {
    upcoming: sql`${bookings.status} = 'confirmed' and ${bookings.checkOut} >= ${today}::date`,
    requests: sql`${bookings.status} = 'requested'`,
    unpaid: sql`${bookings.status} in ('held', 'awaiting_payment') and ${bookings.holdExpiresAt} > now()`,
    attention: sql`(${bookings.status} = 'conflict' or ${codeToCheck})`,
    past: sql`${bookings.status} = 'confirmed' and ${bookings.checkOut} < ${today}::date`,
    cancelled: sql`${bookings.status} in ('cancelled', 'declined', 'expired')`,
    all: sql`true`,
  }[filter];
  return inBusiness((db) => db
    .select({ booking: bookings, offeringName: offerings.name, codeToCheck })
    .from(bookings)
    .innerJoin(offerings, and(eq(offerings.businessId, bookings.businessId), eq(offerings.id, bookings.offeringId)))
    .where(and(eq(bookings.businessId, businessId), where))
    .orderBy(filter === "upcoming" ? sql`${bookings.checkIn} asc` : desc(bookings.createdAt))
    .limit(limit), businessId);
}

// ── The team's decisions ──────────────────────────────────────────────

type Decision = { ok: true; booking: Booking; before: Booking["status"] } | BookingProblem;

async function lockedBooking(db: Db, businessId: string, id: string): Promise<Booking | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await db.select().from(bookings).where(and(eq(bookings.businessId, businessId), eq(bookings.id, id))).for("update").limit(1);
  return row;
}

/** Whether a booking's place is still its own: its rooms, or (a time slot) a resource free for its time. */
async function placeFreeFor(client: Client, booking: Booking): Promise<boolean> {
  return booking.startsAt ? slotFreeFor(client, booking) : roomsFreeFor(client, booking);
}

/**
 * A time slot is still free if its resource is, or another that can take it
 * (the booking then moves to that one: a different table, the same time).
 */
async function slotFreeFor(client: Client, booking: Booking): Promise<boolean> {
  await lockSlots(client, booking.businessId);
  const [{ rows: all }, { rows: links }, { rows: [offering] }] = await Promise.all([
    client.query<Record<string, unknown>>("select * from resources where business_id = $1", [booking.businessId]),
    client.query<{ offering_id: string; resource_id: string }>("select offering_id, resource_id from offering_resources where business_id = $1", [booking.businessId]),
    client.query<{ id: string; kind: Offering["kind"] }>("select id, kind from offerings where business_id = $1 and id = $2", [booking.businessId, booking.offeringId]),
  ]);
  if (!offering) return false;
  const list = all.map((row) => ({ id: row.id, name: row.name, kind: row.kind, seats: row.seats, minParty: row.min_party, status: row.status, sortOrder: row.sort_order, hours: row.hours }) as Resource);
  const eligible = eligibleResources(offering, list, links.map((link) => ({ offeringId: link.offering_id, resourceId: link.resource_id })), booking.guests);
  const busy = await busyBetween(client, booking.businessId, booking.startsAt!, booking.busyUntil!, booking.id);
  const ordered = [...eligible.filter((resource) => resource.id === booking.resourceId), ...eligible.filter((resource) => resource.id !== booking.resourceId)];
  const free = ordered.find((resource) => !resourceBusy(resource.id, booking.startsAt!, booking.endsAt!, booking.busyUntil!, busy));
  if (!free) return false;
  if (free.id !== booking.resourceId) {
    await client.query("update bookings set resource_id = $3, updated_at = now() where business_id = $1 and id = $2", [booking.businessId, booking.id, free.id]);
  }
  return true;
}

async function roomsFreeFor(client: Client, booking: Booking): Promise<boolean> {
  await lockOffering(client, booking.offeringId);
  const { rows: [room] } = await client.query<{ units: number }>("select units from offerings where business_id = $1 and id = $2", [booking.businessId, booking.offeringId]);
  const taken = await roomsTaken(client, { businessId: booking.businessId, offeringId: booking.offeringId, checkIn: booking.checkIn, checkOut: booking.checkOut, excludeBookingId: booking.id });
  return (room?.units ?? 0) - taken >= booking.units;
}

/**
 * The team accepts a request, at the quoted price or an agreed total (request
 * then quote). The customer then pays the deposit through the booking's link;
 * with nothing to pay it is confirmed at once.
 */
export async function acceptBooking(businessId: string, id: string, staffUserId: string, input: { agreedTotal?: number | null; note?: string | null } = {}, now = new Date()): Promise<Decision> {
  return inBusiness(async (db, client) => {
    const booking = await lockedBooking(db, businessId, id);
    if (!booking) return problem("not_found", "No such booking.");
    if (booking.status !== "requested") return problem("wrong_status", `Only a request can be accepted; this booking is ${booking.status.replace("_", " ")}.`);
    const settings = await settingsIn(db, businessId);
    if (!(await placeFreeFor(client, booking))) return problem("unavailable", "Those rooms have been booked meanwhile: decline the request, or free a room first.");
    const quote = input.agreedTotal !== undefined && input.agreedTotal !== null
      ? withAgreedTotal(booking.quote as unknown as StayQuote, input.agreedTotal, input.note ?? null)
      : booking.quote as unknown as StayQuote;
    const confirmed = quote.deposit === 0;
    const [updated] = await db.update(bookings).set({
      status: confirmed ? "confirmed" : "awaiting_payment",
      holdExpiresAt: confirmed ? null : new Date(now.getTime() + settings.acceptedHoldHours * 3_600_000),
      quote: quote as unknown as Record<string, unknown>,
      totalMinor: quote.total,
      depositMinor: quote.deposit,
      decidedBy: staffUserId,
      staffNote: input.note ?? booking.staffNote,
      confirmedAt: confirmed ? now : null,
      updatedAt: now,
    }).where(and(eq(bookings.businessId, businessId), eq(bookings.id, id))).returning();
    return { ok: true, booking: updated, before: booking.status };
  }, businessId);
}

/** Changes a booking's status when it is in one of `from`. */
async function decide(businessId: string, id: string, from: Booking["status"][], to: Booking["status"], fields: Partial<Booking>, action: string): Promise<Decision> {
  return inBusiness(async (db) => {
    const booking = await lockedBooking(db, businessId, id);
    if (!booking) return problem("not_found", "No such booking.");
    if (!from.includes(booking.status)) return problem("wrong_status", `A booking that is ${booking.status.replace("_", " ")} can't be ${action}.`);
    const [updated] = await db.update(bookings).set({ ...fields, status: to, updatedAt: new Date() })
      .where(and(eq(bookings.businessId, businessId), eq(bookings.id, id))).returning();
    return { ok: true, booking: updated, before: booking.status };
  }, businessId);
}

export const declineBooking = (businessId: string, id: string, staffUserId: string, reason: string | null) =>
  decide(businessId, id, ["requested", "awaiting_payment", "held"], "declined", { decidedBy: staffUserId, staffNote: reason, holdExpiresAt: null }, "declined");

export const cancelBooking = (businessId: string, id: string, staffUserId: string, reason: string | null) =>
  decide(businessId, id, ["held", "requested", "awaiting_payment", "confirmed", "conflict"], "cancelled", { decidedBy: staffUserId, staffNote: reason, cancelledAt: new Date(), holdExpiresAt: null }, "cancelled");

/**
 * The team confirms a booking without an online payment (paid in person, or
 * paying at the venue). The rooms must be free, unless `force`: a conflict
 * the team has resolved (they made room).
 */
export async function confirmBooking(businessId: string, id: string, staffUserId: string, input: { note?: string | null; force?: boolean } = {}, now = new Date()): Promise<Decision> {
  return inBusiness(async (db, client) => {
    const booking = await lockedBooking(db, businessId, id);
    if (!booking) return problem("not_found", "No such booking.");
    if (!["held", "requested", "awaiting_payment", "expired", "conflict"].includes(booking.status)) {
      return problem("wrong_status", `A booking that is ${booking.status.replace("_", " ")} can't be confirmed.`);
    }
    if (booking.status === "conflict" && !input.force) return problem("rooms_gone", "This booking's rooms went to someone else: confirm it only once you've made room.");
    if (!input.force && !(await placeFreeFor(client, booking))) return problem("unavailable", "Those rooms are no longer free.");
    const [updated] = await db.update(bookings).set({
      status: "confirmed", holdExpiresAt: null, confirmedAt: now, conflict: null, decidedBy: staffUserId, staffNote: input.note ?? booking.staffNote, updatedAt: now,
    }).where(and(eq(bookings.businessId, businessId), eq(bookings.id, id))).returning();
    return { ok: true, booking: updated, before: booking.status };
  }, businessId);
}

// ── Paying ────────────────────────────────────────────────────────────

/**
 * Before a payment starts: the booking must still be waiting for money, and
 * its rooms still its own. A hold that ran out is renewed if the rooms are
 * free (C1: nobody pays for rooms that have gone). The hold then lasts at
 * least the business's payment hold (payment_hold_minutes).
 */
export async function holdForPayment(businessId: string, id: string, now = new Date()): Promise<{ ok: true; booking: Booking } | BookingProblem> {
  return inBusiness(async (db, client) => {
    const booking = await lockedBooking(db, businessId, id);
    if (!booking) return problem("not_found", "No such booking.");
    if (!["held", "awaiting_payment", "expired"].includes(booking.status)) {
      return problem("wrong_status", booking.status === "confirmed" ? "This booking is already confirmed." : `This booking is ${booking.status.replace("_", " ")}.`);
    }
    if (booking.paidMinor >= booking.depositMinor && booking.depositMinor > 0) return problem("wrong_status", "The deposit is already paid.");
    const holding = booking.status !== "expired" && booking.holdExpiresAt !== null && booking.holdExpiresAt > now;
    if (!holding && !(await placeFreeFor(client, booking))) {
      if (booking.status !== "expired") {
        await db.update(bookings).set({ status: "expired", updatedAt: now }).where(and(eq(bookings.businessId, businessId), eq(bookings.id, id)));
      }
      return problem("rooms_gone", "Sorry, the rooms for this booking were taken after its hold ended.");
    }
    const { paymentHoldMinutes } = await settingsIn(db, businessId);
    const until = new Date(Math.max(holding ? booking.holdExpiresAt!.getTime() : 0, now.getTime() + paymentHoldMinutes * 60_000));
    const [updated] = await db.update(bookings).set({ status: booking.status === "expired" ? "held" : booking.status, holdExpiresAt: until, updatedAt: now })
      .where(and(eq(bookings.businessId, businessId), eq(bookings.id, id))).returning();
    return { ok: true, booking: updated };
  }, businessId);
}

/** A payment waiting to be settled, started for a booking. */
export async function recordPendingPayment(input: {
  businessId: string;
  bookingId: string;
  method: Payment["method"];
  amountMinor: number;
  currency: Payment["currency"];
  providerReference?: string | null;
  callbackToken?: string | null;
  payerPhone?: string | null;
  payerEmail?: string | null;
  recordedBy?: string | null;
}): Promise<Payment> {
  const [row] = await inBusiness((db) => db.insert(payments).values({
    businessId: input.businessId,
    bookingId: input.bookingId,
    method: input.method,
    amountMinor: input.amountMinor,
    currency: input.currency,
    status: "pending",
    providerReference: input.providerReference ?? null,
    callbackToken: input.callbackToken ?? null,
    payerPhone: input.payerPhone ?? null,
    payerEmail: input.payerEmail ?? null,
    recordedBy: input.recordedBy ?? null,
  }).returning(), input.businessId);
  return row;
}

export async function setPaymentReference(businessId: string, paymentId: string, providerReference: string): Promise<void> {
  await inBusiness((db) => db.update(payments).set({ providerReference, updatedAt: new Date() })
    .where(and(eq(payments.businessId, businessId), eq(payments.id, paymentId))), businessId);
}

export type Settlement = {
  changed: boolean;
  payment: Payment;
  booking: Booking;
  /** The booking became confirmed with this payment. */
  confirmed: boolean;
  /** The money arrived for rooms that had gone: the team must act. */
  conflict: boolean;
};

/**
 * Settles a payment: succeeded (the money is in) or failed. Idempotent: a
 * payment settles once, however many times its provider tells us. A success
 * that covers the deposit confirms the booking if its rooms are still its
 * own (see the top of this file).
 */
export async function settlePayment(
  businessId: string,
  paymentId: string,
  outcome: { succeeded: true; receipt?: string | null; payerPhone?: string | null; recordedBy?: string | null } | { succeeded: false; failure: string; rejected?: boolean; recordedBy?: string | null },
  now = new Date(),
): Promise<Settlement | undefined> {
  return inBusiness(async (db, client) => {
    const [payment] = await db.select().from(payments).where(and(eq(payments.businessId, businessId), eq(payments.id, paymentId))).for("update").limit(1);
    if (!payment) return undefined;
    const booking = await lockedBooking(db, businessId, payment.bookingId);
    if (!booking) return undefined;
    if (payment.status !== "pending") return { changed: false, payment, booking, confirmed: false, conflict: false };

    if (!outcome.succeeded) {
      const [failed] = await db.update(payments).set({
        status: outcome.rejected ? "rejected" : "failed", failure: outcome.failure.slice(0, 300), recordedBy: outcome.recordedBy ?? payment.recordedBy, settledAt: now, updatedAt: now,
      }).where(eq(payments.id, payment.id)).returning();
      return { changed: true, payment: failed, booking, confirmed: false, conflict: false };
    }

    const [paid] = await db.update(payments).set({
      status: "succeeded", receipt: outcome.receipt ?? payment.receipt, payerPhone: outcome.payerPhone ?? payment.payerPhone,
      recordedBy: outcome.recordedBy ?? payment.recordedBy, settledAt: now, updatedAt: now,
    }).where(eq(payments.id, payment.id)).returning();
    const paidMinor = booking.paidMinor + payment.amountMinor;
    let status = booking.status;
    let conflict = booking.conflict;
    const coversDeposit = paidMinor >= booking.depositMinor;
    if (["held", "awaiting_payment", "requested", "expired"].includes(booking.status) && coversDeposit) {
      const holding = booking.status !== "expired" && booking.holdExpiresAt !== null && booking.holdExpiresAt > now;
      if (holding || (await placeFreeFor(client, booking))) {
        status = "confirmed";
      } else {
        status = "conflict";
        conflict = "Paid after the booking's hold ended, and its rooms had been booked meanwhile. Move the guest or refund.";
      }
    } else if (booking.status === "cancelled" || booking.status === "declined") {
      status = "conflict";
      conflict = `Paid after the booking was ${booking.status}. Reinstate it or refund.`;
    }
    const [updated] = await db.update(bookings).set({
      paidMinor,
      status,
      conflict,
      holdExpiresAt: status === "confirmed" || status === "conflict" ? null : booking.holdExpiresAt,
      confirmedAt: status === "confirmed" && booking.status !== "confirmed" ? now : booking.confirmedAt,
      updatedAt: now,
    }).where(and(eq(bookings.businessId, businessId), eq(bookings.id, booking.id))).returning();
    return {
      changed: true,
      payment: paid,
      booking: updated,
      confirmed: status === "confirmed" && booking.status !== "confirmed",
      conflict: status === "conflict" && booking.status !== "conflict",
    };
  }, businessId);
}

/** Keeps a booking's rooms while the team checks an M-Pesa code the customer sent. */
export async function holdWhileChecking(businessId: string, bookingId: string, hours: number, now = new Date()): Promise<void> {
  await inBusiness((db) => db.update(bookings)
    .set({ holdExpiresAt: sql`greatest(${bookings.holdExpiresAt}, ${new Date(now.getTime() + hours * 3_600_000)})`, updatedAt: now })
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId), inArray(bookings.status, ["held", "awaiting_payment"]))), businessId);
}

/** After a code the team couldn't find: the rooms are held a short while longer, not for the whole check. */
export async function shortenHold(businessId: string, bookingId: string, minutes: number, now = new Date()): Promise<void> {
  await inBusiness((db) => db.update(bookings)
    .set({ holdExpiresAt: sql`least(${bookings.holdExpiresAt}, ${new Date(now.getTime() + minutes * 60_000)})`, updatedAt: now })
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId), inArray(bookings.status, ["held", "awaiting_payment"]))), businessId);
}

// ── Holds that run out ────────────────────────────────────────────────

/** Unpaid bookings whose hold has ended, in every business: they let go of their rooms. */
export async function expireHolds(now = new Date()): Promise<Array<{ businessId: string; booking: Booking }>> {
  const expired: Array<{ businessId: string; booking: Booking }> = [];
  for (const business of await everyBusiness()) {
    if (!takesBookings(business.businessType)) continue;
    try {
      const rows = await inBusiness((db) => db.update(bookings).set({ status: "expired", updatedAt: now })
        .where(and(
          eq(bookings.businessId, business.id),
          inArray(bookings.status, ["held", "awaiting_payment"]),
          sql`${bookings.holdExpiresAt} <= ${now}`,
          // A code the team is still checking keeps the booking.
          sql`not exists (select 1 from payments as p where p.business_id = ${bookings.businessId} and p.booking_id = ${bookings.id} and p.status = 'pending' and p.method = 'mpesa_code')`,
        ))
        .returning(), business.id);
      for (const booking of rows) expired.push({ businessId: business.id, booking });
    } catch (error) {
      console.error(`[bookings] expiring holds for ${business.id} failed:`, error);
    }
  }
  return expired;
}

