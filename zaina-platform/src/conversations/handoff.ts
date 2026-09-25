// zaina-platform/src/conversations/handoff.ts
//
// Handing a conversation to a person, and back (C4c).
//
//   AI ──escalate, staff on──▶ HUMAN, waiting ──claimed──▶ HUMAN, with an agent
//    ▲                              │                            │
//    │   nobody claims it in time ──┘   staff hand it back ──────┤
//    └──────────────────────────────────────────────────────────┘
//                                                   staff close it ──▶ CLOSED
//
// Outside staffed hours nobody would answer, so the customer isn't left
// waiting: Zaina says when the team is back, asks the team for a callback and
// keeps helping. A waiting handoff nobody claims within the business's
// timeout goes the same way.

import { and, eq, inArray, sql } from "drizzle-orm";
import { connectorFor } from "../connectors/registry.ts";
import { platformDb } from "../db/platform-db.ts";
import { businesses, chatSessions, type Business, type ChatSession } from "../db/schema.ts";
import { phoneNumbersWritten } from "../engine/tool-args.ts";
import { describeOpening, isStaffedAt, nextStaffedAt, timeZoneLabel } from "./staffed-hours.ts";
import { appendEvent, customerMessages } from "./store.ts";

export type HandoffResult =
  | { status: "escalated" }
  | { status: "already_escalated" }
  | { status: "callback"; tellCustomer: string };

/** Whether the customer has typed an email or phone number the team can use. */
export function customerGaveContact(messages: string[]): boolean {
  const written = messages.join("\n");
  return /[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(written) || phoneNumbersWritten(written).length > 0;
}

const ASK_FOR_CONTACT = " What's the best phone number or email for them to reach you on?";

function queue(label: string, task: Promise<unknown>) {
  task.catch((error) => console.error(`[handoff] ${label} failed:`, error));
}

export async function requestHandoff(
  business: Business,
  sessionId: string,
  reason: string,
  now: Date = new Date(),
): Promise<HandoffResult> {
  const connector = await connectorFor(business.id);

  if (!isStaffedAt(business.staffedHours ?? null, business.timeZone, now)) {
    await platformDb()
      .update(chatSessions)
      .set({ callbackRequestedAt: now, handoffReason: reason, updatedAt: now })
      .where(eq(chatSessions.id, sessionId));
    const opensAt = nextStaffedAt(business.staffedHours ?? null, business.timeZone, now);
    await appendEvent({
      businessId: business.id,
      sessionId,
      actor: "SYSTEM",
      content: `Team offline: callback requested (${reason}).`,
    });
    queue("callback alert", connector.notifyTeam(business, {
      kind: "callback", sessionId, reason, why: "offline", staffBackAt: opensAt,
    }));
    const back = opensAt
      ? `they're back ${describeOpening(opensAt, business.timeZone, now)} (${timeZoneLabel(business.timeZone)})`
      : "they'll be back soon";
    const contact = customerGaveContact(await customerMessages(sessionId)) ? "" : ASK_FOR_CONTACT;
    return {
      status: "callback",
      tellCustomer: `Our team is offline right now — ${back}. I've asked them to get back to you then.${contact} Meanwhile, I'm happy to keep helping here.`,
    };
  }

  const claimed = await platformDb()
    .update(chatSessions)
    .set({
      managedBy: "HUMAN",
      handoffReason: reason,
      handoffAt: now,
      assignedAgentId: null,
      claimedAt: null,
      updatedAt: now,
    })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.managedBy, "AI")))
    .returning({ id: chatSessions.id });
  if (claimed.length === 0) return { status: "already_escalated" };

  queue("handoff alert", connector.notifyTeam(business, { kind: "handoff", sessionId, reason }));
  return { status: "escalated" };
}

export async function claimSession(sessionId: string, agentId: string): Promise<ChatSession | undefined> {
  const [row] = await platformDb()
    .update(chatSessions)
    .set({ managedBy: "HUMAN", assignedAgentId: agentId, claimedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(chatSessions.id, sessionId), inArray(chatSessions.managedBy, ["AI", "HUMAN"])))
    .returning();
  return row;
}

/** Staff hand the conversation back to Zaina. */
export async function releaseSession(sessionId: string, agentId: string): Promise<ChatSession | undefined> {
  const [row] = await platformDb()
    .update(chatSessions)
    .set({ managedBy: "AI", assignedAgentId: null, consecutiveFailures: 0, updatedAt: new Date() })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.managedBy, "HUMAN")))
    .returning();
  if (row) {
    await appendEvent({ businessId: row.businessId, sessionId, actor: "SYSTEM", content: `Handed back to Zaina by ${agentId}.` });
  }
  return row;
}

export async function closeSession(sessionId: string): Promise<ChatSession | undefined> {
  const [row] = await platformDb()
    .update(chatSessions)
    .set({ managedBy: "CLOSED", updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId))
    .returning();
  return row;
}

/**
 * Hands back to Zaina every waiting handoff nobody claimed in time, tells the
 * customer the team will call them back, and alerts the team. Returns the
 * sessions handed back.
 */
export async function sweepUnclaimedHandoffs(now: Date = new Date()): Promise<string[]> {
  const result = await platformDb().execute(sql`
    update chat_sessions as s
    set managed_by = 'AI', callback_requested_at = ${now}, consecutive_failures = 0, updated_at = ${now}
    from businesses as b
    where s.business_id = b.id
      and s.managed_by = 'HUMAN'
      and s.assigned_agent_id is null
      and s.handoff_at < ${now}::timestamptz - make_interval(mins => b.unclaimed_timeout_minutes)
    returning s.id, s.business_id, s.handoff_reason
  `);
  const rows = result.rows as Array<{ id: string; business_id: string; handoff_reason: string | null }>;
  const handedBack: string[] = [];
  for (const row of rows) {
    try {
      const contact = customerGaveContact(await customerMessages(row.id)) ? "" : ASK_FOR_CONTACT;
      await appendEvent({
        businessId: row.business_id,
        sessionId: row.id,
        actor: "ZAINA_REASONING",
        content: `Sorry for the wait — the team is busy right now, so I've asked them to get back to you as soon as they can.${contact} I'm here to help in the meantime.`,
      });
      await appendEvent({
        businessId: row.business_id,
        sessionId: row.id,
        actor: "SYSTEM",
        content: "Nobody claimed the handoff in time: handed back to Zaina, callback requested.",
      });
      const [business] = await platformDb().select().from(businesses).where(eq(businesses.id, row.business_id)).limit(1);
      if (business) {
        const connector = await connectorFor(business.id);
        queue("unclaimed callback alert", connector.notifyTeam(business, {
          kind: "callback",
          sessionId: row.id,
          reason: row.handoff_reason ?? "Handoff",
          why: "unclaimed",
          staffBackAt: null,
        }));
      }
      handedBack.push(row.id);
    } catch (error) {
      console.error(`[handoff] handing ${row.id} back failed:`, error);
    }
  }
  return handedBack;
}
