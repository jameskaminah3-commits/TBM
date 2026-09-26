// Billing in the database (Phase 5), with the clock moved by hand: a free
// trial, its invoice a week ahead, past due at its end, a live business
// paused after the grace period and resumed when it pays; Paystack payments
// settling once; changing plans, cancelling and keeping; a free plan; and
// each business reading only its own billing. Needs the same local *_test
// database as platform.test.ts (it is wiped).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import { configureBilling } from "../../src/billing/config.ts";
import {
  BillingError,
  billingOf,
  cancelPlan,
  choosePlan,
  createPlan,
  keepPlan,
  markInvoicePaid,
  platformBilling,
  recordPaymentStart,
  settleInvoicePayment,
  sweepBilling,
  voidInvoice,
} from "../../src/billing/store.ts";
import { validatePlan } from "../../src/billing/periods.ts";
import { clearBusinessCache } from "../../src/businesses/registry.ts";
import { closePlatformDb, initPlatformDb, ownerPool } from "../../src/db/platform-db.ts";
import { confirmStaffEmail, createSelfServeBusiness, setBusinessStatus } from "../../src/db/platform-scope.ts";
import { migrate } from "../../src/db/migrate.ts";
import type { Invoice, Subscription } from "../../src/db/schema.ts";

const TEST_DB = process.env.PLATFORM_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/zaina_platform_test";
if (!new URL(TEST_DB).pathname.endsWith("_test")) throw new Error("PLATFORM_TEST_DATABASE_URL must name a database ending in _test: it is wiped");

const DAY = 86_400_000;
/** 10:00 in Nairobi on 1 October 2026. */
const T0 = new Date("2026-10-01T07:00:00.000Z");
const day = (days: number, from = T0) => new Date(from.getTime() + days * DAY);
let adminId: string;

async function plan(input: Record<string, unknown>) {
  const checked = validatePlan(input, true);
  assert.ok(checked.ok, !checked.ok ? checked.error : "");
  const created = await createPlan(checked.value);
  assert.ok(created !== "exists");
  return created;
}

async function selfServe(id: string, email: string) {
  const owner = await createSelfServeBusiness({
    business: { id, name: id, publicKey: `pk_${id}_${randomBytes(4).toString("hex")}`, allowedOrigins: [], timeZone: "Africa/Nairobi", dailyTokenCap: 1_000_000, retentionDays: 90, businessType: "salon", websiteUrl: null },
    owner: { email, name: "Test Owner", passwordHash: "not-a-real-hash" },
  });
  await confirmStaffEmail(owner.id, email);
}

async function subscriptionOf(businessId: string): Promise<Subscription> {
  const { subscription } = await billingOf(businessId);
  assert.ok(subscription, `${businessId} has a subscription`);
  return subscription;
}

async function invoicesOf(businessId: string): Promise<Invoice[]> {
  return (await billingOf(businessId)).invoices;
}

const openInvoice = async (businessId: string) => (await invoicesOf(businessId)).find((invoice) => invoice.status === "open");

async function business(id: string): Promise<{ status: string; pause_reason: string | null }> {
  const { rows: [row] } = await ownerPool().query("select status, pause_reason from businesses where id = $1", [id]);
  return row;
}

async function refused(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => error instanceof BillingError && error.code === code, code);
}

before(async () => {
  const admin = new pg.Pool({ connectionString: TEST_DB, max: 1 });
  await admin.query("drop schema public cascade; create schema public;");
  await admin.end();
  initPlatformDb(TEST_DB, { max: 8 });
  await migrate(ownerPool());
  configureBilling({ graceDays: 7, publicBaseUrl: "https://zaina.example", platformPaystackKey: null, paymentInstructions: null });
  await plan({ id: "starter", name: "Starter", price_minor: 250_000, currency: "KES", trial_days: 14, conversations_per_month: 500 });
  await plan({ id: "pro", name: "Pro", price_minor: 600_000, currency: "KES" });
  await plan({ id: "free", name: "Free", price_minor: 0, currency: "KES" });
  await selfServe("studio", "studio-owner@example.com");
  await selfServe("bistro", "bistro-owner@example.com");
  await selfServe("kiosk", "kiosk-owner@example.com");
  const { rows: [staff] } = await ownerPool().query("insert into staff_users (email, name, password_hash, is_platform_admin) values ('admin@example.com', 'Platform Admin', 'x', true) returning id");
  adminId = staff.id;
});

after(async () => {
  // Owners' emails go out after each change is saved: let the last ones finish.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await closePlatformDb();
});

test("a free trial: its invoice a week ahead, past due when it ends, a live business paused after the grace period and resumed when it pays", async () => {
  await choosePlan("studio", "starter", T0);
  let subscription = await subscriptionOf("studio");
  assert.equal(subscription.status, "trialing");
  assert.equal(subscription.trialEndsAt?.toISOString(), day(14).toISOString());
  assert.equal(subscription.currentPeriodEnd?.toISOString(), day(14).toISOString());
  assert.deepEqual(await invoicesOf("studio"), [], "no invoice while the trial has two weeks to run");
  await refused(choosePlan("studio", "starter", T0), "same_plan");

  await sweepBilling(day(6));
  assert.deepEqual(await invoicesOf("studio"), [], "nothing before the week ahead");
  await sweepBilling(day(7));
  const invoice = await openInvoice("studio");
  assert.ok(invoice, "the invoice goes out a week before the trial ends");
  assert.match(invoice.number, /^ZN-\d{6}$/);
  assert.equal(invoice.amountMinor, 250_000);
  assert.equal(invoice.planName, "Starter");
  assert.equal(invoice.periodStart.toISOString(), day(14).toISOString());
  assert.equal(invoice.periodEnd.toISOString(), "2026-11-15T07:00:00.000Z", "a month on the business's clock");
  assert.equal(invoice.dueAt.toISOString(), day(14).toISOString());
  await sweepBilling(day(8));
  assert.equal((await invoicesOf("studio")).length, 1, "the sweep sends it once");

  // The owner went live meanwhile.
  await setBusinessStatus("studio", "active");
  await sweepBilling(day(14));
  assert.equal((await subscriptionOf("studio")).status, "past_due");
  assert.equal((await business("studio")).status, "active", "a live business keeps answering through the grace period");
  await sweepBilling(day(20));
  assert.equal((await business("studio")).status, "active");
  await sweepBilling(day(21));
  assert.deepEqual(await business("studio"), { status: "paused", pause_reason: "billing" }, "paused seven days after it was due");

  // Paid by hand four days later: the business answers again, and its month starts from the payment.
  const paid = await markInvoicePaid(invoice.id, { method: "manual", receipt: "QWE123ABCD", recordedBy: adminId }, day(25));
  assert.equal(paid.status, "paid");
  assert.equal(paid.method, "manual");
  assert.equal(paid.receipt, "QWE123ABCD");
  assert.equal(paid.periodStart.toISOString(), day(25).toISOString(), "days it couldn't use aren't charged");
  assert.equal(paid.periodEnd.toISOString(), "2026-11-26T07:00:00.000Z");
  subscription = await subscriptionOf("studio");
  assert.equal(subscription.status, "active");
  assert.equal(subscription.currentPeriodEnd?.toISOString(), "2026-11-26T07:00:00.000Z");
  assert.deepEqual(await business("studio"), { status: "active", pause_reason: null });
  await refused(markInvoicePaid(invoice.id, { method: "manual", receipt: "again", recordedBy: adminId }, day(25)), "not_open");
});

test("Paystack: a payment settles once, one for another amount doesn't count, and money arriving for a paid invoice is kept to refund", async () => {
  // Studio's renewal goes out a week before its month ends (26 November).
  await sweepBilling(new Date("2026-11-19T07:00:00.000Z"));
  const renewal = await openInvoice("studio");
  assert.ok(renewal);
  assert.equal(renewal.periodStart.toISOString(), "2026-11-26T07:00:00.000Z");
  const reference = () => `zi_${randomBytes(12).toString("hex")}`;
  const first = await recordPaymentStart(renewal, { reference: reference(), payerEmail: "studio-owner@example.com" });
  const second = await recordPaymentStart(renewal, { reference: reference(), payerEmail: "studio-owner@example.com" });
  const wrong = await recordPaymentStart(renewal, { reference: reference(), payerEmail: "studio-owner@example.com" });
  const now = new Date("2026-11-20T07:00:00.000Z");
  const success = (amountMinor: number, transactionId: string) => ({ status: "success", amountMinor, currency: "KES", transactionId, message: null });

  assert.equal(await settleInvoicePayment(wrong, success(100, "5000001"), now), "failed");
  assert.equal((await openInvoice("studio"))?.id, renewal.id, "the wrong amount doesn't pay it");
  assert.equal(await settleInvoicePayment(first, success(250_000, "5000002"), now), "paid");
  assert.equal(await settleInvoicePayment(first, success(250_000, "5000002"), now), "paid", "the same news twice changes nothing");
  const [paid] = (await invoicesOf("studio")).filter((invoice) => invoice.id === renewal.id);
  assert.equal(paid.status, "paid");
  assert.equal(paid.method, "paystack");
  assert.equal(paid.receipt, "5000002");
  assert.equal(paid.periodStart.toISOString(), "2026-11-26T07:00:00.000Z", "paid ahead: the next month starts when this one ends");
  assert.equal((await subscriptionOf("studio")).currentPeriodEnd?.toISOString(), "2026-12-26T07:00:00.000Z");

  // A second tab paid too: recorded, and flagged for a refund.
  assert.equal(await settleInvoicePayment(second, success(250_000, "5000003"), now), "paid");
  const { rows } = await ownerPool().query("select reference, status, note from invoice_payments where invoice_id = $1 order by created_at", [renewal.id]);
  assert.deepEqual(rows.map((row) => row.status), ["succeeded", "succeeded", "failed"]);
  assert.match(rows.find((row) => row.reference === second.reference).note, /refund this payment in Paystack/);
  assert.match(rows.find((row) => row.reference === wrong.reference).note, /not the amount asked/);
  assert.equal((await invoicesOf("studio")).filter((invoice) => invoice.status === "paid").length, 2);
  // A declined try isn't money: the platform team looks only at money that didn't pay an invoice.
  const declined = await recordPaymentStart(renewal, { reference: reference(), payerEmail: "studio-owner@example.com" });
  assert.equal(await settleInvoicePayment(declined, { status: "failed", amountMinor: 250_000, currency: "KES", transactionId: null, message: "Declined" }, now), "failed");
  const attention = (await platformBilling(now)).attention.map((payment) => payment.reference).sort();
  assert.deepEqual(attention, [second.reference, wrong.reference].sort());

  // A business the platform team paused stays paused when it pays.
  await sweepBilling(new Date("2026-12-19T07:00:00.000Z"));
  const next = await openInvoice("studio");
  assert.ok(next);
  await setBusinessStatus("studio", "paused", "platform");
  await markInvoicePaid(next.id, { method: "waived", receipt: null, recordedBy: adminId }, new Date("2026-12-20T07:00:00.000Z"));
  assert.deepEqual(await business("studio"), { status: "paused", pause_reason: "platform" });
  await setBusinessStatus("studio", "active");
});

test("changing plans, cancelling and keeping, a plan that ends, and a business the platform team bills itself", async () => {
  await refused(choosePlan("tbm", "starter", T0), "billed_by_team");
  await refused(choosePlan("bistro", "nothing", T0), "plan_not_found");

  // No trial on Pro: the first invoice is due at once, and nothing happens until it's paid.
  await choosePlan("bistro", "pro", T0);
  assert.equal((await subscriptionOf("bistro")).status, "incomplete");
  const first = await openInvoice("bistro");
  assert.equal(first?.amountMinor, 600_000);
  assert.equal(first?.dueAt.toISOString(), T0.toISOString());
  await sweepBilling(day(30));
  assert.equal((await subscriptionOf("bistro")).status, "incomplete", "an unpaid first invoice doesn't make it past due");

  // Starter still has its trial for Bistro: switching starts it, and the Pro invoice is void.
  await choosePlan("bistro", "starter", day(30));
  const trial = await subscriptionOf("bistro");
  assert.equal(trial.status, "trialing");
  assert.equal(trial.planId, "starter");
  assert.equal((await invoicesOf("bistro")).find((invoice) => invoice.id === first!.id)?.status, "void");

  // Cancelling during the trial: it ends with the trial, and no invoice goes out.
  await cancelPlan("bistro", day(31));
  assert.equal((await subscriptionOf("bistro")).cancelAtPeriodEnd, true);
  await sweepBilling(day(40));
  assert.equal(await openInvoice("bistro"), undefined, "no invoice for a plan that's ending");
  // Keeping it after all sends the invoice at once (it's inside the week).
  await keepPlan("bistro", day(40));
  assert.ok(await openInvoice("bistro"));
  await refused(keepPlan("bistro", day(40)), "not_ending");
  await cancelPlan("bistro", day(41));
  assert.equal(await openInvoice("bistro"), undefined, "cancelling voids the invoice for after the trial");
  await sweepBilling(day(44));
  assert.equal((await subscriptionOf("bistro")).status, "cancelled");
  assert.equal((await business("bistro")).status, "onboarding", "a business still setting up isn't paused");

  // Starting again: the trial was used, so the first invoice is due at once.
  await choosePlan("bistro", "starter", day(45));
  const again = await subscriptionOf("bistro");
  assert.equal(again.status, "incomplete");
  assert.equal(again.trialEndsAt?.toISOString(), day(44).toISOString(), "one trial per business");
  const due = await openInvoice("bistro");
  assert.equal(due?.amountMinor, 250_000);

  // The platform team voids it: a plan not running yet doesn't get another.
  await voidInvoice(due!.id, day(46));
  assert.equal(await openInvoice("bistro"), undefined);
  await refused(voidInvoice(due!.id, day(46)), "not_open");
  await refused(cancelPlan("tbm", day(46)), "no_plan");
});

test("a free plan runs on by itself, without invoices", async () => {
  await choosePlan("kiosk", "free", T0);
  let subscription = await subscriptionOf("kiosk");
  assert.equal(subscription.status, "active");
  assert.equal(subscription.currentPeriodEnd?.toISOString(), "2026-11-01T07:00:00.000Z");
  await sweepBilling(new Date("2027-01-05T07:00:00.000Z"));
  subscription = await subscriptionOf("kiosk");
  assert.equal(subscription.currentPeriodStart?.toISOString(), "2027-01-01T07:00:00.000Z");
  assert.equal(subscription.currentPeriodEnd?.toISOString(), "2027-02-01T07:00:00.000Z");
  assert.deepEqual(await invoicesOf("kiosk"), []);
});

test("each business reads only its own billing, and changes none of it", async () => {
  const asBusiness = async (businessId: string, text: string, values: unknown[] = []) => {
    const client = await ownerPool().connect();
    try {
      await client.query("begin");
      await client.query("select set_config('role', 'zaina_app', true), set_config('app.business_id', $1, true)", [businessId]);
      return await client.query(text, values);
    } finally {
      await client.query("rollback");
      client.release();
    }
  };
  const seen = await asBusiness("bistro", "select business_id from invoices union all select business_id from subscriptions union all select business_id from invoice_payments");
  assert.ok(seen.rows.length > 0);
  assert.ok(seen.rows.every((row) => row.business_id === "bistro"), "only its own rows");
  assert.equal((await asBusiness("bistro", "select count(*)::int as n from plans")).rows[0].n, 3, "the price list is everyone's");
  await assert.rejects(() => asBusiness("studio", "update invoices set status = 'paid', paid_at = now(), method = 'manual' where business_id = 'studio'"), /permission denied/);
  await assert.rejects(() => asBusiness("studio", "update subscriptions set status = 'active'"), /permission denied/);
  await assert.rejects(() => asBusiness("studio", "insert into invoice_payments (business_id, invoice_id, reference, amount_minor, currency) values ('studio', gen_random_uuid(), 'zi_000000000000000000000000', 1, 'KES')"), /permission denied/);
  await assert.rejects(() => asBusiness("studio", "update businesses set pause_reason = null"), /permission denied/);
  // One open invoice per business, whatever writes it.
  const open = await openInvoice("studio") ?? (await sweepBilling(new Date("2027-01-20T07:00:00.000Z")), await openInvoice("studio"));
  assert.ok(open);
  await assert.rejects(() => ownerPool().query(
    "insert into invoices (business_id, number, plan_id, plan_name, billing_interval, period_start, period_end, amount_minor, currency, status, due_at) select business_id, 'ZN-TEST', plan_id, plan_name, billing_interval, period_start, period_end, amount_minor, currency, 'open', due_at from invoices where id = $1",
    [open.id],
  ), /invoices_one_open/);
  clearBusinessCache();
});
