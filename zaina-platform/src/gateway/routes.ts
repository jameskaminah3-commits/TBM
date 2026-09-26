// zaina-platform/src/gateway/routes.ts
//
// The public chat API a website widget calls. Every request is tied to a
// business (by its id or public key, then by the signed session token),
// checked against the business's allowed websites, and rate limited in
// Postgres before any model is called (C6).
//
//   POST /v1/sessions            open a chat: { business (id or public key) | business_key, display_currency }
//   POST /v1/chat                send a message (Authorization: Bearer <token>)
//   GET  /v1/session             the chat's state (who is handling it)
//   GET  /v1/chat/messages       messages after ?after=<id> (replies during a handoff)
//   GET  /v1/widget/config       ?business=<id> (or ?key=<public key>): the widget's name, colour, position,
//                                greeting, and its WhatsApp link when it offers one

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import type { Business } from "../db/schema.ts";
import { runForBusiness } from "../db/tenant.ts";
import { allowedOriginsFor, anyBusinessById, businessById, businessByPublicKey } from "../businesses/registry.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { getNumber } from "../channels/whatsapp/numbers.ts";
import { createSession, customerVisibleEvents, getSession, setDisplayCurrency } from "../conversations/store.ts";
import { handleChatTurn, type EngineOptions } from "../engine/agent.ts";
import { recordTurn, TurnRecorder } from "../engine/telemetry.ts";
import { isOriginAllowed } from "./origin.ts";
import { consumeLimits, type LimitRule } from "./rate-limit.ts";
import { bearerToken, issueSessionToken, verifySessionToken } from "./session-token.ts";
import { visitorKey } from "./visitor.ts";

const MAX_MESSAGE_LENGTH = 2000;

type Authorized = { business: Business; sessionId: string };

function refuse(res: Response, status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  res.status(status).json({ error, message, ...extra });
}

function currencyOf(value: unknown): "USD" | "KES" | null {
  return value === "USD" || value === "KES" ? value : null;
}

/**
 * The live business a website names: by its id (zaina.js's data-business)
 * or its public key (data-key, and older snippets). Ids never start with
 * "pk_", so the two can't be confused.
 */
export async function namedBusiness(value: unknown): Promise<Business | undefined> {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 120) return undefined;
  return name.startsWith("pk_") ? businessByPublicKey(name) : businessById(name);
}

/** A wa.me link to a WhatsApp number as Meta shows it ("+254 712 345678"), or null. */
export function whatsappLink(displayPhoneNumber: string | null | undefined): string | null {
  const digits = (displayPhoneNumber ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}

export function registerGatewayRoutes(app: Express, config: PlatformConfig, engine: EngineOptions): void {
  const secret = config.sessionTokenSecret;
  const limits = config.rateLimits;

  const consoleOrigin = config.publicBaseUrl ? [config.publicBaseUrl] : [];

  /**
   * The business and session behind the request's token, or a refusal. A
   * business's own team trying Zaina in the console (a preview chat) may do
   * so before the business is live, from the console's own address.
   */
  async function authorize(req: Request, res: Response): Promise<Authorized | null> {
    const claims = verifySessionToken(secret, bearerToken(req.header("authorization")));
    if (!claims) {
      refuse(res, 401, "invalid_session", "This chat has expired. Please start a new one.");
      return null;
    }
    const business = await anyBusinessById(claims.businessId);
    const live = business?.status === "active";
    const originAllowed = business ? isOriginAllowed(req.header("origin"), allowedOriginsFor(business)) : false;
    // Only when it matters: is this the team's own preview chat?
    const preview = business && (!live || !originAllowed)
      ? (await runForBusiness(business.id, () => getSession(claims.sessionId)))?.preview === true
      : false;
    if (!business || (!live && !preview)) {
      refuse(res, 404, "unknown_business", "This chat is not available.");
      return null;
    }
    if (!originAllowed && !(preview && isOriginAllowed(req.header("origin"), consoleOrigin))) {
      refuse(res, 403, "origin_not_allowed", "This website can't use this chat.");
      return null;
    }
    return { business, sessionId: claims.sessionId };
  }

  async function limited(req: Request, res: Response, business: Business, rules: LimitRule[], sessionId: string | null) {
    const verdict = await consumeLimits(rules);
    if (verdict.allowed) return false;
    res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
    refuse(res, 429, "rate_limited", "You're sending messages too quickly. Please wait a moment and try again.", {
      retry_after_seconds: verdict.retryAfterSeconds,
    });
    // Refusals are measured too: a flood shows up in the telemetry.
    await recordTurn(business.id, sessionId, new TurnRecorder().finish("rate_limited")).catch(() => {});
    return true;
  }

  app.get("/v1/health", (_req: Request, res: Response) => {
    // No model name here: which model a business runs on is kept private.
    res.json({ ok: true, service: "zaina-platform", time: new Date().toISOString() });
  });

  app.post("/v1/sessions", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await namedBusiness(req.body?.business ?? req.body?.business_key);
      if (!business) return refuse(res, 404, "unknown_business", "This chat is not available.");
      if (!isOriginAllowed(req.header("origin"), allowedOriginsFor(business))) {
        return refuse(res, 403, "origin_not_allowed", "This website can't use this chat.");
      }
      const visitor = visitorKey(secret, req.ip);
      if (await limited(req, res, business, [
        { key: `sessions:visitor:${visitor}`, limit: limits.visitorSessionsPerHour, windowSeconds: 3600 },
      ], null)) return;

      const session = await createSession(business.id, {
        displayCurrency: currencyOf(req.body?.display_currency) ?? "USD",
        visitorKey: visitor,
      });
      res.status(201).json({
        session_id: session.id,
        token: issueSessionToken(secret, { sessionId: session.id, businessId: business.id }),
        display_currency: session.displayCurrency,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/chat", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      const message = req.body?.message;
      if (typeof message !== "string" || !message.trim()) return refuse(res, 400, "message_required", "Please type a message.");
      if (message.length > MAX_MESSAGE_LENGTH) return refuse(res, 413, "message_too_long", "That message is too long. Please shorten it.");

      const visitor = visitorKey(secret, req.ip);
      if (await limited(req, res, auth.business, [
        { key: `messages:session:${auth.sessionId}`, limit: limits.sessionMessagesPerMinute, windowSeconds: 60 },
        { key: `messages:visitor:${visitor}`, limit: limits.visitorMessagesPer10Minutes, windowSeconds: 600 },
        { key: `messages:business:${auth.business.id}`, limit: limits.businessMessagesPerHour, windowSeconds: 3600 },
      ], auth.sessionId)) return;

      // The site's currency switch applies to the prices Zaina quotes next.
      const currency = currencyOf(req.header("x-zaina-currency"));
      if (currency) await runForBusiness(auth.business.id, () => setDisplayCurrency(auth.sessionId, currency));

      const result = await handleChatTurn({ business: auth.business, sessionId: auth.sessionId, message, options: engine });
      switch (result.status) {
        case "ok":
          return res.json({ status: "ok", reply: result.reply, escalated: result.escalated === true });
        case "human_managed":
          return res.json({ status: "human_managed", reply: null });
        case "busy":
          return res.status(409).json({ status: "busy", reply: result.reply });
        default:
          return res.status(result.error === "session_not_found" ? 404 : 500).json({ error: result.error, message: result.message });
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/session", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      const session = await runForBusiness(auth.business.id, () => getSession(auth.sessionId));
      if (!session) return refuse(res, 404, "session_not_found", "This chat no longer exists.");
      // The handoff reason is an internal note for the team: never sent to the browser.
      res.json({
        session_id: session.id,
        managed_by: session.managedBy,
        display_currency: session.displayCurrency,
        created_at: session.createdAt,
      });
    } catch (error) {
      next(error);
    }
  });

  // What the website widget needs before the first message: public, per business.
  app.get("/v1/widget/config", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await namedBusiness(req.query.business ?? req.query.key);
      if (!business) return refuse(res, 404, "unknown_business", "This chat is not available.");
      if (!isOriginAllowed(req.header("origin"), allowedOriginsFor(business))) {
        return refuse(res, 403, "origin_not_allowed", "This website can't use this chat.");
      }
      const settings = await getBusinessSettings(business.id);
      // "Chat on WhatsApp", when the business has a number connected and offers it.
      const number = settings?.widgetWhatsapp === false ? null : await getNumber(business.id);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        name: settings?.displayName ?? business.name,
        assistant_name: settings?.assistantName ?? "Zaina",
        color: settings?.widgetColor ?? "#0f766e",
        position: settings?.widgetPosition ?? "right",
        greeting: settings?.widgetGreeting ?? null,
        currency: settings?.defaultCurrency ?? "USD",
        whatsapp: number?.status === "active" ? whatsappLink(number.displayPhoneNumber) : null,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/chat/messages", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      const after = Number(req.query.after ?? 0);
      const events = await runForBusiness(auth.business.id, () => customerVisibleEvents(auth.sessionId, Number.isSafeInteger(after) && after > 0 ? after : 0));
      res.json({
        messages: events.map((event) => ({
          id: event.id,
          from: event.actor === "USER" ? "customer" : event.actor === "AGENT" ? "team" : "zaina",
          text: event.content,
          at: event.createdAt,
          // A team reply shows who wrote it (first name only).
          ...(event.actor === "AGENT" && event.authorName ? { author: event.authorName } : {}),
        })),
      });
    } catch (error) {
      next(error);
    }
  });
}
