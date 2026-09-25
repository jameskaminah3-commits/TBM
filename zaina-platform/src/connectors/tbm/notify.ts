// zaina-platform/src/connectors/tbm/notify.ts
//
// Telling TBM's team what needs them: the same ops emails and phone pushes
// today's Zaina sends, now also for callbacks (C4c) and a used-up daily model
// budget (C6). Best-effort: a failed alert is logged, never shown to the
// customer.

import { and, eq } from "drizzle-orm";
import type { Business } from "../../db/schema.ts";
import type { TeamEvent } from "../types.ts";
import {
  db,
  sendOpsAlertEmail,
  sendWebPushNotification,
  sendZainaConversationStartedEmail,
  userPushDevices,
  users,
} from "./tbm-app.ts";

async function pushToAdmins(sessionId: string, title: string, body: string): Promise<void> {
  try {
    const devices = await db
      .select({ userId: userPushDevices.userId, subscription: userPushDevices.subscription })
      .from(userPushDevices)
      .innerJoin(users, eq(users.id, userPushDevices.userId))
      .where(and(eq(users.role, "admin"), eq(userPushDevices.isActive, true)));
    const now = new Date().toISOString();
    await Promise.all(devices.map(async (device) => {
      try {
        await sendWebPushNotification(device.subscription as any, {
          id: `zaina-${sessionId}-${now}`,
          userId: device.userId,
          type: "assignment-created",
          title,
          body: body.slice(0, 120),
          actionUrl: "/admin/zaina",
          priority: "high",
          channels: ["push"],
          deliveryState: {},
          metadata: { sessionId },
          isRead: false,
          readAt: null,
          createdAt: now,
          updatedAt: now,
        } as any);
      } catch (error) {
        console.error(`[tbm-connector] push failed for admin ${device.userId}:`, error);
      }
    }));
  } catch (error) {
    console.error("[tbm-connector] push fan-out failed:", error);
  }
}

export async function notifyTbmTeam(_business: Business, event: TeamEvent): Promise<void> {
  try {
    switch (event.kind) {
      case "conversation-started":
        await sendZainaConversationStartedEmail({
          sessionId: event.sessionId,
          firstMessage: event.firstMessage,
          timestamp: new Date().toISOString(),
        });
        return;
      case "handoff":
        await sendOpsAlertEmail({
          kind: "handoff-requested",
          sessionId: event.sessionId,
          summary: `Handoff requested: ${event.reason}`,
          details: { Reason: event.reason },
        });
        await pushToAdmins(event.sessionId, "Zaina handoff — customer waiting", event.reason);
        return;
      case "callback": {
        const why = event.why === "offline" ? "Team offline" : "Nobody claimed the chat in time";
        await sendOpsAlertEmail({
          kind: "handoff-requested",
          sessionId: event.sessionId,
          summary: `Call the customer back — ${why.toLowerCase()}: ${event.reason}`,
          details: {
            Reason: event.reason,
            Why: why,
            "Team back at": event.staffBackAt ? event.staffBackAt.toISOString() : null,
          },
        });
        await pushToAdmins(event.sessionId, "Zaina — callback requested", `${why}: ${event.reason}`);
        return;
      }
      case "system-error":
        await sendOpsAlertEmail({
          kind: "system-error",
          sessionId: event.sessionId,
          summary: event.summary,
          details: event.details,
        });
        return;
      case "spend-cap":
        await sendOpsAlertEmail({
          kind: "system-error",
          sessionId: "-",
          summary: `Zaina reached today's model budget (${event.usedTokens.toLocaleString("en-US")} of ${event.capTokens.toLocaleString("en-US")} tokens). Customers get the contact line until tomorrow.`,
          details: { Day: event.day },
        });
        return;
    }
  } catch (error) {
    console.error(`[tbm-connector] ${event.kind} alert failed:`, error);
  }
}
