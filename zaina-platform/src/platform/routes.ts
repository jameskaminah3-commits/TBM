// zaina-platform/src/platform/routes.ts
//
// The platform's own console (platform admins only):
//
//   GET  /v1/platform/businesses   every business on the platform
//   POST /v1/platform/businesses   { id, name, allowed_origins, time_zone?, daily_token_cap?, retention_days?,
//                                    owner: { email, name, password } }
//                                  → the business, its settings and its first owner
//
// A new business starts with a daily model budget and a retention period, so
// none runs with unlimited spend or keeps conversations forever by accident.

import { randomBytes } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { allBusinesses, clearBusinessCache } from "../businesses/registry.ts";
import { createBusinessWithOwner, findStaffByEmail } from "../db/platform-scope.ts";
import { normalizeOrigin } from "../gateway/origin.ts";
import { requirePlatformAdmin, requireStaff } from "../staff/auth.ts";
import { hashPassword, passwordProblem } from "../staff/passwords.ts";

const DEFAULT_DAILY_TOKEN_CAP = 5_000_000;
const DEFAULT_RETENTION_DAYS = 90;

/** A positive whole number from the request, the default when absent, or null when invalid. */
function positiveWhole(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}

export function registerPlatformRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);

  app.get("/v1/platform/businesses", staff, requirePlatformAdmin, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const businesses = await allBusinesses();
      res.json({
        businesses: businesses.map((business) => ({
          id: business.id,
          name: business.name,
          status: business.status,
          public_key: business.publicKey,
          allowed_origins: business.allowedOrigins,
          time_zone: business.timeZone,
          created_at: business.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/platform/businesses", staff, requirePlatformAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const timeZone = typeof req.body?.time_zone === "string" ? req.body.time_zone : "Africa/Nairobi";
      const origins = Array.isArray(req.body?.allowed_origins) ? req.body.allowed_origins.map((origin: unknown) => normalizeOrigin(String(origin))) : [];
      const owner = req.body?.owner ?? {};
      const dailyTokenCap = positiveWhole(req.body?.daily_token_cap, DEFAULT_DAILY_TOKEN_CAP);
      const retentionDays = positiveWhole(req.body?.retention_days, DEFAULT_RETENTION_DAYS);
      if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) return res.status(400).json({ error: "invalid_id", message: "Ids are lowercase letters, digits and dashes." });
      if (!name) return res.status(400).json({ error: "name_required" });
      if (origins.some((origin: string | null) => !origin)) return res.status(400).json({ error: "invalid_origin" });
      if (dailyTokenCap === null || retentionDays === null) {
        return res.status(400).json({ error: "invalid_limits", message: "daily_token_cap and retention_days are positive whole numbers." });
      }
      try {
        new Intl.DateTimeFormat("en", { timeZone });
      } catch {
        return res.status(400).json({ error: "invalid_time_zone" });
      }
      const ownerEmail = typeof owner.email === "string" ? owner.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ownerEmail)) return res.status(400).json({ error: "owner_email_required" });

      // An existing account becomes the owner as it is; a new one needs a name and a good password.
      const existing = await findStaffByEmail(ownerEmail);
      if (!existing) {
        const problem = passwordProblem(owner.password);
        if (problem) return res.status(400).json({ error: "weak_password", message: problem });
        if (typeof owner.name !== "string" || !owner.name.trim()) return res.status(400).json({ error: "owner_name_required" });
      }

      const publicKey = `pk_${id.replace(/-/g, "_")}_${randomBytes(6).toString("hex")}`;
      let ownerUser;
      try {
        ownerUser = await createBusinessWithOwner({
          business: { id, name, publicKey, allowedOrigins: origins as string[], timeZone, dailyTokenCap, retentionDays },
          owner: { email: ownerEmail, name: String(owner.name ?? ""), passwordHash: existing ? null : await hashPassword(owner.password) },
        });
      } catch (error) {
        const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
        if (database.code === "23505" && database.constraint === "businesses_pkey") return res.status(409).json({ error: "business_exists" });
        throw error;
      }
      clearBusinessCache();
      res.status(201).json({
        business: { id, name, public_key: publicKey, allowed_origins: origins, time_zone: timeZone, daily_token_cap: dailyTokenCap, retention_days: retentionDays },
        owner: { id: ownerUser.id, email: ownerUser.email },
      });
    } catch (error) {
      next(error);
    }
  });
}
