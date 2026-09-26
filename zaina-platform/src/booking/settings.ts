// zaina-platform/src/booking/settings.ts
//
// A business's booking policy (currency, deposit, holds, check-in and
// check-out, tax, cancellation) and the payment accounts it has connected.
// A business that hasn't saved any yet gets the defaults. Keys and passwords
// are business secrets (businesses/secrets.ts), never kept here.

import { eq } from "drizzle-orm";
import { bookingSettings, type BookingCurrency, type BookingSettings } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import type { TaxRule } from "./pricing.ts";

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
};

export function paymentOptionsOf(settings: BookingSettings): PaymentOptions {
  return {
    paystack: settings.paystackMode !== "off",
    // M-Pesa takes shillings only.
    mpesaExpress: settings.mpesaExpress && settings.currency === "KES",
    mpesaManual: settings.mpesaManualType && settings.mpesaManualNumber && settings.currency === "KES"
      ? { type: settings.mpesaManualType, number: settings.mpesaManualNumber, account: settings.mpesaManualAccount }
      : null,
    payAtVenue: settings.payAtVenue,
  };
}

/** Whether a customer can pay a deposit without the team's help. */
export const canTakeDeposits = (options: PaymentOptions) => options.paystack || options.mpesaExpress || options.mpesaManual !== null;

/** How customers can pay, in words: "card or M-Pesa". */
export function paymentMethodsText(options: PaymentOptions): string {
  const methods = [
    ...(options.paystack ? ["card"] : []),
    ...(options.paystack || options.mpesaExpress || options.mpesaManual ? ["M-Pesa"] : []),
  ];
  return methods.length === 2 ? "card or M-Pesa" : methods[0] ?? "";
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Checks the policy part of a patch sent by staff (payment accounts have their own routes). */
export function validatePolicyPatch(input: Record<string, unknown>): { ok: true; patch: BookingSettingsPatch } | { ok: false; error: string } {
  const patch: BookingSettingsPatch = {};
  const whole = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
  if ("currency" in input) {
    if (input.currency !== "KES" && input.currency !== "USD") return { ok: false, error: "currency is KES or USD" };
    patch.currency = input.currency as BookingCurrency;
  }
  if ("deposit_percent" in input) {
    if (!whole(input.deposit_percent, 0, 100)) return { ok: false, error: "deposit_percent is 0 to 100" };
    patch.depositPercent = input.deposit_percent as number;
  }
  if ("hold_minutes" in input) {
    if (!whole(input.hold_minutes, 10, 1440)) return { ok: false, error: "hold_minutes is 10 to 1440" };
    patch.holdMinutes = input.hold_minutes as number;
  }
  if ("request_hold_hours" in input) {
    if (!whole(input.request_hold_hours, 0, 168)) return { ok: false, error: "request_hold_hours is 0 to 168" };
    patch.requestHoldHours = input.request_hold_hours as number;
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
    deposit_percent: settings.depositPercent,
    hold_minutes: settings.holdMinutes,
    request_hold_hours: settings.requestHoldHours,
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
