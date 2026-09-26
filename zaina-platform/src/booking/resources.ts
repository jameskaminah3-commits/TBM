// zaina-platform/src/booking/resources.ts
//
// Who or what a time-slot booking takes: a stylist, a chair, a table. A
// resource can keep its own working hours inside the business's, and be
// closed for a while (resource_blocks: time off, a private event, or a busy
// time from a connected calendar). A resource with bookings is hidden, never
// deleted.

import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { bookings, resourceBlocks, resourceKinds, resources, type Resource, type ResourceBlock, type ResourceKind, type WeekHours } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { describeWeek, validateWeekHours } from "./slots.ts";

export type ResourceValues = {
  name: string;
  kind: ResourceKind;
  seats: number;
  minParty: number;
  hours: WeekHours | null;
  status: "active" | "hidden";
  sortOrder: number;
};

const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

export function validateResource(input: Record<string, unknown>, current?: ResourceValues): { ok: true; value: ResourceValues } | { ok: false; error: string } {
  const pick = <T>(key: string, fallback: T | undefined) => (key in input ? input[key] : fallback);
  const name = pick("name", current?.name);
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) return { ok: false, error: "name is 1 to 80 characters" };
  const kind = pick("kind", current?.kind);
  if (!resourceKinds.includes(kind as ResourceKind)) return { ok: false, error: `kind is one of ${resourceKinds.join(", ")}` };
  const seats = pick("seats", current?.seats ?? 1);
  if (!whole(seats, 1, 100)) return { ok: false, error: "seats is 1 to 100" };
  const minParty = pick("min_party", current?.minParty ?? 1);
  if (!whole(minParty, 1, seats)) return { ok: false, error: `min_party is 1 to ${seats} (the seats)` };
  const rawHours = pick("hours", current?.hours ?? null);
  let hours: WeekHours | null = null;
  if (rawHours !== null) {
    const checked = validateWeekHours(rawHours);
    if (!checked.ok) return { ok: false, error: checked.error };
    hours = checked.hours;
  }
  const status = pick("status", current?.status ?? "active");
  if (status !== "active" && status !== "hidden") return { ok: false, error: "status is active or hidden" };
  const sortOrder = pick("sort_order", current?.sortOrder ?? 0);
  if (!whole(sortOrder, -1000, 1000)) return { ok: false, error: "sort_order is a whole number" };
  return { ok: true, value: { name: name.trim(), kind: kind as ResourceKind, seats, minParty, hours, status, sortOrder } };
}

export const resourceValuesOf = (resource: Resource): ResourceValues => ({
  name: resource.name, kind: resource.kind, seats: resource.seats, minParty: resource.minParty, hours: resource.hours, status: resource.status, sortOrder: resource.sortOrder,
});

export async function listResources(businessId: string, options: { activeOnly?: boolean } = {}): Promise<Resource[]> {
  return inBusiness((db) => db.select().from(resources)
    .where(options.activeOnly ? and(eq(resources.businessId, businessId), eq(resources.status, "active")) : eq(resources.businessId, businessId))
    .orderBy(asc(resources.sortOrder), asc(resources.name)), businessId);
}

export async function getResource(businessId: string, id: string): Promise<Resource | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await inBusiness((db) => db.select().from(resources).where(and(eq(resources.businessId, businessId), eq(resources.id, id))).limit(1), businessId);
  return row;
}

const isNameTaken = (error: unknown) => {
  const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
  return database.code === "23505" && database.constraint === "resources_name_idx";
};

export async function createResource(businessId: string, value: ResourceValues): Promise<Resource | "name_taken"> {
  try {
    const [row] = await inBusiness((db) => db.insert(resources).values({ businessId, ...value }).returning(), businessId);
    return row;
  } catch (error) {
    if (isNameTaken(error)) return "name_taken";
    throw error;
  }
}

export async function updateResource(businessId: string, id: string, value: ResourceValues): Promise<Resource | "name_taken" | undefined> {
  try {
    const [row] = await inBusiness((db) => db.update(resources).set({ ...value, updatedAt: new Date() })
      .where(and(eq(resources.businessId, businessId), eq(resources.id, id))).returning(), businessId);
    return row;
  } catch (error) {
    if (isNameTaken(error)) return "name_taken";
    throw error;
  }
}

/** Deletes a resource nobody has booked; hides one with bookings. */
export async function removeResource(businessId: string, id: string): Promise<"deleted" | "hidden" | "not_found"> {
  return inBusiness(async (db) => {
    const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.businessId, businessId), eq(bookings.resourceId, id)));
    if ((used?.n ?? 0) > 0) {
      const hidden = await db.update(resources).set({ status: "hidden", updatedAt: new Date() })
        .where(and(eq(resources.businessId, businessId), eq(resources.id, id))).returning({ id: resources.id });
      return hidden.length ? "hidden" : "not_found";
    }
    const deleted = await db.delete(resources).where(and(eq(resources.businessId, businessId), eq(resources.id, id))).returning({ id: resources.id });
    return deleted.length ? "deleted" : "not_found";
  }, businessId);
}

export function publicResource(resource: Resource) {
  return {
    id: resource.id,
    name: resource.name,
    kind: resource.kind,
    seats: resource.seats,
    min_party: resource.minParty,
    hours: resource.hours,
    hours_text: resource.hours ? describeWeek(resource.hours) : null,
    status: resource.status,
    sort_order: resource.sortOrder,
  };
}

// ── Closures ──────────────────────────────────────────────────────────

export async function listResourceBlocks(businessId: string, from: Date, to: Date): Promise<ResourceBlock[]> {
  return inBusiness((db) => db.select().from(resourceBlocks)
    .where(and(eq(resourceBlocks.businessId, businessId), lt(resourceBlocks.startsAt, to), gt(resourceBlocks.endsAt, from)))
    .orderBy(asc(resourceBlocks.startsAt)), businessId);
}

export async function createResourceBlock(businessId: string, input: { resourceId: string | null; startsAt: Date; endsAt: Date; reason: string; createdBy: string | null }): Promise<ResourceBlock> {
  const [row] = await inBusiness((db) => db.insert(resourceBlocks).values({ businessId, ...input, source: "staff" }).returning(), businessId);
  return row;
}

/** Removes a closure the team added (a calendar's busy times come and go with the calendar). */
export async function deleteResourceBlock(businessId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await inBusiness((db) => db.delete(resourceBlocks)
    .where(and(eq(resourceBlocks.businessId, businessId), eq(resourceBlocks.id, id), eq(resourceBlocks.source, "staff"))).returning({ id: resourceBlocks.id }), businessId);
  return rows.length > 0;
}

export const publicBlock = (block: ResourceBlock) => ({
  id: block.id,
  resource_id: block.resourceId,
  starts_at: block.startsAt,
  ends_at: block.endsAt,
  reason: block.reason,
  source: block.source,
});
