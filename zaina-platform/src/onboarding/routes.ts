// zaina-platform/src/onboarding/routes.ts
//
// Setting a business up and putting it live (/v1/staff/businesses/:businessId/…):
//
//   GET  onboarding   viewer   where it stands: its steps (done, required, where), and whether it can go live
//   POST go-live      owner    puts it live once every required step is done
//   POST preview      manager  a chat with Zaina in the console, to try it (live or not)
//
// Going live is the business's own decision; the platform team can still
// pause a business (and resume it) from the platform's pages.

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { clearBusinessCache } from "../businesses/registry.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { createSession } from "../conversations/store.ts";
import { setBusinessStatus } from "../db/platform-scope.ts";
import type { Business } from "../db/schema.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { issueSessionToken } from "../gateway/session-token.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { checklist, readyToGoLive } from "./checklist.ts";

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

export function registerOnboardingRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId";
  const role = (minimum: "viewer" | "agent" | "manager" | "owner") => [staff, requireBusinessRole(minimum)];

  async function view(business: Business) {
    const steps = await checklist(business);
    return {
      status: business.status,
      pause_reason: business.pauseReason,
      went_live_at: business.wentLiveAt,
      steps,
      done: steps.filter((step) => step.done).length,
      ready: readyToGoLive(steps),
    };
  }

  app.get(`${base}/onboarding`, ...role("viewer"), handle(async (_req, res, { business }) => {
    res.json(await view(business));
  }));

  app.post(`${base}/go-live`, ...role("owner"), handle(async (_req, res, { business }) => {
    if (business.status === "active") return res.status(409).json({ error: "already_live", message: "This business is already live." });
    if (business.status === "paused") {
      return res.status(409).json({
        error: "paused",
        message: business.pauseReason === "billing" ? "This business is paused for an unpaid invoice: pay it in Billing." : "This business is paused by the Zaina team. Please contact them.",
      });
    }
    const steps = await checklist(business);
    if (!readyToGoLive(steps)) {
      const left = steps.filter((step) => step.required && !step.done).map((step) => step.title);
      return res.status(409).json({ error: "not_ready", message: `Finish these first: ${left.join("; ")}.`, steps_left: left });
    }
    await setBusinessStatus(business.id, "active");
    clearBusinessCache();
    res.json(await view({ ...business, status: "active", wentLiveAt: business.wentLiveAt ?? new Date() }));
  }));

  app.post(`${base}/preview`, ...role("manager"), handle(async (_req, res, { business }) => {
    const verdict = await consumeLimits([{ key: `preview:${business.id}`, limit: 30, windowSeconds: 3600 }]);
    if (!verdict.allowed) return res.status(429).json({ error: "rate_limited", message: "That's a lot of test chats: please wait a little." });
    const settings = await getBusinessSettings(business.id);
    const currency = settings?.defaultCurrency === "KES" ? "KES" : "USD";
    const session = await createSession(business.id, { displayCurrency: currency, visitorKey: null, preview: true });
    res.status(201).json({ session_id: session.id, token: issueSessionToken(config.sessionTokenSecret, { sessionId: session.id, businessId: business.id }) });
  }));
}
