// zaina-platform/src/engine/agent.ts
//
// One chat turn: the customer's message in, Zaina's reply out. Ported from
// the TBM app's router.ts (handleZainaMessage), with the Phase 0 hardening:
//
//   I3   one turn at a time per conversation (turn-lock.ts)
//   I4   a time budget for the whole turn (turn-budget.ts)
//   C4b  a failed turn asks the customer to try again; only several failures
//        in a row hand the conversation to the team (failure-policy.ts)
//   C4c  handoffs respect staffed hours (conversations/handoff.ts)
//   C5   an M-Pesa code sent in chat is recorded against the booking
//   C6   a business over its daily model budget gets its contact line
//   I15  telemetry for every turn (telemetry.ts)
//
// The engine knows nothing about any one business: the business's connector
// supplies its instructions, tools and team alerts.
//
// GEMINI 3.X NOTE: the API attaches a thoughtSignature to every functionCall
// part and rejects a follow-up that omits it, so the model's raw content is
// pushed back verbatim rather than rebuilt from the functionCalls accessor.

import type { Content, GoogleGenAI } from "@google/genai";
import { eq } from "drizzle-orm";
import { connectorFor } from "../connectors/registry.ts";
import type { BusinessConnector } from "../connectors/types.ts";
import { platformDb, platformPool } from "../db/platform-db.ts";
import { chatSessions, type Business } from "../db/schema.ts";
import { requestHandoff } from "../conversations/handoff.ts";
import {
  appendEvent,
  getSession,
  hasCustomerMessages,
  recentHistory,
  recentZainaReplies,
} from "../conversations/store.ts";
import { businessDay, claimCapAlert, isOverCap, recordUsage, usageOn } from "../gateway/spend-cap.ts";
import { afterFailedTurn, RETRY_LATER_REPLY, TIMEOUT_REPLY } from "./failure-policy.ts";
import { withServerIdempotencyKey } from "./idempotency.ts";
import { findMpesaCodes, mentionsPayment } from "./mpesa-codes.ts";
import { redactCardNumbers } from "./redaction.ts";
import {
  appendMissingCustomerLink,
  collectCustomerLinks,
  composeCustomerReply,
  formatToolHistoryEntry,
  neutralizeToolMarkers,
  paymentDetailsFromToolResult,
  paymentRecoveryMessage,
  redactMediaUrls,
  redactMediaUrlsDeep,
  replaceMediaUrls,
  sanitizeModelText,
  type CustomerLink,
  type PaymentDetails,
} from "./reply-policy.ts";
import { recordTurn, TurnRecorder, usageFromResponse, type ModelPrices, type TurnOutcome } from "./telemetry.ts";
import { textArg } from "./tool-args.ts";
import { acquireTurnLock, BUSY_REPLY, releaseTurnLock } from "./turn-lock.ts";
import { createTurnBudget, isBudgetError, TurnTimeoutError, type TurnBudget } from "./turn-budget.ts";

const HISTORY_TURNS = 20;
const MAX_TOOL_ROUNDS = 6;
const MAX_ATTEMPTS = 3;
/** A model call isn't started with less time than this left in the turn. */
const MIN_MODEL_CALL_MS = 3_000;
/** The session lease outlives the turn budget by this much, for tools and replies. */
const LOCK_GRACE_MS = 20_000;

export type EngineOptions = {
  ai: GoogleGenAI;
  model: string;
  turnBudgetMs: number;
  prices: ModelPrices | null;
};

export type ChatReply =
  | { status: "ok"; reply: string; escalated?: boolean }
  | { status: "human_managed" }
  | { status: "busy"; reply: string }
  | { status: "error"; error: string; message: string };

type TurnResult = { reply: ChatReply; outcome: TurnOutcome; error?: unknown };

function queue(label: string, task: Promise<unknown>) {
  task.catch((error) => console.error(`[engine] ${label} failed:`, error));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The HTTP status in a model SDK error; its shape varies by error type. */
function statusOf(error: any): number | undefined {
  const status = error?.status ?? error?.code ?? error?.error?.code ?? error?.response?.status;
  return typeof status === "number" ? status : undefined;
}

// Personal details are masked in stored tool calls; the links the next turn
// must be able to reuse are kept.
function maskPII(value: any): any {
  if (!value || typeof value !== "object") return value;
  const out: any = Array.isArray(value) ? [...value] : { ...value };
  for (const key of Object.keys(out)) {
    if ((key === "public_url" || key === "payment_link") && typeof out[key] === "string") continue;
    if (/phone|email|card|token|secret|link|key/i.test(key) && typeof out[key] === "string") {
      out[key] = "***masked***";
    } else if (typeof out[key] === "object") {
      out[key] = maskPII(out[key]);
    }
  }
  return out;
}

/**
 * Handles one customer message. Never throws: whatever happens, the customer
 * gets a reply and the turn is measured.
 */
export async function handleChatTurn(input: {
  business: Business;
  sessionId: string;
  message: string;
  options: EngineOptions;
}): Promise<ChatReply> {
  const recorder = new TurnRecorder();
  let result: TurnResult;
  let contactLine = "";
  try {
    const connector = await connectorFor(input.business.id);
    contactLine = connector.contactLine(input.business);
    result = await runTurn(input, connector, recorder);
  } catch (error) {
    console.error("[engine] turn failed:", error);
    result = {
      reply: {
        status: "error",
        error: "routing_failure",
        message: `Something went wrong on my side. Please try again${contactLine ? `, or reach us: ${contactLine}` : ""}.`,
      },
      outcome: "error",
      error,
    };
  }

  const metrics = recorder.finish(result.outcome, result.error);
  try {
    await recordTurn(platformPool(), input.business.id, input.sessionId, metrics);
    if (metrics.inputTokens > 0 || metrics.outputTokens > 0) {
      await recordUsage(platformPool(), input.business.id, businessDay(input.business.timeZone), metrics);
    }
  } catch (error) {
    console.error("[engine] recording telemetry failed:", error);
  }
  return result.reply;
}

async function runTurn(
  input: { business: Business; sessionId: string; message: string; options: EngineOptions },
  connector: BusinessConnector,
  recorder: TurnRecorder,
): Promise<TurnResult> {
  const { business, sessionId, message } = input;
  const session = await getSession(sessionId);
  if (!session || session.businessId !== business.id) {
    return { reply: { status: "error", error: "session_not_found", message: "Session not found." }, outcome: "error" };
  }

  // Staff are handling the chat: keep the message for them; Zaina stays quiet.
  if (session.managedBy !== "AI") {
    await appendEvent({ businessId: business.id, sessionId, actor: "USER", content: message });
    return { reply: { status: "human_managed" }, outcome: "human_managed" };
  }

  const lockId = await acquireTurnLock(platformPool(), sessionId, input.options.turnBudgetMs + LOCK_GRACE_MS);
  if (!lockId) return { reply: { status: "busy", reply: BUSY_REPLY }, outcome: "busy" };
  try {
    return await runLockedTurn(input, connector, recorder, session.consecutiveFailures);
  } finally {
    await releaseTurnLock(platformPool(), sessionId, lockId).catch((error) => {
      console.error("[engine] releasing the turn lock failed:", error);
    });
  }
}

async function runLockedTurn(
  input: { business: Business; sessionId: string; message: string; options: EngineOptions },
  connector: BusinessConnector,
  recorder: TurnRecorder,
  consecutiveFailures: number,
): Promise<TurnResult> {
  const { business, sessionId, message, options } = input;
  const say = async (text: string) => {
    await appendEvent({ businessId: business.id, sessionId, actor: "ZAINA_REASONING", content: text });
  };

  const isFirstMessage = !(await hasCustomerMessages(sessionId));
  await appendEvent({ businessId: business.id, sessionId, actor: "USER", content: message });
  if (isFirstMessage) {
    queue("conversation-started alert", connector.notifyTeam(business, {
      kind: "conversation-started",
      sessionId,
      firstMessage: redactCardNumbers(message),
    }));
  }

  // C5: an M-Pesa code for this chat's booking is recorded, not just read.
  const paymentReply = await recordPaymentCode(business, connector, sessionId, message);
  if (paymentReply) {
    await say(paymentReply);
    return { reply: { status: "ok", reply: paymentReply }, outcome: "mpesa_recorded" };
  }

  // C6: once the business's model budget for the day is used, no model calls.
  const day = businessDay(business.timeZone);
  const usage = await usageOn(platformPool(), business.id, day);
  if (isOverCap(usage, business.dailyTokenCap)) {
    if (await claimCapAlert(platformPool(), business.id, day)) {
      queue("spend-cap alert", connector.notifyTeam(business, {
        kind: "spend-cap",
        day,
        usedTokens: usage.inputTokens + usage.outputTokens,
        capTokens: business.dailyTokenCap ?? 0,
      }));
    }
    const reply = `I can't reply to messages here right now, but our team can help: ${connector.contactLine(business)}.`;
    await say(reply);
    return { reply: { status: "ok", reply }, outcome: "spend_capped" };
  }

  // History for the model. The current message is already logged above.
  const historyRows = await recentHistory(sessionId, HISTORY_TURNS * 3);
  const contents: Content[] = historyRows.flatMap((row): Content[] => {
    if (row.actor === "USER" && row.content) {
      return [{ role: "user", parts: [{ text: neutralizeToolMarkers(redactMediaUrls(row.content)) }] }];
    }
    if (row.actor === "ZAINA_REASONING" && row.content) {
      return [{ role: "model", parts: [{ text: redactMediaUrls(row.content) }] }];
    }
    if (row.actor === "SYSTEM_TOOL" && row.toolName) {
      const argsText = row.toolArguments ? redactMediaUrls(JSON.stringify(row.toolArguments)) : "{}";
      const resultText = row.toolResponse ? redactMediaUrls(JSON.stringify(row.toolResponse)) : "null";
      const trimmed = resultText.length > 1500 ? `${resultText.slice(0, 1500)}…[truncated]` : resultText;
      return [{ role: "user", parts: [{ text: formatToolHistoryEntry(row.toolName, argsText, trimmed) }] }];
    }
    return [];
  });
  // Links and phone numbers the customer supplied may be echoed back to them.
  const customerTexts = historyRows
    .filter((row) => row.actor === "USER" && typeof row.content === "string")
    .map((row) => row.content as string);
  const customerLinks: CustomerLink[] = [];
  const turnCustomerLinks: CustomerLink[] = [];
  for (const row of historyRows) collectCustomerLinks(row.toolResponse, customerLinks);

  // Anything payable created (or replayed) in this turn. The server, not the
  // model, writes its payment link and "what happens next" steps.
  const turnPayments: PaymentDetails[] = [];
  const budget = createTurnBudget(options.turnBudgetMs);
  const systemInstruction = connector.systemPrompt(business);
  const tools = [{ functionDeclarations: connector.toolDeclarations() }];

  let finalText: string | null = null;
  // True when the reply is a fixed message written by a tool (tell_customer):
  // the model-output filters must not rewrite it.
  let finalTextIsServerWritten = false;
  let escalated = false;
  let callbackRequested = false;
  // Only real tool failures trigger the automatic handoff; business outcomes
  // (a stay just got booked) are answered by searching again.
  let sawFailedWrite = false;

  const callModel = (withTools: boolean) => generate(options, budget, recorder, {
    contents,
    config: withTools ? { systemInstruction, tools } : { systemInstruction },
  });

  const escalate = async (args: any) => {
    const reason = textArg(args?.reason) || "The customer asked for a person.";
    const handoff = await requestHandoff(business, sessionId, reason);
    if (handoff.status === "callback") {
      callbackRequested = true;
      return { ok: true, status: "callback_requested", tell_customer: handoff.tellCustomer };
    }
    return { ok: true, status: handoff.status };
  };

  const runToolCall = async (part: any): Promise<{ call: any; toolResponseData: any }> => {
    const call = part.functionCall;
    const startedAt = Date.now();
    try {
      // create_* tools get a server-derived idempotency key; any key the model
      // sends (for example one copied from masked history) is ignored.
      const toolArgs = withServerIdempotencyKey(call.name, call.args, sessionId);
      const toolResponseData = call.name === "escalate_to_human"
        ? await escalate(toolArgs)
        : await connector.executeTool(call.name, toolArgs, { business, sessionId });
      recorder.addTool(call.name, Date.now() - startedAt);
      return { call, toolResponseData };
    } catch (error) {
      recorder.addTool(call.name, Date.now() - startedAt);
      console.error(`[engine] tool ${call.name} failed:`, error);
      return {
        call,
        toolResponseData: {
          ok: false,
          error: "tool_execution_failed",
          message: "Do not invent a result. Apologize and offer human handoff.",
        },
      };
    }
  };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      // The last round has no tools: the model must answer in text.
      const response: any = await callModel(round < MAX_TOOL_ROUNDS - 1);
      const modelContent = response.candidates?.[0]?.content;
      const functionCallParts = (modelContent?.parts ?? []).filter((part: any) => part.functionCall);
      if (functionCallParts.length === 0) {
        finalText = replaceMediaUrls(response.text ?? "", customerLinks.at(-1)?.url);
        break;
      }
      contents.push(modelContent);

      const canRunInParallel = functionCallParts.length > 1
        && functionCallParts.every((part: any) => connector.readOnlyTools.has(part.functionCall?.name));
      const toolResults = canRunInParallel
        ? await Promise.all(functionCallParts.map(runToolCall))
        : await (async () => {
            const results: Array<{ call: any; toolResponseData: any }> = [];
            for (const part of functionCallParts) {
              const result = await runToolCall(part);
              results.push(result);
              if (typeof result.toolResponseData?.tell_customer === "string" && result.toolResponseData.tell_customer.trim()) break;
            }
            return results;
          })();

      const toolParts: any[] = [];
      for (const { call, toolResponseData } of toolResults) {
        collectCustomerLinks(toolResponseData, customerLinks);
        collectCustomerLinks(toolResponseData, turnCustomerLinks);
        const payment = paymentDetailsFromToolResult(call.name, toolResponseData);
        if (payment) turnPayments.push(payment);

        // Every tool result is kept: the next turn reuses listing and payment
        // links without searching again.
        await appendEvent({
          businessId: business.id,
          sessionId,
          actor: "SYSTEM_TOOL",
          toolName: call.name,
          toolArguments: maskPII(call.args),
          toolResponse: redactMediaUrlsDeep(maskPII(toolResponseData)),
        });

        if (
          call.name.startsWith("create_")
          && toolResponseData?.ok === false
          && (toolResponseData?.needs_human === true || toolResponseData?.error === "tool_execution_failed")
        ) {
          sawFailedWrite = true;
        }
        if (call.name === "escalate_to_human" && toolResponseData?.status === "escalated") escalated = true;

        // A tool's fixed reply ("what's your email?") ends the turn as is.
        if (typeof toolResponseData?.tell_customer === "string" && toolResponseData.tell_customer.trim()) {
          finalText = toolResponseData.tell_customer;
          finalTextIsServerWritten = true;
          break;
        }
        toolParts.push({ functionResponse: { name: call.name, response: { result: redactMediaUrlsDeep(toolResponseData) } } });
      }
      if (finalText !== null) break;
      contents.push({ role: "user", parts: toolParts });
    }

    if (finalText === null) {
      finalText = "Karibu! I'm having a little trouble pulling up the right options right now. "
        + "Let me connect you with someone from our team who can help directly — they'll reach out shortly.";
    }
    finalText = replaceMediaUrls(finalText, customerLinks.at(-1)?.url);
    if (!finalTextIsServerWritten) finalText = sanitizeModelText(finalText, { customerTexts });
    finalText = composeCustomerReply(finalText, turnPayments);
    const linkContext = /listing|property|photos?|view|see|pay|booking/i.test(message) ? customerLinks : turnCustomerLinks;
    finalText = appendMissingCustomerLink(finalText, linkContext);

    // A booking attempt that failed and ended with "let me connect you" gets a
    // real handoff, so the promise lands.
    if (sawFailedWrite && !escalated && !callbackRequested) {
      const handoff = await requestHandoff(business, sessionId, "Booking flow failed after tool errors — auto-escalated.");
      if (handoff.status === "callback") {
        callbackRequested = true;
        finalText = `${finalText}\n\n${handoff.tellCustomer}`;
      } else {
        escalated = true;
      }
    }

    await say(finalText);
    if (consecutiveFailures > 0) {
      await platformDb().update(chatSessions).set({ consecutiveFailures: 0 }).where(eq(chatSessions.id, sessionId));
    }
    const outcome: TurnOutcome = escalated ? "handoff" : callbackRequested ? "callback" : finalTextIsServerWritten ? "tool_reply" : "answered";
    return { reply: { status: "ok", reply: finalText, escalated: escalated || undefined }, outcome };
  } catch (error) {
    return await failedTurn({ business, sessionId, connector, error, consecutiveFailures, turnPayments, say });
  }
}

/** One model call, retried on busy signals while the turn has time for it. */
async function generate(
  options: EngineOptions,
  budget: TurnBudget,
  recorder: TurnRecorder,
  request: { contents: Content[]; config: Record<string, unknown> },
): Promise<any> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (!budget.hasAtLeast(MIN_MODEL_CALL_MS)) throw new TurnTimeoutError();
    const startedAt = Date.now();
    try {
      const response = await options.ai.models.generateContent({
        model: options.model,
        contents: request.contents,
        config: { ...request.config, abortSignal: budget.signal() },
      });
      recorder.addModelCall(Date.now() - startedAt, usageFromResponse(response));
      return response;
    } catch (error) {
      recorder.addModelCall(Date.now() - startedAt);
      if (isBudgetError(error) || budget.expired()) throw new TurnTimeoutError();
      const status = statusOf(error);
      const transient = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      // Back off 1 s, then 2 s: long enough to ride out a spike, short enough
      // that the customer barely notices.
      const delayMs = 1000 * 2 ** attempt;
      if (!transient || attempt === MAX_ATTEMPTS - 1 || !budget.hasAtLeast(delayMs + MIN_MODEL_CALL_MS)) throw error;
      console.warn(`[engine] model busy (status ${status}), retrying in ${delayMs}ms`);
      recorder.addRetry();
      lastError = error;
      await sleep(delayMs);
    }
  }
  throw lastError ?? new Error("Model call failed after retries");
}

/**
 * A turn that failed (C4b): the customer is asked to try again, and anything
 * payable already created still reaches them. Only several failed turns in a
 * row hand the conversation to the team.
 */
async function failedTurn(args: {
  business: Business;
  sessionId: string;
  connector: BusinessConnector;
  error: unknown;
  consecutiveFailures: number;
  turnPayments: PaymentDetails[];
  say: (text: string) => Promise<void>;
}): Promise<TurnResult> {
  const { business, sessionId, connector, error } = args;
  const timedOut = error instanceof TurnTimeoutError || isBudgetError(error);
  const outcome: TurnOutcome = timedOut ? "timeout" : "model_error";
  if (!timedOut) console.error("[engine] model failed:", error);

  const decision = afterFailedTurn(args.consecutiveFailures);
  let text = timedOut ? TIMEOUT_REPLY : RETRY_LATER_REPLY;
  let escalated = false;
  try {
    await platformDb().update(chatSessions).set({ consecutiveFailures: decision.failures }).where(eq(chatSessions.id, sessionId));
    if (decision.handOff) {
      const reason = `Zaina failed ${decision.failures} turns in a row (${(error as Error)?.message ?? error}).`;
      queue("system-error alert", connector.notifyTeam(business, {
        kind: "system-error",
        sessionId,
        summary: `Zaina system error: ${(error as Error)?.message ?? error}`,
        details: { "Failed turns in a row": decision.failures },
      }));
      const handoff = await requestHandoff(business, sessionId, reason);
      escalated = handoff.status !== "callback";
      text = handoff.status === "callback"
        ? handoff.tellCustomer
        : "I'm having trouble on my side, so I've asked someone from our team to take over — they'll reply here shortly.";
    }
  } catch (handoffError) {
    console.error("[engine] handling a failed turn failed:", handoffError);
  }

  // A booking, request or verification created before the failure must still
  // reach the customer, or they never see its payment link.
  if (args.turnPayments.length > 0) {
    text = decision.handOff ? `${paymentRecoveryMessage(args.turnPayments)}\n\n${text}` : paymentRecoveryMessage(args.turnPayments);
  }
  try {
    await args.say(text);
  } catch (logError) {
    console.error("[engine] saving the failure reply failed:", logError);
  }
  return { reply: { status: "ok", reply: text, escalated: escalated || undefined }, outcome, error };
}

/**
 * C5: when the customer sends an M-Pesa code for this chat's booking, record
 * it and confirm. Returns the reply, or null to let Zaina answer as usual (no
 * code, no booking in this chat, or the booking is already paid).
 */
async function recordPaymentCode(
  business: Business,
  connector: BusinessConnector,
  sessionId: string,
  message: string,
): Promise<string | null> {
  if (!connector.recordChatPayment) return null;
  const codes = findMpesaCodes(message);
  if (codes.length !== 1) return null;
  const aboutPayment = mentionsPayment(message)
    || (await recentZainaReplies(sessionId, 3)).some((reply) => /m-?pesa/i.test(reply));
  if (!aboutPayment) return null;

  const code = codes[0];
  // A code already used for another conversation's booking isn't recorded
  // twice: the team checks it.
  const { rows: [claim] } = await platformPool().query<{ session_id: string | null; booking_ref: string }>(
    "select session_id, booking_ref from payment_claims where business_id = $1 and code = $2",
    [business.id, code],
  );
  if (claim && claim.session_id !== sessionId) {
    queue("reused-code alert", connector.notifyTeam(business, {
      kind: "system-error",
      sessionId,
      summary: `M-Pesa code ${code} was sent again for a different booking`,
      details: { Code: code, "First used for booking": claim.booking_ref },
    }));
    return `That M-Pesa code has already been used for another booking, so I've asked the team to check it. If you sent a new payment, please share its code.`;
  }

  const result = await connector.recordChatPayment(business, { sessionId, code });
  if (!result.ok) {
    if (result.reason !== "failed") return null;
    queue("payment-code alert", connector.notifyTeam(business, {
      kind: "system-error",
      sessionId,
      summary: `Couldn't record M-Pesa code ${code} sent in the chat`,
      details: { Code: code, Error: result.detail ?? "" },
    }));
    return `Thanks — I couldn't match code ${code} to your booking automatically, so I've passed it to the team to check. They'll confirm by email.`;
  }
  if (result.alreadyRecorded) {
    return `I already have M-Pesa code ${code} for booking ${result.bookingRef} — the team is checking it and will confirm by email.`;
  }
  await platformPool().query(
    `insert into payment_claims (business_id, session_id, booking_ref, code, expected_amount, note)
     values ($1, $2, $3, $4, $5, $6) on conflict (business_id, code) do nothing`,
    [business.id, sessionId, result.bookingRef, code, result.expectedAmount, result.conflict],
  );
  const dates = result.conflict
    ? " One thing: another guest paid for those dates in the meantime, so the team will contact you to move your booking or refund you."
    : result.datesHeld
      ? " Your dates are held while they check."
      : "";
  return `Thanks! I've passed M-Pesa code ${code} to our team to match with booking ${result.bookingRef} (${result.expectedAmount}). You'll get a confirmation by email once it's verified.${dates}`;
}
