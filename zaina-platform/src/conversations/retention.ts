// zaina-platform/src/conversations/retention.ts
//
// How long conversations are kept (I17). Each business sets a retention
// period; conversations untouched for longer are deleted with everything in
// them. A customer can also ask for their data to be deleted: every
// conversation where they typed their email or phone number, or wrote from
// that number on WhatsApp, goes, with any lead they left. Telemetry keeps no
// message text and stays, unlinked from the deleted chat. Everything runs
// inside one business's scope, and names the business too: row-level
// security is the second guard, not the only one.

import { sql } from "drizzle-orm";
import { everyBusiness } from "../businesses/registry.ts";
import { currentBusinessId, inBusiness, runForBusiness } from "../db/tenant.ts";

export async function deleteExpiredConversations(now: Date = new Date()): Promise<number> {
  let deleted = 0;
  for (const business of await everyBusiness()) {
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

/**
 * Deletes the customer's conversations and leads, found by the email or phone
 * they typed. Their bookings are the business's records of money and nights,
 * so those stay, without the customer's name, email, phone and notes.
 */
export async function eraseCustomer(contact: { email?: string; phone?: string }): Promise<{ conversations: number; leads: number; bookings: number }> {
  const email = contact.email?.trim().toLowerCase() || null;
  const phone = contact.phone ? phoneKey(contact.phone) : null;
  if (!email && !phone) return { conversations: 0, leads: 0, bookings: 0 };
  const businessId = currentBusinessId();
  return inBusiness(async (db) => {
    // A WhatsApp customer is found by the number they write from, too.
    const conversations = await db.execute(sql`
      delete from chat_sessions as s
      where s.business_id = ${businessId} and (
        exists (
          select 1 from chat_events as e
          where e.session_id = s.id
            and e.actor = 'USER'
            and (
              (${email}::text is not null and position(${email}::text in lower(e.content)) > 0)
              or (${phone}::text is not null and position(${phone}::text in regexp_replace(e.content, '\\D', '', 'g')) > 0)
            )
        )
        or (${phone}::text is not null and s.channel = 'whatsapp' and right(s.customer_address, 9) = ${phone}::text)
      )
    `);
    const leadRows = await db.execute(sql`
      delete from leads
      where business_id = ${businessId} and (
        (${email}::text is not null and lower(email) = ${email}::text)
        or (${phone}::text is not null and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = ${phone}::text)
      )
    `);
    const theirs = sql`business_id = ${businessId} and (
        (${email}::text is not null and lower(customer_email) = ${email}::text)
        or (${phone}::text is not null and right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 9) = ${phone}::text)
      )`;
    await db.execute(sql`
      update payments set payer_phone = null, payer_email = null
      where business_id = ${businessId} and booking_id in (select id from bookings where ${theirs})
    `);
    const bookingRows = await db.execute(sql`
      update bookings set customer_name = 'Erased on request', customer_email = null, customer_phone = null, customer_notes = null, updated_at = now()
      where ${theirs}
    `);
    return { conversations: conversations.rowCount ?? 0, leads: leadRows.rowCount ?? 0, bookings: bookingRows.rowCount ?? 0 };
  }, businessId);
}
