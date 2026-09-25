import {
  bookingPaymentHoldMinutes,
  getBookingAmountPaid,
  getBookingOutstandingAmount,
  hasLockedInBookingDeposit,
} from "../shared/booking-payments.ts";
import type { Booking, BookingPaymentStatus, User } from "../shared/schema.ts";
import { SUPPORT_PHONE_DISPLAY } from "../shared/support-contact.ts";
import { buildVerificationEmail, type VerificationPurpose } from "./verification-email.ts";

type RequestOriginLike = {
  protocol?: string;
  get?(name: string): string | undefined;
} | null | undefined;

export type VerificationChannel = "email" | "sms" | "whatsapp";

type SendEmailArgs = {
  to: string[];
  subject: string;
  html: string;
  text: string;
};

type PaymentNotificationContext = {
  previousStatus?: string | null;
  previousAmountPaid?: number | null;
};

type BookingPaymentNotificationContent = {
  customerSubject: string;
  adminSubject: string;
  body: string;
  sharedLines: string[];
};

const noteworthyPaymentStatuses = new Set<BookingPaymentStatus>(["paid", "processing", "failed", "cancelled", "refunded"]);

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(new Set(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  ));
}

function parseEmailList(value?: string | null) {
  return uniqueNonEmpty((value ?? "").split(","));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function humanizeToken(value: string | null | undefined, fallback = "General request") {
  if (!value) {
    return fallback;
  }

  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getShortBookingReference(bookingId: string) {
  return bookingId.slice(0, 8).toUpperCase();
}

function formatUsd(value: number | null | undefined) {
  const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function normalizeMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined) {
  const amount = normalizeMoney(value);
  const normalizedCurrency = currency?.trim().toUpperCase() || "USD";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${normalizedCurrency} ${amount.toLocaleString("en-US")}`;
  }
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function getPrimaryGuestLabel(booking: Booking) {
  return booking.guestName?.trim() || booking.guestEmail || "Guest";
}

function getBookingCategoryLabel(booking: Booking) {
  if (booking.accommodationId) {
    return "Stay booking";
  }

  if (booking.bookingType === "service" && booking.selectedServices.length === 0) {
    return "Custom service request";
  }

  return humanizeToken(booking.serviceMode, booking.bookingType === "service" ? "Service booking" : "Booking");
}

function getBookingDateLabel(booking: Booking) {
  return booking.checkIn === booking.checkOut
    ? booking.checkIn
    : `${booking.checkIn} to ${booking.checkOut}`;
}

function resolveApplicationBaseUrl(requestLike?: RequestOriginLike) {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  const host = requestLike?.get?.("host");
  if (!host) {
    return null;
  }

  const protocol = requestLike?.protocol?.trim() || "https";
  return `${protocol}://${host}`;
}

function buildApplicationUrl(path: string, requestLike?: RequestOriginLike) {
  const baseUrl = resolveApplicationBaseUrl(requestLike);
  if (!baseUrl) {
    return null;
  }

  return new URL(path, `${baseUrl}/`).toString();
}

function getNotificationRecipientEmails() {
  const configuredRecipients = parseEmailList(process.env.NOTIFICATION_EMAILS);
  if (configuredRecipients.length > 0) {
    return configuredRecipients;
  }

  return parseEmailList(process.env.ADMIN_EMAILS);
}

function getResendEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    return null;
  }

  return { apiKey, from };
}

export function isTransactionalEmailConfigured() {
  return Boolean(getResendEmailConfig());
}

export function queueNotificationTask(label: string, task: Promise<unknown>) {
  void task.catch((error) => {
    console.error(`[NOTIFY] ${label} failed:`, error);
  });
}

async function sendEmailMessage(args: SendEmailArgs) {
  const emailConfig = getResendEmailConfig();
  if (!emailConfig) {
    console.warn("[NOTIFY] Email transport is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
    return false;
  }

  const recipients = uniqueNonEmpty(args.to);
  if (!recipients.length) {
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${emailConfig.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailConfig.from,
      to: recipients,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    console.error(`[NOTIFY] Email send failed with status ${response.status}: ${responseBody}`);
    return false;
  }

  return true;
}

export async function sendVerificationCode(args: {
  channel: VerificationChannel;
  email?: string | null;
  phone?: string | null;
  code: string;
  purpose: VerificationPurpose;
}) {
  if (args.channel === "email") {
    if (!args.email) {
      return false;
    }

    const emailContent = buildVerificationEmail({
      code: args.code,
      purpose: args.purpose,
    });
    return await sendEmailMessage({
      to: [args.email],
      ...emailContent,
    });
  }

  console.warn(`[NOTIFY] ${args.channel} verification is not configured yet. Email is the active verification channel.`);
  return false;
}

export async function sendSignupNotificationEmails(
  user: Pick<User, "email" | "phone" | "firstName" | "lastName" | "role">,
  requestLike?: RequestOriginLike,
) {
  const tasks: Promise<boolean>[] = [];
  const adminRecipients = getNotificationRecipientEmails();
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || "there";
  const bookingsUrl = buildApplicationUrl("/bookings", requestLike);
  const adminUrl = buildApplicationUrl("/admin/clients", requestLike);

  if (user.email) {
    tasks.push(sendEmailMessage({
      to: [user.email],
      subject: "Welcome to Tembea Bila Matata",
      text: [
        `Hi ${fullName},`,
        "",
        "Your account is ready. You can now sign in with the email address or phone number you used during registration.",
        bookingsUrl ? `Manage bookings: ${bookingsUrl}` : "",
      ].filter(Boolean).join("\n"),
      html: [
        "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
        `<p>Hi ${escapeHtml(fullName)},</p>`,
        "<p>Your account is ready. You can now sign in with the email address or phone number you used during registration.</p>",
        bookingsUrl ? `<p><a href="${escapeHtml(bookingsUrl)}">Open My Bookings</a></p>` : "",
        "</div>",
      ].join(""),
    }));
  }

  if (adminRecipients.length > 0) {
    tasks.push(sendEmailMessage({
      to: adminRecipients,
      subject: `New account signup: ${fullName}`,
      text: [
        "A new account has been created.",
        `Name: ${fullName}`,
        `Email: ${user.email || "Not provided"}`,
        `Phone: ${user.phone || "Not provided"}`,
        `Role: ${user.role}`,
        adminUrl ? `Open admin clients: ${adminUrl}` : "",
      ].filter(Boolean).join("\n"),
      html: [
        "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
        "<p>A new account has been created.</p>",
        "<ul>",
        `<li><strong>Name:</strong> ${escapeHtml(fullName)}</li>`,
        `<li><strong>Email:</strong> ${escapeHtml(user.email || "Not provided")}</li>`,
        `<li><strong>Phone:</strong> ${escapeHtml(user.phone || "Not provided")}</li>`,
        `<li><strong>Role:</strong> ${escapeHtml(user.role)}</li>`,
        "</ul>",
        adminUrl ? `<p><a href="${escapeHtml(adminUrl)}">Open admin clients</a></p>` : "",
        "</div>",
      ].join(""),
    }));
  }

  if (!tasks.length) {
    return false;
  }

  await Promise.allSettled(tasks);
  return true;
}

function buildBookingSummaryLines(booking: Booking) {
  return [
    `Booking reference: ${getShortBookingReference(booking.id)}`,
    `Booking type: ${getBookingCategoryLabel(booking)}`,
    `Guest: ${getPrimaryGuestLabel(booking)}`,
    `Guest email: ${booking.guestEmail}`,
    booking.guestPhone ? `Guest phone: ${booking.guestPhone}` : null,
    `Dates: ${getBookingDateLabel(booking)}`,
    `Guests: ${booking.guests}`,
    `Total: ${formatUsd(booking.totalPrice)}`,
    `Payment status: ${booking.paymentStatus}`,
  ].filter(Boolean) as string[];
}

// Stays, cars, and chefs are reserved for particular dates.
function reservesDates(booking: Booking) {
  return Boolean(booking.accommodationId)
    || (booking.serviceMode ?? "").startsWith("car-")
    || booking.serviceMode === "cook-service-fee"
    || booking.serviceMode === "cook-inclusive";
}

/** What an unpaid booking's guest needs to know about paying for it. */
function buildPaymentGuidance(booking: Booking): string[] {
  if (booking.totalPrice <= 0 || getBookingAmountPaid(booking) > 0) {
    return [];
  }
  const payment = (booking.paymentDepositAmount ?? 0) > 0 ? "the deposit" : "for it";
  return [
    reservesDates(booking)
      ? `Your dates are reserved once you pay ${payment} in My Bookings. When you press "Pay now", we hold them for you for ${bookingPaymentHoldMinutes} minutes while you complete the payment.`
      : `Your booking goes ahead once you pay ${payment} in My Bookings.`,
    `Trouble paying? Our support team can help — WhatsApp or call ${SUPPORT_PHONE_DISPLAY}.`,
  ];
}

export async function sendBookingCreatedNotificationEmails(booking: Booking, requestLike?: RequestOriginLike) {
  const tasks: Promise<boolean>[] = [];
  const adminRecipients = getNotificationRecipientEmails();
  const customerUrl = buildApplicationUrl(`/bookings?bookingId=${booking.id}`, requestLike);
  const adminUrl = buildApplicationUrl(`/admin/bookings?bookingId=${booking.id}`, requestLike);
  const summaryLines = buildBookingSummaryLines(booking);
  const customerName = getPrimaryGuestLabel(booking);
  const paymentGuidance = buildPaymentGuidance(booking);

  tasks.push(sendEmailMessage({
    to: [booking.guestEmail],
    subject: `Booking received: ${getShortBookingReference(booking.id)}`,
    text: [
      `Hi ${customerName},`,
      "",
      "We have received your booking request.",
      ...summaryLines,
      ...(paymentGuidance.length > 0 ? ["", ...paymentGuidance] : []),
      customerUrl ? `View booking: ${customerUrl}` : "",
    ].filter(Boolean).join("\n"),
    html: [
      "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
      `<p>Hi ${escapeHtml(customerName)},</p>`,
      "<p>We have received your booking request.</p>",
      "<ul>",
      ...summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`),
      "</ul>",
      ...paymentGuidance.map((line) => `<p>${escapeHtml(line)}</p>`),
      customerUrl ? `<p><a href="${escapeHtml(customerUrl)}">View booking</a></p>` : "",
      "</div>",
    ].join(""),
  }));

  if (adminRecipients.length > 0) {
    tasks.push(sendEmailMessage({
      to: adminRecipients,
      subject: `New booking: ${getShortBookingReference(booking.id)}`,
      text: [
        "A new booking was created.",
        ...summaryLines,
        adminUrl ? `Open admin booking view: ${adminUrl}` : "",
      ].filter(Boolean).join("\n"),
      html: [
        "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
        "<p>A new booking was created.</p>",
        "<ul>",
        ...summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`),
        "</ul>",
        adminUrl ? `<p><a href="${escapeHtml(adminUrl)}">Open admin booking view</a></p>` : "",
        "</div>",
      ].join(""),
    }));
  }

  await Promise.allSettled(tasks);
  return true;
}

function getPaymentStatusMessaging(status: BookingPaymentStatus) {
  switch (status) {
    case "paid":
      return {
        customerSubject: "Payment confirmed",
        adminSubject: "Payment received",
        body: "The payment for this booking has been confirmed.",
      };
    case "processing":
      return {
        customerSubject: "Payment update: processing",
        adminSubject: "Payment update: processing",
        body: "The payment is still processing.",
      };
    case "cancelled":
      return {
        customerSubject: "Payment cancelled",
        adminSubject: "Payment cancelled",
        body: "The payment for this booking was cancelled.",
      };
    case "refunded":
      return {
        customerSubject: "Payment refunded",
        adminSubject: "Payment refunded",
        body: "The payment for this booking was refunded.",
      };
    default:
      return {
        customerSubject: "Payment failed",
        adminSubject: "Payment failed",
        body: "The payment for this booking failed and may need attention.",
      };
  }
}

export function buildBookingPaymentNotificationContent(
  booking: Booking,
  context: PaymentNotificationContext = {},
) {
  const normalizedStatus = (booking.paymentStatus ?? "pending") as BookingPaymentStatus;
  const previousStatus = context.previousStatus ?? null;
  const currentAmountPaid = getBookingAmountPaid(booking);
  const previousAmountPaid = normalizeMoney(context.previousAmountPaid);
  const latestPaymentAmount = Math.max(0, currentAmountPaid - previousAmountPaid);
  const outstandingAmount = getBookingOutstandingAmount(booking);
  const shouldSendReceipt = latestPaymentAmount > 0;
  const shouldSendStatusUpdate = noteworthyPaymentStatuses.has(normalizedStatus) && normalizedStatus !== previousStatus;

  if (!shouldSendReceipt && !shouldSendStatusUpdate) {
    return null;
  }

  const paymentCopy = shouldSendReceipt
    ? {
      customerSubject: "Payment receipt",
      adminSubject: hasLockedInBookingDeposit(booking) ? "Deposit received" : "Payment received",
      body: outstandingAmount > 0
        ? hasLockedInBookingDeposit(booking)
          ? `We have received your deposit payment of ${formatUsd(latestPaymentAmount)}. Your dates remain held while the remaining balance is settled.`
          : `We have received your payment of ${formatUsd(latestPaymentAmount)}. There is still a balance remaining on this booking.`
        : `We have received your payment of ${formatUsd(latestPaymentAmount)}. This booking is now fully paid.`,
    }
    : normalizedStatus === "processing" && booking.paymentProvider === "mpesa-manual"
      ? {
        customerSubject: "M-Pesa payment submitted",
        adminSubject: "Manual M-Pesa submitted",
        body: "We have received your temporary M-Pesa payment submission and are confirming it now.",
      }
    : getPaymentStatusMessaging(normalizedStatus);

  const providerChargeLine = booking.paymentCurrency
    && booking.paymentCurrency.trim().toUpperCase() !== "USD"
    && normalizeMoney(booking.paymentAmount) > 0
    ? `Provider charge: ${formatMoney(booking.paymentAmount, booking.paymentCurrency)}`
    : null;
  const paidAtLine = formatTimestamp(booking.paidAt);
  const providerLabel = booking.paymentProvider === "mpesa-manual"
    ? "Temporary M-Pesa"
    : booking.paymentProvider ? humanizeToken(booking.paymentProvider, booking.paymentProvider) : null;
  const sharedLines = [
    `Booking reference: ${getShortBookingReference(booking.id)}`,
    `Guest: ${getPrimaryGuestLabel(booking)}`,
    `Booking type: ${getBookingCategoryLabel(booking)}`,
    shouldSendReceipt ? `Receipt amount: ${formatUsd(latestPaymentAmount)}` : null,
    currentAmountPaid > 0 ? `Total paid: ${formatUsd(currentAmountPaid)}` : null,
    outstandingAmount > 0 ? `Balance remaining: ${formatUsd(outstandingAmount)}` : null,
    `Payment status: ${normalizedStatus}`,
    providerLabel ? `Provider: ${providerLabel}` : null,
    booking.paymentReference ? `Reference: ${booking.paymentReference}` : null,
    providerChargeLine,
    paidAtLine ? `Paid at: ${paidAtLine}` : null,
  ].filter(Boolean) as string[];

  return {
    ...paymentCopy,
    sharedLines,
  } satisfies BookingPaymentNotificationContent;
}

export async function sendBookingPaymentNotificationEmails(
  booking: Booking,
  context: PaymentNotificationContext = {},
  requestLike?: RequestOriginLike,
) {
  const paymentContent = buildBookingPaymentNotificationContent(booking, context);
  if (!paymentContent) {
    return false;
  }

  const tasks: Promise<boolean>[] = [];
  const adminRecipients = getNotificationRecipientEmails();
  const customerUrl = buildApplicationUrl(`/bookings?bookingId=${booking.id}`, requestLike);
  const adminUrl = buildApplicationUrl(`/admin/bookings?bookingId=${booking.id}`, requestLike);

  tasks.push(sendEmailMessage({
    to: [booking.guestEmail],
    subject: `${paymentContent.customerSubject} for booking ${getShortBookingReference(booking.id)}`,
    text: [
      `Hi ${getPrimaryGuestLabel(booking)},`,
      "",
      paymentContent.body,
      ...paymentContent.sharedLines,
      customerUrl ? `View booking: ${customerUrl}` : "",
    ].filter(Boolean).join("\n"),
    html: [
      "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
      `<p>Hi ${escapeHtml(getPrimaryGuestLabel(booking))},</p>`,
      `<p>${escapeHtml(paymentContent.body)}</p>`,
      "<ul>",
      ...paymentContent.sharedLines.map((line) => `<li>${escapeHtml(line)}</li>`),
      "</ul>",
      customerUrl ? `<p><a href="${escapeHtml(customerUrl)}">View booking</a></p>` : "",
      "</div>",
    ].join(""),
  }));

  if (adminRecipients.length > 0) {
    tasks.push(sendEmailMessage({
      to: adminRecipients,
      subject: `${paymentContent.adminSubject}: ${getShortBookingReference(booking.id)}`,
      text: [
        paymentContent.body,
        ...paymentContent.sharedLines,
        adminUrl ? `Open admin booking view: ${adminUrl}` : "",
      ].filter(Boolean).join("\n"),
      html: [
        "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
        `<p>${escapeHtml(paymentContent.body)}</p>`,
        "<ul>",
        ...paymentContent.sharedLines.map((line) => `<li>${escapeHtml(line)}</li>`),
        "</ul>",
        adminUrl ? `<p><a href="${escapeHtml(adminUrl)}">Open admin booking view</a></p>` : "",
        "</div>",
      ].join(""),
    }));
  }

  await Promise.allSettled(tasks);
  return true;
}

/**
 * What a guest is told when their payment landed on dates that another
 * guest had already paid for (or that were blocked) moments earlier.
 */
function buildDatesTakenNotice(itemLabel: string, takenByAnotherGuest: boolean) {
  const what = takenByAnotherGuest
    ? `${itemLabel} had already been booked by another guest for these dates`
    : `${itemLabel} was no longer available for these dates`;
  return `We received your payment, but ${what} moments before your payment went through. `
    + "Our support team will contact you shortly to move your booking to other dates or refund you in full. "
    + `You can also reach us on WhatsApp or call ${SUPPORT_PHONE_DISPLAY}.`;
}

export async function sendBookingDatesTakenEmails(
  booking: Booking,
  details: { itemLabel: string; otherBookingId: string | null },
  requestLike?: RequestOriginLike,
) {
  const reference = getShortBookingReference(booking.id);
  const customerUrl = buildApplicationUrl(`/bookings?bookingId=${booking.id}`, requestLike);
  const adminUrl = buildApplicationUrl(`/admin/bookings?bookingId=${booking.id}`, requestLike);
  const notice = buildDatesTakenNotice(details.itemLabel, details.otherBookingId !== null);
  const tasks: Promise<boolean>[] = [
    sendEmailMessage({
      to: [booking.guestEmail],
      subject: `About your payment for booking ${reference}`,
      text: [
        `Hi ${getPrimaryGuestLabel(booking)},`,
        notice,
        customerUrl ? `View booking: ${customerUrl}` : "",
      ].filter(Boolean).join("\n\n"),
      html: [
        "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
        `<p>Hi ${escapeHtml(getPrimaryGuestLabel(booking))},</p>`,
        `<p>${escapeHtml(notice)}</p>`,
        customerUrl ? `<p><a href="${escapeHtml(customerUrl)}">View booking</a></p>` : "",
        "</div>",
      ].join(""),
    }),
  ];

  const adminRecipients = getNotificationRecipientEmails();
  if (adminRecipients.length > 0) {
    const lines = [
      "A payment landed on dates that were already taken. Contact the guest to move the booking to other dates or refund them.",
      `Booking reference: ${reference}`,
      `Guest: ${getPrimaryGuestLabel(booking)} · ${booking.guestEmail}${booking.guestPhone ? ` · ${booking.guestPhone}` : ""}`,
      `Booked: ${details.itemLabel}, ${getBookingDateLabel(booking)}`,
      `Paid: ${formatUsd(getBookingAmountPaid(booking))}`,
      details.otherBookingId
        ? `Already paid by booking ${getShortBookingReference(details.otherBookingId)}`
        : "The dates are blocked in the calendar",
    ];
    tasks.push(sendEmailMessage({
      to: adminRecipients,
      subject: `Dates already taken — move or refund: ${reference}`,
      text: [...lines, adminUrl ? `Open admin booking view: ${adminUrl}` : ""].filter(Boolean).join("\n"),
      html: [
        "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
        `<p>${escapeHtml(lines[0])}</p>`,
        "<ul>",
        ...lines.slice(1).map((line) => `<li>${escapeHtml(line)}</li>`),
        "</ul>",
        adminUrl ? `<p><a href="${escapeHtml(adminUrl)}">Open admin booking view</a></p>` : "",
        "</div>",
      ].join(""),
    }));
  }

  await Promise.allSettled(tasks);
  return true;
}
// ─────────────────────────────────────────────────────────────────
// Zaina AI Concierge — ops alerts
// ─────────────────────────────────────────────────────────────────

export type ZainaOpsAlertKind =
  | "handoff-requested"
  | "custom-offer"
  | "listing-verification-paid"
  | "system-error"
  | "new-lead";

export type ZainaOpsAlert = {
  kind: ZainaOpsAlertKind;
  sessionId: string;
  summary: string;
  details?: Record<string, unknown>;
  customerName?: string | null;
  customerContact?: string | null;
};

const zainaAlertLabels: Record<ZainaOpsAlertKind, string> = {
  "handoff-requested": "Zaina handoff",
  "custom-offer": "Zaina custom offer",
  "listing-verification-paid": "Paid listing verification",
  "system-error": "Zaina system error",
  "new-lead": "Zaina new lead",
};

export async function sendOpsAlertEmail(alert: ZainaOpsAlert): Promise<boolean> {
  const recipients = getNotificationRecipientEmails();
  if (recipients.length === 0) {
    console.warn("[ZAINA] No ops recipients configured (set NOTIFICATION_EMAILS or ADMIN_EMAILS).");
    return false;
  }

  const label = zainaAlertLabels[alert.kind];
  const subject = `[${label}] ${alert.summary}`.slice(0, 160);

  const detailLines = alert.details
    ? Object.entries(alert.details)
        .filter(([, value]) => value != null && value !== "")
        .map(([key, value]) => {
          const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
          return `${key}: ${rendered}`;
        })
    : [];

  const text = [
    alert.summary,
    `Session: ${alert.sessionId}`,
    alert.customerName ? `Customer: ${alert.customerName}` : null,
    alert.customerContact ? `Contact: ${alert.customerContact}` : null,
    ...detailLines,
  ].filter(Boolean).join("\n");

  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">',
    `<p><strong>${escapeHtml(label)}</strong></p>`,
    `<p>${escapeHtml(alert.summary)}</p>`,
    "<ul>",
    `<li><strong>Session:</strong> ${escapeHtml(alert.sessionId)}</li>`,
    alert.customerName
      ? `<li><strong>Customer:</strong> ${escapeHtml(alert.customerName)}</li>`
      : "",
    alert.customerContact
      ? `<li><strong>Contact:</strong> ${escapeHtml(alert.customerContact)}</li>`
      : "",
    ...detailLines.map((line) => `<li>${escapeHtml(line)}</li>`),
    "</ul>",
    "</div>",
  ].filter(Boolean).join("");

  return await sendEmailMessage({ to: recipients, subject, text, html });
}
// ═══════════════════════════════════════════════════════════════════
// Zaina admin notifications
// ═══════════════════════════════════════════════════════════════════

export type ZainaTranscriptEntry = {
  actor: string;
  text: string;
  timestamp: string;
};

function renderTranscriptText(entries: ZainaTranscriptEntry[]): string {
  return entries
    .map((e) => {
      const label =
        e.actor === "USER" ? "Customer" :
        e.actor === "ZAINA_REASONING" ? "Zaina" :
        e.actor === "AGENT" ? "Agent" :
        e.actor;
      return `[${e.timestamp}] ${label}: ${e.text}`;
    })
    .join("\n\n");
}

function renderTranscriptHtml(entries: ZainaTranscriptEntry[]): string {
  return entries
    .map((e) => {
      const label =
        e.actor === "USER" ? "Customer" :
        e.actor === "ZAINA_REASONING" ? "Zaina" :
        e.actor === "AGENT" ? "Agent" :
        e.actor;
      return `<div style="margin:8px 0;padding:8px 12px;border-radius:8px;background:${e.actor === "USER" ? "#f3f4f6" : "#ecfdf5"};"><strong>${escapeHtml(label)}</strong><br>${escapeHtml(e.text).replace(/\n/g, "<br>")}<br><small style="color:#6b7280;">${escapeHtml(e.timestamp)}</small></div>`;
    })
    .join("");
}

export async function sendZainaConversationStartedEmail(args: {
  sessionId: string;
  firstMessage: string;
  timestamp: string;
}): Promise<boolean> {
  const recipients = getNotificationRecipientEmails();
  if (recipients.length === 0) return false;

  const short = args.sessionId.slice(0, 8);
  const subject = `[Zaina] New conversation — ${short}`;
  const adminUrl = `${process.env.APP_BASE_URL?.trim() || "https://tembeabilamatata.com"}/admin/zaina`;

  const text = [
    "A new conversation with Zaina has started.",
    "",
    `Session: ${args.sessionId}`,
    `Started: ${args.timestamp}`,
    "",
    "First message from the customer:",
    `"${args.firstMessage}"`,
    "",
    `Open the admin console: ${adminUrl}`,
  ].join("\n");

  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">',
    "<h2>New Zaina conversation</h2>",
    `<p><strong>Session:</strong> ${escapeHtml(args.sessionId)}</p>`,
    `<p><strong>Started:</strong> ${escapeHtml(args.timestamp)}</p>`,
    "<p><strong>First message:</strong></p>",
    `<blockquote style="border-left:3px solid #10b981;padding-left:12px;color:#374151;">${escapeHtml(args.firstMessage)}</blockquote>`,
    `<p><a href="${escapeHtml(adminUrl)}">Open admin console →</a></p>`,
    "</div>",
  ].join("");

  return await sendEmailMessage({ to: recipients, subject, text, html });
}

export async function sendZainaBookingCreatedEmail(args: {
  bookingId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  kind: "stay" | "service";
  summary: string;
  totalDisplay: string;
  paymentLink: string;
  sessionId: string;
  transcript: ZainaTranscriptEntry[];
}): Promise<boolean> {
  const recipients = getNotificationRecipientEmails();
  if (recipients.length === 0) return false;

  const ref = args.bookingId.slice(0, 8).toUpperCase();
  const adminUrl = `${process.env.APP_BASE_URL?.trim() || "https://tembeabilamatata.com"}/admin/bookings`;

  const subject = `[Zaina] ${args.kind === "stay" ? "Stay" : "Service"} booking — ${ref}`;

  const header = [
    "A booking was created via Zaina.",
    "",
    `Booking reference: ${ref}`,
    `Booking ID: ${args.bookingId}`,
    `Type: ${args.kind === "stay" ? "Stay booking" : "Service booking"}`,
    `Summary: ${args.summary}`,
    `Total: ${args.totalDisplay}`,
    "",
    `Customer: ${args.customerName}`,
    `Email: ${args.customerEmail}`,
    `Phone: ${args.customerPhone}`,
    "",
    `Payment link sent to customer: ${args.paymentLink}`,
    `Admin console: ${adminUrl}`,
    "",
    "─── FULL TRANSCRIPT ───",
    "",
  ].join("\n");

  const text = header + renderTranscriptText(args.transcript);

  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">',
    `<h2>Zaina booking — ${escapeHtml(ref)}</h2>`,
    "<ul>",
    `<li><strong>Booking ID:</strong> ${escapeHtml(args.bookingId)}</li>`,
    `<li><strong>Type:</strong> ${args.kind === "stay" ? "Stay" : "Service"}</li>`,
    `<li><strong>Summary:</strong> ${escapeHtml(args.summary)}</li>`,
    `<li><strong>Total:</strong> ${escapeHtml(args.totalDisplay)}</li>`,
    `<li><strong>Customer:</strong> ${escapeHtml(args.customerName)}</li>`,
    `<li><strong>Email:</strong> ${escapeHtml(args.customerEmail)}</li>`,
    `<li><strong>Phone:</strong> ${escapeHtml(args.customerPhone)}</li>`,
    "</ul>",
    `<p><a href="${escapeHtml(args.paymentLink)}">Customer payment link</a> · <a href="${escapeHtml(adminUrl)}">Admin console</a></p>`,
    "<h3>Full transcript</h3>",
    renderTranscriptHtml(args.transcript),
    "</div>",
  ].join("");

  return await sendEmailMessage({ to: recipients, subject, text, html });
}

export async function sendListingVerificationCompletedEmail(args: {
  customerEmail: string;
  customerName: string;
  bookingId: string;
  status: "verified" | "warning";
  reportSummary: string;
  reportUrl?: string | null;
  approvalUrl: string;
}): Promise<boolean> {
  const outcomeLabel = args.status === "verified" ? "Verification report ready" : "Verification needs your attention";
  const bookingUrl = `${process.env.APP_BASE_URL?.trim() || "https://tembeabilamatata.com"}/bookings?bookingId=${encodeURIComponent(args.bookingId)}`;
  const text = [
    `Hi ${args.customerName},`,
    "",
    args.status === "verified"
      ? "Our on-ground team has completed the listing verification."
      : "Our on-ground team has completed the listing verification and found points that need closer attention.",
    "",
    args.reportSummary,
    args.reportUrl ? `Report: ${args.reportUrl}` : "",
    `Open your verification in My Bookings: ${args.approvalUrl || bookingUrl}`,
    "If you proceed with a TBM booking, the paid verification fee can be credited to the final quotation.",
  ].filter(Boolean).join("\n");
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">',
    `<p>Hi ${escapeHtml(args.customerName)},</p>`,
    `<p>${args.status === "verified" ? "Our on-ground team has completed the listing verification." : "Our on-ground team has completed the listing verification and found points that need closer attention."}</p>`,
    `<p>${escapeHtml(args.reportSummary).replace(/\n/g, "<br>")}</p>`,
    args.reportUrl ? `<p><a href="${escapeHtml(args.reportUrl)}">Open the report</a></p>` : "",
    `<p><a href="${escapeHtml(args.approvalUrl || bookingUrl)}">Open verification in My Bookings</a></p>`,
    "<p>Your paid verification fee can be credited to the final quotation if you proceed with a TBM booking.</p>",
    "</div>",
  ].join("");
  return await sendEmailMessage({
    to: [args.customerEmail],
    subject: `[Tembea Bila Matata] ${outcomeLabel}`,
    text,
    html,
  });
}
