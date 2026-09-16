// server/zaina/routes.ts
//
// Zaina's HTTP surface.
//
// FEATURE FLAG:
//   ZAINA_ENABLED env var controls whether Zaina is live.
//   Default: false. Set to "true" to enable.
//   When disabled, every Zaina route (except /health) returns 503.

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { chatSessions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { handleZainaMessage } from "./router";

const ZAINA_ENABLED = process.env.ZAINA_ENABLED === "true";

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

export function registerZainaRoutes(app: Express): void {
  // Health check — always available
  app.get("/api/zaina/health", (_req: Request, res: Response) => {
    res.json({
      enabled: ZAINA_ENABLED,
      model: "gemini-2.5-flash",
      timestamp: new Date().toISOString(),
    });
  });

  // Feature flag gate for all other routes
  app.use("/api/zaina", (_req: Request, res: Response, next) => {
    if (!ZAINA_ENABLED) {
      res.status(503).json({ error: "Zaina is not currently available." });
      return;
    }
    next();
  });

  // Create session
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

  // Chat
  app.post("/api/zaina/chat", async (req: Request, res: Response) => {
    const sessionId = req.header("x-zaina-session");
    const message = req.body?.message;

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

    try {
      const result = await handleZainaMessage(sessionId, message);

      if (result.status === "ok") {
        res.json({ reply: result.reply, status: "ok" });
        return;
      }

      if (result.status === "ignored") {
        res.json({
          reply: null,
          status: "human_managed",
          reason: result.reason,
        });
        return;
      }

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

  // Session status
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
