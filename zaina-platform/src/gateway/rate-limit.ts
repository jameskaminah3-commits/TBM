// zaina-platform/src/gateway/rate-limit.ts
//
// Shared rate limits (C6). Counters live in Postgres, so every instance of
// the service sees the same numbers and a restart doesn't reset them. Each
// rule is a fixed window: at most `limit` hits per `windowSeconds`.

import type pg from "pg";

export type LimitRule = { key: string; limit: number; windowSeconds: number };

export type LimitResult =
  | { allowed: true }
  | { allowed: false; rule: LimitRule; retryAfterSeconds: number };

/**
 * Counts one hit against every rule and says whether all of them still allow
 * it. Refused hits count too, so a flood stays refused until its window ends.
 */
export async function consumeLimits(pool: pg.Pool, rules: LimitRule[], now: Date = new Date()): Promise<LimitResult> {
  if (rules.length === 0) return { allowed: true };
  const { rows } = await pool.query<{ key: string; window_start: Date; count: number }>(
    `insert into rate_limit_counters (key, window_start, count)
     select rule.key, to_timestamp(floor(extract(epoch from $3::timestamptz) / rule.seconds) * rule.seconds), 1
     from unnest($1::text[], $2::int[]) as rule(key, seconds)
     on conflict (key, window_start) do update set count = rate_limit_counters.count + 1
     returning key, window_start, count`,
    [rules.map((rule) => rule.key), rules.map((rule) => rule.windowSeconds), now.toISOString()],
  );

  for (const rule of rules) {
    const row = rows.find((candidate) => candidate.key === rule.key);
    if (row && row.count > rule.limit) {
      const windowEnds = new Date(row.window_start).getTime() + rule.windowSeconds * 1000;
      return { allowed: false, rule, retryAfterSeconds: Math.max(1, Math.ceil((windowEnds - now.getTime()) / 1000)) };
    }
  }
  return { allowed: true };
}

/** Drops counters from windows that ended more than a day ago. */
export async function pruneRateLimitCounters(pool: pg.Pool, now: Date = new Date()): Promise<number> {
  const result = await pool.query("delete from rate_limit_counters where window_start < $1::timestamptz - interval '1 day'", [now.toISOString()]);
  return result.rowCount ?? 0;
}
