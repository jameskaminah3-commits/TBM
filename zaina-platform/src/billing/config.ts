// zaina-platform/src/billing/config.ts — what billing reads from the platform's settings (set once at start).

export type BillingConfig = {
  /** Days a live business keeps answering after an invoice is due, before it pauses (BILLING_GRACE_DAYS). */
  graceDays: number;
  /** For the links in emails and Paystack's way back. */
  publicBaseUrl: string | null;
  /** The platform's own Paystack account: businesses pay invoices through it. */
  platformPaystackKey: string | null;
  /** How to pay by hand (bank or M-Pesa), shown with every invoice (BILLING_PAYMENT_INSTRUCTIONS). */
  paymentInstructions: string | null;
};

let current: BillingConfig = { graceDays: 7, publicBaseUrl: null, platformPaystackKey: null, paymentInstructions: null };

export function configureBilling(next: BillingConfig) {
  current = next;
}

export const billingConfig = () => current;

/** Whether invoices can be paid online: the platform's Paystack account, and an address for Paystack to send people back to. */
export const paysOnline = () => Boolean(current.platformPaystackKey && current.publicBaseUrl);
