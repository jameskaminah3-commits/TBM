// zaina-platform/src/conversations/staff-routes.ts
//
// The team's inbox: waiting chats and callbacks, the transcript, and claiming,
// answering, handing back or closing a chat (C4c). Ported from the TBM app's
// agent-routes.ts, with Phase 3's channels (a team reply to a WhatsApp chat
// is delivered on WhatsApp) and routing (who a waiting chat was offered to,
// who is available). Every route names its business, needs a staff sign-in
// with a role there, and runs inside that business's scope, so a chat id
// from another business simply isn't found.
//
//   GET  /v1/staff/businesses/:businessId/sessions?filter=waiting|mine|active|callbacks|all|everything   viewer
//   GET  /v1/staff/businesses/:businessId/pending-count                                                   viewer
//   GET  /v1/staff/businesses/:businessId/sessions/:id                                                    viewer
//   POST /v1/staff/businesses/:businessId/sessions/:id/claim | messages | release | close | callback-done   agent
//   GET  /v1/staff/businesses/:businessId/presence       viewer   who is taking chats
//   POST /v1/staff/businesses/:businessId/presence       viewer   { available? }: I'm here (and taking chats, or not)

import type { Express, NextFunction, Request, Response } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import type { PlatformConfig } from "../config.ts";
import { chatEvents, chatSessions } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { requestDelivery } from "../channels/whatsapp/runtime.ts";
import { windowClosesAt, windowOpen } from "../channels/whatsapp/delivery.ts";
import { requireBusinessRole, requireStaff, ROLE_RANK, staffOf } from "../staff/auth.ts";
import { claimSession, closeSession, releaseSession } from "./handoff.ts";
import { availablePeople, setPresence } from "./routing.ts";
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

const FILTERS: Record<string, string> = {
  waiting: "s.managed_by = 'HUMAN' and s.assigned_agent_id is null",
  mine: "s.managed_by = 'HUMAN' and (s.claimed_by = $2 or (s.routed_to = $2 and s.assigned_agent_id is null))",
  active: "s.managed_by = 'HUMAN' and s.assigned_agent_id is not null",
  callbacks: "s.callback_requested_at is not null and s.managed_by <> 'CLOSED'",
  all: "s.managed_by <> 'AI'",
  everything: "s.last_activity_at > now() - interval '30 days' and exists (select 1 from chat_events as u where u.business_id = s.business_id and u.session_id = s.id and u.actor = 'USER')",
};

/** What the console shows about a chat's channel: who the customer is, and whether WhatsApp lets the team write freely. */
function channelInfo(row: { channel: string; customerAddress: string | null; customerName: string | null; customerLastMessageAt: Date | null }) {
  if (row.channel !== "whatsapp") return { channel: "web", customer: { label: "Website visitor", phone: null }, window: null };
  return {
    channel: "whatsapp",
    customer: { label: row.customerName ?? (row.customerAddress ? `+${row.customerAddress}` : "WhatsApp customer"), phone: row.customerAddress ? `+${row.customerAddress}` : null },
    window: { open: windowOpen(row.customerLastMessageAt), closesAt: windowClosesAt(row.customerLastMessageAt) },
  };
}

export function registerStaffConversationRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId";
  app.use(`${base}/sessions/:id`, validSessionId);

  app.get(`${base}/sessions`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = FILTERS[String(req.query.filter ?? "waiting")] ?? FILTERS.waiting;
      const { business, user } = staffOf(req);
      // Only "mine" names the person ($2); Postgres refuses a parameter a query doesn't use.
      const params: unknown[] = filter.includes("$2") ? [business!.id, user.id] : [business!.id];
      const rows = await inBusiness(async (db, client) => {
        const { rows: found } = await client.query<{ id: string; last_message: string | null; last_actor: string | null; last_message_at: Date | null; claimed_name: string | null; routed_name: string | null }>(
          `select s.id, last.content as last_message, last.actor as last_actor, last.created_at as last_message_at,
                  claimer.name as claimed_name, routed.name as routed_name
           from chat_sessions as s
           left join lateral (
             select e.content, e.actor, e.created_at from chat_events as e
             where e.business_id = s.business_id and e.session_id = s.id and e.content is not null
               and e.actor in ('USER', 'ZAINA_REASONING', 'AGENT')
             order by e.id desc limit 1
           ) as last on true
           left join staff_users as claimer on claimer.id = s.claimed_by
           left join staff_users as routed on routed.id = s.routed_to
           where s.business_id = $1 and ${filter}
           order by s.updated_at desc limit 100`,
          params,
        );
        if (found.length === 0) return [];
        const sessions = await db.select().from(chatSessions).where(inArray(chatSessions.id, found.map((row) => row.id)));
        const byId = new Map(sessions.map((session) => [session.id, session]));
        return found.map((row) => {
          const session = byId.get(row.id)!;
          return {
            ...session,
            ...channelInfo(session),
            lastMessage: row.last_message,
            lastActor: row.last_actor,
            lastMessageAt: row.last_message_at,
            claimedByName: row.claimed_name,
            routedToName: row.routed_name,
          };
        });
      });
      res.json({ sessions: rows });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/pending-count`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      const { rows: [row] } = await inBusiness((_db, client) => client.query<{ waiting: number; mine: number; callbacks: number }>(
        `select count(*) filter (where managed_by = 'HUMAN' and assigned_agent_id is null)::int as waiting,
                count(*) filter (where managed_by = 'HUMAN' and (claimed_by = $2 or (routed_to = $2 and assigned_agent_id is null)))::int as mine,
                count(*) filter (where callback_requested_at is not null and managed_by <> 'CLOSED')::int as callbacks
         from chat_sessions where business_id = $1`,
        [business!.id, user.id],
      ));
      res.json({ pending: row?.waiting ?? 0, mine: row?.mine ?? 0, callbacks: row?.callbacks ?? 0 });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/sessions/:id`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await getSession(req.params.id);
      if (!session) return res.status(404).json({ error: "session_not_found" });
      const detail = await inBusiness(async (db, client) => {
        const transcript = await db.select().from(chatEvents).where(eq(chatEvents.sessionId, session.id)).orderBy(asc(chatEvents.id));
        const { rows: names } = await client.query<{ id: string; name: string }>(
          `select u.id, u.name from staff_users as u
           where u.id in (select author from chat_events where business_id = $1 and session_id = $2 and author is not null)
              or u.id = any($3::uuid[])`,
          [session.businessId, session.id, [session.claimedBy, session.routedTo].filter(Boolean)],
        );
        const { rows: deliveries } = session.channel === "whatsapp"
          ? await client.query<{ event_id: string | null; kind: string; status: string; error_title: string | null; created_at: Date }>(
            "select event_id, kind, status, error_title, created_at from whatsapp_outbound where business_id = $1 and session_id = $2 order by id",
            [session.businessId, session.id],
          )
          : { rows: [] };
        return { transcript, names: new Map(names.map((row) => [row.id, row.name])), deliveries };
      });
      const deliveryOf = new Map<number, { status: string; error: string | null }>();
      for (const delivery of detail.deliveries) {
        if (delivery.event_id) deliveryOf.set(Number(delivery.event_id), { status: delivery.status, error: delivery.error_title });
      }
      const pendingFrom = session.channel === "whatsapp" ? session.deliveredEventId : null;
      res.json({
        session: {
          ...session,
          ...channelInfo(session),
          claimedByName: session.claimedBy ? detail.names.get(session.claimedBy) ?? null : null,
          routedToName: session.routedTo ? detail.names.get(session.routedTo) ?? null : null,
        },
        transcript: detail.transcript.map((event) => ({
          ...event,
          authorName: event.author ? detail.names.get(event.author) ?? null : null,
          delivery: session.channel !== "whatsapp" || (event.actor !== "AGENT" && event.actor !== "ZAINA_REASONING")
            ? null
            : deliveryOf.get(event.id) ?? (pendingFrom !== null && event.id > pendingFrom ? { status: "waiting", error: null } : null),
        })),
        followups: detail.deliveries.filter((delivery) => delivery.kind === "template").map((delivery) => ({ status: delivery.status, error: delivery.error_title, at: delivery.created_at })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/sessions/:id/claim`, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await claimSession(req.params.id, agentId(req), staffOf(req).user.id);
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
      const { user } = staffOf(req);
      // Replying takes the chat, as it did in the TBM app.
      if (!session.assignedAgentId) await claimSession(session.id, agentId(req), user.id);
      const eventId = await appendEvent({ businessId: session.businessId, sessionId: session.id, actor: "AGENT", content: message.trim(), author: user.id });
      // On WhatsApp the reply is sent now (or waits for the customer, after 24 hours).
      const delivery = session.channel === "whatsapp" ? await requestDelivery(session.businessId, session.id) : null;
      res.status(201).json({ ok: true, event_id: eventId, delivery: delivery?.status ?? null });
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

  app.get(`${base}/presence`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ people: await availablePeople(staffOf(req).business!.id, config.availabilityHours) });
    } catch (error) {
      next(error);
    }
  });

  // The console calls this every minute while open; only people who answer chats can be routed to.
  app.post(`${base}/presence`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user, role } = staffOf(req);
      const wanted = typeof req.body?.available === "boolean" ? req.body.available : null;
      if (wanted === true && ROLE_RANK[role!] < ROLE_RANK.agent) {
        return res.status(403).json({ error: "forbidden", message: "Only people who answer chats can take them." });
      }
      res.json(await setPresence(business!.id, user.id, wanted));
    } catch (error) {
      next(error);
    }
  });
}
