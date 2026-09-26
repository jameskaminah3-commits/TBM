// Billing without a database (Phase 5): periods on the business's clock,
// when invoices go out and when an unpaid one pauses a business, where a
// paid period starts, the platform team's plan checks, the owners' emails,
// and billing's settings.

import assert from "node:assert/strict";
import test from "node:test";
import { configureBilling } from "../../src/billing/config.ts";
import { composeEmail } from "../../src/billing/emails.ts";
import { invoiceNumber, invoiceSendAt, paidPeriodStart, pauseAt, periodEnd, priceText, trialEnd, validatePlan } from "../../src/billing/periods.ts";
import { zonedInstant } from "../../src/booking/local-time.ts";
import { loadConfig } from "../../src/config.ts";
import type { Invoice } from "../../src/db/schema.ts";

const ZONE = "Africa/Nairobi";
const at = (date: string, time = "10:00") => zonedInstant(date, time, ZONE);
const iso = (date: Date) => date.toISOString();

test("a period is a month or a year on the business's clock; the 31st becomes a shorter month's last day", () => {
  assert.equal(iso(periodEnd(at("2026-10-01"), "month", ZONE)), iso(at("2026-11-01")));
  assert.equal(iso(periodEnd(at("2026-01-31"), "month", ZONE)), iso(at("2026-02-28")));
  assert.equal(iso(periodEnd(at("2028-01-31"), "month", ZONE)), iso(at("2028-02-29")), "a leap year");
  assert.equal(iso(periodEnd(at("2026-12-15"), "month", ZONE)), iso(at("2027-01-15")));
  assert.equal(iso(periodEnd(at("2028-02-29"), "year", ZONE)), iso(at("2029-02-28")));
  // Just after midnight in Nairobi is still the day before in UTC: the local date counts.
  assert.equal(iso(periodEnd(at("2026-10-01", "00:30"), "month", ZONE)), iso(at("2026-11-01", "00:30")));
  // Seconds carry over.
  assert.equal(periodEnd(new Date(at("2026-10-01").getTime() + 42_123), "month", ZONE).getTime() - at("2026-11-01").getTime(), 42_123);
  // Across a daylight-saving change the local time stays.
  const london = (date: string) => zonedInstant(date, "09:00", "Europe/London");
  assert.equal(iso(periodEnd(london("2026-03-15"), "month", "Europe/London")), iso(london("2026-04-15")));
});

test("invoices go out a week ahead (halfway through a short trial); an unpaid one pauses after the grace period", () => {
  assert.equal(iso(invoiceSendAt(at("2026-10-01"), at("2026-11-01"))), iso(at("2026-10-25")));
  const start = at("2026-10-01");
  assert.equal(iso(trialEnd(start, 14)), iso(at("2026-10-15")));
  assert.equal(iso(invoiceSendAt(start, trialEnd(start, 14))), iso(at("2026-10-08")));
  assert.equal(iso(invoiceSendAt(start, trialEnd(start, 4))), iso(at("2026-10-03")), "halfway through a 4-day trial");
  assert.equal(iso(pauseAt(at("2026-11-01"), 7)), iso(at("2026-11-08")));
  assert.equal(iso(pauseAt(at("2026-11-01"), 0)), iso(at("2026-11-01")));
  assert.equal(invoiceNumber(7), "ZN-000007");
  assert.equal(invoiceNumber(1_234_567), "ZN-1234567");
});

test("a paid period starts where its invoice said, unless the business wasn't answering customers meanwhile", () => {
  const due = at("2026-11-01");
  const late = at("2026-11-12");
  assert.equal(paidPeriodStart(due, late, true), due, "live all along: the days it ran on are paid for");
  assert.equal(paidPeriodStart(due, late, false), late, "paused, or still setting up: the period starts when it pays");
  assert.equal(paidPeriodStart(due, at("2026-10-28"), false), due, "paid ahead: the period starts when it's due");
});

test("the platform team's plans are checked", () => {
  const good = validatePlan({ id: "starter", name: " Starter ", price_minor: 250_000, currency: "KES", trial_days: 14, conversations_per_month: 500 }, true);
  assert.ok(good.ok);
  assert.deepEqual(good.value, { id: "starter", name: "Starter", priceMinor: 250_000, currency: "KES", billingInterval: "month", trialDays: 14, conversationsPerMonth: 500 });
  const base = { id: "starter", name: "Starter", price_minor: 100, currency: "KES" };
  for (const [input, pattern] of [
    [{ ...base, id: "Starter" }, /id is lowercase/],
    [{ ...base, name: "  " }, /name/],
    [{ ...base, price_minor: 12.5 }, /price_minor/],
    [{ ...base, price_minor: -1 }, /price_minor/],
    [{ ...base, price_minor: undefined }, /price_minor/],
    [{ ...base, currency: "EUR" }, /currency/],
    [{ ...base, billing_interval: "week" }, /billing_interval/],
    [{ ...base, trial_days: 91 }, /trial_days/],
    [{ ...base, conversations_per_month: 0 }, /conversations_per_month/],
    [{ ...base, status: "deleted" }, /status/],
  ] as const) {
    const checked = validatePlan(input, true);
    assert.ok(!checked.ok && pattern.test(checked.error), JSON.stringify(input));
  }
  // A change carries only what changes, and never the id.
  const change = validatePlan({ price_minor: 300_000, status: "hidden", id: "other" }, false);
  assert.ok(change.ok);
  assert.deepEqual(change.value, { priceMinor: 300_000, status: "hidden" });
  assert.equal(priceText({ priceMinor: 250_000, currency: "KES", billingInterval: "month" }), "KSh 2,500 a month");
  assert.equal(priceText({ priceMinor: 29_900, currency: "USD", billingInterval: "year" }), "$299 a year");
  assert.equal(priceText({ priceMinor: 0, currency: "KES", billingInterval: "month" }), "Free");
});

test("the owners' emails say what happened, by when, and how to pay", () => {
  configureBilling({ graceDays: 7, publicBaseUrl: "https://zaina.example", platformPaystackKey: "sk_test_platformkey1234", paymentInstructions: "M-Pesa paybill 123456, account ZAINA." });
  const invoice = {
    number: "ZN-000042", planName: "Starter", billingInterval: "month", periodStart: at("2026-10-15"), periodEnd: at("2026-11-15"),
    amountMinor: 250_000, currency: "KES", status: "open", dueAt: at("2026-10-15"), paidAt: null, method: null, receipt: null,
  } as unknown as Invoice;
  const business = { name: "Studio Nywele", timeZone: ZONE, status: "active" };
  const link = "https://zaina.example/console/#/b/studio/settings/billing";

  const trial = composeEmail({ kind: "invoice", invoice, trialEnds: at("2026-10-15") }, business, link);
  assert.equal(trial.subject, "Your Zaina free trial ends on 15 October 2026");
  const text = trial.body.join("\n");
  assert.match(text, /Your free trial of Zaina for Studio Nywele ends on 15 October 2026/);
  assert.match(text, /ZN-000042/);
  assert.match(text, /Starter \(monthly\)/);
  assert.match(text, /15 October 2026 to 15 November 2026/);
  assert.match(text, /KSh 2,500/);
  assert.match(text, /Pay it by card or M-Pesa in the Zaina console: https:\/\/zaina\.example\/console\/#\/b\/studio\/settings\/billing/);
  assert.match(text, /Or pay by hand: M-Pesa paybill 123456, account ZAINA\. Use ZN-000042 as the reference\./);
  assert.equal(composeEmail({ kind: "invoice", invoice, trialEnds: null }, business, link).subject, "Zaina invoice ZN-000042: KSh 2,500 due 15 October 2026");

  assert.match(composeEmail({ kind: "overdue", invoice, pausesAt: at("2026-10-22") }, business, link).body.join("\n"), /keeps answering your customers until 22 October 2026\. After that it pauses/);
  assert.match(composeEmail({ kind: "overdue", invoice, pausesAt: null }, { ...business, status: "onboarding" }, link).body.join("\n"), /Pay it to put Zaina live/);
  assert.equal(composeEmail({ kind: "paused", invoice }, business, link).subject, "Zaina has paused for Studio Nywele");
  assert.match(composeEmail({ kind: "ended", paused: true }, business, link).body.join("\n"), /has ended, as you asked\. Zaina has stopped answering your customers\./);

  const paid = composeEmail({ kind: "paid", invoice: { ...invoice, status: "paid", paidAt: at("2026-10-16"), method: "paystack", receipt: "5000123" }, paidThrough: at("2026-11-16"), resumed: true }, business, link);
  assert.equal(paid.subject, "Receipt: Zaina invoice ZN-000042 is paid");
  assert.match(paid.body.join("\n"), /16 October 2026, by card or M-Pesa through Paystack \(transaction 5000123\)/);
  assert.match(paid.body.join("\n"), /paid through 16 November 2026\. Zaina is answering your customers again\./);
  const waived = composeEmail({ kind: "paid", invoice: { ...invoice, status: "paid", paidAt: at("2026-10-16"), method: "waived" }, paidThrough: at("2026-11-15"), resumed: false }, business, link);
  assert.equal(waived.subject, "Zaina invoice ZN-000042 is waived");
  assert.doesNotMatch(waived.body.join("\n"), /Paid:/);

  // Without the platform's Paystack account the console shows the invoice; paying is by hand.
  configureBilling({ graceDays: 7, publicBaseUrl: "https://zaina.example", platformPaystackKey: null, paymentInstructions: null });
  const offline = composeEmail({ kind: "invoice", invoice, trialEnds: null }, business, link).body.join("\n");
  assert.match(offline, /See it in the Zaina console/);
  assert.doesNotMatch(offline, /by card/);
});

test("billing's settings: a grace period of 0 to 60 days, and how to pay by hand", () => {
  const env = { SESSION_TOKEN_SECRET: "billing-unit-secret-long-enough-1234567", PLATFORM_DATABASE_URL: "postgres://postgres@127.0.0.1:55432/zaina_platform_test", GEMINI_API_KEY: "test" };
  assert.equal(loadConfig(env).billingGraceDays, 7);
  assert.equal(loadConfig(env).billingPaymentInstructions, null);
  assert.equal(loadConfig({ ...env, BILLING_GRACE_DAYS: "0" }).billingGraceDays, 0);
  assert.throws(() => loadConfig({ ...env, BILLING_GRACE_DAYS: "61" }), /BILLING_GRACE_DAYS/);
  assert.throws(() => loadConfig({ ...env, BILLING_GRACE_DAYS: "3.5" }), /BILLING_GRACE_DAYS/);
  assert.equal(loadConfig({ ...env, BILLING_PAYMENT_INSTRUCTIONS: "  Paybill 123456,\n account ZAINA.  " }).billingPaymentInstructions, "Paybill 123456, account ZAINA.");
  assert.throws(() => loadConfig({ ...env, BILLING_PAYMENT_INSTRUCTIONS: "x".repeat(501) }), /500 characters/);
});
