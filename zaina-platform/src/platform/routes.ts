// zaina-platform/src/platform/routes.ts
//
// The platform's own console (platform admins only):
//
//   GET  /v1/platform/businesses   every business on the platform
//   GET  /v1/platform/overview     every business's day: model use against its budget, chats,
//                                  waiting handoffs, failed turns, WhatsApp; and what the platform has switched on
//   POST /v1/platform/businesses   { id, name, allowed_origins, business_type?, time_zone?, daily_token_cap?,
//                                    retention_days?, owner: { email, name, password } }
//                                  → the business, its settings and its first owner
//
// A new business starts with a daily model budget and a retention period, so
// none runs with unlimited spend or keeps conversations forever by accident.

import { randomBytes } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { anyBusinessById, clearBusinessCache, everyBusiness } from "../businesses/registry.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { businessDay } from "../gateway/spend-cap.ts";
import { createBusinessWithOwner, findStaffByEmail, setBusinessStatus } from "../db/platform-scope.ts";
import { businessTypes, type BusinessType } from "../db/schema.ts";
import { TYPES_WITH_OWN_CONNECTOR } from "../engine/tool-sets.ts";
import { normalizeOrigin } from "../gateway/origin.ts";
import { requirePlatformAdmin, requireStaff } from "../staff/auth.ts";
import { hashPassword, passwordProblem } from "../staff/passwords.ts";

export const DEFAULT_DAILY_TOKEN_CAP = 5_000_000;
export const DEFAULT_RETENTION_DAYS = 90;

/** A positive whole number from the request, the default when absent, or null when invalid. */
function positiveWhole(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}

export function registerPlatformRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);

  app.get("/v1/platform/businesses", staff, requirePlatformAdmin, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const businesses = await everyBusiness();
      res.json({
        businesses: businesses.map((business) => ({
          id: business.id,
          name: business.name,
          status: business.status,
          business_type: business.businessType,
          public_key: business.publicKey,
          allowed_origins: business.allowedOrigins,
          time_zone: business.timeZone,
          created_at: business.createdAt,
          went_live_at: business.wentLiveAt,
          source: business.source,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  // Pausing a business stops its chats (website and WhatsApp) until it's resumed; its team keeps the console.
  app.patch("/v1/platform/businesses/:businessId", staff, requirePlatformAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await anyBusinessById(String(req.params.businessId));
      if (!business) return res.status(404).json({ error: "not_found" });
      const status = req.body?.status;
      if (status !== "active" && status !== "paused") return res.status(400).json({ error: "invalid_status", message: "status is active or paused." });
      if (status === "active" && business.status === "onboarding") {
        return res.status(409).json({ error: "setting_up", message: "The business puts itself live when its setup is done." });
      }
      await setBusinessStatus(business.id, status);
      clearBusinessCache();
      res.json({ id: business.id, status });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/platform/overview", staff, requirePlatformAdmin, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const businesses = await everyBusiness();
      const rows = await Promise.all(businesses.map((business) => runForBusiness(business.id, () => inBusiness(async (_db, client) => {
        const { rows: [row] } = await client.query<{
          tokens_today: string | null; chats_7d: number; waiting: number; turns_24h: number; failed_24h: number;
          last_activity: Date | null; whatsapp: boolean; live_since: Date | null; bookings_30d: number;
          deposits_30d: Array<{ currency: string; amount: number }>; last_booking: Date | null;
        }>(
          `select
             (select input_tokens + output_tokens from usage_daily where business_id = $1 and day = $2) as tokens_today,
             (select count(*)::int from chat_sessions as s where s.business_id = $1 and s.created_at > now() - interval '7 days'
                and exists (select 1 from chat_events as e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER')) as chats_7d,
             (select count(*)::int from chat_sessions where business_id = $1 and managed_by = 'HUMAN' and assigned_agent_id is null) as waiting,
             (select count(*)::int from turn_metrics where business_id = $1 and started_at > now() - interval '24 hours') as turns_24h,
             (select count(*)::int from turn_metrics where business_id = $1 and started_at > now() - interval '24 hours'
                and outcome in ('timeout', 'model_error', 'error')) as failed_24h,
             (select max(last_activity_at) from chat_sessions where business_id = $1) as last_activity,
             exists (select 1 from whatsapp_numbers where business_id = $1 and status = 'active') as whatsapp,
             (select min(s.created_at) from chat_sessions as s where s.business_id = $1
                and exists (select 1 from chat_events as e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER')) as live_since,
             (select count(*)::int from bookings where business_id = $1 and status = 'confirmed' and created_at > now() - interval '30 days') as bookings_30d,
             (select coalesce(json_agg(json_build_object('currency', currency, 'amount', total) order by currency), '[]'::json)
                from (select currency, sum(amount_minor) / 100.0 as total from payments
                      where business_id = $1 and status = 'succeeded' and settled_at > now() - interval '30 days' group by currency) as paid) as deposits_30d,
             (select max(created_at) from bookings where business_id = $1 and status = 'confirmed') as last_booking`,
          [business.id, businessDay(business.timeZone)],
        );
        return {
          id: business.id,
          name: business.name,
          business_type: business.businessType,
          tokens_today: Number(row.tokens_today ?? 0),
          daily_token_cap: business.dailyTokenCap,
          chats_7d: row.chats_7d,
          waiting: row.waiting,
          turns_24h: row.turns_24h,
          failed_24h: row.failed_24h,
          last_activity_at: row.last_activity,
          whatsapp: row.whatsapp,
          // Phase 4's exit check, for a place to stay: live 30 days, with bookings and deposits in the last 30.
          stays: business.businessType === "guesthouse" ? {
            live_since: row.live_since,
            live_days: row.live_since ? Math.floor((Date.now() - row.live_since.getTime()) / 86_400_000) : 0,
            bookings_30d: row.bookings_30d,
            deposits_30d: row.deposits_30d.map((entry) => ({ currency: entry.currency, amount: Number(entry.amount) })),
            last_booking_at: row.last_booking,
            pilot_ready: Boolean(row.live_since && Date.now() - row.live_since.getTime() >= 30 * 86_400_000
              && row.bookings_30d > 0 && row.deposits_30d.some((entry) => Number(entry.amount) > 0)),
          } : null,
        };
      }, business.id))));
      res.json({
        businesses: rows,
        platform: {
          whatsapp: Boolean(config.whatsapp),
          web_push: Boolean(config.webPush),
          alert_email: Boolean(config.alertEmail),
          public_base_url: config.publicBaseUrl,
        },
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
      const businessType = (req.body?.business_type ?? "general") as BusinessType;
      if (!businessTypes.includes(businessType)) {
        return res.status(400).json({ error: "invalid_business_type", message: `business_type is one of ${businessTypes.join(", ")}.` });
      }
      // A type whose tools need the business's own system can't be added without its connector.
      if (TYPES_WITH_OWN_CONNECTOR.has(businessType)) {
        return res.status(400).json({ error: "connector_required", message: `A ${businessType} business needs its own connector, set up by the platform team.` });
      }
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
          business: { id, name, publicKey, allowedOrigins: origins as string[], timeZone, dailyTokenCap, retentionDays, businessType },
          owner: { email: ownerEmail, name: String(owner.name ?? ""), passwordHash: existing ? null : await hashPassword(owner.password) },
        });
      } catch (error) {
        const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
        if (database.code === "23505" && database.constraint === "businesses_pkey") return res.status(409).json({ error: "business_exists" });
        throw error;
      }
      clearBusinessCache();
      res.status(201).json({
        business: {
          id, name, business_type: businessType, public_key: publicKey, allowed_origins: origins, time_zone: timeZone,
          daily_token_cap: dailyTokenCap, retention_days: retentionDays,
        },
        owner: { id: ownerUser.id, email: ownerUser.email },
      });
    } catch (error) {
      next(error);
    }
  });
}
