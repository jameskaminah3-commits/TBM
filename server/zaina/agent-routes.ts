// server/zaina/agent-routes.ts
//
// Admin and agent endpoints for human takeover of Zaina sessions.
//
// Mounted behind requireAdmin. The agent dashboard polls these endpoints
// to see live handoffs, claim a session, reply, and close it.

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { chatSessions, zainaAuditLogs } from "@shared/schema";
import { and, asc, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";

// ═══════════════════════════════════════════════════════════════════
// REGISTER
// ═══════════════════════════════════════════════════════════════════

export function registerZainaAgentRoutes(app: Express): void {
  // ─── List sessions ──────────────────────────────────────────────
  // Query: ?filter=waiting | active | all  (default: waiting)
  //
  //   waiting → managed_by != 'AI' AND assigned_agent_id IS NULL
  //   active  → managed_by != 'AI' AND assigned_agent_id IS NOT NULL
  //   all     → any non-AI session
  app.get(
    "/api/admin/zaina/sessions",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const filter = String(req.query.filter ?? "waiting");

        // Base: session has been pulled out of AI mode.
        const conditions = [ne(chatSessions.managedBy, "AI")];

        // SQL gotcha: `column = NULL` is never true — must use IS NULL / IS NOT NULL.
        if (filter === "waiting") {
          conditions.push(isNull(chatSessions.assignedAgentId));
        } else if (filter === "active") {
          conditions.push(isNotNull(chatSessions.assignedAgentId));
        }
        // 'all' → no extra filter

        const rows = await db
          .select()
          .from(chatSessions)
          .where(and(...conditions))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(100);

        // Last message preview for each session
        const withPreviews = await Promise.all(
          rows.map(async (row) => {
            const [last] = await db
              .select({
                actor: zainaAuditLogs.actor,
                messageContent: zainaAuditLogs.messageContent,
                timestamp: zainaAuditLogs.timestamp,
              })
              .from(zainaAuditLogs)
              .where(eq(zainaAuditLogs.sessionId, row.id))
              .orderBy(desc(zainaAuditLogs.timestamp))
              .limit(1);
            return {
              ...row,
              lastMessage: last?.messageContent ?? null,
              lastActor: last?.actor ?? null,
              lastMessageAt: last?.timestamp ?? null,
            };
          }),
        );

        res.json({ sessions: withPreviews });
      } catch (error) {
        console.error("[zaina-agent] list failed:", error);
        res.status(500).json({ error: "Failed to list sessions." });
      }
    },
  );

  // ─── Session detail with full transcript ────────────────────────
  app.get(
    "/api/admin/zaina/sessions/:id",
    requireAdmin,
    async (req: Request, res: Response) => {
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

        const transcript = await db
          .select()
          .from(zainaAuditLogs)
          .where(eq(zainaAuditLogs.sessionId, req.params.id))
          .orderBy(asc(zainaAuditLogs.timestamp));

        res.json({ session, transcript });
      } catch (error) {
        console.error("[zaina-agent] detail failed:", error);
        res.status(500).json({ error: "Failed to load session." });
      }
    },
  );

  // ─── Claim a session ────────────────────────────────────────────
  app.post(
    "/api/admin/zaina/sessions/:id/claim",
    requireAdmin,
    async (req: any, res: Response) => {
      try {
        const agentId = req.user?.claims?.sub;
        if (!agentId) {
          res.status(401).json({ error: "Missing agent identity." });
          return;
        }

        const [updated] = await db
          .update(chatSessions)
          .set({
            assignedAgentId: agentId,
            managedBy: "HUMAN",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(chatSessions.id, req.params.id))
          .returning();

        if (!updated) {
          res.status(404).json({ error: "Session not found." });
          return;
        }

        res.json({ session: updated });
      } catch (error) {
        console.error("[zaina-agent] claim failed:", error);
        res.status(500).json({ error: "Failed to claim session." });
      }
    },
  );

  // ─── Send a message from the agent ──────────────────────────────
  app.post(
    "/api/admin/zaina/sessions/:id/messages",
    requireAdmin,
    async (req: any, res: Response) => {
      try {
        const agentId = req.user?.claims?.sub;
        const message = req.body?.message;

        if (typeof message !== "string" || message.trim().length === 0) {
          res.status(400).json({ error: "message is required." });
          return;
        }
        if (message.length > 2000) {
          res.status(413).json({ error: "Message is too long." });
          return;
        }

        const [session] = await db
          .select()
          .from(chatSessions)
          .where(eq(chatSessions.id, req.params.id))
          .limit(1);

        if (!session) {
          res.status(404).json({ error: "Session not found." });
          return;
        }

        // Auto-claim if not already claimed
        if (!session.assignedAgentId) {
          await db
            .update(chatSessions)
            .set({
              assignedAgentId: agentId,
              managedBy: "HUMAN",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(chatSessions.id, req.params.id));
        }

        await db.insert(zainaAuditLogs).values({
          sessionId: req.params.id,
          actor: "AGENT",
          messageContent: message.trim(),
        });

        res.status(201).json({ ok: true });
      } catch (error) {
        console.error("[zaina-agent] reply failed:", error);
        res.status(500).json({ error: "Failed to send message." });
      }
    },
  );

  // ─── Close a session ────────────────────────────────────────────
  app.post(
    "/api/admin/zaina/sessions/:id/close",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const [updated] = await db
          .update(chatSessions)
          .set({
            managedBy: "CLOSED",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(chatSessions.id, req.params.id))
          .returning();

        if (!updated) {
          res.status(404).json({ error: "Session not found." });
          return;
        }

        res.json({ session: updated });
      } catch (error) {
        console.error("[zaina-agent] close failed:", error);
        res.status(500).json({ error: "Failed to close session." });
      }
    },
  );
    // ─── Pending count (for the admin bubble badge) ─────────────────
  app.get(
    "/api/admin/zaina/pending-count",
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const rows = await db
          .select({ id: chatSessions.id, updatedAt: chatSessions.updatedAt })
          .from(chatSessions)
          .where(
            and(
              ne(chatSessions.managedBy, "AI"),
              ne(chatSessions.managedBy, "CLOSED"),
              isNull(chatSessions.assignedAgentId),
            ),
          );

        res.json({ pending: rows.length });
      } catch (error) {
        console.error("[zaina-agent] pending count failed:", error);
        res.status(500).json({ error: "Failed to count pending sessions." });
      }
    },
  );
}
