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

export function getReceiptCode(booking: Pick<Booking, "id" | "paymentReference" | "paidAt">) {
  const source = `${booking.id}:${booking.paymentReference ?? ""}:${booking.paidAt ?? ""}`;
  const reference = getReceiptBookingReference(booking.id).replace(/[^A-Z0-9]/g, "") || "RECEIPT";
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash) + source.charCodeAt(index);
  }
  const suffix = (hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
  return `TBM-${reference}-${suffix}`;
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

function compactText(value: string | number | null | undefined, maxLength = 58) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function drawText(text: string, x: number, y: number, size = 11, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function drawLine(x1: number, y1: number, x2: number, y2: number) {
  return `${x1} ${y1} m ${x2} ${y2} l S`;
}

function drawRect(x: number, y: number, width: number, height: number, mode = "f") {
  return `${x} ${y} ${width} ${height} re ${mode}`;
}

function buildPdfDocument(contentStream: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
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
  const receiptCode = getReceiptCode(booking);
  const guestLabel = booking.guestName || booking.guestEmail || "Guest";
  const guestContact = booking.guestPhone && booking.guestEmail
    ? `${booking.guestPhone} / ${booking.guestEmail}`
    : booking.guestPhone || booking.guestEmail || "Not provided";
  const bookingDates = booking.checkOut !== booking.checkIn
    ? `${formatReceiptDate(booking.checkIn)} to ${formatReceiptDate(booking.checkOut)}`
    : formatReceiptDate(booking.checkIn);

  const paymentRows = [
    ["Payment status", getReceiptPaymentStatusLabel(booking)],
    ["Payment provider", getReceiptPaymentProviderLabel(booking.paymentProvider)],
    ["Payment reference", booking.paymentReference || "Pending confirmation"],
    ["Paid at", formatReceiptTimestamp(booking.paidAt)],
  ];
  const bookingRows = [
    ["Booking dates", bookingDates],
    ["Total booking value", formatReceiptAmount(booking.totalPrice)],
    ["Total paid so far", formatReceiptAmount(amountPaid)],
    ["Balance remaining", outstandingAmount > 0 ? formatReceiptAmount(outstandingAmount) : "Fully settled"],
  ];

  const commands = [
    "0.95 0.97 0.96 rg",
    drawRect(0, 0, 612, 792),
    "1 1 1 rg",
    drawRect(42, 42, 528, 708),
    "0.83 0.87 0.84 RG",
    drawRect(42, 42, 528, 708, "S"),
    "0.05 0.20 0.16 rg",
    drawRect(42, 618, 528, 132),
    "0.95 0.55 0.18 rg",
    drawRect(42, 618, 528, 8),
    "1 1 1 rg",
    drawText("TEMBEA BILA MATATA", 74, 710, 11, "F2"),
    drawText("Payment Receipt", 74, 686, 28, "F2"),
    drawText("Official payment receipt. Thank you for choosing us.", 74, 664, 11),
    "0.95 0.55 0.18 rg",
    drawText("RECEIPT CODE", 406, 710, 9, "F2"),
    "1 1 1 rg",
    drawText(receiptCode, 406, 692, 13, "F2"),
    drawText(`Booking ${bookingReference}`, 406, 672, 10),
    "0.98 0.99 0.98 rg",
    drawRect(70, 530, 472, 58),
    "0.86 0.90 0.87 RG",
    drawRect(70, 530, 472, 58, "S"),
    "0.30 0.36 0.32 rg",
    drawText("CLIENT NAME", 90, 566, 8, "F2"),
    drawText("CLIENT CONTACT", 310, 566, 8, "F2"),
    "0.06 0.09 0.16 rg",
    drawText(compactText(guestLabel, 32), 90, 546, 15, "F2"),
    drawText(compactText(guestContact, 36), 310, 546, 11),
    "0.05 0.20 0.16 rg",
    drawRect(70, 444, 222, 62),
    "1 1 1 rg",
    drawText("AMOUNT PAID", 92, 482, 9, "F2"),
    drawText(formatReceiptAmount(amountPaid), 92, 458, 24, "F2"),
    "0.98 0.99 0.98 rg",
    drawRect(314, 444, 228, 62),
    "0.86 0.90 0.87 RG",
    drawRect(314, 444, 228, 62, "S"),
    "0.30 0.36 0.32 rg",
    drawText("BALANCE", 336, 482, 9, "F2"),
    "0.06 0.09 0.16 rg",
    drawText(outstandingAmount > 0 ? formatReceiptAmount(outstandingAmount) : "Fully settled", 336, 458, 20, "F2"),
    "0.05 0.20 0.16 rg",
    drawText("Payment Details", 70, 404, 15, "F2"),
    "0.88 0.91 0.89 RG",
    drawLine(70, 394, 542, 394),
  ];

  let y = 370;
  paymentRows.forEach(([label, value]) => {
    commands.push("0.36 0.42 0.38 rg");
    commands.push(drawText(label.toUpperCase(), 86, y, 8, "F2"));
    commands.push("0.06 0.09 0.16 rg");
    commands.push(drawText(compactText(value, 44), 250, y, 11));
    commands.push("0.92 0.94 0.93 RG");
    commands.push(drawLine(86, y - 13, 526, y - 13));
    y -= 27;
  });

  commands.push("0.05 0.20 0.16 rg");
  commands.push(drawText("Booking Summary", 70, 244, 15, "F2"));
  commands.push("0.88 0.91 0.89 RG");
  commands.push(drawLine(70, 234, 542, 234));

  y = 210;
  bookingRows.forEach(([label, value]) => {
    commands.push("0.36 0.42 0.38 rg");
    commands.push(drawText(label.toUpperCase(), 86, y, 8, "F2"));
    commands.push("0.06 0.09 0.16 rg");
    commands.push(drawText(compactText(value, 44), 250, y, 11));
    commands.push("0.92 0.94 0.93 RG");
    commands.push(drawLine(86, y - 13, 526, y - 13));
    y -= 27;
  });

  commands.push("[3 4] 0 d");
  commands.push("0.76 0.80 0.77 RG");
  commands.push(drawLine(70, 100, 542, 100));
  commands.push("[] 0 d");
  commands.push("0.05 0.20 0.16 rg");
  commands.push(drawText("Thank you", 70, 76, 18, "F2"));
  commands.push("0.30 0.36 0.32 rg");
  commands.push(drawText("We appreciate your trust in Tembea Bila Matata.", 178, 80, 10));
  commands.push(drawText(`Need help? Contact ${CONTACT_EMAIL} or ${CONTACT_PHONE_DISPLAY}.`, 178, 64, 9));

  return buildPdfDocument(commands.join("\n"));
}
