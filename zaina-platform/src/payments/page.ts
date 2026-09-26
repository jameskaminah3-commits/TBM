// zaina-platform/src/payments/page.ts
//
// The payment page a booking's link opens (/pay/<token>): the booking, its
// price line by line, where it stands, and the ways to pay the business
// takes. Server-rendered HTML with no scripts. While a payment prompt waits
// on the customer's phone, the page reloads itself.

import type { Booking, BookingSettings, Payment } from "../db/schema.ts";
import { formatDay, holdUntil, stayDates } from "../booking/notices.ts";
import { formatMoney } from "../booking/money.ts";
import type { StayQuote } from "../booking/pricing.ts";
import { onlineWays, type PaymentOptions } from "../booking/settings.ts";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export const PAGE_MESSAGES: Record<string, { kind: "error" | "info" | "ok"; text: string }> = {
  not_available: { kind: "error", text: "That way of paying isn't available for this booking." },
  over_limit: { kind: "error", text: "That amount is more than the business takes that way. Please pay another way." },
  email_needed: { kind: "error", text: "Please give an email address for your receipt." },
  rooms_gone: { kind: "error", text: "Sorry, the rooms for this booking were taken after its hold ended. Please contact us about other dates." },
  wrong_status: { kind: "error", text: "This booking can't be paid now." },
  nothing_due: { kind: "info", text: "There's nothing to pay on this booking now." },
  provider_failed: { kind: "error", text: "The payment couldn't be started just now. Please try again, or pay another way." },
  phone_invalid: { kind: "error", text: "Please give a Safaricom number, like 0712 345 678." },
  code_invalid: { kind: "error", text: "That doesn't look like an M-Pesa code. It's 10 letters and numbers, like QK12ABC34D." },
  code_used: { kind: "error", text: "That M-Pesa code was already used for another booking. Please check it." },
  too_many: { kind: "error", text: "Too many tries. Please wait a few minutes and try again." },
  sent: { kind: "info", text: "We've sent the M-Pesa prompt to your phone." },
  code: { kind: "ok", text: "Thank you: we've got your M-Pesa code." },
};

export type PageView = {
  businessName: string;
  offeringName: string;
  booking: Booking;
  settings: Pick<BookingSettings, "checkInTime" | "checkOutTime" | "cancellationPolicy">;
  options: PaymentOptions;
  due: number;
  /** A payment the customer is in the middle of (a prompt on their phone, a code being checked, a card payment coming back). */
  pending: Payment | null;
  /** Their last payment, when it recently failed. */
  lastFailure: Payment | null;
  message: string | null;
  contactLine: string;
  timeZone: string;
  now: Date;
  host: string;
  token: string;
};

function statusNotice(view: PageView): { kind: "info" | "warn" | "ok" | "error"; lines: string[] } {
  const { booking, businessName } = view;
  const holding = booking.holdExpiresAt !== null && booking.holdExpiresAt > view.now;
  const until = booking.holdExpiresAt ? holdUntil(booking.holdExpiresAt, view.timeZone) : "";
  switch (booking.status) {
    case "held":
      return holding
        ? { kind: "info", lines: [`Your rooms are held until ${until}.`, "Pay the deposit to confirm your booking."] }
        : { kind: "warn", lines: ["The time to pay has passed, so these rooms aren't held any more.", "If they're still free, you can pay now to book them."] };
    case "awaiting_payment":
      return holding
        ? { kind: "info", lines: [booking.source === "chat" ? `${businessName} has accepted your booking.` : `${businessName} is holding your booking.`, `Pay the deposit by ${until} to confirm it.`] }
        : { kind: "warn", lines: ["The time to pay has passed, so these rooms aren't held any more.", "If they're still free, you can pay now to book them."] };
    case "expired":
      return { kind: "warn", lines: ["The time to pay has passed, so these rooms aren't held any more.", "If they're still free, you can pay now to book them."] };
    case "requested":
      return { kind: "info", lines: [`Your request is with ${businessName}.`, holding ? `They'll reply by ${until}, in your chat and by email if you gave one.` : "They'll reply in your chat, and by email if you gave one."] };
    case "confirmed":
      return { kind: "ok", lines: ["Your booking is confirmed.", `See you on ${formatDay(booking.checkIn)}.`] };
    case "conflict":
      return { kind: "warn", lines: ["We've received your payment.", `The team at ${businessName} will contact you shortly to confirm your room.`] };
    case "declined":
      return { kind: "error", lines: [`${businessName} couldn't take this booking request.`] };
    case "cancelled":
      return { kind: "error", lines: ["This booking was cancelled."] };
  }
}

function pendingNotice(view: PageView): string {
  const payment = view.pending;
  if (!payment) return "";
  const amount = formatMoney(payment.amountMinor, payment.currency);
  if (payment.method === "mpesa_express") {
    return `<section class="notice info" role="status"><p><strong>Check your phone.</strong> Enter your M-Pesa PIN to pay ${escapeHtml(amount)}.</p><p>This page updates by itself.</p></section>`;
  }
  if (payment.method === "mpesa_code") {
    return `<section class="notice info" role="status"><p>We've got your M-Pesa code <strong>${escapeHtml(payment.providerReference ?? "")}</strong> for ${escapeHtml(amount)}.</p><p>The team is checking it and will confirm your booking. Your rooms stay held meanwhile.</p></section>`;
  }
  return `<section class="notice info" role="status"><p>Your payment of ${escapeHtml(amount)} is being confirmed.</p><p>This page updates by itself.</p></section>`;
}

function priceTable(view: PageView): string {
  const { booking } = view;
  const quote = booking.quote as unknown as StayQuote;
  const money = (minor: number) => escapeHtml(formatMoney(minor, booking.currency));
  const rows = quote.lines.map((line) => `<tr${line.included ? ' class="sub"' : ""}><th scope="row">${escapeHtml(line.label)}</th><td>${money(line.amount)}</td></tr>`);
  rows.push(`<tr class="total"><th scope="row">Total</th><td>${money(booking.totalMinor)}</td></tr>`);
  if (booking.depositMinor > 0 && booking.depositMinor < booking.totalMinor) {
    const share = typeof quote.deposit_percent === "number" && quote.deposit_rule !== "fixed" ? ` (${quote.deposit_percent}%)` : "";
    rows.push(`<tr class="sub"><th scope="row">Deposit${share}</th><td>${money(booking.depositMinor)}</td></tr>`);
  }
  if (booking.paidMinor > 0) rows.push(`<tr class="sub"><th scope="row">Paid</th><td>${money(booking.paidMinor)}</td></tr>`);
  const balance = booking.totalMinor - booking.paidMinor;
  if (["confirmed", "held", "awaiting_payment", "requested", "expired"].includes(booking.status) && balance > 0) {
    rows.push(`<tr class="sub"><th scope="row">${booking.status === "confirmed" ? "Balance, paid at the property" : "Balance, paid at the property after the deposit"}</th><td>${money(booking.status === "confirmed" ? balance : booking.totalMinor - booking.depositMinor)}</td></tr>`);
  }
  return `<table class="lines"><tbody>${rows.join("")}</tbody></table>`;
}

function payOptions(view: PageView): string {
  const { booking, options, due } = view;
  const payable = ["held", "awaiting_payment", "expired", "confirmed"].includes(booking.status) && due > 0;
  if (!payable || view.pending) return "";
  const amount = escapeHtml(formatMoney(due, booking.currency));
  const action = (path: string) => `/pay/${encodeURIComponent(view.token)}/${path}`;
  const confirmed = booking.status === "confirmed";
  const methods: string[] = [];
  const blocks: Record<string, () => void> = {};
  // Each way to pay the business offers, in its order, within its limits for this amount.
  const first = onlineWays(options, due)[0];
  blocks.paystack = () => methods.push(`<div class="method"><form method="post" action="${action("paystack")}">
${booking.customerEmail ? "" : '<label>Email for your receipt<input name="email" type="email" autocomplete="email" required maxlength="200"></label>'}
<button type="submit">Pay ${amount} by card${booking.currency === "KES" ? " or M-Pesa" : ""}</button>
<p class="hint">On Paystack's secure page.</p></form></div>`);
  blocks.mpesa_express = () => booking.currency === "KES" && methods.push(`<div class="method"><form method="post" action="${action("mpesa")}">
<label>M-Pesa number<span>We'll send a payment prompt to this phone.</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" value="${escapeHtml(booking.customerPhone ?? "")}"></label>
<button type="submit"${first !== "mpesa_express" ? ' class="secondary"' : ""}>Send the M-Pesa prompt for ${amount}</button></form></div>`);
  blocks.mpesa_manual = () => {
    const manual = options.mpesaManual;
    if (!manual || booking.currency !== "KES") return;
    const steps = manual.type === "paybill"
      ? [`M-Pesa → Lipa na M-Pesa → Pay Bill.`, `Business number <strong>${escapeHtml(manual.number)}</strong>, account <strong>${escapeHtml(manual.account ?? booking.reference)}</strong>.`, `Amount <strong>${amount}</strong>.`]
      : [`M-Pesa → Lipa na M-Pesa → Buy Goods and Services.`, `Till number <strong>${escapeHtml(manual.number)}</strong>.`, `Amount <strong>${amount}</strong>.`];
    methods.push(`<div class="method"><h3>${methods.length ? "Or pay with M-Pesa yourself" : "Pay with M-Pesa"}</h3>
<ol class="steps">${steps.map((step) => `<li>${step}</li>`).join("")}</ol>
<form method="post" action="${action("mpesa-code")}"><label>M-Pesa confirmation code<span>From the M-Pesa message, like QK12ABC34D.</span><input name="code" required maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
<button type="submit" class="secondary">Send the code</button></form></div>`);
  };
  for (const way of onlineWays(options, due)) blocks[way]?.();
  if (!methods.length) {
    return `<section class="card"><h2>Paying</h2><p>The team will tell you how to pay. Questions? ${escapeHtml(view.contactLine)}.</p></section>`;
  }
  const heading = confirmed ? `Pay the balance now: ${amount}` : booking.depositMinor >= booking.totalMinor ? `Pay in full: ${amount}` : `Pay the deposit: ${amount}`;
  return `<section class="card"><h2>${heading}</h2>${confirmed ? '<p class="small">Optional: you can also pay at the property.</p>' : ""}${methods.join("")}</section>`;
}

export function renderPayPage(view: PageView): string {
  const { booking } = view;
  const message = view.message ? PAGE_MESSAGES[view.message] : null;
  const waiting = view.pending !== null && view.pending.method !== "mpesa_code";
  const failure = view.lastFailure && !view.pending && booking.status !== "confirmed"
    ? `<section class="notice error" role="alert"><p>Your last payment didn't go through${view.lastFailure.failure ? `: ${escapeHtml(view.lastFailure.failure)}` : ""}.</p><p>You can try again below.</p></section>`
    : "";
  const status = statusNotice(view);
  const nights = Math.round((Date.parse(booking.checkOut) - Date.parse(booking.checkIn)) / 86_400_000);
  const [checkInDay, checkOutDay] = stayDates(booking.checkIn, booking.checkOut).split(" – ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${waiting ? '<meta http-equiv="refresh" content="4">' : ""}
<title>Booking ${escapeHtml(booking.reference)} · ${escapeHtml(view.businessName)}</title>
<link rel="stylesheet" href="/pay-assets/pay.css">
<link rel="icon" href="data:,">
</head>
<body>
<main class="pay">
<header>
<p class="business">${escapeHtml(view.businessName)}</p>
<h1>Your booking</h1>
<p class="ref">Reference <strong>${escapeHtml(booking.reference)}</strong></p>
</header>
${message ? `<section class="notice ${message.kind}" role="${message.kind === "error" ? "alert" : "status"}"><p>${escapeHtml(message.text)}</p></section>` : ""}
${pendingNotice(view)}
${failure}
<section class="notice ${status.kind}">${status.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</section>
<section class="card">
<h2>${escapeHtml(booking.units > 1 ? `${booking.units} × ${view.offeringName}` : view.offeringName)}</h2>
<dl class="facts">
<div><dt>Check-in</dt><dd>${escapeHtml(checkInDay)}, from ${escapeHtml(view.settings.checkInTime)}</dd></div>
<div><dt>Check-out</dt><dd>${escapeHtml(checkOutDay)}, by ${escapeHtml(view.settings.checkOutTime)}</dd></div>
<div><dt>Nights</dt><dd>${nights}</dd></div>
<div><dt>Guests</dt><dd>${booking.guests}</dd></div>
<div><dt>Name</dt><dd>${escapeHtml(booking.customerName)}</dd></div>
</dl>
${priceTable(view)}
</section>
${payOptions(view)}
<section class="card">
<h2>Good to know</h2>
${view.settings.cancellationPolicy ? `<p><strong>Cancellation:</strong> ${escapeHtml(view.settings.cancellationPolicy)}</p>` : ""}
<p>Questions? ${escapeHtml(view.contactLine)}.</p>
</section>
<footer>
<p>Always check the address bar starts with ${escapeHtml(view.host)} before you pay.</p>
<p>Card details are entered on Paystack's page, never here.</p>
</footer>
</main>
</body>
</html>`;
}
