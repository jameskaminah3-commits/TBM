// zaina-platform/src/booking/settings.ts
//
// A business's booking policy (currency, deposit, holds, check-in and
// check-out, tax, cancellation, limits) and the payment accounts it has
// connected. Keys and passwords are business secrets (businesses/secrets.ts),
// never kept here.
//
// The deposit, the ways to pay and the limits are the business's decisions.
// Until it chooses a deposit (deposit_type not_set), nothing is charged
// online: bookings from the chat come in as requests for the team. The other
// values below are only starting points the business changes; the platform
// only keeps each within safe bounds (POLICY_BOUNDS, also in the database).

import { eq } from "drizzle-orm";
import { bookingSettings, depositTypes, paymentWays, type BookingCurrency, type BookingSettings, type DepositType, type PaymentWay } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { formatMoney } from "./money.ts";
import { describeWeek, validateWeekHours } from "./slots.ts";
import type { DepositRule, TaxRule } from "./pricing.ts";

export const PAYSTACK_SECRET = "paystack_secret_key";
export const MPESA_SECRETS = { consumerKey: "mpesa_consumer_key", consumerSecret: "mpesa_consumer_secret", passkey: "mpesa_passkey" } as const;

export function defaultBookingSettings(businessId: string): BookingSettings {
  return {
    businessId,
    currency: "KES",
    depositPercent: 30,
    holdMinutes: 30,
    requestHoldHours: 24,
    checkInTime: "14:00",
    checkOutTime: "10:00",
    cancellationPolicy: null,
    taxName: null,
    taxPercent: null,
    taxIncluded: true,
    paystackMode: "off",
    paystackSubaccount: null,
    mpesaExpress: false,
    mpesaEnvironment: "production",
    mpesaType: null,
    mpesaShortcode: null,
    mpesaTill: null,
    mpesaManualType: null,
    mpesaManualNumber: null,
    mpesaManualAccount: null,
    payAtVenue: false,
    openingHours: {},
    slotIntervalMinutes: 30,
    depositType: "not_set",
    depositFixedMinor: null,
    paymentOrder: [],
    methodMaxMinor: {},
    acceptedHoldHours: 24,
    paymentHoldMinutes: 15,
    codeCheckHours: 12,
    bookingHorizonDays: 548,
    maxNights: 30,
    minNoticeHours: 0,
    payAttemptsLimit: 12,
    mpesaPromptsLimit: 3,
    rulesConfirmedAt: null,
    updatedAt: new Date(0),
    updatedBy: null,
  };
}

export async function getBookingSettings(businessId: string): Promise<BookingSettings> {
  const [row] = await inBusiness((db) => db.select().from(bookingSettings).where(eq(bookingSettings.businessId, businessId)).limit(1), businessId);
  return row ?? defaultBookingSettings(businessId);
}

export type BookingSettingsPatch = Partial<Omit<BookingSettings, "businessId" | "updatedAt" | "updatedBy">>;

export async function saveBookingSettings(businessId: string, patch: BookingSettingsPatch, updatedBy: string | null): Promise<BookingSettings> {
  const current = await getBookingSettings(businessId);
  const next = { ...current, ...patch, businessId, updatedBy, updatedAt: new Date() };
  const [row] = await inBusiness((db) => db
    .insert(bookingSettings)
    .values(next)
    .onConflictDoUpdate({ target: bookingSettings.businessId, set: { ...patch, updatedBy, updatedAt: next.updatedAt } })
    .returning(), businessId);
  return row;
}

/** The business's deposit rule, as the pricing module takes it. */
export function depositRuleOf(settings: Pick<BookingSettings, "depositType" | "depositPercent" | "depositFixedMinor">): DepositRule {
  return { type: settings.depositType, percent: settings.depositPercent, fixedMinor: settings.depositFixedMinor };
}

/** Whether the business has chosen how it takes deposits. */
export const depositChosen = (settings: Pick<BookingSettings, "depositType">) => settings.depositType !== "not_set";

/** The deposit rule in words, for Zaina and the console: "30% to confirm". */
export function depositText(settings: BookingSettings, rest = "at the venue"): string {
  switch (settings.depositType) {
    case "none":
      return `none: paid ${rest}`;
    case "percent":
      return `${settings.depositPercent}% to confirm, the rest ${rest}`;
    case "fixed":
      return `${formatMoney(settings.depositFixedMinor ?? 0, settings.currency)} to confirm, the rest ${rest}`;
    case "full":
      return "paid in full to confirm";
    default:
      return "not set by the business yet: bookings are requests the team confirms, and the team arranges any payment";
  }
}

/** The tax the business's prices carry, if any. */
export function taxRuleOf(settings: BookingSettings): TaxRule | null {
  const percent = settings.taxPercent === null ? 0 : Number(settings.taxPercent);
  return settings.taxName && percent > 0 ? { name: settings.taxName, percent, included: settings.taxIncluded } : null;
}

export type PaymentOptions = {
  /** Card and M-Pesa through Paystack. */
  paystack: boolean;
  /** A payment prompt on the customer's phone (M-Pesa Express). */
  mpesaExpress: boolean;
  /** A paybill or till the customer pays by hand; the team checks the code. */
  mpesaManual: { type: "paybill" | "till"; number: string; account: string | null } | null;
  payAtVenue: boolean;
  /** The order the business offers them in. */
  order: PaymentWay[];
  /** The most one payment can be, per way to pay (the business's limits). */
  maxMinor: Partial<Record<PaymentWay, number>>;
};

/** The order the ways to pay are offered in when the business hasn't set one. */
export const DEFAULT_PAYMENT_ORDER: PaymentWay[] = ["paystack", "mpesa_express", "mpesa_manual", "pay_at_venue"];

/** The business's order, with any way it didn't list after, in the usual order. */
export const paymentOrderOf = (order: readonly PaymentWay[]): PaymentWay[] => [...new Set([...order, ...DEFAULT_PAYMENT_ORDER])];

export function paymentOptionsOf(settings: BookingSettings): PaymentOptions {
  return {
    order: paymentOrderOf(settings.paymentOrder ?? []),
    maxMinor: settings.methodMaxMinor ?? {},
    paystack: settings.paystackMode !== "off",
    // M-Pesa takes shillings only.
    mpesaExpress: settings.mpesaExpress && settings.currency === "KES",
    mpesaManual: settings.mpesaManualType && settings.mpesaManualNumber && settings.currency === "KES"
      ? { type: settings.mpesaManualType, number: settings.mpesaManualNumber, account: settings.mpesaManualAccount }
      : null,
    payAtVenue: settings.payAtVenue,
  };
}

/** Whether a way to pay is on, and allowed for this amount by the business's limits. */
export function wayAllowed(options: PaymentOptions, way: PaymentWay, amountMinor: number | null = null): boolean {
  const on = way === "paystack" ? options.paystack : way === "mpesa_express" ? options.mpesaExpress : way === "mpesa_manual" ? options.mpesaManual !== null : options.payAtVenue;
  const max = options.maxMinor[way];
  return on && (amountMinor === null || max === undefined || amountMinor <= max);
}

/** The ways to pay online the customer has for an amount, in the business's order. */
export const onlineWays = (options: PaymentOptions, amountMinor: number | null = null): PaymentWay[] =>
  options.order.filter((way) => way !== "pay_at_venue" && wayAllowed(options, way, amountMinor));

/** Whether a customer can pay a deposit without the team's help. */
export const canTakeDeposits = (options: PaymentOptions, amountMinor: number | null = null) => onlineWays(options, amountMinor).length > 0;

/** How customers can pay, in words: "card or M-Pesa". */
export function paymentMethodsText(options: PaymentOptions, amountMinor: number | null = null): string {
  const ways = onlineWays(options, amountMinor);
  const methods: string[] = [];
  for (const way of ways) {
    for (const method of way === "paystack" ? ["card", "M-Pesa"] : ["M-Pesa"]) if (!methods.includes(method)) methods.push(method);
  }
  return methods.length === 2 ? `${methods[0]} or ${methods[1]}` : methods[0] ?? "";
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The platform's safe bounds for each limit the business sets (the database checks them too). */
export const POLICY_BOUNDS = {
  hold_minutes: [10, 1440],
  request_hold_hours: [0, 168],
  accepted_hold_hours: [1, 168],
  payment_hold_minutes: [5, 120],
  code_check_hours: [1, 72],
  booking_horizon_days: [1, 730],
  max_nights: [1, 90],
  min_notice_hours: [0, 720],
  pay_attempts_limit: [3, 30],
  mpesa_prompts_limit: [1, 10],
} as const;
type PolicyLimit = keyof typeof POLICY_BOUNDS;
const POLICY_KEYS: Record<PolicyLimit, keyof BookingSettings> = {
  hold_minutes: "holdMinutes",
  request_hold_hours: "requestHoldHours",
  accepted_hold_hours: "acceptedHoldHours",
  payment_hold_minutes: "paymentHoldMinutes",
  code_check_hours: "codeCheckHours",
  booking_horizon_days: "bookingHorizonDays",
  max_nights: "maxNights",
  min_notice_hours: "minNoticeHours",
  pay_attempts_limit: "payAttemptsLimit",
  mpesa_prompts_limit: "mpesaPromptsLimit",
};

/** Checks settings as they would be after a patch: a deposit rule needs its amount. */
export function checkDepositRule(settings: Pick<BookingSettings, "depositType" | "depositPercent" | "depositFixedMinor">): string | null {
  if (settings.depositType === "percent" && !(settings.depositPercent >= 1 && settings.depositPercent <= 99)) return "a percentage deposit is 1 to 99 (use none or full otherwise)";
  if (settings.depositType === "fixed" && !settings.depositFixedMinor) return "a fixed deposit needs deposit_fixed_minor";
  return null;
}

/** Checks the policy part of a patch sent by staff (payment accounts have their own routes). */
export function validatePolicyPatch(input: Record<string, unknown>): { ok: true; patch: BookingSettingsPatch } | { ok: false; error: string } {
  const patch: BookingSettingsPatch = {};
  const whole = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
  if ("currency" in input) {
    if (input.currency !== "KES" && input.currency !== "USD") return { ok: false, error: "currency is KES or USD" };
    patch.currency = input.currency as BookingCurrency;
  }
  if ("deposit_type" in input) {
    if (!depositTypes.includes(input.deposit_type as DepositType) || input.deposit_type === "not_set") {
      return { ok: false, error: "deposit_type is none, percent, fixed or full" };
    }
    patch.depositType = input.deposit_type as DepositType;
  }
  if ("deposit_percent" in input) {
    if (!whole(input.deposit_percent, 0, 100)) return { ok: false, error: "deposit_percent is 0 to 100" };
    patch.depositPercent = input.deposit_percent as number;
    // A percentage alone says the rule too: 0 is none, 100 is in full.
    if (!("deposit_type" in input)) patch.depositType = patch.depositPercent === 0 ? "none" : patch.depositPercent === 100 ? "full" : "percent";
  }
  if ("deposit_fixed_minor" in input) {
    if (input.deposit_fixed_minor !== null && !whole(input.deposit_fixed_minor, 100, 10_000_000_000)) return { ok: false, error: "deposit_fixed_minor is an amount in cents, at least 100" };
    patch.depositFixedMinor = input.deposit_fixed_minor as number | null;
  }
  for (const [field, key] of Object.keys(POLICY_BOUNDS).map((field) => [field, POLICY_KEYS[field as PolicyLimit]] as const)) {
    if (!(field in input)) continue;
    const [min, max] = POLICY_BOUNDS[field as PolicyLimit];
    if (!whole(input[field], min, max)) return { ok: false, error: `${field} is ${min} to ${max}` };
    (patch as Record<string, number>)[key] = input[field] as number;
  }
  if ("opening_hours" in input) {
    const checked = validateWeekHours(input.opening_hours);
    if (!checked.ok) return { ok: false, error: checked.error.replace(/^hours/, "opening_hours") };
    patch.openingHours = checked.hours;
  }
  if ("slot_interval_minutes" in input) {
    if (![5, 10, 15, 20, 30, 45, 60, 90, 120].includes(input.slot_interval_minutes as number)) return { ok: false, error: "slot_interval_minutes is 5, 10, 15, 20, 30, 45, 60, 90 or 120" };
    patch.slotIntervalMinutes = input.slot_interval_minutes as number;
  }
  if ("payment_order" in input) {
    const order = input.payment_order;
    if (!Array.isArray(order) || order.length > paymentWays.length || new Set(order).size !== order.length || !order.every((way) => paymentWays.includes(way))) {
      return { ok: false, error: `payment_order lists ways to pay once each: ${paymentWays.join(", ")}` };
    }
    patch.paymentOrder = order as PaymentWay[];
  }
  if ("method_max_minor" in input) {
    const limits = input.method_max_minor;
    if (!limits || typeof limits !== "object" || Array.isArray(limits)) return { ok: false, error: "method_max_minor is an object of limits per way to pay" };
    const clean: Partial<Record<PaymentWay, number>> = {};
    for (const [way, value] of Object.entries(limits)) {
      if (!paymentWays.includes(way as PaymentWay) || way === "pay_at_venue") return { ok: false, error: `method_max_minor: ${way} isn't a way to pay online` };
      if (value === null) continue;
      if (!whole(value, 100, 10_000_000_000)) return { ok: false, error: `method_max_minor.${way} is an amount in cents` };
      clean[way as PaymentWay] = value as number;
    }
    patch.methodMaxMinor = clean;
  }
  for (const [field, key] of [["check_in_time", "checkInTime"], ["check_out_time", "checkOutTime"]] as const) {
    if (!(field in input)) continue;
    if (typeof input[field] !== "string" || !TIME.test(input[field] as string)) return { ok: false, error: `${field} is a time like 14:00` };
    patch[key] = input[field] as string;
  }
  if ("cancellation_policy" in input) {
    const value = input.cancellation_policy;
    if (value !== null && (typeof value !== "string" || value.length > 2000)) return { ok: false, error: "cancellation_policy is up to 2000 characters" };
    patch.cancellationPolicy = typeof value === "string" && value.trim() ? value.trim() : null;
  }
  if ("tax_name" in input || "tax_percent" in input) {
    const name = input.tax_name ?? null;
    const percent = input.tax_percent ?? null;
    if (name === null && percent === null) {
      patch.taxName = null;
      patch.taxPercent = null;
    } else {
      if (typeof name !== "string" || !name.trim() || name.length > 40) return { ok: false, error: "tax_name is up to 40 characters, like VAT" };
      if (typeof percent !== "number" || !(percent > 0 && percent <= 50) || Math.round(percent * 100) !== percent * 100) {
        return { ok: false, error: "tax_percent is more than 0 and at most 50, like 16" };
      }
      patch.taxName = name.trim();
      patch.taxPercent = String(percent);
    }
  }
  if ("tax_included" in input) {
    if (typeof input.tax_included !== "boolean") return { ok: false, error: "tax_included is true or false" };
    patch.taxIncluded = input.tax_included;
  }
  if ("pay_at_venue" in input) {
    if (typeof input.pay_at_venue !== "boolean") return { ok: false, error: "pay_at_venue is true or false" };
    patch.payAtVenue = input.pay_at_venue;
  }
  return { ok: true, patch };
}

/** The settings as the console reads them. */
export function publicBookingSettings(settings: BookingSettings, secrets: Set<string>) {
  const options = paymentOptionsOf(settings);
  return {
    currency: settings.currency,
    deposit_type: settings.depositType,
    deposit_percent: settings.depositPercent,
    deposit_fixed_minor: settings.depositFixedMinor,
    deposit_text: depositText(settings),
    rules_confirmed_at: settings.rulesConfirmedAt,
    hold_minutes: settings.holdMinutes,
    request_hold_hours: settings.requestHoldHours,
    accepted_hold_hours: settings.acceptedHoldHours,
    payment_hold_minutes: settings.paymentHoldMinutes,
    code_check_hours: settings.codeCheckHours,
    booking_horizon_days: settings.bookingHorizonDays,
    max_nights: settings.maxNights,
    min_notice_hours: settings.minNoticeHours,
    pay_attempts_limit: settings.payAttemptsLimit,
    mpesa_prompts_limit: settings.mpesaPromptsLimit,
    opening_hours: settings.openingHours,
    opening_hours_text: describeWeek(settings.openingHours),
    slot_interval_minutes: settings.slotIntervalMinutes,
    payment_order: options.order,
    method_max_minor: settings.methodMaxMinor,
    bounds: POLICY_BOUNDS,
    check_in_time: settings.checkInTime,
    check_out_time: settings.checkOutTime,
    cancellation_policy: settings.cancellationPolicy,
    tax_name: settings.taxName,
    tax_percent: settings.taxPercent === null ? null : Number(settings.taxPercent),
    tax_included: settings.taxIncluded,
    pay_at_venue: settings.payAtVenue,
    payments: {
      paystack: {
        mode: settings.paystackMode,
        subaccount: settings.paystackSubaccount,
        key_saved: secrets.has(PAYSTACK_SECRET),
      },
      mpesa_express: {
        on: settings.mpesaExpress,
        environment: settings.mpesaEnvironment,
        type: settings.mpesaType,
        shortcode: settings.mpesaShortcode,
        till: settings.mpesaTill,
        keys_saved: Object.values(MPESA_SECRETS).every((name) => secrets.has(name)),
      },
      mpesa_manual: settings.mpesaManualType ? { type: settings.mpesaManualType, number: settings.mpesaManualNumber, account: settings.mpesaManualAccount } : null,
      takes_deposits: canTakeDeposits(options),
    },
  };
}
