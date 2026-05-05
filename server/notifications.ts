import {
  getBookingAmountPaid,
  getBookingOutstandingAmount,
  hasLockedInBookingDeposit,
} from "../shared/booking-payments.ts";
import type { Booking, BookingPaymentStatus, User } from "../shared/schema.ts";
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

export async function sendBookingCreatedNotificationEmails(booking: Booking, requestLike?: RequestOriginLike) {
  const tasks: Promise<boolean>[] = [];
  const adminRecipients = getNotificationRecipientEmails();
  const customerUrl = buildApplicationUrl(`/bookings?bookingId=${booking.id}`, requestLike);
  const adminUrl = buildApplicationUrl(`/admin/bookings?bookingId=${booking.id}`, requestLike);
  const summaryLines = buildBookingSummaryLines(booking);
  const customerName = getPrimaryGuestLabel(booking);

  tasks.push(sendEmailMessage({
    to: [booking.guestEmail],
    subject: `Booking received: ${getShortBookingReference(booking.id)}`,
    text: [
      `Hi ${customerName},`,
      "",
      "We have received your booking request.",
      ...summaryLines,
      customerUrl ? `View booking: ${customerUrl}` : "",
    ].filter(Boolean).join("\n"),
    html: [
      "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
      `<p>Hi ${escapeHtml(customerName)},</p>`,
      "<p>We have received your booking request.</p>",
      "<ul>",
      ...summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`),
      "</ul>",
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
