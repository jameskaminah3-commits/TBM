// End-to-end, Phase 5: businesses pay the platform.
//
//   plans     the platform team adds them (billing is off until then); a
//             business that signed up by itself chooses one before going
//             live, and one the team added is billed by the team
//   invoices  paid by card or M-Pesa through the platform's Paystack account
//             (the way back from Paystack's page, or its webhook), by hand, or
//             waived; each owner gets the invoice and the receipt by email
//   unpaid    a live business keeps answering through the grace period, then
//             pauses until the invoice is paid
//   ending    a cancelled plan runs to the end of what's paid for
//
// Paystack and email are the stand-ins of scripted-model.mjs. The clock is
// moved by changing dates in the database; the server's sweep runs every
// 300 ms.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5082;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = "https://duka-la-mama.example";
const PLATFORM_KEY = "sk_test_platformbilling01";
const OWNER = { name: "Mama Njeri", email: "njeri@example.com", password: "LocalTest#2026" };
const DAY = 86_400_000;

let platform: Platform;
let api: Api;
let owner = "";
let ops = "";
let manager = "";
let businessId = "";

const staff = (method: string, route: string, body?: unknown, token = owner) => api(method, `/v1/staff/businesses/${businessId}${route}`, body, token);
const billing = async (token = owner) => (await staff("GET", "/billing", undefined, token)).body;
const emails = () => platform.log("emails") as Array<{ to: string[]; subject: string; text: string }>;
const initializations = () => platform.log("paystack").filter((entry: any) => entry.kind === "initialize");
const moveSubscription = (fields: string) => platform.db.query(`update subscriptions set ${fields} where business_id = $1`, [businessId]);
const statusOf = async () => (await platform.db.query("select status, pause_reason from businesses where id = $1", [businessId])).rows[0];

async function signUp(person: typeof OWNER, businessName: string, website: string): Promise<{ token: string; businessId: string }> {
  const signed = await api("POST", "/v1/signup", { ...person, business_name: businessName, business_type: "general", website, accept_terms: true });
  assert.equal(signed.status, 202, JSON.stringify(signed.body));
  const email = await eventually(() => emails().find((entry) => entry.subject === "Confirm your email for Zaina" && entry.text.includes(businessName)), "the confirmation email");
  const link = /(http:\/\/127\.0\.0\.1:\d+\/v1\/signup\/confirm\?token=\S+)/.exec(email.text)![1];
  assert.equal((await fetch(link, { redirect: "manual" })).status, 303);
  const login = await api("POST", "/v1/staff/login", { email: person.email, password: person.password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { token: login.body.token, businessId: login.body.businesses[0].businessId };
}

async function openSession() {
  const { public_key } = (await staff("GET", "/operations")).body;
  const response = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE },
    body: JSON.stringify({ business_key: public_key, display_currency: "KES" }),
  });
  return response.status;
}

/** Paystack's webhook to the platform's account, signed with its key. */
async function webhook(payload: unknown, key = PLATFORM_KEY) {
  const raw = JSON.stringify(payload);
  const response = await fetch(`${BASE}/v1/payments/paystack`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": createHmac("sha512", key).update(raw).digest("hex") },
    body: raw,
  });
  return response.status;
}

/** Back from Paystack's page: where the platform sends the owner. */
async function wayBack(reference: string) {
  const response = await fetch(`${BASE}/v1/billing/paystack/return?trxref=${reference}&reference=${reference}`, { redirect: "manual" });
  assert.equal(response.status, 303);
  return response.headers.get("location");
}

before(async () => {
  platform = await startPlatform({
    port: PORT,
    env: {
      PUBLIC_BASE_URL: BASE,
      PLATFORM_SIGNUP: "open",
      RESEND_API_KEY: "re_scripted",
      ALERT_FROM_EMAIL: "hello@zaina.example",
      PLATFORM_PAYSTACK_SECRET_KEY: PLATFORM_KEY,
      BILLING_GRACE_DAYS: "7",
      BILLING_PAYMENT_INSTRUCTIONS: "M-Pesa paybill 400200, account ZAINA.",
      BILLING_SWEEP_INTERVAL_MS: "300",
      PAYMENT_CHECK_AFTER_MS: "60000",
    },
  });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
});

after(async () => {
  await platform?.stop();
});

test("billing is off until the platform team offers a plan; only the team sets plans", async () => {
  ({ token: owner, businessId } = await signUp(OWNER, "Duka la Mama", "duka-la-mama.example"));
  let view = await billing();
  assert.equal(view.enabled, false);
  assert.equal(view.subscription, null);
  assert.ok(!(await staff("GET", "/onboarding")).body.steps.some((step: any) => step.id === "plan"), "no plan step without plans");

  const starter = { id: "starter", name: "Starter", description: "For a small business.", price_minor: 250_000, currency: "KES", trial_days: 14, conversations_per_month: 500 };
  assert.equal((await api("POST", "/v1/platform/plans", starter, owner)).status, 403, "a business can't set prices");
  assert.equal((await api("POST", "/v1/platform/plans", { ...starter, currency: "EUR" }, ops)).status, 400);
  assert.equal((await api("POST", "/v1/platform/plans", starter, ops)).status, 201);
  assert.equal((await api("POST", "/v1/platform/plans", starter, ops)).status, 409, "the id is taken");
  assert.equal((await api("POST", "/v1/platform/plans", { id: "pro", name: "Pro", price_minor: 600_000, currency: "KES", sort_order: 1 }, ops)).status, 201);
  const changed = await api("PATCH", "/v1/platform/plans/pro", { description: "For a busy business." }, ops);
  assert.equal(changed.status, 200);
  assert.equal(changed.body.plan.price_text, "KSh 6,000 a month");
  assert.equal((await api("PATCH", "/v1/platform/plans/nothing", { name: "x" }, ops)).status, 404);

  view = await billing();
  assert.equal(view.enabled, true);
  assert.deepEqual(view.plans.map((plan: any) => [plan.id, plan.price_text, plan.trial_days]), [["starter", "KSh 2,500 a month", 14], ["pro", "KSh 6,000 a month", 0]]);
  assert.equal(view.trial_available, true);
  assert.equal(view.billed_by_team, false);
  assert.equal(view.pay_online, true);
  assert.equal(view.payment_instructions, "M-Pesa paybill 400200, account ZAINA.");

  // A business the platform team added (TBM) is billed by the team.
  const tbm = await api("GET", "/v1/staff/businesses/tbm/billing", undefined, ops);
  assert.equal(tbm.body.billed_by_team, true);
  assert.equal((await api("POST", "/v1/staff/businesses/tbm/billing/plan", { plan_id: "starter" }, ops)).body.error, "billed_by_team");
});

test("the owner chooses a plan with a free trial, and the business can go live", async () => {
  const plan = (await staff("GET", "/onboarding")).body.steps.find((step: any) => step.id === "plan");
  assert.deepEqual([plan.done, plan.required, plan.page, plan.tab], [false, true, "settings", "billing"]);

  assert.equal((await staff("POST", "/members", { email: "baraka@example.com", name: "Baraka Otieno", password: PASSWORD, role: "manager" })).status, 201);
  manager = (await api("POST", "/v1/staff/login", { email: "baraka@example.com", password: PASSWORD })).body.token;
  assert.equal((await billing(manager)).can_manage, false);
  assert.equal((await staff("POST", "/billing/plan", { plan_id: "starter" }, manager)).status, 403, "an owner chooses the plan");

  const chosen = await staff("POST", "/billing/plan", { plan_id: "starter" });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
  assert.equal(chosen.body.subscription.status, "trialing");
  assert.equal(chosen.body.subscription.plan.id, "starter");
  const trialDays = (Date.parse(chosen.body.subscription.trial_ends_at) - Date.now()) / DAY;
  assert.ok(trialDays > 13.9 && trialDays <= 14, `${trialDays} days`);
  assert.equal(chosen.body.trial_available, false);
  assert.equal(chosen.body.open_invoice, null, "nothing to pay during the trial");
  assert.equal((await staff("POST", "/billing/plan", { plan_id: "starter" })).body.error, "same_plan");

  // The rest of setting up, then live.
  assert.equal((await staff("PATCH", "/settings", { about: "Duka la Mama is a family shop in Kawangware, Nairobi: groceries, household goods and M-Pesa.", contactPhone: "+254700222333" })).status, 200);
  assert.equal((await staff("POST", "/knowledge", { title: "Opening hours", content: "We are open every day from 7am to 9pm." })).status, 200);
  const preview = await staff("POST", "/preview");
  const tried = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${preview.body.token}`, origin: BASE }, body: JSON.stringify({ message: "TEST:whoami" }) });
  assert.equal(tried.status, 200);
  const steps = (await staff("GET", "/onboarding")).body.steps;
  assert.match(steps.find((step: any) => step.id === "plan").detail, /^Starter: free trial until /);
  const live = await staff("POST", "/go-live");
  assert.equal(live.status, 200, JSON.stringify(live.body));
  assert.equal(await openSession(), 201);
});

test("the trial's invoice goes out a week ahead and is paid by card through Paystack; the owner gets a receipt", async () => {
  // Thirteen days into the trial.
  await moveSubscription("current_period_start = now() - interval '13 days', current_period_end = now() + interval '1 day', trial_ends_at = now() + interval '1 day'");
  const invoice = await eventually(async () => (await billing()).open_invoice, "the invoice for after the trial");
  assert.equal(invoice.amount_minor, 250_000);
  assert.equal(invoice.plan_name, "Starter");
  assert.equal(invoice.overdue, false);
  const trialEnds = (await billing()).subscription.current_period_end;
  assert.equal(invoice.due_at, trialEnds);
  assert.equal(invoice.period_start, trialEnds);
  const notice = await eventually(() => emails().find((email) => email.subject.startsWith("Your Zaina free trial ends on")), "the trial's email");
  assert.deepEqual(notice.to, [OWNER.email], "the owner, not the manager");
  assert.match(notice.text, new RegExp(invoice.number));
  assert.match(notice.text, /Pay it by card or M-Pesa in the Zaina console: http:\/\/127\.0\.0\.1:5082\/console\/#\/b\/.+\/settings\/billing/);
  assert.match(notice.text, /Or pay by hand: M-Pesa paybill 400200, account ZAINA\. Use ZN-\d{6} as the reference\./);

  assert.equal((await staff("POST", `/billing/invoices/${invoice.id}/pay`, undefined, manager)).status, 403, "an owner pays");
  const started = await staff("POST", `/billing/invoices/${invoice.id}/pay`);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.match(started.body.authorization_url, /^https:\/\/checkout\.paystack\.com\/fake_zi_[0-9a-f]{24}$/);
  const [init] = initializations();
  assert.equal(init.key, PLATFORM_KEY.slice(0, 16), "the platform's own account");
  assert.deepEqual([init.amount, init.currency, init.email, init.subaccount], [250_000, "KES", OWNER.email, null]);
  assert.deepEqual(init.channels, ["card", "mobile_money"]);
  assert.equal(init.callback, `${BASE}/v1/billing/paystack/return`);
  const again = await staff("POST", `/billing/invoices/${invoice.id}/pay`);
  assert.equal(again.body.authorization_url, started.body.authorization_url, "a second click opens the same payment");
  assert.equal(initializations().length, 1);

  const reference = init.reference;
  assert.equal(await wayBack(reference), `${BASE}/console/#/b/${businessId}/settings/billing?paid=pending`, "not paid yet");
  platform.payOnPaystack(reference);
  assert.equal(await wayBack(reference), `${BASE}/console/#/b/${businessId}/settings/billing?paid=paid`);
  assert.equal(await wayBack("zi_000000000000000000000000"), `${BASE}/console/`, "an unknown payment leads nowhere");

  const view = await billing();
  assert.equal(view.open_invoice, null);
  const paid = view.invoices.find((entry: any) => entry.id === invoice.id);
  assert.deepEqual([paid.status, paid.method], ["paid", "paystack"]);
  assert.equal(paid.period_start, trialEnds, "live all along: the month starts when the trial ends");
  assert.equal(view.subscription.status, "active");
  assert.equal(view.subscription.current_period_end, paid.period_end);
  const receipt = await eventually(() => emails().find((email) => email.subject === `Receipt: Zaina invoice ${invoice.number} is paid`), "the receipt");
  assert.match(receipt.text, /by card or M-Pesa through Paystack \(transaction \d+\)/);
});

test("the next invoice, paid through Paystack's webhook: signed by the platform's key, and settled once", async () => {
  await moveSubscription("current_period_start = now() - interval '28 days', current_period_end = now() + interval '2 days'");
  const invoice = await eventually(async () => (await billing()).open_invoice, "the renewal invoice");
  await staff("POST", `/billing/invoices/${invoice.id}/pay`);
  const reference = initializations().at(-1).reference;
  const charge = { event: "charge.success", data: { id: 7_000_001, status: "success", reference, amount: 250_000, currency: "KES", channel: "mobile_money", gateway_response: "Approved" } };
  assert.equal(await webhook(charge, "sk_test_someoneelse123"), 401, "a webhook not from the platform's account is refused");
  assert.equal((await billing()).open_invoice?.id, invoice.id);
  assert.equal(await webhook(charge), 200);
  assert.equal(await webhook(charge), 200, "Paystack may send it twice");
  const view = await billing();
  assert.equal(view.open_invoice, null);
  const paid = view.invoices.find((entry: any) => entry.id === invoice.id);
  assert.deepEqual([paid.status, paid.method, paid.receipt], ["paid", "paystack", "7000001"]);
  await eventually(() => emails().some((email) => email.subject === `Receipt: Zaina invoice ${invoice.number} is paid`), "the receipt");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(emails().filter((email) => email.subject === `Receipt: Zaina invoice ${invoice.number} is paid`).length, 1, "one receipt");
});

test("unpaid past the grace period: the business pauses, and answers again once it's paid by hand", async () => {
  // Paid through nine days ago: the invoice was due then, and the seven days' grace ran out two days ago.
  await moveSubscription("current_period_start = now() - interval '40 days', current_period_end = now() - interval '9 days'");
  await eventually(async () => (await statusOf()).status === "paused", "the pause");
  assert.deepEqual(await statusOf(), { status: "paused", pause_reason: "billing" });
  assert.equal(await openSession(), 404, "customers aren't answered");
  const view = await billing();
  assert.equal(view.subscription.status, "past_due");
  assert.equal(view.open_invoice.overdue, true);
  await eventually(() => emails().some((email) => email.subject === "Zaina has paused for Duka la Mama"), "the pause email");
  const membership = (await api("POST", "/v1/staff/login", { email: OWNER.email, password: OWNER.password })).body.businesses[0];
  assert.deepEqual([membership.businessStatus, membership.pauseReason], ["paused", "billing"]);
  assert.match((await staff("POST", "/go-live")).body.message, /unpaid invoice/);
  const resumed = await api("PATCH", `/v1/platform/businesses/${businessId}`, { status: "active" }, ops);
  assert.equal(resumed.body.error, "unpaid_invoice", "the team marks it paid or waives it instead");

  const team = (await api("GET", "/v1/platform/billing", undefined, ops)).body;
  const listed = team.invoices.find((entry: any) => entry.id === view.open_invoice.id);
  assert.deepEqual([listed.business_name, listed.status, listed.overdue], ["Duka la Mama", "open", true]);
  assert.deepEqual(team.subscriptions.map((row: any) => [row.business_name, row.status, row.business_status, row.pause_reason]), [["Duka la Mama", "past_due", "paused", "billing"]]);

  const invoiceId = view.open_invoice.id;
  assert.equal((await api("POST", `/v1/platform/invoices/${invoiceId}/mark-paid`, {}, ops)).body.error, "receipt_required");
  assert.equal((await api("POST", `/v1/platform/invoices/${invoiceId}/mark-paid`, { receipt: "QWE123ABC4" }, owner)).status, 403, "a business can't mark its own invoice paid");
  const marked = await api("POST", `/v1/platform/invoices/${invoiceId}/mark-paid`, { receipt: "QWE123ABC4" }, ops);
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.deepEqual([marked.body.invoice.status, marked.body.invoice.method, marked.body.invoice.receipt], ["paid", "manual", "QWE123ABC4"]);
  assert.ok(Math.abs(Date.parse(marked.body.invoice.period_start) - Date.now()) < 60_000, "paused days aren't charged: its month starts now");
  assert.deepEqual(await statusOf(), { status: "active", pause_reason: null });
  assert.equal(await openSession(), 201, "customers are answered again");
  const receipt = await eventually(() => emails().find((email) => email.subject === `Receipt: Zaina invoice ${marked.body.invoice.number} is paid`), "the receipt");
  assert.match(receipt.text, /by hand \(receipt QWE123ABC4\)/);
  assert.match(receipt.text, /Zaina is answering your customers again\./);
  assert.equal((await api("POST", `/v1/platform/invoices/${invoiceId}/mark-paid`, { receipt: "again" }, ops)).body.error, "not_open");
});

test("a cancelled plan runs to the end of what's paid for; choosing again starts at once (the trial was used)", async () => {
  let view = (await staff("POST", "/billing/cancel")).body;
  assert.equal(view.subscription.cancel_at_period_end, true);
  view = (await staff("POST", "/billing/keep")).body;
  assert.equal(view.subscription.cancel_at_period_end, false);
  assert.equal((await staff("POST", "/billing/cancel")).body.subscription.cancel_at_period_end, true);
  assert.equal((await staff("POST", "/billing/cancel", undefined, manager)).status, 403);

  await moveSubscription("current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute'");
  await eventually(async () => (await billing()).subscription.status === "cancelled", "the plan's end");
  assert.deepEqual(await statusOf(), { status: "paused", pause_reason: "billing" });
  await eventually(() => emails().some((email) => email.subject === "Your Zaina plan for Duka la Mama has ended"), "the email");

  view = (await staff("POST", "/billing/plan", { plan_id: "pro" })).body;
  assert.equal(view.subscription.status, "incomplete", "no second trial");
  assert.equal(view.open_invoice.amount_minor, 600_000);
  assert.equal((await statusOf()).status, "paused", "paused until it's paid");

  // The team waives it: the month is free, and it counts for nothing in what was collected.
  const waived = await api("POST", `/v1/platform/invoices/${view.open_invoice.id}/mark-paid`, { waive: true }, ops);
  assert.equal(waived.body.invoice.method, "waived");
  assert.deepEqual(await statusOf(), { status: "active", pause_reason: null });
  assert.equal((await billing()).subscription.status, "active");
  const team = (await api("GET", "/v1/platform/billing", undefined, ops)).body;
  assert.deepEqual(team.collected_30d, [{ currency: "KES", amount_minor: 750_000 }], "three invoices of KSh 2,500; the waived one isn't money");
});

test("each business sees and pays only its own invoices", async () => {
  const other = await signUp({ name: "Otieno Were", email: "otieno@example.com", password: "LocalTest#2026" }, "Otieno Hardware", "otieno-hardware.example");
  assert.equal((await api("GET", `/v1/staff/businesses/${businessId}/billing`, undefined, other.token)).status, 404);
  const mine = (await billing()).invoices[0];
  const paying = await api("POST", `/v1/staff/businesses/${other.businessId}/billing/invoices/${mine.id}/pay`, undefined, other.token);
  assert.equal(paying.status, 404, "another business's invoice doesn't exist for it");
  assert.equal((await api("GET", "/v1/platform/billing", undefined, other.token)).status, 403);
});
