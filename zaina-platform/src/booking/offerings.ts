// zaina-platform/src/booking/offerings.ts
//
// What a business sells. For now, room types (I11): a name, how many
// identical rooms there are, how many guests each sleeps, how it is booked
// and its pricing rules (pricing.ts). A room type with bookings is hidden,
// never deleted, so every booking keeps its room type.

import { and, asc, eq, sql } from "drizzle-orm";
import { bookingModes, bookings, offerings, type BookingCurrency, type BookingMode, type Offering } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { formatMoney, toMinor } from "./money.ts";
import { fromNightly, validatePricingRules, type PricingRules } from "./pricing.ts";

export type OfferingValues = {
  name: string;
  description: string;
  units: number;
  maxGuests: number;
  bookingMode: BookingMode;
  pricing: PricingRules;
  status: "active" | "hidden";
  sortOrder: number;
};

const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Checks a room type sent by staff. With `current`, missing fields keep their values. */
export function validateOffering(input: Record<string, unknown>, current?: OfferingValues): { ok: true; value: OfferingValues } | { ok: false; error: string } {
  const pick = <T>(key: string, fallback: T | undefined) => (key in input ? input[key] : fallback);
  const name = pick("name", current?.name);
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) return { ok: false, error: "name is 1 to 120 characters" };
  const description = pick("description", current?.description ?? "");
  if (typeof description !== "string" || description.length > 2000) return { ok: false, error: "description is up to 2000 characters" };
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
    value: { name: name.trim(), description: description.trim(), units, maxGuests, bookingMode: bookingMode as BookingMode, pricing: pricing.rules, status, sortOrder },
  };
}

export function valuesOf(offering: Offering): OfferingValues {
  return {
    name: offering.name,
    description: offering.description,
    units: offering.units,
    maxGuests: offering.maxGuests,
    bookingMode: offering.bookingMode,
    pricing: offering.pricing as PricingRules,
    status: offering.status,
    sortOrder: offering.sortOrder,
  };
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

/** A room type as the staff API shows it. */
export function publicOffering(offering: Offering, currency: BookingCurrency) {
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
