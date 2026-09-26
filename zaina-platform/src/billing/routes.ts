// zaina-platform/src/billing/routes.ts
//
// Billing, for a business's team (/v1/staff/businesses/:businessId/…):
//
//   GET  billing                          viewer  its plan, invoices, the plans offered, how to pay
//   POST billing/plan                     owner   { plan_id }: start, start again or change plan
//   POST billing/cancel                   owner   stop at the end of what's paid for (at once when nothing is)
//   POST billing/keep                     owner   carry on after all
//   POST billing/invoices/:invoiceId/pay  owner   → { authorization_url }: Paystack's page (card or M-Pesa)
//
//   GET  /v1/billing/paystack/return      back from Paystack's page: asks how it went, then on to the console
//
// And for the platform's own admins:
//
//   GET   /v1/platform/plans                          every plan, offered or hidden
//   POST  /v1/platform/plans                          { id, name, price_minor, currency, billing_interval?, trial_days?,
//                                                       conversations_per_month?, description?, status?, sort_order? }
//   PATCH /v1/platform/plans/:planId                  any of those but the id (status: hidden stops offering it)
//   GET   /v1/platform/billing                        plans in use, invoices, payments to look at, money collected
//   POST  /v1/platform/invoices/:invoiceId/mark-paid  { receipt }: paid by hand; or { waive: true }
//   POST  /v1/platform/invoices/:invoiceId/void       not owed (a plan still running gets its next invoice at the current price)

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { anyBusinessById } from "../businesses/registry.ts";
import { zonedInstant, localParts } from "../booking/local-time.ts";
import { formatMoney } from "../booking/money.ts";
import type { Business, Invoice, Plan, StaffRole, Subscription } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { requireBusinessRole, requirePlatformAdmin, requireStaff, staffOf } from "../staff/auth.ts";
import { billingConfig, paysOnline } from "./config.ts";
import { dayText } from "./emails.ts";
import { checkInvoiceReturn, INVOICE_REFERENCE, startInvoicePayment } from "./payments.ts";
import { pauseAt, priceText, validatePlan } from "./periods.ts";
import {
  BillingError,
  billingOf,
  billingOn,
  cancelPlan,
  choosePlan,
  createPlan,
  inGoodStanding,
  keepPlan,
  listPlans,
  markInvoicePaid,
  planById,
  platformBilling,
  updatePlan,
  voidInvoice,
} from "./store.ts";

export function planView(plan: Plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price_minor: plan.priceMinor,
    currency: plan.currency,
    billing_interval: plan.billingInterval,
    trial_days: plan.trialDays,
    conversations_per_month: plan.conversationsPerMonth,
    status: plan.status,
    sort_order: plan.sortOrder,
    price_text: priceText(plan),
  };
}

function invoiceView(invoice: Invoice, now: Date) {
  return {
    id: invoice.id,
    number: invoice.number,
    plan_id: invoice.planId,
    plan_name: invoice.planName,
    billing_interval: invoice.billingInterval,
    period_start: invoice.periodStart,
    period_end: invoice.periodEnd,
    amount_minor: invoice.amountMinor,
    currency: invoice.currency,
    status: invoice.status,
    due_at: invoice.dueAt,
    overdue: invoice.status === "open" && now >= invoice.dueAt,
    paid_at: invoice.paidAt,
    method: invoice.method,
    receipt: invoice.receipt,
  };
}

function subscriptionView(subscription: Subscription, plan: Plan | undefined) {
  return {
    plan: plan ? planView(plan) : null,
    status: subscription.status,
    trial_ends_at: subscription.trialEndsAt,
    current_period_start: subscription.currentPeriodStart,
    current_period_end: subscription.currentPeriodEnd,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
  };
}

/** Customers' conversations since the 1st of this month on the business's clock (a plan's size is shown against it, not enforced). */
async function conversationsThisMonth(business: Business, now: Date): Promise<number> {
  const monthStart = zonedInstant(`${localParts(business.timeZone, now).date.slice(0, 8)}01`, "00:00", business.timeZone);
  return inBusiness(async (_db, client) => {
    const { rows: [row] } = await client.query<{ n: number }>(
      `select count(*)::int as n from chat_sessions as s
        where s.business_id = $1 and not s.preview and s.created_at >= $2
          and exists (select 1 from chat_events as e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER')`,
      [business.id, monthStart],
    );
    return row?.n ?? 0;
  }, business.id);
}

/** The go-live checklist's plan step, for a business that signed up by itself, once the platform offers plans. */
export async function planStep(business: Business): Promise<{ done: boolean; detail: string } | null> {
  if (business.source !== "self_serve" || !(await billingOn())) return null;
  const { subscription, invoices } = await billingOf(business.id);
  const plan = subscription ? await planById(subscription.planId) : undefined;
  if (subscription && plan && inGoodStanding(subscription) && subscription.currentPeriodEnd) {
    const until = dayText(subscription.currentPeriodEnd, business.timeZone);
    return { done: true, detail: subscription.status === "trialing" ? `${plan.name}: free trial until ${until}.` : `${plan.name}, paid through ${until}.` };
  }
  const open = invoices.find((invoice) => invoice.status === "open");
  if (open) return { done: false, detail: `Pay invoice ${open.number} (${formatMoney(open.amountMinor, open.currency)}) to start your ${open.planName} plan.` };
  return { done: false, detail: "Choose the plan that fits your business. A plan with a free trial starts at once." };
}

type Handler = (req: Request, res: Response, context: { business: Business; role: StaffRole; email: string; userId: string }) => Promise<unknown>;

function handle(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = staffOf(req);
      await handler(req, res, { business: context.business!, role: context.role!, email: context.user.email, userId: context.user.id });
    } catch (error) {
      if (error instanceof BillingError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      next(error);
    }
  };
}

function platformHandle(handler: (req: Request, res: Response, userId: string) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, staffOf(req).user.id);
    } catch (error) {
      if (error instanceof BillingError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      next(error);
    }
  };
}

export function registerBillingRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId";
  const role = (minimum: StaffRole) => [staff, requireBusinessRole(minimum)];
  const origin = config.publicBaseUrl ?? "";

  async function view(businessId: string, role: StaffRole) {
    const now = new Date();
    const business = (await anyBusinessById(businessId))!;
    const [offered, mine, used] = await Promise.all([listPlans(), billingOf(business.id), conversationsThisMonth(business, now)]);
    const subscription = mine.subscription;
    const plan = subscription ? await planById(subscription.planId) : undefined;
    const open = mine.invoices.find((invoice) => invoice.status === "open") ?? null;
    const { graceDays, paymentInstructions } = billingConfig();
    return {
      enabled: offered.length > 0,
      billed_by_team: !subscription && business.source !== "self_serve",
      can_manage: role === "owner",
      business: { status: business.status, pause_reason: business.pauseReason },
      plans: offered.map(planView),
      subscription: subscription ? subscriptionView(subscription, plan) : null,
      trial_available: !subscription?.trialEndsAt,
      open_invoice: open ? invoiceView(open, now) : null,
      pauses_at: open && subscription?.status === "past_due" && business.status === "active" ? pauseAt(open.dueAt, graceDays) : null,
      invoices: mine.invoices.map((invoice) => invoiceView(invoice, now)),
      conversations_this_month: used,
      pay_online: paysOnline(),
      payment_instructions: paymentInstructions,
      grace_days: graceDays,
    };
  }

  app.get(`${base}/billing`, ...role("viewer"), handle(async (_req, res, { business, role }) => {
    res.json(await view(business.id, role));
  }));

  app.post(`${base}/billing/plan`, ...role("owner"), handle(async (req, res, { business, role }) => {
    const planId = typeof req.body?.plan_id === "string" ? req.body.plan_id : "";
    if (!planId) return res.status(400).json({ error: "plan_required", message: "Which plan?" });
    await choosePlan(business.id, planId);
    res.json(await view(business.id, role));
  }));

  app.post(`${base}/billing/cancel`, ...role("owner"), handle(async (_req, res, { business, role }) => {
    await cancelPlan(business.id);
    res.json(await view(business.id, role));
  }));

  app.post(`${base}/billing/keep`, ...role("owner"), handle(async (_req, res, { business, role }) => {
    await keepPlan(business.id);
    res.json(await view(business.id, role));
  }));

  app.post(`${base}/billing/invoices/:invoiceId/pay`, ...role("owner"), handle(async (req, res, { business, email }) => {
    const verdict = await consumeLimits([{ key: `billing-pay:${business.id}`, limit: 10, windowSeconds: 600 }]);
    if (!verdict.allowed) return res.status(429).json({ error: "rate_limited", message: "That's a lot of tries: please wait a few minutes." });
    res.json({ authorization_url: await startInvoicePayment(business.id, String(req.params.invoiceId), email) });
  }));

  // Paystack sends the owner back with ?trxref=…&reference=…
  app.get("/v1/billing/paystack/return", async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      const reference = typeof req.query.reference === "string" ? req.query.reference : typeof req.query.trxref === "string" ? req.query.trxref : "";
      const checked = INVOICE_REFERENCE.test(reference) ? await checkInvoiceReturn(reference) : null;
      res.redirect(303, checked ? `${origin}/console/#/b/${encodeURIComponent(checked.businessId)}/settings/billing?paid=${checked.outcome}` : `${origin}/console/`);
    } catch (error) {
      next(error);
    }
  });

  // ── The platform's admins ─────────────────────────────────────────────

  app.get("/v1/platform/plans", staff, requirePlatformAdmin, platformHandle(async (_req, res) => {
    res.json({ plans: (await listPlans({ all: true })).map(planView) });
  }));

  app.post("/v1/platform/plans", staff, requirePlatformAdmin, platformHandle(async (req, res) => {
    const checked = validatePlan(req.body, true);
    if (!checked.ok) return res.status(400).json({ error: "invalid_plan", message: checked.error });
    const created = await createPlan(checked.value);
    if (created === "exists") return res.status(409).json({ error: "plan_exists", message: "A plan with that id exists already." });
    res.status(201).json({ plan: planView(created) });
  }));

  app.patch("/v1/platform/plans/:planId", staff, requirePlatformAdmin, platformHandle(async (req, res) => {
    const checked = validatePlan(req.body, false);
    if (!checked.ok) return res.status(400).json({ error: "invalid_plan", message: checked.error });
    const updated = await updatePlan(String(req.params.planId), checked.value);
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json({ plan: planView(updated) });
  }));

  app.get("/v1/platform/billing", staff, requirePlatformAdmin, platformHandle(async (_req, res) => {
    const now = new Date();
    const billing = await platformBilling(now);
    const { graceDays } = billingConfig();
    res.json({
      subscriptions: billing.subscriptions.map((row) => ({
        business_id: row.businessId,
        business_name: row.businessName,
        business_status: row.businessStatus,
        pause_reason: row.pauseReason,
        plan_id: row.planId,
        plan_name: row.planName,
        status: row.status,
        trial_ends_at: row.trialEndsAt,
        current_period_end: row.currentPeriodEnd,
        cancel_at_period_end: row.cancelAtPeriodEnd,
      })),
      invoices: billing.invoices.map((row) => ({
        ...invoiceView(row, now),
        business_id: row.businessId,
        business_name: row.businessName,
        pauses_at: row.status === "open" ? pauseAt(row.dueAt, graceDays) : null,
      })),
      attention: billing.attention.map((row) => ({
        reference: row.reference,
        business_name: row.businessName,
        invoice_number: row.invoiceNumber,
        amount_minor: row.amountMinor,
        currency: row.currency,
        status: row.status,
        note: row.note,
        created_at: row.createdAt,
      })),
      collected_30d: billing.collected30d.map((row) => ({ currency: row.currency, amount_minor: row.amountMinor })),
      pay_online: paysOnline(),
      grace_days: graceDays,
    });
  }));

  app.post("/v1/platform/invoices/:invoiceId/mark-paid", staff, requirePlatformAdmin, platformHandle(async (req, res, userId) => {
    const waive = req.body?.waive === true;
    const receipt = typeof req.body?.receipt === "string" ? req.body.receipt.trim() : "";
    if (!waive && (!receipt || receipt.length > 120)) {
      return res.status(400).json({ error: "receipt_required", message: "The payment's receipt or reference (an M-Pesa code, a bank reference), up to 120 characters." });
    }
    const paid = await markInvoicePaid(String(req.params.invoiceId), { method: waive ? "waived" : "manual", receipt: receipt || null, recordedBy: userId });
    res.json({ invoice: invoiceView(paid, new Date()) });
  }));

  app.post("/v1/platform/invoices/:invoiceId/void", staff, requirePlatformAdmin, platformHandle(async (req, res) => {
    await voidInvoice(String(req.params.invoiceId));
    res.json({ ok: true });
  }));
}
