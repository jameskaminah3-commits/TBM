// zaina-platform/src/conversations/staff-routes.ts
//
// The team's side of a conversation: see waiting chats and callbacks, claim a
// chat, reply, hand it back to Zaina, or close it (C4c). Ported from the TBM
// app's agent-routes.ts.
//
// Until staff accounts arrive in Phase 1, these routes take the platform
// admin token and an x-agent-id header naming the person acting.

import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { platformDb } from "../db/platform-db.ts";
import { chatEvents, chatSessions } from "../db/schema.ts";
import { claimSession, closeSession, releaseSession } from "./handoff.ts";
import { appendEvent, getSession } from "./store.ts";

/** Constant-time check of the admin token. */
export function requireAdminToken(adminToken: string) {
  const expected = createHash("sha256").update(adminToken).digest();
  return (req: Request, res: Response, next: NextFunction) => {
    const given = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "")?.[1] ?? "";
    const matches = timingSafeEqual(createHash("sha256").update(given).digest(), expected);
    if (!given || !matches) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

function agentOf(req: Request): string | null {
  const agent = req.header("x-agent-id")?.trim();
  return agent && agent.length <= 120 ? agent : null;
}

export function registerStaffRoutes(app: Express, adminToken: string): void {
  const staffOnly = requireAdminToken(adminToken);

  // ?filter=waiting (default) | active | callbacks | all
  app.get("/v1/staff/businesses/:businessId/sessions", staffOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = String(req.query.filter ?? "waiting");
      const conditions = [eq(chatSessions.businessId, req.params.businessId)];
      if (filter === "waiting") conditions.push(eq(chatSessions.managedBy, "HUMAN"), isNull(chatSessions.assignedAgentId));
      else if (filter === "active") conditions.push(eq(chatSessions.managedBy, "HUMAN"), isNotNull(chatSessions.assignedAgentId));
      else if (filter === "callbacks") conditions.push(isNotNull(chatSessions.callbackRequestedAt), ne(chatSessions.managedBy, "CLOSED"));
      else conditions.push(ne(chatSessions.managedBy, "AI"));

      const rows = await platformDb()
        .select()
        .from(chatSessions)
        .where(and(...conditions))
        .orderBy(desc(chatSessions.updatedAt))
        .limit(100);
      const sessions = await Promise.all(rows.map(async (row) => {
        const [last] = await platformDb()
          .select({ actor: chatEvents.actor, content: chatEvents.content, createdAt: chatEvents.createdAt })
          .from(chatEvents)
          .where(and(eq(chatEvents.sessionId, row.id), isNotNull(chatEvents.content)))
          .orderBy(desc(chatEvents.id))
          .limit(1);
        return { ...row, lastMessage: last?.content ?? null, lastActor: last?.actor ?? null, lastMessageAt: last?.createdAt ?? null };
      }));
      res.json({ sessions });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/staff/businesses/:businessId/pending-count", staffOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [row] = await platformDb()
        .select({ waiting: sql<number>`count(*)::int` })
        .from(chatSessions)
        .where(and(
          eq(chatSessions.businessId, req.params.businessId),
          eq(chatSessions.managedBy, "HUMAN"),
          isNull(chatSessions.assignedAgentId),
        ));
      res.json({ pending: row?.waiting ?? 0 });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/staff/sessions/:id", staffOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await getSession(req.params.id);
      if (!session) return res.status(404).json({ error: "session_not_found" });
      const transcript = await platformDb()
        .select()
        .from(chatEvents)
        .where(eq(chatEvents.sessionId, session.id))
        .orderBy(asc(chatEvents.id));
      res.json({ session, transcript });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/staff/sessions/:id/claim", staffOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = agentOf(req);
      if (!agent) return res.status(400).json({ error: "agent_required", message: "Send x-agent-id." });
      const session = await claimSession(req.params.id, agent);
      if (!session) return res.status(404).json({ error: "session_not_found" });
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/staff/sessions/:id/messages", staffOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = agentOf(req);
      if (!agent) return res.status(400).json({ error: "agent_required", message: "Send x-agent-id." });
      const message = req.body?.message;
      if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "message_required" });
      if (message.length > 2000) return res.status(413).json({ error: "message_too_long" });
      const session = await getSession(req.params.id);
      if (!session || session.managedBy === "CLOSED") return res.status(404).json({ error: "session_not_found" });
      // Replying takes the chat, as it did in the TBM app.
      if (!session.assignedAgentId) await claimSession(session.id, agent);
      await appendEvent({ businessId: session.businessId, sessionId: session.id, actor: "AGENT", content: message.trim() });
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/staff/sessions/:id/release", staffOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = agentOf(req);
      if (!agent) return res.status(400).json({ error: "agent_required", message: "Send x-agent-id." });
      const session = await releaseSession(req.params.id, agent);
      if (!session) return res.status(409).json({ error: "not_with_staff", message: "This chat isn't with the team." });
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/staff/sessions/:id/close", staffOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await closeSession(req.params.id);
      if (!session) return res.status(404).json({ error: "session_not_found" });
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  // A callback the team has made: clears it from the callbacks list.
  app.post("/v1/staff/sessions/:id/callback-done", staffOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = agentOf(req);
      if (!agent) return res.status(400).json({ error: "agent_required", message: "Send x-agent-id." });
      const [session] = await platformDb()
        .update(chatSessions)
        .set({ callbackRequestedAt: null, updatedAt: new Date() })
        .where(eq(chatSessions.id, req.params.id))
        .returning();
      if (!session) return res.status(404).json({ error: "session_not_found" });
      await appendEvent({ businessId: session.businessId, sessionId: session.id, actor: "SYSTEM", content: `Callback done by ${agent}.` });
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });
}
