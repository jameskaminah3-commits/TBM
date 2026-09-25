// zaina-platform/src/conversations/handoff.ts
//
// Handing a conversation to a person, and back (C4c, routing in Phase 3).
//
//   AI ──escalate, staff on──▶ HUMAN, waiting ──claimed──▶ HUMAN, with a person
//    ▲                              │                            │
//    │   nobody claims it in time ──┘   staff hand it back ──────┤
//    └──────────────────────────────────────────────────────────┘
//                                                   staff close it ──▶ CLOSED
//
// A waiting chat is offered first to one available person (routing.ts); if
// they don't claim it within a few minutes, everyone is alerted.
//
// Outside staffed hours nobody would answer, so the customer isn't left
// waiting: Zaina says when the team is back, asks the team for a callback and
// keeps helping. A waiting handoff nobody claims within the business's
// timeout goes the same way.

import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { allBusinesses } from "../businesses/registry.ts";
import { chatSessions, type Business, type ChatLanguage, type ChatSession } from "../db/schema.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { describeOpeningSwahili, swahiliTimeZoneLabel, texts } from "../engine/messages.ts";
import { phoneNumbersWritten } from "../engine/tool-args.ts";
import { chatsToEscalate, routeHandoff } from "./routing.ts";
import { describeOpening, isStaffedAt, nextStaffedAt, timeZoneLabel } from "./staffed-hours.ts";
import { appendEvent, customerMessages } from "./store.ts";
import { alertTeam, type AlertEvent } from "./team-alerts.ts";

export type HandoffResult =
  | { status: "escalated" }
  | { status: "already_escalated" }
  | { status: "callback"; tellCustomer: string };

const policy = { availabilityHours: 2, routeEscalateMinutes: 3 };

/** The notes a callback leaves in the chat (reports count them). */
export const CALLBACK_OFFLINE_NOTE = "Team offline: callback requested";
export const CALLBACK_UNCLAIMED_NOTE = "Nobody claimed the handoff in time";

export function configureHandoffs(options: { availabilityHours: number; routeEscalateMinutes: number }) {
  policy.availabilityHours = options.availabilityHours;
  policy.routeEscalateMinutes = options.routeEscalateMinutes;
}

/** Whether the customer has typed an email or phone number the team can use. */
export function customerGaveContact(messages: string[]): boolean {
  const written = messages.join("\n");
  return /[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(written) || phoneNumbersWritten(written).length > 0;
}

function alert(business: Business, event: AlertEvent) {
  alertTeam(business, event).catch((error) => console.error(`[handoff] ${event.kind} alert failed:`, error));
}

export async function requestHandoff(
  business: Business,
  sessionId: string,
  reason: string,
  now: Date = new Date(),
  language: ChatLanguage = "en",
): Promise<HandoffResult> {
  return runForBusiness(business.id, () => handoffInScope(business, sessionId, reason, now, language));
}

/** When the team is back, in the customer's language: "on Monday at 8:00 AM (Kenya time)". */
function backAt(opensAt: Date | null, timeZone: string, now: Date, language: ChatLanguage): string | null {
  if (!opensAt) return null;
  return language === "sw"
    ? `${describeOpeningSwahili(opensAt, timeZone, now)} (${swahiliTimeZoneLabel(timeZone)})`
    : `${describeOpening(opensAt, timeZone, now)} (${timeZoneLabel(timeZone)})`;
}

async function handoffInScope(business: Business, sessionId: string, reason: string, now: Date, language: ChatLanguage): Promise<HandoffResult> {
  if (!isStaffedAt(business.staffedHours ?? null, business.timeZone, now)) {
    await inBusiness((db) => db
      .update(chatSessions)
      .set({ callbackRequestedAt: now, handoffReason: reason, firstHandoffAt: sql`coalesce(${chatSessions.firstHandoffAt}, ${now})`, updatedAt: now })
      .where(eq(chatSessions.id, sessionId)), business.id);
    const opensAt = nextStaffedAt(business.staffedHours ?? null, business.timeZone, now);
    await appendEvent({
      businessId: business.id,
      sessionId,
      actor: "SYSTEM",
      content: `${CALLBACK_OFFLINE_NOTE} (${reason}).`,
    });
    alert(business, { kind: "callback", sessionId, reason, why: "offline", staffBackAt: opensAt });
    const askContact = !customerGaveContact(await customerMessages(sessionId));
    return {
      status: "callback",
      tellCustomer: texts(language).teamOffline(backAt(opensAt, business.timeZone, now, language), askContact),
    };
  }

  const claimed = await inBusiness((db) => db
    .update(chatSessions)
    .set({
      managedBy: "HUMAN",
      handoffReason: reason,
      handoffAt: now,
      firstHandoffAt: sql`coalesce(${chatSessions.firstHandoffAt}, ${now})`,
      assignedAgentId: null,
      claimedAt: null,
      claimedBy: null,
      routedTo: null,
      routedAt: null,
      teamAlertedAt: null,
      updatedAt: now,
    })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.managedBy, "AI")))
    .returning({ id: chatSessions.id }), business.id);
  if (claimed.length === 0) return { status: "already_escalated" };

  const routedTo = await routeHandoff(business, sessionId, now, policy.availabilityHours).catch((error) => {
    console.error("[handoff] routing failed; alerting everyone:", error);
    return null;
  });
  if (!routedTo) {
    await inBusiness((db) => db.update(chatSessions).set({ teamAlertedAt: now }).where(eq(chatSessions.id, sessionId)), business.id);
  }
  alert(business, { kind: "handoff", sessionId, reason, routedTo });
  return { status: "escalated" };
}

export async function claimSession(sessionId: string, agentId: string, userId: string | null = null): Promise<ChatSession | undefined> {
  const [row] = await inBusiness((db) => db
    .update(chatSessions)
    .set({ managedBy: "HUMAN", assignedAgentId: agentId, claimedBy: userId, claimedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(chatSessions.id, sessionId), inArray(chatSessions.managedBy, ["AI", "HUMAN"])))
    .returning());
  return row;
}

/** Staff hand the conversation back to Zaina. */
export async function releaseSession(sessionId: string, agentId: string): Promise<ChatSession | undefined> {
  const [row] = await inBusiness((db) => db
    .update(chatSessions)
    .set({ managedBy: "AI", assignedAgentId: null, claimedBy: null, routedTo: null, consecutiveFailures: 0, updatedAt: new Date() })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.managedBy, "HUMAN")))
    .returning());
  if (row) {
    await appendEvent({ businessId: row.businessId, sessionId, actor: "SYSTEM", content: `Handed back to Zaina by ${agentId}.` });
  }
  return row;
}

export async function closeSession(sessionId: string): Promise<ChatSession | undefined> {
  const [row] = await inBusiness((db) => db
    .update(chatSessions)
    .set({ managedBy: "CLOSED", updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId))
    .returning());
  return row;
}

/**
 * The handoff clock, business by business: waiting chats offered to one
 * person who hasn't claimed them go to everyone; chats nobody claimed within
 * the business's timeout go back to Zaina with a callback request, and the
 * customer is told. Returns the sessions handed back.
 */
export async function sweepUnclaimedHandoffs(now: Date = new Date()): Promise<string[]> {
  const handedBack: string[] = [];
  for (const business of await allBusinesses()) {
    try {
      handedBack.push(...await runForBusiness(business.id, () => sweepBusiness(business, now)));
    } catch (error) {
      console.error(`[handoff] sweeping ${business.id} failed:`, error);
    }
  }
  return handedBack;
}

async function sweepBusiness(business: Business, now: Date): Promise<string[]> {
  for (const chat of await chatsToEscalate(business, now, policy.routeEscalateMinutes)) {
    alert(business, { kind: "handoff-unclaimed", sessionId: chat.id, reason: chat.reason, routedTo: chat.routedTo });
  }

  const cutoff = new Date(now.getTime() - business.unclaimedTimeoutMinutes * 60_000);
  const rows = await inBusiness((db) => db
    .update(chatSessions)
    .set({ managedBy: "AI", callbackRequestedAt: now, consecutiveFailures: 0, routedTo: null, updatedAt: now })
    .where(and(
      eq(chatSessions.businessId, business.id),
      eq(chatSessions.managedBy, "HUMAN"),
      isNull(chatSessions.assignedAgentId),
      lt(chatSessions.handoffAt, cutoff),
    ))
    .returning({ id: chatSessions.id, handoffReason: chatSessions.handoffReason, language: chatSessions.language }));
  if (rows.length === 0) return [];

  const handedBack: string[] = [];
  for (const row of rows) {
    try {
      const askContact = !customerGaveContact(await customerMessages(row.id));
      await appendEvent({
        businessId: business.id,
        sessionId: row.id,
        actor: "ZAINA_REASONING",
        content: texts(row.language).teamBusy(askContact),
      });
      await appendEvent({
        businessId: business.id,
        sessionId: row.id,
        actor: "SYSTEM",
        content: `${CALLBACK_UNCLAIMED_NOTE}: handed back to Zaina, callback requested.`,
      });
      alert(business, {
        kind: "callback",
        sessionId: row.id,
        reason: row.handoffReason ?? "Handoff",
        why: "unclaimed",
        staffBackAt: null,
      });
      handedBack.push(row.id);
    } catch (error) {
      console.error(`[handoff] handing ${row.id} back failed:`, error);
    }
  }
  return handedBack;
}
