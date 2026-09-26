// zaina-platform/src/billing/emails.ts
//
// What a business's owners hear about billing, by email: an invoice (and a
// trial about to end), an invoice overdue, the business paused for it, a
// plan that ended, and a receipt. Plain text, sent to each owner whose email
// is confirmed.

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { formatMoney } from "../booking/money.ts";
import { ownerDb } from "../db/platform-db.ts";
import { businesses, staffMemberships, staffUsers, type Invoice } from "../db/schema.ts";
import { sendEmail } from "../platform/mailer.ts";
import { billingConfig, paysOnline } from "./config.ts";
import type { BillingEvent } from "./store.ts";

async function ownersOf(businessId: string): Promise<Array<{ email: string; name: string }>> {
  return ownerDb().select({ email: staffUsers.email, name: staffUsers.name })
    .from(staffMemberships)
    .innerJoin(staffUsers, eq(staffUsers.id, staffMemberships.userId))
    .where(and(eq(staffMemberships.businessId, businessId), eq(staffMemberships.role, "owner"), isNull(staffUsers.disabledAt), isNotNull(staffUsers.emailVerifiedAt)));
}

/** "1 October 2026", on the business's clock. */
export function dayText(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
}

type Email = { subject: string; body: string[] };

function invoiceLines(invoice: Invoice, timeZone: string): string[] {
  return [
    `  Invoice:  ${invoice.number}`,
    `  Plan:     ${invoice.planName} (${invoice.billingInterval === "year" ? "yearly" : "monthly"})`,
    `  Period:   ${dayText(invoice.periodStart, timeZone)} to ${dayText(invoice.periodEnd, timeZone)}`,
    `  Amount:   ${formatMoney(invoice.amountMinor, invoice.currency)}`,
  ];
}

/** How to pay: in the console (card or M-Pesa through Paystack) and, when the platform takes it, by hand. */
function howToPay(invoice: Invoice, link: string): string[] {
  const byHand = billingConfig().paymentInstructions;
  return [
    paysOnline() ? `Pay it by card or M-Pesa in the Zaina console: ${link}` : `See it in the Zaina console: ${link}`,
    ...(byHand ? [`Or pay by hand: ${byHand} Use ${invoice.number} as the reference.`] : []),
  ];
}

export function composeEmail(event: BillingEvent, business: { name: string; timeZone: string; status: string }, link: string): Email {
  const zone = business.timeZone;
  switch (event.kind) {
    case "invoice":
      return {
        subject: event.trialEnds ? `Your Zaina free trial ends on ${dayText(event.trialEnds, zone)}` : `Zaina invoice ${event.invoice.number}: ${formatMoney(event.invoice.amountMinor, event.invoice.currency)} due ${dayText(event.invoice.dueAt, zone)}`,
        body: [
          event.trialEnds
            ? `Your free trial of Zaina for ${business.name} ends on ${dayText(event.trialEnds, zone)}. To keep Zaina answering your customers after that, pay this invoice:`
            : `Here is the invoice for Zaina at ${business.name}, due on ${dayText(event.invoice.dueAt, zone)}:`,
          "",
          ...invoiceLines(event.invoice, zone),
          "",
          ...howToPay(event.invoice, link),
        ],
      };
    case "overdue":
      return {
        subject: `Zaina invoice ${event.invoice.number} is overdue`,
        body: [
          `Invoice ${event.invoice.number} for ${business.name} (${formatMoney(event.invoice.amountMinor, event.invoice.currency)}) was due on ${dayText(event.invoice.dueAt, zone)} and isn't paid yet.`,
          event.pausesAt
            ? `Zaina keeps answering your customers until ${dayText(event.pausesAt, zone)}. After that it pauses until the invoice is paid.`
            : business.status === "onboarding" ? "Pay it to put Zaina live for your customers." : "",
          "",
          ...howToPay(event.invoice, link),
        ],
      };
    case "paused":
      return {
        subject: `Zaina has paused for ${business.name}`,
        body: [
          `Zaina has stopped answering customers for ${business.name}: invoice ${event.invoice.number} (${formatMoney(event.invoice.amountMinor, event.invoice.currency)}) is unpaid.`,
          "Pay it and Zaina answers again straight away. Your knowledge, bookings and settings are all kept.",
          "",
          ...howToPay(event.invoice, link),
        ],
      };
    case "ended":
      return {
        subject: `Your Zaina plan for ${business.name} has ended`,
        body: [
          `Your Zaina plan for ${business.name} has ended, as you asked.${event.paused ? " Zaina has stopped answering your customers." : ""}`,
          "Your knowledge, bookings and settings are kept. Choose a plan any time to start again:",
          link,
        ],
      };
    case "paid": {
      const waived = event.invoice.method === "waived";
      const how = event.invoice.method === "paystack"
        ? `by card or M-Pesa through Paystack${event.invoice.receipt ? ` (transaction ${event.invoice.receipt})` : ""}`
        : `by hand${event.invoice.receipt ? ` (receipt ${event.invoice.receipt})` : ""}`;
      return {
        subject: waived ? `Zaina invoice ${event.invoice.number} is waived` : `Receipt: Zaina invoice ${event.invoice.number} is paid`,
        body: [
          waived ? `The Zaina team has waived invoice ${event.invoice.number} for ${business.name}: there's nothing to pay.` : `Thank you: invoice ${event.invoice.number} for ${business.name} is paid.`,
          "",
          ...invoiceLines(event.invoice, zone),
          ...(waived ? [] : [`  Paid:     ${dayText(event.invoice.paidAt ?? new Date(), zone)}, ${how}`]),
          "",
          `Your plan is paid through ${dayText(event.paidThrough, zone)}.${event.resumed ? " Zaina is answering your customers again." : ""}`,
          `Your invoices are in the Zaina console: ${link}`,
        ],
      };
    }
  }
}

/** Emails a business's owners about what just happened to its billing. */
export async function tellOwners(businessId: string, events: BillingEvent[]): Promise<void> {
  const [business] = await ownerDb().select({ name: businesses.name, timeZone: businesses.timeZone, status: businesses.status }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) return;
  const people = await ownersOf(businessId);
  const link = `${billingConfig().publicBaseUrl ?? ""}/console/#/b/${encodeURIComponent(businessId)}/settings/billing`;
  for (const event of events) {
    const email = composeEmail(event, business, link);
    for (const person of people) {
      const text = [`Hi ${person.name.trim().split(/\s+/)[0] ?? ""},`, "", ...email.body].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
      await sendEmail({ to: person.email, subject: email.subject, text });
    }
  }
}
