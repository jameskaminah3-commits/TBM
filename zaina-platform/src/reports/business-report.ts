// zaina-platform/src/reports/business-report.ts
//
// A business's report for a period (Phase 3, "basic reports"): what the
// Productisation Plan asks every business to see.
//
//   chats                  conversations started, by channel (website, WhatsApp)
//   resolved without staff chats that never needed the team
//   handoffs               chats handed to the team, callbacks, and how quickly
//                          the team picked them up (the plan's target: 90%
//                          claimed within 15 minutes during staffed hours)
//   Zaina                  replies, how long they took, turns that failed
//   outcomes               bookings, custom offers, verifications and leads made
//                          in chat, with the deposits and totals asked for
//   stays                  for a place to stay (Phase 4): bookings made and where
//                          they stand, nights sold, the value booked, deposits
//                          collected (by how they were paid), chats that led to one
//   unanswered questions   what customers asked that the knowledge didn't answer
//   cost                   model tokens and their estimated cost
//   daily                  chats, handoffs and bookings per day (business time)
//
// Everything runs inside the business's scope, and names the business too.

import { CALLBACK_OFFLINE_NOTE, CALLBACK_UNCLAIMED_NOTE } from "../conversations/handoff.ts";
import { inBusiness } from "../db/tenant.ts";
import { estimateCostUsd, type ModelPrices } from "../engine/telemetry.ts";

/** The system notes a callback leaves in a chat. */
const CALLBACK_NOTES = [CALLBACK_OFFLINE_NOTE, CALLBACK_UNCLAIMED_NOTE];

const BOOKING_TOOLS = ["create_draft_booking", "create_service_booking", "create_booking", "create_appointment"];
const PAYABLE_TOOLS = [...BOOKING_TOOLS, "create_custom_offer", "create_listing_verification_request"];

export type MoneyTotal = { currency: "KES" | "USD"; amount: number };

export type StaysReport = {
  /** Bookings made in the period, by Zaina and by the team. */
  bookings: number;
  fromChat: number;
  confirmed: number;
  /** Still waiting for a deposit or the team's answer. */
  waiting: number;
  /** Declined, cancelled, or their hold ended unpaid. */
  lost: number;
  conflicts: number;
  nightsSold: number;
  booked: MoneyTotal[];
  depositsCollected: MoneyTotal[];
  collectedBy: Array<{ method: string; currency: "KES" | "USD"; amount: number; payments: number }>;
  /** Chats in the period that led to a booking. */
  chatToBooking: number | null;
};

export type BusinessReport = {
  from: string;
  to: string;
  days: number;
  timeZone: string;
  chats: { total: number; web: number; whatsapp: number };
  customerMessages: number;
  resolvedWithoutStaff: { chats: number; share: number | null };
  handoffs: {
    total: number;
    /** Handed to the team while staffed (the rest went straight to a callback). */
    reachedTeam: number;
    callbacks: number;
    claimed: number;
    claimedWithin15Minutes: number;
    shareClaimedWithin15Minutes: number | null;
    medianMinutesToClaim: number | null;
    medianMinutesToFirstReply: number | null;
  };
  zaina: { replies: number; medianSeconds: number | null; p95Seconds: number | null; failedTurns: number };
  outcomes: {
    bookings: number;
    customOffers: number;
    verifications: number;
    leads: number;
    bookingTotals: MoneyTotal[];
    depositsRequested: MoneyTotal[];
    feesRequested: MoneyTotal[];
  };
  stays: StaysReport | null;
  unanswered: { total: number; top: Array<{ question: string; times: number }> };
  cost: { inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number | null; perChatUsd: number | null };
  daily: Array<{ day: string; chats: number; handoffs: number; bookings: number }>;
};

/** "KSh 24,000" → 24000 KES; "$186.50" or "US$ 186.50" → 186.5 USD; anything else → null. */
export function parseDisplayAmount(display: unknown): MoneyTotal | null {
  if (typeof display !== "string") return null;
  const kes = /(?:KSh|KES|Ksh)\.?\s*([\d,]+(?:\.\d+)?)/.exec(display);
  if (kes) return { currency: "KES", amount: Number(kes[1].replace(/,/g, "")) };
  const usd = /(?:US\$|USD|\$)\s*([\d,]+(?:\.\d+)?)/.exec(display);
  if (usd) return { currency: "USD", amount: Number(usd[1].replace(/,/g, "")) };
  return null;
}

function addTo(totals: Map<string, number>, money: MoneyTotal | null) {
  if (!money || !Number.isFinite(money.amount)) return;
  totals.set(money.currency, (totals.get(money.currency) ?? 0) + money.amount);
}

const asTotals = (totals: Map<string, number>): MoneyTotal[] =>
  [...totals.entries()].map(([currency, amount]) => ({ currency: currency as MoneyTotal["currency"], amount: Math.round(amount * 100) / 100 }));

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);
const numberOrNull = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10);

export async function businessReport(
  businessId: string,
  input: { days: number; timeZone: string; now?: Date; prices: ModelPrices | null; stays?: boolean },
): Promise<BusinessReport> {
  const now = input.now ?? new Date();
  const days = Math.min(90, Math.max(1, Math.round(input.days)));
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const range = [businessId, from, now];

  return inBusiness(async (_db, client) => {
    const { rows: chatRows } = await client.query<{ channel: string; chats: number; resolved: number }>(
      `select s.channel, count(*)::int as chats, count(*) filter (where s.first_handoff_at is null)::int as resolved
       from chat_sessions as s
       where s.business_id = $1 and s.created_at >= $2 and s.created_at < $3 and not s.preview
         and exists (select 1 from chat_events as e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER')
       group by s.channel`,
      range,
    );
    const chatsBy = (channel: string) => chatRows.find((row) => row.channel === channel)?.chats ?? 0;
    const totalChats = chatRows.reduce((sum, row) => sum + row.chats, 0);
    const resolved = chatRows.reduce((sum, row) => sum + row.resolved, 0);

    const { rows: [messages] } = await client.query<{ count: number }>(
      `select count(*)::int as count from chat_events as e where e.business_id = $1 and e.actor = 'USER' and e.created_at >= $2 and e.created_at < $3
         and not exists (select 1 from chat_sessions as p where p.business_id = e.business_id and p.id = e.session_id and p.preview)`,
      range,
    );

    const { rows: [handoffs] } = await client.query<{
      total: number; claimed: number; within15: number; waited: number; median_claim: string | null; median_reply: string | null;
    }>(
      `select count(*)::int as total,
              count(*) filter (where s.handoff_at is not null)::int as waited,
              count(*) filter (where s.claimed_at is not null and s.handoff_at is not null and s.claimed_at >= s.handoff_at)::int as claimed,
              count(*) filter (where s.claimed_at is not null and s.handoff_at is not null and s.claimed_at >= s.handoff_at
                               and s.claimed_at - s.handoff_at <= interval '15 minutes')::int as within15,
              percentile_cont(0.5) within group (order by extract(epoch from s.claimed_at - s.handoff_at) / 60)
                filter (where s.claimed_at is not null and s.handoff_at is not null and s.claimed_at >= s.handoff_at) as median_claim,
              percentile_cont(0.5) within group (order by extract(epoch from reply.at - s.handoff_at) / 60)
                filter (where reply.at is not null) as median_reply
       from chat_sessions as s
       left join lateral (
         select min(e.created_at) as at from chat_events as e
         where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'AGENT' and e.created_at >= s.handoff_at
       ) as reply on s.handoff_at is not null
       where s.business_id = $1 and s.first_handoff_at >= $2 and s.first_handoff_at < $3 and not s.preview`,
      range,
    );

    const { rows: [callbacks] } = await client.query<{ count: number }>(
      `select count(*)::int as count from chat_events
       where business_id = $1 and actor = 'SYSTEM' and created_at >= $2 and created_at < $3
         and (content like $4 || '%' or content like $5 || '%')`,
      [...range, CALLBACK_NOTES[0], CALLBACK_NOTES[1]],
    );

    const { rows: [turns] } = await client.query<{
      replies: number; failed: number; p50: string | null; p95: string | null;
      input_tokens: string; output_tokens: string; cached_tokens: string;
    }>(
      `select count(*) filter (where outcome in ('answered', 'tool_reply', 'handoff', 'callback', 'mpesa_recorded', 'spend_capped'))::int as replies,
              count(*) filter (where outcome in ('timeout', 'model_error', 'error'))::int as failed,
              percentile_cont(0.5) within group (order by duration_ms) filter (where outcome in ('answered', 'tool_reply', 'handoff', 'callback')) as p50,
              percentile_cont(0.95) within group (order by duration_ms) filter (where outcome in ('answered', 'tool_reply', 'handoff', 'callback')) as p95,
              coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens,
              coalesce(sum(cached_tokens), 0) as cached_tokens
       from turn_metrics where business_id = $1 and started_at >= $2 and started_at < $3`,
      range,
    );

    // Payable items made in chat, each counted once (a repeated call returns the same booking).
    const { rows: payable } = await client.query<{ tool_name: string; response: any }>(
      `select distinct on (tool_name, coalesce(tool_response->>'booking_id', id::text)) tool_name, tool_response as response
       from chat_events as e
       where business_id = $1 and actor = 'SYSTEM_TOOL' and created_at >= $2 and created_at < $3
         and tool_name = any($4::text[]) and (tool_response->>'ok')::boolean is true
         and not exists (select 1 from chat_sessions as p where p.business_id = e.business_id and p.id = e.session_id and p.preview)
       order by tool_name, coalesce(tool_response->>'booking_id', id::text), id`,
      [...range, PAYABLE_TOOLS],
    );
    const bookingTotals = new Map<string, number>();
    const deposits = new Map<string, number>();
    const fees = new Map<string, number>();
    for (const row of payable) {
      if (BOOKING_TOOLS.includes(row.tool_name)) {
        addTo(bookingTotals, parseDisplayAmount(row.response?.total ?? row.response?.total_display));
        addTo(deposits, parseDisplayAmount(row.response?.deposit_display));
      } else {
        addTo(fees, parseDisplayAmount(row.response?.fee_display));
      }
    }
    const count = (names: string[]) => payable.filter((row) => names.includes(row.tool_name)).length;

    const { rows: [leadCount] } = await client.query<{ count: number }>(
      "select count(*)::int as count from leads where business_id = $1 and created_at >= $2 and created_at < $3",
      range,
    );

    const { rows: misses } = await client.query<{ question: string; times: number }>(
      `select min(query) as question, count(*)::int as times from knowledge_misses
       where business_id = $1 and created_at >= $2 and created_at < $3
       group by lower(btrim(query)) order by count(*) desc, min(query) limit 10`,
      range,
    );
    const { rows: [missCount] } = await client.query<{ count: number }>(
      "select count(*)::int as count from knowledge_misses where business_id = $1 and created_at >= $2 and created_at < $3",
      range,
    );

    const { rows: daily } = await client.query<{ day: string; chats: number; handoffs: number; bookings: number }>(
      `with days as (
         select to_char(d, 'YYYY-MM-DD') as day
         from generate_series(date_trunc('day', $2::timestamptz at time zone $3) - make_interval(days => $4::int - 1),
                              date_trunc('day', $2::timestamptz at time zone $3), interval '1 day') as d
       )
       select days.day,
         (select count(*)::int from chat_sessions as s
          where s.business_id = $1 and not s.preview and to_char(s.created_at at time zone $3, 'YYYY-MM-DD') = days.day
            and exists (select 1 from chat_events as e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER')) as chats,
         (select count(*)::int from chat_sessions as s
          where s.business_id = $1 and not s.preview and to_char(s.first_handoff_at at time zone $3, 'YYYY-MM-DD') = days.day) as handoffs,
         (select count(distinct coalesce(e.tool_response->>'booking_id', e.id::text))::int from chat_events as e
          where e.business_id = $1 and e.actor = 'SYSTEM_TOOL' and e.tool_name = any($5::text[])
            and (e.tool_response->>'ok')::boolean is true and not exists (select 1 from chat_sessions as p where p.business_id = e.business_id and p.id = e.session_id and p.preview)
            and to_char(e.created_at at time zone $3, 'YYYY-MM-DD') = days.day) as bookings
       from days order by days.day`,
      [businessId, now, input.timeZone, days, BOOKING_TOOLS],
    );

    let stays: StaysReport | null = null;
    if (input.stays) {
      const { rows: [made] } = await client.query<{
        bookings: number; from_chat: number; confirmed: number; waiting: number; lost: number; conflicts: number; nights: number; chats: number;
      }>(
        `select count(*)::int as bookings,
                count(*) filter (where source = 'chat')::int as from_chat,
                count(*) filter (where status = 'confirmed')::int as confirmed,
                count(*) filter (where status in ('held', 'requested', 'awaiting_payment'))::int as waiting,
                count(*) filter (where status in ('declined', 'cancelled', 'expired'))::int as lost,
                count(*) filter (where status = 'conflict')::int as conflicts,
                coalesce(sum((check_out - check_in) * units) filter (where status = 'confirmed'), 0)::int as nights,
                count(distinct session_id) filter (where source = 'chat')::int as chats
         from bookings where business_id = $1 and created_at >= $2 and created_at < $3`,
        range,
      );
      const { rows: booked } = await client.query<{ currency: "KES" | "USD"; total: string }>(
        `select currency, sum(total_minor) as total from bookings
         where business_id = $1 and created_at >= $2 and created_at < $3 and status = 'confirmed' group by currency order by currency`,
        range,
      );
      const { rows: collected } = await client.query<{ method: string; currency: "KES" | "USD"; total: string; payments: number }>(
        `select method, currency, sum(amount_minor) as total, count(*)::int as payments from payments
         where business_id = $1 and status = 'succeeded' and settled_at >= $2 and settled_at < $3
         group by method, currency order by method, currency`,
        range,
      );
      const byCurrency = new Map<string, number>();
      for (const row of collected) byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + Number(row.total) / 100);
      stays = {
        bookings: made.bookings,
        fromChat: made.from_chat,
        confirmed: made.confirmed,
        waiting: made.waiting,
        lost: made.lost,
        conflicts: made.conflicts,
        nightsSold: made.nights,
        booked: booked.map((row) => ({ currency: row.currency, amount: Number(row.total) / 100 })),
        depositsCollected: asTotals(byCurrency),
        collectedBy: collected.map((row) => ({ method: row.method, currency: row.currency, amount: Number(row.total) / 100, payments: row.payments })),
        chatToBooking: share(made.chats, totalChats),
      };
    }

    const inputTokens = Number(turns.input_tokens);
    const outputTokens = Number(turns.output_tokens);
    const costUsd = estimateCostUsd({ inputTokens, outputTokens }, input.prices);
    return {
      from: from.toISOString(),
      to: now.toISOString(),
      days,
      timeZone: input.timeZone,
      chats: { total: totalChats, web: chatsBy("web"), whatsapp: chatsBy("whatsapp") },
      customerMessages: messages.count,
      resolvedWithoutStaff: { chats: resolved, share: share(resolved, totalChats) },
      handoffs: {
        total: handoffs.total,
        reachedTeam: handoffs.waited,
        callbacks: callbacks.count,
        claimed: handoffs.claimed,
        claimedWithin15Minutes: handoffs.within15,
        shareClaimedWithin15Minutes: share(handoffs.within15, handoffs.waited),
        medianMinutesToClaim: numberOrNull(handoffs.median_claim),
        medianMinutesToFirstReply: numberOrNull(handoffs.median_reply),
      },
      zaina: {
        replies: turns.replies,
        medianSeconds: turns.p50 === null ? null : Math.round(Number(turns.p50) / 100) / 10,
        p95Seconds: turns.p95 === null ? null : Math.round(Number(turns.p95) / 100) / 10,
        failedTurns: turns.failed,
      },
      outcomes: {
        bookings: count(BOOKING_TOOLS),
        customOffers: count(["create_custom_offer"]),
        verifications: count(["create_listing_verification_request"]),
        leads: leadCount.count,
        bookingTotals: asTotals(bookingTotals),
        depositsRequested: asTotals(deposits),
        feesRequested: asTotals(fees),
      },
      stays,
      unanswered: { total: missCount.count, top: misses },
      cost: {
        inputTokens,
        outputTokens,
        cachedTokens: Number(turns.cached_tokens),
        costUsd: costUsd === null ? null : Math.round(costUsd * 10000) / 10000,
        perChatUsd: costUsd !== null && totalChats ? Math.round((costUsd / totalChats) * 10000) / 10000 : null,
      },
      daily,
    };
  }, businessId);
}
