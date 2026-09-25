// zaina-platform/src/channels/whatsapp/inbound.ts
//
// Customers' WhatsApp messages, from the webhook to Zaina's answer.
//
//   accept   Inside the webhook request, each message is stored once, against
//            the customer's open chat with the business: a new chat after a
//            week of silence, or once the team has closed the last one.
//            WhatsApp retries deliveries, so a message already stored is
//            skipped.
//   answer   Moments later, the messages that arrived together are answered
//            together: "hi" / "I need a villa" / "for 4 people" is one
//            question. One chat is answered at a time, in order. Zaina's
//            reply (or nothing, when the team has the chat) then goes out
//            through delivery.ts.
//
// Photos, voice notes and documents are kept for the team by WhatsApp's
// media id; Zaina reads only text, and says so when that's all she got.

import { businessById } from "../../businesses/registry.ts";
import { getBusinessSettings } from "../../businesses/settings.ts";
import { appendEvent } from "../../conversations/store.ts";
import type { Business, ChatMedia } from "../../db/schema.ts";
import { inBusiness, runForBusiness } from "../../db/tenant.ts";
import { handleChatTurn } from "../../engine/agent.ts";
import { texts, type MediaKind } from "../../engine/messages.ts";
import { redactCardNumbers } from "../../engine/redaction.ts";
import { recordTurn, TurnRecorder } from "../../engine/telemetry.ts";
import { consumeLimits } from "../../gateway/rate-limit.ts";
import { visitorKey } from "../../gateway/visitor.ts";
import type { WhatsappContext } from "./context.ts";
import { applyStatuses, deliverSession } from "./delivery.ts";
import { markRead } from "./graph.ts";
import { businessForNumber, connectionFor } from "./numbers.ts";
import { readDelivery, type InboundMessage } from "./webhook.ts";

/** A chat is picked up again within this many days of silence. */
const CHAT_REUSE_DAYS = 7;
/** However many messages keep arriving, the answer starts this long after the first. */
const MAX_BATCH_WAIT_MS = 8_000;
const MAX_ATTEMPTS = 3;

export type ChatRef = { businessId: string; sessionId: string };

/** What the team sees for something that isn't text. */
function describeMedia(message: InboundMessage): string | null {
  const caption = message.media?.caption ? ` ${message.media.caption}` : "";
  switch (message.kind) {
    case "photo": return `[Photo]${caption}`;
    case "voice": return "[Voice note]";
    case "video": return `[Video]${caption}`;
    case "document": return `[Document${message.media?.fileName ? `: ${message.media.fileName}` : ""}]${caption}`;
    case "other": return "[A message Zaina can't read]";
    default: return null;
  }
}

function mediaKindOf(kind: string): MediaKind {
  return kind === "photo" || kind === "voice" || kind === "video" || kind === "document" ? kind : "other";
}

/** The customer's open chat with the business, or a new one. */
async function openChatFor(business: Business, address: string, profileName: string | null, sessionSecret: string): Promise<string> {
  const currency = address.startsWith("254") ? "KES" : (await getBusinessSettings(business.id))?.defaultCurrency === "KES" ? "KES" : "USD";
  return inBusiness(async (_db, client) => {
    // One customer writing twice at once still gets one chat.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`whatsapp:${business.id}:${address}`]);
    const { rows: [open] } = await client.query<{ id: string }>(
      `select id from chat_sessions
       where business_id = $1 and channel = 'whatsapp' and customer_address = $2 and managed_by <> 'CLOSED'
         and last_activity_at > now() - make_interval(days => $3)
       order by last_activity_at desc limit 1`,
      [business.id, address, CHAT_REUSE_DAYS],
    );
    if (open) return open.id;
    const { rows: [created] } = await client.query<{ id: string }>(
      `insert into chat_sessions (business_id, channel, customer_address, customer_name, display_currency, visitor_key)
       values ($1, 'whatsapp', $2, $3, $4, $5) returning id`,
      [business.id, address, profileName, currency, visitorKey(sessionSecret, `wa:${address}`)],
    );
    return created.id;
  }, business.id);
}

/** Stores one message; returns its chat, or null when there's nothing to answer (a duplicate, a reaction). */
async function acceptMessage(ctx: WhatsappContext, business: Business, message: InboundMessage): Promise<string | null> {
  if (message.kind === "reaction" || message.kind === "sticker") return null;
  const sessionId = await openChatFor(business, message.from, message.profileName, ctx.sessionSecret);
  const sentAt = message.sentAt && message.sentAt.getTime() <= Date.now() + 60_000 ? message.sentAt : new Date();
  return inBusiness(async (_db, client) => {
    const { rows } = await client.query(
      `insert into whatsapp_inbound (business_id, session_id, message_id, kind, body, media)
       values ($1, $2, $3, $4, $5, $6) on conflict (business_id, message_id) do nothing returning id`,
      [business.id, sessionId, message.messageId, message.kind, message.text ? redactCardNumbers(message.text) : null, message.media],
    );
    if (rows.length === 0) return null;
    await client.query(
      `update chat_sessions set
         customer_last_message_at = greatest(coalesce(customer_last_message_at, 'epoch'), $3),
         customer_name = coalesce($4, customer_name),
         updated_at = now()
       where business_id = $1 and id = $2`,
      [business.id, sessionId, sentAt, message.profileName],
    );
    return sessionId;
  }, business.id);
}

/**
 * Takes a webhook delivery: stores its messages and status updates. Returns
 * the chats that now have messages to answer, and chats to deliver again.
 * Throws when storing fails, so the webhook answers with an error and Meta
 * sends the delivery again.
 */
export async function acceptDelivery(ctx: WhatsappContext, payload: unknown): Promise<{ toAnswer: ChatRef[]; toDeliver: ChatRef[] }> {
  const toAnswer = new Map<string, ChatRef>();
  const toDeliver = new Map<string, ChatRef>();
  for (const delivery of readDelivery(payload)) {
    const businessId = await businessForNumber(delivery.phoneNumberId);
    const business = businessId ? await businessById(businessId) : undefined;
    if (!business) {
      console.warn(`[whatsapp] a delivery for number ${delivery.phoneNumberId}, which no active business has connected; ignored`);
      continue;
    }
    await runForBusiness(business.id, async () => {
      for (const message of delivery.messages) {
        const sessionId = await acceptMessage(ctx, business, message);
        if (sessionId) toAnswer.set(sessionId, { businessId: business.id, sessionId });
      }
      if (delivery.statuses.length) {
        for (const sessionId of await applyStatuses(business.id, delivery.statuses)) toDeliver.set(sessionId, { businessId: business.id, sessionId });
      }
    });
  }
  return { toAnswer: [...toAnswer.values()], toDeliver: [...toDeliver.values()] };
}

// ── Answering ─────────────────────────────────────────────────────────

const timers = new Map<string, { timer: NodeJS.Timeout; firstAt: number }>();
const running = new Map<string, Promise<void>>();

/** Whether this instance is already about to answer, or answering, a chat. */
export function isScheduled(sessionId: string): boolean {
  return timers.has(sessionId) || running.has(sessionId);
}

/** Answers the chat once its messages stop arriving for a moment (at most MAX_BATCH_WAIT_MS after the first). */
export function scheduleAnswer(ctx: WhatsappContext, chat: ChatRef, delayMs: number = ctx.whatsapp.batchMs): void {
  const now = Date.now();
  const existing = timers.get(chat.sessionId);
  if (existing) clearTimeout(existing.timer);
  const firstAt = existing?.firstAt ?? now;
  const wait = Math.max(0, Math.min(delayMs, firstAt + MAX_BATCH_WAIT_MS - now));
  const timer = setTimeout(() => {
    timers.delete(chat.sessionId);
    void answerChat(ctx, chat);
  }, wait);
  timer.unref?.();
  timers.set(chat.sessionId, { timer, firstAt });
}

/** Answers a chat's waiting messages; one run per chat at a time on this instance. */
export async function answerChat(ctx: WhatsappContext, chat: ChatRef): Promise<void> {
  const previous = running.get(chat.sessionId) ?? Promise.resolve();
  const run = previous
    .then(() => runForBusiness(chat.businessId, () => answerPending(ctx, chat)))
    .catch((error) => console.error(`[whatsapp] answering ${chat.sessionId} failed:`, error));
  running.set(chat.sessionId, run);
  await run;
  if (running.get(chat.sessionId) === run) running.delete(chat.sessionId);
}

type InboundRow = { id: string; message_id: string; kind: string; body: string | null; media: ChatMedia | null; attempts: number };

async function claimPending(businessId: string, sessionId: string): Promise<InboundRow[]> {
  return inBusiness(async (_db, client) => (await client.query<InboundRow>(
    `update whatsapp_inbound set status = 'processing', attempts = attempts + 1
     where id in (
       select id from whatsapp_inbound
       where business_id = $1 and session_id = $2 and status = 'pending'
       order by id for update skip locked
     )
     returning id, message_id, kind, body, media, attempts`,
    [businessId, sessionId],
  )).rows.sort((a, b) => Number(a.id) - Number(b.id)), businessId);
}

async function settle(businessId: string, rows: InboundRow[], status: "done" | "ignored" | "failed" | "pending"): Promise<void> {
  if (rows.length === 0) return;
  await inBusiness((_db, client) => client.query(
    `update whatsapp_inbound set status = $2,
       processed_at = case when $2 = 'pending' then null else now() end,
       body = case when $2 in ('done', 'ignored') then null else body end
     where business_id = $1 and id = any($3::bigint[])`,
    [businessId, status, rows.map((row) => row.id)],
  ), businessId);
}

async function answerPending(ctx: WhatsappContext, chat: ChatRef): Promise<void> {
  const business = await businessById(chat.businessId);
  if (!business) return;
  for (let round = 0; round < 5; round += 1) {
    const rows = await claimPending(business.id, chat.sessionId);
    if (rows.length === 0) break;
    try {
      const outcome = await answerBatch(ctx, business, chat.sessionId, rows);
      if (outcome === "busy") {
        await settle(business.id, rows, "pending");
        scheduleAnswer(ctx, chat, 3_000);
        return;
      }
      await settle(business.id, rows, outcome === "limited" ? "ignored" : "done");
    } catch (error) {
      console.error(`[whatsapp] answering ${chat.sessionId} failed:`, error);
      const retry = rows.filter((row) => row.attempts < MAX_ATTEMPTS);
      await settle(business.id, retry, "pending");
      await settle(business.id, rows.filter((row) => row.attempts >= MAX_ATTEMPTS), "failed");
      if (retry.length) scheduleAnswer(ctx, chat, 5_000 * retry[0].attempts);
      break;
    }
  }
  const delivered = await deliverSession(ctx, business.id, chat.sessionId);
  if (delivered.status === "retry" || delivered.status === "busy") {
    console.info(`[whatsapp] delivery for ${chat.sessionId} will be retried (${delivered.status})`);
  }
}

async function answerBatch(ctx: WhatsappContext, business: Business, sessionId: string, rows: InboundRow[]): Promise<"answered" | "busy" | "limited"> {
  const { rows: [session] } = await inBusiness((_db, client) => client.query<{ managed_by: string; language: "en" | "sw"; visitor_key: string | null }>(
    "select managed_by, language, visitor_key from chat_sessions where business_id = $1 and id = $2",
    [business.id, sessionId],
  ), business.id);
  if (!session) return "answered";

  // The customer wrote again after the team closed the chat: Zaina picks it up.
  if (session.managed_by === "CLOSED") {
    await inBusiness((_db, client) => client.query(
      "update chat_sessions set managed_by = 'AI', assigned_agent_id = null, claimed_by = null, routed_to = null where business_id = $1 and id = $2",
      [business.id, sessionId],
    ), business.id);
    session.managed_by = "AI";
  }

  const verdict = await consumeLimits([
    { key: `messages:session:${sessionId}`, limit: ctx.limits.sessionMessagesPerMinute, windowSeconds: 60 },
    { key: `messages:visitor:${session.visitor_key ?? sessionId}`, limit: ctx.limits.visitorMessagesPer10Minutes, windowSeconds: 600 },
    { key: `messages:business:${business.id}`, limit: ctx.limits.businessMessagesPerHour, windowSeconds: 3600 },
  ]);
  if (!verdict.allowed) {
    await recordTurn(business.id, sessionId, new TurnRecorder().finish("rate_limited")).catch(() => {});
    return "limited";
  }

  const lines: string[] = [];
  const media: ChatMedia[] = [];
  let readable = false;
  for (const row of rows) {
    const asMessage: InboundMessage = { messageId: row.message_id, from: "", profileName: null, sentAt: null, kind: row.kind as InboundMessage["kind"], text: row.body, media: row.media };
    if (row.media) media.push(row.media);
    const described = describeMedia(asMessage);
    if (described) lines.push(described);
    else if (row.body) lines.push(row.body);
    if (row.body && row.kind !== "other") readable = true;
  }
  const message = lines.join("\n").trim();
  if (!message) return "answered";

  if (session.managed_by === "AI") {
    // Blue ticks and "typing…" while Zaina works on it.
    const connection = await connectionFor(business.id);
    if (connection) {
      void markRead(
        { version: ctx.whatsapp.graphVersion, phoneNumberId: connection.phoneNumberId, accessToken: connection.accessToken },
        rows[rows.length - 1].message_id,
        readable,
      ).catch(() => {});
    }
  }

  if (!readable && session.managed_by === "AI") {
    // Only things Zaina can't read: keep them for the team, and say so.
    await appendEvent({ businessId: business.id, sessionId, actor: "USER", content: message, media });
    await appendEvent({ businessId: business.id, sessionId, actor: "ZAINA_REASONING", content: texts(session.language).mediaNotRead(mediaKindOf(rows[0].kind)) });
    return "answered";
  }

  const result = await handleChatTurn({ business, sessionId, message, options: ctx.engine, media });
  if (result.status === "busy") return "busy";
  if (result.status === "error" && result.error !== "session_not_found") {
    // The engine didn't save a reply for a failed turn: this one must still reach the customer.
    await appendEvent({ businessId: business.id, sessionId, actor: "ZAINA_REASONING", content: result.message });
  }
  return "answered";
}
