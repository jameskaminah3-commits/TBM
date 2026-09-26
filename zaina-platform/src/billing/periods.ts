// zaina-platform/src/billing/periods.ts
//
// Billing's arithmetic, kept pure: a period is a month or a year on the
// business's own clock (the 31st becomes the last day of a shorter month),
// invoice numbers, when an invoice is sent ahead of its period, where a paid
// period starts, and the platform team's checks on a plan.

import { localParts, zonedInstant } from "../booking/local-time.ts";
import { formatMoney } from "../booking/money.ts";
import { bookingCurrencies, billingIntervals, type BillingInterval, type BookingCurrency, type Plan } from "../db/schema.ts";

const DAY_MS = 86_400_000;

/** How long before a period starts its invoice is sent (half the current period when that's shorter, as for a short trial). */
export const INVOICE_NOTICE_DAYS = 7;

/** The end of a period starting at `start`: a month or a year later, at the same time on the business's clock. */
export function periodEnd(start: Date, interval: BillingInterval, timeZone: string): Date {
  const local = localParts(timeZone, start);
  const [year, month, day] = local.date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + (interval === "year" ? 12 : 1), 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const date = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  // The local clock keeps minutes; the seconds come back from the start.
  return new Date(zonedInstant(date, local.time, timeZone).getTime() + (start.getTime() % 60_000));
}

export const trialEnd = (start: Date, days: number) => new Date(start.getTime() + days * DAY_MS);

/** ZN-000123 */
export const invoiceNumber = (sequence: number) => `ZN-${String(sequence).padStart(6, "0")}`;

/** When the invoice for the period after [start, end) is sent: a week before, or halfway for a shorter period. */
export function invoiceSendAt(start: Date, end: Date): Date {
  const notice = Math.min(INVOICE_NOTICE_DAYS * DAY_MS, (end.getTime() - start.getTime()) / 2);
  return new Date(end.getTime() - notice);
}

/** When an invoice unpaid since `dueAt` pauses its business. */
export const pauseAt = (dueAt: Date, graceDays: number) => new Date(dueAt.getTime() + graceDays * DAY_MS);

/**
 * Where the period an invoice pays for starts. A business that was answering
 * customers all along (live, and not paused) keeps its invoice's period, so
 * the days it ran on while the invoice was due are paid for. One that wasn't
 * (paused for the invoice, or still setting up) starts its period when it
 * pays: days it couldn't use aren't charged.
 */
export function paidPeriodStart(invoiceStart: Date, paidAt: Date, served: boolean): Date {
  return served || paidAt.getTime() <= invoiceStart.getTime() ? invoiceStart : paidAt;
}

/** "KSh 2,500 a month", "$300 a year", "Free". */
export function priceText(plan: Pick<Plan, "priceMinor" | "currency" | "billingInterval">): string {
  return plan.priceMinor === 0 ? "Free" : `${formatMoney(plan.priceMinor, plan.currency)} a ${plan.billingInterval}`;
}

// ── The platform team's plans ─────────────────────────────────────────

export type PlanInput = {
  id?: string;
  name?: string;
  description?: string;
  priceMinor?: number;
  currency?: BookingCurrency;
  billingInterval?: BillingInterval;
  trialDays?: number;
  conversationsPerMonth?: number | null;
  status?: "active" | "hidden";
  sortOrder?: number;
};

const whole = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

/** A plan from the platform team's form: every field on creating, only those sent on changing. */
export function validatePlan(input: unknown, creating: boolean): { ok: true; value: PlanInput } | { ok: false; error: string } {
  const body = (input ?? {}) as Record<string, unknown>;
  const value: PlanInput = {};
  const has = (key: string) => creating || key in body;
  if (creating) {
    if (typeof body.id !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(body.id)) return { ok: false, error: "id is lowercase letters, digits and dashes, like starter" };
    value.id = body.id;
  }
  if (has("name")) {
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 80) return { ok: false, error: "name is 1 to 80 characters" };
    value.name = name;
  }
  if ("description" in body) {
    if (typeof body.description !== "string" || body.description.length > 500) return { ok: false, error: "description is up to 500 characters" };
    value.description = body.description.trim();
  }
  if (has("price_minor")) {
    if (!whole(body.price_minor, 0, 100_000_000_000)) return { ok: false, error: "price_minor is the price in cents (0 for a free plan)" };
    value.priceMinor = body.price_minor as number;
  }
  if (has("currency")) {
    if (!bookingCurrencies.includes(body.currency as BookingCurrency)) return { ok: false, error: "currency is KES or USD" };
    value.currency = body.currency as BookingCurrency;
  }
  if ("billing_interval" in body || creating) {
    const interval = body.billing_interval ?? "month";
    if (!billingIntervals.includes(interval as BillingInterval)) return { ok: false, error: "billing_interval is month or year" };
    value.billingInterval = interval as BillingInterval;
  }
  if ("trial_days" in body) {
    if (!whole(body.trial_days, 0, 90)) return { ok: false, error: "trial_days is 0 to 90" };
    value.trialDays = body.trial_days as number;
  }
  if ("conversations_per_month" in body) {
    if (body.conversations_per_month !== null && !whole(body.conversations_per_month, 1, 10_000_000)) return { ok: false, error: "conversations_per_month is a positive whole number, or null" };
    value.conversationsPerMonth = body.conversations_per_month as number | null;
  }
  if ("status" in body) {
    if (body.status !== "active" && body.status !== "hidden") return { ok: false, error: "status is active or hidden" };
    value.status = body.status;
  }
  if ("sort_order" in body) {
    if (!whole(body.sort_order, -1000, 1000)) return { ok: false, error: "sort_order is -1000 to 1000" };
    value.sortOrder = body.sort_order as number;
  }
  return { ok: true, value };
}
