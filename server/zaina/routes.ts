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
import { chatSessions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { handleZainaMessage } from "./router";

// ═══════════════════════════════════════════════════════════════════
// FEATURE FLAG
// ═══════════════════════════════════════════════════════════════════

const ZAINA_ENABLED = process.env.ZAINA_ENABLED === "true";

// ═══════════════════════════════════════════════════════════════════
// RATE LIMITING (in-memory, per-instance)
//
// Guards against a single session hammering the endpoint.
// If you later run multiple server instances behind a load balancer,
// switch to Redis-backed rate limiting — this in-memory version is
// per-process only.
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
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(key);
    }
  }
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
      model: "gemini-2.5-flash",
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
    if (!checkRateLimit(sessionId)) {
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
        res.json({ reply: result.reply, status: "ok" });
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
  // long inactivity). Returns only non-sensitive fields.
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
        handoffReason: row.handoffReason,
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
}
