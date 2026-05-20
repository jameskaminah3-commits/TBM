import crypto from "crypto";
import type { Express, Response as ExpressResponse } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  isAuthenticated,
  registerAuthRoutes,
  requireAdmin,
  requireProviderOrAdmin,
  setupAuth,
} from "./middleware/auth";
import {
  insertBookingMessageSchema,
  publicBookingRequestSchema,
  serverBookingSchema,
  insertAccommodationSchema,
  insertServiceSchema,
  insertProviderSchema,
  insertBlogPostSchema,
  insertMarketingPromoSchema,
  updateMarketingPromoSchema,
  insertListingSchema,
  insertStaySchema,
  insertStayReservationSchema,
  insertCarReservationSchema,
  insertCarSchema,
  insertCookSchema,
  insertCookReservationSchema,
  insertErrandSchema,
  insertExperienceSchema,
  marketingAttributionEventSchema,
  marketingAttributionPayloadSchema,
  marketingPromoCostAbsorptions,
  providerCategories,
  insertUserPushDeviceSchema,
  insertReviewSchema,
  updateUserPushPreferencesSchema,
  bookingPaymentSessionRequestSchema,
  type MarketingPromo,
  type MarketingPromoCostAbsorption,
  type BookingAttribution,
  type BookingMarketingSummary,
  type MarketingPromoPreview,
  type MarketingPromoPreviewResult,
  type ProviderCategory,
  type CustomerPaymentMethod,
  type BookingServiceAssignment,
  type BookingServiceAssignmentStatus,
  type ProviderBookingAssignmentView,
} from "@shared/schema";
import { saveBase64Upload } from "./media";
import { db } from "./db";
import { users } from "@shared/schema";
import { calculateCookInclusiveTotal, calculateCookServiceTotal, getCookMinimumGuests } from "@shared/cook-pricing";
import { customServiceRequestFeeUsd } from "@shared/custom-service";
import { calculateHelpMamaPackagePrice, HELP_MAMA_HOURLY_MINIMUM_HOURS, getHelpMamaAgeBandId, getHelpMamaRateId, hasHelpMamaPricing, isHelpMamaHourlyRate } from "@shared/errand-pricing";
import {
  createHostedCheckoutSession,
  getApplicationBaseUrl,
  getBookingIdFromPaymentReference,
  getVerifiedPaymentCheckoutAmount,
  verifyPaystackPayment,
  verifyPaystackWebhookSignature,
  verifyPesapalPayment,
  type VerifiedHostedPayment,
} from "./customer-payments";
import {
  queueNotificationTask,
  sendBookingCreatedNotificationEmails,
  sendBookingPaymentNotificationEmails,
} from "./notifications";
import { and, eq, ne } from "drizzle-orm";
import {
  calculateBookingDepositAmount,
  getBookingAmountPaid,
  getBookingCheckoutAmount,
  getBookingOutstandingAmount,
  hasLockedInBookingDeposit,
  isBookingFullyPaid,
  supportsBookingDeposit,
} from "@shared/booking-payments";
import { z } from "zod";
import { sanitizeUserRecord } from "./user-sanitizer";

function normalizeDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid booking date");
  }
  return date;
}

function getTodayDateString(timeZone = "Africa/Nairobi") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function assertBookingDatesAreBookable(params: {
  checkIn: string;
  checkOut: string;
  serviceScheduleSlots?: Array<{ date: string; note?: string }> | null;
}) {
  const today = getTodayDateString();
  const checkIn = toIsoDate(normalizeDateOnly(params.checkIn));
  const checkOut = toIsoDate(normalizeDateOnly(params.checkOut));

  if (checkIn < today) {
    throw new Error("Start date cannot be in the past.");
  }

  if (checkOut < today) {
    throw new Error("End date cannot be in the past.");
  }

  if (checkOut < checkIn) {
    throw new Error("End date cannot be before start date.");
  }

  for (const slot of params.serviceScheduleSlots || []) {
    const slotDate = toIsoDate(normalizeDateOnly(slot.date));
    if (slotDate < today) {
      throw new Error("Package date cannot be in the past.");
    }
  }
}

function buildServerManagedBookingInput(
  bookingData: z.input<typeof publicBookingRequestSchema>,
  userId: string,
  guestEmail: string,
) {
  const accommodationId = typeof bookingData.accommodationId === "string" && bookingData.accommodationId.trim()
    ? bookingData.accommodationId
    : null;
  const selectedServices = Array.isArray(bookingData.selectedServices)
    ? bookingData.selectedServices
        .filter((serviceId): serviceId is string => typeof serviceId === "string")
        .map((serviceId) => serviceId.trim())
        .filter(Boolean)
    : [];

  return serverBookingSchema.parse({
    ...bookingData,
    accommodationId,
    selectedServices,
    userId,
    guestEmail,
    bookingType: accommodationId ? "accommodation" : "service",
    status: "upcoming",
    totalPrice: 0,
    serviceRequestFee: null,
    serviceRequestFeeKes: null,
    serviceResponseMessage: null,
    customMenuProposalStatus: "pending",
    customMenuProposedAmount: null,
    customMenuProposalMessage: null,
    customMenuDeclineReason: null,
    customMenuClientDecision: "pending",
    customMenuClientRespondedAt: null,
    customMenuCreditCode: null,
    customMenuCreditAmount: null,
    customMenuReviewedByUserId: null,
    customMenuReviewedAt: null,
    experienceCustomOfferStatus: "pending",
    experienceCustomOfferAmount: null,
    experienceCustomOfferMessage: null,
    experienceCustomOfferDeclineReason: null,
    experienceCustomOfferClientDecision: "pending",
    experienceCustomOfferClientRespondedAt: null,
    experienceCustomOfferReviewedByUserId: null,
    experienceCustomOfferReviewedAt: null,
    providerStatusRequest: null,
    providerStatusRequestNote: null,
    providerStatusRequestedByUserId: null,
    providerStatusRequestedAt: null,
    providerStatusReviewedByUserId: null,
    providerStatusReviewedAt: null,
  });
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatShortDate(dateString: string) {
  const date = normalizeDateOnly(dateString);
  return `${date.getUTCDate()}/${date.getUTCMonth() + 1}/${String(date.getUTCFullYear()).slice(-2)}`;
}

function getOccupiedEndDate(checkIn: string, checkOut: string) {
  const startDate = normalizeDateOnly(checkIn);
  const endDate = normalizeDateOnly(checkOut);
  return endDate.getTime() === startDate.getTime() ? endDate : addDays(endDate, -1);
}

function calculateChargeableDays(checkIn: string, checkOut: string) {
  const startDate = normalizeDateOnly(checkIn);
  const endDate = normalizeDateOnly(checkOut);
  const diff = endDate.getTime() - startDate.getTime();
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getSortedServiceScheduleSlots(slots: Array<{ date: string; note?: string }> | null | undefined) {
  return (slots || [])
    .filter((slot): slot is { date: string; note?: string } => typeof slot?.date === "string" && slot.date.length > 0)
    .map((slot) => {
      normalizeDateOnly(slot.date);
      return {
        date: slot.date,
        note: slot.note?.trim() || "",
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function toIsoDateTimeString(date: string, time: string) {
  const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  const value = `${date}T${normalizedTime}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid shared departure date or time");
  }
  return parsed.toISOString();
}

function pickPatchedValue<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

function normalizeAssignedUserId(value: string | null | undefined) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasAssignedManagerUserId(value: string | null | undefined) {
  return Boolean(normalizeAssignedUserId(value));
}

function isBookablePublicListing(listing: { isPublic: boolean; managerUserId?: string | null } | null | undefined) {
  return Boolean(listing?.isPublic && hasAssignedManagerUserId(listing.managerUserId));
}

function logPublicFetchFailure(resource: string, error: unknown) {
  console.error(`[API] Failed to fetch ${resource}:`, error);
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? ((error as { code: string }).code || "").toUpperCase()
    : "";
}

function isTransientDatabaseError(error: unknown) {
  const code = getErrorCode(error);
  if (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "57P01", "57P02", "57P03"].includes(code)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return [
    "connection terminated unexpectedly",
    "server closed the connection unexpectedly",
    "timeout expired",
    "getaddrinfo enotfound",
    "could not connect",
    "failed to fetch",
  ].some((fragment) => message.includes(fragment));
}

function isDatabaseTlsConfigurationError(error: unknown) {
  const code = getErrorCode(error);
  if (["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return [
    "self-signed certificate",
    "certificate chain",
    "unable to verify the first certificate",
  ].some((fragment) => message.includes(fragment));
}

function isDatabaseSetupError(error: unknown) {
  const code = getErrorCode(error);
  if (["3D000", "3F000", "42P01"].includes(code)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("does not exist") || message.includes("relation ");
}

function sendPublicCatalogFailure(resource: string, res: ExpressResponse, error: unknown) {
  logPublicFetchFailure(resource, error);

  if (isDatabaseTlsConfigurationError(error)) {
    return res.status(503).json({
      error: process.env.NODE_ENV === "production"
        ? "Service listings are temporarily unavailable while the database TLS connection is being verified. Please try again."
        : "Service listings could not reach the database because TLS certificate verification failed. For local-only testing, set DATABASE_SSL_REJECT_UNAUTHORIZED=false and restart the server.",
    });
  }

  if (isDatabaseSetupError(error)) {
    return res.status(503).json({
      error: "Service listings are still being prepared. Please try again in a few minutes.",
    });
  }

  if (isTransientDatabaseError(error)) {
    return res.status(503).json({
      error: "Service listings are temporarily unavailable while we reconnect to the database. Please try again.",
    });
  }

  return res.status(500).json({ error: `Failed to fetch ${resource}` });
}

function getUnavailableBookingMessage(name: string) {
  return `"${name}" is not available to book right now.`;
}

async function getExperienceDepartureAvailability(experienceId: string) {
  const experience = await storage.getExperience(experienceId);
  if (!experience) {
    return null;
  }

  const bookings = (await storage.getBookings()).filter((booking) =>
    booking.selectedServices.includes(experienceId) &&
    booking.serviceMode === "experience-shared" &&
    booking.serviceDepartureId &&
    booking.status !== "cancelled",
  );

  const guestsByDeparture = new Map<string, number>();
  bookings.forEach((booking) => {
    const current = guestsByDeparture.get(booking.serviceDepartureId!) || 0;
    guestsByDeparture.set(booking.serviceDepartureId!, current + Math.max(1, booking.guests || 1));
  });

  return (experience.sharedDepartures || [])
    .map((departure) => {
      const bookedGuests = guestsByDeparture.get(departure.id) || 0;
      const maxCapacity = experience.sharedMaxCapacity;
      return {
        ...departure,
        bookedGuests,
        maxCapacity,
        spotsLeft: Math.max(0, maxCapacity - bookedGuests),
        departureDateTime: toIsoDateTimeString(departure.date, departure.time),
      };
    })
    .sort((a, b) => a.departureDateTime.localeCompare(b.departureDateTime));
}

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("Invalid service time");
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error("Invalid service time");
  }

  return (hours * 60) + minutes;
}

function parseProviderTypes(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is typeof providerCategories[number] =>
      typeof entry === "string" && providerCategories.includes(entry as typeof providerCategories[number]));
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry): entry is typeof providerCategories[number] => providerCategories.includes(entry as typeof providerCategories[number]));
  }

  return [];
}

function hasProviderCategory(claims: any, category: typeof providerCategories[number]) {
  const providerTypes = parseProviderTypes(claims?.provider_types ?? claims?.provider_type);
  return providerTypes.includes(category);
}

function convertKesRequestFeeToUsd(feeKes: number, usdToKes: number) {
  return Math.max(1, Math.ceil(feeKes / usdToKes));
}

function getRequestFeeUsd(booking: { serviceMode?: string | null; serviceRequestFee: number | null; serviceRequestFeeKes: number | null }) {
  if (booking.serviceRequestFee && booking.serviceRequestFee > 0) {
    return booking.serviceRequestFee;
  }

  if (booking.serviceRequestFeeKes && booking.serviceRequestFeeKes > 0) {
    return Math.max(1, Math.ceil(booking.serviceRequestFeeKes / USD_TO_KES_FALLBACK));
  }

  if (booking.serviceMode === "experience-custom-offer") {
    return customServiceRequestFeeUsd;
  }

  return 0;
}

function buildCustomMenuCreditCode(bookingId: string) {
  return `MENU-${bookingId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function isCustomMenuBooking(booking: { serviceMode: string | null; selectedServices: string[] }) {
  return booking.serviceMode === "cook-custom-menu" && booking.selectedServices.length > 0;
}

function isExperienceCustomOfferBooking(booking: { serviceMode: string | null; selectedServices: string[] }) {
  return booking.serviceMode === "experience-custom-offer";
}

const customServiceCategories = ["dine", "drive", "errands", "experience", "stay", "other"] as const;
const customServiceRequestSchema = z.object({
  serviceCategory: z.enum(customServiceCategories),
  description: z.string().min(20),
  preferredDate: z.string().min(1),
  preferredTime: z.string().optional(),
  peopleCount: z.coerce.number().min(1).optional(),
  location: z.string().optional(),
  budgetUsd: z.coerce.number().min(1).optional(),
  budgetAmount: z.coerce.number().min(1).optional(),
  budgetCurrency: z.enum(["USD", "KES"]).optional(),
  listDetails: z.string().optional(),
  attachmentUrl: z.string().optional(),
});
const adminBookingPaymentActionSchema = z.object({
  action: z.enum(["payment-received-cash", "payment-received-mpesa", "send-reminder", "cancel-booking"]),
  note: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : "",
    z.string().max(500),
  ).optional().default(""),
}).superRefine((value, ctx) => {
  if (value.action === "send-reminder" && value.note.trim().length < 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["note"],
      message: "Please add a short reminder note before sending it.",
    });
  }
});

const manualMpesaPaymentSchema = z.object({
  transactionCode: z.preprocess(
    (value) => typeof value === "string" ? value.trim().toUpperCase() : "",
    z.string().min(6, "Enter the M-Pesa transaction code.").max(30, "Transaction code is too long."),
  ),
  senderPhone: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : "",
    z.string().max(30, "Sender phone is too long."),
  ).optional().default(""),
  note: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : "",
    z.string().max(500, "Note is too long."),
  ).optional().default(""),
});

const CURRENCY_RATE_TTL_MS = 30 * 60 * 1000;
const USD_TO_KES_FALLBACK = Number(process.env.USD_TO_KES_FALLBACK ?? "130");
const CURRENCY_RATE_SOURCES = [
  {
    url: "https://api.frankfurter.app/latest?from=USD&to=KES",
    source: "Frankfurter",
    parse: (payload: any) => payload?.rates?.KES,
  },
  {
    url: "https://api.frankfurter.app/v1/latest?base=USD&symbols=KES",
    source: "Frankfurter v1",
    parse: (payload: any) => payload?.rates?.KES,
  },
  {
    url: "https://api.exchangerate.host/latest?base=USD&symbols=KES",
    source: "ExchangeRate.host",
    parse: (payload: any) => payload?.rates?.KES,
  },
];

function formatEnteredBudget(amount: number, currency: "USD" | "KES") {
  if (currency === "KES") {
    return `KSh ${Math.round(amount).toLocaleString("en-KE")}`;
  }

  const decimals = Number.isInteger(amount) ? 0 : 2;
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: 2,
  })}`;
}

let currencyRateCache: {
  usdToKes: number;
  fetchedAt: string;
  source: string;
  expiresAt: number;
  isFallback: boolean;
} | null = null;

async function getUsdToKesRate() {
  const now = Date.now();
  if (currencyRateCache && currencyRateCache.expiresAt > now) {
    return currencyRateCache;
  }

  try {
    for (const candidate of CURRENCY_RATE_SOURCES) {
      const response = await fetch(candidate.url);
      if (!response.ok) {
        continue;
      }

      const payload = await response.json() as { date?: string; rates?: { KES?: number } };
      const usdToKes = candidate.parse(payload);
      if (typeof usdToKes !== "number" || !Number.isFinite(usdToKes)) {
        continue;
      }

      currencyRateCache = {
        usdToKes,
        fetchedAt: payload.date ?? new Date().toISOString(),
        source: candidate.source,
        expiresAt: now + CURRENCY_RATE_TTL_MS,
        isFallback: false,
      };

      return currencyRateCache;
    }

    throw new Error("No currency source returned a valid USD/KES rate");
  } catch (error) {
    if (currencyRateCache) {
      return currencyRateCache;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[CURRENCY] Falling back to static USD/KES rate (${message}).`);

    currencyRateCache = {
      usdToKes: USD_TO_KES_FALLBACK,
      fetchedAt: new Date().toISOString(),
      source: "fallback",
      expiresAt: now + CURRENCY_RATE_TTL_MS,
      isFallback: true,
    };

    return currencyRateCache;
  }
}

function isBookingPaymentPaid(
  booking: Pick<import("@shared/schema").Booking, "totalPrice" | "paymentStatus" | "paymentAmountPaid">,
) {
  return isBookingFullyPaid(booking);
}

function hasAcceptedQuotedBooking(
  booking: Pick<import("@shared/schema").Booking, "serviceMode" | "customMenuClientDecision" | "experienceCustomOfferClientDecision">,
) {
  return (
    (booking.serviceMode === "cook-custom-menu" && booking.customMenuClientDecision === "accepted")
    || (booking.serviceMode === "experience-custom-offer" && booking.experienceCustomOfferClientDecision === "accepted")
  );
}

function hasActivePaymentHold(
  booking: Pick<import("@shared/schema").Booking, "paymentStatus" | "paymentHoldExpiresAt">,
) {
  if (!["pending", "processing"].includes(booking.paymentStatus ?? "paid")) {
    return false;
  }

  if (!booking.paymentHoldExpiresAt) {
    return false;
  }

  const expiresAt = new Date(booking.paymentHoldExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

async function startHostedBookingPayment(
  req: { protocol: string; get(name: string): string | undefined },
  booking: import("@shared/schema").Booking,
  paymentMethod: CustomerPaymentMethod,
) {
  const baseUrl = getApplicationBaseUrl(req);
  const rate = await getUsdToKesRate();
  const amountUsd = getBookingCheckoutAmount(booking);
  const payment = await createHostedCheckoutSession({
    paymentMethod,
    booking,
    baseUrl,
    usdToKes: rate.usdToKes,
    amountUsd,
  });
  const updatedBooking = await storage.updateBookingPaymentState(booking.id, {
    paymentStatus: "pending",
    paymentProvider: payment.provider,
    paymentReference: payment.reference,
    paymentSessionId: payment.sessionId,
    paymentCurrency: payment.currency,
    paymentAmount: payment.amount,
    paymentCheckoutAmount: amountUsd,
    paymentHoldExpiresAt: payment.holdExpiresAt,
    paidAt: getBookingAmountPaid(booking) > 0 ? booking.paidAt : null,
    paymentFailedAt: null,
  });

  if (!updatedBooking) {
    throw new Error("Booking payment session was created, but the booking could not be updated.");
  }

  return {
    booking: updatedBooking,
    payment,
  };
}

async function applyVerifiedBookingPayment(bookingId: string, verifiedPayment: VerifiedHostedPayment) {
  const verifiedBookingId = getBookingIdFromPaymentReference(verifiedPayment.reference);
  if (!verifiedBookingId || verifiedBookingId !== bookingId) {
    throw new Error("Verified payment reference does not match the target booking.");
  }

  const booking = await storage.getBooking(bookingId);
  if (!booking) {
    return undefined;
  }

  if (!booking.paymentReference || booking.paymentReference !== verifiedPayment.reference) {
    throw new Error("Verified payment reference does not match the active booking payment session.");
  }

  if (booking.paymentProvider && booking.paymentProvider !== verifiedPayment.provider) {
    throw new Error("Verified payment provider does not match the active booking payment session.");
  }
  const previousPaymentStatus = booking.paymentStatus;
  const currentAmountPaid = getBookingAmountPaid(booking);

  if (verifiedPayment.status === "paid") {
    if (isBookingFullyPaid(booking)) {
      return booking;
    }

    const chargedAmountUsd = getVerifiedPaymentCheckoutAmount(booking, verifiedPayment);
    if (chargedAmountUsd == null) {
      throw new Error("Could not reconcile the verified payment amount safely.");
    }

    const isDuplicatePaidReference = booking.paymentReference === verifiedPayment.reference
      && booking.paymentProvider === verifiedPayment.provider
      && !booking.paymentHoldExpiresAt
      && currentAmountPaid > 0
      && !!booking.paidAt;

    if (isDuplicatePaidReference) {
      return booking;
    }

    const nextAmountPaid = Math.min(
      Math.max(0, booking.totalPrice),
      currentAmountPaid + Math.min(getBookingOutstandingAmount(booking), chargedAmountUsd),
    );
    const isFullySettled = nextAmountPaid >= Math.max(0, booking.totalPrice);

    const updatedBooking = await storage.updateBookingPaymentState(booking.id, {
      paymentStatus: isFullySettled ? "paid" : "pending",
      paymentProvider: verifiedPayment.provider,
      paymentReference: verifiedPayment.reference,
      paymentSessionId: verifiedPayment.sessionId,
      paymentCurrency: verifiedPayment.currency,
      paymentAmount: verifiedPayment.amount ?? booking.paymentAmount,
      paymentCheckoutAmount: booking.paymentCheckoutAmount ?? chargedAmountUsd,
      paymentAmountPaid: nextAmountPaid,
      paymentHoldExpiresAt: null,
      paidAt: verifiedPayment.paidAt ?? new Date().toISOString(),
      paymentFailedAt: null,
    });

    if (updatedBooking && nextAmountPaid > currentAmountPaid) {
      queueNotificationTask(
        `payment emails for booking ${updatedBooking.id}`,
        sendBookingPaymentNotificationEmails(updatedBooking, {
          previousStatus: previousPaymentStatus,
          previousAmountPaid: currentAmountPaid,
        }),
      );
    }

    if (updatedBooking && isFullySettled) {
      await storage.syncBookingServiceAssignments({ bookingIds: [updatedBooking.id], notifyProviders: true });
      await storage.syncBookingPayouts({ bookingIds: [updatedBooking.id] });
    }

    return updatedBooking;
  }

  const updatedBooking = await storage.updateBookingPaymentState(booking.id, {
    paymentStatus: verifiedPayment.status === "processing"
      ? "processing"
      : verifiedPayment.status === "cancelled"
        ? "cancelled"
        : verifiedPayment.status === "refunded"
          ? "refunded"
          : "failed",
    paymentProvider: verifiedPayment.provider,
    paymentReference: verifiedPayment.reference,
    paymentSessionId: verifiedPayment.sessionId,
    paymentCurrency: verifiedPayment.currency,
    paymentAmount: verifiedPayment.amount ?? booking.paymentAmount,
    paymentCheckoutAmount: booking.paymentCheckoutAmount,
    paymentAmountPaid: currentAmountPaid,
    paymentHoldExpiresAt: verifiedPayment.status === "processing" ? booking.paymentHoldExpiresAt : null,
    paidAt: currentAmountPaid > 0 ? booking.paidAt : null,
    paymentFailedAt: verifiedPayment.status === "processing" ? null : new Date().toISOString(),
  });

  if (updatedBooking && currentAmountPaid === 0) {
    queueNotificationTask(
      `payment emails for booking ${updatedBooking.id}`,
      sendBookingPaymentNotificationEmails(updatedBooking, {
        previousStatus: previousPaymentStatus,
        previousAmountPaid: currentAmountPaid,
      }),
    );
  }

  return updatedBooking;
}

function getPaymentResultRedirect(bookingId: string, status: "success" | "pending" | "failed" | "cancelled") {
  const params = new URLSearchParams({
    bookingId,
    payment: status,
  });
  return `/bookings?${params.toString()}`;
}

function formatBookingUsdAmount(amount: number) {
  return `USD ${Math.max(0, Math.round(amount)).toLocaleString("en-US")}`;
}

function buildAdminPaymentReminderMessage(booking: import("@shared/schema").Booking, note: string) {
  const outstandingAmount = getBookingOutstandingAmount(booking);
  const noteLine = note.trim();

  if (hasLockedInBookingDeposit(booking)) {
    return [
      `Payment reminder: we have received your deposit and your dates are held.`,
      `The remaining balance of ${formatBookingUsdAmount(outstandingAmount)} is still pending.`,
      noteLine,
    ].filter(Boolean).join("\n\n");
  }

  return [
    `Payment reminder: please complete the outstanding amount of ${formatBookingUsdAmount(outstandingAmount)} to confirm this booking.`,
    noteLine,
  ].filter(Boolean).join("\n\n");
}

function datesOverlapDateRange(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
) {
  return normalizeDateOnly(startA) <= normalizeDateOnly(endB) &&
    normalizeDateOnly(endA) >= normalizeDateOnly(startB);
}

function getReservedConflictWindow(
  blockedRanges: Array<{ startDate: string; endDate: string }>,
  requestedStartDate: string,
  requestedEndDate: string,
) {
  const overlappingRanges = blockedRanges.filter((range) =>
    datesOverlapDateRange(requestedStartDate, requestedEndDate, range.startDate, range.endDate),
  );

  if (overlappingRanges.length === 0) {
    return null;
  }

  let reservedStart = overlappingRanges.reduce((earliest, range) =>
    normalizeDateOnly(range.startDate).getTime() < normalizeDateOnly(earliest).getTime()
      ? range.startDate
      : earliest,
  overlappingRanges[0].startDate);

  let reservedEnd = overlappingRanges.reduce((latest, range) =>
    normalizeDateOnly(range.endDate).getTime() > normalizeDateOnly(latest).getTime()
      ? range.endDate
      : latest,
  overlappingRanges[0].endDate);

  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const range of blockedRanges) {
      const rangeStart = normalizeDateOnly(range.startDate);
      const rangeEnd = normalizeDateOnly(range.endDate);
      const currentStart = normalizeDateOnly(reservedStart);
      const currentEnd = normalizeDateOnly(reservedEnd);
      const touchesWindow =
        rangeStart.getTime() <= addDays(currentEnd, 1).getTime() &&
        rangeEnd.getTime() >= addDays(currentStart, -1).getTime();

      if (!touchesWindow) {
        continue;
      }

      if (rangeStart.getTime() < currentStart.getTime()) {
        reservedStart = range.startDate;
        expanded = true;
      }

      if (rangeEnd.getTime() > currentEnd.getTime()) {
        reservedEnd = range.endDate;
        expanded = true;
      }
    }
  }

  return {
    reservedEnd,
    availableFrom: toIsoDate(addDays(normalizeDateOnly(reservedEnd), 1)),
  };
}

function buildReservedConflictMessage(subject: string, conflictWindow: { reservedEnd: string; availableFrom: string }) {
  return `${subject} is booked up to ${formatShortDate(conflictWindow.reservedEnd)}. Available from ${formatShortDate(conflictWindow.availableFrom)}.`;
}

async function validateAccommodationAddonSelections(params: {
  selectedServiceIds: string[];
  stayServiceSelections?: Array<{
    serviceId: string;
    category: "cars" | "cooks" | "errands" | "experiences";
    serviceMode?: string | null;
    units?: number | null;
    guests?: number | null;
    serviceHours?: number | null;
    serviceLocation?: string | null;
    servicePickupLocation?: string | null;
    serviceReturnLocation?: string | null;
    serviceStartTime?: string | null;
    serviceBudgetAmount?: number | null;
    serviceAddonSelections?: string[];
    serviceDepartureId?: string | null;
    serviceRequestDetails?: string | null;
  }>;
  guests: number;
  checkIn: string;
  checkOut: string;
}) {
  const configuredSelections = (params.stayServiceSelections || [])
    .filter((selection) => selection?.serviceId)
    .map((selection) => ({
      ...selection,
      serviceAddonSelections: selection.serviceAddonSelections || [],
    }));
  if (configuredSelections.length) {
    const [cars, cooks, errands, experiences] = await Promise.all([
      storage.getCars(),
      storage.getCooks(),
      storage.getErrands(),
      storage.getExperiences(),
    ]);

    const carsById = new Map(cars.map((car) => [car.id, car]));
    const cooksById = new Map(cooks.map((cook) => [cook.id, cook]));
    const errandsById = new Map(errands.map((errand) => [errand.id, errand]));
    const experiencesById = new Map(experiences.map((experience) => [experience.id, experience]));

    const requestedEndDate = toIsoDate(getOccupiedEndDate(params.checkIn, params.checkOut));
    const occupiedDays = calculateChargeableDays(params.checkIn, params.checkOut);
    const validatedSelections: typeof configuredSelections = [];
    let addonTotal = 0;

    for (const selection of configuredSelections) {
      const configuredGuests = Math.max(1, selection.guests || params.guests);
      const configuredUnits = Math.max(1, selection.units || occupiedDays);

      const car = carsById.get(selection.serviceId);
      if (car) {
        if (!isBookablePublicListing(car)) {
          throw new Error(getUnavailableBookingMessage(car.model));
        }
        if (configuredGuests > car.seats) {
          throw new Error(`"${car.model}" only allows up to ${car.seats} passenger${car.seats === 1 ? "" : "s"}.`);
        }
        const pickupLocation = selection.servicePickupLocation?.trim() || selection.serviceLocation?.trim() || "";
        const returnLocation = selection.serviceReturnLocation?.trim() || pickupLocation;
        const serviceStartTime = selection.serviceStartTime?.trim() || null;

        if (!pickupLocation) {
          throw new Error(`Add a pickup location for "${car.model}".`);
        }

        const availability = await getCarAvailabilitySummary(car.id);
        const hasOverlap = availability.blockedRanges.some((range) =>
          datesOverlapDateRange(params.checkIn, requestedEndDate, range.startDate, range.endDate),
        );
        if (hasOverlap) {
          throw new Error(`"${car.model}" is not available for those stay dates.`);
        }

        if (selection.serviceMode === "car-chauffeur-hourly") {
          const hours = Math.max(3, selection.serviceHours || configuredUnits || 3);
          if (!car.priceWithDriverHourly) {
            throw new Error(`"${car.model}" does not offer hourly chauffeur booking.`);
          }
          if (!returnLocation) {
            throw new Error(`Add a drop-off location for "${car.model}".`);
          }
          if (!serviceStartTime) {
            throw new Error(`Choose a pickup time for "${car.model}".`);
          }
          addonTotal += hours * car.priceWithDriverHourly;
          validatedSelections.push({
            ...selection,
            serviceHours: hours,
            units: hours,
            category: "cars",
            serviceMode: "car-chauffeur-hourly",
            servicePickupLocation: pickupLocation,
            serviceReturnLocation: returnLocation,
            serviceStartTime,
          });
        } else {
          const dailyRate = selection.serviceMode === "car-self-drive-day" && car.pricePerDay
            ? car.pricePerDay
            : car.priceWithDriver;
          addonTotal += configuredUnits * dailyRate;
          validatedSelections.push({
            ...selection,
            units: configuredUnits,
            category: "cars",
            serviceMode: selection.serviceMode || "car-chauffeur-day",
            servicePickupLocation: pickupLocation,
            serviceReturnLocation: returnLocation,
            serviceStartTime,
          });
        }
        continue;
      }

      const cook = cooksById.get(selection.serviceId);
      if (cook) {
        if (!isBookablePublicListing(cook)) {
          throw new Error(getUnavailableBookingMessage(cook.title));
        }
        const minimumGuests = getCookMinimumGuests(cook);
        if (configuredGuests < minimumGuests) {
          throw new Error(`"${cook.title}" starts from ${minimumGuests} guest${minimumGuests === 1 ? "" : "s"}.`);
        }

        const availability = await getCookAvailabilitySummary(cook.id);
        const hasOverlap = availability.blockedRanges.some((range) =>
          datesOverlapDateRange(params.checkIn, requestedEndDate, range.startDate, range.endDate),
        );
        if (hasOverlap) {
          throw new Error(`"${cook.title}" is not available for those stay dates.`);
        }
        const serviceLocation = selection.serviceLocation?.trim() || "";
        if (!serviceLocation) {
          throw new Error(`Add the chef service location for "${cook.title}".`);
        }

        const serviceMode = selection.serviceMode || "cook-service-fee";
        const serviceRequestDetails = selection.serviceRequestDetails?.trim() || "";
        if (serviceMode === "cook-custom-menu" && serviceRequestDetails.length < 20) {
          throw new Error(`Add the custom menu brief for "${cook.title}".`);
        }

        const pricedUnits = Math.max(1, selection.units || occupiedDays);
        addonTotal += serviceMode === "cook-inclusive"
          ? calculateCookInclusiveTotal(cook, configuredGuests, pricedUnits)
          : calculateCookServiceTotal(cook, configuredGuests, pricedUnits);
        validatedSelections.push({
          ...selection,
          units: pricedUnits,
          guests: configuredGuests,
          category: "cooks",
          serviceMode,
          serviceLocation,
          serviceRequestDetails,
        });
        continue;
      }

      const errand = errandsById.get(selection.serviceId);
      if (errand) {
        if (!isBookablePublicListing(errand)) {
          throw new Error(getUnavailableBookingMessage(errand.serviceName));
        }
        const mode = selection.serviceMode || "errand-base";
        const packageCount = Math.max(1, selection.units || 1);
        const serviceLocation = selection.serviceLocation?.trim() || "";
        if (!serviceLocation) {
          throw new Error(`Add the service location for "${errand.serviceName}".`);
        }
        let packagePrice = errand.basePrice;

        if (mode === "errand-shopping") {
          const budgetAmount = Math.max(1, selection.serviceBudgetAmount || 0);
          if (!selection.serviceRequestDetails?.trim()) {
            throw new Error(`Add a shopping list or brief for "${errand.serviceName}".`);
          }
          packagePrice = errand.basePrice + budgetAmount + Math.ceil((budgetAmount * (errand.shoppingCommissionPercent || 10)) / 100);
        } else if (mode === "errand-laundry") {
          const selectedAddons = (selection.serviceAddonSelections || []).filter((addonId) =>
            (errand.laundryAddons || []).some((addon) => addon.id === addonId),
          );
          packagePrice += (errand.laundryAddons || [])
            .filter((addon) => selectedAddons.includes(addon.id))
            .reduce((sum, addon) => sum + addon.price, 0);
          selection.serviceAddonSelections = selectedAddons;
        } else if (mode === "errand-house-cleaning") {
          const selectedAddons = (selection.serviceAddonSelections || []).filter((addonId) =>
            (errand.houseCleaningAddons || []).some((addon) => addon.id === addonId),
          );
          packagePrice += (errand.houseCleaningAddons || [])
            .filter((addon) => selectedAddons.includes(addon.id))
            .reduce((sum, addon) => sum + addon.price, 0);
          selection.serviceAddonSelections = selectedAddons;
        } else if (mode === "errand-childcare") {
          if (!selection.serviceRequestDetails?.trim() || selection.serviceRequestDetails.trim().length < 20) {
            throw new Error(`Add child ages, care needs, timing, and safety notes for "${errand.serviceName}".`);
          }
          if (hasHelpMamaPricing(errand)) {
            const selectedRateId = getHelpMamaRateId(selection.serviceAddonSelections);
            const selectedAgeBandId = getHelpMamaAgeBandId(selection.serviceAddonSelections, errand.helpMamaPricing);
            if (!selectedAgeBandId) {
              throw new Error(`Choose a Help Mama age band for "${errand.serviceName}".`);
            }
            if (!selectedRateId) {
              throw new Error(`Choose a Help Mama time rate for "${errand.serviceName}".`);
            }
            if (isHelpMamaHourlyRate(selectedRateId) && (!selection.serviceHours || selection.serviceHours < HELP_MAMA_HOURLY_MINIMUM_HOURS)) {
              throw new Error(`Hourly Mama Care bookings for "${errand.serviceName}" require at least ${HELP_MAMA_HOURLY_MINIMUM_HOURS} hours.`);
            }
            packagePrice = calculateHelpMamaPackagePrice(errand, selection.serviceAddonSelections, selection.serviceHours);
          }
        }

        addonTotal += packagePrice * packageCount;
        validatedSelections.push({
          ...selection,
          units: packageCount,
          category: "errands",
          serviceMode: mode,
          serviceLocation,
          serviceRequestDetails: selection.serviceRequestDetails?.trim() || "",
        });
        continue;
      }

      const experience = experiencesById.get(selection.serviceId);
      if (experience) {
        if (!isBookablePublicListing(experience)) {
          throw new Error(getUnavailableBookingMessage(experience.title));
        }
        const mode = selection.serviceMode || "experience-private";
        const serviceRequestDetails = selection.serviceRequestDetails?.trim() || "";
        if (mode === "experience-shared") {
          const departures = await getExperienceDepartureAvailability(experience.id);
          const departure = departures?.find((item) => item.id === selection.serviceDepartureId);
          if (!departure) {
            throw new Error(`"${experience.title}" needs a valid shared departure.`);
          }
          if (configuredGuests > departure.spotsLeft) {
            throw new Error(`Only ${departure.spotsLeft} shared spot${departure.spotsLeft === 1 ? "" : "s"} remain for "${experience.title}".`);
          }
          addonTotal += (experience.sharedPricePerPerson || experience.price) * configuredGuests;
          validatedSelections.push({ ...selection, guests: configuredGuests, category: "experiences", serviceMode: mode, serviceDepartureId: departure.id, serviceRequestDetails });
        } else if (mode === "experience-custom-offer") {
          if (serviceRequestDetails.length < 20) {
            throw new Error(`Add the custom offer brief for "${experience.title}".`);
          }
          validatedSelections.push({ ...selection, guests: configuredGuests, category: "experiences", serviceMode: mode, serviceRequestDetails });
        } else {
          addonTotal += (experience.privatePricePerPerson || experience.price) * configuredGuests;
          validatedSelections.push({ ...selection, guests: configuredGuests, category: "experiences", serviceMode: "experience-private", serviceRequestDetails });
        }
        continue;
      }

      throw new Error("One of the selected tailored services is no longer available.");
    }

    return {
      selectedServices: validatedSelections.map((selection) => selection.serviceId),
      addonTotal,
      stayServiceSelections: validatedSelections,
    };
  }

  const uniqueServiceIds = Array.from(new Set((params.selectedServiceIds || []).filter((serviceId) => typeof serviceId === "string" && serviceId.trim().length > 0)));
  if (!uniqueServiceIds.length) {
    return { selectedServices: [] as string[], addonTotal: 0, stayServiceSelections: [] as typeof configuredSelections };
  }

  const [cars, cooks, errands, experiences] = await Promise.all([
    storage.getCars(),
    storage.getCooks(),
    storage.getErrands(),
    storage.getExperiences(),
  ]);

  const carsById = new Map(cars.map((car) => [car.id, car]));
  const cooksById = new Map(cooks.map((cook) => [cook.id, cook]));
  const errandsById = new Map(errands.map((errand) => [errand.id, errand]));
  const experiencesById = new Map(experiences.map((experience) => [experience.id, experience]));

  const occupiedDays = calculateChargeableDays(params.checkIn, params.checkOut);
  const requestedEndDate = toIsoDate(getOccupiedEndDate(params.checkIn, params.checkOut));

  let addonTotal = 0;
  const validatedServiceIds: string[] = [];

  for (const serviceId of uniqueServiceIds) {
    if (experiencesById.has(serviceId)) {
      throw new Error("Experiences need their own booking flow so we can capture timing and mode details.");
    }

    const car = carsById.get(serviceId);
    if (car) {
      if (!isBookablePublicListing(car)) {
        throw new Error(getUnavailableBookingMessage(car.model));
      }
      if (params.guests > car.seats) {
        throw new Error(`"${car.model}" only allows up to ${car.seats} passenger${car.seats === 1 ? "" : "s"}.`);
      }

      const carAvailability = await getCarAvailabilitySummary(car.id);
      const hasCarOverlap = carAvailability.blockedRanges.some((range) =>
        datesOverlapDateRange(
          params.checkIn,
          requestedEndDate,
          range.startDate,
          range.endDate,
        ),
      );

      if (hasCarOverlap) {
        throw new Error(`"${car.model}" is not available for those stay dates.`);
      }

      addonTotal += occupiedDays * (car.pricePerDay || car.priceWithDriver);
      validatedServiceIds.push(car.id);
      continue;
    }

    const cook = cooksById.get(serviceId);
    if (cook) {
      if (!isBookablePublicListing(cook)) {
        throw new Error(getUnavailableBookingMessage(cook.title));
      }
      const minimumGuests = getCookMinimumGuests(cook);
      if (params.guests < minimumGuests) {
        throw new Error(`"${cook.title}" starts from ${minimumGuests} guest${minimumGuests === 1 ? "" : "s"}.`);
      }

      const cookAvailability = await getCookAvailabilitySummary(cook.id);
      const hasCookOverlap = cookAvailability.blockedRanges.some((range) =>
        datesOverlapDateRange(
          params.checkIn,
          requestedEndDate,
          range.startDate,
          range.endDate,
        ),
      );

      if (hasCookOverlap) {
        throw new Error(`"${cook.title}" is not available for those stay dates.`);
      }

      addonTotal += calculateCookServiceTotal(cook, params.guests, occupiedDays);
      validatedServiceIds.push(cook.id);
      continue;
    }

    const errand = errandsById.get(serviceId);
    if (errand) {
      if (!isBookablePublicListing(errand)) {
        throw new Error(getUnavailableBookingMessage(errand.serviceName));
      }
      addonTotal += errand.basePrice;
      validatedServiceIds.push(errand.id);
      continue;
    }

    throw new Error("One of the selected stay add-ons is no longer available.");
  }

  return {
    selectedServices: validatedServiceIds,
    addonTotal,
    stayServiceSelections: [] as typeof configuredSelections,
  };
}

type PromoEvaluationContext = {
  subtotal: number;
  categories: ProviderCategory[];
  serviceCount: number;
  nights: number;
  guests: number;
  promoCode?: string | null;
};

function getNormalizedPromoCode(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

function isPromoLive(promo: MarketingPromo) {
  const today = getTodayIsoDate();
  if (promo.status !== "active") {
    return false;
  }
  if (promo.startAt && promo.startAt > today) {
    return false;
  }
  if (promo.endAt && promo.endAt < today) {
    return false;
  }
  if (promo.usageLimit && promo.redemptionCount >= promo.usageLimit) {
    return false;
  }
  return true;
}

function calculatePromoDiscountAmount(promo: MarketingPromo, subtotal: number) {
  if (subtotal <= 0) {
    return 0;
  }

  if (promo.promoType === "percent") {
    return Math.max(0, Math.round(subtotal * ((promo.discountPercent ?? 0) / 100)));
  }

  return Math.max(0, promo.discountAmount ?? 0);
}

function isMarketingPromoCostAbsorption(value: string | null | undefined): value is MarketingPromoCostAbsorption {
  return Boolean(value) && marketingPromoCostAbsorptions.includes(value as MarketingPromoCostAbsorption);
}

function getMarketingPromoCostAbsorption(value: string | null | undefined): MarketingPromoCostAbsorption {
  return isMarketingPromoCostAbsorption(value) ? value : "shared";
}

function evaluatePromoForContext(promo: MarketingPromo, context: PromoEvaluationContext): { eligible: boolean; reason: string | null } {
  if (!isPromoLive(promo)) {
    return { eligible: false, reason: "This promo is not active right now." };
  }

  if (context.subtotal <= 0) {
    return { eligible: false, reason: "A booking subtotal is required before a promo can apply." };
  }

  if (promo.minimumSpend && context.subtotal < promo.minimumSpend) {
    return { eligible: false, reason: `This promo starts from ${promo.minimumSpend}.` };
  }

  const selectedCategories = new Set(context.categories);
  if (
    promo.eligibleCategories.length > 0
    && !promo.eligibleCategories.some((category) => selectedCategories.has(category as ProviderCategory))
  ) {
    return { eligible: false, reason: "This promo is aimed at a different service mix." };
  }

  if (promo.promoType === "bundle") {
    if (promo.requiredCategories.length > 0) {
      const missingCategory = promo.requiredCategories.find((category) => !selectedCategories.has(category as ProviderCategory));
      if (missingCategory) {
        return { eligible: false, reason: `Add ${missingCategory} to unlock this bundle.` };
      }
    }

    if (promo.minimumNights && context.nights < promo.minimumNights) {
      return { eligible: false, reason: `This bundle starts from ${promo.minimumNights} night${promo.minimumNights === 1 ? "" : "s"}.` };
    }

    if (promo.minimumGuests && context.guests < promo.minimumGuests) {
      return { eligible: false, reason: `This bundle starts from ${promo.minimumGuests} guest${promo.minimumGuests === 1 ? "" : "s"}.` };
    }

    if (promo.minimumServiceCount && context.serviceCount < promo.minimumServiceCount) {
      return { eligible: false, reason: `Add ${promo.minimumServiceCount} bundled service${promo.minimumServiceCount === 1 ? "" : "s"} to qualify.` };
    }
  }

  const requestedCode = getNormalizedPromoCode(context.promoCode);
  if (requestedCode) {
    if (!promo.code || promo.code !== requestedCode) {
      return { eligible: false, reason: "Promo code does not match this campaign." };
    }
  } else if (!(promo.promoType === "bundle" && promo.autoApply)) {
    return { eligible: false, reason: null };
  }

  const discountAmount = calculatePromoDiscountAmount(promo, context.subtotal);
  if (discountAmount <= 0) {
    return { eligible: false, reason: "This promo does not change the current total." };
  }

  return { eligible: true, reason: null };
}

function buildPromoPreview(promo: MarketingPromo, context: PromoEvaluationContext, appliedAutomatically: boolean): MarketingPromoPreview {
  const matchedCategories = Array.from(new Set(context.categories));
  const discountAmount = Math.min(context.subtotal, calculatePromoDiscountAmount(promo, context.subtotal));
  return {
    promoId: promo.id,
    promoName: promo.name,
    promoCode: promo.code ?? null,
    costAbsorption: getMarketingPromoCostAbsorption(promo.costAbsorption),
    bundleLabel: promo.bundleLabel ?? null,
    description: promo.description ?? null,
    discountAmount,
    originalSubtotal: context.subtotal,
    discountedSubtotal: Math.max(0, context.subtotal - discountAmount),
    appliedAutomatically,
    requiredCategories: (promo.requiredCategories as ProviderCategory[] | undefined) ?? [],
    matchedCategories,
    landingPath: promo.landingPath ?? null,
  };
}

async function resolveMarketingPromoPreview(context: PromoEvaluationContext): Promise<MarketingPromoPreviewResult> {
  const promos = await storage.getMarketingPromos();
  const requestedCode = getNormalizedPromoCode(context.promoCode);
  const candidates = requestedCode
    ? promos.filter((promo) => promo.code === requestedCode)
    : promos.filter((promo) => promo.promoType === "bundle" && promo.autoApply);

  if (requestedCode && candidates.length === 0) {
    return { promo: null, rejectionReason: "Promo code not found." };
  }

  let rejectionReason: string | null = requestedCode ? "Promo code does not qualify for this booking." : null;
  const eligiblePromos = candidates
    .map((promo) => {
      const evaluation = evaluatePromoForContext(promo, context);
      if (!evaluation.eligible) {
        if (requestedCode && evaluation.reason) {
          rejectionReason = evaluation.reason;
        }
        return null;
      }

      const preview = buildPromoPreview(promo, context, !requestedCode);
      return preview;
    })
    .filter((preview): preview is MarketingPromoPreview => Boolean(preview));

  if (!eligiblePromos.length) {
    return { promo: null, rejectionReason };
  }

  eligiblePromos.sort((left, right) =>
    right.discountAmount - left.discountAmount
    || right.originalSubtotal - left.originalSubtotal
    || left.promoName.localeCompare(right.promoName),
  );

  return {
    promo: eligiblePromos[0],
    rejectionReason: null,
  };
}

function getPromoServiceCount(selectedServiceIds: string[], accommodationId?: string | null) {
  return Array.from(new Set(selectedServiceIds.filter(Boolean))).length + (accommodationId ? 1 : 0);
}

function getTodayIsoDate() {
  return getTodayDateString();
}

function isAvailabilityRangeCurrentOrFuture(range: { endDate: string }) {
  return range.endDate >= getTodayIsoDate();
}

function getCurrentUtcMinutes() {
  const now = new Date();
  return (now.getUTCHours() * 60) + now.getUTCMinutes();
}

function getBookingOperationalStatus(booking: any) {
  if (booking.status === "cancelled" || booking.status === "completed") {
    return booking.status;
  }

  if (!isBookingPaymentPaid(booking) && !hasAcceptedQuotedBooking(booking)) {
    return hasLockedInBookingDeposit(booking) ? "pending-payment" : "pending";
  }

  if (booking.serviceMode === "cook-custom-menu" && booking.customMenuClientDecision !== "accepted") {
    return "pending";
  }

  if (booking.serviceMode === "experience-custom-offer" && booking.experienceCustomOfferClientDecision !== "accepted") {
    return "pending";
  }

  if (booking.status === "in-progress") {
    return "in-progress";
  }

  const todayIso = getTodayIsoDate();
  const serviceEndDate = booking.serviceMode === "car-chauffeur-hourly"
    ? booking.checkIn
    : booking.checkOut;

  if (booking.accommodationId) {
    if (todayIso > booking.checkOut) {
      return "completed";
    }

    if (todayIso >= booking.checkIn && todayIso <= booking.checkOut) {
      return "in-progress";
    }

    return "upcoming";
  }

  if (booking.serviceMode === "car-chauffeur-hourly") {
    if (todayIso < booking.checkIn) {
      return "upcoming";
    }

    if (todayIso > booking.checkIn) {
      return "late";
    }

    const startMinutes = booking.serviceStartTime ? parseTimeToMinutes(booking.serviceStartTime) : null;
    const endMinutes = booking.serviceEndTime ? parseTimeToMinutes(booking.serviceEndTime) : null;
    const currentMinutes = getCurrentUtcMinutes();

    if (startMinutes !== null && currentMinutes < startMinutes) {
      return "upcoming";
    }

    if (endMinutes !== null && currentMinutes <= endMinutes) {
      return "in-progress";
    }

    return "late";
  }

  if (todayIso < booking.checkIn) {
    return "upcoming";
  }

  if (todayIso <= serviceEndDate) {
    return "in-progress";
  }

  return "late";
}

function decorateBookingWithOperationalStatus<T extends { status: string }>(booking: T): T {
  return {
    ...booking,
    status: getBookingOperationalStatus(booking),
  };
}

function toBookingMarketingSummary(
  attribution: Pick<BookingAttribution, "promoId" | "promoName" | "promoCode" | "promoCostAbsorption" | "originalSubtotal" | "discountAmount" | "finalRevenue"> | null | undefined,
): BookingMarketingSummary | null {
  if (!attribution) {
    return null;
  }

  const originalSubtotal = Math.max(0, Number(attribution.originalSubtotal ?? 0));
  const discountAmount = Math.max(0, Number(attribution.discountAmount ?? 0));
  const finalRevenue = Math.max(0, Number(attribution.finalRevenue ?? 0));
  const hasPromoContext = Boolean(
    attribution.promoId
    || attribution.promoName
    || attribution.promoCode
    || discountAmount > 0
    || originalSubtotal > finalRevenue,
  );

  if (!hasPromoContext) {
    return null;
  }

  return {
    promoId: attribution.promoId ?? null,
    promoName: attribution.promoName ?? null,
    promoCode: attribution.promoCode ?? null,
    promoCostAbsorption: getMarketingPromoCostAbsorption(attribution.promoCostAbsorption),
    originalSubtotal,
    discountAmount,
    finalRevenue,
  };
}

async function attachBookingMarketingAttribution<T extends { id: string }>(booking: T) {
  const [attribution] = await storage.getBookingAttributionsByBookingIds([booking.id]);
  return {
    ...booking,
    marketingAttribution: toBookingMarketingSummary(attribution),
  };
}

async function attachBookingMarketingAttributions<T extends { id: string }>(bookings: T[]) {
  if (bookings.length === 0) {
    return [];
  }

  const attributions = await storage.getBookingAttributionsByBookingIds(bookings.map((booking) => booking.id));
  const attributionMap = new Map(
    attributions
      .map((entry) => [entry.bookingId, toBookingMarketingSummary(entry)] as const)
      .filter((entry): entry is readonly [string, BookingMarketingSummary] => Boolean(entry[1])),
  );

  return bookings.map((booking) => ({
    ...booking,
    marketingAttribution: attributionMap.get(booking.id) ?? null,
  }));
}

function ensurePublicListingHasManager<T extends { managerUserId?: string | null; isPublic?: boolean }>(
  validatedData: T,
  fallbackManagerUserId: string | null | undefined,
): T {
  if (!validatedData.isPublic || hasAssignedManagerUserId(validatedData.managerUserId)) {
    return validatedData;
  }

  return {
    ...validatedData,
    managerUserId: fallbackManagerUserId ?? undefined,
  };
}

function mergeManagerAssignment<T extends { managerUserId?: string | null; isPublic?: boolean }>(
  body: unknown,
  validatedData: T,
  existingManagerUserId: string | null | undefined,
  fallbackManagerUserId?: string | null | undefined,
): T {
  const nextData = (
    body &&
    typeof body === "object" &&
    Object.prototype.hasOwnProperty.call(body, "managerUserId")
  )
    ? validatedData
    : {
        ...validatedData,
        managerUserId: existingManagerUserId ?? undefined,
      };

  return ensurePublicListingHasManager(nextData, fallbackManagerUserId ?? existingManagerUserId);
}

function clearProviderStatusRequestFields(reviewerId?: string | null) {
  return {
    providerStatusRequest: null,
    providerStatusRequestNote: null,
    providerStatusRequestedByUserId: null,
    providerStatusRequestedAt: null,
    providerStatusReviewedByUserId: reviewerId ?? null,
    providerStatusReviewedAt: new Date().toISOString(),
  };
}

function resetProviderStatusRequestFields() {
  return {
    providerStatusRequest: null,
    providerStatusRequestNote: null,
    providerStatusRequestedByUserId: null,
    providerStatusRequestedAt: null,
    providerStatusReviewedByUserId: null,
    providerStatusReviewedAt: null,
  };
}

function canTransitionBookingStatus(currentStatus: string, nextStatus: string) {
  const allowedTransitions: Record<string, string[]> = {
    upcoming: ["upcoming", "in-progress", "completed", "cancelled"],
    "in-progress": ["in-progress", "completed", "cancelled"],
    "pending-payment": ["pending-payment"],
    completed: ["completed"],
    cancelled: ["cancelled"],
    late: ["late", "completed", "cancelled"],
  };

  const allowed = allowedTransitions[currentStatus];
  return allowed ? allowed.includes(nextStatus) : false;
}

function getProviderProgressUpdateError(currentStatus: string) {
  if (currentStatus === "completed") {
    return "Completed orders are already closed.";
  }

  if (currentStatus === "cancelled") {
    return "Cancelled orders cannot be updated.";
  }

  if (currentStatus === "pending" || currentStatus === "pending-payment") {
    return "This order is not active yet.";
  }

  return "That progress update is not allowed for this order.";
}

async function applyProviderBookingStatusUpdate(
  bookingId: string,
  booking: any,
  requestedStatus: "in-progress" | "completed",
) {
  const currentStatus = getBookingOperationalStatus(booking);
  if (!canTransitionBookingStatus(currentStatus, requestedStatus)) {
    return { error: getProviderProgressUpdateError(currentStatus) } as const;
  }

  const updatedBooking = await storage.updateBooking(bookingId, {
    status: requestedStatus,
    ...resetProviderStatusRequestFields(),
  });

  if (!updatedBooking) {
    return { error: "Booking not found" } as const;
  }

  return { booking: await attachBookingMarketingAttribution(decorateBookingWithOperationalStatus(updatedBooking)) } as const;
}

function decorateProviderAssignmentView(
  assignment: BookingServiceAssignment,
  booking: any,
): ProviderBookingAssignmentView {
  return {
    assignment,
    booking: decorateBookingWithOperationalStatus(booking),
  };
}

async function syncBookingsAssignmentState(
  bookingIds: string[],
  options?: { notifyProviders?: boolean },
) {
  const uniqueBookingIds = Array.from(new Set(bookingIds.filter(Boolean)));
  if (!uniqueBookingIds.length) {
    return;
  }

  await storage.syncBookingServiceAssignments({
    bookingIds: uniqueBookingIds,
    notifyProviders: options?.notifyProviders === true,
  });
  await storage.syncBookingPayouts({
    bookingIds: uniqueBookingIds,
    skipAssignmentSync: true,
  });
}

async function getRelatedBookingIdsForService(category: ProviderCategory, serviceId: string) {
  const relatedBookings = category === "stays"
    ? await storage.getBookingsByAccommodationId(serviceId)
    : await storage.getBookingsBySelectedServiceId(serviceId);

  return Array.from(new Set(relatedBookings.map((booking) => booking.id)));
}

async function syncRelatedServiceBookings(
  category: ProviderCategory,
  serviceId: string,
  options?: { notifyProviders?: boolean },
) {
  const bookingIds = await getRelatedBookingIdsForService(category, serviceId);
  await syncBookingsAssignmentState(bookingIds, options);
}

async function reconcileParentBookingStatusFromAssignments(bookingId: string) {
  const booking = await storage.getBooking(bookingId);
  if (!booking || booking.status === "cancelled") {
    return booking;
  }

  const assignments = await storage.getBookingServiceAssignmentsByBookingId(bookingId);
  if (!assignments.length) {
    return booking;
  }

  const activeAssignments = assignments.filter((assignment) => assignment.status !== "cancelled");
  const nextStatus = !activeAssignments.length
    ? booking.status
    : activeAssignments.every((assignment) => assignment.status === "completed")
      ? "completed"
      : activeAssignments.some((assignment) => assignment.status === "in-progress" || assignment.status === "completed")
        ? "in-progress"
        : "upcoming";

  if (
    booking.status === nextStatus
    && !booking.providerStatusRequest
    && !booking.providerStatusRequestNote
  ) {
    return booking;
  }

  return await storage.updateBooking(bookingId, {
    status: nextStatus,
    ...resetProviderStatusRequestFields(),
  });
}

async function getVisibleProviderAssignment(req: any, assignmentId: string) {
  const assignment = (await storage.getBookingServiceAssignments()).find((entry) => entry.id === assignmentId);
  if (!assignment) {
    return { error: { status: 404, body: { error: "Assignment not found" } } } as const;
  }

  const currentUserId = req.user?.claims?.sub;
  const currentUserRole = req.user?.claims?.role;
  if (currentUserRole !== "admin" && assignment.providerUserId !== currentUserId) {
    return { error: { status: 403, body: { error: "Forbidden" } } } as const;
  }

  const booking = await storage.getBooking(assignment.bookingId);
  if (!booking) {
    return { error: { status: 404, body: { error: "Booking not found" } } } as const;
  }

  return { assignment, booking } as const;
}

async function getVisibleProviderBooking(
  req: any,
  bookingId: string,
  providerCategory?: ProviderCategory,
) {
  const booking = await storage.getBooking(bookingId);
  if (!booking) {
    return { error: { status: 404, body: { error: "Booking not found" } } } as const;
  }

  const currentUserId = req.user?.claims?.sub;
  const currentUserRole = req.user?.claims?.role;
  if (currentUserRole === "admin") {
    return { booking } as const;
  }

  const assignments = await storage.getBookingServiceAssignmentsByBookingId(bookingId);
  const visibleAssignment = assignments.find((assignment) =>
    assignment.providerUserId === currentUserId
    && (!providerCategory || assignment.providerCategory === providerCategory),
  );

  if (!visibleAssignment) {
    return { error: { status: 403, body: { error: "Forbidden" } } } as const;
  }

  return { booking } as const;
}

async function applyProviderAssignmentStatusUpdate(
  assignment: BookingServiceAssignment,
  booking: any,
  requestedStatus: "in-progress" | "completed",
) {
  const bookingOperationalStatus = getBookingOperationalStatus(booking);
  if (bookingOperationalStatus === "cancelled" || bookingOperationalStatus === "pending") {
    return { error: getProviderProgressUpdateError(bookingOperationalStatus) } as const;
  }

  if (
    (booking.serviceMode === "cook-custom-menu" || booking.serviceMode === "experience-custom-offer")
    && !hasAcceptedQuotedBooking(booking)
  ) {
    return { error: "Progress updates are available after the client accepts the quote." } as const;
  }

  const currentAssignmentStatus = assignment.status || "upcoming";
  if (!canTransitionBookingStatus(currentAssignmentStatus, requestedStatus)) {
    return { error: getProviderProgressUpdateError(currentAssignmentStatus) } as const;
  }

  const updatedAssignment = await storage.updateBookingServiceAssignmentStatus(assignment.id, requestedStatus as BookingServiceAssignmentStatus);
  if (!updatedAssignment) {
    return { error: "Assignment not found" } as const;
  }

  const updatedBooking = await reconcileParentBookingStatusFromAssignments(assignment.bookingId);
  if (!updatedBooking) {
    return { error: "Booking not found" } as const;
  }

  return {
    assignment: decorateProviderAssignmentView(updatedAssignment, updatedBooking),
  } as const;
}

const customerProfileUpdateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60, "First name is too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(60, "Last name is too long"),
  phone: z.string().trim().min(7, "Phone number is required").max(30, "Phone number is too long"),
});

function shouldBookingBlockAvailability(booking: any) {
  const operationalStatus = getBookingOperationalStatus(booking);

  if (operationalStatus === "cancelled" || operationalStatus === "completed" || operationalStatus === "late") {
    return false;
  }

  if (
    !isBookingPaymentPaid(booking)
    && !hasAcceptedQuotedBooking(booking)
    && !hasActivePaymentHold(booking)
    && !hasLockedInBookingDeposit(booking)
  ) {
    return false;
  }

  if (booking.serviceMode === "cook-custom-menu" && booking.customMenuClientDecision !== "accepted") {
    return false;
  }

  return true;
}

async function getStayAvailabilitySummary(stayId: string) {
  const stayBookings = await storage.getBookingsByAccommodationId(stayId);
  const manualReservations = await storage.getStayReservations(stayId);
  const activeBookings = stayBookings
    .filter((booking) => shouldBookingBlockAvailability(booking))
    .sort((a, b) => normalizeDateOnly(a.checkIn).getTime() - normalizeDateOnly(b.checkIn).getTime());

  const bookingRanges = activeBookings
    .map((booking) => ({
      id: booking.id,
      source: "booking" as const,
      startDate: booking.checkIn,
      endDate: toIsoDate(getOccupiedEndDate(booking.checkIn, booking.checkOut)),
      checkoutDate: booking.checkOut,
      status: booking.status,
      guestName: booking.guestName,
    }))
    .filter(isAvailabilityRangeCurrentOrFuture);

  const manualRanges = manualReservations
    .filter((reservation) => reservation.status === "blocked")
    .map((reservation) => ({
      reservation,
      occupiedEndDate: toIsoDate(getOccupiedEndDate(reservation.startDate, reservation.endDate)),
    }))
    .filter(({ occupiedEndDate }) => occupiedEndDate >= getTodayIsoDate())
    .sort((a, b) => normalizeDateOnly(a.reservation.startDate).getTime() - normalizeDateOnly(b.reservation.startDate).getTime())
    .map(({ reservation, occupiedEndDate }) => ({
      id: reservation.id,
      source: "manual" as const,
      startDate: reservation.startDate,
      endDate: occupiedEndDate,
      checkoutDate: reservation.endDate,
      status: reservation.status,
      guestName: "Manual block",
    }));

  const blockedRanges = [...bookingRanges, ...manualRanges].sort(
    (a, b) => normalizeDateOnly(a.startDate).getTime() - normalizeDateOnly(b.startDate).getTime(),
  );

  const mergedRanges = blockedRanges.reduce<Array<{ startDate: string; endDate: string }>>((ranges, range) => {
    const previousRange = ranges[ranges.length - 1];
    if (!previousRange) {
      ranges.push({ startDate: range.startDate, endDate: range.endDate });
      return ranges;
    }

    const previousEnd = normalizeDateOnly(previousRange.endDate);
    const nextStart = normalizeDateOnly(range.startDate);
    if (addDays(previousEnd, 1).getTime() >= nextStart.getTime()) {
      if (normalizeDateOnly(range.endDate).getTime() > previousEnd.getTime()) {
        previousRange.endDate = range.endDate;
      }
      return ranges;
    }

    ranges.push({ startDate: range.startDate, endDate: range.endDate });
    return ranges;
  }, []);

  const today = normalizeDateOnly(getTodayIsoDate());
  let availableFrom = toIsoDate(today);

  for (const range of mergedRanges) {
    const rangeStart = normalizeDateOnly(range.startDate);
    const rangeEnd = normalizeDateOnly(range.endDate);
    const candidateDate = normalizeDateOnly(availableFrom);

    if (candidateDate.getTime() < rangeStart.getTime()) {
      break;
    }

    if (candidateDate.getTime() <= rangeEnd.getTime()) {
      availableFrom = toIsoDate(addDays(rangeEnd, 1));
    }
  }

  return {
    blockedRanges,
    availableFrom,
  };
}

async function getCarAvailabilitySummary(carId: string) {
  const carBookings = await storage.getBookingsBySelectedServiceId(carId);
  const manualReservations = await storage.getCarReservations(carId);
  const activeBookings = carBookings
    .filter((booking) => shouldBookingBlockAvailability(booking))
    .sort((a, b) => normalizeDateOnly(a.checkIn).getTime() - normalizeDateOnly(b.checkIn).getTime());

  const bookingRanges = activeBookings
    .map((booking) => {
      const occupiedEndDate = booking.serviceMode === "car-chauffeur-hourly"
        ? booking.checkIn
        : toIsoDate(getOccupiedEndDate(booking.checkIn, booking.checkOut));

      return {
        id: booking.id,
        source: "booking" as const,
        startDate: booking.checkIn,
        endDate: occupiedEndDate,
        checkoutDate: booking.checkOut,
        status: booking.status,
        guestName: booking.guestName,
        serviceMode: booking.serviceMode,
      };
    })
    .filter(isAvailabilityRangeCurrentOrFuture);

  const manualRanges = manualReservations
    .filter((reservation) => reservation.status === "blocked")
    .map((reservation) => ({
      reservation,
      occupiedEndDate: toIsoDate(getOccupiedEndDate(reservation.startDate, reservation.endDate)),
    }))
    .filter(({ occupiedEndDate }) => occupiedEndDate >= getTodayIsoDate())
    .sort((a, b) => normalizeDateOnly(a.reservation.startDate).getTime() - normalizeDateOnly(b.reservation.startDate).getTime())
    .map(({ reservation, occupiedEndDate }) => ({
      id: reservation.id,
      source: "manual" as const,
      startDate: reservation.startDate,
      endDate: occupiedEndDate,
      checkoutDate: reservation.endDate,
      status: reservation.status,
      guestName: "Manual block",
      serviceMode: "manual",
    }));

  const blockedRanges = [...bookingRanges, ...manualRanges].sort(
    (a, b) => normalizeDateOnly(a.startDate).getTime() - normalizeDateOnly(b.startDate).getTime(),
  );

  const mergedRanges = blockedRanges.reduce<Array<{ startDate: string; endDate: string }>>((ranges, range) => {
    const previousRange = ranges[ranges.length - 1];
    if (!previousRange) {
      ranges.push({ startDate: range.startDate, endDate: range.endDate });
      return ranges;
    }

    const previousEnd = normalizeDateOnly(previousRange.endDate);
    const nextStart = normalizeDateOnly(range.startDate);
    if (addDays(previousEnd, 1).getTime() >= nextStart.getTime()) {
      if (normalizeDateOnly(range.endDate).getTime() > previousEnd.getTime()) {
        previousRange.endDate = range.endDate;
      }
      return ranges;
    }

    ranges.push({ startDate: range.startDate, endDate: range.endDate });
    return ranges;
  }, []);

  const today = normalizeDateOnly(getTodayIsoDate());
  let availableFrom = toIsoDate(today);

  for (const range of mergedRanges) {
    const rangeStart = normalizeDateOnly(range.startDate);
    const rangeEnd = normalizeDateOnly(range.endDate);
    const candidateDate = normalizeDateOnly(availableFrom);

    if (candidateDate.getTime() < rangeStart.getTime()) {
      break;
    }

    if (candidateDate.getTime() <= rangeEnd.getTime()) {
      availableFrom = toIsoDate(addDays(rangeEnd, 1));
    }
  }

  return {
    blockedRanges,
    availableFrom,
  };
}

async function getCookAvailabilitySummary(cookId: string) {
  const cookBookings = await storage.getBookingsBySelectedServiceId(cookId);
  const manualReservations = await storage.getCookReservations(cookId);
  const activeBookings = cookBookings
    .filter((booking) => shouldBookingBlockAvailability(booking))
    .sort((a, b) => normalizeDateOnly(a.checkIn).getTime() - normalizeDateOnly(b.checkIn).getTime());

  const bookingRanges = activeBookings
    .map((booking) => ({
      id: booking.id,
      source: "booking" as const,
      startDate: booking.checkIn,
      endDate: toIsoDate(getOccupiedEndDate(booking.checkIn, booking.checkOut)),
      checkoutDate: booking.checkOut,
      status: booking.status,
      guestName: booking.guestName,
      serviceMode: booking.serviceMode,
    }))
    .filter(isAvailabilityRangeCurrentOrFuture);

  const manualRanges = manualReservations
    .filter((reservation) => reservation.status === "blocked")
    .map((reservation) => ({
      reservation,
      occupiedEndDate: toIsoDate(getOccupiedEndDate(reservation.startDate, reservation.endDate)),
    }))
    .filter(({ occupiedEndDate }) => occupiedEndDate >= getTodayIsoDate())
    .sort((a, b) => normalizeDateOnly(a.reservation.startDate).getTime() - normalizeDateOnly(b.reservation.startDate).getTime())
    .map(({ reservation, occupiedEndDate }) => ({
      id: reservation.id,
      source: "manual" as const,
      startDate: reservation.startDate,
      endDate: occupiedEndDate,
      checkoutDate: reservation.endDate,
      status: reservation.status,
      guestName: "Manual block",
      serviceMode: "manual",
    }));

  const blockedRanges = [...bookingRanges, ...manualRanges].sort(
    (a, b) => normalizeDateOnly(a.startDate).getTime() - normalizeDateOnly(b.startDate).getTime(),
  );

  const mergedRanges = blockedRanges.reduce<Array<{ startDate: string; endDate: string }>>((ranges, range) => {
    const previousRange = ranges[ranges.length - 1];
    if (!previousRange) {
      ranges.push({ startDate: range.startDate, endDate: range.endDate });
      return ranges;
    }

    const previousEnd = normalizeDateOnly(previousRange.endDate);
    const nextStart = normalizeDateOnly(range.startDate);
    if (addDays(previousEnd, 1).getTime() >= nextStart.getTime()) {
      if (normalizeDateOnly(range.endDate).getTime() > previousEnd.getTime()) {
        previousRange.endDate = range.endDate;
      }
      return ranges;
    }

    ranges.push({ startDate: range.startDate, endDate: range.endDate });
    return ranges;
  }, []);

  const today = normalizeDateOnly(getTodayIsoDate());
  let availableFrom = toIsoDate(today);

  for (const range of mergedRanges) {
    const rangeStart = normalizeDateOnly(range.startDate);
    const rangeEnd = normalizeDateOnly(range.endDate);
    const candidateDate = normalizeDateOnly(availableFrom);

    if (candidateDate.getTime() < rangeStart.getTime()) {
      break;
    }

    if (candidateDate.getTime() <= rangeEnd.getTime()) {
      availableFrom = toIsoDate(addDays(rangeEnd, 1));
    }
  }

  return {
    blockedRanges,
    availableFrom,
  };
}

function hasAvailabilityOverlap(
  blockedRanges: Array<{ startDate: string; endDate: string }>,
  checkIn: string,
  checkOut: string,
) {
  const requestedEndDate = toIsoDate(getOccupiedEndDate(checkIn, checkOut));
  return blockedRanges.some((range) =>
    datesOverlapDateRange(checkIn, requestedEndDate, range.startDate, range.endDate),
  );
}

async function assertProviderCanAccessStay(req: any, stayId: string) {
  const stay = await storage.getStay(stayId);
  if (!stay) {
    return { error: { status: 404, body: { error: "Stay not found" } } } as const;
  }

  const currentUserId = req.user?.claims?.sub;
  const currentUserRole = req.user?.claims?.role;
  if (currentUserRole !== "admin" && stay.managerUserId !== currentUserId) {
    return { error: { status: 403, body: { error: "Forbidden - Stay access not assigned to this provider" } } } as const;
  }

  return { stay } as const;
}

async function assertProviderCanAccessCar(req: any, carId: string) {
  const car = await storage.getCar(carId);
  if (!car) {
    return { error: { status: 404, body: { error: "Car not found" } } } as const;
  }

  const currentUserId = req.user?.claims?.sub;
  const currentUserRole = req.user?.claims?.role;
  if (currentUserRole !== "admin" && car.managerUserId !== currentUserId) {
    return { error: { status: 403, body: { error: "Forbidden - Car access not assigned to this provider" } } } as const;
  }

  return { car } as const;
}

async function assertProviderCanAccessCook(req: any, cookId: string) {
  const cook = await storage.getCook(cookId);
  if (!cook) {
    return { error: { status: 404, body: { error: "Cook not found" } } } as const;
  }

  const currentUserId = req.user?.claims?.sub;
  const currentUserRole = req.user?.claims?.role;
  if (currentUserRole !== "admin" && cook.managerUserId !== currentUserId) {
    return { error: { status: 403, body: { error: "Forbidden - Chef access not assigned to this provider" } } } as const;
  }

  return { cook } as const;
}

async function assertProviderCanAccessCookBooking(req: any, bookingId: string) {
  const access = await getVisibleProviderBooking(req, bookingId, "cooks");
  if ("error" in access) {
    const error = access.error!;
    return error.status === 404
      ? access
      : { error: { status: error.status, body: { error: "Forbidden - Cook booking not assigned to this provider" } } } as const;
  }

  return access;
}

async function assertProviderCanAccessExperienceBooking(req: any, bookingId: string) {
  const access = await getVisibleProviderBooking(req, bookingId, "experiences");
  if ("error" in access) {
    const error = access.error!;
    return error.status === 404
      ? access
      : { error: { status: error.status, body: { error: "Forbidden - Experience booking not assigned to this provider" } } } as const;
  }

  return access;
}

async function assertCanAccessBookingThread(req: any, bookingId: string) {
  const booking = await storage.getBooking(bookingId);
  if (!booking) {
    return { error: { status: 404, body: { error: "Booking not found" } } } as const;
  }

  const currentUserId = req.user?.claims?.sub;
  const currentUserRole = req.user?.claims?.role;

  if (currentUserRole === "admin" || booking.userId === currentUserId) {
    return { booking } as const;
  }

  const assignments = await storage.getBookingServiceAssignmentsByBookingId(bookingId);
  if (assignments.some((assignment) => assignment.providerUserId === currentUserId)) {
    return { booking } as const;
  }

  return { error: { status: 403, body: { error: "Forbidden" } } } as const;
}

async function refreshTargetRating(targetType: string, targetId: string) {
  const targetReviews = await storage.getReviewsByTarget(targetType, targetId);
  const reviewCount = targetReviews.length;
  const rating = reviewCount > 0
    ? Math.round(targetReviews.reduce((sum, review) => sum + review.rating, 0) / reviewCount)
    : 5;

  if (targetType === "stay") {
    await storage.updateStay(targetId, { rating, reviewCount });
    return;
  }

  if (targetType === "car") {
    await storage.updateCar(targetId, { rating, reviewCount });
    return;
  }

  if (targetType === "cook") {
    await storage.updateCook(targetId, { rating, reviewCount });
    return;
  }

  if (targetType === "errand") {
    await storage.updateErrand(targetId, { rating, reviewCount });
    return;
  }

  if (targetType === "experience") {
    await storage.updateExperience(targetId, { rating, reviewCount });
  }
}

function getReviewTargetsForBooking(booking: any) {
  const targets: Array<{ targetType: "stay" | "car" | "cook" | "errand" | "experience"; targetId: string }> = [];
  if (booking.accommodationId) {
    targets.push({ targetType: "stay", targetId: booking.accommodationId });
  }

  for (const selectedServiceId of booking.selectedServices ?? []) {
    targets.push({ targetType: "errand", targetId: selectedServiceId });
  }

  return targets;
}

function getPublicSiteBaseUrl() {
  return (process.env.APP_BASE_URL?.trim() || "https://tembeabilamatata.com").replace(/\/+$/, "");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toIsoDateTime(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sitemapEntry(params: {
  baseUrl: string;
  path: string;
  changefreq: "daily" | "weekly" | "monthly";
  priority: string;
  lastmod?: string | null;
}) {
  const normalizedPath = params.path.startsWith("/") ? params.path : `/${params.path}`;
  const lastmod = toIsoDateTime(params.lastmod);
  return [
    "  <url>",
    `    <loc>${escapeXml(`${params.baseUrl}${normalizedPath}`)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    `    <changefreq>${params.changefreq}</changefreq>`,
    `    <priority>${params.priority}</priority>`,
    "  </url>",
  ].filter(Boolean).join("\n");
}

function isPublicManagedItem(item: { isPublic?: boolean | null; managerUserId?: string | null }) {
  return Boolean(item.isPublic && item.managerUserId?.trim());
}

async function buildSitemapXml() {
  const baseUrl = getPublicSiteBaseUrl();
  const now = new Date().toISOString();
  const staticEntries = [
    sitemapEntry({ baseUrl, path: "/", changefreq: "daily", priority: "1.0", lastmod: now }),
    sitemapEntry({ baseUrl, path: "/accommodations", changefreq: "weekly", priority: "0.9", lastmod: now }),
    sitemapEntry({ baseUrl, path: "/services/drive", changefreq: "weekly", priority: "0.8", lastmod: now }),
    sitemapEntry({ baseUrl, path: "/services/dine", changefreq: "weekly", priority: "0.8", lastmod: now }),
    sitemapEntry({ baseUrl, path: "/services/relax", changefreq: "weekly", priority: "0.8", lastmod: now }),
    sitemapEntry({ baseUrl, path: "/services/experience", changefreq: "weekly", priority: "0.8", lastmod: now }),
    sitemapEntry({ baseUrl, path: "/blog", changefreq: "daily", priority: "0.9", lastmod: now }),
    sitemapEntry({ baseUrl, path: "/about", changefreq: "monthly", priority: "0.5", lastmod: now }),
    sitemapEntry({ baseUrl, path: "/contact", changefreq: "monthly", priority: "0.5", lastmod: now }),
    sitemapEntry({ baseUrl, path: "/faq", changefreq: "monthly", priority: "0.5", lastmod: now }),
  ];

  const [posts, stays, cars, cooks, errands, experiences] = await Promise.all([
    storage.getPublishedBlogPosts(),
    storage.getStays(),
    storage.getCars(),
    storage.getCooks(),
    storage.getErrands(),
    storage.getExperiences(),
  ]);

  const blogEntries = posts.map((post) => sitemapEntry({
    baseUrl,
    path: `/blog/${post.slug}`,
    changefreq: "weekly",
    priority: "0.85",
    lastmod: post.updatedAt ?? post.publishedAt,
  }));

  const listingEntries = [
    ...stays
      .filter(isPublicManagedItem)
      .map((stay) => sitemapEntry({
        baseUrl,
        path: `/accommodation/${stay.id}`,
        changefreq: "weekly",
        priority: "0.8",
        lastmod: stay.updatedAt,
      })),
    ...cars
      .filter(isPublicManagedItem)
      .map((car) => sitemapEntry({
        baseUrl,
        path: `/book/car/${car.id}`,
        changefreq: "weekly",
        priority: "0.7",
        lastmod: car.updatedAt,
      })),
    ...cooks
      .filter(isPublicManagedItem)
      .map((cook) => sitemapEntry({
        baseUrl,
        path: `/book/cook/${cook.id}`,
        changefreq: "weekly",
        priority: "0.7",
        lastmod: cook.updatedAt,
      })),
    ...errands
      .filter(isPublicManagedItem)
      .map((errand) => sitemapEntry({
        baseUrl,
        path: `/book/errand/${errand.id}`,
        changefreq: "weekly",
        priority: "0.7",
        lastmod: errand.updatedAt,
      })),
    ...experiences
      .filter(isPublicManagedItem)
      .map((experience) => sitemapEntry({
        baseUrl,
        path: `/book/experience/${experience.id}`,
        changefreq: "weekly",
        priority: "0.7",
        lastmod: experience.updatedAt,
      })),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...staticEntries,
    ...blogEntries,
    ...listingEntries,
    "</urlset>",
    "",
  ].join("\n");
}

export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);
  registerAuthRoutes(app);

  app.get("/robots.txt", (_req, res) => {
    const baseUrl = getPublicSiteBaseUrl();
    res
      .type("text/plain")
      .send([
        "User-agent: *",
        "Allow: /",
        "Allow: /api/blog",
        "Allow: /api/stays",
        "Allow: /api/cars",
        "Allow: /api/cooks",
        "Allow: /api/errands",
        "Allow: /api/experiences",
        "Allow: /api/reviews",
        "Disallow: /admin/",
        "Disallow: /provider/",
        "Disallow: /auth",
        "Disallow: /api/",
        "",
        `Sitemap: ${baseUrl}/sitemap.xml`,
        "",
      ].join("\n"));
  });

  app.get("/sitemap.xml", async (_req, res) => {
    try {
      res
        .type("application/xml")
        .set("Cache-Control", "public, max-age=900")
        .send(await buildSitemapXml());
    } catch (error) {
      console.error("[SEO] Failed to build sitemap:", error);
      res.status(500).type("text/plain").send("Failed to build sitemap");
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/currency/rates", async (_req, res) => {
    try {
      const rate = await getUsdToKesRate();
      res.json({
        baseCurrency: "USD",
        displayCurrencies: ["USD", "KES"],
        usdToKes: rate.usdToKes,
        fetchedAt: rate.fetchedAt,
        source: rate.source,
        isFallback: rate.isFallback,
      });
    } catch (error) {
      console.error("[CURRENCY] Failed to provide exchange rates:", error);
      res.status(500).json({ error: "Failed to fetch currency rates" });
    }
  });

  app.post("/api/admin/media", requireProviderOrAdmin, async (req, res) => {
    try {
      const { dataUrl, mimeType } = req.body ?? {};
      if (typeof dataUrl !== "string" || typeof mimeType !== "string") {
        return res.status(400).json({ error: "Media payload is required" });
      }

      const isSupported = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "video/mp4",
        "video/webm",
        "video/quicktime",
      ].includes(mimeType);

      if (!isSupported) {
        return res.status(400).json({ error: "Unsupported media type" });
      }

      const mediaUrl = await saveBase64Upload(dataUrl, mimeType);
      const mediaType = mimeType.startsWith("video/") ? "video" : "image";

      res.status(201).json({ mediaUrl, mediaType });
    } catch (error) {
      console.error("[MEDIA] Upload failed:", error);
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to upload media",
      });
    }
  });

  app.post("/api/custom-service-requests/upload", isAuthenticated, async (req: any, res) => {
    try {
      const { dataUrl, mimeType } = req.body ?? {};
      if (typeof dataUrl !== "string" || typeof mimeType !== "string") {
        return res.status(400).json({ error: "Media payload is required" });
      }

      const isSupported = ["image/jpeg", "image/png", "image/webp"].includes(mimeType);
      if (!isSupported) {
        return res.status(400).json({ error: "Only JPG, PNG, and WEBP files are supported." });
      }

      const mediaUrl = await saveBase64Upload(dataUrl, mimeType);
      res.status(201).json({ mediaUrl });
    } catch (error) {
      console.error("[CUSTOM_SERVICE] Upload failed:", error);
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to upload file",
      });
    }
  });

  app.post("/api/custom-service-requests", isAuthenticated, async (req: any, res) => {
    try {
      const payload = customServiceRequestSchema.parse(req.body ?? {});
      normalizeDateOnly(payload.preferredDate);

      const accountUser = await storage.getUser(req.user.claims.sub);
      const firstName = typeof req.user?.claims?.first_name === "string" ? req.user.claims.first_name.trim() : "";
      const lastName = typeof req.user?.claims?.last_name === "string" ? req.user.claims.last_name.trim() : "";
      const guestName = [firstName, lastName].filter(Boolean).join(" ") || "Tembea Guest";
      const guestEmail = typeof req.user?.claims?.email === "string" ? req.user.claims.email : "";
      const guestPhone = accountUser?.phone || undefined;
      if (!guestEmail) {
        return res.status(400).json({ error: "User email not found in session." });
      }

      const hasExplicitBudget =
        typeof payload.budgetAmount === "number" &&
        Number.isFinite(payload.budgetAmount) &&
        payload.budgetAmount > 0 &&
        !!payload.budgetCurrency;

      const details = [
        `Custom request type: ${payload.serviceCategory}`,
        `Request details: ${payload.description.trim()}`,
        `Contact email: ${guestEmail}`,
        guestPhone ? `Contact phone: ${guestPhone}` : null,
        payload.preferredTime ? `Preferred time: ${payload.preferredTime}` : null,
        payload.location?.trim() ? `Preferred location: ${payload.location.trim()}` : null,
        payload.peopleCount ? `People: ${payload.peopleCount}` : null,
        hasExplicitBudget ? `Budget entered: ${formatEnteredBudget(payload.budgetAmount!, payload.budgetCurrency!)}` : null,
        payload.listDetails?.trim() ? `List details: ${payload.listDetails.trim()}` : null,
        payload.attachmentUrl?.trim() ? `Attachment: ${payload.attachmentUrl.trim()}` : null,
      ].filter(Boolean).join("\n");

      const bookingInput = serverBookingSchema.parse({
        userId: req.user.claims.sub,
        bookingType: "service",
        accommodationId: null,
        guestName,
        guestEmail,
        guestPhone,
        checkIn: payload.preferredDate,
        checkOut: payload.preferredDate,
        guests: payload.peopleCount ?? 1,
        selectedServices: [],
        serviceMode: "experience-custom-offer",
        serviceLocation: payload.location?.trim() || undefined,
        serviceStartTime: payload.preferredTime || undefined,
        serviceBudgetAmount: payload.budgetUsd ? Math.round(payload.budgetUsd) : undefined,
        serviceRequestFee: customServiceRequestFeeUsd,
        serviceRequestFeeKes: undefined,
        serviceRequestDetails: details,
        serviceAddonSelections: [],
        serviceScheduleSlots: [],
        serviceDepartureId: undefined,
        experienceCustomOfferStatus: "pending",
        experienceCustomOfferAmount: undefined,
        experienceCustomOfferMessage: undefined,
        experienceCustomOfferDeclineReason: undefined,
        experienceCustomOfferClientDecision: "pending",
        experienceCustomOfferClientRespondedAt: undefined,
        experienceCustomOfferReviewedByUserId: undefined,
        experienceCustomOfferReviewedAt: undefined,
        totalPrice: customServiceRequestFeeUsd,
      });

      const booking = await storage.createBooking({
        ...bookingInput,
        paymentStatus: bookingInput.totalPrice > 0 ? "pending" : "paid",
        paymentCurrency: "USD",
        paymentCheckoutAmount: null,
        paymentAmountPaid: 0,
      });
      queueNotificationTask(
        `booking created emails for custom request ${booking.id}`,
        sendBookingCreatedNotificationEmails(booking, req),
      );
      await storage.syncBookingServiceAssignments({ bookingIds: [booking.id], notifyProviders: true });
      return res.status(201).json(booking);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to create custom service request" });
    }
  });

  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.patch("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const currentUser = await storage.getUser(userId);
      if (!currentUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const validatedData = customerProfileUpdateSchema.parse(req.body);
      const normalizedPhone = validatedData.phone.replace(/[^\d+]/g, "");
      const [existingUserWithPhone] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.phone, normalizedPhone), ne(users.id, userId)))
        .limit(1);

      if (existingUserWithPhone) {
        return res.status(409).json({ message: "That phone number is already in use by another account." });
      }

      const updatedUser = await storage.updateUser(userId, {
        firstName: validatedData.firstName,
        lastName: validatedData.lastName,
        phone: normalizedPhone,
      });

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(updatedUser);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Accommodations
  app.get("/api/accommodations", async (_req, res) => {
    try {
      const accommodations = await storage.getAccommodations();
      res.json(accommodations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch accommodations" });
    }
  });

  app.get("/api/accommodations/:id", async (req, res) => {
    try {
      const accommodation = await storage.getAccommodation(req.params.id);
      if (!accommodation) {
        return res.status(404).json({ error: "Accommodation not found" });
      }
      res.json(accommodation);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch accommodation" });
    }
  });

  // Services
  app.get("/api/services", async (_req, res) => {
    try {
      const services = await storage.getServices();
      res.json(services);
    } catch (error) {
      logPublicFetchFailure("services", error);
      res.status(500).json({ error: "Failed to fetch services" });
    }
  });

  app.get("/api/services/:id", async (req, res) => {
    try {
      const service = await storage.getService(req.params.id);
      if (!service) {
        return res.status(404).json({ error: "Service not found" });
      }
      res.json(service);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch service" });
    }
  });

  // Providers
  app.get("/api/providers", async (req, res) => {
    try {
      const { serviceType } = req.query;
      
      if (serviceType && typeof serviceType === "string") {
        const providers = await storage.getProvidersByServiceType(serviceType);
        return res.json(providers);
      }
      
      const providers = await storage.getProviders();
      res.json(providers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch providers" });
    }
  });

  app.get("/api/providers/:id", async (req, res) => {
    try {
      const provider = await storage.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }
      res.json(provider);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider" });
    }
  });

  // Bookings
  app.get("/api/bookings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const bookings = await storage.getBookingsByUserId(userId);
      res.json(await attachBookingMarketingAttributions(bookings.map(decorateBookingWithOperationalStatus)));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  });

  app.get("/api/bookings/:id", isAuthenticated, async (req: any, res) => {
    try {
      const access = await assertCanAccessBookingThread(req, req.params.id);
      if ("error" in access) {
        const error = access.error!;
        return res.status(error.status).json(error.body);
      }

      res.json(await attachBookingMarketingAttribution(decorateBookingWithOperationalStatus(access.booking)));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch booking" });
    }
  });

  app.patch("/api/bookings/:id/custom-menu-decision", isAuthenticated, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking || booking.userId !== req.user.claims.sub) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (!isCustomMenuBooking(booking)) {
        return res.status(400).json({ error: "Only custom menu requests can be updated here." });
      }

      if (booking.customMenuProposalStatus !== "proposed") {
        return res.status(400).json({ error: "This custom menu request is not ready for a client decision yet." });
      }

      const action = req.body?.action;
      const now = new Date().toISOString();
      const requestFeeUsd = getRequestFeeUsd(booking);

      if (action === "accept") {
        const quotedTotal = booking.customMenuProposedAmount ?? 0;
        if (quotedTotal <= 0) {
          return res.status(400).json({ error: "The proposal total is missing." });
        }
        const remainingBalance = Math.max(0, quotedTotal - requestFeeUsd);

        const updated = await storage.updateBooking(req.params.id, {
          customMenuClientDecision: "accepted",
          customMenuClientRespondedAt: now,
          totalPrice: remainingBalance,
          customMenuCreditCode: null,
          customMenuCreditAmount: requestFeeUsd || null,
          paymentStatus: remainingBalance > 0 ? "pending" : "paid",
          paymentProvider: null,
          paymentReference: null,
          paymentSessionId: null,
          paymentCurrency: "USD",
          paymentAmount: remainingBalance > 0 ? remainingBalance : 0,
          paymentCheckoutAmount: null,
          paymentAmountPaid: 0,
          paymentDepositAmount: null,
          paymentHoldExpiresAt: null,
          paidAt: remainingBalance > 0 ? null : now,
          paymentFailedAt: null,
          status: "upcoming",
        });
        return res.json(updated);
      }

      if (action === "decline") {
        const creditCode = booking.customMenuCreditCode || buildCustomMenuCreditCode(booking.id);
        const updated = await storage.updateBooking(req.params.id, {
          customMenuClientDecision: "declined",
          customMenuClientRespondedAt: now,
          customMenuCreditCode: creditCode,
          customMenuCreditAmount: requestFeeUsd || null,
          status: "completed",
        });
        return res.json(updated);
      }

      return res.status(400).json({ error: "Invalid custom menu action." });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to update custom menu request" });
    }
  });

  app.patch("/api/bookings/:id/experience-custom-offer-decision", isAuthenticated, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking || booking.userId !== req.user.claims.sub) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (!isExperienceCustomOfferBooking(booking)) {
        return res.status(400).json({ error: "Only experience custom offers can be updated here." });
      }

      if (booking.experienceCustomOfferStatus !== "proposed") {
        return res.status(400).json({ error: "This custom offer is not ready for a client decision yet." });
      }

      const action = req.body?.action;
      const now = new Date().toISOString();

      if (action === "accept") {
        const quotedTotal = booking.experienceCustomOfferAmount ?? 0;
        if (quotedTotal <= 0) {
          return res.status(400).json({ error: "The offer amount is missing." });
        }
        const creditedRequestFee = getRequestFeeUsd(booking);
        const remainingBalance = Math.max(0, quotedTotal - creditedRequestFee);

        const updated = await storage.updateBooking(req.params.id, {
          experienceCustomOfferClientDecision: "accepted",
          experienceCustomOfferClientRespondedAt: now,
          totalPrice: remainingBalance,
          paymentStatus: remainingBalance > 0 ? "pending" : "paid",
          paymentProvider: null,
          paymentReference: null,
          paymentSessionId: null,
          paymentCurrency: "USD",
          paymentAmount: remainingBalance > 0 ? remainingBalance : 0,
          paymentCheckoutAmount: null,
          paymentAmountPaid: 0,
          paymentDepositAmount: null,
          paymentHoldExpiresAt: null,
          paidAt: remainingBalance > 0 ? null : now,
          paymentFailedAt: null,
          status: "upcoming",
        });
        return res.json(updated);
      }

      if (action === "decline") {
        const updated = await storage.updateBooking(req.params.id, {
          experienceCustomOfferClientDecision: "declined",
          experienceCustomOfferClientRespondedAt: now,
          status: "completed",
        });
        return res.json(updated);
      }

      return res.status(400).json({ error: "Invalid custom offer action." });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to update custom offer" });
    }
  });

  app.post("/api/bookings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const guestEmail = req.user.claims.email;
      
      // Validate that we have the required session data
      if (!guestEmail) {
        return res.status(400).json({ error: "User email not found in session" });
      }
      
      const publicBookingData = publicBookingRequestSchema.parse(req.body ?? {});
      const validatedData = buildServerManagedBookingInput(publicBookingData, userId, guestEmail);
      const parsedAttribution = marketingAttributionPayloadSchema.safeParse(req.body?.marketingAttribution);
      const marketingAttribution = parsedAttribution.success ? parsedAttribution.data : null;
      const requestedPromoCode = typeof req.body?.promoCode === "string" ? req.body.promoCode : null;

      if (validatedData.bookingType === "service" && validatedData.selectedServices.length === 0) {
        return res.status(400).json({ error: "Choose a valid service before creating a booking." });
      }

      if (validatedData.serviceMode?.startsWith("errand-")) {
        const sortedSlots = getSortedServiceScheduleSlots(validatedData.serviceScheduleSlots);
        if (!sortedSlots.length) {
          return res.status(400).json({ error: "Please add at least one errand package date." });
        }

        validatedData.serviceScheduleSlots = sortedSlots;
        validatedData.checkIn = sortedSlots[0].date;
        validatedData.checkOut = sortedSlots[sortedSlots.length - 1].date;
        validatedData.guests = 1;
      }

      assertBookingDatesAreBookable({
        checkIn: validatedData.checkIn,
        checkOut: validatedData.checkOut,
        serviceScheduleSlots: validatedData.serviceScheduleSlots,
      });

      if (validatedData.bookingType !== "service" && validatedData.accommodationId) {
        const stay = await storage.getStay(validatedData.accommodationId);
        if (!stay || !stay.isPublic) {
          return res.status(404).json({ error: "Stay not found" });
        }
        if (!hasAssignedManagerUserId(stay.managerUserId)) {
          return res.status(409).json({ error: getUnavailableBookingMessage(stay.title) });
        }

        if (validatedData.guests > stay.maxOccupancy) {
          return res.status(400).json({
            error: `This stay allows a maximum of ${stay.maxOccupancy} guest${stay.maxOccupancy === 1 ? "" : "s"}.`,
          });
        }

        const activeBookings = await storage.getBookingsByAccommodationId(validatedData.accommodationId);
        const manualReservations = await storage.getStayReservations(validatedData.accommodationId);
        const bookingEndDate = toIsoDate(getOccupiedEndDate(validatedData.checkIn, validatedData.checkOut));

        const bookingOverlapRanges = activeBookings
          .filter((booking) =>
            shouldBookingBlockAvailability(booking) &&
            datesOverlapDateRange(
              validatedData.checkIn,
              bookingEndDate,
              booking.checkIn,
              toIsoDate(getOccupiedEndDate(booking.checkIn, booking.checkOut)),
            ),
          )
          .map((booking) => ({
            startDate: booking.checkIn,
            endDate: toIsoDate(getOccupiedEndDate(booking.checkIn, booking.checkOut)),
          }));

        const manualBlockOverlapRanges = manualReservations
          .filter((reservation) =>
            reservation.status === "blocked" &&
            datesOverlapDateRange(
              validatedData.checkIn,
              bookingEndDate,
              reservation.startDate,
              reservation.endDate,
            ),
          )
          .map((reservation) => ({
            startDate: reservation.startDate,
            endDate: reservation.endDate,
          }));

        const stayConflictWindow = getReservedConflictWindow(
          [
            ...activeBookings
              .filter((booking) => shouldBookingBlockAvailability(booking))
              .map((booking) => ({
                startDate: booking.checkIn,
                endDate: toIsoDate(getOccupiedEndDate(booking.checkIn, booking.checkOut)),
              })),
            ...manualReservations
              .filter((reservation) => reservation.status === "blocked")
              .map((reservation) => ({
                startDate: reservation.startDate,
                endDate: reservation.endDate,
              })),
          ],
          validatedData.checkIn,
          bookingEndDate,
        );

        const hasBookingOverlap = bookingOverlapRanges.length > 0;
        const hasManualBlockOverlap = manualBlockOverlapRanges.length > 0;

        if (hasBookingOverlap || hasManualBlockOverlap) {
          return res.status(409).json({
            error: stayConflictWindow
              ? buildReservedConflictMessage("This stay", stayConflictWindow)
              : "Those dates are reserved. Please choose different dates.",
          });
        }

        const occupiedDays = calculateChargeableDays(validatedData.checkIn, validatedData.checkOut);
        const accommodationTotal = occupiedDays * stay.price;
        const addonSelection = await validateAccommodationAddonSelections({
          selectedServiceIds: validatedData.selectedServices || [],
          stayServiceSelections: validatedData.stayServiceSelections || [],
          guests: validatedData.guests,
          checkIn: validatedData.checkIn,
          checkOut: validatedData.checkOut,
        });

        validatedData.selectedServices = addonSelection.selectedServices;
        validatedData.stayServiceSelections = addonSelection.stayServiceSelections;
        validatedData.serviceMode = null;
        validatedData.serviceHours = null;
        validatedData.serviceLocation = null;
        validatedData.servicePickupLocation = null;
        validatedData.serviceReturnLocation = null;
        validatedData.serviceZone = null;
        validatedData.serviceStartTime = null;
        validatedData.serviceEndTime = null;
        validatedData.serviceBudgetAmount = null;
        validatedData.serviceLaundryWeightKg = null;
        validatedData.serviceAddonSelections = [];
        validatedData.serviceScheduleSlots = [];
        validatedData.serviceDepartureId = null;
        validatedData.serviceRequestFee = null;
        validatedData.serviceRequestDetails = null;
        validatedData.serviceResponseMessage = null;
        validatedData.serviceRequestFeeKes = null;
        validatedData.customMenuProposalStatus = "pending";
        validatedData.customMenuProposedAmount = null;
        validatedData.customMenuProposalMessage = null;
        validatedData.customMenuDeclineReason = null;
        validatedData.customMenuClientDecision = "pending";
        validatedData.customMenuClientRespondedAt = null;
        validatedData.customMenuCreditCode = null;
        validatedData.customMenuCreditAmount = null;
        validatedData.customMenuReviewedByUserId = null;
        validatedData.customMenuReviewedAt = null;
        validatedData.experienceCustomOfferStatus = "pending";
        validatedData.experienceCustomOfferAmount = null;
        validatedData.experienceCustomOfferMessage = null;
        validatedData.experienceCustomOfferDeclineReason = null;
        validatedData.experienceCustomOfferClientDecision = "pending";
        validatedData.experienceCustomOfferClientRespondedAt = null;
        validatedData.experienceCustomOfferReviewedByUserId = null;
        validatedData.experienceCustomOfferReviewedAt = null;
        validatedData.totalPrice = accommodationTotal + addonSelection.addonTotal;
      }

      if (validatedData.bookingType === "service" && validatedData.selectedServices.length > 0) {
        const selectedCarId = validatedData.selectedServices[0];
        const car = await storage.getCar(selectedCarId);

        if (car) {
          if (!car.isPublic) {
            return res.status(404).json({ error: "Car not found" });
          }
          if (!hasAssignedManagerUserId(car.managerUserId)) {
            return res.status(409).json({ error: getUnavailableBookingMessage(car.model) });
          }

          const serviceMode = validatedData.serviceMode;
          if (!["car-chauffeur-day", "car-chauffeur-hourly", "car-self-drive-day"].includes(serviceMode ?? "")) {
            return res.status(400).json({ error: "Choose a valid car booking option." });
          }

          if (!validatedData.servicePickupLocation?.trim() || !validatedData.serviceReturnLocation?.trim()) {
            return res.status(400).json({ error: "Pickup and drop-off locations are required for car bookings." });
          }

          if (validatedData.guests > car.seats) {
            return res.status(400).json({
              error: `This car allows a maximum of ${car.seats} passenger${car.seats === 1 ? "" : "s"}.`,
            });
          }

          if (serviceMode === "car-self-drive-day" && !car.pricePerDay) {
            return res.status(400).json({ error: "Self-drive is not available for this car." });
          }

          const selectedZone = validatedData.serviceZone
            ? car.chauffeurZones.find((zone) => zone.name === validatedData.serviceZone)
            : undefined;

          if (validatedData.serviceZone && !selectedZone) {
            return res.status(400).json({ error: "Selected chauffeur zone is no longer available." });
          }

          if (serviceMode === "car-chauffeur-hourly") {
            if (!car.priceWithDriverHourly) {
              return res.status(400).json({ error: "Hourly chauffeur booking is not available for this car." });
            }

            if (validatedData.checkIn !== validatedData.checkOut) {
              return res.status(400).json({ error: "Hourly chauffeur bookings must start and end on the same day." });
            }

            if (!validatedData.serviceStartTime || !validatedData.serviceEndTime) {
              return res.status(400).json({ error: "Hourly chauffeur bookings require a start and end time." });
            }

            const startMinutes = parseTimeToMinutes(validatedData.serviceStartTime);
            const endMinutes = parseTimeToMinutes(validatedData.serviceEndTime);
            if (endMinutes <= startMinutes) {
              return res.status(400).json({ error: "Service end time must be after the start time." });
            }

            const durationHours = (endMinutes - startMinutes) / 60;
            if (durationHours < 3) {
              return res.status(400).json({ error: "Hourly chauffeur bookings require at least 3 hours." });
            }

            validatedData.serviceHours = Math.ceil(durationHours);
          }

          const carAvailability = await getCarAvailabilitySummary(car.id);
          const requestedEndDate = serviceMode === "car-chauffeur-hourly"
            ? validatedData.checkIn
            : toIsoDate(getOccupiedEndDate(validatedData.checkIn, validatedData.checkOut));

          const carConflictWindow = getReservedConflictWindow(
            carAvailability.blockedRanges,
            validatedData.checkIn,
            requestedEndDate,
          );

          if (carConflictWindow) {
            return res.status(409).json({
              error: buildReservedConflictMessage("This car", carConflictWindow),
            });
          }

          let expectedTotalPrice = 0;
          if (serviceMode === "car-chauffeur-hourly") {
            expectedTotalPrice = validatedData.serviceHours! * (selectedZone?.hourlyPrice || car.priceWithDriverHourly!);
          } else {
            const occupiedDays = calculateChargeableDays(validatedData.checkIn, validatedData.checkOut);
            expectedTotalPrice = occupiedDays * (
              serviceMode === "car-self-drive-day"
                ? selectedZone?.selfDrivePrice || car.pricePerDay!
                : selectedZone?.dailyPrice || car.priceWithDriver
            );
          }

          validatedData.totalPrice = expectedTotalPrice;
        } else {
          const cook = await storage.getCook(selectedCarId);

          if (cook) {
            if (!cook.isPublic) {
              return res.status(404).json({ error: "Chef not found" });
            }
            if (!hasAssignedManagerUserId(cook.managerUserId)) {
              return res.status(409).json({ error: getUnavailableBookingMessage(cook.title) });
            }

            const serviceMode = validatedData.serviceMode;
            if (!["cook-service-fee", "cook-inclusive", "cook-custom-menu"].includes(serviceMode ?? "")) {
              return res.status(400).json({ error: "Choose a valid chef booking option." });
            }

            if (!validatedData.serviceLocation?.trim()) {
              return res.status(400).json({ error: "Service location is required for chef bookings." });
            }

            const minimumGuests = getCookMinimumGuests(cook);

            if (validatedData.guests < minimumGuests) {
              return res.status(400).json({
                error: `This chef package starts from ${minimumGuests} guest${minimumGuests === 1 ? "" : "s"}.`,
              });
            }

            if (normalizeDateOnly(validatedData.checkOut).getTime() < normalizeDateOnly(validatedData.checkIn).getTime()) {
              return res.status(400).json({ error: "End date cannot be before start date." });
            }

            const cookAvailability = await getCookAvailabilitySummary(cook.id);
            const requestedEndDate = toIsoDate(getOccupiedEndDate(validatedData.checkIn, validatedData.checkOut));
            const hasCookOverlap = cookAvailability.blockedRanges.some((range) =>
              datesOverlapDateRange(
                validatedData.checkIn,
                requestedEndDate,
                range.startDate,
                range.endDate,
              ),
            );

            if (hasCookOverlap) {
              return res.status(409).json({
                error: `This chef is not available for those dates. Next available date is ${cookAvailability.availableFrom}.`,
              });
            }

            const occupiedDays = calculateChargeableDays(validatedData.checkIn, validatedData.checkOut);
            const serviceFee = calculateCookServiceTotal(cook, validatedData.guests, occupiedDays);
            const inclusivePrice = calculateCookInclusiveTotal(cook, validatedData.guests, occupiedDays);

            if (serviceMode === "cook-custom-menu") {
              if (!cook.customMenuEnabled) {
                return res.status(400).json({ error: "Custom menu requests are not available for this chef." });
              }

              if (!validatedData.serviceRequestDetails?.trim() || validatedData.serviceRequestDetails.trim().length < 20) {
                return res.status(400).json({ error: "Please share more detail for the custom menu request." });
              }

              validatedData.serviceRequestDetails = validatedData.serviceRequestDetails.trim();

              const rate = await getUsdToKesRate();
              const requestFeeUsd = cook.customMenuRequestFee
                || (cook.customMenuRequestFeeKes ? convertKesRequestFeeToUsd(cook.customMenuRequestFeeKes, rate.usdToKes) : 4);
              validatedData.serviceRequestFee = requestFeeUsd;
              validatedData.serviceRequestFeeKes = null;
              validatedData.customMenuProposalStatus = "pending";
              validatedData.customMenuProposedAmount = null;
              validatedData.customMenuProposalMessage = null;
              validatedData.customMenuDeclineReason = null;
              validatedData.customMenuClientDecision = "pending";
              validatedData.customMenuClientRespondedAt = null;
              validatedData.customMenuCreditCode = null;
              validatedData.customMenuCreditAmount = null;
              validatedData.customMenuReviewedByUserId = null;
              validatedData.customMenuReviewedAt = null;
              validatedData.totalPrice = requestFeeUsd;
            } else {
              validatedData.serviceRequestDetails = null;
              validatedData.serviceRequestFee = null;
              validatedData.serviceRequestFeeKes = null;
              validatedData.customMenuProposalStatus = "pending";
              validatedData.customMenuProposedAmount = null;
              validatedData.customMenuProposalMessage = null;
              validatedData.customMenuDeclineReason = null;
              validatedData.customMenuClientDecision = "pending";
              validatedData.customMenuClientRespondedAt = null;
              validatedData.customMenuCreditCode = null;
              validatedData.customMenuCreditAmount = null;
              validatedData.customMenuReviewedByUserId = null;
              validatedData.customMenuReviewedAt = null;
              validatedData.totalPrice = serviceMode === "cook-inclusive" ? inclusivePrice : serviceFee;
            }
          } else {
            const errand = await storage.getErrand(selectedCarId);

            if (errand) {
              if (!errand.isPublic) {
                return res.status(404).json({ error: "Errand service not found" });
              }
              if (!hasAssignedManagerUserId(errand.managerUserId)) {
                return res.status(409).json({ error: getUnavailableBookingMessage(errand.serviceName) });
              }

              const serviceMode = validatedData.serviceMode;
              if (!["errand-base", "errand-shopping", "errand-laundry", "errand-house-cleaning", "errand-childcare"].includes(serviceMode ?? "")) {
                return res.status(400).json({ error: "Choose a valid errand booking option." });
              }

              if (!validatedData.serviceLocation?.trim()) {
                return res.status(400).json({ error: "Service location is required for errand bookings." });
              }

              const packageCount = Math.max(1, (validatedData.serviceScheduleSlots || []).length);
              let packagePrice = errand.basePrice;

              if (serviceMode === "errand-shopping") {
                if (!errand.shoppingEnabled) {
                  return res.status(400).json({ error: "Shopping pricing is not available for this errand." });
                }

                const budgetAmount = validatedData.serviceBudgetAmount || 0;
                if (budgetAmount <= 0) {
                  return res.status(400).json({ error: "Shopping budget is required." });
                }

                packagePrice = errand.basePrice + budgetAmount + Math.ceil((budgetAmount * (errand.shoppingCommissionPercent || 10)) / 100);
              } else if (serviceMode === "errand-laundry") {
                if (!errand.laundryEnabled) {
                  return res.status(400).json({ error: "Laundry pricing is not available for this errand." });
                }
                const selectedAddons = (validatedData.serviceAddonSelections || []).filter((addonId) =>
                  (errand.laundryAddons || []).some((addon) => addon.id === addonId),
                );
                const addonTotal = (errand.laundryAddons || [])
                  .filter((addon) => selectedAddons.includes(addon.id))
                  .reduce((sum, addon) => sum + addon.price, 0);
                validatedData.serviceAddonSelections = selectedAddons;
                packagePrice = errand.basePrice + addonTotal;
              } else if (serviceMode === "errand-house-cleaning") {
                if (!errand.houseCleaningEnabled) {
                  return res.status(400).json({ error: "House cleaning is not available for this errand." });
                }
                const selectedAddons = (validatedData.serviceAddonSelections || []).filter((addonId) =>
                  (errand.houseCleaningAddons || []).some((addon) => addon.id === addonId),
                );
                const addonTotal = (errand.houseCleaningAddons || [])
                  .filter((addon) => selectedAddons.includes(addon.id))
                  .reduce((sum, addon) => sum + addon.price, 0);
                validatedData.serviceAddonSelections = selectedAddons;
                packagePrice = errand.basePrice + addonTotal;
              } else if (serviceMode === "errand-childcare") {
                if (!validatedData.serviceRequestDetails?.trim() || validatedData.serviceRequestDetails.trim().length < 20) {
                  return res.status(400).json({ error: "Share the child ages, care needs, timing, and any safety notes." });
                }
                if (hasHelpMamaPricing(errand)) {
                  const selectedRateId = getHelpMamaRateId(validatedData.serviceAddonSelections);
                  const selectedAgeBandId = getHelpMamaAgeBandId(validatedData.serviceAddonSelections, errand.helpMamaPricing);
                  if (!selectedAgeBandId) {
                    return res.status(400).json({ error: "Choose a Help Mama age band." });
                  }
                  if (!selectedRateId) {
                    return res.status(400).json({ error: "Choose a Help Mama time rate." });
                  }
                  if (isHelpMamaHourlyRate(selectedRateId) && (!validatedData.serviceHours || validatedData.serviceHours < HELP_MAMA_HOURLY_MINIMUM_HOURS)) {
                    return res.status(400).json({ error: `Hourly Mama Care bookings require at least ${HELP_MAMA_HOURLY_MINIMUM_HOURS} hours.` });
                  }
                  packagePrice = calculateHelpMamaPackagePrice(errand, validatedData.serviceAddonSelections, validatedData.serviceHours);
                }
                validatedData.serviceRequestDetails = validatedData.serviceRequestDetails.trim();
              }

              validatedData.totalPrice = packagePrice * packageCount;
            } else {
              const experience = await storage.getExperience(selectedCarId);

              if (experience) {
                if (!experience.isPublic) {
                  return res.status(404).json({ error: "Experience not found" });
                }
                if (!hasAssignedManagerUserId(experience.managerUserId)) {
                  return res.status(409).json({ error: getUnavailableBookingMessage(experience.title) });
                }

                const serviceMode = validatedData.serviceMode;
                if (!["experience-private", "experience-shared", "experience-custom-offer"].includes(serviceMode ?? "")) {
                  return res.status(400).json({ error: "Choose a valid experience booking option." });
                }

                if (serviceMode === "experience-private") {
                  if (!experience.privateEnabled) {
                    return res.status(400).json({ error: "Private booking is not available for this experience." });
                  }

                  if (validatedData.guests < experience.privateMinimumGuests) {
                    return res.status(400).json({
                      error: `Private bookings start from ${experience.privateMinimumGuests} guest${experience.privateMinimumGuests === 1 ? "" : "s"}.`,
                    });
                  }

                  if (validatedData.guests > experience.maxGuests) {
                    return res.status(400).json({
                      error: `This experience allows up to ${experience.maxGuests} guest${experience.maxGuests === 1 ? "" : "s"}.`,
                    });
                  }

                  const selectedAddons = (validatedData.serviceAddonSelections || []).filter((addonId) =>
                    (experience.privateAddons || []).some((addon) => addon.id === addonId),
                  );
                  const addonTotal = (experience.privateAddons || [])
                    .filter((addon) => selectedAddons.includes(addon.id))
                    .reduce((sum, addon) => sum + addon.price, 0);

                  validatedData.serviceAddonSelections = selectedAddons;
                  validatedData.serviceDepartureId = null;
                  validatedData.checkOut = validatedData.checkIn;
                  validatedData.totalPrice = (experience.privatePricePerPerson || experience.price) * validatedData.guests + addonTotal;
                } else if (serviceMode === "experience-shared") {
                  if (!experience.sharedEnabled) {
                    return res.status(400).json({ error: "Shared group booking is not available for this experience." });
                  }

                  if (!validatedData.serviceDepartureId) {
                    return res.status(400).json({ error: "Choose one shared departure to continue." });
                  }

                  const departures = await getExperienceDepartureAvailability(experience.id);
                  const selectedDeparture = departures?.find((departure) => departure.id === validatedData.serviceDepartureId);
                  if (!selectedDeparture) {
                    return res.status(400).json({ error: "That shared departure is no longer available." });
                  }

                  if (validatedData.guests < 1) {
                    return res.status(400).json({ error: "Shared bookings must include at least 1 guest." });
                  }

                  if (validatedData.guests > selectedDeparture.spotsLeft) {
                    return res.status(409).json({ error: `Only ${selectedDeparture.spotsLeft} shared spot${selectedDeparture.spotsLeft === 1 ? "" : "s"} left on that departure.` });
                  }

                  const selectedAddons = (validatedData.serviceAddonSelections || []).filter((addonId) =>
                    (experience.sharedAddons || []).some((addon) => addon.id === addonId),
                  );
                  const addonTotal = (experience.sharedAddons || [])
                    .filter((addon) => selectedAddons.includes(addon.id))
                    .reduce((sum, addon) => sum + addon.price, 0);

                  validatedData.serviceAddonSelections = selectedAddons;
                  validatedData.checkIn = selectedDeparture.date;
                  validatedData.checkOut = selectedDeparture.date;
                  validatedData.serviceStartTime = selectedDeparture.time;
                  validatedData.serviceScheduleSlots = [{ date: selectedDeparture.date, note: `${selectedDeparture.time} shared departure` }];
                  validatedData.totalPrice = (experience.sharedPricePerPerson || experience.price) * validatedData.guests + addonTotal;
                } else {
                  if (!experience.customQuoteEnabled) {
                    return res.status(400).json({ error: "Custom offers are not available for this experience." });
                  }

                  if (!validatedData.serviceRequestDetails?.trim() || validatedData.serviceRequestDetails.trim().length < 20) {
                    return res.status(400).json({ error: "Please share more detail for the custom offer request." });
                  }

                  validatedData.serviceRequestDetails = validatedData.serviceRequestDetails.trim();

                  validatedData.serviceAddonSelections = [];
                  validatedData.serviceDepartureId = null;
                  validatedData.checkOut = validatedData.checkIn;
                  validatedData.serviceRequestFee = customServiceRequestFeeUsd;
                  validatedData.serviceRequestFeeKes = null;
                  validatedData.experienceCustomOfferStatus = "pending";
                  validatedData.experienceCustomOfferAmount = null;
                  validatedData.experienceCustomOfferMessage = null;
                  validatedData.experienceCustomOfferDeclineReason = null;
                  validatedData.experienceCustomOfferClientDecision = "pending";
                  validatedData.experienceCustomOfferClientRespondedAt = null;
                  validatedData.experienceCustomOfferReviewedByUserId = null;
                  validatedData.experienceCustomOfferReviewedAt = null;
                  validatedData.totalPrice = customServiceRequestFeeUsd;
                }
              } else {
                return res.status(404).json({ error: "Service not found" });
              }
            }
          }
        }
      }

      assertBookingDatesAreBookable({
        checkIn: validatedData.checkIn,
        checkOut: validatedData.checkOut,
        serviceScheduleSlots: validatedData.serviceScheduleSlots,
      });

      const promoCategorySet = new Set<ProviderCategory>();
      if (validatedData.bookingType !== "service" && validatedData.accommodationId) {
        promoCategorySet.add("stays");
      }
      for (const selection of validatedData.stayServiceSelections || []) {
        promoCategorySet.add(selection.category);
      }
      for (const selectedServiceId of validatedData.selectedServices || []) {
        if ((validatedData.stayServiceSelections || []).some((selection) => selection.serviceId === selectedServiceId)) {
          continue;
        }
        if (await storage.getCar(selectedServiceId)) {
          promoCategorySet.add("cars");
          continue;
        }
        if (await storage.getCook(selectedServiceId)) {
          promoCategorySet.add("cooks");
          continue;
        }
        if (await storage.getErrand(selectedServiceId)) {
          promoCategorySet.add("errands");
          continue;
        }
        if (await storage.getExperience(selectedServiceId)) {
          promoCategorySet.add("experiences");
        }
      }

      const promoPreview = await resolveMarketingPromoPreview({
        subtotal: validatedData.totalPrice,
        categories: Array.from(promoCategorySet),
        serviceCount: getPromoServiceCount(validatedData.selectedServices || [], validatedData.accommodationId),
        nights: calculateChargeableDays(validatedData.checkIn, validatedData.checkOut),
        guests: validatedData.guests,
        promoCode: requestedPromoCode || marketingAttribution?.promoCode || null,
      });
      if ((requestedPromoCode || marketingAttribution?.promoCode) && !promoPreview.promo) {
        return res.status(400).json({
          error: promoPreview.rejectionReason || "Promo code does not qualify for this booking.",
        });
      }

      if (promoPreview.promo) {
        validatedData.totalPrice = promoPreview.promo.discountedSubtotal;
      }

      const booking = await storage.createBooking({
        ...validatedData,
        paymentStatus: validatedData.totalPrice > 0 ? "pending" : "paid",
        paymentCurrency: "USD",
        paymentCheckoutAmount: null,
        paymentDepositAmount: null,
        paymentAmountPaid: 0,
      });
      queueNotificationTask(
        `booking created emails for ${booking.id}`,
        sendBookingCreatedNotificationEmails(booking, req),
      );
      await storage.syncBookingServiceAssignments({ bookingIds: [booking.id], notifyProviders: true });
      if (promoPreview.promo) {
        await storage.recordMarketingPromoRedemption(promoPreview.promo.promoId, booking.totalPrice);
      }

      if (marketingAttribution || promoPreview.promo) {
        await storage.createBookingAttribution(booking.id, {
          ...(marketingAttribution ?? {
            sessionId: `booking-${booking.id}`,
            sourceType: "direct",
          }),
          promoId: promoPreview.promo?.promoId ?? null,
          promoCode: promoPreview.promo?.promoCode ?? marketingAttribution?.promoCode ?? getNormalizedPromoCode(requestedPromoCode),
          promoName: promoPreview.promo?.promoName ?? null,
          promoCostAbsorption: promoPreview.promo?.costAbsorption ?? null,
          originalSubtotal: promoPreview.promo?.originalSubtotal ?? booking.totalPrice,
          discountAmount: promoPreview.promo?.discountAmount ?? 0,
          finalRevenue: booking.totalPrice,
        });
      }

      return res.status(201).json(await attachBookingMarketingAttribution(booking));
    } catch (error) {
      console.error("[BOOKING] Error creating booking:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create booking" });
      }
    }
  });

  app.post("/api/bookings/:id/payments/session", isAuthenticated, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking || booking.userId !== req.user.claims.sub) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (booking.status === "cancelled" || booking.status === "completed") {
        return res.status(400).json({ error: "This booking is closed and cannot be paid." });
      }

      const checkoutAmountDue = getBookingCheckoutAmount(booking);
      if (checkoutAmountDue <= 0) {
        const updatedBooking = await storage.updateBookingPaymentState(booking.id, {
          paymentStatus: "paid",
          paymentCurrency: booking.paymentCurrency || "USD",
          paymentAmount: 0,
          paymentCheckoutAmount: 0,
          paymentAmountPaid: Math.max(getBookingAmountPaid(booking), booking.totalPrice),
          paymentHoldExpiresAt: null,
          paidAt: booking.paidAt ?? new Date().toISOString(),
          paymentFailedAt: null,
        });
        if (updatedBooking) {
          queueNotificationTask(
            `payment emails for booking ${updatedBooking.id}`,
            sendBookingPaymentNotificationEmails(updatedBooking, {
              previousStatus: booking.paymentStatus,
              previousAmountPaid: getBookingAmountPaid(booking),
            }, req),
          );
        }
        return res.json({
          booking: await attachBookingMarketingAttribution(updatedBooking ?? booking),
          payment: null,
        });
      }

      const { paymentMethod } = bookingPaymentSessionRequestSchema.parse(req.body ?? {});
      const checkout = await startHostedBookingPayment(req, booking, paymentMethod);
      return res.json({
        booking: await attachBookingMarketingAttribution(checkout.booking),
        payment: checkout.payment,
      });
    } catch (error) {
      console.error("[PAYMENTS] Failed to create retry payment session:", error);
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to create payment session" });
    }
  });

  app.post("/api/bookings/:id/payments/manual-mpesa", isAuthenticated, async (req: any, res) => {
    try {
      const access = await assertCanAccessBookingThread(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const booking = access.booking;
      const currentUserId = req.user.claims.sub;
      const currentUserRole = req.user.claims.role;
      if (currentUserRole !== "admin" && booking.userId !== currentUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (booking.status === "cancelled" || booking.status === "completed") {
        return res.status(400).json({ error: "This booking is closed and cannot accept manual payment submissions." });
      }

      const checkoutAmountDue = getBookingCheckoutAmount(booking);
      if (checkoutAmountDue <= 0 || isBookingFullyPaid(booking)) {
        return res.status(400).json({ error: "This booking no longer has an outstanding balance." });
      }

      const payload = manualMpesaPaymentSchema.parse(req.body ?? {});
      const previousPaymentStatus = booking.paymentStatus;
      const currentAmountPaid = getBookingAmountPaid(booking);

      const updatedBooking = await storage.updateBookingPaymentState(booking.id, {
        paymentStatus: "processing",
        paymentProvider: "mpesa-manual",
        paymentReference: payload.transactionCode,
        paymentSessionId: null,
        paymentCheckoutAmount: checkoutAmountDue,
        paymentHoldExpiresAt: null,
        paymentFailedAt: null,
      });

      if (!updatedBooking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      await storage.createBookingMessage({
        bookingId: updatedBooking.id,
        userId: currentUserId,
        senderRole: currentUserRole ?? "customer",
        message: [
          "Customer submitted a temporary manual M-Pesa payment for review.",
          `Expected amount: ${formatBookingUsdAmount(checkoutAmountDue)}`,
          "Send money number: 0718475264",
          `M-Pesa code: ${payload.transactionCode}`,
          payload.senderPhone ? `Sender phone: ${payload.senderPhone}` : null,
          payload.note ? `Note: ${payload.note}` : null,
        ].filter(Boolean).join("\n"),
      });

      queueNotificationTask(
        `payment emails for booking ${updatedBooking.id}`,
        sendBookingPaymentNotificationEmails(updatedBooking, {
          previousStatus: previousPaymentStatus,
          previousAmountPaid: currentAmountPaid,
        }, req),
      );

      return res.json(decorateBookingWithOperationalStatus(updatedBooking));
    } catch (error) {
      console.error("[PAYMENTS] Failed to submit manual M-Pesa payment:", error);
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to submit manual M-Pesa payment" });
    }
  });

  app.get("/api/payments/callback/paystack", async (req, res) => {
    const reference = typeof req.query?.reference === "string" ? req.query.reference : "";
    const bookingId = getBookingIdFromPaymentReference(reference);

    if (!reference || !bookingId) {
      return res.redirect("/bookings?payment=failed");
    }

    try {
      const verifiedPayment = await verifyPaystackPayment(reference);
      await applyVerifiedBookingPayment(bookingId, verifiedPayment);
      const redirectStatus = verifiedPayment.status === "paid"
        ? "success"
        : verifiedPayment.status === "processing"
          ? "pending"
          : verifiedPayment.status === "cancelled"
            ? "cancelled"
            : "failed";
      return res.redirect(getPaymentResultRedirect(bookingId, redirectStatus));
    } catch (error) {
      console.error("[PAYMENTS] Paystack callback verification failed:", error);
      return res.redirect(getPaymentResultRedirect(bookingId, "failed"));
    }
  });

  app.post("/api/payments/webhooks/paystack", async (req: any, res) => {
    try {
      const signature = typeof req.headers["x-paystack-signature"] === "string"
        ? req.headers["x-paystack-signature"]
        : null;
      const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : null;

      if (!verifyPaystackWebhookSignature(rawBody, signature)) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      const reference = typeof req.body?.data?.reference === "string" ? req.body.data.reference : "";
      const bookingId = getBookingIdFromPaymentReference(reference);
      if (!reference || !bookingId) {
        return res.json({ received: true });
      }

      const verifiedPayment = await verifyPaystackPayment(reference);
      await applyVerifiedBookingPayment(bookingId, verifiedPayment);
      return res.json({ received: true });
    } catch (error) {
      console.error("[PAYMENTS] Paystack webhook processing failed:", error);
      return res.status(500).json({ error: "Failed to process Paystack webhook" });
    }
  });

  app.get("/api/payments/callback/pesapal", async (req, res) => {
    const orderTrackingId = typeof req.query?.OrderTrackingId === "string" ? req.query.OrderTrackingId : "";
    const merchantReference = typeof req.query?.OrderMerchantReference === "string" ? req.query.OrderMerchantReference : "";
    const bookingId = getBookingIdFromPaymentReference(merchantReference);

    if (!orderTrackingId) {
      return res.redirect("/bookings?payment=failed");
    }

    try {
      const verifiedPayment = await verifyPesapalPayment(orderTrackingId);
      if (merchantReference && verifiedPayment.reference.trim() !== merchantReference.trim()) {
        throw new Error("Pesapal verified a different merchant reference than the callback supplied.");
      }

      const verifiedBookingId = getBookingIdFromPaymentReference(verifiedPayment.reference);
      if (!verifiedBookingId) {
        throw new Error("Pesapal verified payment reference did not map to a booking.");
      }

      await applyVerifiedBookingPayment(verifiedBookingId, verifiedPayment);
      const redirectStatus = verifiedPayment.status === "paid"
        ? "success"
        : verifiedPayment.status === "cancelled"
          ? "cancelled"
          : verifiedPayment.status === "processing"
            ? "pending"
            : "failed";
      return res.redirect(getPaymentResultRedirect(verifiedBookingId, redirectStatus));
    } catch (error) {
      console.error("[PAYMENTS] Pesapal callback verification failed:", error);
      return bookingId
        ? res.redirect(getPaymentResultRedirect(bookingId, "failed"))
        : res.redirect("/bookings?payment=failed");
    }
  });

  app.all("/api/payments/webhooks/pesapal", async (req: any, res) => {
    const orderTrackingId = typeof req.query?.OrderTrackingId === "string"
      ? req.query.OrderTrackingId
      : typeof req.body?.OrderTrackingId === "string"
        ? req.body.OrderTrackingId
        : "";
    const merchantReference = typeof req.query?.OrderMerchantReference === "string"
      ? req.query.OrderMerchantReference
      : typeof req.body?.OrderMerchantReference === "string"
        ? req.body.OrderMerchantReference
        : "";
    if (!orderTrackingId) {
      return res.status(200).send("OK");
    }

    try {
      const verifiedPayment = await verifyPesapalPayment(orderTrackingId);
      if (merchantReference && verifiedPayment.reference.trim() !== merchantReference.trim()) {
        throw new Error("Pesapal verified a different merchant reference than the webhook supplied.");
      }

      const verifiedBookingId = getBookingIdFromPaymentReference(verifiedPayment.reference);
      if (!verifiedBookingId) {
        throw new Error("Pesapal verified payment reference did not map to a booking.");
      }

      await applyVerifiedBookingPayment(verifiedBookingId, verifiedPayment);
      return res.status(200).send("OK");
    } catch (error) {
      console.error("[PAYMENTS] Pesapal IPN processing failed:", error);
      return res.status(500).send("ERROR");
    }
  });

  app.get("/api/bookings/:id/reviews", isAuthenticated, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking || booking.userId !== req.user.claims.sub) {
        return res.status(404).json({ error: "Booking not found" });
      }

      res.json(await storage.getReviewsByBookingId(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch reviews" });
    }
  });

  app.get("/api/bookings/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const access = await assertCanAccessBookingThread(req, req.params.id);
      if ("error" in access) {
        const error = access.error!;
        return res.status(error.status).json(error.body);
      }

      res.json(await storage.getBookingMessages(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch booking messages" });
    }
  });

  app.post("/api/bookings/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const access = await assertCanAccessBookingThread(req, req.params.id);
      if ("error" in access) {
        const error = access.error!;
        return res.status(error.status).json(error.body);
      }

      const validatedData = insertBookingMessageSchema.parse({
        bookingId: req.params.id,
        message: req.body?.message,
      });

      const message = await storage.createBookingMessage({
        ...validatedData,
        userId: req.user.claims.sub,
        senderRole: req.user.claims.role ?? "customer",
      });
      res.status(201).json(message);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to send booking message" });
      }
    }
  });

  app.get("/api/inbox", isAuthenticated, async (req: any, res) => {
    try {
      res.json(await storage.getUserInbox(req.user.claims.sub));
    } catch (error) {
      console.error("[INBOX] Failed to fetch inbox items:", error);
      res.status(500).json({ error: "Failed to fetch inbox items" });
    }
  });

  app.patch("/api/inbox/:id/read", isAuthenticated, async (req: any, res) => {
    try {
      const updated = await storage.markInboxItemRead(req.params.id, req.user.claims.sub);
      if (!updated) {
        return res.status(404).json({ error: "Inbox item not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("[INBOX] Failed to update inbox item:", error);
      res.status(500).json({ error: "Failed to update inbox item" });
    }
  });

  app.post("/api/inbox/read", isAuthenticated, async (req: any, res) => {
    try {
      const scope = req.body?.scope;
      const normalizedScope = scope === "messages" || scope === "alerts" || scope === "all"
        ? scope
        : "all";
      const itemIds = Array.isArray(req.body?.itemIds)
        ? req.body.itemIds.filter((value: unknown): value is string => typeof value === "string")
        : [];
      const threadKeys = Array.isArray(req.body?.threadKeys)
        ? req.body.threadKeys.filter((value: unknown): value is string => typeof value === "string")
        : [];

      const updatedCount = await storage.markInboxItemsRead(req.user.claims.sub, {
        scope: normalizedScope,
        itemIds,
        threadKeys,
      });

      res.json({ updatedCount });
    } catch (error) {
      console.error("[INBOX] Failed to bulk update inbox items:", error);
      res.status(500).json({ error: "Failed to update inbox items" });
    }
  });

  app.post("/api/inbox/threads/read", isAuthenticated, async (req: any, res) => {
    try {
      const threadKey = typeof req.body?.threadKey === "string" ? req.body.threadKey.trim() : "";
      if (!threadKey) {
        return res.status(400).json({ error: "Thread key is required" });
      }

      const updatedCount = await storage.markInboxItemsReadByThread(req.user.claims.sub, threadKey);
      res.json({ updatedCount });
    } catch (error) {
      console.error("[INBOX] Failed to mark thread inbox items as read:", error);
      res.status(500).json({ error: "Failed to update inbox thread" });
    }
  });

  app.get("/api/push/config", isAuthenticated, async (req: any, res) => {
    try {
      const [preferences, devices] = await Promise.all([
        storage.getUserPushPreferences(req.user.claims.sub),
        storage.getUserPushDevices(req.user.claims.sub),
      ]);
      res.json({
        ...storage.getPushPublicConfig(),
        preferences,
        activeDeviceCount: devices.length,
      });
    } catch (error) {
      console.error("[PUSH] Failed to fetch push config:", error);
      res.status(500).json({ error: "Failed to fetch push config" });
    }
  });

  app.post("/api/push/register", isAuthenticated, async (req: any, res) => {
    try {
      const validatedDevice = insertUserPushDeviceSchema.parse(req.body ?? {});
      const device = await storage.upsertUserPushDevice(req.user.claims.sub, validatedDevice);
      res.status(201).json(device);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to register push device" });
    }
  });

  app.post("/api/push/unregister", isAuthenticated, async (req: any, res) => {
    try {
      const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.trim() : "";
      if (!endpoint) {
        return res.status(400).json({ error: "Endpoint is required" });
      }

      const updatedCount = await storage.unregisterUserPushDevice(req.user.claims.sub, endpoint);
      res.json({ updatedCount });
    } catch (error) {
      console.error("[PUSH] Failed to unregister push device:", error);
      res.status(500).json({ error: "Failed to unregister push device" });
    }
  });

  app.patch("/api/push/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const validatedUpdate = updateUserPushPreferencesSchema.parse(req.body ?? {});
      res.json(await storage.updateUserPushPreferences(req.user.claims.sub, validatedUpdate));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to update push preferences" });
    }
  });

  app.post("/api/push/test", isAuthenticated, async (req: any, res) => {
    try {
      const item = await storage.createPushTestNotification(req.user.claims.sub);
      res.status(201).json(item);
    } catch (error) {
      console.error("[PUSH] Failed to create test notification:", error);
      res.status(500).json({ error: "Failed to send test notification" });
    }
  });

  app.post("/api/bookings/:id/reviews", isAuthenticated, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking || booking.userId !== req.user.claims.sub) {
        return res.status(404).json({ error: "Booking not found" });
      }

      const operationalStatus = getBookingOperationalStatus(booking);
      if (operationalStatus !== "completed") {
        return res.status(400).json({ error: "Reviews can only be submitted for completed bookings." });
      }

      const parsed = req.body ?? {};
      const rating = insertReviewSchema.shape.rating.parse(parsed.rating);
      const comment = typeof parsed.comment === "string" ? parsed.comment : undefined;
      const targetType = parsed.targetType;
      const targetId = parsed.targetId;

      if (!["stay", "car", "cook", "errand", "experience"].includes(targetType) || typeof targetId !== "string") {
        return res.status(400).json({ error: "Valid review target is required." });
      }

      const validTargets: Array<{ targetType: string; targetId: string }> = [];
      if (booking.accommodationId) {
        validTargets.push({ targetType: "stay", targetId: booking.accommodationId });
      }

      for (const selectedServiceId of booking.selectedServices) {
        if (await storage.getCar(selectedServiceId)) {
          validTargets.push({ targetType: "car", targetId: selectedServiceId });
          continue;
        }
        if (await storage.getCook(selectedServiceId)) {
          validTargets.push({ targetType: "cook", targetId: selectedServiceId });
          continue;
        }
        if (await storage.getErrand(selectedServiceId)) {
          validTargets.push({ targetType: "errand", targetId: selectedServiceId });
          continue;
        }
        if (await storage.getExperience(selectedServiceId)) {
          validTargets.push({ targetType: "experience", targetId: selectedServiceId });
        }
      }

      const isValidTarget = validTargets.some((target) => target.targetType === targetType && target.targetId === targetId);
      if (!isValidTarget) {
        return res.status(400).json({ error: "That item is not part of this booking." });
      }

      const existingReview = (await storage.getReviewsByBookingId(req.params.id)).find(
        (review) => review.userId === req.user.claims.sub && review.targetType === targetType && review.targetId === targetId,
      );

      if (existingReview) {
        return res.status(400).json({ error: "This item has already been rated and is now closed." });
      }

      const review = await storage.createReview({
        bookingId: req.params.id,
        userId: req.user.claims.sub,
        targetType,
        targetId,
        rating,
        comment,
      });

      await refreshTargetRating(targetType, targetId);
      res.status(201).json(review);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to save review" });
      }
    }
  });

  app.post("/api/marketing/track", async (req, res) => {
    try {
      const event = marketingAttributionEventSchema.parse(req.body ?? {});
      const created = await storage.createMarketingAttributionEvent(event);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to save attribution event" });
    }
  });

  app.post("/api/marketing/promos/preview", async (req, res) => {
    try {
      const payload = z.object({
        subtotal: z.coerce.number().int().min(0),
        selectedCategories: z.array(z.enum(providerCategories)).optional().default([]),
        selectedServiceIds: z.array(z.string()).optional().default([]),
        accommodationId: z.string().nullable().optional(),
        guests: z.coerce.number().int().min(1),
        checkIn: z.string().min(1),
        checkOut: z.string().min(1),
        promoCode: z.string().trim().optional().nullable(),
      }).parse(req.body ?? {});

      const categories = Array.from(new Set<ProviderCategory>([
        ...(payload.accommodationId ? ["stays" as ProviderCategory] : []),
        ...payload.selectedCategories,
      ]));

      const result = await resolveMarketingPromoPreview({
        subtotal: payload.subtotal,
        categories,
        serviceCount: getPromoServiceCount(payload.selectedServiceIds, payload.accommodationId),
        nights: calculateChargeableDays(payload.checkIn, payload.checkOut),
        guests: payload.guests,
        promoCode: payload.promoCode,
      });

      res.json(result);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to preview promo" });
    }
  });

  // Listings (Public) - Unified catalog for all services
  app.get("/api/listings", async (req, res) => {
    try {
      const { category } = req.query;
      const listings = (await storage.getListings()).filter((listing) => listing.isPublic);
      
      // Filter by category if provided
      const filteredListings = category 
        ? listings.filter(l => l.category === category)
        : listings;
      
      res.json(filteredListings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch listings" });
    }
  });

  app.get("/api/listings/:id", async (req, res) => {
    try {
      const listing = await storage.getListing(req.params.id);
      if (!listing || !listing.isPublic) {
        return res.status(404).json({ error: "Listing not found" });
      }
      res.json(listing);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch listing" });
    }
  });

  app.get("/api/reviews/:targetType/:targetId", async (req, res) => {
    try {
      const targetType = req.params.targetType;
      const targetId = req.params.targetId;

      if (!["stay", "car", "cook", "errand", "experience"].includes(targetType)) {
        return res.status(400).json({ error: "Invalid review target type." });
      }

      const reviews = await storage.getReviewsByTarget(targetType, targetId);
      const enrichedReviews = await Promise.all(
        reviews.map(async (review) => {
          const booking = await storage.getBooking(review.bookingId);
          return {
            ...review,
            guestName: booking?.guestName ?? "Verified Guest",
          };
        }),
      );

      res.json(
        enrichedReviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch reviews" });
    }
  });

  // Blog Posts (Public)
  app.get("/api/blog", async (_req, res) => {
    try {
      const posts = await storage.getPublishedBlogPosts();
      res.json(posts);
    } catch (error) {
      logPublicFetchFailure("blog posts", error);
      res.status(500).json({ error: "Failed to fetch blog posts" });
    }
  });

  app.get("/api/blog/:slug", async (req, res) => {
    try {
      const post = await storage.getBlogPostBySlug(req.params.slug);
      if (!post || post.status !== "published") {
        return res.status(404).json({ error: "Blog post not found" });
      }
      res.json(post);
    } catch (error) {
      logPublicFetchFailure(`blog post '${req.params.slug}'`, error);
      res.status(500).json({ error: "Failed to fetch blog post" });
    }
  });

  // ===== ADMIN ROUTES ===== (Protected by Replit Auth)
  
  // Admin Dashboard Analytics
  app.get("/api/admin/dashboard", requireAdmin, async (_req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("[ADMIN] Failed to fetch dashboard metrics:", error);
      res.status(500).json({ error: "Failed to fetch dashboard metrics" });
    }
  });

  app.get("/api/admin/analytics/popular-services", requireAdmin, async (_req, res) => {
    try {
      const popularServices = await storage.getPopularServices();
      res.json(popularServices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch popular services" });
    }
  });

  app.get("/api/admin/analytics/revenue", requireAdmin, async (_req, res) => {
    try {
      const revenue = await storage.getRevenueByMonth();
      res.json(revenue);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch revenue data" });
    }
  });

  app.get("/api/admin/marketing/attribution-summary", requireAdmin, async (_req, res) => {
    try {
      res.json(await storage.getMarketingAttributionSummary());
    } catch (error) {
      console.error("[ADMIN] Failed to fetch marketing attribution summary:", error);
      res.status(500).json({ error: "Failed to fetch marketing attribution summary" });
    }
  });

  app.get("/api/admin/marketing/promos", requireAdmin, async (_req, res) => {
    try {
      res.json(await storage.getMarketingPromos());
    } catch (error) {
      console.error("[ADMIN] Failed to fetch marketing promos:", error);
      res.status(500).json({ error: "Failed to fetch marketing promos" });
    }
  });

  app.post("/api/admin/marketing/promos", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertMarketingPromoSchema.parse(req.body);
      const promo = await storage.createMarketingPromo(validatedData);
      res.status(201).json(promo);
    } catch (error) {
      if (error instanceof Error) {
        const message = error.message.toLowerCase().includes("unique")
          ? "A promo with that code already exists"
          : error.message;
        return res.status(400).json({ error: message });
      }

      res.status(500).json({ error: "Failed to create marketing promo" });
    }
  });

  app.patch("/api/admin/marketing/promos/:id", requireAdmin, async (req, res) => {
    try {
      const existingPromo = await storage.getMarketingPromo(req.params.id);
      if (!existingPromo) {
        return res.status(404).json({ error: "Marketing promo not found" });
      }

      const patchData = updateMarketingPromoSchema.parse(req.body);
      insertMarketingPromoSchema.parse({
        name: pickPatchedValue(patchData.name, existingPromo.name),
        code: pickPatchedValue(patchData.code, existingPromo.code),
        description: pickPatchedValue(patchData.description, existingPromo.description),
        promoType: pickPatchedValue(patchData.promoType, existingPromo.promoType),
        status: pickPatchedValue(patchData.status, existingPromo.status),
        channel: pickPatchedValue(patchData.channel, existingPromo.channel),
        audience: pickPatchedValue(patchData.audience, existingPromo.audience),
        eligibleCategories: pickPatchedValue(patchData.eligibleCategories, existingPromo.eligibleCategories),
        autoApply: pickPatchedValue(patchData.autoApply, existingPromo.autoApply),
        requiredCategories: pickPatchedValue(patchData.requiredCategories, existingPromo.requiredCategories),
        minimumNights: pickPatchedValue(patchData.minimumNights, existingPromo.minimumNights),
        minimumGuests: pickPatchedValue(patchData.minimumGuests, existingPromo.minimumGuests),
        minimumServiceCount: pickPatchedValue(patchData.minimumServiceCount, existingPromo.minimumServiceCount),
        bundleLabel: pickPatchedValue(patchData.bundleLabel, existingPromo.bundleLabel),
        costAbsorption: pickPatchedValue(patchData.costAbsorption, existingPromo.costAbsorption),
        discountPercent: pickPatchedValue(patchData.discountPercent, existingPromo.discountPercent),
        discountAmount: pickPatchedValue(patchData.discountAmount, existingPromo.discountAmount),
        minimumSpend: pickPatchedValue(patchData.minimumSpend, existingPromo.minimumSpend),
        usageLimit: pickPatchedValue(patchData.usageLimit, existingPromo.usageLimit),
        redemptionCount: pickPatchedValue(patchData.redemptionCount, existingPromo.redemptionCount),
        attributedRevenue: pickPatchedValue(patchData.attributedRevenue, existingPromo.attributedRevenue),
        landingPath: pickPatchedValue(patchData.landingPath, existingPromo.landingPath),
        startAt: pickPatchedValue(patchData.startAt, existingPromo.startAt),
        endAt: pickPatchedValue(patchData.endAt, existingPromo.endAt),
        notes: pickPatchedValue(patchData.notes, existingPromo.notes),
      });

      const promo = await storage.updateMarketingPromo(req.params.id, patchData);
      if (!promo) {
        return res.status(404).json({ error: "Marketing promo not found" });
      }

      res.json(promo);
    } catch (error) {
      if (error instanceof Error) {
        const message = error.message.toLowerCase().includes("unique")
          ? "A promo with that code already exists"
          : error.message;
        return res.status(400).json({ error: message });
      }

      res.status(500).json({ error: "Failed to update marketing promo" });
    }
  });

  app.delete("/api/admin/marketing/promos/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteMarketingPromo(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Marketing promo not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete marketing promo" });
    }
  });

  app.get("/api/admin/clients", requireAdmin, async (_req, res) => {
    try {
      const clients = await storage.getClientsWithBookings();
      res.json(clients);
    } catch (error) {
      console.error("[ADMIN] Failed to fetch client data:", error);
      res.status(500).json({ error: "Failed to fetch client data" });
    }
  });

  app.get("/api/admin/provider-accounts", requireAdmin, async (_req, res) => {
    try {
      res.json(await storage.getProviderAccountSummaries());
    } catch (error) {
      console.error("[ADMIN] Failed to fetch provider accounts:", error);
      res.status(500).json({ error: "Failed to fetch provider accounts" });
    }
  });

  app.post("/api/admin/provider-accounts", requireAdmin, async (req, res) => {
    try {
      const {
        name,
        email,
        phone,
        password,
        providerType,
        providerTypes,
      } = req.body ?? {};

      if (typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({ error: "Provider name is required" });
      }

      if (typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ error: "Valid provider email is required" });
      }

      if (typeof phone !== "string" || phone.trim().length < 7) {
        return res.status(400).json({ error: "Valid provider phone is required" });
      }

      if (typeof password !== "string" || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const validatedProviderTypes = parseProviderTypes(providerTypes ?? providerType);
      if (validatedProviderTypes.length === 0) {
        return res.status(400).json({ error: "At least one valid provider category is required" });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(409).json({ error: "A user with that email already exists" });
      }

      const nameParts = name.trim().split(/\s+/).filter(Boolean);
      const [createdUser] = await db.insert(users).values({
        email: normalizedEmail,
        phone: phone.trim(),
        firstName: nameParts[0] ?? null,
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
        passwordHash: hashPassword(password),
        role: "provider",
        providerType: validatedProviderTypes.join(","),
      }).returning();

      res.status(201).json(sanitizeUserRecord(createdUser));
    } catch (error) {
      res.status(500).json({ error: "Failed to create provider account" });
    }
  });

  app.patch("/api/admin/provider-accounts/:id", requireAdmin, async (req, res) => {
    try {
      const existingUser = await storage.getUser(req.params.id);
      if (!existingUser || existingUser.role !== "provider") {
        return res.status(404).json({ error: "Provider account not found" });
      }

      const updates: Record<string, unknown> = {};
      if (typeof req.body?.name === "string" && req.body.name.trim().length >= 2) {
        const nameParts = req.body.name.trim().split(/\s+/).filter(Boolean);
        updates.firstName = nameParts[0] ?? null;
        updates.lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
      }
      if (typeof req.body?.phone === "string") {
        updates.phone = req.body.phone.trim();
      }
      const validatedProviderTypes = parseProviderTypes(req.body?.providerTypes ?? req.body?.providerType);
      if (validatedProviderTypes.length > 0) {
        updates.providerType = validatedProviderTypes.join(",");
      }
      if (typeof req.body?.moderationNote === "string") {
        updates.moderationNote = req.body.moderationNote.trim() || null;
      }
      if (typeof req.body?.isSuspended === "boolean") {
        updates.isSuspended = req.body.isSuspended;
      }
      if (req.body?.action === "warn") {
        updates.warningCount = (existingUser.warningCount ?? 0) + 1;
      }

      const updated = await storage.updateUser(req.params.id, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update provider account" });
    }
  });

  app.delete("/api/admin/provider-accounts/:id", requireAdmin, async (req, res) => {
    try {
      const provider = await storage.getUser(req.params.id);
      if (!provider || provider.role !== "provider") {
        return res.status(404).json({ error: "Provider account not found" });
      }

      const [stays, cars, cooks, errands, experiences] = await Promise.all([
        storage.getStays(),
        storage.getCars(),
        storage.getCooks(),
        storage.getErrands(),
        storage.getExperiences(),
      ]);

      await Promise.all([
        ...stays.filter((stay) => stay.managerUserId === req.params.id).map((stay) => storage.updateStay(stay.id, { managerUserId: null })),
        ...cars.filter((car) => car.managerUserId === req.params.id).map((car) => storage.updateCar(car.id, { managerUserId: null })),
        ...cooks.filter((cook) => cook.managerUserId === req.params.id).map((cook) => storage.updateCook(cook.id, { managerUserId: null })),
        ...errands.filter((errand) => errand.managerUserId === req.params.id).map((errand) => storage.updateErrand(errand.id, { managerUserId: null })),
        ...experiences.filter((experience) => experience.managerUserId === req.params.id).map((experience) => storage.updateExperience(experience.id, { managerUserId: null })),
      ]);

      const deleted = await storage.deleteUser(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Provider account not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete provider account" });
    }
  });

  app.get("/api/admin/payments", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getPaymentManagementData();
      res.json(data);
    } catch (error) {
      console.error("[ADMIN] Failed to fetch payment management data:", error);
      res.status(500).json({ error: "Failed to fetch payment management data" });
    }
  });

  app.post("/api/admin/payments/sync", requireAdmin, async (_req, res) => {
    try {
      const result = await storage.syncBookingPayouts();
      res.json(result);
    } catch (error) {
      console.error("[ADMIN] Failed to sync booking payouts:", error);
      res.status(500).json({ error: "Failed to sync booking payouts" });
    }
  });

  app.patch("/api/admin/payments/commission-settings", requireAdmin, async (req, res) => {
    try {
      const providerUserId = typeof req.body?.providerUserId === "string" ? req.body.providerUserId : "";
      const providerCategory = typeof req.body?.providerCategory === "string" ? req.body.providerCategory : "";
      const commissionPercent = Number(req.body?.commissionPercent);
      const notes = typeof req.body?.notes === "string" ? req.body.notes : null;

      if (!providerUserId) {
        return res.status(400).json({ error: "Provider is required." });
      }

      if (!providerCategories.includes(providerCategory as typeof providerCategories[number])) {
        return res.status(400).json({ error: "Choose a valid provider category." });
      }

      if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
        return res.status(400).json({ error: "Commission must be between 0 and 100 percent." });
      }

      const provider = await storage.getUser(providerUserId);
      if (!provider || provider.role !== "provider") {
        return res.status(404).json({ error: "Provider account not found." });
      }

      const setting = await storage.upsertProviderCommissionSetting(
        providerUserId,
        providerCategory as typeof providerCategories[number],
        commissionPercent,
        notes,
      );
      await storage.syncBookingPayouts();
      res.json(setting);
    } catch (error) {
      console.error("[ADMIN] Failed to update commission setting:", error);
      res.status(500).json({ error: "Failed to update commission setting" });
    }
  });

  app.patch("/api/admin/payouts/:id", requireAdmin, async (req, res) => {
    try {
      const requestedStatus = typeof req.body?.status === "string" ? req.body.status : undefined;
      const paymentMethod = typeof req.body?.paymentMethod === "string" ? req.body.paymentMethod : undefined;
      const paymentReference = typeof req.body?.paymentReference === "string" ? req.body.paymentReference : undefined;
      const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;
      const paidAt = typeof req.body?.paidAt === "string" ? req.body.paidAt : undefined;

      if (
        requestedStatus !== undefined
        && !["pending", "approved", "paid", "cancelled"].includes(requestedStatus)
      ) {
        return res.status(400).json({ error: "Choose a valid payout status." });
      }

      if (
        paymentMethod !== undefined
        && paymentMethod !== ""
        && !["bank-transfer", "mobile-money", "cash", "card", "other"].includes(paymentMethod)
      ) {
        return res.status(400).json({ error: "Choose a valid payment method." });
      }

      const updated = await storage.updateBookingPayout(req.params.id, {
        status: requestedStatus as any,
        paymentMethod: paymentMethod === "" ? null : paymentMethod as any,
        paymentReference,
        notes,
        paidAt,
      });

      if (!updated) {
        return res.status(404).json({ error: "Payout not found." });
      }

      res.json(updated);
    } catch (error) {
      console.error("[ADMIN] Failed to update payout:", error);
      res.status(500).json({ error: "Failed to update payout" });
    }
  });

  app.get("/api/provider/payments", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const requestedProviderUserId = typeof req.query?.providerUserId === "string" ? req.query.providerUserId.trim() : "";
      const providerUserId = req.user.claims.role === "admin" && requestedProviderUserId
        ? requestedProviderUserId
        : req.user.claims.sub;

      res.json(await storage.getProviderPaymentData(providerUserId));
    } catch (error) {
      console.error("[PROVIDER] Failed to fetch provider payment data:", error);
      res.status(500).json({ error: "Failed to fetch provider payment data" });
    }
  });

  // Admin Accommodations Management
  app.post("/api/admin/accommodations", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertAccommodationSchema.parse(req.body);
      const accommodation = await storage.createAccommodation(validatedData);
      res.status(201).json(accommodation);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create accommodation" });
      }
    }
  });

  app.patch("/api/admin/accommodations/:id", requireAdmin, async (req, res) => {
    try {
      const accommodation = await storage.updateAccommodation(req.params.id, req.body);
      if (!accommodation) {
        return res.status(404).json({ error: "Accommodation not found" });
      }
      res.json(accommodation);
    } catch (error) {
      res.status(500).json({ error: "Failed to update accommodation" });
    }
  });

  app.delete("/api/admin/accommodations/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteAccommodation(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Accommodation not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete accommodation" });
    }
  });

  // Admin Services Management
  app.post("/api/admin/services", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertServiceSchema.parse(req.body);
      const service = await storage.createService(validatedData);
      res.status(201).json(service);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create service" });
      }
    }
  });

  app.patch("/api/admin/services/:id", requireAdmin, async (req, res) => {
    try {
      const service = await storage.updateService(req.params.id, req.body);
      if (!service) {
        return res.status(404).json({ error: "Service not found" });
      }
      res.json(service);
    } catch (error) {
      res.status(500).json({ error: "Failed to update service" });
    }
  });

  app.delete("/api/admin/services/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteService(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Service not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete service" });
    }
  });

  // Admin Bookings Management
  app.get("/api/admin/bookings", requireAdmin, async (_req, res) => {
    try {
      const allBookings = await storage.getBookings();
      res.json(allBookings.map(decorateBookingWithOperationalStatus));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  });

  app.patch("/api/admin/bookings/:id", requireAdmin, async (req: any, res) => {
    try {
      const existingBooking = await storage.getBooking(req.params.id);
      if (!existingBooking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      const requestedStatus = req.body?.status;
      if (typeof requestedStatus === "string") {
        const currentStatus = getBookingOperationalStatus(existingBooking);
        if (!canTransitionBookingStatus(currentStatus, requestedStatus)) {
          return res.status(400).json({
            error: currentStatus === "completed"
              ? "Completed bookings are locked and cannot be moved back to an active status."
              : currentStatus === "cancelled"
                ? "Cancelled bookings are locked and cannot be re-opened."
              : "That status change is not allowed for this booking.",
          });
        }
      }

      const booking = await storage.updateBooking(
        req.params.id,
        typeof requestedStatus === "string"
          ? {
              ...req.body,
              ...clearProviderStatusRequestFields(req.user?.claims?.sub ?? null),
            }
          : req.body,
      );
      res.json(booking);
    } catch (error) {
      res.status(500).json({ error: "Failed to update booking" });
    }
  });

  app.patch("/api/admin/bookings/:id/require-deposit", requireAdmin, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (booking.status === "cancelled" || booking.status === "completed") {
        return res.status(400).json({ error: "Closed bookings cannot receive a deposit rule." });
      }

      if (booking.totalPrice <= 0) {
        return res.status(400).json({ error: "This booking does not have a payable amount." });
      }

      if (isBookingFullyPaid(booking)) {
        return res.status(400).json({ error: "This booking is already fully paid." });
      }

      if (!supportsBookingDeposit(booking)) {
        return res.status(400).json({ error: "This booking must be paid in full and cannot use deposits." });
      }

      const requiredDepositAmount = calculateBookingDepositAmount(booking.totalPrice);
      const updated = await storage.updateBooking(req.params.id, {
        paymentDepositAmount: requiredDepositAmount,
        paymentStatus: getBookingAmountPaid(booking) >= Math.max(0, booking.totalPrice) ? "paid" : "pending",
        paymentCheckoutAmount: null,
        paymentHoldExpiresAt: null,
        paymentSessionId: null,
        paymentFailedAt: null,
      });

      if (!updated) {
        return res.status(404).json({ error: "Booking not found" });
      }

      return res.json(decorateBookingWithOperationalStatus(updated));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to require a deposit for this booking" });
    }
  });

  app.patch("/api/admin/bookings/:id/payment-action", requireAdmin, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      const { action, note } = adminBookingPaymentActionSchema.parse(req.body ?? {});
      const reviewerId = req.user?.claims?.sub ?? null;
      const outstandingAmount = getBookingOutstandingAmount(booking);

      if (action === "payment-received-cash" || action === "payment-received-mpesa") {
        if (booking.status === "cancelled" || booking.status === "completed") {
          return res.status(400).json({ error: "Closed bookings cannot receive payment confirmations." });
        }

        if (outstandingAmount <= 0) {
          return res.status(400).json({ error: "This booking no longer has an outstanding balance." });
        }

        const previousPaymentStatus = booking.paymentStatus;
        const currentAmountPaid = getBookingAmountPaid(booking);
        const cashAmount = Math.min(outstandingAmount, Math.max(1, getBookingCheckoutAmount(booking)));
        const nextAmountPaid = Math.min(
          Math.max(0, booking.totalPrice),
          currentAmountPaid + cashAmount,
        );
        const isFullySettled = nextAmountPaid >= Math.max(0, booking.totalPrice);
        const isDepositCollection = currentAmountPaid === 0 && nextAmountPaid < Math.max(0, booking.totalPrice);
        const paidAt = new Date().toISOString();
        const isManualMpesa = action === "payment-received-mpesa";
        const updated = await storage.updateBookingPaymentState(req.params.id, {
          paymentStatus: isFullySettled ? "paid" : "pending",
          paymentProvider: isManualMpesa ? "mpesa-manual" : "cash",
          paymentReference: isManualMpesa
            ? (booking.paymentReference?.trim() || `M-PESA-MANUAL-${Date.now().toString(36).toUpperCase()}`)
            : `ADMIN-CASH-${Date.now().toString(36).toUpperCase()}`,
          paymentSessionId: null,
          paymentCurrency: booking.paymentCurrency || "USD",
          paymentAmount: cashAmount,
          paymentCheckoutAmount: cashAmount,
          paymentAmountPaid: nextAmountPaid,
          paymentHoldExpiresAt: null,
          paidAt,
          paymentFailedAt: null,
        });

        if (!updated) {
          return res.status(404).json({ error: "Booking not found" });
        }

        if (nextAmountPaid > currentAmountPaid) {
          queueNotificationTask(
            `payment emails for booking ${updated.id}`,
            sendBookingPaymentNotificationEmails(updated, {
              previousStatus: previousPaymentStatus,
              previousAmountPaid: currentAmountPaid,
            }, req),
          );
        }

        if (isFullySettled) {
          await storage.syncBookingServiceAssignments({ bookingIds: [updated.id], notifyProviders: true });
          await storage.syncBookingPayouts({ bookingIds: [updated.id] });
        }

        if (note.trim().length > 0) {
          await storage.createBookingMessage({
            bookingId: updated.id,
            message: `${isDepositCollection
              ? isManualMpesa ? "Admin note: temporary M-Pesa deposit confirmed." : "Admin note: cash deposit received."
              : isManualMpesa ? "Admin note: temporary M-Pesa payment confirmed." : "Admin note: cash payment received."}\n\n${note.trim()}`,
            userId: reviewerId ?? "admin",
            senderRole: "admin",
          });
        }

        return res.json(decorateBookingWithOperationalStatus(updated));
      }

      if (action === "send-reminder") {
        if (booking.status === "cancelled" || booking.status === "completed") {
          return res.status(400).json({ error: "Closed bookings cannot receive payment reminders." });
        }

        if (outstandingAmount <= 0) {
          return res.status(400).json({ error: "This booking no longer has an outstanding balance." });
        }

        await storage.createBookingMessage({
          bookingId: booking.id,
          message: buildAdminPaymentReminderMessage(booking, note),
          userId: reviewerId ?? "admin",
          senderRole: "admin",
        });

        return res.json(decorateBookingWithOperationalStatus(booking));
      }

      if (booking.status === "cancelled") {
        return res.status(400).json({ error: "This booking is already cancelled." });
      }

      if (booking.status === "completed") {
        return res.status(400).json({ error: "Completed bookings cannot be cancelled here." });
      }

      const updated = await storage.updateBooking(req.params.id, {
        status: "cancelled",
        paymentStatus: outstandingAmount > 0 ? "cancelled" : booking.paymentStatus,
        paymentHoldExpiresAt: null,
        paymentSessionId: null,
        ...clearProviderStatusRequestFields(reviewerId),
      });

      if (!updated) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (note.trim().length > 0) {
        await storage.createBookingMessage({
          bookingId: updated.id,
          message: `Admin update: this booking has been cancelled.\n\n${note.trim()}`,
          userId: reviewerId ?? "admin",
          senderRole: "admin",
        });
      }

      return res.json(decorateBookingWithOperationalStatus(updated));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to update booking payment state" });
    }
  });

  app.patch("/api/admin/bookings/:id/provider-status-request", requireAdmin, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (!booking.providerStatusRequest) {
        return res.status(400).json({ error: "There is no pending provider status request for this booking." });
      }

      const action = req.body?.action;
      const now = new Date().toISOString();
      const reviewerId = req.user?.claims?.sub ?? null;
      if (action === "approve") {
        const nextStatus = booking.providerStatusRequest;
        const currentStatus = getBookingOperationalStatus(booking);

        if (!canTransitionBookingStatus(currentStatus, nextStatus)) {
          return res.status(400).json({ error: "That provider request can no longer be applied to this booking." });
        }

        const updated = await storage.updateBooking(req.params.id, {
          status: nextStatus,
          ...clearProviderStatusRequestFields(reviewerId),
        });
        return res.json(updated);
      }

      if (action === "decline") {
        const updated = await storage.updateBooking(req.params.id, clearProviderStatusRequestFields(reviewerId));
        return res.json(updated);
      }

      return res.status(400).json({ error: "Invalid review action." });
    } catch (error) {
      res.status(500).json({ error: "Failed to review provider status request" });
    }
  });

  app.patch("/api/admin/bookings/:id/errand-response", requireAdmin, async (req, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (!booking.selectedServices.length) {
        return res.status(400).json({ error: "No service is attached to this booking." });
      }

      const errand = await storage.getErrand(booking.selectedServices[0]);
      if (!errand) {
        return res.status(400).json({ error: "This booking is not linked to an errand service." });
      }

      const responseMessage = typeof req.body?.responseMessage === "string" ? req.body.responseMessage.trim() : "";
      if (responseMessage.length < 5) {
        return res.status(400).json({ error: "Please enter a short response for the customer." });
      }

      const updated = await storage.updateBooking(req.params.id, {
        serviceResponseMessage: responseMessage,
      });
      res.json(updated);
    } catch (error) {
      console.error("[ADMIN] Failed to update errand response:", error);
      res.status(500).json({ error: "Failed to update errand response" });
    }
  });

  app.patch("/api/admin/bookings/:id/custom-menu-proposal", requireAdmin, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (!isCustomMenuBooking(booking)) {
        return res.status(400).json({ error: "Only custom menu requests can be reviewed here." });
      }

      const action = req.body?.action;
      const now = new Date().toISOString();
      const reviewerId = req.user.claims.sub;

      if (action === "propose") {
        const proposedAmount = Number(req.body?.proposedAmount);
        const proposalMessage = typeof req.body?.proposalMessage === "string" ? req.body.proposalMessage.trim() : "";
        if (!Number.isFinite(proposedAmount) || proposedAmount <= 0) {
          return res.status(400).json({ error: "Enter the full quoted total for this custom menu." });
        }

        const updated = await storage.updateBooking(req.params.id, {
          customMenuProposalStatus: "proposed",
          customMenuProposedAmount: Math.round(proposedAmount),
          customMenuProposalMessage: proposalMessage || null,
          customMenuDeclineReason: null,
          customMenuClientDecision: "pending",
          customMenuClientRespondedAt: null,
          customMenuCreditCode: null,
          customMenuCreditAmount: null,
          customMenuReviewedByUserId: reviewerId,
          customMenuReviewedAt: now,
        });
        return res.json(updated);
      }

      if (action === "decline") {
        const declineReason = typeof req.body?.declineReason === "string" ? req.body.declineReason.trim() : "";
        if (declineReason.length < 5) {
          return res.status(400).json({ error: "Please provide a short reason for declining this request." });
        }

        const updated = await storage.updateBooking(req.params.id, {
          customMenuProposalStatus: "declined",
          customMenuProposedAmount: null,
          customMenuProposalMessage: null,
          customMenuDeclineReason: declineReason,
          customMenuClientDecision: "pending",
          customMenuClientRespondedAt: null,
          customMenuCreditCode: null,
          customMenuCreditAmount: null,
          customMenuReviewedByUserId: reviewerId,
          customMenuReviewedAt: now,
          status: "cancelled",
        });
        return res.json(updated);
      }

      if (action === "reopen") {
        const updated = await storage.updateBooking(req.params.id, {
          customMenuProposalStatus: "pending",
          customMenuReviewedByUserId: null,
          customMenuReviewedAt: null,
        });
        return res.json(updated);
      }

      return res.status(400).json({ error: "Invalid proposal action." });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to review custom menu request" });
    }
  });

  app.patch("/api/admin/bookings/:id/experience-custom-offer", requireAdmin, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (!isExperienceCustomOfferBooking(booking)) {
        return res.status(400).json({ error: "Only experience custom offers can be reviewed here." });
      }

      const action = req.body?.action;
      const now = new Date().toISOString();
      const reviewerId = req.user.claims.sub;

      if (action === "propose") {
        const proposedAmount = Number(req.body?.proposedAmount);
        const proposalMessage = typeof req.body?.proposalMessage === "string" ? req.body.proposalMessage.trim() : "";
        if (!Number.isFinite(proposedAmount) || proposedAmount <= 0) {
          return res.status(400).json({ error: "Enter the total amount for this custom offer." });
        }

        const updated = await storage.updateBooking(req.params.id, {
          experienceCustomOfferStatus: "proposed",
          experienceCustomOfferAmount: Math.round(proposedAmount),
          experienceCustomOfferMessage: proposalMessage || null,
          experienceCustomOfferDeclineReason: null,
          experienceCustomOfferClientDecision: "pending",
          experienceCustomOfferClientRespondedAt: null,
          experienceCustomOfferReviewedByUserId: reviewerId,
          experienceCustomOfferReviewedAt: now,
        });
        return res.json(updated);
      }

      if (action === "decline") {
        const declineReason = typeof req.body?.declineReason === "string" ? req.body.declineReason.trim() : "";
        if (declineReason.length < 5) {
          return res.status(400).json({ error: "Please provide a short reason for declining this request." });
        }

        const updated = await storage.updateBooking(req.params.id, {
          experienceCustomOfferStatus: "declined",
          experienceCustomOfferAmount: null,
          experienceCustomOfferMessage: null,
          experienceCustomOfferDeclineReason: declineReason,
          experienceCustomOfferClientDecision: "pending",
          experienceCustomOfferClientRespondedAt: null,
          experienceCustomOfferReviewedByUserId: reviewerId,
          experienceCustomOfferReviewedAt: now,
          status: "cancelled",
        });
        return res.json(updated);
      }

      if (action === "reopen") {
        const updated = await storage.updateBooking(req.params.id, {
          experienceCustomOfferStatus: "pending",
          experienceCustomOfferReviewedByUserId: null,
          experienceCustomOfferReviewedAt: null,
        });
        return res.json(updated);
      }

      return res.status(400).json({ error: "Invalid custom offer action." });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to review custom offer" });
    }
  });

  app.delete("/api/admin/bookings/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteBooking(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Booking not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete booking" });
    }
  });

  // Admin Blog Management
  app.get("/api/admin/blog", requireAdmin, async (_req, res) => {
    try {
      const posts = await storage.getBlogPosts();
      res.json(posts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch blog posts" });
    }
  });

  app.get("/api/admin/blog/:id", requireAdmin, async (req, res) => {
    try {
      const post = await storage.getBlogPost(req.params.id);
      if (!post) {
        return res.status(404).json({ error: "Blog post not found" });
      }
      res.json(post);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch blog post" });
    }
  });

  app.post("/api/admin/blog", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertBlogPostSchema.parse(req.body);
      const blogPost = await storage.createBlogPost(validatedData);
      res.status(201).json(blogPost);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create blog post" });
      }
    }
  });

  app.patch("/api/admin/blog/:id", requireAdmin, async (req, res) => {
    try {
      const blogPost = await storage.updateBlogPost(req.params.id, req.body);
      if (!blogPost) {
        return res.status(404).json({ error: "Blog post not found" });
      }
      res.json(blogPost);
    } catch (error) {
      res.status(500).json({ error: "Failed to update blog post" });
    }
  });

  app.delete("/api/admin/blog/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteBlogPost(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Blog post not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete blog post" });
    }
  });

  // Admin Listings Management
  app.get("/api/admin/listings", requireAdmin, async (_req, res) => {
    try {
      const listings = await storage.getListings();
      res.json(listings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch listings" });
    }
  });

  app.get("/api/admin/listings/:id", requireAdmin, async (req, res) => {
    try {
      const listing = await storage.getListing(req.params.id);
      if (!listing) {
        return res.status(404).json({ error: "Listing not found" });
      }
      res.json(listing);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch listing" });
    }
  });

  app.post("/api/admin/listings", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertListingSchema.parse(req.body);
      const listing = await storage.createListing(validatedData);
      res.status(201).json(listing);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create listing" });
      }
    }
  });

  app.patch("/api/admin/listings/:id", requireAdmin, async (req, res) => {
    try {
      const listing = await storage.updateListing(req.params.id, req.body);
      if (!listing) {
        return res.status(404).json({ error: "Listing not found" });
      }
      res.json(listing);
    } catch (error) {
      res.status(500).json({ error: "Failed to update listing" });
    }
  });

  app.delete("/api/admin/listings/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteListing(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Listing not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete listing" });
    }
  });

  // ===== NEW SEPARATE SERVICE ROUTES =====
  
  // Stays - Admin Routes
  app.get("/api/admin/stays", requireAdmin, async (_req, res) => {
    try {
      const stays = await storage.getStays();
      res.json(stays);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stays" });
    }
  });

  app.get("/api/admin/stays/:id", requireAdmin, async (req, res) => {
    try {
      const stay = await storage.getStay(req.params.id);
      if (!stay) {
        return res.status(404).json({ error: "Stay not found" });
      }
      res.json(stay);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stay" });
    }
  });

  app.post("/api/admin/stays", requireAdmin, async (req: any, res) => {
    try {
      const validatedData = ensurePublicListingHasManager(
        insertStaySchema.parse(req.body),
        req.user?.claims?.sub,
      );
      const stay = await storage.createStay(validatedData);
      res.status(201).json(stay);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to create stay:", error);
        res.status(500).json({ error: "Failed to create stay" });
      }
    }
  });

  app.patch("/api/admin/stays/:id", requireAdmin, async (req: any, res) => {
    try {
      const existingStay = await storage.getStay(req.params.id);
      if (!existingStay) {
        return res.status(404).json({ error: "Stay not found" });
      }

      const validatedData = mergeManagerAssignment(
        req.body,
        insertStaySchema.partial().parse(req.body),
        existingStay.managerUserId,
        req.user?.claims?.sub,
      );
      const stay = await storage.updateStay(req.params.id, validatedData);
      if (stay) {
        await syncRelatedServiceBookings("stays", stay.id, {
          notifyProviders: existingStay.managerUserId !== stay.managerUserId,
        });
      }
      res.json(stay);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to update stay:", error);
        res.status(500).json({ error: "Failed to update stay" });
      }
    }
  });

  app.delete("/api/admin/stays/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteStay(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Stay not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete stay" });
    }
  });

  app.get("/api/admin/stays/:id/availability", requireAdmin, async (req, res) => {
    try {
      const stay = await storage.getStay(req.params.id);
      if (!stay) {
        return res.status(404).json({ error: "Stay not found" });
      }

      res.json(await getStayAvailabilitySummary(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stay availability" });
    }
  });

  app.get("/api/provider/assignments", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const role = req.user.claims.role;

      if (role === "admin") {
        return res.json({
          stays: await storage.getStays(),
          cars: await storage.getCars(),
          cooks: await storage.getCooks(),
          errands: await storage.getErrands(),
          experiences: await storage.getExperiences(),
        });
      }

      res.json({
        stays: await storage.getStaysByManagerUserId(userId),
        cars: (await storage.getCars()).filter((car) => car.managerUserId === userId),
        cooks: (await storage.getCooks()).filter((cook) => cook.managerUserId === userId),
        errands: (await storage.getErrands()).filter((errand) => errand.managerUserId === userId),
        experiences: (await storage.getExperiences()).filter((experience) => experience.managerUserId === userId),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider assignments" });
    }
  });

  app.get("/api/provider/booking-assignments", requireProviderOrAdmin, async (req: any, res) => {
    try {
      await storage.syncBookingServiceAssignments();

      const currentUserId = req.user.claims.sub;
      const currentUserRole = req.user.claims.role;
      const [allAssignments, allBookings] = await Promise.all([
        storage.getBookingServiceAssignments(),
        storage.getBookings(),
      ]);
      const bookingMap = new Map(allBookings.map((booking) => [booking.id, booking]));
      const visibleAssignments = allAssignments
        .filter((assignment) => currentUserRole === "admin" || assignment.providerUserId === currentUserId)
        .map((assignment) => {
          const booking = bookingMap.get(assignment.bookingId);
          if (!booking) {
            return null;
          }

          return decorateProviderAssignmentView(assignment, booking);
        })
        .filter((entry): entry is ProviderBookingAssignmentView => Boolean(entry))
        .sort((a, b) => {
          const statusWeight = (status: string) => (status === "completed" || status === "cancelled" ? 1 : 0);
          const archivedDelta = statusWeight(a.assignment.status) - statusWeight(b.assignment.status);
          if (archivedDelta !== 0) {
            return archivedDelta;
          }

          return a.booking.checkIn.localeCompare(b.booking.checkIn);
        });

      res.json(visibleAssignments);
    } catch (error) {
      console.error("[PROVIDER] Failed to fetch provider booking assignments:", error);
      res.status(500).json({ error: "Failed to fetch provider booking assignments" });
    }
  });

  app.patch("/api/provider/booking-assignments/:id/status", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await getVisibleProviderAssignment(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const requestedStatus = req.body?.status;
      if (requestedStatus !== "in-progress" && requestedStatus !== "completed") {
        return res.status(400).json({ error: "Partners can only mark assignments as in progress or completed." });
      }

      const result = await applyProviderAssignmentStatusUpdate(access.assignment, access.booking, requestedStatus);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }

      res.json(result.assignment);
    } catch (error) {
      console.error("[PROVIDER] Failed to update provider assignment:", error);
      res.status(500).json({ error: "Failed to update provider assignment" });
    }
  });

  app.patch("/api/provider/booking-assignments/:id/custom-menu-proposal", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await getVisibleProviderAssignment(req, req.params.id);
      if ("error" in access) {
        const error = access.error!;
        return res.status(error.status).json(error.body);
      }

      const booking = access.booking;
      if (access.assignment.providerCategory !== "cooks" || !isCustomMenuBooking(booking)) {
        return res.status(400).json({ error: "Only custom menu requests can be reviewed here." });
      }

      const action = req.body?.action;

      if (action === "propose") {
        const proposedAmount = Number(req.body?.proposedAmount);
        const proposalMessage = typeof req.body?.proposalMessage === "string" ? req.body.proposalMessage.trim() : "";
        if (!Number.isFinite(proposedAmount) || proposedAmount <= 0) {
          return res.status(400).json({ error: "Enter the full quoted total for this custom menu." });
        }

        const updatedBooking = await storage.updateBooking(booking.id, {
          customMenuProposalStatus: "pending-admin-approval",
          customMenuProposedAmount: Math.round(proposedAmount),
          customMenuProposalMessage: proposalMessage || null,
          customMenuDeclineReason: null,
          customMenuClientDecision: "pending",
          customMenuClientRespondedAt: null,
          customMenuCreditCode: null,
          customMenuCreditAmount: null,
          customMenuReviewedByUserId: null,
          customMenuReviewedAt: null,
        });
        return res.json(updatedBooking);
      }

      if (action === "decline") {
        const declineReason = typeof req.body?.declineReason === "string" ? req.body.declineReason.trim() : "";
        if (declineReason.length < 5) {
          return res.status(400).json({ error: "Please provide a short reason for declining this request." });
        }

        const updatedBooking = await storage.updateBooking(booking.id, {
          customMenuProposalStatus: "pending-admin-approval",
          customMenuProposedAmount: null,
          customMenuProposalMessage: null,
          customMenuDeclineReason: declineReason,
          customMenuClientDecision: "pending",
          customMenuClientRespondedAt: null,
          customMenuCreditCode: null,
          customMenuCreditAmount: null,
          customMenuReviewedByUserId: null,
          customMenuReviewedAt: null,
        });
        return res.json(updatedBooking);
      }

      return res.status(400).json({ error: "Invalid proposal action." });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to review custom menu request" });
    }
  });

  app.patch("/api/provider/booking-assignments/:id/experience-custom-offer", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await getVisibleProviderAssignment(req, req.params.id);
      if ("error" in access) {
        const error = access.error!;
        return res.status(error.status).json(error.body);
      }

      const booking = access.booking;
      if (access.assignment.providerCategory !== "experiences" || !isExperienceCustomOfferBooking(booking)) {
        return res.status(400).json({ error: "Only experience custom offers can be reviewed here." });
      }

      const action = req.body?.action;

      if (action === "propose") {
        const proposedAmount = Number(req.body?.proposedAmount);
        const proposalMessage = typeof req.body?.proposalMessage === "string" ? req.body.proposalMessage.trim() : "";
        if (!Number.isFinite(proposedAmount) || proposedAmount <= 0) {
          return res.status(400).json({ error: "Enter the total amount for this custom offer." });
        }

        const updatedBooking = await storage.updateBooking(booking.id, {
          experienceCustomOfferStatus: "pending-admin-approval",
          experienceCustomOfferAmount: Math.round(proposedAmount),
          experienceCustomOfferMessage: proposalMessage || null,
          experienceCustomOfferDeclineReason: null,
          experienceCustomOfferClientDecision: "pending",
          experienceCustomOfferClientRespondedAt: null,
          experienceCustomOfferReviewedByUserId: null,
          experienceCustomOfferReviewedAt: null,
        });
        return res.json(updatedBooking);
      }

      if (action === "decline") {
        const declineReason = typeof req.body?.declineReason === "string" ? req.body.declineReason.trim() : "";
        if (declineReason.length < 5) {
          return res.status(400).json({ error: "Please provide a short reason for declining this request." });
        }

        const updatedBooking = await storage.updateBooking(booking.id, {
          experienceCustomOfferStatus: "pending-admin-approval",
          experienceCustomOfferAmount: null,
          experienceCustomOfferMessage: null,
          experienceCustomOfferDeclineReason: declineReason,
          experienceCustomOfferClientDecision: "pending",
          experienceCustomOfferClientRespondedAt: null,
          experienceCustomOfferReviewedByUserId: null,
          experienceCustomOfferReviewedAt: null,
        });
        return res.json(updatedBooking);
      }

      return res.status(400).json({ error: "Invalid custom offer action." });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to review custom offer" });
    }
  });

  app.get("/api/provider/notifications", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const currentUserRole = req.user.claims.role;
      if (currentUserRole === "admin") {
        return res.json([]);
      }

      res.json(await storage.getProviderNotifications(req.user.claims.sub));
    } catch (error) {
      console.error("[PROVIDER] Failed to fetch provider notifications:", error);
      res.status(500).json({ error: "Failed to fetch provider notifications" });
    }
  });

  app.patch("/api/provider/notifications/:id/read", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const currentUserRole = req.user.claims.role;
      if (currentUserRole === "admin") {
        return res.status(404).json({ error: "Notification not found" });
      }

      const updated = await storage.markProviderNotificationRead(req.params.id, req.user.claims.sub);
      if (!updated) {
        return res.status(404).json({ error: "Notification not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("[PROVIDER] Failed to update provider notification:", error);
      res.status(500).json({ error: "Failed to update provider notification" });
    }
  });

  app.get("/api/provider/stay-bookings", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const stays = req.user.claims.role === "admin"
        ? await storage.getStays()
        : await storage.getStaysByManagerUserId(userId);
      const stayIds = new Set(stays.map((stay) => stay.id));
      const bookings = (await storage.getBookings()).filter((booking) =>
        booking.accommodationId && stayIds.has(booking.accommodationId),
      );
      res.json(bookings.map(decorateBookingWithOperationalStatus));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider stay bookings" });
    }
  });

  app.get("/api/provider/car-bookings", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const cars = req.user.claims.role === "admin"
        ? await storage.getCars()
        : (await storage.getCars()).filter((car) => car.managerUserId === userId);
      const carIds = new Set(cars.map((car) => car.id));
      const bookings = (await storage.getBookings()).filter((booking) =>
        booking.selectedServices.some((serviceId) => carIds.has(serviceId)),
      );
      res.json(bookings.map(decorateBookingWithOperationalStatus));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider car bookings" });
    }
  });

  app.get("/api/provider/cook-bookings", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const cooks = req.user.claims.role === "admin"
        ? await storage.getCooks()
        : (await storage.getCooks()).filter((cook) => cook.managerUserId === userId);
      const cookIds = new Set(cooks.map((cook) => cook.id));
      const bookings = (await storage.getBookings()).filter((booking) =>
        booking.selectedServices.some((serviceId) => cookIds.has(serviceId)),
      );
      res.json(bookings.map(decorateBookingWithOperationalStatus));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider cook bookings" });
    }
  });

  app.get("/api/provider/errand-bookings", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const errands = req.user.claims.role === "admin"
        ? await storage.getErrands()
        : (await storage.getErrands()).filter((errand) => errand.managerUserId === userId);
      const errandIds = new Set(errands.map((errand) => errand.id));
      const bookings = (await storage.getBookings()).filter((booking) =>
        booking.selectedServices.some((serviceId) => errandIds.has(serviceId)),
      );
      res.json(bookings.map(decorateBookingWithOperationalStatus));
    } catch (error) {
      console.error("[PROVIDER] Failed to fetch errand bookings:", error);
      res.status(500).json({ error: "Failed to fetch provider errand bookings" });
    }
  });

  app.get("/api/provider/experience-bookings", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const experiences = req.user.claims.role === "admin"
        ? await storage.getExperiences()
        : (await storage.getExperiences()).filter((experience) => experience.managerUserId === userId);
      const experienceIds = new Set(experiences.map((experience) => experience.id));
      const bookings = (await storage.getBookings()).filter((booking) =>
        booking.selectedServices.some((serviceId) => experienceIds.has(serviceId)),
      );
      res.json(bookings.map(decorateBookingWithOperationalStatus));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider experience bookings" });
    }
  });

  app.patch("/api/provider/bookings/:id/status", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertCanAccessBookingThread(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const requestedStatus = req.body?.status;
      if (requestedStatus !== "in-progress" && requestedStatus !== "completed") {
        return res.status(400).json({ error: "Partners can only mark orders as in progress or completed." });
      }

      const result = await applyProviderBookingStatusUpdate(req.params.id, access.booking, requestedStatus);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }

      res.json(result.booking);
    } catch (error) {
      res.status(500).json({ error: "Failed to update booking status" });
    }
  });

  app.patch("/api/provider/car-bookings/:id/status", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      const currentUserId = req.user.claims.sub;
      const currentUserRole = req.user.claims.role;
      const assignedCars = currentUserRole === "admin"
        ? await storage.getCars()
        : (await storage.getCars()).filter((car) => car.managerUserId === currentUserId);
      const assignedCarIds = new Set(assignedCars.map((car) => car.id));
      const canAccess = booking.selectedServices.some((serviceId) => assignedCarIds.has(serviceId));
      if (!canAccess) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const status = req.body?.status;
      if (status !== "in-progress" && status !== "completed") {
        return res.status(400).json({ error: "Partners can only mark car bookings as in progress or completed." });
      }

      const result = await applyProviderBookingStatusUpdate(req.params.id, booking, status);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }

      res.json(result.booking);
    } catch (error) {
      res.status(500).json({ error: "Failed to update booking status" });
    }
  });

  app.patch("/api/provider/cook-bookings/:id/status", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      const currentUserId = req.user.claims.sub;
      const currentUserRole = req.user.claims.role;
      const assignedCooks = currentUserRole === "admin"
        ? await storage.getCooks()
        : (await storage.getCooks()).filter((cook) => cook.managerUserId === currentUserId);
      const assignedCookIds = new Set(assignedCooks.map((cook) => cook.id));
      const canAccess = booking.selectedServices.some((serviceId) => assignedCookIds.has(serviceId));

      if (!canAccess) {
        return res.status(403).json({ error: "Forbidden - Cook booking not assigned to this provider" });
      }

      const requestedStatus = req.body?.status;
      if (requestedStatus !== "in-progress" && requestedStatus !== "completed") {
        return res.status(400).json({ error: "Partners can only mark chef bookings as in progress or completed." });
      }

      const result = await applyProviderBookingStatusUpdate(req.params.id, booking, requestedStatus);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }

      res.json(result.booking);
    } catch (error) {
      res.status(500).json({ error: "Failed to update booking status" });
    }
  });

  app.patch("/api/provider/cook-bookings/:id/proposal", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCookBooking(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const booking = access.booking;
      if (!isCustomMenuBooking(booking)) {
        return res.status(400).json({ error: "Only custom menu requests can be reviewed here." });
      }

      const action = req.body?.action;

      if (action === "propose") {
        const proposedAmount = Number(req.body?.proposedAmount);
        const proposalMessage = typeof req.body?.proposalMessage === "string" ? req.body.proposalMessage.trim() : "";
        if (!Number.isFinite(proposedAmount) || proposedAmount <= 0) {
          return res.status(400).json({ error: "Enter the full quoted total for this custom menu." });
        }

        const updated = await storage.updateBooking(req.params.id, {
          customMenuProposalStatus: "pending-admin-approval",
          customMenuProposedAmount: Math.round(proposedAmount),
          customMenuProposalMessage: proposalMessage || null,
          customMenuDeclineReason: null,
          customMenuClientDecision: "pending",
          customMenuClientRespondedAt: null,
          customMenuCreditCode: null,
          customMenuCreditAmount: null,
          customMenuReviewedByUserId: null,
          customMenuReviewedAt: null,
        });
        return res.json(updated);
      }

      if (action === "decline") {
        const declineReason = typeof req.body?.declineReason === "string" ? req.body.declineReason.trim() : "";
        if (declineReason.length < 5) {
          return res.status(400).json({ error: "Please provide a short reason for declining this request." });
        }

        const updated = await storage.updateBooking(req.params.id, {
          customMenuProposalStatus: "pending-admin-approval",
          customMenuProposedAmount: null,
          customMenuProposalMessage: null,
          customMenuDeclineReason: declineReason,
          customMenuClientDecision: "pending",
          customMenuClientRespondedAt: null,
          customMenuCreditCode: null,
          customMenuCreditAmount: null,
          customMenuReviewedByUserId: null,
          customMenuReviewedAt: null,
        });
        return res.json(updated);
      }

      return res.status(400).json({ error: "Invalid proposal action." });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to review custom menu request" });
    }
  });

  app.patch("/api/provider/experience-bookings/:id/custom-offer", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessExperienceBooking(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const booking = access.booking;
      if (!isExperienceCustomOfferBooking(booking)) {
        return res.status(400).json({ error: "Only experience custom offers can be reviewed here." });
      }

      const action = req.body?.action;
      const now = new Date().toISOString();
      const reviewerId = req.user.claims.sub;

      if (action === "propose") {
        const proposedAmount = Number(req.body?.proposedAmount);
        const proposalMessage = typeof req.body?.proposalMessage === "string" ? req.body.proposalMessage.trim() : "";
        if (!Number.isFinite(proposedAmount) || proposedAmount <= 0) {
          return res.status(400).json({ error: "Enter the total amount for this custom offer." });
        }

        const updated = await storage.updateBooking(req.params.id, {
          experienceCustomOfferStatus: "pending-admin-approval",
          experienceCustomOfferAmount: Math.round(proposedAmount),
          experienceCustomOfferMessage: proposalMessage || null,
          experienceCustomOfferDeclineReason: null,
          experienceCustomOfferClientDecision: "pending",
          experienceCustomOfferClientRespondedAt: null,
          experienceCustomOfferReviewedByUserId: null,
          experienceCustomOfferReviewedAt: null,
        });
        return res.json(updated);
      }

      if (action === "decline") {
        const declineReason = typeof req.body?.declineReason === "string" ? req.body.declineReason.trim() : "";
        if (declineReason.length < 5) {
          return res.status(400).json({ error: "Please provide a short reason for declining this request." });
        }

        const updated = await storage.updateBooking(req.params.id, {
          experienceCustomOfferStatus: "pending-admin-approval",
          experienceCustomOfferAmount: null,
          experienceCustomOfferMessage: null,
          experienceCustomOfferDeclineReason: declineReason,
          experienceCustomOfferClientDecision: "pending",
          experienceCustomOfferClientRespondedAt: null,
          experienceCustomOfferReviewedByUserId: null,
          experienceCustomOfferReviewedAt: null,
        });
        return res.json(updated);
      }

      return res.status(400).json({ error: "Invalid custom offer action." });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to review custom offer" });
    }
  });

  app.post("/api/provider/errands", requireProviderOrAdmin, async (req: any, res) => {
    try {
      if (req.user.claims.role !== "admin" && !hasProviderCategory(req.user.claims, "errands")) {
        return res.status(403).json({ error: "Only errand providers can create errand listings." });
      }

      const validatedData = insertErrandSchema.parse({
        ...req.body,
        managerUserId: req.user.claims.sub,
        isPublic: false,
      });
      const errand = await storage.createErrand(validatedData);
      res.status(201).json(errand);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create errand" });
      }
    }
  });

  app.get("/api/provider/errands/:id", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const errand = await storage.getErrand(req.params.id);
      if (!errand) {
        return res.status(404).json({ error: "Errand not found" });
      }
      if (req.user.claims.role !== "admin" && errand.managerUserId !== req.user.claims.sub) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(errand);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider errand" });
    }
  });

  app.patch("/api/provider/errands/:id", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const errand = await storage.getErrand(req.params.id);
      if (!errand) {
        return res.status(404).json({ error: "Errand not found" });
      }
      if (req.user.claims.role !== "admin" && errand.managerUserId !== req.user.claims.sub) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const parsed = insertErrandSchema.partial().parse(req.body);
      const updatedErrand = await storage.updateErrand(req.params.id, {
        ...parsed,
        isPublic: false,
      });
      res.json(updatedErrand);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to update errand" });
      }
    }
  });

  app.post("/api/provider/experiences", requireProviderOrAdmin, async (req: any, res) => {
    try {
      if (req.user.claims.role !== "admin" && !hasProviderCategory(req.user.claims, "experiences")) {
        return res.status(403).json({ error: "Only experience providers can create experience listings." });
      }

      const validatedData = insertExperienceSchema.parse({
        ...req.body,
        managerUserId: req.user.claims.sub,
        isPublic: false,
      });
      res.status(201).json(await storage.createExperience(validatedData));
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create experience" });
      }
    }
  });

  app.get("/api/provider/experiences/:id", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const experience = await storage.getExperience(req.params.id);
      if (!experience) {
        return res.status(404).json({ error: "Experience not found" });
      }
      if (req.user.claims.role !== "admin" && experience.managerUserId !== req.user.claims.sub) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(experience);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider experience" });
    }
  });

  app.patch("/api/provider/experiences/:id", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const experience = await storage.getExperience(req.params.id);
      if (!experience) {
        return res.status(404).json({ error: "Experience not found" });
      }
      if (req.user.claims.role !== "admin" && experience.managerUserId !== req.user.claims.sub) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const validatedData = insertExperienceSchema.partial().parse({
        ...req.body,
        isPublic: false,
      });
      res.json(await storage.updateExperience(req.params.id, validatedData));
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to update experience" });
      }
    }
  });

  app.post("/api/provider/cars", requireProviderOrAdmin, async (req: any, res) => {
    try {
      if (req.user.claims.role !== "admin" && !hasProviderCategory(req.user.claims, "cars")) {
        return res.status(403).json({ error: "Only car providers can create car listings." });
      }

      const validatedData = insertCarSchema.parse({
        ...req.body,
        managerUserId: req.user.claims.sub,
        isPublic: false,
      });
      const car = await storage.createCar(validatedData);
      res.status(201).json(car);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create car" });
      }
    }
  });

  app.get("/api/provider/cars/:id", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCar(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      res.json(access.car);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider car" });
    }
  });

  app.patch("/api/provider/cars/:id", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCar(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const parsed = insertCarSchema.partial().parse(req.body);
      const {
        model,
        location,
        pricePerDay,
        priceWithDriver,
        priceWithDriverHourly,
        seats,
        transmission,
        description,
        imageUrl,
        galleryUrls,
        mediaType,
        features,
      } = parsed;

      const updatedCar = await storage.updateCar(req.params.id, {
        model,
        location,
        pricePerDay,
        priceWithDriver,
        priceWithDriverHourly,
        seats,
        transmission,
        description,
        imageUrl,
        galleryUrls,
        mediaType,
        features,
        isPublic: false,
      });

      res.json(updatedCar);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to update car" });
      }
    }
  });

  app.post("/api/provider/stays", requireProviderOrAdmin, async (req: any, res) => {
    try {
      if (req.user.claims.role !== "admin" && !hasProviderCategory(req.user.claims, "stays")) {
        return res.status(403).json({ error: "Only stay providers can create stay listings." });
      }

      const validatedData = insertStaySchema.parse({
        ...req.body,
        managerUserId: req.user.claims.sub,
        isPublic: false,
      });
      const stay = await storage.createStay(validatedData);
      res.status(201).json(stay);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create stay" });
      }
    }
  });

  app.get("/api/provider/stays/:id", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessStay(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      res.json(access.stay);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider stay" });
    }
  });

  app.patch("/api/provider/stays/:id", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessStay(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const parsed = insertStaySchema.partial().parse(req.body);
      const {
        title,
        location,
        description,
        price,
        maxOccupancy,
        bedrooms,
        bathrooms,
        imageUrl,
        galleryUrls,
        mediaType,
        features,
      } = parsed;

      const updatedStay = await storage.updateStay(req.params.id, {
        title,
        location,
        description,
        price,
        maxOccupancy,
        bedrooms,
        bathrooms,
        imageUrl,
        galleryUrls,
        mediaType,
        features,
        isPublic: false,
      });

      res.json(updatedStay);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to update stay" });
      }
    }
  });

  app.post("/api/provider/cooks", requireProviderOrAdmin, async (req: any, res) => {
    try {
      if (req.user.claims.role !== "admin" && !hasProviderCategory(req.user.claims, "cooks")) {
        return res.status(403).json({ error: "Only cook providers can create chef listings." });
      }

      const validatedData = insertCookSchema.parse({
        ...req.body,
        managerUserId: req.user.claims.sub,
        isPublic: false,
      });
      const cook = await storage.createCook(validatedData);
      res.status(201).json(cook);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create cook" });
      }
    }
  });

  app.get("/api/provider/cooks/:id", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCook(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      res.json(access.cook);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider cook" });
    }
  });

  app.patch("/api/provider/cooks/:id", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCook(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const parsed = insertCookSchema.partial().parse(req.body);
      const {
        title,
        location,
        serviceType,
        speciality,
        maxGuests,
        minimumGuests,
        pricePerSession,
        serviceFee,
        inclusivePrice,
        extraGuestServiceFee,
        extraGuestInclusivePrice,
        ingredientsIncluded,
        shoppingIncluded,
        customMenuEnabled,
        customMenuRequestFee,
        customMenuRequestFeeKes,
        description,
        sampleMenus,
        imageUrl,
        galleryUrls,
        mediaType,
        features,
      } = parsed;

      const updatedCook = await storage.updateCook(req.params.id, {
        title,
        location,
        serviceType,
        speciality,
        maxGuests,
        minimumGuests,
        pricePerSession,
        serviceFee,
        inclusivePrice,
        extraGuestServiceFee,
        extraGuestInclusivePrice,
        ingredientsIncluded,
        shoppingIncluded,
        customMenuEnabled,
        customMenuRequestFee,
        customMenuRequestFeeKes,
        description,
        sampleMenus,
        imageUrl,
        galleryUrls,
        mediaType,
        features,
        isPublic: false,
      });

      res.json(updatedCook);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to update cook" });
      }
    }
  });

  app.get("/api/provider/stays/:id/availability", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessStay(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      res.json(await getStayAvailabilitySummary(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stay availability" });
    }
  });

  app.post("/api/admin/stays/:id/availability/blocks", requireAdmin, async (req, res) => {
    try {
      const stay = await storage.getStay(req.params.id);
      if (!stay) {
        return res.status(404).json({ error: "Stay not found" });
      }

      const validatedData = insertStayReservationSchema.parse({
        ...req.body,
        stayId: req.params.id,
        status: "blocked",
      });

      if (normalizeDateOnly(validatedData.endDate).getTime() < normalizeDateOnly(validatedData.startDate).getTime()) {
        return res.status(400).json({ error: "End date cannot be before start date" });
      }

      const activeBookings = await storage.getBookingsByAccommodationId(req.params.id);
      const bookingConflict = activeBookings.some((booking) =>
        shouldBookingBlockAvailability(booking) &&
        datesOverlapDateRange(
          validatedData.startDate,
          validatedData.endDate,
          booking.checkIn,
          toIsoDate(getOccupiedEndDate(booking.checkIn, booking.checkOut)),
        ),
      );

      if (bookingConflict) {
        return res.status(409).json({ error: "That date range already has a customer booking." });
      }

      const existingBlocks = await storage.getStayReservations(req.params.id);
      const blockConflict = existingBlocks.some((reservation) =>
        reservation.status === "blocked" &&
        datesOverlapDateRange(
          validatedData.startDate,
          validatedData.endDate,
          reservation.startDate,
          reservation.endDate,
        ),
      );

      if (blockConflict) {
        return res.status(409).json({ error: "That date range is already blocked." });
      }

      const reservation = await storage.createStayReservation(validatedData);
      res.status(201).json(reservation);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create availability block" });
      }
    }
  });

  app.delete("/api/admin/stays/:id/availability/blocks/:blockId", requireAdmin, async (req, res) => {
    try {
      const reservations = await storage.getStayReservations(req.params.id);
      const reservation = reservations.find((entry) => entry.id === req.params.blockId);
      if (!reservation) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      const deleted = await storage.deleteStayReservation(req.params.blockId);
      if (!deleted) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete availability block" });
    }
  });

  app.post("/api/provider/stays/:id/availability/blocks", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessStay(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const validatedData = insertStayReservationSchema.parse({
        ...req.body,
        stayId: req.params.id,
        status: "blocked",
      });

      if (normalizeDateOnly(validatedData.endDate).getTime() < normalizeDateOnly(validatedData.startDate).getTime()) {
        return res.status(400).json({ error: "End date cannot be before start date" });
      }

      const activeBookings = await storage.getBookingsByAccommodationId(req.params.id);
      const bookingConflict = activeBookings.some((booking) =>
        shouldBookingBlockAvailability(booking) &&
        datesOverlapDateRange(
          validatedData.startDate,
          validatedData.endDate,
          booking.checkIn,
          toIsoDate(getOccupiedEndDate(booking.checkIn, booking.checkOut)),
        ),
      );

      if (bookingConflict) {
        return res.status(409).json({ error: "That date range already has a customer booking." });
      }

      const existingBlocks = await storage.getStayReservations(req.params.id);
      const blockConflict = existingBlocks.some((reservation) =>
        reservation.status === "blocked" &&
        datesOverlapDateRange(
          validatedData.startDate,
          validatedData.endDate,
          reservation.startDate,
          reservation.endDate,
        ),
      );

      if (blockConflict) {
        return res.status(409).json({ error: "That date range is already blocked." });
      }

      const reservation = await storage.createStayReservation(validatedData);
      res.status(201).json(reservation);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create availability block" });
      }
    }
  });

  app.delete("/api/provider/stays/:id/availability/blocks/:blockId", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessStay(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const reservations = await storage.getStayReservations(req.params.id);
      const reservation = reservations.find((entry) => entry.id === req.params.blockId);
      if (!reservation) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      const deleted = await storage.deleteStayReservation(req.params.blockId);
      if (!deleted) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete availability block" });
    }
  });

  // Cars - Admin Routes
  app.get("/api/admin/cars", requireAdmin, async (_req, res) => {
    try {
      const cars = await storage.getCars();
      res.json(cars);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cars" });
    }
  });

  app.get("/api/admin/cars/:id", requireAdmin, async (req, res) => {
    try {
      const car = await storage.getCar(req.params.id);
      if (!car) {
        return res.status(404).json({ error: "Car not found" });
      }
      res.json(car);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch car" });
    }
  });

  app.post("/api/admin/cars", requireAdmin, async (req: any, res) => {
    try {
      const validatedData = ensurePublicListingHasManager(
        insertCarSchema.parse(req.body),
        req.user?.claims?.sub,
      );
      const car = await storage.createCar(validatedData);
      res.status(201).json(car);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to create car:", error);
        res.status(500).json({ error: "Failed to create car" });
      }
    }
  });

  app.patch("/api/admin/cars/:id", requireAdmin, async (req: any, res) => {
    try {
      const existingCar = await storage.getCar(req.params.id);
      if (!existingCar) {
        return res.status(404).json({ error: "Car not found" });
      }

      const validatedData = mergeManagerAssignment(
        req.body,
        insertCarSchema.partial().parse(req.body),
        existingCar.managerUserId,
        req.user?.claims?.sub,
      );
      const car = await storage.updateCar(req.params.id, validatedData);
      if (car) {
        await syncRelatedServiceBookings("cars", car.id, {
          notifyProviders: existingCar.managerUserId !== car.managerUserId,
        });
      }
      res.json(car);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to update car:", error);
        res.status(500).json({ error: "Failed to update car" });
      }
    }
  });

  app.delete("/api/admin/cars/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteCar(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Car not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete car" });
    }
  });

  app.get("/api/admin/cars/:id/availability", requireAdmin, async (req, res) => {
    try {
      const car = await storage.getCar(req.params.id);
      if (!car) {
        return res.status(404).json({ error: "Car not found" });
      }

      res.json(await getCarAvailabilitySummary(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch car availability" });
    }
  });

  app.post("/api/admin/cars/:id/availability/blocks", requireAdmin, async (req, res) => {
    try {
      const car = await storage.getCar(req.params.id);
      if (!car) {
        return res.status(404).json({ error: "Car not found" });
      }

      const validatedData = insertCarReservationSchema.parse({
        ...req.body,
        carId: req.params.id,
        status: "blocked",
      });

      if (normalizeDateOnly(validatedData.endDate).getTime() < normalizeDateOnly(validatedData.startDate).getTime()) {
        return res.status(400).json({ error: "End date cannot be before start date" });
      }

      const availability = await getCarAvailabilitySummary(req.params.id);
      const conflict = availability.blockedRanges.some((range) =>
        datesOverlapDateRange(validatedData.startDate, validatedData.endDate, range.startDate, range.endDate),
      );

      if (conflict) {
        return res.status(409).json({ error: "That date range is already unavailable." });
      }

      const reservation = await storage.createCarReservation(validatedData);
      res.status(201).json(reservation);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create availability block" });
      }
    }
  });

  app.delete("/api/admin/cars/:id/availability/blocks/:blockId", requireAdmin, async (req, res) => {
    try {
      const reservations = await storage.getCarReservations(req.params.id);
      const reservation = reservations.find((entry) => entry.id === req.params.blockId);
      if (!reservation) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      const deleted = await storage.deleteCarReservation(req.params.blockId);
      if (!deleted) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete availability block" });
    }
  });

  app.get("/api/provider/cars/:id/availability", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCar(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      res.json(await getCarAvailabilitySummary(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch car availability" });
    }
  });

  app.post("/api/provider/cars/:id/availability/blocks", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCar(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const validatedData = insertCarReservationSchema.parse({
        ...req.body,
        carId: req.params.id,
        status: "blocked",
      });

      if (normalizeDateOnly(validatedData.endDate).getTime() < normalizeDateOnly(validatedData.startDate).getTime()) {
        return res.status(400).json({ error: "End date cannot be before start date" });
      }

      const availability = await getCarAvailabilitySummary(req.params.id);
      const conflict = availability.blockedRanges.some((range) =>
        datesOverlapDateRange(validatedData.startDate, validatedData.endDate, range.startDate, range.endDate),
      );

      if (conflict) {
        return res.status(409).json({ error: "That date range is already unavailable." });
      }

      const reservation = await storage.createCarReservation(validatedData);
      res.status(201).json(reservation);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create availability block" });
      }
    }
  });

  app.delete("/api/provider/cars/:id/availability/blocks/:blockId", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCar(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const reservations = await storage.getCarReservations(req.params.id);
      const reservation = reservations.find((entry) => entry.id === req.params.blockId);
      if (!reservation) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      const deleted = await storage.deleteCarReservation(req.params.blockId);
      if (!deleted) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete availability block" });
    }
  });

  app.get("/api/admin/cooks/:id/availability", requireAdmin, async (req, res) => {
    try {
      const cook = await storage.getCook(req.params.id);
      if (!cook) {
        return res.status(404).json({ error: "Cook not found" });
      }

      res.json(await getCookAvailabilitySummary(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cook availability" });
    }
  });

  app.post("/api/admin/cooks/:id/availability/blocks", requireAdmin, async (req, res) => {
    try {
      const cook = await storage.getCook(req.params.id);
      if (!cook) {
        return res.status(404).json({ error: "Cook not found" });
      }

      const validatedData = insertCookReservationSchema.parse({
        ...req.body,
        cookId: req.params.id,
        status: "blocked",
      });

      if (normalizeDateOnly(validatedData.endDate).getTime() < normalizeDateOnly(validatedData.startDate).getTime()) {
        return res.status(400).json({ error: "End date cannot be before start date" });
      }

      const availability = await getCookAvailabilitySummary(req.params.id);
      const conflict = availability.blockedRanges.some((range) =>
        datesOverlapDateRange(validatedData.startDate, validatedData.endDate, range.startDate, range.endDate),
      );

      if (conflict) {
        return res.status(409).json({ error: "That date range is already unavailable." });
      }

      const reservation = await storage.createCookReservation(validatedData);
      res.status(201).json(reservation);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create availability block" });
      }
    }
  });

  app.delete("/api/admin/cooks/:id/availability/blocks/:blockId", requireAdmin, async (req, res) => {
    try {
      const reservations = await storage.getCookReservations(req.params.id);
      const reservation = reservations.find((entry) => entry.id === req.params.blockId);
      if (!reservation) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      const deleted = await storage.deleteCookReservation(req.params.blockId);
      if (!deleted) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete availability block" });
    }
  });

  app.get("/api/provider/cooks/:id/availability", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCook(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      res.json(await getCookAvailabilitySummary(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cook availability" });
    }
  });

  app.post("/api/provider/cooks/:id/availability/blocks", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCook(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const validatedData = insertCookReservationSchema.parse({
        ...req.body,
        cookId: req.params.id,
        status: "blocked",
      });

      if (normalizeDateOnly(validatedData.endDate).getTime() < normalizeDateOnly(validatedData.startDate).getTime()) {
        return res.status(400).json({ error: "End date cannot be before start date" });
      }

      const availability = await getCookAvailabilitySummary(req.params.id);
      const conflict = availability.blockedRanges.some((range) =>
        datesOverlapDateRange(validatedData.startDate, validatedData.endDate, range.startDate, range.endDate),
      );

      if (conflict) {
        return res.status(409).json({ error: "That date range is already unavailable." });
      }

      const reservation = await storage.createCookReservation(validatedData);
      res.status(201).json(reservation);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create availability block" });
      }
    }
  });

  app.delete("/api/provider/cooks/:id/availability/blocks/:blockId", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const access = await assertProviderCanAccessCook(req, req.params.id);
      if ("error" in access) {
        return res.status(access.error!.status).json(access.error!.body);
      }

      const reservations = await storage.getCookReservations(req.params.id);
      const reservation = reservations.find((entry) => entry.id === req.params.blockId);
      if (!reservation) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      const deleted = await storage.deleteCookReservation(req.params.blockId);
      if (!deleted) {
        return res.status(404).json({ error: "Availability block not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete availability block" });
    }
  });

  // Cooks - Admin Routes
  app.get("/api/admin/cooks", requireAdmin, async (_req, res) => {
    try {
      const cooks = await storage.getCooks();
      res.json(cooks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cooks" });
    }
  });

  app.get("/api/admin/cooks/:id", requireAdmin, async (req, res) => {
    try {
      const cook = await storage.getCook(req.params.id);
      if (!cook) {
        return res.status(404).json({ error: "Cook not found" });
      }
      res.json(cook);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cook" });
    }
  });

  app.post("/api/admin/cooks", requireAdmin, async (req: any, res) => {
    try {
      const validatedData = ensurePublicListingHasManager(
        insertCookSchema.parse(req.body),
        req.user?.claims?.sub,
      );
      const cook = await storage.createCook(validatedData);
      res.status(201).json(cook);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to create cook:", error);
        res.status(500).json({ error: "Failed to create cook" });
      }
    }
  });

  app.patch("/api/admin/cooks/:id", requireAdmin, async (req: any, res) => {
    try {
      const existingCook = await storage.getCook(req.params.id);
      if (!existingCook) {
        return res.status(404).json({ error: "Cook not found" });
      }

      const validatedData = mergeManagerAssignment(
        req.body,
        insertCookSchema.partial().parse(req.body),
        existingCook.managerUserId,
        req.user?.claims?.sub,
      );
      const cook = await storage.updateCook(req.params.id, validatedData);
      if (cook) {
        await syncRelatedServiceBookings("cooks", cook.id, {
          notifyProviders: existingCook.managerUserId !== cook.managerUserId,
        });
      }
      res.json(cook);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to update cook:", error);
        res.status(500).json({ error: "Failed to update cook" });
      }
    }
  });

  app.delete("/api/admin/cooks/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteCook(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Cook not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete cook" });
    }
  });

  // Errands - Admin Routes
  app.get("/api/admin/errands", requireAdmin, async (_req, res) => {
    try {
      const errands = await storage.getErrands();
      res.json(errands);
    } catch (error) {
      console.error("[ADMIN] Failed to fetch errands:", error);
      res.status(500).json({ error: "Failed to fetch errands" });
    }
  });

  app.get("/api/admin/errands/:id", requireAdmin, async (req, res) => {
    try {
      const errand = await storage.getErrand(req.params.id);
      if (!errand) {
        return res.status(404).json({ error: "Errand not found" });
      }
      res.json(errand);
    } catch (error) {
      console.error("[ADMIN] Failed to fetch errand:", error);
      res.status(500).json({ error: "Failed to fetch errand" });
    }
  });

  app.post("/api/admin/errands", requireAdmin, async (req: any, res) => {
    try {
      const validatedData = ensurePublicListingHasManager(
        insertErrandSchema.parse(req.body),
        req.user?.claims?.sub,
      );
      const errand = await storage.createErrand(validatedData);
      res.status(201).json(errand);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to create errand:", error);
        res.status(500).json({ error: "Failed to create errand" });
      }
    }
  });

  app.patch("/api/admin/errands/:id", requireAdmin, async (req: any, res) => {
    try {
      const existingErrand = await storage.getErrand(req.params.id);
      if (!existingErrand) {
        return res.status(404).json({ error: "Errand not found" });
      }

      const validatedData = mergeManagerAssignment(
        req.body,
        insertErrandSchema.partial().parse(req.body),
        existingErrand.managerUserId,
        req.user?.claims?.sub,
      );
      const errand = await storage.updateErrand(req.params.id, validatedData);
      if (errand) {
        await syncRelatedServiceBookings("errands", errand.id, {
          notifyProviders: existingErrand.managerUserId !== errand.managerUserId,
        });
      }
      res.json(errand);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to update errand:", error);
        res.status(500).json({ error: "Failed to update errand" });
      }
    }
  });

  app.delete("/api/admin/errands/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteErrand(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Errand not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete errand" });
    }
  });

  app.get("/api/admin/experiences", requireAdmin, async (_req, res) => {
    try {
      res.json(await storage.getExperiences());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch experiences" });
    }
  });

  app.get("/api/admin/experiences/:id", requireAdmin, async (req, res) => {
    try {
      const experience = await storage.getExperience(req.params.id);
      if (!experience) {
        return res.status(404).json({ error: "Experience not found" });
      }
      res.json(experience);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch experience" });
    }
  });

  app.post("/api/admin/experiences", requireAdmin, async (req: any, res) => {
    try {
      const validatedData = ensurePublicListingHasManager(
        insertExperienceSchema.parse(req.body),
        req.user?.claims?.sub,
      );
      res.status(201).json(await storage.createExperience(validatedData));
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create experience" });
      }
    }
  });

  app.patch("/api/admin/experiences/:id", requireAdmin, async (req: any, res) => {
    try {
      const existingExperience = await storage.getExperience(req.params.id);
      if (!existingExperience) {
        return res.status(404).json({ error: "Experience not found" });
      }

      const validatedData = mergeManagerAssignment(
        req.body,
        insertExperienceSchema.partial().parse(req.body),
        existingExperience.managerUserId,
        req.user?.claims?.sub,
      );
      const experience = await storage.updateExperience(req.params.id, validatedData);
      if (experience) {
        await syncRelatedServiceBookings("experiences", experience.id, {
          notifyProviders: existingExperience.managerUserId !== experience.managerUserId,
        });
      }
      res.json(experience);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to update experience" });
      }
    }
  });

  app.delete("/api/admin/experiences/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteExperience(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Experience not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete experience" });
    }
  });

  // Public Routes for fetching services
  app.get("/api/stays", async (_req, res) => {
    try {
      const stays = await storage.getStays();
      const visibleStays = stays.filter((stay: any) => isBookablePublicListing(stay));
      res.json(visibleStays);
    } catch (error) {
      sendPublicCatalogFailure("stays", res, error);
    }
  });

  app.get("/api/stays/:id", async (req, res) => {
    try {
      const stay = await storage.getStay(req.params.id);
      if (!isBookablePublicListing(stay)) {
        return res.status(404).json({ error: "Stay not found" });
      }
      res.json(stay);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stay" });
    }
  });

  app.get("/api/stays/:id/availability", async (req, res) => {
    try {
      const stay = await storage.getStay(req.params.id);
      if (!isBookablePublicListing(stay)) {
        return res.status(404).json({ error: "Stay not found" });
      }

      res.json(await getStayAvailabilitySummary(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stay availability" });
    }
  });

  app.get("/api/cars", async (_req, res) => {
    try {
      const cars = await storage.getCars();
      res.json(cars.filter((car: any) => isBookablePublicListing(car)));
    } catch (error) {
      sendPublicCatalogFailure("cars", res, error);
    }
  });

  app.get("/api/cars/:id/availability", async (req, res) => {
    try {
      const car = await storage.getCar(req.params.id);
      if (!isBookablePublicListing(car)) {
        return res.status(404).json({ error: "Car not found" });
      }

      res.json(await getCarAvailabilitySummary(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch car availability" });
    }
  });

  app.get("/api/cooks/:id/availability", async (req, res) => {
    try {
      const cook = await storage.getCook(req.params.id);
      if (!isBookablePublicListing(cook)) {
        return res.status(404).json({ error: "Chef not found" });
      }

      res.json(await getCookAvailabilitySummary(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cook availability" });
    }
  });

  app.get("/api/stay-concierge-availability", async (req, res) => {
    try {
      const checkIn = typeof req.query.checkIn === "string" ? req.query.checkIn : "";
      const checkOut = typeof req.query.checkOut === "string" ? req.query.checkOut : "";
      const rawIds = typeof req.query.serviceIds === "string" ? req.query.serviceIds : "";
      const serviceIds = Array.from(new Set(rawIds.split(",").map((id) => id.trim()).filter(Boolean)));

      if (!checkIn || !checkOut || !serviceIds.length) {
        return res.json({ unavailableServiceIds: [] });
      }

      normalizeDateOnly(checkIn);
      normalizeDateOnly(checkOut);

      const [cars, cooks] = await Promise.all([
        storage.getCars(),
        storage.getCooks(),
      ]);

      const publicCars = cars.filter((car) => isBookablePublicListing(car) && serviceIds.includes(car.id));
      const publicCooks = cooks.filter((cook) => isBookablePublicListing(cook) && serviceIds.includes(cook.id));

      const unavailableServiceIds: string[] = [];

      for (const car of publicCars) {
        const availability = await getCarAvailabilitySummary(car.id);
        if (hasAvailabilityOverlap(availability.blockedRanges, checkIn, checkOut)) {
          unavailableServiceIds.push(car.id);
        }
      }

      for (const cook of publicCooks) {
        const availability = await getCookAvailabilitySummary(cook.id);
        if (hasAvailabilityOverlap(availability.blockedRanges, checkIn, checkOut)) {
          unavailableServiceIds.push(cook.id);
        }
      }

      res.json({ unavailableServiceIds });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to fetch concierge availability" });
    }
  });

  app.get("/api/cooks", async (_req, res) => {
    try {
      const cooks = await storage.getCooks();
      res.json(cooks.filter((cook: any) => isBookablePublicListing(cook)));
    } catch (error) {
      sendPublicCatalogFailure("cooks", res, error);
    }
  });

  app.get("/api/errands", async (_req, res) => {
    try {
      const errands = await storage.getErrands();
      res.json(errands.filter((errand: any) => isBookablePublicListing(errand)));
    } catch (error) {
      sendPublicCatalogFailure("errands", res, error);
    }
  });

  app.get("/api/experiences", async (_req, res) => {
    try {
      const experiences = await storage.getExperiences();
      res.json(experiences.filter((experience: any) => isBookablePublicListing(experience)));
    } catch (error) {
      sendPublicCatalogFailure("experiences", res, error);
    }
  });

  app.get("/api/experiences/:id/shared-departures", async (req, res) => {
    try {
      const experience = await storage.getExperience(req.params.id);
      if (!isBookablePublicListing(experience)) {
        return res.status(404).json({ error: "Experience not found" });
      }

      res.json(await getExperienceDepartureAvailability(req.params.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch shared departures" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
