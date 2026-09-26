// zaina-platform/src/billing/payments.ts
//
// Paying an invoice through the platform's own Paystack account (card or
// M-Pesa): the owner starts in the console and goes to Paystack's page; the
// payment settles on Paystack's signed webhook, when the owner comes back,
// or when the sweep asks. Invoice references start "zi_", which is how the
// platform's webhook tells them from bookings paid through subaccounts.

import { randomBytes } from "node:crypto";
import { initializeCheckout, verifyTransaction, type VerifiedTransaction } from "../payments/paystack.ts";
import { billingConfig, paysOnline } from "./config.ts";
import {
  BillingError,
  invoiceById,
  paymentByReference,
  pendingPaymentFor,
  pendingPayments,
  recordPaymentStart,
  setPaymentPage,
  settleInvoicePayment,
  type ChargeOutcome,
} from "./store.ts";

/** A Paystack page started this recently is reused: one payment, however many clicks or tabs. */
const REUSE_PAGE_MS = 30 * 60_000;
/** How old a payment under way is before the sweep asks Paystack (PAYMENT_CHECK_AFTER_MS: tests). */
const ASK_AFTER_MS = Number(process.env.PAYMENT_CHECK_AFTER_MS ?? "") || 45_000;
/** A payment not finished in this long has failed. */
const GIVE_UP_MS = 2 * 60 * 60_000;

export const INVOICE_REFERENCE = /^zi_[0-9a-f]{24}$/;

const resultOf = (transaction: VerifiedTransaction) => ({
  status: transaction.status,
  amountMinor: transaction.amountMinor,
  currency: transaction.currency,
  transactionId: transaction.id,
  message: transaction.message,
});

/** Starts paying an open invoice: the address of Paystack's page to send the owner to. */
export async function startInvoicePayment(businessId: string, invoiceId: string, payerEmail: string, now = new Date()): Promise<string> {
  const { platformPaystackKey, publicBaseUrl } = billingConfig();
  if (!paysOnline() || !platformPaystackKey) throw new BillingError(409, "not_available", "Paying online isn't switched on yet. Please pay by hand, or ask the Zaina team.");
  const invoice = await invoiceById(invoiceId);
  if (!invoice || invoice.businessId !== businessId) throw new BillingError(404, "not_found", "That invoice wasn't found.");
  if (invoice.status !== "open") throw new BillingError(409, "not_open", invoice.status === "paid" ? "That invoice is paid already." : "That invoice is void: there's nothing to pay.");
  const started = await pendingPaymentFor(invoice.id, new Date(now.getTime() - REUSE_PAGE_MS));
  if (started?.authorizationUrl) return started.authorizationUrl;

  const reference = `zi_${randomBytes(12).toString("hex")}`;
  const payment = await recordPaymentStart(invoice, { reference, payerEmail });
  const checkout = await initializeCheckout({ secretKey: platformPaystackKey, subaccount: null }, {
    email: payerEmail,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    reference,
    callbackUrl: `${publicBaseUrl}/v1/billing/paystack/return`,
    metadata: { invoice: invoice.number, business: businessId, custom_fields: [{ display_name: "Invoice", variable_name: "invoice", value: invoice.number }] },
  });
  if (!checkout.ok) {
    await settleInvoicePayment(payment, { status: "failed", amountMinor: 0, currency: invoice.currency, transactionId: null, message: checkout.message }, now);
    console.warn(`[billing] ${businessId}: Paystack checkout for ${invoice.number} failed: ${checkout.message}`);
    throw new BillingError(502, "provider_failed", "Paystack couldn't start the payment just now. Please try again in a minute, or pay by hand.");
  }
  await setPaymentPage(payment.id, checkout.checkout.authorizationUrl);
  return checkout.checkout.authorizationUrl;
}

/** A charge from Paystack's webhook for an invoice (its signature already checked). */
export async function applyInvoiceCharge(transaction: VerifiedTransaction): Promise<void> {
  const payment = await paymentByReference(transaction.reference);
  if (payment) await settleInvoicePayment(payment, resultOf(transaction));
}

/** The owner came back from Paystack's page: ask Paystack how it went. */
export async function checkInvoiceReturn(reference: string): Promise<{ businessId: string; outcome: ChargeOutcome } | null> {
  const payment = await paymentByReference(reference);
  if (!payment) return null;
  if (payment.status !== "pending") return { businessId: payment.businessId, outcome: payment.status === "succeeded" ? "paid" : "failed" };
  const key = billingConfig().platformPaystackKey;
  const verified = key ? await verifyTransaction(key, reference) : null;
  if (!verified?.ok) return { businessId: payment.businessId, outcome: "pending" };
  return { businessId: payment.businessId, outcome: await settleInvoicePayment(payment, resultOf(verified.transaction)) };
}

/** Payments under way that Paystack may have settled without telling us: ask, and give up on old ones. */
export async function sweepInvoicePayments(now = new Date()): Promise<number> {
  const key = billingConfig().platformPaystackKey;
  if (!key) return 0;
  let settled = 0;
  for (const payment of await pendingPayments(new Date(now.getTime() - ASK_AFTER_MS))) {
    try {
      const verified = await verifyTransaction(key, payment.reference);
      let outcome: ChargeOutcome = verified.ok ? await settleInvoicePayment(payment, resultOf(verified.transaction), now) : "pending";
      if (outcome === "pending" && now.getTime() - payment.createdAt.getTime() > GIVE_UP_MS) {
        outcome = await settleInvoicePayment(payment, { status: "failed", amountMinor: 0, currency: payment.currency, transactionId: null, message: "Not finished on Paystack." }, now);
      }
      if (outcome !== "pending") settled += 1;
    } catch (error) {
      console.error(`[billing] asking Paystack about ${payment.reference} failed:`, error);
    }
  }
  return settled;
}
