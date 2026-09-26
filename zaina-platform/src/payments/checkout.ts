// zaina-platform/src/payments/checkout.ts
//
// Taking a booking's money, into the business's own account:
//
//   Paystack        card or M-Pesa on Paystack's checkout page. The payment
//                   settles on Paystack's signed webhook, when the customer
//                   comes back, or when a sweep asks Paystack.
//   M-Pesa Express  a prompt on the customer's phone. It settles on
//                   Safaricom's callback, confirmed by asking Safaricom (the
//                   callback isn't signed), or when a sweep asks.
//   M-Pesa code     the customer pays a paybill or till by hand and sends the
//                   code (in the chat or on the payment page); the team
//                   checks it in their M-Pesa statement and confirms.
//
// The amount due is the deposit still unpaid, or, once confirmed, the
// balance. Starting to pay re-checks the booking's rooms (holdForPayment).
// When money arrives, bookings.ts decides what it means (settlePayment) and
// the customer and team hear about it (notices.ts).

import { randomBytes } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { allBusinesses, businessById } from "../businesses/registry.ts";
import { getSecret } from "../businesses/secrets.ts";
import { offerings, payments, type Booking, type Business, type Payment } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import {
  bookingByPayToken,
  businessForToken,
  holdForPayment,
  holdWhileChecking,
  recordPendingPayment,
  setPaymentReference,
  settlePayment,
  type Settlement,
} from "../booking/bookings.ts";
import { tellCustomer, tellTeam } from "../booking/notices.ts";
import { getBookingSettings, MPESA_SECRETS, PAYSTACK_SECRET, paymentOptionsOf } from "../booking/settings.ts";
import type { BookingSettings } from "../db/schema.ts";
import { formatMoney } from "../booking/money.ts";
import { chargeFromWebhook, initializeCheckout, validWebhookSignature, verifyTransaction, type PaystackAccount, type VerifiedTransaction } from "./paystack.ts";
import { mpesaPhone, readStkCallback, stkPush, stkQuery, type MpesaAccount } from "./mpesa.ts";

let config: { publicBaseUrl: string | null; platformPaystackKey: string | null } = { publicBaseUrl: null, platformPaystackKey: null };

export function configurePayments(next: { publicBaseUrl: string | null; platformPaystackKey: string | null }) {
  config = next;
}

export const platformPaystackKey = () => config.platformPaystackKey;

/** How long the team has to check an M-Pesa code before the rooms are let go. */
export const CODE_CHECK_HOURS = 12;
/** A payment prompt nobody answered in this long has failed. */
const STK_GIVE_UP_MS = 5 * 60_000;
/** A Paystack checkout left this long is abandoned. */
const PAYSTACK_GIVE_UP_MS = 2 * 60 * 60_000;
/** How old a pending payment is before we ask its provider (the page asks sooner than the sweep). PAYMENT_CHECK_AFTER_MS: tests. */
const PAGE_ASKS_AFTER_MS = Number(process.env.PAYMENT_CHECK_AFTER_MS ?? "") || 20_000;
const SWEEP_ASKS_AFTER_MS = Number(process.env.PAYMENT_CHECK_AFTER_MS ?? "") || 45_000;

/** Paystack for this business: its own key, or its subaccount of the platform's account. */
export async function paystackAccountFor(businessId: string, settings: BookingSettings): Promise<PaystackAccount | null> {
  if (settings.paystackMode === "own_keys") {
    const secretKey = await getSecret(businessId, PAYSTACK_SECRET);
    return secretKey ? { secretKey, subaccount: null } : null;
  }
  if (settings.paystackMode === "subaccount" && settings.paystackSubaccount && config.platformPaystackKey) {
    return { secretKey: config.platformPaystackKey, subaccount: settings.paystackSubaccount };
  }
  return null;
}

export async function mpesaAccountFor(businessId: string, settings: BookingSettings): Promise<MpesaAccount | null> {
  if (!settings.mpesaExpress || !settings.mpesaType || !settings.mpesaShortcode) return null;
  const [consumerKey, consumerSecret, passkey] = await Promise.all([
    getSecret(businessId, MPESA_SECRETS.consumerKey),
    getSecret(businessId, MPESA_SECRETS.consumerSecret),
    getSecret(businessId, MPESA_SECRETS.passkey),
  ]);
  if (!consumerKey || !consumerSecret || !passkey) return null;
  return {
    environment: settings.mpesaEnvironment,
    type: settings.mpesaType,
    shortcode: settings.mpesaShortcode,
    till: settings.mpesaTill,
    consumerKey,
    consumerSecret,
    passkey,
  };
}

/** What the customer can pay now: the deposit still unpaid, or once confirmed, the balance. */
export function amountDue(booking: Pick<Booking, "status" | "totalMinor" | "depositMinor" | "paidMinor">): number {
  if (booking.status === "confirmed") return Math.max(0, booking.totalMinor - booking.paidMinor);
  if (["held", "awaiting_payment", "expired", "requested"].includes(booking.status)) return Math.max(0, booking.depositMinor - booking.paidMinor);
  return 0;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Why a payment couldn't start; the payment page shows a fixed message for each. */
export type PayErrorCode = "not_available" | "email_needed" | "rooms_gone" | "wrong_status" | "nothing_due" | "provider_failed" | "phone_invalid";

export type StartResult = { ok: true; redirect?: string; payment: Payment } | { ok: false; code: PayErrorCode; message: string };

const failed = (code: PayErrorCode, message: string): { ok: false; code: PayErrorCode; message: string } => ({ ok: false, code, message });

/** Readies a booking for a payment: its rooms re-checked and held, unless it's already confirmed. */
async function readyToPay(business: Business, booking: Booking): Promise<{ ok: true; booking: Booking } | { ok: false; code: PayErrorCode; message: string }> {
  if (booking.status === "confirmed") return { ok: true, booking };
  const held = await holdForPayment(business.id, booking.id);
  return held.ok ? held : failed(held.error === "rooms_gone" ? "rooms_gone" : "wrong_status", held.message);
}

export async function startPaystack(business: Business, booking: Booking, input: { email?: string | null }): Promise<StartResult> {
  const settings = await getBookingSettings(business.id);
  const account = await paystackAccountFor(business.id, settings);
  if (!account) return failed("not_available", "Card payments aren't available for this booking.");
  const email = (booking.customerEmail ?? input.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return failed("email_needed", "Please give an email address for your receipt.");
  const ready = await readyToPay(business, booking);
  if (!ready.ok) return ready;
  const amount = amountDue(ready.booking);
  if (amount <= 0) return failed("nothing_due", "There's nothing to pay on this booking now.");
  const reference = `zb_${randomBytes(12).toString("hex")}`;
  const payment = await recordPendingPayment({
    businessId: business.id, bookingId: booking.id, method: "paystack", amountMinor: amount, currency: booking.currency, providerReference: reference, payerEmail: email,
  });
  const started = await initializeCheckout(account, {
    email,
    amountMinor: amount,
    currency: booking.currency,
    reference,
    callbackUrl: `${config.publicBaseUrl ?? ""}/pay/${booking.payToken}/done`,
    metadata: { booking_reference: booking.reference, business: business.id, custom_fields: [{ display_name: "Booking", variable_name: "booking", value: booking.reference }] },
  });
  if (!started.ok) {
    await settlePayment(business.id, payment.id, { succeeded: false, failure: started.message });
    console.warn(`[payments] ${business.id}: Paystack checkout for ${booking.reference} failed: ${started.message}`);
    return failed("provider_failed", "Card payment couldn't be started just now. Please try again, or pay another way.");
  }
  return { ok: true, redirect: started.checkout.authorizationUrl, payment };
}

export async function startMpesaExpress(business: Business, booking: Booking, input: { phone: string }): Promise<StartResult> {
  const settings = await getBookingSettings(business.id);
  const account = booking.currency === "KES" ? await mpesaAccountFor(business.id, settings) : null;
  if (!account) return failed("not_available", "M-Pesa prompts aren't available for this booking.");
  const phone = mpesaPhone(input.phone);
  if (!phone) return failed("phone_invalid", "Please give a Safaricom number, like 0712 345 678.");
  const ready = await readyToPay(business, booking);
  if (!ready.ok) return ready;
  // M-Pesa takes whole shillings.
  const shillings = Math.ceil(amountDue(ready.booking) / 100);
  if (shillings <= 0) return failed("nothing_due", "There's nothing to pay on this booking now.");
  const callbackToken = randomBytes(24).toString("base64url");
  const payment = await recordPendingPayment({
    businessId: business.id, bookingId: booking.id, method: "mpesa_express", amountMinor: shillings * 100, currency: "KES", callbackToken, payerPhone: phone,
  });
  const pushed = await stkPush(account, {
    phone,
    amount: shillings,
    reference: booking.reference,
    description: "Booking",
    callbackUrl: `${config.publicBaseUrl ?? ""}/v1/payments/mpesa/${callbackToken}`,
  });
  if (!pushed.ok) {
    await settlePayment(business.id, payment.id, { succeeded: false, failure: pushed.message });
    console.warn(`[payments] ${business.id}: M-Pesa prompt for ${booking.reference} failed: ${pushed.message}`);
    return failed("provider_failed", "The M-Pesa prompt couldn't be sent just now. Please try again, or pay another way.");
  }
  await setPaymentReference(business.id, payment.id, pushed.checkoutRequestId);
  return { ok: true, payment: { ...payment, providerReference: pushed.checkoutRequestId } };
}

export type CodeResult =
  | { ok: true; payment: Payment; booking: Booking; already: boolean }
  | { ok: false; reason: "used" | "nothing_due" | "not_taken" };

/**
 * An M-Pesa code the customer sent for their booking (chat or payment page):
 * recorded for the team to check, and the rooms held meanwhile.
 */
export async function submitMpesaCode(business: Business, booking: Booking, code: string): Promise<CodeResult> {
  const settings = await getBookingSettings(business.id);
  if (!paymentOptionsOf(settings).mpesaManual && !settings.mpesaExpress) return { ok: false, reason: "not_taken" };
  const existing = await inBusiness((db) => db.select().from(payments)
    .where(and(eq(payments.businessId, business.id), eq(payments.method, "mpesa_code"), eq(payments.providerReference, code))).limit(1), business.id);
  if (existing[0]) {
    return existing[0].bookingId === booking.id ? { ok: true, payment: existing[0], booking, already: true } : { ok: false, reason: "used" };
  }
  const amount = amountDue(booking);
  if (amount <= 0) return { ok: false, reason: "nothing_due" };
  let payment: Payment;
  try {
    payment = await recordPendingPayment({ businessId: business.id, bookingId: booking.id, method: "mpesa_code", amountMinor: amount, currency: booking.currency, providerReference: code });
  } catch (error) {
    const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string };
    if (database.code === "23505") return { ok: false, reason: "used" };
    throw error;
  }
  await holdWhileChecking(business.id, booking.id, CODE_CHECK_HOURS);
  const offering = await offeringName(business.id, booking.offeringId);
  void tellTeam(business, booking, offering, "code", `M-Pesa code ${code} for ${formatMoney(amount, booking.currency)}: check it in your M-Pesa statement, then confirm or reject it in the console.`);
  return { ok: true, payment, booking, already: false };
}

async function offeringName(businessId: string, offeringId: string): Promise<{ name: string }> {
  const [row] = await inBusiness((db) => db.select({ name: offerings.name }).from(offerings)
    .where(and(eq(offerings.businessId, businessId), eq(offerings.id, offeringId))).limit(1), businessId);
  return row ?? { name: "Room" };
}

/** After money arrives: the customer and the team hear what it means. */
export async function afterSettlement(business: Business, settlement: Settlement | undefined): Promise<void> {
  if (!settlement?.changed || settlement.payment.status !== "succeeded") return;
  const offering = await offeringName(business.id, settlement.booking.offeringId);
  if (settlement.confirmed) {
    await Promise.all([tellCustomer(business, settlement.booking, offering, "confirmed"), tellTeam(business, settlement.booking, offering, "confirmed", `Paid ${formatMoney(settlement.payment.amountMinor, settlement.payment.currency)} (${settlement.payment.method.replace("_", " ")}).`)]);
  } else if (settlement.conflict) {
    await Promise.all([tellCustomer(business, settlement.booking, offering, "conflict"), tellTeam(business, settlement.booking, offering, "conflict", settlement.booking.conflict ?? "")]);
  }
}

// ── Paystack ──────────────────────────────────────────────────────────

async function paymentByReference(businessId: string, reference: string): Promise<Payment | undefined> {
  const [row] = await inBusiness((db) => db.select().from(payments)
    .where(and(eq(payments.businessId, businessId), eq(payments.method, "paystack"), eq(payments.providerReference, reference))).limit(1), businessId);
  return row;
}

/** Applies what Paystack says about one of our payments. */
async function applyPaystack(business: Business, payment: Payment, transaction: VerifiedTransaction): Promise<Settlement | undefined> {
  if (transaction.status === "success") {
    if (transaction.amountMinor !== payment.amountMinor || transaction.currency !== payment.currency) {
      console.error(`[payments] ${business.id}: Paystack paid ${transaction.amountMinor} ${transaction.currency} for a payment of ${payment.amountMinor} ${payment.currency}`);
      const settled = await settlePayment(business.id, payment.id, { succeeded: false, failure: `Paystack reported ${transaction.amountMinor / 100} ${transaction.currency}, not the amount asked` });
      const booking = settled?.booking;
      if (booking) void tellTeam(business, booking, await offeringName(business.id, booking.offeringId), "conflict", "A Paystack payment arrived for a different amount than asked: check it in Paystack.");
      return settled;
    }
    const settled = await settlePayment(business.id, payment.id, { succeeded: true, receipt: transaction.id });
    await afterSettlement(business, settled);
    return settled;
  }
  if (transaction.status === "failed" || transaction.status === "reversed") {
    return settlePayment(business.id, payment.id, { succeeded: false, failure: transaction.message ?? `Paystack: ${transaction.status}` });
  }
  return undefined;
}

/**
 * A Paystack webhook: for one business's own account (businessId), or for
 * the platform's account and its subaccounts (businessId null). Returns
 * false when the signature doesn't match.
 */
export async function handlePaystackWebhook(businessId: string | null, rawBody: Buffer, signature: string | undefined): Promise<boolean> {
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return false;
  }
  const charge = chargeFromWebhook(body);
  const reference = charge?.reference ?? (body as { data?: { reference?: string } })?.data?.reference ?? "";
  const ownerId = businessId ?? (reference ? await businessForToken("paystack", reference) : null);
  const business = ownerId ? await businessById(ownerId) : undefined;
  let secretKey: string | null = null;
  if (businessId && business) {
    const settings = await getBookingSettings(business.id);
    secretKey = settings.paystackMode === "own_keys" ? await getSecret(business.id, PAYSTACK_SECRET) : null;
  } else if (!businessId) {
    secretKey = config.platformPaystackKey;
  }
  // Unknown business or no key: nothing can be checked, so nothing is believed.
  if (!secretKey || !validWebhookSignature(secretKey, rawBody, signature)) return false;
  if (!business || !charge) return true;
  const payment = await paymentByReference(business.id, charge.reference);
  if (!payment) return true;
  await applyPaystack(business, payment, charge);
  return true;
}

/** The customer came back from Paystack's page: ask Paystack how it went. */
export async function checkPaystackReturn(business: Business, booking: Booking, reference: string): Promise<void> {
  const payment = await paymentByReference(business.id, reference);
  if (!payment || payment.bookingId !== booking.id || payment.status !== "pending") return;
  const settings = await getBookingSettings(business.id);
  const account = await paystackAccountFor(business.id, settings);
  if (!account) return;
  const verified = await verifyTransaction(account.secretKey, reference);
  if (verified.ok) await applyPaystack(business, payment, verified.transaction);
}

// ── M-Pesa Express ────────────────────────────────────────────────────

async function applyStk(business: Business, payment: Payment, account: MpesaAccount): Promise<Settlement | undefined> {
  if (!payment.providerReference) return undefined;
  const asked = await stkQuery(account, payment.providerReference);
  if (!asked.ok) {
    console.warn(`[payments] ${business.id}: asking M-Pesa about ${payment.providerReference} failed: ${asked.message}`);
    return undefined;
  }
  if (asked.outcome.state === "paid") {
    const settled = await settlePayment(business.id, payment.id, { succeeded: true, receipt: payment.receipt });
    await afterSettlement(business, settled);
    return settled;
  }
  if (asked.outcome.state === "failed") return settlePayment(business.id, payment.id, { succeeded: false, failure: asked.outcome.reason });
  if (Date.now() - payment.createdAt.getTime() > STK_GIVE_UP_MS) {
    return settlePayment(business.id, payment.id, { succeeded: false, failure: "The M-Pesa prompt wasn't answered." });
  }
  return undefined;
}

/** Safaricom's callback for one payment prompt (the token is in its address). */
export async function handleMpesaCallback(token: string, body: unknown): Promise<void> {
  const businessId = await businessForToken("mpesa", token);
  const business = businessId ? await businessById(businessId) : undefined;
  const callback = readStkCallback(body);
  if (!business || !callback) return;
  const [payment] = await inBusiness((db) => db.select().from(payments)
    .where(and(eq(payments.businessId, business.id), eq(payments.callbackToken, token))).limit(1), business.id);
  if (!payment || payment.status !== "pending" || payment.providerReference !== callback.checkoutRequestId) return;
  if (callback.resultCode !== 0) {
    await settlePayment(business.id, payment.id, { succeeded: false, failure: callback.resultDesc || `M-Pesa result ${callback.resultCode}` });
    return;
  }
  if (callback.amount !== null && Math.round(callback.amount * 100) !== payment.amountMinor) {
    console.error(`[payments] ${business.id}: M-Pesa callback for ${callback.amount} on a payment of ${payment.amountMinor / 100}`);
    return;
  }
  // Keep the receipt; the payment settles once Safaricom confirms it.
  await inBusiness((db) => db.update(payments).set({ receipt: callback.receipt, payerPhone: callback.phone ?? payment.payerPhone, updatedAt: new Date() })
    .where(and(eq(payments.businessId, business.id), eq(payments.id, payment.id))), business.id);
  const account = await mpesaAccountFor(business.id, await getBookingSettings(business.id));
  if (account) await applyStk(business, { ...payment, receipt: callback.receipt }, account);
}

/** Asks about a payment prompt the customer is waiting on (the payment page does, while it waits). */
export async function checkMpesaPayment(business: Business, payment: Payment): Promise<void> {
  if (payment.method !== "mpesa_express" || payment.status !== "pending" || Date.now() - payment.createdAt.getTime() < PAGE_ASKS_AFTER_MS) return;
  const account = await mpesaAccountFor(business.id, await getBookingSettings(business.id));
  if (account) await applyStk(business, payment, account);
}

// ── Sweeps ────────────────────────────────────────────────────────────

/** Payments still pending that a provider may have settled without telling us: ask. */
export async function sweepPendingPayments(now = new Date()): Promise<number> {
  let settled = 0;
  for (const business of await allBusinesses()) {
    if (business.businessType !== "guesthouse") continue;
    try {
      const pending = await inBusiness((db) => db.select().from(payments).where(and(
        eq(payments.businessId, business.id),
        eq(payments.status, "pending"),
        inArray(payments.method, ["paystack", "mpesa_express"]),
        lt(payments.createdAt, new Date(now.getTime() - SWEEP_ASKS_AFTER_MS)),
        sql`${payments.createdAt} > ${new Date(now.getTime() - 2 * 86_400_000)}`,
      )).limit(50), business.id);
      if (!pending.length) continue;
      const settings = await getBookingSettings(business.id);
      for (const payment of pending) {
        let result: Settlement | undefined;
        if (payment.method === "paystack" && payment.providerReference) {
          const account = await paystackAccountFor(business.id, settings);
          if (!account) continue;
          const verified = await verifyTransaction(account.secretKey, payment.providerReference);
          if (!verified.ok) continue;
          result = await applyPaystack(business, payment, verified.transaction);
          if (!result && now.getTime() - payment.createdAt.getTime() > PAYSTACK_GIVE_UP_MS) {
            result = await settlePayment(business.id, payment.id, { succeeded: false, failure: `Paystack: ${verified.transaction.status || "not completed"}` });
          }
        } else if (payment.method === "mpesa_express") {
          const account = await mpesaAccountFor(business.id, settings);
          if (account) result = await applyStk(business, payment, account);
        }
        if (result?.changed) settled += 1;
      }
    } catch (error) {
      console.error(`[payments] checking pending payments for ${business.id} failed:`, error);
    }
  }
  return settled;
}

/** The business and booking behind a payment page's token. */
export async function bookingForPage(token: string): Promise<{ business: Business; booking: Booking } | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const businessId = await businessForToken("pay", token);
  const business = businessId ? await businessById(businessId) : undefined;
  if (!business) return null;
  const booking = await bookingByPayToken(business.id, token);
  return booking ? { business, booking } : null;
}

