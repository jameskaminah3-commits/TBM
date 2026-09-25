// zaina-platform/src/engine/telemetry.ts
//
// Per-turn telemetry (I15): how long each turn took, how many model calls and
// tokens it used, which tools ran and how it ended. No message text is kept
// here. The summary gives cost per conversation, the number that decides
// pricing for other businesses.

import { inBusiness } from "../db/tenant.ts";

export type TurnOutcome =
  | "answered"          // the model replied
  | "tool_reply"        // a tool's fixed reply (a question for the customer)
  | "handoff"           // handed to the team
  | "callback"          // team offline or no one claimed: callback requested
  | "human_managed"     // staff are handling the chat; Zaina stayed quiet
  | "busy"              // another turn was still running (I3)
  | "rate_limited"      // refused by a rate limit (C6)
  | "spend_capped"      // the business's daily model budget is used up (C6)
  | "timeout"           // the turn ran out of time (I4)
  | "model_error"       // the model failed; the customer was asked to retry (C4b)
  | "mpesa_recorded"    // an M-Pesa code was recorded against a booking (C5)
  | "error";            // anything else

export type TokenUsage = { inputTokens: number; outputTokens: number; cachedTokens: number };

/** Token counts from a Gemini response (missing counts are 0). */
export function usageFromResponse(response: unknown): TokenUsage {
  const usage = (response as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata ?? {};
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return {
    inputTokens: count(usage.promptTokenCount),
    outputTokens: count(usage.candidatesTokenCount) + count(usage.thoughtsTokenCount),
    cachedTokens: count(usage.cachedContentTokenCount),
  };
}

export type TurnMetrics = TokenUsage & {
  startedAt: Date;
  durationMs: number;
  modelMs: number;
  toolMs: number;
  modelCalls: number;
  modelRetries: number;
  tools: string[];
  outcome: TurnOutcome;
  error: string | null;
};

export class TurnRecorder {
  private readonly started = Date.now();
  readonly startedAt = new Date(this.started);
  modelMs = 0;
  toolMs = 0;
  modelCalls = 0;
  modelRetries = 0;
  inputTokens = 0;
  outputTokens = 0;
  cachedTokens = 0;
  readonly tools: string[] = [];

  addModelCall(durationMs: number, usage?: TokenUsage) {
    this.modelCalls += 1;
    this.modelMs += Math.max(0, Math.round(durationMs));
    if (usage) {
      this.inputTokens += usage.inputTokens;
      this.outputTokens += usage.outputTokens;
      this.cachedTokens += usage.cachedTokens;
    }
  }

  addRetry() {
    this.modelRetries += 1;
  }

  addTool(name: string, durationMs: number) {
    this.tools.push(name);
    this.toolMs += Math.max(0, Math.round(durationMs));
  }

  finish(outcome: TurnOutcome, error?: unknown): TurnMetrics {
    return {
      startedAt: this.startedAt,
      durationMs: Date.now() - this.started,
      modelMs: this.modelMs,
      toolMs: this.toolMs,
      modelCalls: this.modelCalls,
      modelRetries: this.modelRetries,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cachedTokens: this.cachedTokens,
      tools: [...this.tools],
      outcome,
      error: error === undefined || error === null ? null : String((error as Error)?.message ?? error).slice(0, 500),
    };
  }
}

export type ModelPrices = { input: number; output: number };

/** US dollars for the tokens, at prices per million tokens. */
export function estimateCostUsd(usage: { inputTokens: number; outputTokens: number }, prices: ModelPrices | null): number | null {
  if (!prices) return null;
  return (usage.inputTokens * prices.input + usage.outputTokens * prices.output) / 1_000_000;
}

export async function recordTurn(businessId: string, sessionId: string | null, metrics: TurnMetrics): Promise<void> {
  await inBusiness((_db, client) => client.query(
    `insert into turn_metrics (business_id, session_id, started_at, duration_ms, model_ms, tool_ms, model_calls,
       model_retries, input_tokens, output_tokens, cached_tokens, tools, outcome, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      businessId, sessionId, metrics.startedAt, metrics.durationMs, metrics.modelMs, metrics.toolMs, metrics.modelCalls,
      metrics.modelRetries, metrics.inputTokens, metrics.outputTokens, metrics.cachedTokens, metrics.tools, metrics.outcome,
      metrics.error,
    ],
  ), businessId);
}

export type TurnSummary = {
  businessId: string;
  from: string;
  to: string;
  conversations: number;
  turns: number;
  outcomes: Record<string, number>;
  latencyMs: { average: number; p50: number; p95: number };
  perTurn: { modelCalls: number; inputTokens: number; outputTokens: number };
  perConversation: { turns: number; inputTokens: number; outputTokens: number; costUsd: number | null };
  totalCostUsd: number | null;
};

export async function summarizeTurns(
  businessId: string,
  range: { from: Date; to: Date },
  prices: ModelPrices | null,
): Promise<TurnSummary> {
  return inBusiness((_db, client) => summarize(client, businessId, range, prices), businessId);
}

async function summarize(
  pool: { query: import("pg").PoolClient["query"] },
  businessId: string,
  range: { from: Date; to: Date },
  prices: ModelPrices | null,
): Promise<TurnSummary> {
  const { rows: [totals] } = await pool.query<{
    conversations: string; turns: string; model_calls: string; input_tokens: string; output_tokens: string;
    average_ms: string | null; p50_ms: string | null; p95_ms: string | null;
  }>(
    `select count(distinct session_id) as conversations, count(*) as turns,
            coalesce(sum(model_calls), 0) as model_calls,
            coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens,
            avg(duration_ms) as average_ms,
            percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
            percentile_cont(0.95) within group (order by duration_ms) as p95_ms
     from turn_metrics where business_id = $1 and started_at >= $2 and started_at < $3`,
    [businessId, range.from, range.to],
  );
  const { rows: outcomeRows } = await pool.query<{ outcome: string; turns: string }>(
    `select outcome, count(*) as turns from turn_metrics
     where business_id = $1 and started_at >= $2 and started_at < $3 group by outcome order by outcome`,
    [businessId, range.from, range.to],
  );

  const conversations = Number(totals.conversations);
  const turns = Number(totals.turns);
  const inputTokens = Number(totals.input_tokens);
  const outputTokens = Number(totals.output_tokens);
  const perTurn = (value: number) => (turns ? Math.round((value / turns) * 10) / 10 : 0);
  const perConversation = (value: number) => (conversations ? Math.round((value / conversations) * 10) / 10 : 0);
  const totalCostUsd = estimateCostUsd({ inputTokens, outputTokens }, prices);

  return {
    businessId,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    conversations,
    turns,
    outcomes: Object.fromEntries(outcomeRows.map((row) => [row.outcome, Number(row.turns)])),
    latencyMs: {
      average: Math.round(Number(totals.average_ms ?? 0)),
      p50: Math.round(Number(totals.p50_ms ?? 0)),
      p95: Math.round(Number(totals.p95_ms ?? 0)),
    },
    perTurn: { modelCalls: perTurn(Number(totals.model_calls)), inputTokens: perTurn(inputTokens), outputTokens: perTurn(outputTokens) },
    perConversation: {
      turns: perConversation(turns),
      inputTokens: perConversation(inputTokens),
      outputTokens: perConversation(outputTokens),
      costUsd: totalCostUsd !== null && conversations ? totalCostUsd / conversations : null,
    },
    totalCostUsd,
  };
}
