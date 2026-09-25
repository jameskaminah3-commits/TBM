// zaina-platform/src/conversations/routing.ts
//
// Who a waiting chat goes to first. Among the business's people who said
// they are available (and were seen recently), the one with the fewest chats
// in hand gets it; ties go to whoever was offered a chat longest ago. They
// are alerted alone; if nobody claims the chat within a few minutes, everyone
// is. Anyone can claim a waiting chat at any time: routing only decides who
// hears first.

import type { Business } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";

export type RoutedTo = { userId: string; name: string };

/** Offers a waiting chat to one available person, or returns null when nobody is available. */
export async function routeHandoff(business: Business, sessionId: string, now: Date, availabilityHours: number): Promise<RoutedTo | null> {
  const seenSince = new Date(now.getTime() - availabilityHours * 60 * 60_000);
  return inBusiness(async (_db, client) => {
    const { rows: [pick] } = await client.query<{ user_id: string; name: string }>(
      `select m.user_id, u.name
       from staff_memberships as m
       join staff_users as u on u.id = m.user_id and u.disabled_at is null
       join staff_presence as p on p.business_id = m.business_id and p.user_id = m.user_id
       where m.business_id = $1
         and m.role in ('agent', 'manager', 'owner')
         and p.available and p.last_seen_at > $2
       order by (
         select count(*) from chat_sessions as s
         where s.business_id = $1 and s.managed_by = 'HUMAN' and s.id <> $3
           and (s.claimed_by = m.user_id or (s.routed_to = m.user_id and s.assigned_agent_id is null))
       ) asc, p.last_routed_at asc nulls first, u.name asc
       limit 1`,
      [business.id, seenSince, sessionId],
    );
    if (!pick) return null;
    await client.query(
      "update chat_sessions set routed_to = $3, routed_at = $4, team_alerted_at = null where business_id = $1 and id = $2",
      [business.id, sessionId, pick.user_id, now],
    );
    await client.query("update staff_presence set last_routed_at = $3 where business_id = $1 and user_id = $2", [business.id, pick.user_id, now]);
    return { userId: pick.user_id, name: pick.name };
  }, business.id);
}

/**
 * Waiting chats offered to one person who hasn't claimed them in time: marked
 * as alerted to everyone, and returned so the caller alerts them.
 */
export async function chatsToEscalate(business: Business, now: Date, afterMinutes: number): Promise<Array<{ id: string; reason: string; routedTo: string | null }>> {
  const cutoff = new Date(now.getTime() - afterMinutes * 60_000);
  return inBusiness(async (_db, client) => {
    const { rows } = await client.query<{ id: string; handoff_reason: string | null; routed_to: string | null }>(
      `update chat_sessions set team_alerted_at = $2
       where business_id = $1 and managed_by = 'HUMAN' and assigned_agent_id is null
         and routed_to is not null and team_alerted_at is null and routed_at < $3
       returning id, handoff_reason, routed_to`,
      [business.id, now, cutoff],
    );
    return rows.map((row) => ({ id: row.id, reason: row.handoff_reason ?? "Handoff", routedTo: row.routed_to }));
  }, business.id);
}

/** Records whether a person is taking chats, and that they were just seen. */
export async function setPresence(businessId: string, userId: string, available: boolean | null, now: Date = new Date()): Promise<{ available: boolean }> {
  return inBusiness(async (_db, client) => {
    const { rows: [row] } = await client.query<{ available: boolean }>(
      `insert into staff_presence (business_id, user_id, available, last_seen_at) values ($1, $2, coalesce($3, false), $4)
       on conflict (business_id, user_id) do update set
         available = coalesce($3, staff_presence.available), last_seen_at = excluded.last_seen_at
       returning available`,
      [businessId, userId, available, now],
    );
    return { available: row.available };
  }, businessId);
}

/** Who is taking chats now, for the console. */
export async function availablePeople(businessId: string, availabilityHours: number, now: Date = new Date()): Promise<Array<{ userId: string; name: string; available: boolean; lastSeenAt: Date }>> {
  const seenSince = new Date(now.getTime() - availabilityHours * 60 * 60_000);
  return inBusiness(async (_db, client) => {
    const { rows } = await client.query<{ user_id: string; name: string; available: boolean; last_seen_at: Date }>(
      `select p.user_id, u.name, p.available and p.last_seen_at > $2 as available, p.last_seen_at
       from staff_presence as p join staff_users as u on u.id = p.user_id
       where p.business_id = $1 order by u.name`,
      [businessId, seenSince],
    );
    return rows.map((row) => ({ userId: row.user_id, name: row.name, available: row.available, lastSeenAt: row.last_seen_at }));
  }, businessId);
}
