import type { Booking } from "../shared/schema.ts";
import {
  getBookingAmountPaid,
  getBookingOutstandingAmount,
  hasLockedInBookingDeposit,
} from "../shared/booking-payments.ts";

const CONTACT_EMAIL = "contact@tembeabilamatata.com";
const CONTACT_PHONE_DISPLAY = "+254 718 475 264";

export function escapeReceiptHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getReceiptBookingReference(bookingId: string) {
  return bookingId.slice(0, 8).toUpperCase();
}

export function getReceiptDownloadFilename(bookingId: string) {
  return `tembea-bila-matata-receipt-${getReceiptBookingReference(bookingId)}.html`;
}

function formatReceiptAmount(amount: number) {
  return `USD ${Math.max(0, Math.round(amount)).toLocaleString("en-US")}`;
}

function formatReceiptDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatReceiptTimestamp(value?: string | null) {
  if (!value) {
    return "Pending confirmation";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }

  return parsed.toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getReceiptPaymentStatusLabel(booking: Booking) {
  if (booking.paymentStatus === "paid") {
    return "Paid";
  }

  if (hasLockedInBookingDeposit(booking)) {
    return "Deposit paid - balance due";
  }

  if (booking.paymentStatus === "processing") {
    return "Processing";
  }

  if (booking.paymentStatus === "refunded") {
    return "Refunded";
  }

  return "Payment recorded";
}

function getReceiptPaymentProviderLabel(provider?: string | null) {
  if (!provider) {
    return "Not specified";
  }

  if (provider === "mpesa-manual") {
    return "Manual M-Pesa";
  }

  return provider;
}

function receiptListItem(label: string, value: string | number) {
  return `<li>${escapeReceiptHtml(label)}: ${escapeReceiptHtml(value)}</li>`;
}

export function buildBookingReceiptHtml(booking: Booking) {
  const amountPaid = getBookingAmountPaid(booking);
  const outstandingAmount = getBookingOutstandingAmount(booking);
  const bookingReference = getReceiptBookingReference(booking.id);
  const guestLabel = booking.guestName || booking.guestEmail || "Guest";
  const bookingDates = booking.checkOut !== booking.checkIn
    ? `${formatReceiptDate(booking.checkIn)} to ${formatReceiptDate(booking.checkOut)}`
    : formatReceiptDate(booking.checkIn);

  const balanceLine = outstandingAmount > 0
    ? receiptListItem("Balance remaining", formatReceiptAmount(outstandingAmount))
    : "<li>Balance remaining: Fully settled</li>";

  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\" />",
    `<title>Receipt ${escapeReceiptHtml(bookingReference)}</title>`,
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "<style>",
    "body{font-family:Arial,sans-serif;background:#f6f8fb;color:#0f172a;margin:0;padding:32px;}",
    ".sheet{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:24px;padding:32px;box-shadow:0 24px 60px -40px rgba(15,23,42,.35);}",
    ".eyebrow{font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#64748b;font-weight:700;}",
    "h1{font-size:28px;margin:8px 0 4px;}",
    "p{line-height:1.6;color:#475569;}",
    ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:24px 0;}",
    ".card{border:1px solid #e2e8f0;border-radius:18px;padding:16px;background:#f8fafc;}",
    ".label{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#64748b;font-weight:700;}",
    ".value{margin-top:8px;font-size:18px;font-weight:700;color:#0f172a;}",
    "ul{padding-left:18px;line-height:1.8;color:#334155;}",
    ".footer{margin-top:24px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:14px;color:#475569;}",
    "</style>",
    "</head>",
    "<body>",
    "<div class=\"sheet\">",
    "<div class=\"eyebrow\">Tembea Bila Matata</div>",
    "<h1>Payment Receipt</h1>",
    `<p>Booking reference ${escapeReceiptHtml(bookingReference)}</p>`,
    "<div class=\"grid\">",
    `<div class=\"card\"><div class=\"label\">Guest</div><div class=\"value\">${escapeReceiptHtml(guestLabel)}</div></div>`,
    `<div class=\"card\"><div class=\"label\">Receipt amount</div><div class=\"value\">${escapeReceiptHtml(formatReceiptAmount(amountPaid))}</div></div>`,
    `<div class=\"card\"><div class=\"label\">Payment status</div><div class=\"value\">${escapeReceiptHtml(getReceiptPaymentStatusLabel(booking))}</div></div>`,
    `<div class=\"card\"><div class=\"label\">Paid at</div><div class=\"value\">${escapeReceiptHtml(formatReceiptTimestamp(booking.paidAt))}</div></div>`,
    "</div>",
    "<ul>",
    receiptListItem("Booking dates", bookingDates),
    receiptListItem("Total booking value", formatReceiptAmount(booking.totalPrice)),
    receiptListItem("Total paid so far", formatReceiptAmount(amountPaid)),
    balanceLine,
    receiptListItem("Payment provider", getReceiptPaymentProviderLabel(booking.paymentProvider)),
    receiptListItem("Payment reference", booking.paymentReference || "Pending confirmation"),
    "</ul>",
    `<div class=\"footer\">Need help? Contact ${escapeReceiptHtml(CONTACT_EMAIL)} or ${escapeReceiptHtml(CONTACT_PHONE_DISPLAY)}.</div>`,
    "</div>",
    "</body>",
    "</html>",
  ].join("");
}
