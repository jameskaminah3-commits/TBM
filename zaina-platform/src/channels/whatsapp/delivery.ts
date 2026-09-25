// zaina-platform/src/channels/whatsapp/delivery.ts
//
// Getting Zaina's and the team's replies to a WhatsApp customer. Replies are
// conversation events like any other. Each WhatsApp chat keeps a cursor: the
// last event delivered. Delivery sends everything after it, in order.
// Whatever adds a reply (a chat turn, a team reply, a handoff running out of
// time) asks for delivery; a sweep catches anything missed, such as after a
// restart. A lease on the chat keeps two instances from sending the same reply.
//
// WhatsApp's rules, as delivery follows them:
//   - Free-form messages go only within 24 hours of the customer's last
//     message. After that, only an approved template can reach them: the
//     business's follow-up template is sent once, and the replies wait until
//     the customer writes again.
//   - Rate limits and Meta's own outages: stop, and try again later, in order.
//   - A message WhatsApp won't take is recorded as failed and skipped, so one
//     bad message never blocks the chat.
//   - A token Meta refuses: the business's managers are alerted (at most
//     hourly) and delivery waits for the connection to be fixed.

import { getBusinessSettings } from "../../businesses/settings.ts";
import { businessById } from "../../businesses/registry.ts";
import { alertTeam } from "../../conversations/team-alerts.ts";
import { firstName } from "../../conversations/store.ts";
import { inBusiness, runForBusiness } from "../../db/tenant.ts";
import type { WhatsappContext } from "./context.ts";
import { toWhatsappText, splitMessage, teamReply } from "./format.ts";
import { sendTemplate, sendText, type GraphFailure, type GraphTarget } from "./graph.ts";
import { connectionFor, type WhatsappConnection } from "./numbers.ts";

export type DeliveryStatus = "delivered" | "nothing" | "busy" | "window_closed" | "retry" | "not_connected" | "auth_problem";
export type DeliveryResult = { status: DeliveryStatus; sent: number };

const WINDOW_MS = 24 * 60 * 60_000;
/** Treat the window as closed a little early: Meta's clock, not ours, decides. */
const WINDOW_MARGIN_MS = 2 * 60_000;
const LEASE_SECONDS = 90;

export function windowOpen(customerLastMessageAt: Date | null, now: Date = new Date()): boolean {
  return customerLastMessageAt !== null && now.getTime() - customerLastMessageAt.getTime() < WINDOW_MS - WINDOW_MARGIN_MS;
}

/** When the free-reply window closes, for the console. */
export function windowClosesAt(customerLastMessageAt: Date | null): Date | null {
  return customerLastMessageAt ? new Date(customerLastMessageAt.getTime() + WINDOW_MS - WINDOW_MARGIN_MS) : null;
}

type LeasedChat = {
  id: string;
  customer_address: string;
  customer_name: string | null;
  customer_last_message_at: Date | null;
  delivered_event_id: string;
  followup_sent_at: Date | null;
};

const authAlertedAt = new Map<string, number>();

function targetOf(ctx: WhatsappContext, connection: WhatsappConnection): GraphTarget {
  return { version: ctx.whatsapp.graphVersion, phoneNumberId: connection.phoneNumberId, accessToken: connection.accessToken };
}

async function recordOutbound(
  businessId: string,
  sessionId: string,
  outcome: { eventId: number | null; kind: "text" | "template"; messageId?: string | null; failure?: GraphFailure | null },
): Promise<void> {
  await inBusiness((_db, client) => client.query(
    `insert into whatsapp_outbound (business_id, session_id, event_id, message_id, kind, status, error_code, error_title)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      businessId, sessionId, outcome.eventId, outcome.messageId ?? null, outcome.kind,
      outcome.failure ? "failed" : "sent", outcome.failure?.code ?? null, outcome.failure?.title ?? null,
    ],
  ), businessId);
}

async function alertAuthProblem(businessId: string, sessionId: string, failure: GraphFailure) {
  const last = authAlertedAt.get(businessId) ?? 0;
  if (Date.now() - last < 60 * 60_000) return;
  authAlertedAt.set(businessId, Date.now());
  const business = await businessById(businessId);
  if (!business) return;
  await alertTeam(business, {
    kind: "system-error",
    sessionId,
    summary: `WhatsApp refused the business's access token, so replies can't be sent: ${failure.title}. Update the token in Settings → WhatsApp.`,
    details: { "Meta error code": failure.code },
  });
}

/**
 * The window has closed: send the business's follow-up template once (per
 * customer message), so the customer knows a reply is waiting.
 */
async function sendFollowup(ctx: WhatsappContext, businessId: string, chat: LeasedChat, connection: WhatsappConnection): Promise<void> {
  if (!connection.followupTemplate) return;
  const last = chat.customer_last_message_at;
  if (chat.followup_sent_at && (!last || chat.followup_sent_at > last)) return;

  const parameter = connection.followupTemplateParameter === "business_name"
    ? (await getBusinessSettings(businessId))?.displayName ?? businessId
    : connection.followupTemplateParameter === "customer_name"
      ? (chat.customer_name ? firstName(chat.customer_name) : "there")
      : null;
  const result = await sendTemplate(targetOf(ctx, connection), chat.customer_address, {
    name: connection.followupTemplate,
    language: connection.followupTemplateLanguage,
    bodyParameter: parameter,
  });
  // Marked sent either way: a failing template isn't retried every few seconds.
  await inBusiness((_db, client) => client.query(
    "update chat_sessions set followup_sent_at = now() where business_id = $1 and id = $2",
    [businessId, chat.id],
  ), businessId);
  await recordOutbound(businessId, chat.id, { eventId: null, kind: "template", messageId: result.ok ? result.messageId : null, failure: result.ok ? null : result });
  if (!result.ok) {
    const business = await businessById(businessId);
    if (business) {
      await alertTeam(business, {
        kind: "system-error",
        sessionId: chat.id,
        summary: `The WhatsApp follow-up template "${connection.followupTemplate}" couldn't be sent: ${result.title}. The customer hasn't been told a reply is waiting.`,
        details: { "Meta error code": result.code },
      });
    }
  }
}

async function pendingEvents(businessId: string, sessionId: string, afterId: number) {
  return inBusiness(async (_db, client) => (await client.query<{ id: string; actor: string; content: string; author_name: string | null }>(
    `select e.id, e.actor, e.content, u.name as author_name
     from chat_events as e left join staff_users as u on u.id = e.author
     where e.business_id = $1 and e.session_id = $2 and e.id > $3
       and e.actor in ('ZAINA_REASONING', 'AGENT') and e.content is not null and length(btrim(e.content)) > 0
     order by e.id limit 20`,
    [businessId, sessionId, afterId],
  )).rows, businessId);
}

async function deliverLeased(ctx: WhatsappContext, businessId: string, chat: LeasedChat, connection: WhatsappConnection): Promise<DeliveryResult> {
  const target = targetOf(ctx, connection);
  let cursor = Number(chat.delivered_event_id);
  let sent = 0;
  for (let round = 0; round < 10; round += 1) {
    const events = await pendingEvents(businessId, chat.id, cursor);
    if (events.length === 0) return { status: sent ? "delivered" : "nothing", sent };
    for (const event of events) {
      if (!windowOpen(chat.customer_last_message_at)) {
        await sendFollowup(ctx, businessId, chat, connection);
        return { status: "window_closed", sent };
      }
      const text = toWhatsappText(event.actor === "AGENT" ? teamReply(event.author_name ? firstName(event.author_name) : null, event.content) : event.content);
      for (const part of splitMessage(text)) {
        const result = await sendText(target, chat.customer_address, part);
        if (result.ok) {
          await recordOutbound(businessId, chat.id, { eventId: Number(event.id), kind: "text", messageId: result.messageId });
          sent += 1;
          continue;
        }
        if (result.windowClosed) {
          // Meta says the window has closed: agree with it, and follow up.
          await inBusiness((_db, client) => client.query(
            `update chat_sessions set customer_last_message_at = least(customer_last_message_at, now() - interval '24 hours')
             where business_id = $1 and id = $2`,
            [businessId, chat.id],
          ), businessId);
          chat.customer_last_message_at = new Date(Math.min(chat.customer_last_message_at?.getTime() ?? 0, Date.now() - WINDOW_MS));
          await sendFollowup(ctx, businessId, chat, connection);
          return { status: "window_closed", sent };
        }
        if (result.retryable) {
          console.warn(`[whatsapp] ${businessId}: sending paused (${result.code} ${result.title}); retrying later`);
          return { status: "retry", sent };
        }
        await recordOutbound(businessId, chat.id, { eventId: Number(event.id), kind: "text", failure: result });
        if (result.authProblem) {
          await alertAuthProblem(businessId, chat.id, result);
          return { status: "auth_problem", sent };
        }
        console.warn(`[whatsapp] ${businessId}: message ${event.id} not delivered (${result.code} ${result.title}); skipped`);
        break;
      }
      cursor = Number(event.id);
      await inBusiness((_db, client) => client.query(
        "update chat_sessions set delivered_event_id = greatest(delivered_event_id, $3) where business_id = $1 and id = $2",
        [businessId, chat.id, cursor],
      ), businessId);
    }
  }
  return { status: "delivered", sent };
}

/** Sends a WhatsApp chat's undelivered replies. Safe to call any time, from anywhere. */
export async function deliverSession(ctx: WhatsappContext, businessId: string, sessionId: string): Promise<DeliveryResult> {
  return runForBusiness(businessId, async () => {
    const connection = await connectionFor(businessId);
    if (!connection) return { status: "not_connected" as const, sent: 0 };
    const { rows: [chat] } = await inBusiness((_db, client) => client.query<LeasedChat>(
      `update chat_sessions set delivery_lock_until = now() + make_interval(secs => $3)
       where business_id = $1 and id = $2 and channel = 'whatsapp' and customer_address is not null
         and (delivery_lock_until is null or delivery_lock_until < now())
       returning id, customer_address, customer_name, customer_last_message_at, delivered_event_id, followup_sent_at`,
      [businessId, sessionId, LEASE_SECONDS],
    ), businessId);
    if (!chat) return { status: "busy" as const, sent: 0 };
    try {
      return await deliverLeased(ctx, businessId, chat, connection);
    } finally {
      await inBusiness((_db, client) => client.query(
        "update chat_sessions set delivery_lock_until = null where business_id = $1 and id = $2",
        [businessId, sessionId],
      ), businessId).catch((error) => console.error("[whatsapp] releasing a delivery lease failed:", error));
    }
  });
}

/**
 * The business's WhatsApp chats with replies still to send (recent ones;
 * chats whose window closed and were already followed up wait for the customer).
 */
export async function chatsWithUndelivered(businessId: string, hasFollowupTemplate: boolean): Promise<string[]> {
  return inBusiness(async (_db, client) => (await client.query<{ id: string }>(
    `select s.id from chat_sessions as s
     where s.business_id = $1 and s.channel = 'whatsapp'
       and s.last_activity_at > now() - interval '2 days'
       and (s.delivery_lock_until is null or s.delivery_lock_until < now())
       and exists (
         select 1 from chat_events as e
         where e.business_id = s.business_id and e.session_id = s.id and e.id > s.delivered_event_id
           and e.actor in ('ZAINA_REASONING', 'AGENT') and e.content is not null
       )
       and (
         s.customer_last_message_at > now() - interval '1438 minutes'
         or ($2 and (s.followup_sent_at is null or s.followup_sent_at <= coalesce(s.customer_last_message_at, 'epoch')))
       )
     order by s.last_activity_at limit 50`,
    [businessId, hasFollowupTemplate],
  )).rows.map((row) => row.id), businessId);
}

const STATUS_RANK = "case $3 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 4 end";

/**
 * What WhatsApp says happened to messages sent: delivered, read or failed.
 * Statuses only move forward. A message that failed because the window had
 * closed goes back in line, behind the follow-up template. Returns chats to
 * deliver again.
 */
export async function applyStatuses(
  businessId: string,
  statuses: Array<{ messageId: string; status: string; errorCode: number | null; errorTitle: string | null }>,
): Promise<string[]> {
  const redeliver = new Set<string>();
  for (const update of statuses) {
    const { rows: [row] } = await inBusiness((_db, client) => client.query<{ session_id: string; event_id: string | null }>(
      `update whatsapp_outbound set status = $3, error_code = coalesce($4, error_code), error_title = coalesce($5, error_title), updated_at = now()
       where business_id = $1 and message_id = $2
         and (case status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 4 end) < ${STATUS_RANK}
       returning session_id, event_id`,
      [businessId, update.messageId, update.status, update.errorCode, update.errorTitle],
    ), businessId);
    if (!row) continue;
    if (update.status === "failed" && update.errorCode === 131047 && row.event_id) {
      await inBusiness((_db, client) => client.query(
        `update chat_sessions set
           delivered_event_id = least(delivered_event_id, $3::bigint - 1),
           customer_last_message_at = least(customer_last_message_at, now() - interval '24 hours')
         where business_id = $1 and id = $2`,
        [businessId, row.session_id, row.event_id],
      ), businessId);
      redeliver.add(row.session_id);
    }
  }
  return [...redeliver];
}
