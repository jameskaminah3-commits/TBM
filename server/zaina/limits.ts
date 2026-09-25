// server/zaina/limits.ts
//
// Cost protection for Zaina's public chat (C6). Anyone can open a chat
// without signing in, so:
//   - opening chats and sending messages are counted in Postgres, per visitor
//     and for the whole site, so every server instance shares the counts and
//     a restart doesn't reset them;
//   - Zaina's model use is added up per Kenya day against a daily budget.
// A failure in any of this lets the message through and is logged: a
// problem with the limits must never take Zaina down.

import { createHmac } from "node:crypto";
import type { Request } from "express";
import { pool } from "../db";

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const ZAINA_LIMITS = {
  sessionsPerVisitorPerHour: envInt("ZAINA_LIMIT_SESSIONS_PER_VISITOR_PER_HOUR", 60),
  messagesPerSessionPerMinute: envInt("ZAINA_LIMIT_MESSAGES_PER_SESSION_PER_MINUTE", 20),
  messagesPerVisitorPer10Minutes: envInt("ZAINA_LIMIT_MESSAGES_PER_VISITOR_PER_10_MINUTES", 120),
  messagesPerHour: envInt("ZAINA_LIMIT_MESSAGES_PER_HOUR", 3000),
  /** Model tokens (input + output) Zaina may use per Kenya day. */
  dailyTokenBudget: envInt("ZAINA_DAILY_TOKEN_BUDGET", 30_000_000),
};

export type LimitRule = { key: string; limit: number; windowSeconds: number };
export type LimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * The visitor's address, as a keyed hash (the address itself isn't stored).
 * Railway's proxy sends the client's address in X-Real-IP; req.ip is the
 * fallback. Mobile networks put many customers behind one address, so the
 * per-visitor limits are generous; the site-wide ones are the hard stop.
 */
export function visitorKey(req: Pick<Request, "ip" | "header">): string {
  const address = (req.header("x-real-ip")?.split(",")[0] ?? req.ip ?? "").trim().replace(/^::ffff:/, "") || "unknown";
  return createHmac("sha256", process.env.SESSION_SECRET || "zaina-visitor").update(`visitor:${address}`).digest("hex").slice(0, 32);
}

/** Counts one hit against every rule; refused when any is over its limit. Fails open. */
export async function consumeLimits(rules: LimitRule[], now: Date = new Date()): Promise<LimitResult> {
  if (rules.length === 0) return { allowed: true };
  try {
    const { rows } = await pool.query<{ key: string; window_start: Date; count: number }>(
      `insert into zaina_rate_limits (key, window_start, count)
       select rule.key, to_timestamp(floor(extract(epoch from $3::timestamptz) / rule.seconds) * rule.seconds), 1
       from unnest($1::text[], $2::int[]) as rule(key, seconds)
       on conflict (key, window_start) do update set count = zaina_rate_limits.count + 1
       returning key, window_start, count`,
      [rules.map((rule) => rule.key), rules.map((rule) => rule.windowSeconds), now.toISOString()],
    );
    for (const rule of rules) {
      const row = rows.find((candidate) => candidate.key === rule.key);
      if (row && row.count > rule.limit) {
        const windowEnds = new Date(row.window_start).getTime() + rule.windowSeconds * 1000;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowEnds - now.getTime()) / 1000)) };
      }
    }
    return { allowed: true };
  } catch (error) {
    console.error("[zaina] rate limit check failed; allowing the request:", (error as Error).message);
    return { allowed: true };
  }
}

const pruneTimer = setInterval(() => {
  pool.query("delete from zaina_rate_limits where window_start < now() - interval '1 day'")
    .catch((error) => console.error("[zaina] pruning rate limit counters failed:", (error as Error).message));
}, 60 * 60 * 1000);
if (typeof (pruneTimer as any).unref === "function") (pruneTimer as any).unref();

/** Today's date in Kenya, "YYYY-MM-DD". */
export function kenyaDay(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}

/** Whether today's model budget is used up. Fails open (false). */
export async function isOverDailyBudget(day: string = kenyaDay()): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ used: string }>(
      "select input_tokens + output_tokens as used from zaina_usage_daily where day = $1",
      [day],
    );
    return rows.length > 0 && Number(rows[0].used) >= ZAINA_LIMITS.dailyTokenBudget;
  } catch (error) {
    console.error("[zaina] daily budget check failed; allowing the request:", (error as Error).message);
    return false;
  }
}

/** Adds one turn's model use to the day. Never throws. */
export async function recordDailyUsage(day: string, inputTokens: number, outputTokens: number): Promise<void> {
  try {
    await pool.query(
      `insert into zaina_usage_daily (day, input_tokens, output_tokens, turns) values ($1, $2, $3, 1)
       on conflict (day) do update set
         input_tokens = zaina_usage_daily.input_tokens + excluded.input_tokens,
         output_tokens = zaina_usage_daily.output_tokens + excluded.output_tokens,
         turns = zaina_usage_daily.turns + 1`,
      [day, Math.max(0, Math.round(inputTokens)), Math.max(0, Math.round(outputTokens))],
    );
  } catch (error) {
    console.error("[zaina] recording model use failed:", (error as Error).message);
  }
}

/** True once per day, for the first caller: the team is alerted once. */
export async function claimDailyBudgetAlert(day: string): Promise<boolean> {
  try {
    const { rowCount } = await pool.query(
      "update zaina_usage_daily set budget_alert_sent_at = now() where day = $1 and budget_alert_sent_at is null",
      [day],
    );
    return (rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Token counts in a Gemini response (missing counts are 0). */
export function responseTokens(response: unknown): { input: number; output: number } {
  const usage = (response as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata ?? {};
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return {
    input: count(usage.promptTokenCount),
    output: count(usage.candidatesTokenCount) + count(usage.thoughtsTokenCount),
  };
}
