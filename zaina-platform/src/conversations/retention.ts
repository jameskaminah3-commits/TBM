// zaina-platform/src/conversations/retention.ts
//
// How long conversations are kept (I17). Each business sets a retention
// period; conversations untouched for longer are deleted with everything in
// them. A customer can also ask for their data to be deleted: every
// conversation where they typed their email or phone number goes, with any
// lead they left. Telemetry keeps no message text and stays, unlinked from
// the deleted chat. Everything runs inside one business's scope, and names
// the business too: row-level security is the second guard, not the only one.

import { sql } from "drizzle-orm";
import { allBusinesses } from "../businesses/registry.ts";
import { currentBusinessId, inBusiness, runForBusiness } from "../db/tenant.ts";

export async function deleteExpiredConversations(now: Date = new Date()): Promise<number> {
  let deleted = 0;
  for (const business of await allBusinesses()) {
    if (!business.retentionDays) continue;
    const cutoff = new Date(now.getTime() - business.retentionDays * 24 * 60 * 60 * 1000);
    try {
      deleted += await runForBusiness(business.id, () => inBusiness(async (db) => {
        const result = await db.execute(sql`delete from chat_sessions where business_id = ${business.id} and last_activity_at < ${cutoff}`);
        return result.rowCount ?? 0;
      }));
    } catch (error) {
      console.error(`[retention] ${business.id} failed:`, error);
    }
  }
  return deleted;
}

export async function deleteConversation(sessionId: string): Promise<boolean> {
  const businessId = currentBusinessId();
  return inBusiness(async (db) => {
    const result = await db.execute(sql`delete from chat_sessions where business_id = ${businessId} and id::text = ${sessionId}`);
    return (result.rowCount ?? 0) > 0;
  }, businessId);
}

/** The last nine digits of a phone number: "0712 345 678" and "+254 712 345 678" match. */
export function phoneKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : null;
}

/** Deletes the customer's conversations and leads, found by the email or phone they typed. */
export async function eraseCustomer(contact: { email?: string; phone?: string }): Promise<{ conversations: number; leads: number }> {
  const email = contact.email?.trim().toLowerCase() || null;
  const phone = contact.phone ? phoneKey(contact.phone) : null;
  if (!email && !phone) return { conversations: 0, leads: 0 };
  const businessId = currentBusinessId();
  return inBusiness(async (db) => {
    const conversations = await db.execute(sql`
      delete from chat_sessions as s
      where s.business_id = ${businessId} and exists (
        select 1 from chat_events as e
        where e.session_id = s.id
          and e.actor = 'USER'
          and (
            (${email}::text is not null and position(${email}::text in lower(e.content)) > 0)
            or (${phone}::text is not null and position(${phone}::text in regexp_replace(e.content, '\\D', '', 'g')) > 0)
          )
      )
    `);
    const leadRows = await db.execute(sql`
      delete from leads
      where business_id = ${businessId} and (
        (${email}::text is not null and lower(email) = ${email}::text)
        or (${phone}::text is not null and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = ${phone}::text)
      )
    `);
    return { conversations: conversations.rowCount ?? 0, leads: leadRows.rowCount ?? 0 };
  }, businessId);
}
