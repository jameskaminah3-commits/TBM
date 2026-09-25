// zaina-platform/src/gateway/spend-cap.ts
//
// Daily model spend per business (C6). Every turn adds the tokens it used to
// the business's day (in the business's own time zone). Once a business has
// used its daily cap, Zaina stops calling the model for it until tomorrow and
// answers with the business's contact details instead; the team is alerted
// once that day.

import type pg from "pg";

/** The calendar day in a time zone, "YYYY-MM-DD". */
export function businessDay(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type DailyUsage = { inputTokens: number; outputTokens: number; turns: number };

export async function usageOn(pool: pg.Pool, businessId: string, day: string): Promise<DailyUsage> {
  const { rows } = await pool.query<{ input_tokens: string; output_tokens: string; turns: number }>(
    "select input_tokens, output_tokens, turns from usage_daily where business_id = $1 and day = $2",
    [businessId, day],
  );
  const row = rows[0];
  return row
    ? { inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), turns: row.turns }
    : { inputTokens: 0, outputTokens: 0, turns: 0 };
}

/** Whether the business has already used its cap for the day. */
export function isOverCap(usage: DailyUsage, dailyTokenCap: number | null): boolean {
  return dailyTokenCap !== null && usage.inputTokens + usage.outputTokens >= dailyTokenCap;
}

export async function recordUsage(
  pool: pg.Pool,
  businessId: string,
  day: string,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  await pool.query(
    `insert into usage_daily (business_id, day, input_tokens, output_tokens, turns) values ($1, $2, $3, $4, 1)
     on conflict (business_id, day) do update set
       input_tokens = usage_daily.input_tokens + excluded.input_tokens,
       output_tokens = usage_daily.output_tokens + excluded.output_tokens,
       turns = usage_daily.turns + 1`,
    [businessId, day, Math.max(0, Math.round(usage.inputTokens)), Math.max(0, Math.round(usage.outputTokens))],
  );
}

/** True for the first caller each day, so the team is alerted once. */
export async function claimCapAlert(pool: pg.Pool, businessId: string, day: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `update usage_daily set cap_alert_sent_at = now()
     where business_id = $1 and day = $2 and cap_alert_sent_at is null`,
    [businessId, day],
  );
  return (rowCount ?? 0) > 0;
}
