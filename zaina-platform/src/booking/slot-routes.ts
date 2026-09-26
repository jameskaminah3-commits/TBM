// zaina-platform/src/booking/slot-routes.ts
//
// Time slots, for a salon's or restaurant's team
// (/v1/staff/businesses/:businessId/…), by role:
//
//   GET    resources                     viewer   people, chairs and tables
//   POST   resources                     manager  { name, kind, seats?, min_party?, hours?, status?, sort_order? }
//   PUT    resources/:resourceId         manager  the same, partly
//   DELETE resources/:resourceId         manager  deleted, or hidden when it has bookings
//   GET    slots?offering_id=&date=&party=&resource_id=   viewer   the times free that day
//   GET    schedule?date=                viewer   each resource's bookings that day, and closures
//   GET    closures?from=&days=          viewer   POST closures (manager) { resource_id?, starts_at, ends_at, reason? }
//   DELETE closures/:closureId           manager  one the team added
//
// Opening hours and the slot interval are booking settings (PATCH
// booking-settings { opening_hours, slot_interval_minutes }); services and
// table bookings are offerings, with resource_ids for who can do them.

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import type { Business } from "../db/schema.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { daySchedule, slotsOn, todayFor } from "./appointments.ts";
import { publicBooking } from "./staff-routes.ts";
import { getOffering } from "./offerings.ts";
import { addDays, isoDate, parseDate } from "./pricing.ts";
import { zonedInstant } from "./local-time.ts";
import {
  createResource,
  createResourceBlock,
  deleteResourceBlock,
  getResource,
  listResourceBlocks,
  listResources,
  publicBlock,
  publicResource,
  removeResource,
  resourceValuesOf,
  updateResource,
  validateResource,
} from "./resources.ts";

type Handler = (req: Request, res: Response, context: { business: Business; userId: string }) => Promise<unknown>;

function handle(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = staffOf(req);
      await handler(req, res, { business: context.business!, userId: context.user.id });
    } catch (error) {
      next(error);
    }
  };
}

export function registerSlotRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId";
  const role = (minimum: "viewer" | "agent" | "manager" | "owner") => [staff, requireBusinessRole(minimum)];

  // ── Resources ────────────────────────────────────────────────────────
  app.get(`${base}/resources`, ...role("viewer"), handle(async (_req, res, { business }) => {
    res.json({ resources: (await listResources(business.id)).map(publicResource) });
  }));

  app.post(`${base}/resources`, ...role("manager"), handle(async (req, res, { business }) => {
    const checked = validateResource(req.body ?? {});
    if (!checked.ok) return res.status(400).json({ error: "invalid_resource", message: checked.error });
    const created = await createResource(business.id, checked.value);
    if (created === "name_taken") return res.status(409).json({ error: "name_taken", message: "Another one has that name." });
    res.status(201).json({ resource: publicResource(created) });
  }));

  app.put(`${base}/resources/:resourceId`, ...role("manager"), handle(async (req, res, { business }) => {
    const current = await getResource(business.id, String(req.params.resourceId));
    if (!current) return res.status(404).json({ error: "not_found" });
    const checked = validateResource(req.body ?? {}, resourceValuesOf(current));
    if (!checked.ok) return res.status(400).json({ error: "invalid_resource", message: checked.error });
    const updated = await updateResource(business.id, current.id, checked.value);
    if (updated === "name_taken") return res.status(409).json({ error: "name_taken", message: "Another one has that name." });
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json({ resource: publicResource(updated) });
  }));

  app.delete(`${base}/resources/:resourceId`, ...role("manager"), handle(async (req, res, { business }) => {
    const result = await removeResource(business.id, String(req.params.resourceId));
    if (result === "not_found") return res.status(404).json({ error: "not_found" });
    res.json({ result });
  }));

  // ── Times free, and the day's schedule ───────────────────────────────
  app.get(`${base}/slots`, ...role("viewer"), handle(async (req, res, { business }) => {
    const offering = await getOffering(business.id, String(req.query.offering_id ?? ""));
    if (!offering || (offering.kind !== "service" && offering.kind !== "table")) return res.status(404).json({ error: "not_found" });
    const date = typeof req.query.date === "string" && parseDate(req.query.date) ? req.query.date : todayFor(business.timeZone);
    const party = Math.max(1, Number(req.query.party) || 1);
    const resourceId = typeof req.query.resource_id === "string" && req.query.resource_id ? req.query.resource_id : null;
    const day = await slotsOn(business, offering, date, party, { resourceId, staff: true });
    if (!day.ok) return res.status(400).json({ error: day.error, message: day.message });
    const names = new Map(day.resources.map((resource) => [resource.id, resource.name]));
    res.json({
      date,
      party,
      slots: day.slots.map((slot) => ({ time: slot.time, starts_at: slot.startsAt, ends_at: slot.endsAt, free: slot.resourceIds.map((id) => ({ id, name: names.get(id) ?? "" })) })),
    });
  }));

  app.get(`${base}/schedule`, ...role("viewer"), handle(async (req, res, { business }) => {
    const date = typeof req.query.date === "string" && parseDate(req.query.date) ? req.query.date : todayFor(business.timeZone);
    const { resources, entries } = await daySchedule(business, date);
    const from = zonedInstant(date, "00:00", business.timeZone);
    const to = zonedInstant(isoDate(addDays(parseDate(date)!, 1)), "00:00", business.timeZone);
    const names = new Map(resources.map((resource) => [resource.id, resource.name]));
    res.json({
      date,
      resources: resources.map(publicResource),
      bookings: entries.map((entry) => publicBooking(entry.booking, entry.offeringName, { timeZone: business.timeZone, resourceName: entry.booking.resourceId ? names.get(entry.booking.resourceId) ?? null : null })),
      closures: (await listResourceBlocks(business.id, from, to)).map(publicBlock),
    });
  }));

  // ── Closures ─────────────────────────────────────────────────────────
  app.get(`${base}/closures`, ...role("viewer"), handle(async (req, res, { business }) => {
    const fromDate = typeof req.query.from === "string" && parseDate(req.query.from) ? req.query.from : todayFor(business.timeZone);
    const days = Math.min(92, Math.max(1, Number(req.query.days) || 30));
    const from = zonedInstant(fromDate, "00:00", business.timeZone);
    const to = zonedInstant(isoDate(addDays(parseDate(fromDate)!, days)), "00:00", business.timeZone);
    res.json({ closures: (await listResourceBlocks(business.id, from, to)).map(publicBlock) });
  }));

  app.post(`${base}/closures`, ...role("manager"), handle(async (req, res, { business, userId }) => {
    const resourceId = typeof req.body?.resource_id === "string" && req.body.resource_id ? req.body.resource_id : null;
    if (resourceId && !(await getResource(business.id, resourceId))) return res.status(404).json({ error: "not_found" });
    const startsAt = new Date(String(req.body?.starts_at ?? ""));
    const endsAt = new Date(String(req.body?.ends_at ?? ""));
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 366 * 86_400_000) {
      return res.status(400).json({ error: "invalid_times", message: "ends_at is after starts_at (ISO times), within a year." });
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
    const block = await createResourceBlock(business.id, { resourceId, startsAt, endsAt, reason, createdBy: userId });
    res.status(201).json({ closure: publicBlock(block) });
  }));

  app.delete(`${base}/closures/:closureId`, ...role("manager"), handle(async (req, res, { business }) => {
    const deleted = await deleteResourceBlock(business.id, String(req.params.closureId));
    res.status(deleted ? 200 : 404).json({ deleted });
  }));
}
