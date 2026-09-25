// zaina-platform/src/conversations/store.ts
//
// Conversations live in the platform's own database: sessions and every
// event in them (customer messages, Zaina's replies, tool calls and results,
// staff replies). Tools read what they need through these functions instead
// of touching the tables.
//
// Every function runs inside the current business's scope (db/tenant.ts):
// Postgres returns only that business's conversations.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { inBusiness } from "../db/tenant.ts";
import { chatEvents, chatSessions, type ChatSession } from "../db/schema.ts";
import { redactCardNumbers } from "../engine/redaction.ts";

export type Actor = "USER" | "ZAINA_REASONING" | "SYSTEM_TOOL" | "AGENT" | "SYSTEM";
export type Currency = "USD" | "KES";

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function createSession(
  businessId: string,
  options: { displayCurrency: Currency; visitorKey: string | null },
): Promise<ChatSession> {
  return inBusiness(async (db) => {
    const [row] = await db
      .insert(chatSessions)
      .values({ businessId, displayCurrency: options.displayCurrency, visitorKey: options.visitorKey })
      .returning();
    return row;
  }, businessId);
}

export async function getSession(sessionId: string): Promise<ChatSession | undefined> {
  if (!isUuid(sessionId)) return undefined;
  return inBusiness(async (db) => {
    const [row] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
    return row;
  });
}

export async function setDisplayCurrency(sessionId: string, currency: Currency): Promise<void> {
  await inBusiness((db) => db
    .update(chatSessions)
    .set({ displayCurrency: currency, updatedAt: new Date() })
    .where(and(eq(chatSessions.id, sessionId), sql`${chatSessions.displayCurrency} <> ${currency}`)));
}

export async function sessionCurrency(sessionId: string): Promise<Currency> {
  const session = await getSession(sessionId);
  return session?.displayCurrency === "KES" ? "KES" : "USD";
}

/**
 * Records one event. Customer text is stored with card numbers removed (I17);
 * the same redacted text is what the model sees.
 */
export async function appendEvent(event: {
  businessId: string;
  sessionId: string;
  actor: Actor;
  content?: string | null;
  toolName?: string | null;
  toolArguments?: unknown;
  toolResponse?: unknown;
}): Promise<number> {
  const content = typeof event.content === "string" && event.actor === "USER"
    ? redactCardNumbers(event.content)
    : event.content ?? null;
  return inBusiness(async (db) => {
    const [row] = await db
      .insert(chatEvents)
      .values({
        businessId: event.businessId,
        sessionId: event.sessionId,
        actor: event.actor,
        content,
        toolName: event.toolName ?? null,
        toolArguments: event.toolArguments ?? null,
        toolResponse: event.toolResponse ?? null,
      })
      .returning({ id: chatEvents.id });
    await db
      .update(chatSessions)
      .set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(chatSessions.id, event.sessionId));
    return row.id;
  }, event.businessId);
}

export async function hasCustomerMessages(sessionId: string): Promise<boolean> {
  return inBusiness(async (db) => {
    const [row] = await db
      .select({ id: chatEvents.id })
      .from(chatEvents)
      .where(and(eq(chatEvents.sessionId, sessionId), eq(chatEvents.actor, "USER")))
      .limit(1);
    return Boolean(row);
  });
}

export type HistoryRow = {
  actor: string;
  content: string | null;
  toolName: string | null;
  toolArguments: unknown;
  toolResponse: unknown;
};

/** The latest events the model should see, oldest first. */
export async function recentHistory(sessionId: string, limit: number): Promise<HistoryRow[]> {
  return inBusiness(async (db) => {
    const rows = await db
      .select({
        actor: chatEvents.actor,
        content: chatEvents.content,
        toolName: chatEvents.toolName,
        toolArguments: chatEvents.toolArguments,
        toolResponse: chatEvents.toolResponse,
      })
      .from(chatEvents)
      .where(and(eq(chatEvents.sessionId, sessionId), inArray(chatEvents.actor, ["USER", "ZAINA_REASONING", "SYSTEM_TOOL"])))
      .orderBy(desc(chatEvents.id))
      .limit(limit);
    return rows.reverse();
  });
}

/** Everything the customer typed in this conversation, oldest first. */
export async function customerMessages(sessionId: string): Promise<string[]> {
  return inBusiness(async (db) => {
    const rows = await db
      .select({ content: chatEvents.content })
      .from(chatEvents)
      .where(and(eq(chatEvents.sessionId, sessionId), eq(chatEvents.actor, "USER")))
      .orderBy(asc(chatEvents.id));
    return rows.map((row) => row.content ?? "").filter(Boolean);
  });
}

/** Earlier results of one tool in this conversation that ended with a given error. */
export async function toolErrorResponses(sessionId: string, toolName: string, error: string): Promise<unknown[]> {
  return inBusiness(async (db) => {
    const rows = await db
      .select({ response: chatEvents.toolResponse })
      .from(chatEvents)
      .where(and(
        eq(chatEvents.sessionId, sessionId),
        eq(chatEvents.toolName, toolName),
        sql`${chatEvents.toolResponse}->>'error' = ${error}`,
      ))
      .orderBy(asc(chatEvents.id));
    return rows.map((row) => row.response);
  });
}

/** Successful results of some tools in this conversation, newest first. */
export async function toolSuccesses(sessionId: string, toolNames: string[]): Promise<Array<{ toolName: string; response: any }>> {
  return inBusiness(async (db) => {
    const rows = await db
      .select({ toolName: chatEvents.toolName, response: chatEvents.toolResponse })
      .from(chatEvents)
      .where(and(
        eq(chatEvents.sessionId, sessionId),
        inArray(chatEvents.toolName, toolNames),
        sql`(${chatEvents.toolResponse}->>'ok')::boolean is true`,
      ))
      .orderBy(desc(chatEvents.id));
    return rows.map((row) => ({ toolName: row.toolName ?? "", response: row.response }));
  });
}

/** Zaina's latest replies in this conversation, newest first. */
export async function recentZainaReplies(sessionId: string, limit: number): Promise<string[]> {
  return inBusiness(async (db) => {
    const rows = await db
      .select({ content: chatEvents.content })
      .from(chatEvents)
      .where(and(eq(chatEvents.sessionId, sessionId), eq(chatEvents.actor, "ZAINA_REASONING")))
      .orderBy(desc(chatEvents.id))
      .limit(limit);
    return rows.map((row) => row.content ?? "");
  });
}

/** The transcript as the team sees it in emails: who said what, when. */
export async function transcript(sessionId: string): Promise<Array<{ actor: string; text: string; timestamp: string }>> {
  return inBusiness(async (db) => {
    const rows = await db
      .select({ actor: chatEvents.actor, content: chatEvents.content, createdAt: chatEvents.createdAt })
      .from(chatEvents)
      .where(eq(chatEvents.sessionId, sessionId))
      .orderBy(asc(chatEvents.id));
    return rows
      .filter((row) => row.content)
      .map((row) => ({ actor: row.actor, text: row.content as string, timestamp: row.createdAt.toISOString() }));
  });
}

/** Messages the customer may see, after a cursor (for the widget during a handoff). */
export async function customerVisibleEvents(sessionId: string, afterId: number) {
  return inBusiness((db) => db
    .select({ id: chatEvents.id, actor: chatEvents.actor, content: chatEvents.content, createdAt: chatEvents.createdAt })
    .from(chatEvents)
    .where(and(
      eq(chatEvents.sessionId, sessionId),
      inArray(chatEvents.actor, ["USER", "ZAINA_REASONING", "AGENT"]),
      sql`${chatEvents.id} > ${afterId}`,
    ))
    .orderBy(asc(chatEvents.id))
    .limit(200));
}

/** Sets or clears the session's count of failed turns in a row (C4b). */
export async function setConsecutiveFailures(sessionId: string, failures: number): Promise<void> {
  await inBusiness((db) => db
    .update(chatSessions)
    .set({ consecutiveFailures: failures })
    .where(eq(chatSessions.id, sessionId)));
}
