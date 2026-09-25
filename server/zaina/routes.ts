// server/zaina/routes.ts
//
// Zaina's HTTP surface.
//
// FEATURE FLAG:
//   ZAINA_ENABLED env var controls whether Zaina is live.
//   Default: false. Set to "true" to enable.
//   When disabled, every Zaina route (except /health) returns 503.
//
// CURRENCY SYNC:
//   The widget sends x-zaina-currency on every chat message. If it differs
//   from the session's stored display_currency, we update the session so
//   the next tool call formats prices in the customer's current currency.

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { chatSessions, zainaAuditLogs } from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { handleZainaMessage } from "./router";
import { consumeLimits, visitorKey, ZAINA_LIMITS } from "./limits";

// ═══════════════════════════════════════════════════════════════════
// FEATURE FLAG
// ═══════════════════════════════════════════════════════════════════

const ZAINA_ENABLED = process.env.ZAINA_ENABLED === "true";

// ═══════════════════════════════════════════════════════════════════
// RATE LIMITING
//
// The shared limits in limits.ts (Postgres, per visitor and site-wide) do
// the real work. This in-memory per-session limit stays as a second line in
// case the shared check can't run.
// ═══════════════════════════════════════════════════════════════════

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_MESSAGES = 20;

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(sessionId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(sessionId, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_MESSAGES) {
    return false;
  }

  entry.count += 1;
  return true;
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  rateLimitMap.forEach((entry, key) => {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(key);
    }
  });
}, 60 * 1000);

if (typeof (cleanupTimer as any).unref === "function") {
  (cleanupTimer as any).unref();
}

// ═══════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════

export function registerZainaRoutes(app: Express): void {
  // ─── Health check ─────────────────────────────────────────────
  // Registered BEFORE the gate so ops can always check status,
  // even when Zaina is disabled.
  app.get("/api/zaina/health", (_req: Request, res: Response) => {
       res.json({
      enabled: ZAINA_ENABLED,
      model: "gemini-3.5-flash-lite",
      timestamp: new Date().toISOString(),
    });
  });
  // ─── Feature flag gate ────────────────────────────────────────
  // Applies to every route below. When Zaina is off, the customer's
  // widget gets a clean 503 and can hide itself.
  app.use("/api/zaina", (_req: Request, res: Response, next) => {
    if (!ZAINA_ENABLED) {
      res.status(503).json({ error: "Zaina is not currently available." });
      return;
    }
    next();
  });

  // ─── Create session ───────────────────────────────────────────
  app.post("/api/zaina/session", async (req: Request, res: Response) => {
    try {
      // Opening chats is free for the visitor but not for us: a visitor can
      // open a limited number per hour (C6).
      const verdict = await consumeLimits([
        { key: `zaina:sessions:visitor:${visitorKey(req)}`, limit: ZAINA_LIMITS.sessionsPerVisitorPerHour, windowSeconds: 3600 },
      ]);
      if (!verdict.allowed) {
        res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
        res.status(429).json({ error: "Too many chats opened. Please try again later." });
        return;
      }

      const requested = req.body?.display_currency;
      const displayCurrency = requested === "KES" ? "KES" : "USD";
      const now = new Date().toISOString();

      const [row] = await db
        .insert(chatSessions)
        .values({
          displayCurrency,
          managedBy: "AI",
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      res.status(201).json({
        sessionId: row.id,
        display_currency: row.displayCurrency,
      });
    } catch (error) {
      console.error("[zaina] session creation failed:", error);
      res.status(500).json({ error: "Failed to create session." });
    }
  });

  // ─── Chat ─────────────────────────────────────────────────────
  app.post("/api/zaina/chat", async (req: Request, res: Response) => {
    const sessionId = req.header("x-zaina-session");
    const message = req.body?.message;
    const requestedCurrency = req.header("x-zaina-currency");

    if (!sessionId || typeof sessionId !== "string" || sessionId.length > 64) {
      res.status(400).json({ error: "Missing or invalid session header." });
      return;
    }
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required." });
      return;
    }
    if (message.length > 2000) {
      res.status(413).json({ error: "Message is too long." });
      return;
    }
    // Per chat, per visitor, and for the whole site (C6): no one can keep
    // sending messages to run up the model bill.
    const verdict = await consumeLimits([
      { key: `zaina:messages:session:${sessionId}`, limit: ZAINA_LIMITS.messagesPerSessionPerMinute, windowSeconds: 60 },
      { key: `zaina:messages:visitor:${visitorKey(req)}`, limit: ZAINA_LIMITS.messagesPerVisitorPer10Minutes, windowSeconds: 600 },
      { key: "zaina:messages:site", limit: ZAINA_LIMITS.messagesPerHour, windowSeconds: 3600 },
    ]);
    if (!verdict.allowed || !checkRateLimit(sessionId)) {
      if (!verdict.allowed) res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
      res.status(429).json({ error: "Too many messages. Please slow down." });
      return;
    }

    // Sync session currency if the customer changed it on the site since
    // the session was created. Best-effort — a failure here doesn't block
    // the chat.
    if (requestedCurrency === "USD" || requestedCurrency === "KES") {
      try {
        const [existing] = await db
          .select({ displayCurrency: chatSessions.displayCurrency })
          .from(chatSessions)
          .where(eq(chatSessions.id, sessionId))
          .limit(1);
        if (existing && existing.displayCurrency !== requestedCurrency) {
          await db
            .update(chatSessions)
            .set({ displayCurrency: requestedCurrency, updatedAt: new Date().toISOString() })
            .where(eq(chatSessions.id, sessionId));
        }
      } catch (err) {
        console.error("[zaina] failed to sync session currency:", err);
      }
    }

    try {
      const result = await handleZainaMessage(sessionId, message);

      if (result.status === "ok") {
        res.json({
          reply: result.reply,
          status: "ok",
          escalated: result.escalated === true,
        });
        return;
      }

      if (result.status === "ignored") {
        // Session is being handled by a human — tell the client cleanly
        // so the widget can stop showing AI replies.
        res.json({
          reply: null,
          status: "human_managed",
          reason: result.reason,
        });
        return;
      }

      // result.status === "error"
      res.status(500).json({
        error: result.error,
        message: result.message,
      });
    } catch (error) {
      console.error("[zaina] chat route failed:", error);
      res.status(500).json({
        error: "routing_failure",
        message: "Something went wrong. Please try again or reach us on WhatsApp.",
      });
    }
  });

  // ─── Session status ───────────────────────────────────────────
  // Used by the widget to verify the cached session ID is still alive
  // on the server (e.g. after a handoff deleted state, or after a very
  // long inactivity). Returns only non-sensitive fields: the handoff
  // reason is an internal note for the team (it can contain error text or
  // remarks about the customer) and is never sent to the browser.
  app.get("/api/zaina/session/:id", async (req: Request, res: Response) => {
    try {
      const [row] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, req.params.id))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Session not found." });
        return;
      }

      res.json({
        id: row.id,
        managedBy: row.managedBy,
        handoffTimestamp: row.handoffTimestamp,
        displayCurrency: row.displayCurrency,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    } catch (error) {
      console.error("[zaina] session status failed:", error);
      res.status(500).json({ error: "Failed to fetch session." });
    }
  });
    // ─── Session messages (customer-facing) ───────────────────────
  // Used by the widget to poll for agent replies after handoff.
  // Only returns messages from AGENT actors so the customer's own
  // message log stays clean.
  app.get("/api/zaina/session/:id/messages", async (req: Request, res: Response) => {
    try {
      const [session] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, req.params.id))
        .limit(1);

      if (!session) {
        res.status(404).json({ error: "Session not found." });
        return;
      }

      const rows = await db
        .select({
          actor: zainaAuditLogs.actor,
          messageContent: zainaAuditLogs.messageContent,
          timestamp: zainaAuditLogs.timestamp,
        })
        .from(zainaAuditLogs)
        .where(
          and(
            eq(zainaAuditLogs.sessionId, req.params.id),
            eq(zainaAuditLogs.actor, "AGENT"),
          ),
        )
        .orderBy(asc(zainaAuditLogs.timestamp));

      res.json({ messages: rows });
    } catch (error) {
      console.error("[zaina] session messages failed:", error);
      res.status(500).json({ error: "Failed to load messages." });
    }
  });
}
