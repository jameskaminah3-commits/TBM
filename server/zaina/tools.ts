// server/zaina/tools.ts
//
// Zaina's tool layer. This is the business logic the model calls.
//
// DESIGN RULES:
//   1. Prices always come from the database, never from the model.
//   2. Availability is checked live — never cached.
//   3. Every write to `bookings` and `custom_offers` is idempotent.
//   4. If a tool can't confirm something, it returns { ok: false, error } — never invents data.
//   5. Dates, currencies, and quantities are validated fail-closed.
//   6. Notifications to ops are best-effort. If they fail, they log — the tool still returns.

import { db } from "../db";
import {
  sendOpsAlertEmail,
  sendZainaBookingCreatedEmail,
  sendZainaConversationStartedEmail,
  queueNotificationTask,
} from "../notifications";
import { storage } from "../storage";
import {
  bookings, stays, cooks, cars, errands, experiences,
  aiLeads, chatSessions, customOffers, zainaAuditLogs,
  users, userPushDevices,
} from "@shared/schema";
import { and, eq, ne, lt, gt, gte, lte, sql, isNotNull, asc, or } from "drizzle-orm";
import { getUsdToKesRate } from "../currency";
import {
  HELP_MAMA_HOURLY_MINIMUM_HOURS,
  calculateHouseCleaningPackagePrice,
  getHouseCleaningBedroomCount,
} from "@shared/errand-pricing";
import {
  calculateBookingDepositAmount,
  getBookingAmountPaid,
  hasLockedInBookingDeposit,
} from "@shared/booking-payments";
import { sendWebPushNotification } from "../push";
import { INVENTORY_CATALOG } from "./catalog";
import { describeInputAmount, toUsdAmount } from "./money-input";
import { getPublicSiteUrl } from "./reply-policy";
import { describeListingSource, MIN_LISTING_DETAILS_LENGTH, normalizeListingLink } from "./listing-verification";
import { phoneNumbersWritten, resolveAgentContact, resolveCustomerContact, sharesPhoneNumber, textArg } from "./tool-args";
import { getPublicListingPath } from "@shared/seo";

// ═══════════════════════════════════════════════════════════════════
// HELPERS — currency, dates, notifications
// ═══════════════════════════════════════════════════════════════════

/**
 * Public site base URL. Used to build absolute links that customers can
 * click — payment links, listing pages, etc.
 */
function appBaseUrl(): string {
  return getPublicSiteUrl();
}

/** The booking deposit in the customer's currency, or undefined when the full amount is due. */
async function formatDepositDisplay(
  totalUsd: number,
  depositUsd: number | null | undefined,
  sessionId: string,
): Promise<string | undefined> {
  const total = Math.round(totalUsd);
  const deposit = depositUsd ?? calculateBookingDepositAmount(total);
  return deposit > 0 && deposit < total ? formatPrice(deposit, sessionId) : undefined;
}

async function getSessionCurrency(sessionId: string): Promise<"USD" | "KES"> {
  const [sess] = await db
    .select({ displayCurrency: chatSessions.displayCurrency })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);
  return sess?.displayCurrency === "KES" ? "KES" : "USD";
}

async function formatPrice(
  amountUsd: number,
  sessionId: string,
  sessionCurrency?: "USD" | "KES",
): Promise<string> {
  const currency = sessionCurrency ?? await getSessionCurrency(sessionId);
  if (currency === "USD") {
    return `$${Math.round(amountUsd).toLocaleString("en-US")}`;
  }
  const rate = await getUsdToKesRate();
  return `KSh ${Math.round(amountUsd * rate.usdToKes).toLocaleString("en-KE")}`;
}

/**
 * Returns the number of nights between two ISO dates, or null if the dates
 * are invalid. Anchored to Kenya midnight (+03:00).
 */
function validateAndGetNights(checkIn: string, checkOut: string): number | null {
  if (typeof checkIn !== "string" || typeof checkOut !== "string") return null;
  if (!isValidIsoDate(checkIn) || !isValidIsoDate(checkOut)) return null;
  const start = new Date(`${checkIn}T00:00:00+03:00`).getTime();
  const end = new Date(`${checkOut}T00:00:00+03:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00+03:00`);
  return Number.isFinite(date.getTime()) && date.toLocaleDateString("en-CA", {
    timeZone: "Africa/Nairobi",
  }) === value;
}

function addOneDay(value: string): string {
  const date = new Date(`${value}T00:00:00+03:00`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : fallback;
}

function hasUsableIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 8 && value.length <= 128;
}

function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

type AvailabilityBooking = {
  status: string;
  totalPrice: number;
  paymentStatus: string | null;
  paymentAmountPaid: number | null;
  paymentDepositAmount: number | null;
  paymentHoldExpiresAt: string | null;
  serviceMode: string | null;
};

/**
 * Pending drafts do not block inventory. A verified payment, locked deposit,
 * or active checkout hold does. This is the same rule used by the main
 * booking routes and prevents abandoned Zaina drafts from making inventory
 * appear permanently unavailable.
 */
function bookingBlocksAvailability(booking: AvailabilityBooking): boolean {
  if (booking.status === "cancelled" || booking.status === "completed") return false;
  if (getBookingAmountPaid(booking) >= Math.max(0, booking.totalPrice)) return true;
  if (hasLockedInBookingDeposit(booking)) return true;

  if (!["pending", "processing"].includes(booking.paymentStatus ?? "paid")) return false;
  if (!booking.paymentHoldExpiresAt) return false;
  return new Date(booking.paymentHoldExpiresAt).getTime() > Date.now();
}

function occupiedEndDate(checkIn: string, checkOut: string): string {
  const start = new Date(`${checkIn}T00:00:00+03:00`).getTime();
  const end = new Date(`${checkOut}T00:00:00+03:00`).getTime();
  if (end === start) return checkOut;
  const d = new Date(end);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const bookingInventoryColumns = {
  status: bookings.status,
  totalPrice: bookings.totalPrice,
  paymentStatus: bookings.paymentStatus,
  paymentAmountPaid: bookings.paymentAmountPaid,
  paymentDepositAmount: bookings.paymentDepositAmount,
  paymentHoldExpiresAt: bookings.paymentHoldExpiresAt,
  serviceMode: bookings.serviceMode,
};

async function hasStayInventoryConflict(
  executor: any,
  stayId: string,
  checkIn: string,
  checkOut: string,
): Promise<boolean> {
  const candidates = await executor
    .select(bookingInventoryColumns)
    .from(bookings)
    .where(and(
      eq(bookings.accommodationId, stayId),
      ne(bookings.status, "cancelled"),
      lt(bookings.checkIn, checkOut),
      gt(bookings.checkOut, checkIn),
    ))
    .limit(50);
  return candidates.some(bookingBlocksAvailability);
}

async function hasServiceInventoryConflict(
  executor: any,
  serviceId: string,
  checkIn: string,
  checkOut: string,
): Promise<boolean> {
  const candidates = await executor
    .select(bookingInventoryColumns)
    .from(bookings)
    .where(and(
      sql`${bookings.selectedServices} @> ARRAY[${serviceId}]::text[]`,
      ne(bookings.status, "cancelled"),
      lt(bookings.checkIn, checkOut),
      gt(bookings.checkOut, checkIn),
    ))
    .limit(50);
  return candidates.some(bookingBlocksAvailability);
}

async function createBookingWithInventoryLock(
  resourceKeys: string[],
  data: any,
  inventoryCheck: (executor: any) => Promise<string | null>,
): Promise<{ booking: any | null; conflict: string | null }> {
  // Ensure schema compatibility before opening the transaction. The storage
  // layer may need a second pool connection for its one-time payment-table
  // migration; doing that while holding the transaction can deadlock when
  // production is configured with a small pool.
  await storage.ensureBookingWriteTables();

  return db.transaction(async (tx) => {
    // Lock every affected resource in a stable order so two multi-service
    // bookings cannot deadlock while each waits for the other resource.
    for (const resourceKey of Array.from(new Set(resourceKeys)).sort()) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${resourceKey}, 0))`);
    }

    const conflict = await inventoryCheck(tx);
    if (conflict) return { booking: null, conflict };

    return {
      booking: await storage.createBooking(data, tx),
      conflict: null,
    };
  });
}

/**
 * Today's date in Kenya (YYYY-MM-DD). Using UTC here would misclassify
 * bookings made between 21:00 and 00:00 Kenya as "yesterday."
 */
function todayInKenya(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Whole days between two YYYY-MM-DD strings, anchored to Kenya midnight.
 */
function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00+03:00`).getTime();
  const end = new Date(`${endDate}T00:00:00+03:00`).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

/**
 * Day-granularity advance window check.
 *
 *   • Past dates are rejected.
 *   • Same-day (today in Kenya) is rejected — always.
 *   • Otherwise, the booking must land on or after
 *     today + max(1, ceil(advanceHours / 24)) days.
 */
function isBookingWindowSufficient(
  checkInDate: string,
  advanceHours: number,
): { ok: true } | { ok: false; reason: string; today: string; required_days: number } {
  const today = todayInKenya();

  if (checkInDate < today) {
    return { ok: false, reason: "date_in_past", today, required_days: 1 };
  }
  if (checkInDate === today) {
    return { ok: false, reason: "same_day_not_allowed", today, required_days: 1 };
  }

  const daysOut = daysBetween(today, checkInDate);
  const requiredDays = Math.max(1, Math.ceil(advanceHours / 24));
  if (daysOut < requiredDays) {
    return { ok: false, reason: "not_enough_advance", today, required_days: requiredDays };
  }

  return { ok: true };
}

async function sendOpsAlert(payload: {
  kind: "handoff-requested" | "custom-offer" | "system-error" | "new-lead";
  sessionId: string;
  summary: string;
  details?: Record<string, unknown>;
  customerName?: string | null;
  customerContact?: string | null;
}): Promise<void> {
  try {
    await sendOpsAlertEmail(payload);
  } catch (err) {
    console.error("[zaina] ops alert failed:", err);
  }
}

/**
 * Shared helper: reads the full audit transcript for a session and sends
 * the "booking created" notification. Best-effort — logs on failure.
 */
async function notifyBookingCreated(args: {
  bookingId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  kind: "stay" | "service";
  summary: string;
  totalDisplay: string;
  paymentLink: string;
  sessionId: string;
}): Promise<void> {
  let transcript: Array<{ actor: string; text: string; timestamp: string }> = [];

  try {
    const transcriptRows = await db
      .select({
        actor: zainaAuditLogs.actor,
        messageContent: zainaAuditLogs.messageContent,
        timestamp: zainaAuditLogs.timestamp,
      })
      .from(zainaAuditLogs)
      .where(eq(zainaAuditLogs.sessionId, args.sessionId))
      .orderBy(asc(zainaAuditLogs.timestamp));

    transcript = transcriptRows
      .filter((r) => r.messageContent)
      .map((r) => ({
        actor: r.actor,
        text: r.messageContent as string,
        timestamp: String(r.timestamp),
      }));

  } catch (transcriptErr) {
    console.error("[zaina] booking-created transcript read failed:", transcriptErr);
  }

  try {
    const adminInboxItems = await storage.createAdminBookingNotification({
      bookingId: args.bookingId,
      sessionId: args.sessionId,
      kind: args.kind,
      customerName: args.customerName,
      summary: args.summary,
      totalDisplay: args.totalDisplay,
    });
    console.info(`[zaina] admin booking notifications created: ${adminInboxItems.length} (${args.bookingId})`);
  } catch (inboxErr) {
    console.error("[zaina] admin booking inbox notification failed:", inboxErr);
  }

  try {
    const emailSent = await sendZainaBookingCreatedEmail({
      bookingId: args.bookingId,
      customerName: args.customerName,
      customerEmail: args.customerEmail,
      customerPhone: args.customerPhone,
      kind: args.kind,
      summary: args.summary,
      totalDisplay: args.totalDisplay,
      paymentLink: args.paymentLink,
      sessionId: args.sessionId,
      transcript,
    });
    if (!emailSent) {
      console.warn("[zaina] booking-created email was not sent: no notification recipient is configured");
    }
  } catch (notifyErr) {
    console.error("[zaina] booking-created email failed:", notifyErr);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH TOOLS
// ═══════════════════════════════════════════════════════════════════

export async function searchStays(
  args: { region?: string; guests?: number; keyword?: string },
  sessionId: string,
) {
  const conditions: any[] = [
    eq(stays.isPublic, true),
    isNotNull(stays.managerUserId),
  ];
  if (args.region) {
    conditions.push(sql`${stays.location} ILIKE ${"%" + args.region + "%"}`);
  }
  if (args.guests && args.guests > 0) {
    conditions.push(gte(stays.maxOccupancy, args.guests));
  }
  if (args.keyword) {
    conditions.push(sql`${stays.title} ILIKE ${"%" + args.keyword + "%"}`);
  }

  const rows = await db
    .select({
      id: stays.id,
      title: stays.title,
      location: stays.location,
      priceUsd: stays.price,
      maxOccupancy: stays.maxOccupancy,
      bedrooms: stays.bedrooms,
      bathrooms: stays.bathrooms,
      rating: stays.rating,
      reviewCount: stays.reviewCount,
      features: stays.features,
    })
    .from(stays)
    .where(and(...conditions))
    .orderBy(stays.title)
    .limit(3);

  const currency = await getSessionCurrency(sessionId);
  const results = await Promise.all(
    rows.map(async (s, i) => ({
      option_index: i + 1,
      id: s.id,
      title: s.title,
      location: s.location,
      price_per_night_usd: s.priceUsd,
      price_per_night_display: await formatPrice(s.priceUsd, sessionId, currency),
      max_occupancy: s.maxOccupancy,
      bedrooms: s.bedrooms,
      bathrooms: s.bathrooms,
      rating: s.rating,
      review_count: s.reviewCount,
      public_url: `${appBaseUrl()}${getPublicListingPath("stay", s.id, s.title)}`,
      features: s.features,
    })),
  );

  return {
    ok: true,
    count: results.length,
    stays: results,
    note:
      results.length === 0
        ? "No stays matched. Try widening the region or reducing the guest count, or offer a custom request."
        : undefined,
  };
}

export async function searchCooks(
  args: { region?: string; guests?: number; keyword?: string },
  sessionId: string,
) {
  const conditions: any[] = [
    eq(cooks.isPublic, true),
    isNotNull(cooks.managerUserId),
  ];
  if (args.region) {
    conditions.push(sql`${cooks.location} ILIKE ${"%" + args.region + "%"}`);
  }
  if (args.guests && args.guests > 0) {
    conditions.push(gte(cooks.maxGuests, args.guests));
  }
  if (args.keyword) {
    conditions.push(sql`(${cooks.title} ILIKE ${"%" + args.keyword + "%"} OR ${cooks.speciality} ILIKE ${"%" + args.keyword + "%"})`);
  }

  const rows = await db
    .select({
      id: cooks.id,
      title: cooks.title,
      location: cooks.location,
      speciality: cooks.speciality,
      minimumGuests: cooks.minimumGuests,
      maxGuests: cooks.maxGuests,
      pricePerSession: cooks.pricePerSession,
      pricePerPlate: cooks.pricePerPlate,
      priceSingleMeal: cooks.priceSingleMeal,
      minPlates: cooks.minPlates,
      serviceFee: cooks.serviceFee,
      inclusivePrice: cooks.inclusivePrice,
      customMenuEnabled: cooks.customMenuEnabled,
      sampleMenus: cooks.sampleMenus,
      rating: cooks.rating,
      reviewCount: cooks.reviewCount,
      imageUrl: cooks.imageUrl,
      galleryUrls: cooks.galleryUrls,
    })
    .from(cooks)
    .where(and(...conditions))
    .orderBy(cooks.title)
    .limit(3);

  const currency = await getSessionCurrency(sessionId);
  const results = await Promise.all(
    rows.map(async (c, i) => ({
      option_index: i + 1,
      id: c.id,
      title: c.title,
      location: c.location,
      speciality: c.speciality,
      minimum_guests: c.minimumGuests,
      maximum_guests: c.maxGuests,
      public_url: `${appBaseUrl()}${getPublicListingPath("cook", c.id, c.title)}`,
      pricing: {
        per_plate: c.pricePerPlate
          ? { usd: c.pricePerPlate, display: await formatPrice(c.pricePerPlate, sessionId, currency), minimum_plates: c.minPlates }
          : null,
        single_meal: c.priceSingleMeal
          ? { usd: c.priceSingleMeal, display: await formatPrice(c.priceSingleMeal, sessionId, currency) }
          : null,
        session: (c.serviceFee || c.pricePerSession)
          ? { usd: c.serviceFee || c.pricePerSession, display: await formatPrice(c.serviceFee || c.pricePerSession, sessionId, currency) }
          : null,
      },
      booking_modes: [
        c.pricePerPlate ? "cook-per-plate" : null,
        c.priceSingleMeal ? "cook-single-meal" : null,
        c.serviceFee || c.pricePerSession ? "cook-service-fee" : null,
        c.inclusivePrice ? "cook-inclusive" : null,
      ].filter(Boolean),
      custom_menu_available: c.customMenuEnabled,
      sample_menus: c.sampleMenus,
      rating: c.rating,
      review_count: c.reviewCount,
    })),
  );

  return {
    ok: true,
    count: results.length,
    cooks: results,
    note:
      results.length === 0
        ? "We don't have chefs listed in that area right now. Offer to capture a request or find one via custom offer."
        : undefined,
  };
}

export async function searchCars(
  args: { region?: string; guests?: number; keyword?: string },
  sessionId: string,
) {
  const conditions: any[] = [
    eq(cars.isPublic, true),
    isNotNull(cars.managerUserId),
  ];
  if (args.region) {
    conditions.push(sql`${cars.location} ILIKE ${"%" + args.region + "%"}`);
  }
  if (args.guests && args.guests > 0) {
    conditions.push(gte(cars.seats, args.guests));
  }
  if (args.keyword) {
    conditions.push(sql`(${cars.model} ILIKE ${"%" + args.keyword + "%"} OR ${cars.make} ILIKE ${"%" + args.keyword + "%"})`);
  }

  const rows = await db
    .select({
      id: cars.id,
      make: cars.make,
      model: cars.model,
      location: cars.location,
      seats: cars.seats,
      transmission: cars.transmission,
      pricePerDay: cars.pricePerDay,
      priceWithDriver: cars.priceWithDriver,
      priceWithDriverHourly: cars.priceWithDriverHourly,
      chauffeurZones: cars.chauffeurZones,
      features: cars.features,
      imageUrl: cars.imageUrl,
      galleryUrls: cars.galleryUrls,
    })
    .from(cars)
    .where(and(...conditions))
    .orderBy(cars.model)
    .limit(3);

  const currency = await getSessionCurrency(sessionId);
  const results = await Promise.all(
    rows.map(async (c, i) => ({
      option_index: i + 1,
      id: c.id,
      make: c.make,
      model: c.model,
      location: c.location,
      seats: c.seats,
      transmission: c.transmission,
      public_url: `${appBaseUrl()}${getPublicListingPath("car", c.id, `${c.make ? `${c.make} ` : ""}${c.model}`)}`,
      pricing: {
        self_drive_per_day: c.pricePerDay
          ? { usd: c.pricePerDay, display: await formatPrice(c.pricePerDay, sessionId, currency) }
          : null,
        chauffeur_per_day: c.priceWithDriver
          ? { usd: c.priceWithDriver, display: await formatPrice(c.priceWithDriver, sessionId, currency) }
          : null,
        chauffeur_per_hour: c.priceWithDriverHourly
          ? { usd: c.priceWithDriverHourly, display: await formatPrice(c.priceWithDriverHourly, sessionId, currency) }
          : null,
        zones: c.chauffeurZones,
      },
      booking_modes: [
        c.pricePerDay ? "car-self-drive-day" : null,
        c.priceWithDriver ? "car-chauffeur-day" : null,
        c.priceWithDriverHourly ? "car-chauffeur-hourly" : null,
      ].filter(Boolean),
      features: c.features,
    })),
  );

  return {
    ok: true,
    count: results.length,
    cars: results,
    note:
      results.length === 0
        ? "No cars matched. Try removing the region filter or offer a custom request."
        : undefined,
  };
}

export async function searchErrands(
  args: { region?: string; keyword?: string },
  sessionId: string,
) {
  const conditions: any[] = [
    eq(errands.isPublic, true),
    isNotNull(errands.managerUserId),
  ];
  if (args.region) {
    conditions.push(sql`${errands.location} ILIKE ${"%" + args.region + "%"}`);
  }
  if (args.keyword) {
    conditions.push(sql`(${errands.serviceName} ILIKE ${"%" + args.keyword + "%"} OR ${errands.description} ILIKE ${"%" + args.keyword + "%"})`);
  }

  const rows = await db
    .select()
    .from(errands)
    .where(and(...conditions))
    .orderBy(errands.serviceName)
    .limit(3);

  const currency = await getSessionCurrency(sessionId);
  const results = await Promise.all(
    rows.map(async (e, i) => {
      const helpMama = e.helpMamaPricing;
      return {
        option_index: i + 1,
        id: e.id,
        service_name: e.serviceName,
        location: e.location,
        public_url: `${appBaseUrl()}${getPublicListingPath("errand", e.id, e.serviceName)}`,
        base_price: {
          usd: e.basePrice,
          display: await formatPrice(e.basePrice, sessionId, currency),
        },
        shopping: e.shoppingEnabled
          ? { commission_percent: e.shoppingCommissionPercent }
          : null,
        laundry: e.laundryEnabled
          ? {
              included_kg: e.laundryIncludedKg,
              price_per_kg_usd: e.laundryPricePerKg,
              addons: e.laundryAddons,
            }
          : null,
        house_cleaning: e.houseCleaningEnabled
          ? { addons: e.houseCleaningAddons }
          : null,
        booking_modes: [
          "errand-base",
          e.shoppingEnabled ? "errand-shopping" : null,
          e.laundryEnabled ? "errand-laundry" : null,
          e.houseCleaningEnabled ? "errand-house-cleaning" : null,
          helpMama?.enabled ? "errand-childcare" : null,
        ].filter(Boolean),
        mamacare: helpMama?.enabled
          ? {
              age_bands: await Promise.all(
                (helpMama.ageBands || []).map(async (band) => ({
                  id: band.id,
                  label: band.label,
                  hourly_daytime: await formatPrice(band.hourlyDaytimePrice, sessionId, currency),
                  hourly_evening: await formatPrice(band.hourlyEveningPrice, sessionId, currency),
                  overnight: await formatPrice(band.overnightPrice, sessionId, currency),
                  full_day: await formatPrice(band.fullDayPrice, sessionId, currency),
                })),
              ),
            }
          : null,
        description: e.description,
        rating: e.rating,
        review_count: e.reviewCount,
      };
    }),
  );

  return {
    ok: true,
    count: results.length,
    errands: results,
    note:
      results.length === 0
        ? "No matching errand was found. Ask whether the customer wants shopping, laundry, cleaning, or childcare, then use a custom request if it is not listed."
        : undefined,
  };
}

export async function searchExperiences(
  args: { region?: string; guests?: number; keyword?: string },
  sessionId: string,
) {
  const conditions: any[] = [
    eq(experiences.isPublic, true),
    isNotNull(experiences.managerUserId),
  ];
  if (args.region) {
    conditions.push(sql`${experiences.location} ILIKE ${"%" + args.region + "%"}`);
  }
  if (args.guests && args.guests > 0) {
    conditions.push(gte(experiences.maxGuests, args.guests));
  }
  if (args.keyword) {
    conditions.push(sql`(${experiences.title} ILIKE ${"%" + args.keyword + "%"} OR ${experiences.experienceType} ILIKE ${"%" + args.keyword + "%"} OR ${experiences.description} ILIKE ${"%" + args.keyword + "%"})`);
  }

  const rows = await db
    .select({
      id: experiences.id,
      title: experiences.title,
      location: experiences.location,
      experienceType: experiences.experienceType,
      durationHours: experiences.durationHours,
      minGuests: experiences.minGuests,
      maxGuests: experiences.maxGuests,
      privateEnabled: experiences.privateEnabled,
      sharedEnabled: experiences.sharedEnabled,
      sharedDepartures: experiences.sharedDepartures,
      privatePricePerPerson: experiences.privatePricePerPerson,
      sharedPricePerPerson: experiences.sharedPricePerPerson,
      customQuoteEnabled: experiences.customQuoteEnabled,
      inclusions: experiences.inclusions,
      rating: experiences.rating,
      reviewCount: experiences.reviewCount,
      imageUrl: experiences.imageUrl,
      galleryUrls: experiences.galleryUrls,
    })
    .from(experiences)
    .where(and(...conditions))
    .orderBy(experiences.title)
    .limit(3);

  const currency = await getSessionCurrency(sessionId);
  const results = await Promise.all(
    rows.map(async (x, i) => ({
      option_index: i + 1,
      id: x.id,
      title: x.title,
      location: x.location,
      type: x.experienceType,
      duration_hours: x.durationHours,
      guests: { min: x.minGuests, max: x.maxGuests },
      public_url: `${appBaseUrl()}${getPublicListingPath("experience", x.id, x.title)}`,
      pricing: {
        private_per_person: x.privateEnabled && x.privatePricePerPerson
          ? { usd: x.privatePricePerPerson, display: await formatPrice(x.privatePricePerPerson, sessionId, currency) }
          : null,
        shared_per_person: x.sharedEnabled && x.sharedPricePerPerson
          ? { usd: x.sharedPricePerPerson, display: await formatPrice(x.sharedPricePerPerson, sessionId, currency) }
          : null,
      },
      custom_offers_available: x.customQuoteEnabled,
      booking_modes: [
        x.privateEnabled ? "experience-private" : null,
        x.sharedEnabled ? "experience-shared" : null,
        x.customQuoteEnabled ? "experience-custom-offer" : null,
      ].filter(Boolean),
      shared_departures: x.sharedEnabled
        ? (x.sharedDepartures || []).filter((departure) => departure.date >= new Date().toISOString().slice(0, 10)).slice(0, 5)
        : [],
      inclusions: x.inclusions,
      rating: x.rating,
      review_count: x.reviewCount,
    })),
  );

  return {
    ok: true,
    count: results.length,
    experiences: results,
    note:
      results.length === 0
        ? "No matching experience was found. Try a wider area or offer a tailored custom request."
        : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// AVAILABILITY
// ═══════════════════════════════════════════════════════════════════

export async function checkStayAvailability(
  args: { stay_id: string; check_in: string; check_out: string },
  sessionId: string,
) {
  const [stay] = await db
    .select()
    .from(stays)
    .where(eq(stays.id, args.stay_id))
    .limit(1);
  if (!stay) return { ok: false, error: "stay_not_found" };
  if (!stay.isPublic || !stay.managerUserId) {
    return { ok: false, error: "stay_not_bookable" };
  }

  const nights = validateAndGetNights(args.check_in, args.check_out);
  if (nights === null) return { ok: false, error: "invalid_dates" };

  const requestedEnd = occupiedEndDate(args.check_in, args.check_out);

  const conflicts = await db
    .select({
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      status: bookings.status,
      totalPrice: bookings.totalPrice,
      paymentStatus: bookings.paymentStatus,
      paymentAmountPaid: bookings.paymentAmountPaid,
      paymentDepositAmount: bookings.paymentDepositAmount,
      paymentHoldExpiresAt: bookings.paymentHoldExpiresAt,
      serviceMode: bookings.serviceMode,
    })
    .from(bookings)
    .where(and(
      eq(bookings.accommodationId, args.stay_id),
      ne(bookings.status, "cancelled"),
      lt(bookings.checkIn, args.check_out),
      gt(bookings.checkOut, args.check_in),
    ));

  const blockingConflicts = conflicts.filter(bookingBlocksAvailability);
  return {
    ok: true,
    stay_id: args.stay_id,
    title: stay.title,
    public_url: `${appBaseUrl()}${getPublicListingPath("stay", stay.id, stay.title)}`,
    available: blockingConflicts.length === 0,
    conflicting_bookings: blockingConflicts.length,
    requested: { check_in: args.check_in, check_out: args.check_out, occupied_end: requestedEnd, nights },
  };
}

export async function checkServiceAvailability(
  args: {
    service_id: string;
    date: string;
    check_out?: string;
    mode?: string;
    guests?: number;
    service_departure_id?: string;
  },
  _sessionId: string,
) {
  if (!isValidIsoDate(args.date)) return { ok: false, error: "invalid_date" };

  const [car] = await db.select().from(cars).where(eq(cars.id, args.service_id)).limit(1);
  const [cook] = await db.select().from(cooks).where(eq(cooks.id, args.service_id)).limit(1);
  const [errand] = await db.select().from(errands).where(eq(errands.id, args.service_id)).limit(1);
  const [experience] = await db.select().from(experiences).where(eq(experiences.id, args.service_id)).limit(1);
  const service = car || cook || errand || experience;
  if (!service) return { ok: false, error: "service_not_found" };
  if (!service.isPublic || !service.managerUserId) return { ok: false, error: "service_not_bookable" };

  if (experience && args.mode === "experience-shared") {
    const departure = (experience.sharedDepartures || []).find((item) => item.id === args.service_departure_id);
    if (!departure || departure.date !== args.date) {
      return { ok: true, available: false, reason: "shared_departure_not_found" };
    }
    const departureBookings = await db
      .select({ guests: bookings.guests })
      .from(bookings)
      .where(and(
        sql`${bookings.selectedServices} @> ARRAY[${args.service_id}]::text[]`,
        eq(bookings.serviceMode, "experience-shared"),
        eq(bookings.serviceDepartureId, departure.id),
        ne(bookings.status, "cancelled"),
      ));
    const bookedGuests = departureBookings.reduce((total, booking) => total + Math.max(1, booking.guests || 1), 0);
    const spotsLeft = Math.max(0, experience.sharedMaxCapacity - bookedGuests);
    const guests = positiveIntegerOrDefault(args.guests, 1);
    return {
      ok: true,
      service_id: experience.id,
      title: experience.title,
      public_url: `${appBaseUrl()}${getPublicListingPath("experience", experience.id, experience.title)}`,
      available: guests <= spotsLeft,
      spots_left: spotsLeft,
      departure,
    };
  }

  const checkOut = car && args.mode !== "car-chauffeur-hourly"
    ? (args.check_out || args.date)
    : args.date;
  if (!isValidIsoDate(checkOut) || (car && args.mode !== "car-chauffeur-hourly" && checkOut <= args.date)) {
    return { ok: false, error: "invalid_dates" };
  }

  const conflicts = await db
    .select({
      status: bookings.status,
      totalPrice: bookings.totalPrice,
      paymentStatus: bookings.paymentStatus,
      paymentAmountPaid: bookings.paymentAmountPaid,
      paymentDepositAmount: bookings.paymentDepositAmount,
      paymentHoldExpiresAt: bookings.paymentHoldExpiresAt,
      serviceMode: bookings.serviceMode,
    })
    .from(bookings)
    .where(and(
      sql`${bookings.selectedServices} @> ARRAY[${args.service_id}]::text[]`,
      ne(bookings.status, "cancelled"),
      or(
        and(lt(bookings.checkIn, checkOut), gt(bookings.checkOut, args.date)),
        eq(bookings.checkIn, args.date),
      ),
    ));

  const blockingConflicts = conflicts.filter(bookingBlocksAvailability);
  return {
    ok: true,
    service_id: args.service_id,
    title: "title" in service ? service.title : "service",
    public_url: car
      ? `${appBaseUrl()}${getPublicListingPath("car", car.id, `${car.make ? `${car.make} ` : ""}${car.model}`)}`
      : cook
        ? `${appBaseUrl()}${getPublicListingPath("cook", cook.id, cook.title)}`
        : errand
          ? `${appBaseUrl()}${getPublicListingPath("errand", errand.id, errand.serviceName)}`
          : `${appBaseUrl()}${getPublicListingPath("experience", experience!.id, experience!.title)}`,
    available: blockingConflicts.length === 0,
    conflicting_bookings: blockingConflicts.length,
    requested: { date: args.date, check_out: checkOut },
  };
}
// ═══════════════════════════════════════════════════════════════════
// PRICING TOOLS
// ═══════════════════════════════════════════════════════════════════

export async function calculateChefPrice(
  args: {
    cook_id: string;
    mode: "per_plate" | "single_meal" | "session";
    quantity: number;
  },
  sessionId: string,
) {
  const [cook] = await db
    .select()
    .from(cooks)
    .where(eq(cooks.id, args.cook_id))
    .limit(1);
  if (!cook) return { ok: false, error: "cook_not_found" };

  if (args.mode === "per_plate") {
    if (!cook.pricePerPlate) {
      return {
        ok: false,
        error: "plate_pricing_not_configured",
        message: `${cook.title} uses a different pricing model. Try session pricing or ask the team.`,
      };
    }
    const minPlates = cook.minPlates || 4;
    if (args.quantity < minPlates) {
      return { ok: false, error: "below_minimum", minimum_plates: minPlates };
    }
    const totalUsd = cook.pricePerPlate * args.quantity;
    return {
      ok: true,
      mode: "per_plate",
      rate: await formatPrice(cook.pricePerPlate, sessionId),
      quantity: args.quantity,
      subtotal: await formatPrice(totalUsd, sessionId),
      subtotal_usd: totalUsd,
      groceries: "Sourced separately by the client or billed via Errands at cost.",
    };
  }

  if (args.mode === "single_meal") {
    if (!cook.priceSingleMeal) {
      return { ok: false, error: "single_meal_pricing_not_configured" };
    }
    const totalUsd = cook.priceSingleMeal * args.quantity;
    return {
      ok: true,
      mode: "single_meal",
      rate: await formatPrice(cook.priceSingleMeal, sessionId),
      quantity: args.quantity,
      subtotal: await formatPrice(totalUsd, sessionId),
      subtotal_usd: totalUsd,
      groceries: "Sourced separately by the client or billed via Errands at cost.",
    };
  }

  const rate = cook.serviceFee || cook.pricePerSession;
  if (!rate) return { ok: false, error: "no_pricing_configured" };
  const totalUsd = rate * Math.max(1, args.quantity);
  return {
    ok: true,
    mode: "session",
    rate: await formatPrice(rate, sessionId),
    quantity: Math.max(1, args.quantity),
    subtotal: await formatPrice(totalUsd, sessionId),
    subtotal_usd: totalUsd,
    note: "Flat session rate — this chef doesn't use plate or meal pricing.",
  };
}

export async function calculateMamaCarePrice(
  args: {
    errand_id: string;
    age_band_id?: string;
    mode: "hourly_daytime" | "hourly_evening" | "overnight" | "full_day";
    quantity: number;
  },
  sessionId: string,
) {
  const [errand] = await db
    .select()
    .from(errands)
    .where(eq(errands.id, args.errand_id))
    .limit(1);
  if (!errand) return { ok: false, error: "errand_not_found" };

  const pricing = errand.helpMamaPricing;
  if (!pricing?.enabled) {
    return { ok: false, error: "mamacare_not_configured", message: "MamaCare is not enabled for this service." };
  }

  const bands = pricing.ageBands || [];
  const band = args.age_band_id
    ? bands.find((b) => b.id === args.age_band_id)
    : bands[0];
  if (!band) {
    return {
      ok: false,
      error: "age_band_not_found",
      available_bands: bands.map((b) => ({ id: b.id, label: b.label })),
    };
  }

  const isHourly = args.mode === "hourly_daytime" || args.mode === "hourly_evening";
  if (isHourly && (args.quantity || 0) < HELP_MAMA_HOURLY_MINIMUM_HOURS) {
    return {
      ok: false,
      error: "below_minimum_hours",
      minimum_hours: HELP_MAMA_HOURLY_MINIMUM_HOURS,
    };
  }
  const quantity = isHourly
    ? Math.max(HELP_MAMA_HOURLY_MINIMUM_HOURS, args.quantity)
    : 1;

  const rate = {
    hourly_daytime: band.hourlyDaytimePrice,
    hourly_evening: band.hourlyEveningPrice,
    overnight: band.overnightPrice,
    full_day: band.fullDayPrice,
  }[args.mode];

  if (!rate) {
    return { ok: false, error: "rate_not_configured", mode: args.mode, band: band.label };
  }

  const totalUsd = rate * quantity;
  return {
    ok: true,
    mode: args.mode,
    age_band: { id: band.id, label: band.label },
    rate: await formatPrice(rate, sessionId),
    quantity,
    subtotal: await formatPrice(totalUsd, sessionId),
    subtotal_usd: totalUsd,
  };
}

// ═══════════════════════════════════════════════════════════════════
// TRIP BUILDER — the signature tool
// ═══════════════════════════════════════════════════════════════════

export async function composeTripPackage(
  args: {
    people: number;
    check_in: string;
    check_out: string;
    budget_amount?: number;
    budget_currency?: string;
    /** Legacy: a budget the model already converted to USD. */
    budget_usd?: number;
    destination_preference?: string;
    include_experience?: boolean;
  },
  sessionId: string,
) {
  const nights = validateAndGetNights(args.check_in, args.check_out);
  if (nights === null) return { ok: false, error: "invalid_dates" };

  let budgetUsd: number;
  if (args.budget_amount !== undefined) {
    const budget = toUsdAmount(args.budget_amount, args.budget_currency, (await getUsdToKesRate()).usdToKes);
    if (!budget.ok) {
      return {
        ok: false,
        error: budget.error === "amount_invalid" ? "budget_required" : "budget_currency_required",
        hint: "Pass budget_amount exactly as the customer stated it, with budget_currency set to USD or KES. Never convert the budget yourself.",
      };
    }
    budgetUsd = budget.exactUsd;
  } else if (typeof args.budget_usd === "number" && Number.isFinite(args.budget_usd) && args.budget_usd > 0) {
    budgetUsd = args.budget_usd;
  } else {
    return {
      ok: false,
      error: "budget_required",
      hint: "Ask the customer for their total budget and its currency, then pass budget_amount and budget_currency.",
    };
  }

  const warnings: string[] = [];

  // 1. Find an available stay that fits
  const stayCandidates = await db
    .select()
    .from(stays)
    .where(and(
      eq(stays.isPublic, true),
      isNotNull(stays.managerUserId),
      gte(stays.maxOccupancy, args.people),
      args.destination_preference
        ? sql`${stays.location} ILIKE ${"%" + args.destination_preference + "%"}`
        : sql`TRUE`,
    ))
    .orderBy(stays.price)
    .limit(15);

  let chosenStay: typeof stays.$inferSelect | null = null;
  for (const candidate of stayCandidates) {
    const conflicts = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(
        eq(bookings.accommodationId, candidate.id),
        ne(bookings.status, "cancelled"),
        lt(bookings.checkIn, args.check_out),
        gt(bookings.checkOut, args.check_in),
      ))
      .limit(1);
    if (conflicts.length === 0) {
      chosenStay = candidate;
      break;
    }
  }

  if (!chosenStay) {
    return {
      ok: false,
      error: "no_stay_available",
      message:
        "No available stays fit that many guests for those dates in that area. " +
        "Consider a different destination, different dates, or fewer guests.",
    };
  }

  const stayTotal = chosenStay.price * nights;

  // 2. Find a chauffeur car for the trip duration
  const carCandidates = await db
    .select()
    .from(cars)
    .where(and(
      eq(cars.isPublic, true),
      isNotNull(cars.managerUserId),
      gte(cars.seats, args.people),
    ))
    .orderBy(cars.priceWithDriver)
    .limit(10);

  let chosenCar: typeof cars.$inferSelect | null = null;
  for (const candidate of carCandidates) {
    const conflicts = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(
        sql`${bookings.selectedServices} @> ARRAY[${candidate.id}]::text[]`,
        ne(bookings.status, "cancelled"),
        lt(bookings.checkIn, args.check_out),
        gt(bookings.checkOut, args.check_in),
      ))
      .limit(1);
    if (conflicts.length === 0) {
      chosenCar = candidate;
      break;
    }
  }

  const transportTotal = chosenCar ? chosenCar.priceWithDriver * nights : 0;
  if (!chosenCar) {
    warnings.push("No chauffeur car available for those dates — transport not included in the package.");
  }

  // 3. Optionally find a private experience
  let chosenExperience: typeof experiences.$inferSelect | null = null;
  let experienceTotal = 0;
  if (args.include_experience !== false) {
    const expCandidates = await db
      .select()
      .from(experiences)
      .where(and(
        eq(experiences.isPublic, true),
        isNotNull(experiences.managerUserId),
        eq(experiences.privateEnabled, true),
        gte(experiences.maxGuests, args.people),
        lte(experiences.privateMinimumGuests, args.people),
        args.destination_preference
          ? sql`${experiences.location} ILIKE ${"%" + args.destination_preference + "%"}`
          : sql`TRUE`,
      ))
      .orderBy(experiences.privatePricePerPerson)
      .limit(5);

    if (expCandidates.length > 0) {
      chosenExperience = expCandidates[0];
      experienceTotal = chosenExperience.privatePricePerPerson * args.people;
    }
  }

  const totalUsd = stayTotal + transportTotal + experienceTotal;
  const withinBudget = totalUsd <= budgetUsd;
  const overByUsd = withinBudget ? 0 : totalUsd - budgetUsd;
  const remainderUsd = withinBudget ? budgetUsd - totalUsd : 0;

  return {
    ok: true,
    nights,
    people: args.people,
    package: {
      stay: {
        id: chosenStay.id,
        title: chosenStay.title,
        location: chosenStay.location,
        price_per_night: await formatPrice(chosenStay.price, sessionId),
        nights,
        subtotal: await formatPrice(stayTotal, sessionId),
        subtotal_usd: stayTotal,
      },
      transport: chosenCar
        ? {
            id: chosenCar.id,
            model: chosenCar.model,
            price_per_day: await formatPrice(chosenCar.priceWithDriver, sessionId),
            nights,
            subtotal: await formatPrice(transportTotal, sessionId),
            subtotal_usd: transportTotal,
          }
        : null,
      experience: chosenExperience
        ? {
            id: chosenExperience.id,
            title: chosenExperience.title,
            price_per_person: await formatPrice(chosenExperience.privatePricePerPerson, sessionId),
            people: args.people,
            subtotal: await formatPrice(experienceTotal, sessionId),
            subtotal_usd: experienceTotal,
          }
        : null,
    },
    total: await formatPrice(totalUsd, sessionId),
    total_usd: totalUsd,
    budget: await formatPrice(budgetUsd, sessionId),
    within_budget: withinBudget,
    over_by: withinBudget ? null : await formatPrice(overByUsd, sessionId),
    over_by_usd: overByUsd || null,
    remainder: withinBudget ? await formatPrice(remainderUsd, sessionId) : null,
    remainder_usd: remainderUsd || null,
    warnings,
    note:
      "This is a starting proposal. If the customer wants upgrades, different dates, or a chef added, call again with adjusted parameters or add services individually.",
  };
}

// ═══════════════════════════════════════════════════════════════════
// BOOKINGS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a draft booking.
 *
 * IMPORTANT: This function does NOT accept a price from the caller.
 * The caller passes a configuration (stay_id, service_ids, dates, guests)
 * and the server re-fetches every entity, validates it, and calculates
 * the total itself. The model can never influence the final price.
 */
export async function createDraftBooking(
  args: {
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    guests: number;
    check_in: string;
    check_out: string;
    stay_id: string;
    service_ids?: string[];
    idempotency_key: string;
  },
  sessionId: string,
) {
  if (!hasUsableIdempotencyKey(args?.idempotency_key)) {
    return {
      ok: false,
      error: "idempotency_key_required",
      hint: "Generate a fresh UUID v4 before retrying the booking.",
    };
  }

  // 0. Idempotency check first
  const existing = await db
    .select()
    .from(bookings)
    .where(eq(bookings.idempotencyKey, args.idempotency_key))
    .limit(1);

  if (existing[0]) {
    return {
      ok: true,
      booking_id: existing[0].id,
      idempotent_replay: true,
      payment_link: `${appBaseUrl()}/bookings?bookingId=${existing[0].id}`,
      total: await formatPrice(existing[0].totalPrice, sessionId),
      deposit_display: await formatDepositDisplay(existing[0].totalPrice, existing[0].paymentDepositAmount, sessionId),
    };
  }

  // 1. Required-field guard. The model sometimes skips fields that are
  //    "required" in the declaration. Fail closed with a clear hint so it
  //    asks the customer rather than crashing downstream.
  if (typeof args.guests !== "number" || !Number.isInteger(args.guests) || args.guests < 1) {
    return {
      ok: false,
      error: "guests_required",
      hint: "Ask the customer how many guests will be staying.",
      tell_customer: "Got it — and how many guests will be staying? I need that to make sure the place fits everyone comfortably.",
    };
  }
  if (typeof args.customer_name !== "string" || args.customer_name.trim().length < 2) {
    return {
      ok: false,
      error: "customer_name_required",
      hint: "Ask the customer for their full name.",
      tell_customer: "May I have your full name for the booking, please?",
    };
  }
  if (
    typeof args.customer_email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(args.customer_email)
  ) {
    return {
      ok: false,
      error: "customer_email_invalid",
      hint: "The email looks invalid. Ask the customer to confirm it.",
      tell_customer:
        "Just to double-check, could you confirm your email address? " +
        "It looks like it may have a typo — I want to make sure your " +
        "confirmation reaches you.",
    };
  }
  if (typeof args.customer_phone !== "string" || args.customer_phone.trim().length < 7) {
    return {
      ok: false,
      error: "customer_phone_required",
      hint: "Ask the customer for their phone number.",
      tell_customer: "One more — what's the best phone number to reach you on?",
    };
  }

  // 2. Validate dates
  const nights = validateAndGetNights(args.check_in, args.check_out);
  if (nights === null) {
    return {
      ok: false,
      error: "invalid_dates",
      hint:
        "For a one-off service booking (no stay), use create_service_booking " +
        "instead — it accepts a single date.",
    };
  }

  // 3. Day-granularity advance window. Stays = 24h → "today rejected, tomorrow onward OK."
  const window = isBookingWindowSufficient(args.check_in, 24);
  if (!window.ok) {
    return {
      ok: false,
      error: window.reason,
      today_in_kenya: window.today,
      requested_check_in: args.check_in,
      required_days_ahead: window.required_days,
      hint:
        window.reason === "same_day_not_allowed"
          ? `Same-day bookings go through the team directly. Today in Kenya is ${window.today}. Ask the customer to pick tomorrow or later, or connect them with the team.`
          : window.reason === "date_in_past"
            ? `The requested date (${args.check_in}) is in the past. Today in Kenya is ${window.today}. Ask for a future date.`
            : `This needs ${window.required_days} day(s) advance notice. Today is ${window.today}. Ask for a later date.`,
    };
  }

  // 4. Validate stay
  const [stay] = await db.select().from(stays).where(eq(stays.id, args.stay_id)).limit(1);
  if (!stay) return { ok: false, error: "stay_not_found" };
  if (!stay.isPublic || !stay.managerUserId) {
    return { ok: false, error: "stay_not_bookable" };
  }
  if (args.guests > stay.maxOccupancy) {
    return {
      ok: false,
      error: "guest_count_exceeds_capacity",
      max_occupancy: stay.maxOccupancy,
      requested_guests: args.guests,
      hint:
        `"${stay.title}" fits up to ${stay.maxOccupancy} guests but the customer ` +
        `asked for ${args.guests}. Tell the customer the capacity and offer to ` +
        `search for a larger stay, or connect them with the team.`,
    };
  }

  // 5. Check stay availability
  const candidateBookings = await db
    .select({
      status: bookings.status,
      totalPrice: bookings.totalPrice,
      paymentStatus: bookings.paymentStatus,
      paymentAmountPaid: bookings.paymentAmountPaid,
      paymentDepositAmount: bookings.paymentDepositAmount,
      paymentHoldExpiresAt: bookings.paymentHoldExpiresAt,
      serviceMode: bookings.serviceMode,
    })
    .from(bookings)
    .where(and(
      eq(bookings.accommodationId, args.stay_id),
      ne(bookings.status, "cancelled"),
      lt(bookings.checkIn, args.check_out),
      gt(bookings.checkOut, args.check_in),
    ))
    .limit(20);
  if (candidateBookings.some(bookingBlocksAvailability)) {
    return {
      ok: false,
      error: "stay_not_available",
      hint: "The selected stay is no longer available for those dates. Call search_stays again for alternatives before retrying.",
      tell_customer: "That stay has just become unavailable for those dates. Let me check the closest alternatives for you.",
    };
  }

  // 6. Server-side pricing. Never trust a price from the model.
  let totalUsd = stay.price * nights;
  const staySubtotal = totalUsd;

  const serviceIds = Array.from(new Set((args.service_ids || []).filter(Boolean)));
  const pricedServices: Array<{ id: string; name: string; subtotal: number }> = [];

  for (const serviceId of serviceIds) {
    const [cook] = await db.select().from(cooks).where(eq(cooks.id, serviceId)).limit(1);
    if (cook) {
      if (!cook.isPublic || !cook.managerUserId) {
        return { ok: false, error: "service_not_bookable", service_id: serviceId };
      }
      const sessionRate = cook.serviceFee || cook.pricePerSession;
      if (!sessionRate || cook.pricePerPlate || cook.priceSingleMeal) {
        return {
          ok: false,
          error: "requires_manual_quote",
          reason: "This chef uses per-plate or per-meal pricing, or a custom menu. The team will send a quote.",
          service_id: serviceId,
        };
      }
      const subtotal = sessionRate * nights;
      totalUsd += subtotal;
      pricedServices.push({ id: cook.id, name: cook.title, subtotal });
      continue;
    }

    const [car] = await db.select().from(cars).where(eq(cars.id, serviceId)).limit(1);
    if (car) {
      if (!car.isPublic || !car.managerUserId) {
        return { ok: false, error: "service_not_bookable", service_id: serviceId };
      }
      if (args.guests > car.seats) {
        return { ok: false, error: "guest_count_exceeds_car_capacity", service_id: serviceId };
      }
      const subtotal = car.priceWithDriver * nights;
      totalUsd += subtotal;
      pricedServices.push({ id: car.id, name: car.model, subtotal });
      continue;
    }

    const [experience] = await db.select().from(experiences).where(eq(experiences.id, serviceId)).limit(1);
    if (experience) {
      if (!experience.isPublic || !experience.managerUserId) {
        return { ok: false, error: "service_not_bookable", service_id: serviceId };
      }
      if (args.guests < experience.privateMinimumGuests || args.guests > experience.maxGuests) {
        return { ok: false, error: "guest_count_out_of_range", service_id: serviceId };
      }
      const subtotal = experience.privatePricePerPerson * args.guests;
      totalUsd += subtotal;
      pricedServices.push({ id: experience.id, name: experience.title, subtotal });
      continue;
    }

    const [errand] = await db.select().from(errands).where(eq(errands.id, serviceId)).limit(1);
    if (errand) {
      if (!errand.isPublic || !errand.managerUserId) {
        return { ok: false, error: "service_not_bookable", service_id: serviceId };
      }
      const subtotal = errand.basePrice;
      totalUsd += subtotal;
      pricedServices.push({ id: errand.id, name: errand.serviceName, subtotal });
      continue;
    }

    return { ok: false, error: "service_not_found", service_id: serviceId };
  }

  // 7. Create booking
  const now = new Date().toISOString();
  const bookingData = {
    userId: null,
    accommodationId: args.stay_id,
    guestName: args.customer_name,
    guestEmail: args.customer_email,
    guestPhone: args.customer_phone,
    checkIn: args.check_in,
    checkOut: args.check_out,
    guests: args.guests,
    selectedServices: serviceIds,
    serviceMode: null,
    serviceHours: null,
    serviceLocation: null,
    servicePickupLocation: null,
    serviceReturnLocation: null,
    serviceZone: null,
    serviceStartTime: null,
    serviceEndTime: null,
    serviceBudgetAmount: null,
    serviceLaundryWeightKg: null,
    serviceAddonSelections: [],
    serviceScheduleSlots: [],
    serviceDepartureId: null,
    serviceRequestFee: null,
    serviceRequestDetails: null,
    serviceResponseMessage: null,
    serviceRequestFeeKes: null,
    stayServiceSelections: [],
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
    paymentStatus: "pending",
    paymentProvider: null,
    paymentReference: null,
    paymentSessionId: null,
    paymentCurrency: "USD",
    paymentAmount: null,
    paymentCheckoutAmount: null,
    paymentDepositAmount: calculateBookingDepositAmount(Math.round(totalUsd)),
    paymentAmountPaid: 0,
    paymentHoldExpiresAt: null,
    paidAt: null,
    paymentFailedAt: null,
    totalPrice: Math.round(totalUsd),
    status: "upcoming",
    bookingType: "accommodation",
    createdAt: now,
    idempotencyKey: args.idempotency_key,
  } as any;

  const creation = await createBookingWithInventoryLock(
    [`stay:${args.stay_id}`, ...serviceIds.map((serviceId) => `service:${serviceId}`)],
    bookingData,
    async (executor) => {
      if (await hasStayInventoryConflict(executor, args.stay_id, args.check_in, args.check_out)) {
        return "stay_not_available";
      }
      for (const serviceId of serviceIds) {
        if (await hasServiceInventoryConflict(executor, serviceId, args.check_in, args.check_out)) {
          return "service_not_available";
        }
      }
      return null;
    },
  );
  if (creation.conflict === "stay_not_available") {
    return {
      ok: false,
      error: "stay_not_available",
      hint: "The selected stay is no longer available for those dates. Call search_stays again for alternatives before retrying.",
      tell_customer: "That stay has just become unavailable for those dates. Let me check the closest alternatives for you.",
    };
  }
  if (creation.conflict === "service_not_available") {
    return {
      ok: false,
      error: "service_not_available",
      hint: "One of the selected services is no longer available for those dates. Offer alternatives before retrying.",
      tell_customer: "One of the selected services has just become unavailable for those dates. Let me check the closest alternatives for you.",
    };
  }
  const booking = creation.booking;
  if (!booking) {
    return { ok: false, error: "booking_creation_failed" };
  }

  const paymentLink = `${appBaseUrl()}/bookings?bookingId=${booking.id}`;

  queueNotificationTask(
    `zaina stay booking notifications for ${booking.id}`,
    (async () => notifyBookingCreated({
      bookingId: booking.id,
      customerName: args.customer_name,
      customerEmail: args.customer_email,
      customerPhone: args.customer_phone,
      kind: "stay",
      summary: `${nights} night${nights === 1 ? "" : "s"} at ${stay.title} (${args.check_in} → ${args.check_out}, ${args.guests} guest${args.guests === 1 ? "" : "s"})`,
      totalDisplay: await formatPrice(totalUsd, sessionId),
      paymentLink,
      sessionId,
    }))(),
  );

  return {
    ok: true,
    booking_id: booking.id,
    payment_link: paymentLink,
    status: "draft",
    nights,
    stay: {
      id: stay.id,
      title: stay.title,
      subtotal: await formatPrice(staySubtotal, sessionId),
    },
    services: await Promise.all(
      pricedServices.map(async (s) => ({
        id: s.id,
        name: s.name,
        subtotal: await formatPrice(s.subtotal, sessionId),
      })),
    ),
    total: await formatPrice(totalUsd, sessionId),
    deposit_display: await formatDepositDisplay(totalUsd, bookingData.paymentDepositAmount, sessionId),
  };
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE BOOKINGS — standalone, no stay required
// ═══════════════════════════════════════════════════════════════════
//
// Use this for one-off services where the customer is NOT booking a stay:
// MamaCare, private chefs (session mode), standalone experiences, base errands.

export async function createServiceBooking(
  args: {
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    service_id: string;
    date: string;
    check_out?: string;
    mode: string;
    guests?: number;
    service_location?: string;
    service_pickup_location?: string;
    service_return_location?: string;
    service_zone?: string;
    service_start_time?: string;
    service_end_time?: string;
    service_request_details?: string;
    service_budget_amount?: number;
    service_budget_currency?: string;
    service_bedrooms?: number;
    service_laundry_weight_kg?: number;
    service_addon_selections?: string[];
    service_schedule_slots?: Array<{ date: string; note?: string }>;
    service_departure_id?: string;
    mamacare_children?: Array<{ age_band_id: string; count: number }>;
    mamacare_care_mode?: "hourly_daytime" | "hourly_evening" | "overnight" | "full_day";
    mamacare_hours?: number;
    quantity?: number;
    idempotency_key: string;
  },
  sessionId: string,
) {
  if (!hasUsableIdempotencyKey(args?.idempotency_key)) {
    return {
      ok: false,
      error: "idempotency_key_required",
      hint: "Generate a fresh UUID v4 before retrying the booking.",
    };
  }

  // 0. Idempotency
  const existing = await db
    .select()
    .from(bookings)
    .where(eq(bookings.idempotencyKey, args.idempotency_key))
    .limit(1);
  if (existing[0]) {
    return {
      ok: true,
      booking_id: existing[0].id,
      idempotent_replay: true,
      payment_link: `${appBaseUrl()}/bookings?bookingId=${existing[0].id}`,
      total: await formatPrice(existing[0].totalPrice, sessionId),
      deposit_display: await formatDepositDisplay(existing[0].totalPrice, existing[0].paymentDepositAmount, sessionId),
    };
  }

  // 1. Required-field guards
  if (typeof args.customer_name !== "string" || args.customer_name.trim().length < 2) {
    return {
      ok: false,
      error: "customer_name_required",
      hint: "Ask the customer for their full name.",
      tell_customer: "May I have your full name for the booking, please?",
    };
  }
  if (typeof args.customer_email !== "string" || !args.customer_email.includes("@")) {
    return {
      ok: false,
      error: "customer_email_required",
      hint: "Ask the customer for their email address.",
      tell_customer: "And what email should I use for your booking confirmation?",
    };
  }
  if (typeof args.customer_phone !== "string" || args.customer_phone.trim().length < 7) {
    return {
      ok: false,
      error: "customer_phone_required",
      hint: "Ask the customer for their phone number.",
      tell_customer: "One more — what's the best phone number to reach you on?",
    };
  }

  // 2. Validate date format
  if (!args.date || !isValidIsoDate(args.date)) {
    return { ok: false, error: "invalid_date", hint: "Date must be YYYY-MM-DD." };
  }

  if (typeof args.mode !== "string" || !args.mode.trim()) {
    return {
      ok: false,
      error: "service_mode_required",
      hint: "Choose the service mode before creating the booking.",
    };
  }

  // 3. Day-granularity advance window.
  let advanceHours = 6;
  if (args.mode.startsWith("cook")) advanceHours = 12;
  else if (args.mode.startsWith("experience")) advanceHours = 12;

  const window = isBookingWindowSufficient(args.date, advanceHours);
  if (!window.ok) {
    return {
      ok: false,
      error: window.reason,
      today_in_kenya: window.today,
      requested_date: args.date,
      required_days_ahead: window.required_days,
      hint:
        window.reason === "same_day_not_allowed"
          ? `Same-day bookings go through the team directly. Today in Kenya is ${window.today}. Ask the customer to pick tomorrow or later, or connect them with the team.`
          : window.reason === "date_in_past"
            ? `The requested date (${args.date}) is in the past. Today in Kenya is ${window.today}. Ask for a future date.`
            : `This needs ${window.required_days} day(s) advance notice. Today is ${window.today}. Ask for a later date.`,
    };
  }

  // 4. Look up the service across all tables
  const [car] = await db.select().from(cars).where(eq(cars.id, args.service_id)).limit(1);
  const [cook] = await db.select().from(cooks).where(eq(cooks.id, args.service_id)).limit(1);
  const [errand] = await db.select().from(errands).where(eq(errands.id, args.service_id)).limit(1);
  const [experience] = await db.select().from(experiences).where(eq(experiences.id, args.service_id)).limit(1);

  if (!car && !cook && !errand && !experience) {
    return { ok: false, error: "service_not_found" };
  }

  const isCarBooking = Boolean(car);
  const isCarHourly = args.mode === "car-chauffeur-hourly";
  if (isCarBooking && !["car-chauffeur-day", "car-chauffeur-hourly", "car-self-drive-day"].includes(args.mode)) {
    return { ok: false, error: "car_mode_required", hint: "Choose chauffeur day, chauffeur hourly, or self-drive day." };
  }
  const serviceCheckOut = isCarBooking ? (args.check_out || args.date) : args.date;
  if (!isValidIsoDate(serviceCheckOut)) {
    return { ok: false, error: "invalid_date", hint: "Date must be YYYY-MM-DD." };
  }
  if (isCarBooking && !isCarHourly && serviceCheckOut <= args.date) {
    return { ok: false, error: "invalid_dates", hint: "Car day bookings require a check_out date after the pickup date." };
  }
  if (isCarBooking && isCarHourly && serviceCheckOut !== args.date) {
    return { ok: false, error: "invalid_dates", hint: "Hourly chauffeur bookings must start and end on the same date." };
  }

  const guestCount = positiveIntegerOrDefault(args.guests, 1);

  if ((cook || errand) && (typeof args.service_location !== "string" || !args.service_location.trim())) {
    return {
      ok: false,
      error: "service_location_required",
      hint: "Ask where the service will take place before creating the booking.",
      tell_customer: "Where should we provide the service? Please share the villa, hotel, or other location.",
    };
  }
  if (car && (typeof args.service_pickup_location !== "string" || !args.service_pickup_location.trim()
    || typeof args.service_return_location !== "string" || !args.service_return_location.trim())) {
    return {
      ok: false,
      error: "car_locations_required",
      hint: "Ask for pickup and return locations before creating the car booking.",
      tell_customer: "Where should we pick you up, and where should the car be returned?",
    };
  }

  // A standalone service booking occupies that service on its requested day.
  // Ignore unpaid drafts, but respect a paid booking, deposit, or active
  // checkout hold so two customers cannot secure the same provider at once.
  const nextDate = addOneDay(serviceCheckOut);
  const serviceBookings = await db
    .select({
      status: bookings.status,
      totalPrice: bookings.totalPrice,
      paymentStatus: bookings.paymentStatus,
      paymentAmountPaid: bookings.paymentAmountPaid,
      paymentDepositAmount: bookings.paymentDepositAmount,
      paymentHoldExpiresAt: bookings.paymentHoldExpiresAt,
      serviceMode: bookings.serviceMode,
    })
    .from(bookings)
    .where(and(
      sql`${bookings.selectedServices} @> ARRAY[${args.service_id}]::text[]`,
      ne(bookings.status, "cancelled"),
      or(
        and(lt(bookings.checkIn, nextDate), gt(bookings.checkOut, args.date)),
        eq(bookings.checkIn, args.date),
      ),
    ))
    .limit(20);
  if (serviceBookings.some(bookingBlocksAvailability)) {
    return { ok: false, error: "service_not_available", hint: "Offer another date or connect the customer with the team." };
  }

  let totalUsd = 0;
  const serviceAddonSelections: string[] = [];
  let serviceHours: number | null = null;
  // Stored in USD, like every other amount on bookings.
  let serviceBudgetUsd: number | null = null;

  // ─── Car rental / chauffeur ────────────────────────────────────
  if (car) {
    if (!car.isPublic || !car.managerUserId) {
      return { ok: false, error: "service_not_bookable" };
    }
    if (guestCount > car.seats) {
      return { ok: false, error: "guest_count_exceeds_car_capacity", maximum_guests: car.seats };
    }

    const selectedZone = args.service_zone
      ? car.chauffeurZones.find((zone) => zone.name === args.service_zone)
      : undefined;
    if (args.service_zone && !selectedZone) {
      return { ok: false, error: "service_zone_not_found" };
    }

    if (isCarHourly) {
      if (!car.priceWithDriverHourly || !args.service_start_time || !args.service_end_time) {
        return { ok: false, error: "hourly_chauffeur_details_required" };
      }
      const startMinutes = parseTimeToMinutes(args.service_start_time);
      const endMinutes = parseTimeToMinutes(args.service_end_time);
      if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
        return { ok: false, error: "invalid_service_times", hint: "End time must be after start time." };
      }
      serviceHours = Math.ceil((endMinutes - startMinutes) / 60);
      if (serviceHours < 3) {
        return { ok: false, error: "minimum_hours_required", minimum_hours: 3 };
      }
      totalUsd = serviceHours * (selectedZone?.hourlyPrice || car.priceWithDriverHourly);
    } else {
      const days = Math.max(1, daysBetween(args.date, serviceCheckOut));
      const dailyRate = args.mode === "car-self-drive-day"
        ? (selectedZone?.selfDrivePrice || car.pricePerDay)
        : (selectedZone?.dailyPrice || car.priceWithDriver);
      if (!dailyRate) {
        return { ok: false, error: "car_mode_not_available" };
      }
      totalUsd = days * dailyRate;
    }
  }
  // ─── Errand: MamaCare ─────────────────────────────────────────
  else if (errand && args.mode === "errand-childcare") {
    if (!errand.isPublic || !errand.managerUserId) {
      return { ok: false, error: "service_not_bookable" };
    }
    const pricing = errand.helpMamaPricing;
    if (!pricing?.enabled) {
      return { ok: false, error: "mamacare_not_configured" };
    }
    const children = args.mamacare_children ?? [];
    if (!children.length) {
      return {
        ok: false,
        error: "no_children_specified",
        hint: "Provide mamacare_children with each child's age_band_id and count.",
      };
    }
    const careMode = args.mamacare_care_mode ?? "overnight";
    const careHours = positiveIntegerOrDefault(args.mamacare_hours, HELP_MAMA_HOURLY_MINIMUM_HOURS);
    const isHourly = careMode === "hourly_daytime" || careMode === "hourly_evening";
    if (isHourly && careHours < HELP_MAMA_HOURLY_MINIMUM_HOURS) {
      return {
        ok: false,
        error: "below_minimum_hours",
        minimum_hours: HELP_MAMA_HOURLY_MINIMUM_HOURS,
      };
    }

    const bands = pricing.ageBands ?? [];
    for (const child of children) {
      const childCount = positiveIntegerOrDefault(child.count, 0);
      if (childCount < 1) {
        return { ok: false, error: "invalid_child_count", age_band_id: child.age_band_id };
      }
      const band = bands.find((b: any) => b.id === child.age_band_id);
      if (!band) {
        return {
          ok: false,
          error: "age_band_not_found",
          age_band_id: child.age_band_id,
          available_bands: bands.map((b: any) => ({ id: b.id, label: b.label })),
        };
      }
      const rate = {
        hourly_daytime: band.hourlyDaytimePrice,
        hourly_evening: band.hourlyEveningPrice,
        overnight: band.overnightPrice,
        full_day: band.fullDayPrice,
      }[careMode];
      if (!rate) {
        return {
          ok: false,
          error: "rate_not_configured",
          age_band_id: child.age_band_id,
          mode: careMode,
        };
      }
      const qty = isHourly ? Math.max(HELP_MAMA_HOURLY_MINIMUM_HOURS, careHours) : 1;
      totalUsd += rate * childCount * qty;
      serviceAddonSelections.push(band.id);
    }

    const rateIdMap: Record<string, string> = {
      hourly_daytime: "help-mama-hourly-daytime",
      hourly_evening: "help-mama-hourly-evening",
      overnight: "help-mama-overnight",
      full_day: "help-mama-full-day",
    };
    serviceAddonSelections.push(rateIdMap[careMode]);
  }
  // ─── Errands ──────────────────────────────────────────────────
  else if (errand && ["errand-base", "errand-shopping", "errand-laundry", "errand-house-cleaning"].includes(args.mode)) {
    if (!errand.isPublic || !errand.managerUserId) {
      return { ok: false, error: "service_not_bookable" };
    }
    const packageCount = positiveIntegerOrDefault(args.quantity, 1);
    const addonSelections = Array.isArray(args.service_addon_selections) ? args.service_addon_selections : [];
    if (args.mode === "errand-shopping") {
      if (!errand.shoppingEnabled || !args.service_budget_amount || args.service_budget_amount <= 0) {
        return { ok: false, error: "shopping_details_required", hint: "Ask for the estimated shopping budget and the shopping list." };
      }
      if (!args.service_request_details?.trim()) {
        return { ok: false, error: "shopping_list_required", tell_customer: "What would you like us to shop for, and what budget should I work with?" };
      }
      const budget = toUsdAmount(
        args.service_budget_amount,
        args.service_budget_currency,
        (await getUsdToKesRate()).usdToKes,
      );
      if (!budget.ok) {
        return {
          ok: false,
          error: budget.error === "amount_invalid" ? "shopping_details_required" : "budget_currency_required",
          hint: "Pass service_budget_amount exactly as the customer stated it, with service_budget_currency set to USD or KES. Never convert the budget yourself.",
        };
      }
      serviceBudgetUsd = budget.usd;
      totalUsd = (errand.basePrice + serviceBudgetUsd + Math.ceil((serviceBudgetUsd * errand.shoppingCommissionPercent) / 100)) * packageCount;
    } else if (args.mode === "errand-laundry") {
      if (!errand.laundryEnabled) return { ok: false, error: "laundry_not_available" };
      const selectedAddons = (errand.laundryAddons || []).filter((addon) => addonSelections.includes(addon.id));
      totalUsd = (errand.basePrice + selectedAddons.reduce((sum, addon) => sum + addon.price, 0)) * packageCount;
      serviceAddonSelections.push(...selectedAddons.map((addon) => addon.id));
    } else if (args.mode === "errand-house-cleaning") {
      if (!errand.houseCleaningEnabled) return { ok: false, error: "house_cleaning_not_available" };
      // The price scales with bedrooms, so never assume a default count.
      if (typeof args.service_bedrooms !== "number" || !Number.isFinite(args.service_bedrooms) || args.service_bedrooms < 1) {
        return {
          ok: false,
          error: "bedroom_count_required",
          hint: "Ask how many bedrooms need cleaning, then pass service_bedrooms.",
          tell_customer: "How many bedrooms should we clean?",
        };
      }
      const bedroomCount = getHouseCleaningBedroomCount(args.service_bedrooms);
      const selectedAddons = (errand.houseCleaningAddons || []).filter((addon) => addonSelections.includes(addon.id));
      totalUsd = calculateHouseCleaningPackagePrice(errand, selectedAddons.map((addon) => addon.id), bedroomCount) * packageCount;
      serviceHours = bedroomCount;
      serviceAddonSelections.push(...selectedAddons.map((addon) => addon.id));
    } else {
      totalUsd = errand.basePrice * packageCount;
    }
  }
  // ─── Errand: unknown modes → ops ──────────────────────────────
  else if (errand) {
    return {
      ok: false,
      error: "requires_manual_quote",
      reason: `${args.mode} bookings need details the team will confirm. Route to ops.`,
    };
  }
  // ─── Cook ─────────────────────────────────────────────────────
  else if (cook) {
    if (!cook.isPublic || !cook.managerUserId) {
      return { ok: false, error: "service_not_bookable" };
    }
    if (guestCount < cook.minimumGuests || guestCount > cook.maxGuests) {
      return {
        ok: false,
        error: "guest_count_out_of_range",
        minimum_guests: cook.minimumGuests,
        maximum_guests: cook.maxGuests,
      };
    }
    if (args.mode === "cook-service-fee") {
      const sessionRate = cook.serviceFee || cook.pricePerSession;
      if (!sessionRate) return { ok: false, error: "no_pricing_configured" };
      totalUsd = sessionRate * positiveIntegerOrDefault(args.quantity, 1);
    } else if (args.mode === "cook-inclusive") {
      const inclusiveRate = cook.inclusivePrice || cook.serviceFee || cook.pricePerSession;
      if (!inclusiveRate) return { ok: false, error: "no_pricing_configured" };
      totalUsd = inclusiveRate * positiveIntegerOrDefault(args.quantity, 1);
    } else if (args.mode === "cook-per-plate") {
      if (!cook.pricePerPlate) return { ok: false, error: "plate_pricing_not_configured" };
      const plates = positiveIntegerOrDefault(args.quantity, guestCount);
      if (plates < (cook.minPlates || 4)) return { ok: false, error: "below_minimum", minimum_plates: cook.minPlates || 4 };
      totalUsd = cook.pricePerPlate * plates;
    } else if (args.mode === "cook-single-meal") {
      if (!cook.priceSingleMeal) return { ok: false, error: "single_meal_pricing_not_configured" };
      totalUsd = cook.priceSingleMeal * positiveIntegerOrDefault(args.quantity, 1);
    } else {
      return {
        ok: false,
        error: "requires_manual_quote",
        reason: "This chef booking mode needs a custom quote.",
      };
    }
  }
  // ─── Experience ───────────────────────────────────────────────
  else if (experience) {
    if (!experience.isPublic || !experience.managerUserId) {
      return { ok: false, error: "service_not_bookable" };
    }
    if (args.mode === "experience-private") {
      if (!experience.privateEnabled || guestCount < experience.privateMinimumGuests || guestCount > experience.maxGuests) {
        return {
          ok: false,
          error: "guest_count_out_of_range",
          minimum_guests: experience.privateMinimumGuests,
          maximum_guests: experience.maxGuests,
        };
      }
      totalUsd = experience.privatePricePerPerson * guestCount;
    } else if (args.mode === "experience-shared") {
      if (!experience.sharedEnabled || !args.service_departure_id) {
        return { ok: false, error: "shared_departure_required", hint: "Choose one shared departure before booking." };
      }
      const departure = (experience.sharedDepartures || []).find((item) => item.id === args.service_departure_id);
      if (!departure || departure.date !== args.date) return { ok: false, error: "shared_departure_not_found" };
      const departureBookings = await db
        .select({ guests: bookings.guests })
        .from(bookings)
        .where(and(
          sql`${bookings.selectedServices} @> ARRAY[${args.service_id}]::text[]`,
          eq(bookings.serviceMode, "experience-shared"),
          eq(bookings.serviceDepartureId, departure.id),
          ne(bookings.status, "cancelled"),
        ));
      const bookedGuests = departureBookings.reduce((total, booking) => total + Math.max(1, booking.guests || 1), 0);
      const spotsLeft = Math.max(0, experience.sharedMaxCapacity - bookedGuests);
      if (guestCount > spotsLeft) return { ok: false, error: "shared_departure_full", spots_left: spotsLeft };
      totalUsd = (experience.sharedPricePerPerson || experience.price) * guestCount;
    } else {
      return {
        ok: false,
        error: "requires_manual_quote",
        reason: "This experience mode needs a custom quote.",
      };
    }
  }

  if (totalUsd <= 0) {
    return { ok: false, error: "could_not_price" };
  }

  // 5. Create the booking
  const now = new Date().toISOString();
  const bookingData = {
    userId: null,
    accommodationId: null,
    guestName: args.customer_name,
    guestEmail: args.customer_email,
    guestPhone: args.customer_phone,
    checkIn: args.date,
    checkOut: serviceCheckOut,
    guests: guestCount,
    selectedServices: [args.service_id],
    serviceMode: args.mode,
    serviceHours: serviceHours ?? args.mamacare_hours ?? null,
    serviceLocation: args.service_location ?? null,
    servicePickupLocation: args.service_pickup_location ?? null,
    serviceReturnLocation: args.service_return_location ?? null,
    serviceZone: args.service_zone ?? null,
    serviceStartTime: args.service_start_time ?? null,
    serviceEndTime: args.service_end_time ?? null,
    serviceBudgetAmount: serviceBudgetUsd,
    serviceLaundryWeightKg: args.service_laundry_weight_kg ?? null,
    serviceAddonSelections,
    serviceScheduleSlots: args.service_schedule_slots ?? (args.mode.startsWith("errand-") ? [{ date: args.date, note: args.service_request_details?.slice(0, 120) }] : []),
    serviceDepartureId: args.service_departure_id ?? null,
    serviceRequestFee: null,
    serviceRequestDetails: args.service_request_details ?? null,
    serviceResponseMessage: null,
    serviceRequestFeeKes: null,
    stayServiceSelections: [],
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
    paymentStatus: "pending",
    paymentProvider: null,
    paymentReference: null,
    paymentSessionId: null,
    paymentCurrency: "USD",
    paymentAmount: null,
    paymentCheckoutAmount: null,
    paymentDepositAmount: calculateBookingDepositAmount(Math.round(totalUsd)),
    paymentAmountPaid: 0,
    paymentHoldExpiresAt: null,
    paidAt: null,
    paymentFailedAt: null,
    totalPrice: Math.round(totalUsd),
    status: "upcoming",
    bookingType: "service",
    createdAt: now,
    idempotencyKey: args.idempotency_key,
  } as any;

  const creation = await createBookingWithInventoryLock(
    [`service:${args.service_id}`],
    bookingData,
    async (executor) => {
      if (await hasServiceInventoryConflict(executor, args.service_id, args.date, serviceCheckOut)) {
        return "service_not_available";
      }

      if (experience && args.mode === "experience-shared" && args.service_departure_id) {
        const departureBookings = await executor
          .select({ guests: bookings.guests })
          .from(bookings)
          .where(and(
            sql`${bookings.selectedServices} @> ARRAY[${args.service_id}]::text[]`,
            eq(bookings.serviceMode, "experience-shared"),
            eq(bookings.serviceDepartureId, args.service_departure_id),
            ne(bookings.status, "cancelled"),
          ));
        const bookedGuests = departureBookings.reduce(
          (total: number, booking: { guests: number | null }) => total + Math.max(1, booking.guests || 1),
          0,
        );
        if (guestCount > Math.max(0, experience.sharedMaxCapacity - bookedGuests)) {
          return "shared_departure_full";
        }
      }

      return null;
    },
  );
  if (creation.conflict === "service_not_available") {
    return {
      ok: false,
      error: "service_not_available",
      hint: "The selected service is no longer available for that date. Offer another date or connect the customer with the team.",
      tell_customer: "That service has just become unavailable for that date. Let me check the closest alternatives for you.",
    };
  }
  if (creation.conflict === "shared_departure_full") {
    return {
      ok: false,
      error: "shared_departure_full",
      hint: "The selected shared departure filled up before the booking was created. Offer another departure.",
      tell_customer: "That shared departure has just filled up. Let me look for another departure or a private option.",
    };
  }
  const booking = creation.booking;
  if (!booking) {
    return { ok: false, error: "booking_creation_failed" };
  }

  const paymentLink = `${appBaseUrl()}/bookings?bookingId=${booking.id}`;

  const serviceLabel = car?.model ?? errand?.serviceName ?? cook?.title ?? experience?.title ?? "Service";

  queueNotificationTask(
    `zaina service booking notifications for ${booking.id}`,
    (async () => notifyBookingCreated({
      bookingId: booking.id,
      customerName: args.customer_name,
      customerEmail: args.customer_email,
      customerPhone: args.customer_phone,
      kind: "service",
      summary: `${serviceLabel} on ${args.date} (${args.mode})`,
      totalDisplay: await formatPrice(totalUsd, sessionId),
      paymentLink,
      sessionId,
    }))(),
  );

  return {
    ok: true,
    booking_id: booking.id,
    payment_link: paymentLink,
    status: "draft",
    total: await formatPrice(totalUsd, sessionId),
    deposit_display: await formatDepositDisplay(totalUsd, bookingData.paymentDepositAmount, sessionId),
  };
}

// ═══════════════════════════════════════════════════════════════════
// CUSTOM OFFERS
// ═══════════════════════════════════════════════════════════════════

async function createCustomOfferBooking(args: {
  offerId: string;
  feeUsd: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  requestDetails: string;
  travelDates?: string;
  budgetUsd?: number;
  idempotencyKey: string;
  sessionId: string;
  serviceMode?: string;
  serviceRequestFeeKes?: number | null;
  notifyAdmin?: boolean;
  /** Summary line for the admin inbox and booking email. */
  notificationSummary?: string;
  /** Transaction to write in; the caller then sends the notification after commit. */
  executor?: any;
}) {
  const now = new Date().toISOString();
  const booking = await storage.createBooking({
    userId: null,
    accommodationId: null,
    guestName: args.customerName,
    guestEmail: args.customerEmail,
    guestPhone: args.customerPhone ?? null,
    checkIn: args.travelDates || now.slice(0, 10),
    checkOut: args.travelDates || now.slice(0, 10),
    guests: 1,
    selectedServices: [],
    serviceMode: args.serviceMode ?? "experience-custom-offer",
    serviceHours: null,
    serviceLocation: null,
    servicePickupLocation: null,
    serviceReturnLocation: null,
    serviceZone: null,
    serviceStartTime: null,
    serviceEndTime: null,
    serviceBudgetAmount: args.budgetUsd ? Math.round(args.budgetUsd) : null,
    serviceLaundryWeightKg: null,
    serviceAddonSelections: [],
    serviceScheduleSlots: [],
    serviceDepartureId: null,
    serviceRequestFee: args.feeUsd,
    serviceRequestDetails: `[Zaina custom offer ${args.offerId}] ${args.requestDetails}`,
    serviceResponseMessage: null,
    serviceRequestFeeKes: args.serviceRequestFeeKes ?? null,
    stayServiceSelections: [],
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
    paymentStatus: "pending",
    paymentProvider: null,
    paymentReference: null,
    paymentSessionId: null,
    paymentCurrency: "USD",
    paymentAmount: null,
    paymentCheckoutAmount: null,
    paymentDepositAmount: null,
    paymentAmountPaid: 0,
    paymentHoldExpiresAt: null,
    paidAt: null,
    paymentFailedAt: null,
    totalPrice: args.feeUsd,
    status: "upcoming",
    bookingType: "service",
    createdAt: now,
    idempotencyKey: args.idempotencyKey,
  } as any, args.executor ?? db);

  const paymentLink = `${appBaseUrl()}/bookings?bookingId=${booking.id}`;
  if (args.notifyAdmin !== false && !args.executor) {
    queueCustomOfferBookingNotification({ ...args, bookingId: booking.id, paymentLink });
  }

  return { booking, paymentLink };
}

function queueCustomOfferBookingNotification(args: {
  bookingId: string;
  paymentLink: string;
  feeUsd: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  requestDetails: string;
  notificationSummary?: string;
  sessionId: string;
}) {
  queueNotificationTask(
    `zaina custom request notifications for ${args.bookingId}`,
    (async () => notifyBookingCreated({
      bookingId: args.bookingId,
      customerName: args.customerName,
      customerEmail: args.customerEmail,
      customerPhone: args.customerPhone ?? "",
      kind: "service",
      summary: args.notificationSummary ?? `Custom ${args.requestDetails.slice(0, 100)}`,
      totalDisplay: await formatPrice(args.feeUsd, args.sessionId),
      paymentLink: args.paymentLink,
      sessionId: args.sessionId,
    }))(),
  );
}

function getListingVerificationFeeKes() {
  const configured = Number(process.env.LISTING_VERIFICATION_FEE_KES ?? "2500");
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 2500;
}

/** Everything the customer has written in this conversation, oldest first. */
async function getCustomerMessages(sessionId: string): Promise<string[]> {
  const rows = await db
    .select({ messageContent: zainaAuditLogs.messageContent })
    .from(zainaAuditLogs)
    .where(and(eq(zainaAuditLogs.sessionId, sessionId), eq(zainaAuditLogs.actor, "USER")))
    .orderBy(asc(zainaAuditLogs.timestamp));
  return rows.map((row) => row.messageContent).filter((text): text is string => typeof text === "string");
}

function askForVerificationContact(missing: Array<"name" | "email">): string {
  if (missing.length === 2) return "Before I open the verification request, may I have your full name and email address?";
  return missing[0] === "email"
    ? "Before I open the verification request, may I have your email address? We'll send the payment link and your report there."
    : "Before I open the verification request, may I have your full name?";
}

/** Whether Zaina already asked this customer for the agent's or host's contact. */
async function hasAskedForAgentContact(sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: zainaAuditLogs.id })
    .from(zainaAuditLogs)
    .where(and(
      eq(zainaAuditLogs.sessionId, sessionId),
      eq(zainaAuditLogs.toolName, "create_listing_verification_request"),
      sql`${zainaAuditLogs.toolResponse}->>'error' = 'agent_contact_required'`,
    ))
    .limit(1);
  return Boolean(row);
}

export async function createListingVerificationRequest(
  // Read through textArg: the model can send any JSON type for these.
  args: {
    listing_url?: unknown;
    verification_scope?: unknown;
    agent_contact?: unknown;
    customer_name?: unknown;
    customer_email?: unknown;
    customer_phone?: unknown;
    location?: unknown;
    listing_context?: unknown;
    travel_dates?: unknown;
    idempotency_key: string;
  },
  sessionId: string,
) {
  if (!hasUsableIdempotencyKey(args?.idempotency_key)) {
    return { ok: false, error: "idempotency_key_required", hint: "Generate a fresh UUID v4 before retrying." };
  }
  // A listing can be verified from its link, from the customer's details (for
  // example an agent who shared it on WhatsApp without a link), or both.
  const rawLink = textArg(args.listing_url);
  const listingLink = normalizeListingLink(rawLink);
  const listingDetails = [
    textArg(args.listing_context),
    // Text passed as a "link" that isn't one still describes the listing.
    rawLink && !listingLink ? rawLink : "",
  ].filter(Boolean).join("\n");
  if (!listingLink && listingDetails.length < MIN_LISTING_DETAILS_LENGTH) {
    return {
      ok: false,
      error: "listing_details_required",
      tell_customer:
        "Please share the listing link if you have one. If not, tell me what you know — the property name or area, " +
        "the agent or host's name and phone number, and what they're offering.",
    };
  }
  const verificationScope = textArg(args.verification_scope);
  if (verificationScope.length < 10) {
    return { ok: false, error: "verification_scope_required", tell_customer: "What would you like us to verify — the property, amenities, host documents, or all three?" };
  }
  const customerMessages = await getCustomerMessages(sessionId);
  // How to reach the agent or host, if the customer gave it — passed on its
  // own or left inside the listing details.
  const agentContact = resolveAgentContact(args.agent_contact, customerMessages)
    ?? resolveAgentContact(phoneNumbersWritten(listingDetails).join(", "), customerMessages);
  // Without a link, the agent's or host's number is how the team finds the
  // property and arranges the visit, so ask for it first. Ask once: some
  // customers don't have it, and the request goes ahead without it.
  if (!listingLink && !agentContact && !(await hasAskedForAgentContact(sessionId))) {
    return {
      ok: false,
      error: "agent_contact_required",
      tell_customer:
        "What's the phone number of the agent or host who shared this listing (or their Instagram or Facebook page)? " +
        "Our team needs it to find the property and arrange the visit. If you don't have it, just say so and I'll " +
        "open the request with the details you've shared.",
    };
  }
  // Only contact details the customer actually gave: a name or email the
  // model filled in would send the payment link and report to nobody.
  const contact = resolveCustomerContact(
    { name: args.customer_name, email: args.customer_email, phone: args.customer_phone },
    customerMessages,
  );
  if (!contact.ok) {
    return { ok: false, error: "customer_contact_required", tell_customer: askForVerificationContact(contact.missing) };
  }
  // The number the customer typed may be the agent's, not their own.
  const customerPhone = contact.phone && agentContact && sharesPhoneNumber(contact.phone, agentContact) ? null : contact.phone;
  const agentContactNote = agentContact ?? (listingLink ? null : "Not given — the guest didn't have it; ask them if needed");
  const travelDates = textArg(args.travel_dates);

  const existing = await storage.getListingVerificationTask(args.idempotency_key);
  if (existing) {
    return {
      ok: true,
      idempotent_replay: true,
      verification_id: existing.id,
      booking_id: existing.bookingId,
      payment_link: `${appBaseUrl()}/bookings?bookingId=${existing.bookingId}`,
      fee_display: existing.feeKes ? `KSh ${existing.feeKes.toLocaleString("en-KE")}` : await formatPrice(existing.feeUsd, sessionId),
      status: existing.status,
      location: existing.location,
      source_platform: existing.sourcePlatform,
    };
  }

  const parsed = describeListingSource(listingLink, listingDetails, textArg(args.location) || undefined);
  const verificationLabel = [parsed.sourcePlatform, parsed.location].filter(Boolean).join(", ");
  const feeKes = getListingVerificationFeeKes();
  const rate = await getUsdToKesRate();
  const configuredUsd = Number(process.env.LISTING_VERIFICATION_FEE_USD ?? "0");
  const feeUsd = Number.isFinite(configuredUsd) && configuredUsd > 0
    ? Math.round(configuredUsd)
    : Math.max(1, Math.ceil(feeKes / rate.usdToKes));
  const currency = await getSessionCurrency(sessionId);
  const requestDetails = [
    "LISTING VERIFICATION REQUEST",
    `External listing: ${listingLink ?? "No link — see the listing details below"}`,
    `Source platform: ${parsed.sourcePlatform}`,
    `Location: ${parsed.location ?? "To be confirmed by the operations team"}`,
    `Verification scope: ${verificationScope}`,
    agentContactNote ? `Agent/host contact: ${agentContactNote}` : null,
    listingDetails ? `Customer-provided listing details: ${listingDetails}` : null,
  ].filter(Boolean).join("\n");
  const now = new Date().toISOString();
  const offerValues = {
    id: args.idempotency_key,
    sessionId,
    customerName: contact.name,
    customerEmail: contact.email,
    customerPhone,
    offerType: "listing_verification",
    requestDetails,
    budgetUsd: null,
    travelDates: travelDates || null,
    status: "awaiting_payment",
    feeTier: "verification",
    feeUsd,
    displayCurrency: currency,
    createdAt: now,
    updatedAt: now,
  };

  // The offer, its booking, and the verification task are written together,
  // so a failure part-way leaves nothing behind for a retry to trip over.
  await storage.ensureBookingWriteTables();
  const { booking, paymentLink, task } = await db.transaction(async (tx) => {
    const [offer] = await tx.insert(customOffers).values(offerValues)
      // A request that failed part-way before these writes were grouped may
      // have left its offer row behind; reuse it.
      .onConflictDoUpdate({ target: customOffers.id, set: offerValues })
      .returning();
    const created = await createCustomOfferBooking({
      offerId: offer.id,
      feeUsd,
      customerName: contact.name,
      customerEmail: contact.email,
      customerPhone: customerPhone ?? undefined,
      requestDetails,
      travelDates: travelDates || undefined,
      idempotencyKey: args.idempotency_key,
      sessionId,
      serviceMode: "listing-verification",
      serviceRequestFeeKes: feeKes,
      executor: tx,
    });
    await tx.update(customOffers)
      .set({ notes: `booking_id:${created.booking.id}`, updatedAt: new Date().toISOString() })
      .where(eq(customOffers.id, offer.id));
    const task = await storage.createListingVerificationTask({
      id: args.idempotency_key,
      customOfferId: offer.id,
      bookingId: created.booking.id,
      sessionId,
      customerName: contact.name,
      customerEmail: contact.email,
      customerPhone,
      // Empty when an agent shared the listing without a link; the details
      // the customer gave are stored alongside for the field team.
      listingUrl: listingLink ?? "",
      listingContext: listingDetails || null,
      agentContact,
      sourcePlatform: parsed.sourcePlatform,
      location: parsed.location,
      verificationScope,
      feeUsd,
      feeKes,
      approvalUrl: `${appBaseUrl()}/bookings?bookingId=${created.booking.id}&verification=report`,
    }, tx);
    return { ...created, task };
  });

  // The team hears about the request as soon as Zaina creates it (as with
  // custom offers), clearly marked unpaid; dispatch still waits for payment.
  queueCustomOfferBookingNotification({
    bookingId: booking.id,
    paymentLink,
    feeUsd,
    customerName: contact.name,
    customerEmail: contact.email,
    customerPhone: customerPhone ?? undefined,
    requestDetails,
    notificationSummary: `Listing verification (awaiting payment) — ${verificationLabel}`,
    sessionId,
  });
  queueNotificationTask(`zaina listing verification alert for ${task.id}`, sendOpsAlert({
    kind: "custom-offer",
    sessionId,
    summary: `New listing verification request — ${verificationLabel} (awaiting payment)`,
    customerName: contact.name,
    customerContact: contact.email,
    details: {
      Status: "Awaiting payment — dispatch the on-ground check only after the fee is paid",
      "Listing link": listingLink ?? "No link — see the listing details",
      "Agent/host contact": agentContactNote ?? undefined,
      "Listing details": listingDetails || "not provided",
      "Verification scope": verificationScope,
      Fee: `KSh ${feeKes.toLocaleString("en-KE")}`,
      "Payment link": paymentLink,
      "Admin page": `${appBaseUrl()}/admin/listing-verifications`,
    },
  }));

  return {
    ok: true,
    verification_id: task.id,
    booking_id: booking.id,
    payment_link: paymentLink,
    fee_usd: feeUsd,
    fee_display: currency === "KES" ? `KSh ${feeKes.toLocaleString("en-KE")}` : await formatPrice(feeUsd, sessionId),
    fee_kes: feeKes,
    fee_creditable: true,
    status: "awaiting_payment",
    location: parsed.location,
    source_platform: parsed.sourcePlatform,
    next_step: "Payment is required before the on-ground verification team is dispatched.",
  };
}

export async function createCustomOffer(
  args: {
    offer_type: string;
    request_details: string;
    tier?: "intake" | "proposal" | "verification";
    customer_name?: string;
    customer_email?: string;
    customer_phone?: string;
    listing_url?: string;
    budget_amount?: number;
    budget_currency?: string;
    /** Legacy: a budget the model already converted to USD. */
    budget_usd?: number;
    travel_dates?: string;
    idempotency_key: string;
  },
  sessionId: string,
) {
  if (!hasUsableIdempotencyKey(args?.idempotency_key)) {
    return { ok: false, error: "idempotency_key_required", hint: "Generate a fresh UUID v4 before retrying." };
  }
  if (typeof args.offer_type !== "string" || !args.offer_type.trim()
    || typeof args.request_details !== "string" || args.request_details.trim().length < 10) {
    return {
      ok: false,
      error: "custom_offer_details_required",
      hint: "Collect a clear description of what the customer wants before creating the offer.",
    };
  }
  if (typeof args.customer_name !== "string" || args.customer_name.trim().length < 2
    || typeof args.customer_email !== "string"
    || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(args.customer_email)) {
    return {
      ok: false,
      error: "customer_contact_required",
      tell_customer: "Before I place this custom request, may I have your full name and email address?",
    };
  }
  if (args.listing_url && !/^https?:\/\/\S+$/i.test(args.listing_url.trim())) {
    return { ok: false, error: "invalid_listing_url", tell_customer: "Please send the full listing link beginning with https:// so I can attach it to the request." };
  }

  const tier = args.tier || "intake";
  if (tier === "verification") {
    return {
      ok: false,
      error: "use_listing_verification_tool",
      hint: "Use create_listing_verification_request for an external listing so payment, dispatch, reporting, and fee credit are tracked correctly.",
    };
  }
  let budgetUsd: number | null = null;
  let budgetNote: string | null = null;
  if (args.budget_amount !== undefined) {
    const budget = toUsdAmount(args.budget_amount, args.budget_currency, (await getUsdToKesRate()).usdToKes);
    if (!budget.ok) {
      return {
        ok: false,
        error: budget.error === "amount_invalid" ? "budget_invalid" : "budget_currency_required",
        hint: "Pass budget_amount exactly as the customer stated it, with budget_currency set to USD or KES, or leave both out. Never convert the budget yourself.",
      };
    }
    budgetUsd = budget.usd;
    budgetNote = budget.currency === "USD"
      ? describeInputAmount(budget.amount, "USD")
      : `${describeInputAmount(budget.amount, "KES")} (≈ $${budget.usd})`;
  } else if (typeof args.budget_usd === "number" && Number.isFinite(args.budget_usd) && args.budget_usd > 0) {
    budgetUsd = Math.round(args.budget_usd);
    budgetNote = `$${budgetUsd}`;
  }

  // Listing verification has its own configured fee (see createListingVerificationRequest).
  const tierFees: Record<string, number> = { intake: 5, proposal: 15 };
  const feeUsd = tierFees[tier] ?? 5;
  const currency = await getSessionCurrency(sessionId);
  const requestDetails = [
    args.request_details.trim(),
    args.listing_url?.trim() ? `Listing URL: ${args.listing_url.trim()}` : null,
  ].filter(Boolean).join("\n\n");

  const existing = await db
    .select()
    .from(customOffers)
    .where(eq(customOffers.id, args.idempotency_key))
    .limit(1);

  if (existing[0]) {
    const bookingId = existing[0].notes?.match(/booking_id:([^\s]+)/)?.[1] ?? null;
    return {
      ok: true,
      offer_id: existing[0].id,
      idempotent_replay: true,
      tier: existing[0].feeTier,
      fee_display: await formatPrice(existing[0].feeUsd ?? feeUsd, sessionId),
      ...(bookingId ? {
        booking_id: bookingId,
        payment_link: `${appBaseUrl()}/bookings?bookingId=${bookingId}`,
      } : {}),
    };
  }

  const now = new Date().toISOString();
  const [row] = await db
    .insert(customOffers)
    .values({
      id: args.idempotency_key,
      sessionId,
      customerName: args.customer_name ?? null,
      customerEmail: args.customer_email ?? null,
      customerPhone: args.customer_phone ?? null,
      offerType: args.offer_type,
      requestDetails,
      budgetUsd,
      travelDates: args.travel_dates ?? null,
      status: "new",
      feeTier: tier,
      feeUsd,
      displayCurrency: currency,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const { booking, paymentLink } = await createCustomOfferBooking({
    offerId: row.id,
    feeUsd,
    customerName: args.customer_name.trim(),
    customerEmail: args.customer_email.trim().toLowerCase(),
    customerPhone: args.customer_phone,
    requestDetails,
    travelDates: args.travel_dates,
    budgetUsd: budgetUsd ?? undefined,
    idempotencyKey: args.idempotency_key,
    sessionId,
  });
  await db.update(customOffers)
    .set({ notes: `booking_id:${booking.id}`, updatedAt: new Date().toISOString() })
    .where(eq(customOffers.id, row.id));

  queueNotificationTask(`zaina custom-offer alert for ${row.id}`, sendOpsAlert({
    kind: "custom-offer",
    sessionId,
    summary: `New ${tier} request — ${args.offer_type}`,
    customerName: args.customer_name ?? null,
    customerContact: args.customer_email ?? args.customer_phone ?? null,
    details: {
      "Offer ID": row.id,
      "Booking ID": booking.id,
      "Payment link": paymentLink,
      Tier: tier,
      Type: args.offer_type,
      "Travel dates": args.travel_dates ?? "not provided",
      Budget: budgetNote ?? "not provided",
      Details: requestDetails,
    },
  }));

  return {
    ok: true,
    offer_id: row.id,
    tier,
    fee_usd: feeUsd,
    fee_display: await formatPrice(feeUsd, sessionId),
    fee_creditable: true,
    booking_id: booking.id,
    payment_link: paymentLink,
    listing_url: args.listing_url?.trim() || undefined,
    disclosure:
      "A small creditable fee applies. It will be fully deducted from your final booking if you accept the proposal.",
    turnaround_hours: 24,
  };
}

// ═══════════════════════════════════════════════════════════════════
// LEADS
// ═══════════════════════════════════════════════════════════════════

export async function createLead(
  args: { name: string; email?: string; phone?: string; interest?: string; notes?: string },
  sessionId: string,
) {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(aiLeads)
    .values({
      name: args.name,
      email: args.email ?? null,
      phone: args.phone ?? null,
      interest: args.interest ?? null,
      notes: args.notes ?? null,
      source: "zaina",
      sessionId,
      createdAt: now,
    })
    .returning();

  queueNotificationTask(
    `zaina lead alert for ${row.id}`,
    sendOpsAlert({
      kind: "new-lead",
      sessionId,
      summary: `Lead: ${args.name}`,
      customerName: args.name,
      customerContact: args.email ?? args.phone ?? null,
      details: { Interest: args.interest ?? "unspecified", Notes: args.notes ?? "" },
    }),
  );

  return { ok: true, lead_id: row.id };
}

// ═══════════════════════════════════════════════════════════════════
// ESCALATION
// ═══════════════════════════════════════════════════════════════════

export async function escalateToHuman(args: { reason: string }, sessionId: string) {
  const now = new Date().toISOString();
  const claimed = await db
    .update(chatSessions)
    .set({
      managedBy: "HUMAN",
      handoffReason: args.reason,
      handoffTimestamp: now,
      updatedAt: now,
    })
    .where(and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.managedBy, "AI"),
    ))
    .returning();

  if (claimed.length === 0) {
    return { ok: true, status: "already_escalated" };
  }

  // The customer's reply must not wait for email or push delivery.
  queueNotificationTask(
    `zaina handoff alerts for ${sessionId}`,
    notifyTeamOfHandoff(sessionId, args.reason),
  );

  return { ok: true, status: "escalated" };
}

async function notifyTeamOfHandoff(sessionId: string, reason: string): Promise<void> {
  await sendOpsAlert({
    kind: "handoff-requested",
    sessionId,
    summary: `Handoff requested: ${reason}`,
    details: { Reason: reason },
  });

  // Push to every active device of every admin.
  try {
    const devices = await db
      .select({ userId: userPushDevices.userId, subscription: userPushDevices.subscription })
      .from(userPushDevices)
      .innerJoin(users, eq(users.id, userPushDevices.userId))
      .where(and(eq(users.role, "admin"), eq(userPushDevices.isActive, true)));

    await Promise.all(devices.map(async (device) => {
      try {
        await sendWebPushNotification(device.subscription as any, {
          id: `zaina-handoff-${sessionId}`,
          userId: device.userId,
          type: "assignment-created",
          title: "Zaina handoff — customer waiting",
          body: `${reason.slice(0, 120)}`,
          actionUrl: "/admin/zaina",
          priority: "high",
          channels: ["push"],
          deliveryState: {},
          metadata: { sessionId },
          isRead: false,
          readAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as any);
      } catch (pushErr) {
        console.error(`[zaina] push failed for admin ${device.userId}:`, pushErr);
      }
    }));
  } catch (pushSetupErr) {
    console.error("[zaina] push fanout failed:", pushSetupErr);
  }
}
