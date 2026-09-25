// zaina-platform/src/conversations/retention.ts
//
// How long conversations are kept (I17). Each business sets a retention
// period; conversations untouched for longer are deleted with everything in
// them. A customer can also ask for their conversations to be deleted: every
// conversation where they typed their email or phone number goes.
// Telemetry keeps no message text and stays, unlinked from the deleted chat.

import { sql } from "drizzle-orm";
import { platformDb } from "../db/platform-db.ts";

export async function deleteExpiredConversations(now: Date = new Date()): Promise<number> {
  const result = await platformDb().execute(sql`
    delete from chat_sessions as s
    using businesses as b
    where s.business_id = b.id
      and b.retention_days is not null
      and s.last_activity_at < ${now}::timestamptz - make_interval(days => b.retention_days)
  `);
  return result.rowCount ?? 0;
}

export async function deleteConversation(businessId: string, sessionId: string): Promise<boolean> {
  const result = await platformDb().execute(sql`
    delete from chat_sessions where business_id = ${businessId} and id::text = ${sessionId}
  `);
  return (result.rowCount ?? 0) > 0;
}

/** The last nine digits of a phone number: "0712 345 678" and "+254 712 345 678" match. */
export function phoneKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : null;
}

/** Deletes every conversation in which the customer typed this email or phone number. */
export async function eraseCustomer(businessId: string, contact: { email?: string; phone?: string }): Promise<number> {
  const email = contact.email?.trim().toLowerCase() || null;
  const phone = contact.phone ? phoneKey(contact.phone) : null;
  if (!email && !phone) return 0;
  const result = await platformDb().execute(sql`
    delete from chat_sessions as s
    where s.business_id = ${businessId}
      and exists (
        select 1 from chat_events as e
        where e.session_id = s.id
          and e.actor = 'USER'
          and (
            (${email}::text is not null and position(${email}::text in lower(e.content)) > 0)
            or (${phone}::text is not null and position(${phone}::text in regexp_replace(e.content, '\\D', '', 'g')) > 0)
          )
      )
  `);
  return result.rowCount ?? 0;
}
