// zaina-platform/src/billing/store.ts
//
// Billing's records. Only the platform changes them, on the owner connection
// (as db/platform-scope.ts does); a business reads its own through row-level
// security (billingOf). Each change to a business's billing is one
// transaction holding its business, subscription and open invoice, so the
// owner's choices, a payment arriving and the sweep never cross.
//
// The rules (the platform team sets the prices; each business its plan):
//   choosing a plan  a free trial (one per business), or a first invoice due
//                    at once; a free plan starts at once
//   the next period  its invoice goes out a week ahead (halfway through a
//                    short trial) and is due when the period starts
//   unpaid           past due once due; a live business keeps answering for
//                    the grace period, then pauses until it's paid
//   paid             that period is paid for (from the day it's paid, for a
//                    business that wasn't answering meanwhile), and a
//                    business paused for it resumes at once
//   cancelling       at the end of what's paid for (or of the trial); at
//                    once when nothing is
//
// Only businesses that signed up by themselves choose plans; one the
// platform team added is billed by the team, outside Zaina.

import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { clearBusinessCache } from "../businesses/registry.ts";
import { ownerDb } from "../db/platform-db.ts";
import { inBusiness } from "../db/tenant.ts";
import {
  businesses,
  invoicePayments,
  invoices,
  plans,
  subscriptions,
  type Business,
  type Invoice,
  type InvoiceMethod,
  type InvoicePayment,
  type Plan,
  type Subscription,
} from "../db/schema.ts";
import { billingConfig } from "./config.ts";
import { tellOwners } from "./emails.ts";
import { invoiceNumber, invoiceSendAt, paidPeriodStart, pauseAt, periodEnd, trialEnd, type PlanInput } from "./periods.ts";

type Tx = Parameters<Parameters<ReturnType<typeof ownerDb>["transaction"]>[0]>[0];

/** A refusal the routes pass on as it is. */
export class BillingError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** What happened, for the owners' emails (sent once the change is saved). */
export type BillingEvent =
  | { kind: "invoice"; invoice: Invoice; trialEnds: Date | null }
  | { kind: "overdue"; invoice: Invoice; pausesAt: Date | null }
  | { kind: "paused"; invoice: Invoice }
  | { kind: "ended"; paused: boolean }
  | { kind: "paid"; invoice: Invoice; paidThrough: Date; resumed: boolean };

/** Statuses with a period running: a trial, a paid period, or one whose next invoice is overdue. */
const RUNNING = ["trialing", "active", "past_due"] as const;
export const inGoodStanding = (subscription: Pick<Subscription, "status"> | null | undefined) => subscription?.status === "trialing" || subscription?.status === "active";

// ── Plans (the platform team's price list) ────────────────────────────

export async function listPlans(options: { all?: boolean } = {}): Promise<Plan[]> {
  return ownerDb().select().from(plans)
    .where(options.all ? undefined : eq(plans.status, "active"))
    .orderBy(asc(plans.sortOrder), asc(plans.priceMinor), asc(plans.id));
}

export async function planById(id: string): Promise<Plan | undefined> {
  const [row] = await ownerDb().select().from(plans).where(eq(plans.id, id)).limit(1);
  return row;
}

/** Billing is on once the platform team offers a plan. */
export async function billingOn(): Promise<boolean> {
  const [row] = await ownerDb().select({ id: plans.id }).from(plans).where(eq(plans.status, "active")).limit(1);
  return Boolean(row);
}

export async function createPlan(input: PlanInput): Promise<Plan | "exists"> {
  try {
    const [row] = await ownerDb().insert(plans).values({
      id: input.id!, name: input.name!, description: input.description ?? "", priceMinor: input.priceMinor!, currency: input.currency!,
      billingInterval: input.billingInterval ?? "month", trialDays: input.trialDays ?? 0, conversationsPerMonth: input.conversationsPerMonth ?? null,
      status: input.status ?? "active", sortOrder: input.sortOrder ?? 0,
    }).returning();
    return row;
  } catch (error) {
    if ((((error as { cause?: unknown }).cause ?? error) as { code?: string }).code === "23505") return "exists";
    throw error;
  }
}

/** A changed price applies from each subscriber's next invoice; invoices already sent keep theirs. */
export async function updatePlan(id: string, patch: PlanInput): Promise<Plan | undefined> {
  const { id: _id, ...fields } = patch;
  const [row] = await ownerDb().update(plans).set({ ...fields, updatedAt: new Date() }).where(eq(plans.id, id)).returning();
  return row;
}

// ── What a business sees ───────────────────────────────────────────────

/** A business's subscription and latest invoices, read as the business (row-level security). */
export async function billingOf(businessId: string): Promise<{ subscription: Subscription | null; invoices: Invoice[] }> {
  return inBusiness(async (db) => {
    const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).limit(1);
    const list = await db.select().from(invoices).where(eq(invoices.businessId, businessId)).orderBy(desc(invoices.createdAt)).limit(24);
    return { subscription: subscription ?? null, invoices: list };
  }, businessId);
}

// ── Changing a business's billing ──────────────────────────────────────

type Change = {
  tx: Tx;
  now: Date;
  business: Business;
  subscription: Subscription | undefined;
  open: Invoice | undefined;
  events: BillingEvent[];
  /** Set when the business was paused or resumed: its cached status is stale. */
  statusChanged: boolean;
};

/** Runs one change to a business's billing in a transaction holding its rows; the owners hear what happened once it's saved. */
async function changeBilling<T>(businessId: string, now: Date, fn: (change: Change) => Promise<T>): Promise<T> {
  const box: { change: Change | null } = { change: null };
  const value = await ownerDb().transaction(async (tx) => {
    // Always the business, then its subscription, then its invoice: one order, so changes never deadlock.
    const [business] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).for("update").limit(1);
    if (!business) throw new BillingError(404, "not_found", "That business wasn't found.");
    const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).for("update").limit(1);
    const [open] = await tx.select().from(invoices).where(and(eq(invoices.businessId, businessId), eq(invoices.status, "open"))).for("update").limit(1);
    box.change = { tx, now, business, subscription, open, events: [], statusChanged: false };
    return fn(box.change);
  });
  const change = box.change as Change | null;
  if (change?.statusChanged) clearBusinessCache();
  if (change?.events.length) {
    void tellOwners(businessId, change.events).catch((error) => console.error(`[billing] ${businessId}: emails failed:`, error));
  }
  return value;
}

async function issueInvoice(change: Change, plan: Plan, periodStart: Date, dueAt: Date): Promise<Invoice> {
  const { rows: [next] } = await change.tx.execute<{ n: string }>(sql`select nextval('invoice_numbers') as n`);
  const [invoice] = await change.tx.insert(invoices).values({
    businessId: change.business.id,
    number: invoiceNumber(Number(next.n)),
    planId: plan.id,
    planName: plan.name,
    billingInterval: plan.billingInterval,
    periodStart,
    periodEnd: periodEnd(periodStart, plan.billingInterval, change.business.timeZone),
    amountMinor: plan.priceMinor,
    currency: plan.currency,
    status: "open",
    dueAt,
  }).returning();
  return invoice;
}

async function voidOpenInvoice(change: Change): Promise<void> {
  const [open] = await change.tx.select().from(invoices).where(and(eq(invoices.businessId, change.business.id), eq(invoices.status, "open"))).limit(1);
  if (open) await change.tx.update(invoices).set({ status: "void", voidedAt: change.now }).where(eq(invoices.id, open.id));
}

async function setSubscription(change: Change, fields: Partial<typeof subscriptions.$inferInsert>): Promise<void> {
  await change.tx.update(subscriptions).set({ ...fields, updatedAt: change.now }).where(eq(subscriptions.businessId, change.business.id));
}

/** A live business stops answering customers until it pays. */
async function pauseForBilling(change: Change): Promise<boolean> {
  const [paused] = await change.tx.update(businesses).set({ status: "paused", pauseReason: "billing", updatedAt: change.now })
    .where(and(eq(businesses.id, change.business.id), eq(businesses.status, "active"))).returning({ id: businesses.id });
  if (paused) change.statusChanged = true;
  return Boolean(paused);
}

/** A business paused for an unpaid invoice answers again (one the platform team paused stays paused). */
async function resumeFromBilling(change: Change): Promise<boolean> {
  const [resumed] = await change.tx.update(businesses).set({ status: "active", pauseReason: null, updatedAt: change.now })
    .where(and(eq(businesses.id, change.business.id), eq(businesses.status, "paused"), eq(businesses.pauseReason, "billing"))).returning({ id: businesses.id });
  if (resumed) change.statusChanged = true;
  return Boolean(resumed);
}

/**
 * Moves a business's billing on to where `now` says it should be: the plan
 * ending as asked, a free plan's next period, the next invoice a week
 * ahead, an unpaid invoice past due and, after the grace period, a live
 * business paused. Run after every change and by the sweep.
 */
async function advance(change: Change): Promise<void> {
  const { tx, now } = change;
  const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.businessId, change.business.id)).limit(1);
  if (!subscription || !(RUNNING as readonly string[]).includes(subscription.status) || !subscription.currentPeriodStart || !subscription.currentPeriodEnd) return;
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, change.business.id)).limit(1);
  const [plan] = await tx.select().from(plans).where(eq(plans.id, subscription.planId)).limit(1);
  let [open] = await tx.select().from(invoices).where(and(eq(invoices.businessId, business.id), eq(invoices.status, "open"))).limit(1);
  const periodEndsAt = subscription.currentPeriodEnd;

  // The plan ends, as the owner asked: at the end of what was paid for.
  if (subscription.cancelAtPeriodEnd && now >= periodEndsAt) {
    await voidOpenInvoice(change);
    await setSubscription(change, { status: "cancelled", cancelAtPeriodEnd: false });
    change.events.push({ kind: "ended", paused: await pauseForBilling(change) });
    return;
  }

  // A free plan runs on, a period at a time.
  if (plan.priceMinor === 0) {
    if (open) await voidOpenInvoice(change);
    let start = subscription.currentPeriodStart;
    let end = periodEndsAt;
    for (let step = 0; now >= end && step < 1200; step += 1) {
      start = end;
      end = periodEnd(end, plan.billingInterval, business.timeZone);
    }
    if (end.getTime() !== periodEndsAt.getTime() || subscription.status !== "active") {
      await setSubscription(change, { status: "active", currentPeriodStart: start, currentPeriodEnd: end });
    }
    await resumeFromBilling(change);
    return;
  }

  // The next period's invoice, a week ahead (none while the plan is ending).
  if (!open && !subscription.cancelAtPeriodEnd && now >= invoiceSendAt(subscription.currentPeriodStart, periodEndsAt)) {
    open = await issueInvoice(change, plan, periodEndsAt, periodEndsAt);
    change.events.push({ kind: "invoice", invoice: open, trialEnds: subscription.status === "trialing" ? periodEndsAt : null });
  }

  // Unpaid when due: past due; a live business pauses after the grace period.
  if (open && now >= open.dueAt) {
    const pausesAt = pauseAt(open.dueAt, billingConfig().graceDays);
    if (subscription.status !== "past_due") {
      await setSubscription(change, { status: "past_due" });
      change.events.push({ kind: "overdue", invoice: open, pausesAt: business.status === "active" && now < pausesAt ? pausesAt : null });
    }
    if (now >= pausesAt && await pauseForBilling(change)) change.events.push({ kind: "paused", invoice: open });
  }
}

/**
 * An invoice paid (through Paystack, by hand, or waived by the platform
 * team): its period is paid for, and a business paused for it resumes.
 */
async function payInvoice(change: Change, invoice: Invoice, how: { method: InvoiceMethod; receipt: string | null; recordedBy: string | null }): Promise<Invoice | null> {
  const { tx, now } = change;
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, change.business.id)).limit(1);
  const start = paidPeriodStart(invoice.periodStart, now, business.status === "active");
  const end = start.getTime() === invoice.periodStart.getTime() ? invoice.periodEnd : periodEnd(start, invoice.billingInterval, business.timeZone);
  const [paid] = await tx.update(invoices)
    .set({ status: "paid", paidAt: now, method: how.method, receipt: how.receipt, recordedBy: how.recordedBy, periodStart: start, periodEnd: end })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.status, "open")))
    .returning();
  if (!paid) return null;
  await setSubscription(change, { status: "active", currentPeriodStart: start, currentPeriodEnd: end });
  const resumed = await resumeFromBilling(change);
  change.events.push({ kind: "paid", invoice: paid, paidThrough: end, resumed });
  return paid;
}

/** Starting on a plan from nothing (or after one ended): a free plan at once, a trial once, or a first invoice due now. */
async function startPlan(change: Change, plan: Plan): Promise<void> {
  const { now, subscription } = change;
  const trialUsed = Boolean(subscription?.trialEndsAt);
  let fields: Omit<typeof subscriptions.$inferInsert, "businessId">;
  if (plan.priceMinor === 0) {
    fields = { planId: plan.id, status: "active", currentPeriodStart: now, currentPeriodEnd: periodEnd(now, plan.billingInterval, change.business.timeZone) };
  } else if (plan.trialDays > 0 && !trialUsed) {
    const ends = trialEnd(now, plan.trialDays);
    fields = { planId: plan.id, status: "trialing", trialEndsAt: ends, currentPeriodStart: now, currentPeriodEnd: ends };
  } else {
    fields = { planId: plan.id, status: "incomplete", currentPeriodStart: null, currentPeriodEnd: null };
  }
  await change.tx.insert(subscriptions)
    .values({ businessId: change.business.id, ...fields, cancelAtPeriodEnd: false })
    .onConflictDoUpdate({ target: subscriptions.businessId, set: { ...fields, cancelAtPeriodEnd: false, updatedAt: now } });
  if (fields.status === "incomplete") change.events.push({ kind: "invoice", invoice: await issueInvoice(change, plan, now, now), trialEnds: null });
  if (fields.status === "active") await resumeFromBilling(change);
}

/**
 * The owner chooses a plan: to start, to start again, or to change. A
 * change keeps what's paid for (or the trial) and prices the next invoice
 * at the new plan; an invoice already overdue is sent again at the new
 * price, due when it was.
 */
export async function choosePlan(businessId: string, planId: string, now = new Date()): Promise<void> {
  const plan = await planById(planId);
  if (!plan || plan.status !== "active") throw new BillingError(404, "plan_not_found", "That plan isn't offered.");
  await changeBilling(businessId, now, async (change) => {
    const { subscription, business, open } = change;
    if (!subscription && business.source !== "self_serve") {
      throw new BillingError(409, "billed_by_team", "The Zaina team bills this business directly.");
    }
    if (subscription && subscription.status !== "cancelled" && subscription.planId === plan.id) {
      if (!subscription.cancelAtPeriodEnd) throw new BillingError(409, "same_plan", "You're on this plan already.");
      await setSubscription(change, { cancelAtPeriodEnd: false });
    } else if (!subscription || subscription.status === "cancelled" || subscription.status === "incomplete") {
      await voidOpenInvoice(change);
      await startPlan(change, plan);
    } else {
      await voidOpenInvoice(change);
      await setSubscription(change, { planId: plan.id, cancelAtPeriodEnd: false });
      if (subscription.status === "past_due" && open && plan.priceMinor > 0) {
        change.events.push({ kind: "invoice", invoice: await issueInvoice(change, plan, open.periodStart, open.dueAt), trialEnds: null });
      }
    }
    await advance(change);
  });
}

/** The owner stops: at the end of what's paid for (or the trial), or at once when nothing is. */
export async function cancelPlan(businessId: string, now = new Date()): Promise<{ endsAt: Date | null }> {
  return changeBilling(businessId, now, async (change) => {
    const { subscription } = change;
    if (!subscription || subscription.status === "cancelled") throw new BillingError(409, "no_plan", "There's no plan to cancel.");
    await voidOpenInvoice(change);
    if (subscription.status === "trialing" || subscription.status === "active") {
      if (!subscription.cancelAtPeriodEnd) await setSubscription(change, { cancelAtPeriodEnd: true });
      return { endsAt: subscription.currentPeriodEnd };
    }
    // Past due or never paid: nothing is paid for, so it ends now (and a live business past due stops answering).
    await setSubscription(change, { status: "cancelled", cancelAtPeriodEnd: false });
    if (subscription.status === "past_due") await pauseForBilling(change);
    return { endsAt: null };
  });
}

/** The owner changes their mind before the plan ends. */
export async function keepPlan(businessId: string, now = new Date()): Promise<void> {
  await changeBilling(businessId, now, async (change) => {
    if (!change.subscription?.cancelAtPeriodEnd) throw new BillingError(409, "not_ending", "Your plan isn't ending.");
    await setSubscription(change, { cancelAtPeriodEnd: false });
    await advance(change);
  });
}

/** The platform team records an invoice paid by hand (bank or M-Pesa), or waives it. */
export async function markInvoicePaid(invoiceId: string, input: { method: "manual" | "waived"; receipt: string | null; recordedBy: string }, now = new Date()): Promise<Invoice> {
  const invoice = await invoiceById(invoiceId);
  if (!invoice) throw new BillingError(404, "not_found", "That invoice wasn't found.");
  return changeBilling(invoice.businessId, now, async (change) => {
    if (change.open?.id !== invoice.id) throw new BillingError(409, "not_open", "That invoice isn't open: it's paid or void already.");
    const paid = await payInvoice(change, change.open, { method: input.method, receipt: input.receipt, recordedBy: input.recordedBy });
    await advance(change);
    return paid!;
  });
}

/** The platform team voids an open invoice: it isn't owed. A plan still running gets its next invoice at the plan's current price. */
export async function voidInvoice(invoiceId: string, now = new Date()): Promise<void> {
  const invoice = await invoiceById(invoiceId);
  if (!invoice) throw new BillingError(404, "not_found", "That invoice wasn't found.");
  await changeBilling(invoice.businessId, now, async (change) => {
    if (change.open?.id !== invoice.id) throw new BillingError(409, "not_open", "That invoice isn't open: it's paid or void already.");
    await voidOpenInvoice(change);
    await advance(change);
  });
}

/** Moves every running plan on (the sweep): invoices out, overdue ones marked, businesses paused, ended plans closed. */
export async function sweepBilling(now = new Date()): Promise<number> {
  // Only plans with something due within the week: the next invoice's notice is at most seven days.
  const due = await ownerDb().select({ businessId: subscriptions.businessId }).from(subscriptions).where(and(
    inArray(subscriptions.status, [...RUNNING]),
    isNotNull(subscriptions.currentPeriodEnd),
    lte(subscriptions.currentPeriodEnd, new Date(now.getTime() + 7 * 86_400_000)),
  ));
  let moved = 0;
  for (const { businessId } of due) {
    try {
      await changeBilling(businessId, now, async (change) => {
        await advance(change);
        if (change.events.length || change.statusChanged) moved += 1;
      });
    } catch (error) {
      console.error(`[billing] ${businessId}: moving its plan on failed:`, error);
    }
  }
  return moved;
}

export async function invoiceById(id: string): Promise<Invoice | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await ownerDb().select().from(invoices).where(eq(invoices.id, id)).limit(1);
  return row;
}

// ── Paying through Paystack ───────────────────────────────────────────

/** The try at paying an invoice that's still under way and recent enough to finish (its Paystack page is reused). */
export async function pendingPaymentFor(invoiceId: string, since: Date): Promise<InvoicePayment | undefined> {
  const [row] = await ownerDb().select().from(invoicePayments)
    .where(and(eq(invoicePayments.invoiceId, invoiceId), eq(invoicePayments.status, "pending"), sql`${invoicePayments.createdAt} > ${since}`, isNotNull(invoicePayments.authorizationUrl)))
    .orderBy(desc(invoicePayments.createdAt)).limit(1);
  return row;
}

export async function recordPaymentStart(invoice: Invoice, input: { reference: string; payerEmail: string }): Promise<InvoicePayment> {
  const [row] = await ownerDb().insert(invoicePayments).values({
    businessId: invoice.businessId, invoiceId: invoice.id, reference: input.reference, amountMinor: invoice.amountMinor, currency: invoice.currency, payerEmail: input.payerEmail,
  }).returning();
  return row;
}

export async function setPaymentPage(paymentId: string, authorizationUrl: string): Promise<void> {
  await ownerDb().update(invoicePayments).set({ authorizationUrl }).where(eq(invoicePayments.id, paymentId));
}

export async function paymentByReference(reference: string): Promise<InvoicePayment | undefined> {
  if (!/^zi_[0-9a-f]{24}$/.test(reference)) return undefined;
  const [row] = await ownerDb().select().from(invoicePayments).where(eq(invoicePayments.reference, reference)).limit(1);
  return row;
}

/** Payments still under way that Paystack may have settled without telling us. */
export async function pendingPayments(olderThan: Date, limit = 50): Promise<InvoicePayment[]> {
  return ownerDb().select().from(invoicePayments)
    .where(and(eq(invoicePayments.status, "pending"), lte(invoicePayments.createdAt, olderThan)))
    .orderBy(asc(invoicePayments.createdAt)).limit(limit);
}

export type ChargeOutcome = "paid" | "failed" | "pending";

/**
 * What Paystack says about a payment (its webhook, the owner coming back,
 * or the sweep asking). Idempotent: a payment settles once. Money that
 * arrives for an invoice already paid or void is kept on record, to be
 * refunded in Paystack.
 */
export async function settleInvoicePayment(
  payment: InvoicePayment,
  result: { status: string; amountMinor: number; currency: string; transactionId: string | null; message: string | null },
  now = new Date(),
): Promise<ChargeOutcome> {
  return changeBilling(payment.businessId, now, async (change) => {
    const { tx } = change;
    const [current] = await tx.select().from(invoicePayments).where(eq(invoicePayments.id, payment.id)).for("update").limit(1);
    if (current.status !== "pending") return current.status === "succeeded" ? "paid" : "failed";
    const settle = (fields: Partial<typeof invoicePayments.$inferInsert>) => tx.update(invoicePayments).set({ ...fields, settledAt: now }).where(eq(invoicePayments.id, payment.id));
    if (result.status === "success") {
      if (result.amountMinor !== current.amountMinor || result.currency !== current.currency) {
        console.error(`[billing] ${payment.businessId}: Paystack paid ${result.amountMinor} ${result.currency} on ${payment.reference}, asked ${current.amountMinor} ${current.currency}`);
        await settle({ status: "failed", receipt: result.transactionId, note: `Paystack reported ${result.amountMinor / 100} ${result.currency}, not the amount asked: check it in Paystack.` });
        return "failed";
      }
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, current.invoiceId)).limit(1);
      if (invoice.status !== "open") {
        console.error(`[billing] ${payment.businessId}: ${payment.reference} paid invoice ${invoice.number}, which is ${invoice.status} already: refund it in Paystack`);
        await settle({ status: "succeeded", receipt: result.transactionId, note: `Paid after invoice ${invoice.number} was ${invoice.status === "paid" ? "paid" : "voided"}: refund this payment in Paystack.` });
        return "paid";
      }
      await settle({ status: "succeeded", receipt: result.transactionId });
      await payInvoice(change, invoice, { method: "paystack", receipt: result.transactionId, recordedBy: null });
      await advance(change);
      return "paid";
    }
    if (result.status === "failed" || result.status === "reversed") {
      await settle({ status: "failed", note: result.message ?? `Paystack: ${result.status}` });
      return "failed";
    }
    return "pending";
  });
}

// ── The platform team's view ──────────────────────────────────────────

export type PlatformBilling = {
  subscriptions: Array<Subscription & { businessName: string; businessStatus: string; pauseReason: string | null; planName: string }>;
  invoices: Array<Invoice & { businessName: string }>;
  attention: Array<InvoicePayment & { businessName: string; invoiceNumber: string }>;
  collected30d: Array<{ currency: string; amountMinor: number }>;
};

export async function platformBilling(now = new Date()): Promise<PlatformBilling> {
  const db = ownerDb();
  const subscriptionRows = await db.select({ subscription: subscriptions, businessName: businesses.name, businessStatus: businesses.status, pauseReason: businesses.pauseReason, planName: plans.name })
    .from(subscriptions)
    .innerJoin(businesses, eq(businesses.id, subscriptions.businessId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .orderBy(asc(businesses.name));
  const invoiceRows = await db.select({ invoice: invoices, businessName: businesses.name })
    .from(invoices)
    .innerJoin(businesses, eq(businesses.id, invoices.businessId))
    .orderBy(sql`${invoices.status} = 'open' desc`, desc(invoices.createdAt))
    .limit(100);
  // Money that arrived without paying an invoice: paid after the invoice was paid or void, or for
  // another amount (Paystack's transaction is kept). Declined and abandoned tries aren't money.
  const attentionRows = await db.select({ payment: invoicePayments, businessName: businesses.name, invoiceNumber: invoices.number })
    .from(invoicePayments)
    .innerJoin(businesses, eq(businesses.id, invoicePayments.businessId))
    .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
    .where(sql`(${invoicePayments.status} = 'succeeded' and ${invoicePayments.note} is not null) or (${invoicePayments.status} = 'failed' and ${invoicePayments.receipt} is not null)`)
    .orderBy(desc(invoicePayments.createdAt))
    .limit(50);
  const collected = await db.select({ currency: invoices.currency, amountMinor: sql<string>`sum(${invoices.amountMinor})` })
    .from(invoices)
    .where(and(eq(invoices.status, "paid"), inArray(invoices.method, ["paystack", "manual"]), sql`${invoices.paidAt} > ${new Date(now.getTime() - 30 * 86_400_000)}`))
    .groupBy(invoices.currency)
    .orderBy(asc(invoices.currency));
  return {
    subscriptions: subscriptionRows.map((row) => ({ ...row.subscription, businessName: row.businessName, businessStatus: row.businessStatus, pauseReason: row.pauseReason, planName: row.planName })),
    invoices: invoiceRows.map((row) => ({ ...row.invoice, businessName: row.businessName })),
    attention: attentionRows.map((row) => ({ ...row.payment, businessName: row.businessName, invoiceNumber: row.invoiceNumber })),
    collected30d: collected.map((row) => ({ currency: row.currency, amountMinor: Number(row.amountMinor) })),
  };
}
