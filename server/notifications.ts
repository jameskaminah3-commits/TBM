import {
  bookingPaymentHoldMinutes,
  getBookingAmountPaid,
  getBookingOutstandingAmount,
  hasLockedInBookingDeposit,
} from "../shared/booking-payments.ts";
import type { Booking, BookingPaymentStatus, User } from "../shared/schema.ts";
import { SUPPORT_PHONE_DISPLAY } from "../shared/support-contact.ts";
import { formatCalendarDateRange, KENYA_TIME_ZONE } from "../shared/calendar-dates.ts";
import { describeHotelStay } from "../shared/hotel-rooms.ts";
import { buildVerificationEmail, type VerificationPurpose } from "./verification-email.ts";
import { getUsdToKesRate } from "./currency.ts";

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

// Guests see and pay KSh on the site, so emails lead with KSh and keep US$ alongside.
function formatKes(amount: number) {
  return `KSh ${Math.round(amount).toLocaleString("en-US")}`;
}

function formatWithKes(amountUsd: number, usdToKes: number | null | undefined) {
  return usdToKes && usdToKes > 0 ? `${formatKes(amountUsd * usdToKes)} (${formatUsd(amountUsd)})` : formatUsd(amountUsd);
}

async function currentUsdToKes() {
  try {
    return (await getUsdToKesRate()).usdToKes;
  } catch {
    return null;
  }
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

  // Kenya time, labelled, whatever clock the server runs on.
  return `${new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: KENYA_TIME_ZONE,
  }).format(parsed)} (Kenya time)`;
}

function getPrimaryGuestLabel(booking: Booking) {
  return booking.guestName?.trim() || booking.guestEmail || "Guest";
}

function getBookingCategoryLabel(booking: Booking) {
  if (booking.accommodationId) {
    return booking.hotelStay ? "Hotel booking" : "Stay booking";
  }

  if (booking.bookingType === "service" && booking.selectedServices.length === 0) {
    return "Custom service request";
  }

  return humanizeToken(booking.serviceMode, booking.bookingType === "service" ? "Service booking" : "Booking");
}

// Calendar dates, the same for the guest abroad and for the team in Kenya.
function getBookingDateLabel(booking: Booking) {
  return formatCalendarDateRange(booking.checkIn, booking.checkOut);
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

function buildBookingSummaryLines(booking: Booking, usdToKes: number | null = null) {
  const kesQuote = booking.serviceRequestFeeKes && booking.serviceRequestFeeKes > 0 ? booking.serviceRequestFeeKes : null;
  return [
    `Booking reference: ${getShortBookingReference(booking.id)}`,
    `Booking type: ${getBookingCategoryLabel(booking)}`,
    `Guest: ${getPrimaryGuestLabel(booking)}`,
    `Guest email: ${booking.guestEmail}`,
    booking.guestPhone ? `Guest phone: ${booking.guestPhone}` : null,
    `Dates: ${getBookingDateLabel(booking)}`,
    booking.hotelStay ? `Room: ${describeHotelStay(booking.hotelStay)}` : null,
    `Guests: ${booking.guests}`,
    `Total: ${kesQuote ? `${formatKes(kesQuote)} (${formatUsd(booking.totalPrice)})` : formatWithKes(booking.totalPrice, usdToKes)}`,
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
      ? `Your dates are reserved once you pay ${payment} in My Bookings. When you press "Pay now", we hold them for you for ${bookingPaymentHoldMinutes} minutes while you complete the payment by card or M-Pesa.`
      : `Your booking goes ahead once you pay ${payment} in My Bookings.`,
    `Trouble paying? Our support team can help — WhatsApp or call ${SUPPORT_PHONE_DISPLAY}.`,
  ];
}

// After the stay or service: one short, warm ask for a review, at the moment
// the guest is most likely to say yes. Reviews also unlock the rating other
// guests see (3 or more eligible reviews).
export function buildReviewRequestEmail(booking: Booking, reviewUrl: string | null) {
  const what = booking.accommodationId ? "stay" : "booking";
  const subject = `How was your ${what}? Share a quick review`;
  const lines = [
    `Hi ${getPrimaryGuestLabel(booking)},`,
    "",
    `Thank you for booking with Tembea Bila Matata. We hope your ${what} went beautifully.`,
    "Could you spare 30 seconds to rate it? Your review helps other travellers choose with confidence, and lets your host know what they did well.",
    reviewUrl ? `Leave your review: ${reviewUrl}` : "",
    "",
    `Anything we could have done better? Reply to this email or WhatsApp us on ${SUPPORT_PHONE_DISPLAY}.`,
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "");
  return { subject, lines };
}

export async function sendReviewRequestEmail(booking: Booking, requestLike?: RequestOriginLike) {
  if (!booking.guestEmail) return false;
  const reviewUrl = buildApplicationUrl(`/bookings?bookingId=${booking.id}&review=1`, requestLike);
  const { subject, lines } = buildReviewRequestEmail(booking, reviewUrl);
  return sendEmailMessage({
    to: [booking.guestEmail],
    subject,
    text: lines.join("\n"),
    html: [
      "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">",
      ...lines.filter(Boolean).map((line) => line.startsWith("Leave your review: ") && reviewUrl
        ? `<p><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;">Leave your review</a></p>`
        : `<p>${escapeHtml(line)}</p>`),
      "</div>",
    ].join(""),
  });
}

export async function sendBookingCreatedNotificationEmails(booking: Booking, requestLike?: RequestOriginLike) {
  const tasks: Promise<boolean>[] = [];
  const adminRecipients = getNotificationRecipientEmails();
  const customerUrl = buildApplicationUrl(`/bookings?bookingId=${booking.id}`, requestLike);
  const adminUrl = buildApplicationUrl(`/admin/bookings?bookingId=${booking.id}`, requestLike);
  const summaryLines = buildBookingSummaryLines(booking, await currentUsdToKes());
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
  const chargedInKes = booking.paymentCurrency?.trim().toUpperCase() === "KES"
    && normalizeMoney(booking.paymentAmount) > 0
    && normalizeMoney(booking.paymentCheckoutAmount) > 0;
  const chargedRate = chargedInKes ? normalizeMoney(booking.paymentAmount) / normalizeMoney(booking.paymentCheckoutAmount) : null;
  const paid = (amountUsd: number) => formatWithKes(amountUsd, chargedRate);
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
          ? `We have received your deposit payment of ${paid(latestPaymentAmount)}. Your dates remain held while the remaining balance is settled.`
          : `We have received your payment of ${paid(latestPaymentAmount)}. There is still a balance remaining on this booking.`
        : `We have received your payment of ${paid(latestPaymentAmount)}. This booking is now fully paid.`,
    }
    : normalizedStatus === "processing" && booking.paymentProvider === "mpesa-manual"
      ? {
        customerSubject: "M-Pesa payment submitted",
        adminSubject: "Manual M-Pesa submitted",
        body: "We have received your M-Pesa payment details and are confirming the payment now.",
      }
    : getPaymentStatusMessaging(normalizedStatus);

  // The exact charge, when it was in a currency other than KSh or US$.
  const otherChargeLine = booking.paymentCurrency
    && !["USD", "KES"].includes(booking.paymentCurrency.trim().toUpperCase())
    && normalizeMoney(booking.paymentAmount) > 0
    ? `Charged: ${formatMoney(booking.paymentAmount, booking.paymentCurrency)}`
    : null;
  const paidAtLine = formatTimestamp(booking.paidAt);
  // "Paid with", not "Provider": on TBM a provider is the host or driver.
  const paidWithLabel = booking.paymentProvider === "mpesa-manual"
    ? "M-Pesa (Send Money)"
    : booking.paymentProvider ? humanizeToken(booking.paymentProvider, booking.paymentProvider) : null;
  const sharedLines = [
    `Booking reference: ${getShortBookingReference(booking.id)}`,
    `Guest: ${getPrimaryGuestLabel(booking)}`,
    `Booking type: ${getBookingCategoryLabel(booking)}`,
    shouldSendReceipt ? `Receipt amount: ${paid(latestPaymentAmount)}` : null,
    currentAmountPaid > 0 ? `Total paid: ${paid(currentAmountPaid)}` : null,
    outstandingAmount > 0 ? `Balance remaining: ${formatUsd(outstandingAmount)}${chargedRate ? ` (about ${formatKes(outstandingAmount * chargedRate)})` : ""}` : null,
    `Payment status: ${normalizedStatus}`,
    paidWithLabel ? `Paid with: ${paidWithLabel}` : null,
    booking.paymentReference ? `Reference: ${booking.paymentReference}` : null,
    otherChargeLine,
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

// A provider has new work: the guest, the dates and where to see it. The email
// carries no payment details; the dashboard has the rest.
export async function sendProviderAssignmentEmail(args: {
  providerEmail: string;
  providerName: string;
  serviceName: string;
  guestName: string;
  checkIn: string;
  checkOut?: string | null;
  reassigned?: boolean;
}): Promise<boolean> {
  const dashboardUrl = `${process.env.APP_BASE_URL?.trim() || "https://tembeabilamatata.com"}/provider/dashboard`;
  const dates = formatCalendarDateRange(args.checkIn, args.checkOut && args.checkOut !== args.checkIn ? args.checkOut : args.checkIn, "en-GB");
  const headline = args.reassigned ? `${args.serviceName} has been passed to you` : `New booking: ${args.serviceName}`;
  const text = [
    `Hi ${args.providerName},`,
    "",
    `${args.guestName} has booked ${args.serviceName} for ${dates}.`,
    "Open your provider dashboard to see the details and accept the booking:",
    dashboardUrl,
    "",
    `Questions? Call or WhatsApp TBM on ${SUPPORT_PHONE_DISPLAY}.`,
  ].join("\n");
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">',
    `<p>Hi ${escapeHtml(args.providerName)},</p>`,
    `<p>${escapeHtml(args.guestName)} has booked <strong>${escapeHtml(args.serviceName)}</strong> for ${escapeHtml(dates)}.</p>`,
    `<p><a href="${escapeHtml(dashboardUrl)}">Open your provider dashboard</a> to see the details and accept the booking.</p>`,
    `<p>Questions? Call or WhatsApp TBM on ${escapeHtml(SUPPORT_PHONE_DISPLAY)}.</p>`,
    "</div>",
  ].join("");
  return await sendEmailMessage({
    to: [args.providerEmail],
    subject: `[Tembea Bila Matata] ${headline}`,
    text,
    html,
  });
}

// A vehicle owner applied: TBM's team is told, and the applicant gets a receipt.
// No documents or links to them go in either email.
export async function sendFleetApplicationReceivedEmails(args: {
  applicationId: string;
  applicantName: string;
  applicantEmail: string;
  vehicle: string;
  county: string;
}) {
  const baseUrl = process.env.APP_BASE_URL?.trim() || "https://tembeabilamatata.com";
  const reviewUrl = `${baseUrl}/admin/fleet-applications/${args.applicationId}`;
  const firstName = args.applicantName.trim().split(/\s+/)[0] || "there";
  const teamText = [
    `New fleet application: ${args.vehicle}`,
    `From ${args.applicantName}, ${args.county}.`,
    "Review the photos and documents in Admin:",
    reviewUrl,
  ].join("\n");
  const teamHtml = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">',
    `<p>New fleet application: <strong>${escapeHtml(args.vehicle)}</strong></p>`,
    `<p>From ${escapeHtml(args.applicantName)}, ${escapeHtml(args.county)}.</p>`,
    `<p><a href="${escapeHtml(reviewUrl)}">Review the photos and documents in Admin</a>.</p>`,
    "</div>",
  ].join("");
  const applicantText = [
    `Hi ${firstName},`,
    "",
    `Thank you for applying to list your ${args.vehicle} with Tembea Bila Matata.`,
    "We'll review your application and documents and contact you about the next step.",
    "",
    `Questions? Call or WhatsApp TBM on ${SUPPORT_PHONE_DISPLAY}.`,
  ].join("\n");
  const applicantHtml = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">',
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>Thank you for applying to list your <strong>${escapeHtml(args.vehicle)}</strong> with Tembea Bila Matata.</p>`,
    "<p>We'll review your application and documents and contact you about the next step.</p>",
    `<p>Questions? Call or WhatsApp TBM on ${escapeHtml(SUPPORT_PHONE_DISPLAY)}.</p>`,
    "</div>",
  ].join("");
  const team = getNotificationRecipientEmails();
  const [teamSent, applicantSent] = await Promise.all([
    team.length
      ? sendEmailMessage({ to: team, subject: `[Tembea Bila Matata] New fleet application: ${args.vehicle}`, text: teamText, html: teamHtml })
      : Promise.resolve(false),
    sendEmailMessage({ to: [args.applicantEmail], subject: "[Tembea Bila Matata] We received your application", text: applicantText, html: applicantHtml }),
  ]);
  return { teamSent, applicantSent };
}

// The applicant is now a provider. The password is never emailed: TBM gives it
// to them directly, or they set their own with "Forgot password?".
export async function sendProviderApprovedEmail(args: { email: string; name: string; vehicle: string }) {
  const baseUrl = process.env.APP_BASE_URL?.trim() || "https://tembeabilamatata.com";
  const signInUrl = `${baseUrl}/auth?next=${encodeURIComponent("/provider/dashboard")}`;
  const firstName = args.name.trim().split(/\s+/)[0] || "there";
  const text = [
    `Hi ${firstName},`,
    "",
    `Welcome to Tembea Bila Matata. Your ${args.vehicle} is approved and your provider account is ready.`,
    `Sign in with this email address (${args.email}):`,
    signInUrl,
    "TBM will give you your temporary password, or you can set your own now: on the sign-in page choose \"Forgot password?\".",
    "",
    "In Provider Hub you can set your prices, keep your documents up to date, share your listing, and see your bookings and earnings.",
    "TBM checks your listing before guests can see it.",
    "",
    `Questions? Call or WhatsApp TBM on ${SUPPORT_PHONE_DISPLAY}.`,
  ].join("\n");
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">',
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>Welcome to Tembea Bila Matata. Your <strong>${escapeHtml(args.vehicle)}</strong> is approved and your provider account is ready.</p>`,
    `<p><a href="${escapeHtml(signInUrl)}">Sign in to Provider Hub</a> with this email address (${escapeHtml(args.email)}). TBM will give you your temporary password, or you can set your own now: on the sign-in page choose "Forgot password?".</p>`,
    "<p>In Provider Hub you can set your prices, keep your documents up to date, share your listing, and see your bookings and earnings. TBM checks your listing before guests can see it.</p>",
    `<p>Questions? Call or WhatsApp TBM on ${escapeHtml(SUPPORT_PHONE_DISPLAY)}.</p>`,
    "</div>",
  ].join("");
  return await sendEmailMessage({
    to: [args.email],
    subject: "[Tembea Bila Matata] Welcome: your provider account is ready",
    text,
    html,
  });
}

// A short plain email to a provider, an applicant or TBM's team ("team").
// Paragraphs are text; the optional link becomes a button-like line.
export function providerAppUrl(path: string) {
  const baseUrl = process.env.APP_BASE_URL?.trim() || "https://tembeabilamatata.com";
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export async function sendSimpleEmail(args: {
  to: string[] | "team";
  subject: string;
  greetingName?: string | null;
  paragraphs: string[];
  link?: { label: string; url: string } | null;
}) {
  const recipients = args.to === "team" ? getNotificationRecipientEmails() : args.to;
  if (!recipients.length) {
    return false;
  }
  const firstName = args.greetingName?.trim().split(/\s+/)[0] || null;
  const text = [
    ...(firstName ? [`Hi ${firstName},`, ""] : []),
    ...args.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(args.link ? [`${args.link.label}: ${args.link.url}`, ""] : []),
    `Questions? Call or WhatsApp TBM on ${SUPPORT_PHONE_DISPLAY}.`,
  ].join("\n");
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">',
    ...(firstName ? [`<p>Hi ${escapeHtml(firstName)},</p>`] : []),
    ...args.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ...(args.link ? [`<p><a href="${escapeHtml(args.link.url)}">${escapeHtml(args.link.label)}</a></p>`] : []),
    `<p>Questions? Call or WhatsApp TBM on ${escapeHtml(SUPPORT_PHONE_DISPLAY)}.</p>`,
    "</div>",
  ].join("");
  return await sendEmailMessage({ to: recipients, subject: `[Tembea Bila Matata] ${args.subject}`, text, html });
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
