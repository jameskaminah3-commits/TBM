// zaina-platform/src/admin/routes.ts
//
// Platform administration (admin token until Phase 1's roles):
//
//   GET    /v1/admin/businesses/:id/metrics?days=7   cost and outcomes per conversation (I15)
//   DELETE /v1/admin/businesses/:id/sessions/:sid     delete one conversation (I17)
//   POST   /v1/admin/businesses/:id/erase             delete a customer's conversations: { email?, phone? }

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { platformPool } from "../db/platform-db.ts";
import { requireAdminToken } from "../conversations/staff-routes.ts";
import { deleteConversation, eraseCustomer } from "../conversations/retention.ts";
import { summarizeTurns } from "../engine/telemetry.ts";

export function registerAdminRoutes(app: Express, config: PlatformConfig): void {
  const adminOnly = requireAdminToken(config.adminToken);

  app.get("/v1/admin/businesses/:id/metrics", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = Math.min(90, Math.max(1, Number(req.query.days ?? 7) || 7));
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
      res.json(await summarizeTurns(platformPool(), req.params.id, { from, to }, config.modelPriceUsdPerMillion));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/v1/admin/businesses/:id/sessions/:sessionId", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await deleteConversation(req.params.id, req.params.sessionId);
      res.status(deleted ? 200 : 404).json({ deleted });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/businesses/:id/erase", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email : undefined;
      const phone = typeof req.body?.phone === "string" ? req.body.phone : undefined;
      if (!email && !phone) return res.status(400).json({ error: "contact_required", message: "Send an email or phone number." });
      res.json({ deleted_conversations: await eraseCustomer(req.params.id, { email, phone }) });
    } catch (error) {
      next(error);
    }
  });
}
