// zaina-platform/src/conversations/staff-routes.ts
//
// The team's inbox: waiting chats and callbacks, the transcript, and claiming,
// answering, handing back or closing a chat (C4c). Ported from the TBM app's
// agent-routes.ts. Every route names its business, needs a staff sign-in
// with a role there, and runs inside that business's scope, so a chat id
// from another business simply isn't found.
//
//   GET  /v1/staff/businesses/:businessId/sessions?filter=waiting|active|callbacks|all   viewer
//   GET  /v1/staff/businesses/:businessId/pending-count                                   viewer
//   GET  /v1/staff/businesses/:businessId/sessions/:id                                    viewer
//   POST /v1/staff/businesses/:businessId/sessions/:id/claim | messages | release | close | callback-done   agent

import type { Express, NextFunction, Request, Response } from "express";
import { and, asc, desc, eq, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import { chatEvents, chatSessions } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { claimSession, closeSession, releaseSession } from "./handoff.ts";
import { appendEvent, getSession } from "./store.ts";

/** The acting person, as recorded on the chat. */
function agentId(req: Request): string {
  const { user } = staffOf(req);
  return `${user.name} <${user.email}>`;
}

/** A chat id that isn't a UUID can't exist: answer "not found" rather than failing. */
function validSessionId(req: Request, res: Response, next: NextFunction) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id ?? "")) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }
  next();
}

export function registerStaffConversationRoutes(app: Express, secret: string): void {
  const staff = requireStaff(secret);
  const base = "/v1/staff/businesses/:businessId";
  app.use(`${base}/sessions/:id`, validSessionId);

  app.get(`${base}/sessions`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = String(req.query.filter ?? "waiting");
      const conditions: SQL[] = [eq(chatSessions.businessId, staffOf(req).business!.id)];
      if (filter === "waiting") conditions.push(eq(chatSessions.managedBy, "HUMAN"), isNull(chatSessions.assignedAgentId));
      else if (filter === "active") conditions.push(eq(chatSessions.managedBy, "HUMAN"), isNotNull(chatSessions.assignedAgentId));
      else if (filter === "callbacks") conditions.push(isNotNull(chatSessions.callbackRequestedAt), ne(chatSessions.managedBy, "CLOSED"));
      else conditions.push(ne(chatSessions.managedBy, "AI"));

      const sessions = await inBusiness(async (db) => {
        const rows = await db.select().from(chatSessions).where(and(...conditions)).orderBy(desc(chatSessions.updatedAt)).limit(100);
        return Promise.all(rows.map(async (row) => {
          const [last] = await db
            .select({ actor: chatEvents.actor, content: chatEvents.content, createdAt: chatEvents.createdAt })
            .from(chatEvents)
            .where(and(eq(chatEvents.sessionId, row.id), isNotNull(chatEvents.content)))
            .orderBy(desc(chatEvents.id))
            .limit(1);
          return { ...row, lastMessage: last?.content ?? null, lastActor: last?.actor ?? null, lastMessageAt: last?.createdAt ?? null };
        }));
      });
      res.json({ sessions });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/pending-count`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [row] = await inBusiness((db) => db
        .select({ waiting: sql<number>`count(*)::int` })
        .from(chatSessions)
        .where(and(
          eq(chatSessions.businessId, staffOf(req).business!.id),
          eq(chatSessions.managedBy, "HUMAN"),
          isNull(chatSessions.assignedAgentId),
        )));
      res.json({ pending: row?.waiting ?? 0 });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/sessions/:id`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await getSession(req.params.id);
      if (!session) return res.status(404).json({ error: "session_not_found" });
      const transcript = await inBusiness((db) => db.select().from(chatEvents).where(eq(chatEvents.sessionId, session.id)).orderBy(asc(chatEvents.id)));
      res.json({ session, transcript });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/sessions/:id/claim`, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await claimSession(req.params.id, agentId(req));
      if (!session) return res.status(404).json({ error: "session_not_found" });
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/sessions/:id/messages`, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const message = req.body?.message;
      if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "message_required" });
      if (message.length > 2000) return res.status(413).json({ error: "message_too_long" });
      const session = await getSession(req.params.id);
      if (!session || session.managedBy === "CLOSED") return res.status(404).json({ error: "session_not_found" });
      // Replying takes the chat, as it did in the TBM app.
      if (!session.assignedAgentId) await claimSession(session.id, agentId(req));
      await appendEvent({ businessId: session.businessId, sessionId: session.id, actor: "AGENT", content: message.trim() });
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/sessions/:id/release`, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await releaseSession(req.params.id, agentId(req));
      if (!session) return res.status(409).json({ error: "not_with_staff", message: "This chat isn't with the team." });
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/sessions/:id/close`, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await closeSession(req.params.id);
      if (!session) return res.status(404).json({ error: "session_not_found" });
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  // A callback the team has made: clears it from the callbacks list.
  app.post(`${base}/sessions/:id/callback-done`, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [session] = await inBusiness((db) => db
        .update(chatSessions)
        .set({ callbackRequestedAt: null, updatedAt: new Date() })
        .where(eq(chatSessions.id, req.params.id))
        .returning());
      if (!session) return res.status(404).json({ error: "session_not_found" });
      await appendEvent({ businessId: session.businessId, sessionId: session.id, actor: "SYSTEM", content: `Callback done by ${agentId(req)}.` });
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });
}
