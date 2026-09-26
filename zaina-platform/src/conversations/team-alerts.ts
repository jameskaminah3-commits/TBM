// zaina-platform/src/conversations/team-alerts.ts
//
// Telling a business's people what needs them.
//
//   - The business's connector hears every event, as before (TBM: its ops
//     emails and its admins' phone pushes).
//   - The platform alerts the business's own staff, on their phones and
//     browsers (web push) and by email:
//       a waiting chat          the person it was routed to, or everyone
//       still waiting           everyone (nobody claimed it in time)
//       a callback to make      everyone
//       trouble                 managers and owners (system errors, a
//                               used-up daily model budget)
//       the customer replied    the person handling the chat (push only)
//       a booking request       people who answer chats
//       an M-Pesa code to check people who answer chats
//       a new confirmed booking people who answer chats
//       a paid booking without  managers and owners
//       its rooms
//
// Alerts are best-effort: a failure is logged, never shown to the customer,
// and never holds up a reply.

import webpush from "web-push";
import type { AlertEmailConfig, PlatformConfig, WebPushConfig } from "../config.ts";
import { connectorFor } from "../connectors/registry.ts";
import type { TeamEvent } from "../connectors/types.ts";
import { deletePushSubscription, markPushSubscriptionUsed } from "../db/platform-scope.ts";
import type { Business } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { getBusinessSettings } from "../businesses/settings.ts";

export type AlertEvent =
  | TeamEvent
  /** Nobody claimed a waiting chat that was offered to one person: tell everyone. */
  | { kind: "handoff-unclaimed"; sessionId: string; reason: string; routedTo: string | null }
  /** The customer wrote in a chat a person is handling. */
  | { kind: "customer-replied"; sessionId: string; preview: string }
  /** Something about a booking needs the team, or is worth knowing. */
  | { kind: "booking"; what: "request" | "confirmed" | "conflict" | "code"; bookingId: string; sessionId: string | null; summary: string };

type Settings = { webPush: WebPushConfig | null; alertEmail: AlertEmailConfig | null; publicBaseUrl: string | null };
let settings: Settings = { webPush: null, alertEmail: null, publicBaseUrl: null };

export function configureTeamAlerts(config: Pick<PlatformConfig, "webPush" | "alertEmail" | "publicBaseUrl">) {
  settings = { webPush: config.webPush, alertEmail: config.alertEmail, publicBaseUrl: config.publicBaseUrl };
}

export function pushPublicKey(): string | null {
  return settings.webPush?.publicKey ?? null;
}

type Person = { id: string; name: string; email: string; role: string; alertEmail: boolean };
type Alert = { title: string; body: string; sessionId: string | null; urgent: boolean; bookingId?: string };

/** Everyone who works for the business, with their role. */
async function peopleOf(businessId: string): Promise<Person[]> {
  return inBusiness(async (_db, client) => {
    const { rows } = await client.query<{ id: string; name: string; email: string; role: string; alert_email: boolean }>(
      `select u.id, u.name, u.email, m.role, m.alert_email
       from staff_memberships as m join staff_users as u on u.id = m.user_id
       where m.business_id = $1 and u.disabled_at is null`,
      [businessId],
    );
    return rows.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role, alertEmail: row.alert_email }));
  }, businessId);
}

const answersChats = (person: Person) => person.role !== "viewer";
const runsTheBusiness = (person: Person) => person.role === "manager" || person.role === "owner";

async function sessionHandler(businessId: string, sessionId: string): Promise<string | null> {
  return inBusiness(async (_db, client) => {
    const { rows: [row] } = await client.query<{ handler: string | null }>(
      "select coalesce(claimed_by, routed_to) as handler from chat_sessions where business_id = $1 and id = $2",
      [businessId, sessionId],
    );
    return row?.handler ?? null;
  }, businessId);
}

function consoleLink(businessId: string, alert: Pick<Alert, "sessionId" | "bookingId">): string {
  const base = settings.publicBaseUrl ?? "";
  const page = alert.bookingId ? `bookings/${alert.bookingId}` : `inbox${alert.sessionId ? `/${alert.sessionId}` : ""}`;
  return `${base}/console/#/b/${encodeURIComponent(businessId)}/${page}`;
}

const BOOKING_ALERTS = {
  request: { title: "A booking request to answer", urgent: true },
  code: { title: "An M-Pesa payment to check", urgent: true },
  confirmed: { title: "New booking confirmed", urgent: false },
  conflict: { title: "A paid booking needs its rooms", urgent: true },
} as const;

/** Who hears about an event, and what they're told. Null: the platform sends nothing for it. */
async function plan(business: Business, event: AlertEvent): Promise<{ people: Person[]; alert: Alert; email: boolean } | null> {
  const people = await peopleOf(business.id);
  const byId = (id: string | null | undefined) => people.filter((person) => person.id === id);
  switch (event.kind) {
    case "handoff": {
      const routed = event.routedTo ? byId(event.routedTo.userId) : [];
      return {
        people: routed.length ? routed : people.filter(answersChats),
        alert: { title: "A customer is waiting for you", body: event.reason, sessionId: event.sessionId, urgent: true },
        email: true,
      };
    }
    case "handoff-unclaimed":
      return {
        people: people.filter((person) => answersChats(person) && person.id !== event.routedTo),
        alert: { title: "A customer is still waiting", body: `Nobody has claimed this chat yet: ${event.reason}`, sessionId: event.sessionId, urgent: true },
        email: true,
      };
    case "callback":
      return {
        people: people.filter(answersChats),
        alert: {
          title: "Call a customer back",
          body: `${event.why === "offline" ? "They wrote while the team was offline" : "Nobody claimed the chat in time"}: ${event.reason}`,
          sessionId: event.sessionId,
          urgent: false,
        },
        email: true,
      };
    case "customer-replied": {
      const handler = await sessionHandler(business.id, event.sessionId);
      return handler
        ? { people: byId(handler), alert: { title: "The customer replied", body: event.preview, sessionId: event.sessionId, urgent: true }, email: false }
        : null;
    }
    case "system-error":
      return {
        people: people.filter(runsTheBusiness),
        alert: { title: "Zaina needs a look", body: event.summary, sessionId: event.sessionId && event.sessionId !== "-" ? event.sessionId : null, urgent: false },
        email: true,
      };
    case "booking":
      return {
        people: people.filter(event.what === "conflict" ? runsTheBusiness : answersChats),
        alert: { ...BOOKING_ALERTS[event.what], body: event.summary, sessionId: event.sessionId, bookingId: event.bookingId },
        email: true,
      };
    case "spend-cap":
      return {
        people: people.filter(runsTheBusiness),
        alert: {
          title: "Zaina reached today's model budget",
          body: `${event.usedTokens.toLocaleString("en-US")} of ${event.capTokens.toLocaleString("en-US")} tokens used on ${event.day}. Customers get your contact details until tomorrow.`,
          sessionId: null,
          urgent: false,
        },
        email: true,
      };
    default:
      return null;
  }
}

type PushRequest = { method: string; headers: Record<string, string | number>; body: Buffer | null; endpoint: string };
const buildPushRequest = (webpush as unknown as {
  generateRequestDetails(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { TTL: number; urgency: string; vapidDetails: { subject: string; publicKey: string; privateKey: string } },
  ): PushRequest;
}).generateRequestDetails;

async function sendPushes(businessId: string, people: Person[], alert: Alert, businessName: string): Promise<number> {
  const config = settings.webPush;
  if (!config || people.length === 0) return 0;
  const subscriptions = await inBusiness(async (_db, client) => (await client.query<{ endpoint: string; p256dh: string; auth: string }>(
    "select endpoint, p256dh, auth from staff_push_subscriptions where user_id = any($1::uuid[])",
    [people.map((person) => person.id)],
  )).rows, businessId);
  const payload = JSON.stringify({
    title: `${alert.title} · ${businessName}`,
    body: alert.body.slice(0, 180),
    url: consoleLink(businessId, alert),
    tag: alert.bookingId ? `booking-${alert.bookingId}` : alert.sessionId ?? `business-${businessId}`,
  });
  let sent = 0;
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      const request = buildPushRequest(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
        { TTL: alert.urgent ? 3600 : 6 * 3600, urgency: alert.urgent ? "high" : "normal", vapidDetails: config },
      );
      const response = await fetch(request.endpoint, {
        method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, String(value)])),
        body: request.body ?? undefined,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404 || response.status === 410) {
        // The browser dropped the subscription: stop sending to it.
        await deletePushSubscription(subscription.endpoint);
      } else if (response.ok) {
        sent += 1;
        await markPushSubscriptionUsed(subscription.endpoint);
      } else {
        console.warn(`[alerts] push refused (${response.status}) for a device of ${businessId}`);
      }
    } catch (error) {
      console.error(`[alerts] push failed for a device of ${businessId}:`, (error as Error).message);
    }
  }));
  return sent;
}

async function sendEmails(businessId: string, people: Person[], alert: Alert, businessName: string): Promise<number> {
  const config = settings.alertEmail;
  const recipients = people.filter((person) => person.alertEmail);
  if (!config || recipients.length === 0) return 0;
  let sent = 0;
  for (const person of recipients) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${config.resendApiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: config.from,
          to: [person.email],
          subject: `[${businessName}] ${alert.title}`,
          text: [
            `Hi ${person.name.split(/\s+/)[0]},`,
            "",
            alert.body,
            "",
            settings.publicBaseUrl
              ? `${alert.bookingId ? "Open the booking" : "Open the chat"}: ${consoleLink(businessId, alert)}`
              : `Open the Zaina console to see the ${alert.bookingId ? "booking" : "chat"}.`,
            "",
            "You get these emails because you work on this business's chats. You can turn them off in the console (menu → Alerts).",
          ].join("\n"),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) sent += 1;
      else console.warn(`[alerts] email refused (${response.status}) for ${businessId}`);
    } catch (error) {
      console.error(`[alerts] email failed for ${businessId}:`, (error as Error).message);
    }
  }
  return sent;
}

/** Alerts the business's people (and its connector) about an event. Never throws. */
export async function alertTeam(business: Business, event: AlertEvent): Promise<void> {
  const connectorEvent = event.kind !== "handoff-unclaimed" && event.kind !== "customer-replied" && event.kind !== "booking";
  await Promise.all([
    connectorEvent
      ? connectorFor(business)
        .then((connector) => connector.notifyTeam(business, event as TeamEvent))
        .catch((error) => console.error(`[alerts] ${business.id} connector alert (${event.kind}) failed:`, error))
      : Promise.resolve(),
    (async () => {
      try {
        const target = await plan(business, event);
        if (!target || target.people.length === 0) return;
        const name = (await getBusinessSettings(business.id))?.displayName ?? business.name;
        await Promise.all([
          sendPushes(business.id, target.people, target.alert, name),
          target.email ? sendEmails(business.id, target.people, target.alert, name) : Promise.resolve(0),
        ]);
      } catch (error) {
        console.error(`[alerts] ${business.id} staff alert (${event.kind}) failed:`, error);
      }
    })(),
  ]);
}
