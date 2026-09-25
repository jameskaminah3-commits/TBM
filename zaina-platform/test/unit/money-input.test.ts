import assert from "node:assert/strict";
import test from "node:test";
import { describeInputAmount, normalizeInputCurrency, toUsdAmount } from "../../src/engine/money-input.ts";

test("KES budgets are converted to USD with the supplied rate", () => {
  const result = toUsdAmount(5000, "KES", 130);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.currency, "KES");
  assert.equal(result.usd, 38);
  assert.ok(Math.abs(result.exactUsd - 38.4615) < 0.001);
});

test("USD budgets pass through unchanged", () => {
  const result = toUsdAmount(250, "usd", 130);
  assert.deepEqual(result, { ok: true, usd: 250, exactUsd: 250, amount: 250, currency: "USD" });
});

test("a budget without a currency is rejected instead of guessed", () => {
  assert.deepEqual(toUsdAmount(5000, undefined, 130), { ok: false, error: "currency_required" });
  assert.deepEqual(toUsdAmount(5000, "  ", 130), { ok: false, error: "currency_required" });
});

test("invalid amounts and unknown currencies are rejected", () => {
  assert.deepEqual(toUsdAmount(0, "KES", 130), { ok: false, error: "amount_invalid" });
  assert.deepEqual(toUsdAmount(Number.NaN, "KES", 130), { ok: false, error: "amount_invalid" });
  assert.deepEqual(toUsdAmount("5000", "KES", 130), { ok: false, error: "amount_invalid" });
  assert.deepEqual(toUsdAmount(5000, "EUR", 130), { ok: false, error: "currency_unsupported" });
  assert.deepEqual(toUsdAmount(5000, "KES", 0), { ok: false, error: "currency_unsupported" });
});

test("common spellings of the two supported currencies are recognised", () => {
  assert.equal(normalizeInputCurrency("KSh"), "KES");
  assert.equal(normalizeInputCurrency("kshs."), "KES");
  assert.equal(normalizeInputCurrency("US$"), "USD");
  assert.equal(normalizeInputCurrency("euro"), null);
});

test("stated amounts are described in the customer's own currency", () => {
  assert.equal(describeInputAmount(20000, "KES"), "KSh 20,000");
  assert.equal(describeInputAmount(150, "USD"), "$150");
});
