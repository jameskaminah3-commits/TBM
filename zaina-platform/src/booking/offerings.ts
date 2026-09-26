// zaina-platform/src/booking/offerings.ts
//
// What a business sells:
//   room_type  a place to stay's rooms (I11): how many identical rooms there
//              are, how many guests each sleeps, and nightly pricing rules.
//   service    an appointment (a haircut, a massage): its length, the time
//              after it before the stylist or chair is free again, its price,
//              and which resources can do it (none listed: any).
//   table      a restaurant's table booking (a dinner seating): its length,
//              the party sizes it takes, and a price if it has one.
// Each is booked instantly, on request or by enquiry (pricing.ts prices it).
// An offering with bookings is hidden, never deleted, so every booking keeps
// what it booked.

import { and, asc, eq, sql } from "drizzle-orm";
import { bookingModes, bookings, offeringResources, offerings, type BookingCurrency, type BookingMode, type BusinessType, type Offering, type OfferingKind } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { formatMoney, toMinor } from "./money.ts";
import { fromNightly, validatePricingRules, validateSlotPricing, type PricingRules, type SlotPricing } from "./pricing.ts";

/** What a business of each type sells by default. */
export function offeringKindFor(businessType: BusinessType): OfferingKind {
  return businessType === "salon" ? "service" : businessType === "restaurant" ? "table" : "room_type";
}

export const isSlotKind = (kind: OfferingKind) => kind === "service" || kind === "table";

export type OfferingValues = {
  kind: OfferingKind;
  name: string;
  description: string;
  units: number;
  maxGuests: number;
  bookingMode: BookingMode;
  pricing: PricingRules | SlotPricing;
  status: "active" | "hidden";
  sortOrder: number;
  durationMinutes: number | null;
  bufferMinutes: number;
  minParty: number;
};

const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/**
 * Checks an offering sent by staff: a room type, service or table booking
 * (kind, fixed once created). With `current`, missing fields keep their values.
 */
export function validateOffering(input: Record<string, unknown>, current?: OfferingValues, defaultKind: OfferingKind = "room_type"): { ok: true; value: OfferingValues } | { ok: false; error: string } {
  const pick = <T>(key: string, fallback: T | undefined) => (key in input ? input[key] : fallback);
  const kind = current?.kind ?? (input.kind ?? defaultKind);
  if (kind !== "room_type" && kind !== "service" && kind !== "table") return { ok: false, error: "kind is room_type, service or table" };
  const name = pick("name", current?.name);
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) return { ok: false, error: "name is 1 to 120 characters" };
  const description = pick("description", current?.description ?? "");
  if (typeof description !== "string" || description.length > 2000) return { ok: false, error: "description is up to 2000 characters" };
  if (kind !== "room_type") return validateSlotOffering(kind, input, current, name.trim(), description.trim());
  const units = pick("units", current?.units);
  if (!whole(units, 1, 500)) return { ok: false, error: "units is how many rooms of this type: 1 to 500" };
  const maxGuests = pick("max_guests", current?.maxGuests);
  if (!whole(maxGuests, 1, 50)) return { ok: false, error: "max_guests is how many guests one room sleeps: 1 to 50" };
  const bookingMode = pick("booking_mode", current?.bookingMode ?? "instant");
  if (!bookingModes.includes(bookingMode as BookingMode)) return { ok: false, error: `booking_mode is one of ${bookingModes.join(", ")}` };
  const status = pick("status", current?.status ?? "active");
  if (status !== "active" && status !== "hidden") return { ok: false, error: "status is active or hidden" };
  const sortOrder = pick("sort_order", current?.sortOrder ?? 0);
  if (!whole(sortOrder, -1000, 1000)) return { ok: false, error: "sort_order is a whole number" };
  const pricing = validatePricingRules(pick("pricing", current?.pricing), { maxGuests });
  if (!pricing.ok) return { ok: false, error: pricing.error };
  return {
    ok: true,
    value: {
      kind, name: name.trim(), description: description.trim(), units, maxGuests, bookingMode: bookingMode as BookingMode, pricing: pricing.rules, status, sortOrder,
      durationMinutes: null, bufferMinutes: 0, minParty: 1,
    },
  };
}

/** A service or table booking: its length, buffer, party sizes and price. */
function validateSlotOffering(kind: "service" | "table", input: Record<string, unknown>, current: OfferingValues | undefined, name: string, description: string): { ok: true; value: OfferingValues } | { ok: false; error: string } {
  const pick = <T>(key: string, fallback: T | undefined) => (key in input ? input[key] : fallback);
  const duration = pick("duration_minutes", current?.durationMinutes ?? undefined);
  if (!whole(duration, 5, 720)) return { ok: false, error: "duration_minutes is how long a booking lasts: 5 to 720" };
  const buffer = pick("buffer_minutes", current?.bufferMinutes ?? 0);
  if (!whole(buffer, 0, 240)) return { ok: false, error: "buffer_minutes is the time after a booking before it's free again: 0 to 240" };
  const maxParty = pick("max_party", current?.maxGuests ?? (kind === "service" ? 1 : undefined));
  if (!whole(maxParty, 1, 50)) return { ok: false, error: kind === "table" ? "max_party is the largest party taken: 1 to 50" : "max_party is 1 to 50" };
  const minParty = pick("min_party", current?.minParty ?? 1);
  if (!whole(minParty, 1, maxParty)) return { ok: false, error: `min_party is 1 to ${maxParty}` };
  const bookingMode = pick("booking_mode", current?.bookingMode ?? "instant");
  if (!bookingModes.includes(bookingMode as BookingMode)) return { ok: false, error: `booking_mode is one of ${bookingModes.join(", ")}` };
  const status = pick("status", current?.status ?? "active");
  if (status !== "active" && status !== "hidden") return { ok: false, error: "status is active or hidden" };
  const sortOrder = pick("sort_order", current?.sortOrder ?? 0);
  if (!whole(sortOrder, -1000, 1000)) return { ok: false, error: "sort_order is a whole number" };
  const pricing = validateSlotPricing(pick("pricing", current?.pricing));
  if (!pricing.ok) return { ok: false, error: pricing.error };
  return {
    ok: true,
    value: {
      kind, name, description, units: 1, maxGuests: maxParty, bookingMode: bookingMode as BookingMode, pricing: pricing.rules, status, sortOrder,
      durationMinutes: duration, bufferMinutes: buffer, minParty,
    },
  };
}

export function valuesOf(offering: Offering): OfferingValues {
  return {
    kind: offering.kind,
    name: offering.name,
    description: offering.description,
    units: offering.units,
    maxGuests: offering.maxGuests,
    bookingMode: offering.bookingMode,
    pricing: offering.pricing as PricingRules,
    status: offering.status,
    sortOrder: offering.sortOrder,
    durationMinutes: offering.durationMinutes,
    bufferMinutes: offering.bufferMinutes,
    minParty: offering.minParty,
  };
}

/** Which resources can take each offering (an offering with none listed takes any that fits). */
export async function offeringLinks(businessId: string): Promise<Array<{ offeringId: string; resourceId: string }>> {
  return inBusiness((db) => db.select({ offeringId: offeringResources.offeringId, resourceId: offeringResources.resourceId })
    .from(offeringResources).where(eq(offeringResources.businessId, businessId)), businessId);
}

export async function setOfferingResources(businessId: string, offeringId: string, resourceIds: string[]): Promise<void> {
  await inBusiness(async (db) => {
    await db.delete(offeringResources).where(and(eq(offeringResources.businessId, businessId), eq(offeringResources.offeringId, offeringId)));
    if (resourceIds.length) await db.insert(offeringResources).values(resourceIds.map((resourceId) => ({ businessId, offeringId, resourceId })));
  }, businessId);
}

export async function listOfferings(businessId: string, options: { activeOnly?: boolean } = {}): Promise<Offering[]> {
  return inBusiness((db) => db
    .select()
    .from(offerings)
    .where(options.activeOnly
      ? and(eq(offerings.businessId, businessId), eq(offerings.status, "active"))
      : eq(offerings.businessId, businessId))
    .orderBy(asc(offerings.sortOrder), asc(offerings.name)), businessId);
}

export async function getOffering(businessId: string, id: string): Promise<Offering | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await inBusiness((db) => db.select().from(offerings).where(and(eq(offerings.businessId, businessId), eq(offerings.id, id))).limit(1), businessId);
  return row;
}

const isNameTaken = (error: unknown) => {
  const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
  return database.code === "23505" && database.constraint === "offerings_name_idx";
};

export async function createOffering(businessId: string, value: OfferingValues, userId: string | null): Promise<Offering | "name_taken"> {
  try {
    const [row] = await inBusiness((db) => db.insert(offerings).values({ businessId, ...value, updatedBy: userId }).returning(), businessId);
    return row;
  } catch (error) {
    if (isNameTaken(error)) return "name_taken";
    throw error;
  }
}

export async function updateOffering(businessId: string, id: string, value: OfferingValues, userId: string | null): Promise<Offering | "name_taken" | undefined> {
  try {
    const [row] = await inBusiness((db) => db
      .update(offerings)
      .set({ ...value, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(offerings.businessId, businessId), eq(offerings.id, id)))
      .returning(), businessId);
    return row;
  } catch (error) {
    if (isNameTaken(error)) return "name_taken";
    throw error;
  }
}

/** Deletes a room type nobody has booked; hides one with bookings. */
export async function removeOffering(businessId: string, id: string): Promise<"deleted" | "hidden" | "not_found"> {
  return inBusiness(async (db) => {
    const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.businessId, businessId), eq(bookings.offeringId, id)));
    if ((used?.n ?? 0) > 0) {
      const hidden = await db.update(offerings).set({ status: "hidden", updatedAt: new Date() })
        .where(and(eq(offerings.businessId, businessId), eq(offerings.id, id))).returning({ id: offerings.id });
      return hidden.length ? "hidden" : "not_found";
    }
    const deleted = await db.delete(offerings).where(and(eq(offerings.businessId, businessId), eq(offerings.id, id))).returning({ id: offerings.id });
    return deleted.length ? "deleted" : "not_found";
  }, businessId);
}

/** What a service or table booking costs, in words: "KSh 1,500", "KSh 2,000 a person", "free". */
export function slotPriceText(pricing: SlotPricing, currency: BookingCurrency): string {
  const parts = [
    ...(pricing.price ? [formatMoney(pricing.price, currency)] : []),
    ...(pricing.per_person ? [`${formatMoney(pricing.per_person, currency)} a person`] : []),
  ];
  return parts.join(" + ") || "free";
}

/** An offering as the staff API shows it. */
export function publicOffering(offering: Offering, currency: BookingCurrency, resourceIds: string[] = []) {
  if (isSlotKind(offering.kind)) {
    const pricing = offering.pricing as SlotPricing;
    return {
      id: offering.id,
      kind: offering.kind,
      name: offering.name,
      description: offering.description,
      duration_minutes: offering.durationMinutes,
      buffer_minutes: offering.bufferMinutes,
      min_party: offering.minParty,
      max_party: offering.maxGuests,
      booking_mode: offering.bookingMode,
      pricing,
      price_display: slotPriceText(pricing, currency),
      resource_ids: resourceIds,
      status: offering.status,
      sort_order: offering.sortOrder,
      updated_at: offering.updatedAt,
    };
  }
  const pricing = offering.pricing as PricingRules;
  return {
    id: offering.id,
    kind: offering.kind,
    name: offering.name,
    description: offering.description,
    units: offering.units,
    max_guests: offering.maxGuests,
    booking_mode: offering.bookingMode,
    pricing,
    status: offering.status,
    sort_order: offering.sortOrder,
    from_nightly_display: formatMoney(fromNightly(pricing), currency),
    updated_at: offering.updatedAt,
  };
}

// ── A spreadsheet of room types ───────────────────────────────────────
// One row per room type, amounts in shillings (or dollars):
//   name, units, max_guests, nightly, weekend_nightly, included_guests,
//   extra_guest_nightly, min_nights, booking_mode, description
// Only name, units, max_guests and nightly are required. A row whose name
// matches an existing room type updates it.

/** The rows of a CSV text (quotes and commas inside quotes are understood). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows.map((cells) => cells.map((cell) => cell.trim()));
}

export type CsvRoom = { line: number; input: Record<string, unknown> };

/** Room types from a spreadsheet, as inputs for validateOffering, or the first problem. */
export function roomsFromCsv(text: string): { ok: true; rooms: CsvRoom[] } | { ok: false; error: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, error: "The spreadsheet needs a header row and at least one room type." };
  if (rows.length > 101) return { ok: false, error: "Up to 100 room types at a time." };
  const header = rows[0].map((cell) => cell.toLowerCase().replace(/[\s-]+/g, "_"));
  for (const required of ["name", "units", "max_guests", "nightly"]) {
    if (!header.includes(required)) return { ok: false, error: `The header row needs a "${required}" column.` };
  }
  const known = ["name", "units", "max_guests", "nightly", "weekend_nightly", "included_guests", "extra_guest_nightly", "min_nights", "booking_mode", "description"];
  const unknown = header.find((column) => !known.includes(column));
  if (unknown) return { ok: false, error: `Unknown column "${unknown}". The columns are: ${known.join(", ")}.` };

  const rooms: CsvRoom[] = [];
  for (const [index, cells] of rows.slice(1).entries()) {
    const line = index + 2;
    const cell = (column: string) => cells[header.indexOf(column)] ?? "";
    const number = (column: string) => (cell(column) === "" ? undefined : Number(cell(column)));
    const money = (column: string) => {
      if (cell(column) === "") return undefined;
      const minor = toMinor(cell(column));
      if (minor === null) throw new Error(`Line ${line}: ${column} "${cell(column)}" isn't an amount.`);
      return minor;
    };
    try {
      const pricing: Record<string, unknown> = { nightly: money("nightly") };
      for (const column of ["weekend_nightly", "extra_guest_nightly"]) {
        const value = money(column);
        if (value !== undefined) pricing[column] = value;
      }
      for (const column of ["included_guests", "min_nights"]) {
        const value = number(column);
        if (value !== undefined) pricing[column] = value;
      }
      rooms.push({
        line,
        input: {
          name: cell("name"),
          units: number("units"),
          max_guests: number("max_guests"),
          ...(cell("booking_mode") ? { booking_mode: cell("booking_mode").toLowerCase() } : {}),
          ...(cell("description") ? { description: cell("description") } : {}),
          pricing,
        },
      });
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
  return { ok: true, rooms };
}
