// zaina-platform/src/prices/routes.ts
//
// A business's price list, for its staff (least role needed):
//
//   GET    /v1/staff/businesses/:businessId/price-list        viewer   every item, shown or hidden
//   POST   …/price-list { name, price, section?, description?, price_max?, currency?, unit?, status?, sort_order? }
//                                                             manager  add one
//   PATCH  …/price-list/:itemId { … }                         manager  change one
//   DELETE …/price-list/:itemId                               manager  remove one
//   POST   …/price-list/parse { text, currency? }             manager  a pasted list read into items and
//                                                                      problems, to check (nothing is saved)
//   POST   …/price-list/import { items: [ … ], replace? }     manager  many at once: an item with the same
//                                                                      section and name gets the new price;
//                                                                      replace makes the list exactly these
//
// Prices are sent and shown in major units ("3500" is KSh 3,500).

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import {
  createPriceItem,
  deletePriceItem,
  getPriceItem,
  importPriceItems,
  listPriceItems,
  MAX_PRICE_ITEMS,
  parsePriceList,
  PriceListFull,
  publicPriceItem,
  updatePriceItem,
  validatePriceItem,
  type PriceItemValues,
} from "./price-list.ts";

/** Price-list routes take bigger bodies than the rest of the API (a pasted list). */
export const PRICE_LIST_PATH = /^\/v1\/staff\/businesses\/[^/]+\/price-list(?:\/|$)/;
const priceListBody = express.json({ limit: "300kb" });

const nameTaken = { error: "name_taken", message: "The list already has an item with that name in that section." };

export function registerPriceListRoutes(app: Express, secret: string): void {
  const staff = requireStaff(secret);
  const base = "/v1/staff/businesses/:businessId/price-list";
  const handle = (fn: (req: Request, res: Response, businessId: string, userId: string) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { business, user } = staffOf(req);
        await fn(req, res, business!.id, user.id);
      } catch (error) {
        next(error);
      }
    };

  app.get(base, staff, requireBusinessRole("viewer"), handle(async (_req, res, businessId) => {
    res.json({ items: (await listPriceItems(businessId)).map(publicPriceItem) });
  }));

  app.post(base, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res, businessId, userId) => {
    const checked = validatePriceItem(req.body ?? {});
    if (!checked.ok) return res.status(400).json({ error: "invalid_item", message: checked.error });
    const created = await createPriceItem(businessId, checked.value, userId);
    if (created === "name_taken") return res.status(409).json(nameTaken);
    if (created === "too_many") return res.status(409).json({ error: "too_many", message: `A price list has at most ${MAX_PRICE_ITEMS} items.` });
    res.status(201).json({ item: publicPriceItem(created) });
  }));

  app.post(`${base}/parse`, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!text.trim()) return res.status(400).json({ error: "text_required", message: "Paste your price list, an item per line." });
    if (text.length > 100_000) return res.status(413).json({ error: "too_long", message: "That list is too long: paste it in parts." });
    const currency = req.body?.currency === "USD" ? "USD" : "KES";
    res.json(parsePriceList(text, currency));
  }));

  app.post(`${base}/import`, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res, businessId, userId) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || items.length === 0) return res.status(400).json({ error: "items_required", message: "No items to add." });
    if (items.length > MAX_PRICE_ITEMS) return res.status(400).json({ error: "too_many", message: `At most ${MAX_PRICE_ITEMS} items at once.` });
    const values: PriceItemValues[] = [];
    for (const [index, item] of items.entries()) {
      const checked = validatePriceItem(item && typeof item === "object" ? item : {});
      if (!checked.ok) return res.status(400).json({ error: "invalid_item", message: `Item ${index + 1}: ${checked.error}` });
      values.push(checked.value);
    }
    const keys = values.map((value) => `${(value.section ?? "").toLowerCase()}\u0000${value.name.toLowerCase()}`);
    if (new Set(keys).size !== keys.length) return res.status(400).json({ error: "duplicate_items", message: "Two items have the same name in the same section." });
    try {
      const counts = await importPriceItems(businessId, values, { replace: req.body?.replace === true, userId });
      res.json({ ...counts, items: (await listPriceItems(businessId)).map(publicPriceItem) });
    } catch (error) {
      if (error instanceof PriceListFull) return res.status(409).json({ error: "too_many", message: error.message });
      throw error;
    }
  }));

  app.patch(`${base}/:itemId`, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res, businessId, userId) => {
    const current = await getPriceItem(businessId, String(req.params.itemId));
    if (!current) return res.status(404).json({ error: "not_found" });
    const checked = validatePriceItem(req.body ?? {}, current);
    if (!checked.ok) return res.status(400).json({ error: "invalid_item", message: checked.error });
    const updated = await updatePriceItem(businessId, current.id, checked.value, userId);
    if (updated === "name_taken") return res.status(409).json(nameTaken);
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json({ item: publicPriceItem(updated) });
  }));

  app.delete(`${base}/:itemId`, staff, requireBusinessRole("manager"), handle(async (req, res, businessId) => {
    const deleted = await deletePriceItem(businessId, String(req.params.itemId));
    res.status(deleted ? 200 : 404).json({ deleted });
  }));
}
