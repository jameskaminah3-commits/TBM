// zaina-platform/src/channels/whatsapp/worker.ts
//
// The WhatsApp channel's safety net, every few seconds, business by business
// (only businesses with a connected number):
//   - messages left waiting (a restart between accepting and answering) are answered;
//   - answers that stopped halfway (an instance died mid-turn) are tried again,
//     at most three times;
//   - replies not yet delivered (Meta was busy, a team reply, a handoff timing
//     out) are delivered.

import { allBusinesses } from "../../businesses/registry.ts";
import { inBusiness, runForBusiness } from "../../db/tenant.ts";
import type { WhatsappContext } from "./context.ts";
import { chatsWithUndelivered, deliverSession } from "./delivery.ts";
import { isScheduled, scheduleAnswer } from "./inbound.ts";
import { getNumber } from "./numbers.ts";

export async function sweepWhatsapp(ctx: WhatsappContext): Promise<void> {
  for (const business of await allBusinesses()) {
    try {
      await runForBusiness(business.id, async () => {
        const number = await getNumber(business.id);
        if (!number || number.status !== "active") return;

        const waiting = await inBusiness(async (_db, client) => {
          await client.query(
            `update whatsapp_inbound set status = case when attempts >= 3 then 'failed' else 'pending' end
             where business_id = $1 and status = 'processing' and received_at < now() - interval '3 minutes'`,
            [business.id],
          );
          return (await client.query<{ session_id: string }>(
            `select distinct session_id from whatsapp_inbound
             where business_id = $1 and status = 'pending' and received_at < now() - make_interval(secs => $2)`,
            [business.id, (ctx.whatsapp.batchMs + 2_000) / 1000],
          )).rows.map((row) => row.session_id);
        }, business.id);
        for (const sessionId of waiting) {
          if (!isScheduled(sessionId)) scheduleAnswer(ctx, { businessId: business.id, sessionId }, 0);
        }

        for (const sessionId of await chatsWithUndelivered(business.id, Boolean(number.followupTemplate))) {
          if (isScheduled(sessionId)) continue;
          await deliverSession(ctx, business.id, sessionId);
        }
      });
    } catch (error) {
      console.error(`[whatsapp] sweeping ${business.id} failed:`, error);
    }
  }
}
