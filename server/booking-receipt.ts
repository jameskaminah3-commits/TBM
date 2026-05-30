import type { Booking } from "../shared/schema.ts";
import {
  getBookingAmountPaid,
  getBookingOutstandingAmount,
  hasLockedInBookingDeposit,
} from "../shared/booking-payments.ts";

const CONTACT_EMAIL = "contact@tembeabilamatata.com";
const CONTACT_PHONE_DISPLAY = "+254 718 475 264";

export function getReceiptBookingReference(bookingId: string) {
  return bookingId.slice(0, 8).toUpperCase();
}

export function getReceiptDownloadFilename(bookingId: string) {
  return `tembea-bila-matata-receipt-${getReceiptBookingReference(bookingId)}.pdf`;
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

function escapePdfText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function drawText(text: string, x: number, y: number, size = 11) {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function drawLine(x1: number, y1: number, x2: number, y2: number) {
  return `${x1} ${y1} m ${x2} ${y2} l S`;
}

function buildPdfDocument(contentStream: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(contentStream, "latin1")} >>\nstream\n${contentStream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${offsets[index].toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

export function buildBookingReceiptPdf(booking: Booking) {
  const amountPaid = getBookingAmountPaid(booking);
  const outstandingAmount = getBookingOutstandingAmount(booking);
  const bookingReference = getReceiptBookingReference(booking.id);
  const guestLabel = booking.guestName || booking.guestEmail || "Guest";
  const bookingDates = booking.checkOut !== booking.checkIn
    ? `${formatReceiptDate(booking.checkIn)} to ${formatReceiptDate(booking.checkOut)}`
    : formatReceiptDate(booking.checkIn);

  const rows = [
    ["Guest", guestLabel],
    ["Receipt amount", formatReceiptAmount(amountPaid)],
    ["Payment status", getReceiptPaymentStatusLabel(booking)],
    ["Paid at", formatReceiptTimestamp(booking.paidAt)],
    ["Booking dates", bookingDates],
    ["Total booking value", formatReceiptAmount(booking.totalPrice)],
    ["Total paid so far", formatReceiptAmount(amountPaid)],
    ["Balance remaining", outstandingAmount > 0 ? formatReceiptAmount(outstandingAmount) : "Fully settled"],
    ["Payment provider", getReceiptPaymentProviderLabel(booking.paymentProvider)],
    ["Payment reference", booking.paymentReference || "Pending confirmation"],
  ];

  const commands = [
    "0.96 0.97 0.98 rg 0 0 612 792 re f",
    "1 1 1 rg 54 56 504 680 re f",
    "0.88 0.91 0.95 RG 54 56 504 680 re S",
    "0.39 0.45 0.55 rg",
    drawText("TEMBEA BILA MATATA", 78, 696, 10),
    "0.06 0.09 0.16 rg",
    drawText("Payment Receipt", 78, 668, 28),
    "0.29 0.33 0.41 rg",
    drawText(`Booking reference ${bookingReference}`, 78, 646, 12),
    "0.88 0.91 0.95 RG",
    drawLine(78, 622, 534, 622),
  ];

  let y = 592;
  rows.forEach(([label, value]) => {
    commands.push("0.39 0.45 0.55 rg");
    commands.push(drawText(label.toUpperCase(), 78, y, 9));
    commands.push("0.06 0.09 0.16 rg");
    commands.push(drawText(value, 236, y, 12));
    y -= 30;
  });

  commands.push("0.88 0.91 0.95 RG");
  commands.push(drawLine(78, 126, 534, 126));
  commands.push("0.29 0.33 0.41 rg");
  commands.push(drawText(`Need help? Contact ${CONTACT_EMAIL} or ${CONTACT_PHONE_DISPLAY}.`, 78, 104, 10));

  return buildPdfDocument(commands.join("\n"));
}
