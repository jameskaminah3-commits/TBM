import assert from "node:assert/strict";
import test from "node:test";
import { afterFailedTurn, FAILURES_BEFORE_HANDOFF } from "../../src/engine/failure-policy.ts";
import { findMpesaCodes, mentionsPayment } from "../../src/engine/mpesa-codes.ts";
import { CARD_NUMBER_PLACEHOLDER, redactCardNumbers } from "../../src/engine/redaction.ts";
import { estimateCostUsd, TurnRecorder, usageFromResponse } from "../../src/engine/telemetry.ts";
import { createTurnBudget, isBudgetError, TurnTimeoutError } from "../../src/engine/turn-budget.ts";

test("the turn budget counts down and signals when it runs out", async () => {
  let now = 1_000;
  const budget = createTurnBudget(25_000, () => now);
  assert.equal(budget.remainingMs(), 25_000);
  assert.equal(budget.hasAtLeast(3_000), true);
  now += 23_000;
  assert.equal(budget.hasAtLeast(3_000), false);
  assert.equal(budget.expired(), false);
  now += 5_000;
  assert.equal(budget.expired(), true);
  assert.equal(budget.remainingMs(), 0);

  const real = createTurnBudget(20);
  const signal = real.signal();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(signal.aborted, true);
  assert.equal(isBudgetError(signal.reason), true);
  assert.equal(isBudgetError(new TurnTimeoutError()), true);
  assert.equal(isBudgetError(new Error("503 Service Unavailable")), false);
});

test("one failed turn asks the customer to retry; several in a row hand over", () => {
  assert.equal(FAILURES_BEFORE_HANDOFF, 3);
  assert.deepEqual(afterFailedTurn(0), { failures: 1, handOff: false });
  assert.deepEqual(afterFailedTurn(1), { failures: 2, handOff: false });
  assert.deepEqual(afterFailedTurn(2), { failures: 3, handOff: true });
});

test("M-Pesa codes are spotted in what customers actually type", () => {
  assert.deepEqual(findMpesaCodes("Done, code is QGH7X8Y9Z1"), ["QGH7X8Y9Z1"]);
  assert.deepEqual(findMpesaCodes("sent! tjk12ab3cd"), ["TJK12AB3CD"]);
  assert.deepEqual(findMpesaCodes("SGR4H7K2LM Confirmed. Ksh2,500.00 sent to ..."), ["SGR4H7K2LM"]);
  assert.deepEqual(findMpesaCodes("(QGH7X8Y9Z1)."), ["QGH7X8Y9Z1"]);
});

test("things that look a bit like codes are not codes", () => {
  assert.deepEqual(findMpesaCodes("my number is 0712345678"), []);
  assert.deepEqual(findMpesaCodes("email john123456@example.com"), []);
  assert.deepEqual(findMpesaCodes("see https://site.example/AB12CD34EF"), []);
  assert.deepEqual(findMpesaCodes("booking EAE050B0 please"), []);
  assert.deepEqual(findMpesaCodes("PAYMENTNOW is a word"), []);
  assert.deepEqual(findMpesaCodes("reference 1234567ABC starts with a digit"), []);
  assert.deepEqual(findMpesaCodes("MOMBASA2026X is eleven characters"), []);
});

test("a payment message is recognised by its words", () => {
  assert.equal(mentionsPayment("I've sent the mpesa"), true);
  assert.equal(mentionsPayment("M-Pesa code QGH7X8Y9Z1"), true);
  assert.equal(mentionsPayment("paid"), true);
  assert.equal(mentionsPayment("Do you have a villa in Diani?"), false);
});

test("card numbers are removed before a message is stored", () => {
  assert.equal(redactCardNumbers("my card is 4111 1111 1111 1111 exp 12/29"), `my card is ${CARD_NUMBER_PLACEHOLDER} exp 12/29`);
  assert.equal(redactCardNumbers("4242-4242-4242-4242"), CARD_NUMBER_PLACEHOLDER);
  // Not Luhn-valid, a phone number, an amount, an M-Pesa code: all kept.
  assert.equal(redactCardNumbers("ref 1234 5678 9012 3456"), "ref 1234 5678 9012 3456");
  assert.equal(redactCardNumbers("call +254 712 345 678"), "call +254 712 345 678");
  assert.equal(redactCardNumbers("budget KSh 120,000"), "budget KSh 120,000");
  assert.equal(redactCardNumbers("code QGH7X8Y9Z1"), "code QGH7X8Y9Z1");
});

test("telemetry adds up a turn's model calls, tokens and tools", () => {
  const recorder = new TurnRecorder();
  recorder.addModelCall(820, usageFromResponse({ usageMetadata: { promptTokenCount: 18_500, candidatesTokenCount: 60, thoughtsTokenCount: 40 } }));
  recorder.addRetry();
  recorder.addModelCall(600, usageFromResponse({ usageMetadata: { promptTokenCount: 19_000, candidatesTokenCount: 90, cachedContentTokenCount: 12_000 } }));
  recorder.addModelCall(100);
  recorder.addTool("search_stays", 45);
  const metrics = recorder.finish("answered");
  assert.equal(metrics.modelCalls, 3);
  assert.equal(metrics.modelRetries, 1);
  assert.equal(metrics.inputTokens, 37_500);
  assert.equal(metrics.outputTokens, 190);
  assert.equal(metrics.cachedTokens, 12_000);
  assert.equal(metrics.modelMs, 1_520);
  assert.deepEqual(metrics.tools, ["search_stays"]);
  assert.equal(metrics.outcome, "answered");
  assert.equal(metrics.error, null);
  assert.deepEqual(usageFromResponse(null), { inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
  assert.equal(new TurnRecorder().finish("error", new Error("x".repeat(900))).error?.length, 500);
});

test("cost is only estimated when prices are configured", () => {
  assert.equal(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 500_000 }, null), null);
  assert.equal(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 500_000 }, { input: 0.1, output: 0.4 }), 0.3);
});
