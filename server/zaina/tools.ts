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
import { storage } from "../storage";
import {
  bookings, stays, cooks, cars, errands, experiences,
  aiLeads, chatSessions, customOffers,
} from "@shared/schema";
import { and, eq, ne, lt, gt, gte, lte, sql, isNotNull } from "drizzle-orm";
import { getUsdToKesRate } from "../currency";
import { HELP_MAMA_HOURLY_MINIMUM_HOURS } from "@shared/errand-pricing";

// ═══════════════════════════════════════════════════════════════════
// HELPERS — currency, dates, notifications
// ═══════════════════════════════════════════════════════════════════

async function getSessionCurrency(sessionId: string): Promise<"USD" | "KES"> {
  const [sess] = await db
    .select({ displayCurrency: chatSessions.displayCurrency })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);
  return sess?.displayCurrency === "KES" ? "KES" : "USD";
}

async function formatPrice(amountUsd: number, sessionId: string): Promise<string> {
  const currency = await getSessionCurrency(sessionId);
  if (currency === "USD") {
    return `$${Math.round(amountUsd).toLocaleString("en-US")}`;
  }
  const rate = await getUsdToKesRate();
  return `KSh ${Math.round(amountUsd * rate.usdToKes).toLocaleString("en-KE")}`;
}

/**
 * Returns the number of nights between two ISO dates, or null if the dates
 * are invalid. Callers must treat null as a hard failure — no silent fallback.
 */
function validateAndGetNights(checkIn: string, checkOut: string): number | null {
  if (typeof checkIn !== "string" || typeof checkOut !== "string") return null;
  const start = new Date(`${checkIn}T00:00:00.000Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
}

function occupiedEndDate(checkIn: string, checkOut: string): string {
  const start = new Date(`${checkIn}T00:00:00.000Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00.000Z`).getTime();
  if (end === start) return checkOut;
  const d = new Date(end);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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
    const mod: any = await import("../notifications");
    if (typeof mod.sendOpsAlertEmail === "function") {
      await mod.sendOpsAlertEmail(payload);
    }
  } catch (err) {
    console.error("[zaina] ops alert failed:", err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH TOOLS
// ═══════════════════════════════════════════════════════════════════

export async function searchStays(
  args: { region?: string; guests?: number },
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
      imageUrl: stays.imageUrl,
      features: stays.features,
    })
    .from(stays)
    .where(and(...conditions))
    .limit(20);

  const results = await Promise.all(
    rows.map(async (s) => ({
      id: s.id,
      title: s.title,
      location: s.location,
      price_per_night_usd: s.priceUsd,
      price_per_night_display: await formatPrice(s.priceUsd, sessionId),
      max_occupancy: s.maxOccupancy,
      bedrooms: s.bedrooms,
      bathrooms: s.bathrooms,
      rating: s.rating,
      review_count: s.reviewCount,
      image_url: s.imageUrl,
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
  args: { region?: string; guests?: number },
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
      customMenuEnabled: cooks.customMenuEnabled,
      sampleMenus: cooks.sampleMenus,
      rating: cooks.rating,
      reviewCount: cooks.reviewCount,
    })
    .from(cooks)
    .where(and(...conditions))
    .limit(20);

  const results = await Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      title: c.title,
      location: c.location,
      speciality: c.speciality,
      minimum_guests: c.minimumGuests,
      maximum_guests: c.maxGuests,
      pricing: {
        per_plate: c.pricePerPlate
          ? { usd: c.pricePerPlate, display: await formatPrice(c.pricePerPlate, sessionId), minimum_plates: c.minPlates }
          : null,
        single_meal: c.priceSingleMeal
          ? { usd: c.priceSingleMeal, display: await formatPrice(c.priceSingleMeal, sessionId) }
          : null,
        session: (c.serviceFee || c.pricePerSession)
          ? { usd: c.serviceFee || c.pricePerSession, display: await formatPrice(c.serviceFee || c.pricePerSession, sessionId) }
          : null,
      },
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
  args: { region?: string; guests?: number },
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

  const rows = await db
    .select({
      id: cars.id,
      model: cars.model,
      location: cars.location,
      seats: cars.seats,
      transmission: cars.transmission,
      pricePerDay: cars.pricePerDay,
      priceWithDriver: cars.priceWithDriver,
      priceWithDriverHourly: cars.priceWithDriverHourly,
      chauffeurZones: cars.chauffeurZones,
      features: cars.features,
    })
    .from(cars)
    .where(and(...conditions))
    .limit(20);

  const results = await Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      model: c.model,
      location: c.location,
      seats: c.seats,
      transmission: c.transmission,
      pricing: {
        self_drive_per_day: c.pricePerDay
          ? { usd: c.pricePerDay, display: await formatPrice(c.pricePerDay, sessionId) }
          : null,
        chauffeur_per_day: c.priceWithDriver
          ? { usd: c.priceWithDriver, display: await formatPrice(c.priceWithDriver, sessionId) }
          : null,
        chauffeur_per_hour: c.priceWithDriverHourly
          ? { usd: c.priceWithDriverHourly, display: await formatPrice(c.priceWithDriverHourly, sessionId) }
          : null,
        zones: c.chauffeurZones,
      },
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
  args: { region?: string },
  sessionId: string,
) {
  const conditions: any[] = [
    eq(errands.isPublic, true),
    isNotNull(errands.managerUserId),
  ];
  if (args.region) {
    conditions.push(sql`${errands.location} ILIKE ${"%" + args.region + "%"}`);
  }

  const rows = await db
    .select()
    .from(errands)
    .where(and(...conditions))
    .limit(20);

  const results = await Promise.all(
    rows.map(async (e) => {
      const helpMama = e.helpMamaPricing;
      return {
        id: e.id,
        service_name: e.serviceName,
        location: e.location,
        base_price: {
          usd: e.basePrice,
          display: await formatPrice(e.basePrice, sessionId),
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
        mamacare: helpMama?.enabled
          ? {
              age_bands: await Promise.all(
                (helpMama.ageBands || []).map(async (band) => ({
                  id: band.id,
                  label: band.label,
                  hourly_daytime: await formatPrice(band.hourlyDaytimePrice, sessionId),
                  hourly_evening: await formatPrice(band.hourlyEveningPrice, sessionId),
                  overnight: await formatPrice(band.overnightPrice, sessionId),
                  full_day: await formatPrice(band.fullDayPrice, sessionId),
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
  };
}

export async function searchExperiences(
  args: { region?: string; guests?: number },
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
      privatePricePerPerson: experiences.privatePricePerPerson,
      sharedPricePerPerson: experiences.sharedPricePerPerson,
      customQuoteEnabled: experiences.customQuoteEnabled,
      inclusions: experiences.inclusions,
      rating: experiences.rating,
      reviewCount: experiences.reviewCount,
    })
    .from(experiences)
    .where(and(...conditions))
    .limit(20);

  const results = await Promise.all(
    rows.map(async (x) => ({
      id: x.id,
      title: x.title,
      location: x.location,
      type: x.experienceType,
      duration_hours: x.durationHours,
      guests: { min: x.minGuests, max: x.maxGuests },
      pricing: {
        private_per_person: x.privateEnabled && x.privatePricePerPerson
          ? { usd: x.privatePricePerPerson, display: await formatPrice(x.privatePricePerPerson, sessionId) }
          : null,
        shared_per_person: x.sharedEnabled && x.sharedPricePerPerson
          ? { usd: x.sharedPricePerPerson, display: await formatPrice(x.sharedPricePerPerson, sessionId) }
          : null,
      },
      custom_offers_available: x.customQuoteEnabled,
      inclusions: x.inclusions,
      rating: x.rating,
      review_count: x.reviewCount,
    })),
  );

  return {
    ok: true,
    count: results.length,
    experiences: results,
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
    .select({ id: bookings.id, checkIn: bookings.checkIn, checkOut: bookings.checkOut })
    .from(bookings)
    .where(and(
      eq(bookings.accommodationId, args.stay_id),
      ne(bookings.status, "cancelled"),
      lt(bookings.checkIn, args.check_out),
      gt(bookings.checkOut, args.check_in),
    ));

  return {
    ok: true,
    stay_id: args.stay_id,
    title: stay.title,
    available: conflicts.length === 0,
    conflicting_bookings: conflicts.length,
    requested: { check_in: args.check_in, check_out: args.check_out, occupied_end: requestedEnd, nights },
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
    budget_usd: number;
    destination_preference?: string;
    include_experience?: boolean;
  },
  sessionId: string,
) {
  const nights = validateAndGetNights(args.check_in, args.check_out);
  if (nights === null) return { ok: false, error: "invalid_dates" };

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
  const withinBudget = totalUsd <= args.budget_usd;
  const overByUsd = withinBudget ? 0 : totalUsd - args.budget_usd;
  const remainderUsd = withinBudget ? args.budget_usd - totalUsd : 0;

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
    budget: await formatPrice(args.budget_usd, sessionId),
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
 *
 * If a requested service requires pricing that isn't supported in v1
 * (chef plate/meal pricing, hourly cars, shared experiences, complex errands),
 * the tool returns `requires_manual_quote` and the conversation escalates.
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
      payment_link: `/bookings?bookingId=${existing[0].id}`,
      total: await formatPrice(existing[0].totalPrice, sessionId),
    };
  }

  // 1. Validate dates — fail closed
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

  // 2. Validate stay
  const [stay] = await db.select().from(stays).where(eq(stays.id, args.stay_id)).limit(1);
  if (!stay) return { ok: false, error: "stay_not_found" };
  if (!stay.isPublic || !stay.managerUserId) {
    return { ok: false, error: "stay_not_bookable" };
  }
  if (args.guests > stay.maxOccupancy) {
    return { ok: false, error: "guest_count_exceeds_capacity", max_occupancy: stay.maxOccupancy };
  }

  // 3. Check stay availability
  // NOTE: This check-then-create pattern is not atomic. Two concurrent sessions
  // could theoretically both see "available" and both create bookings. The
  // idempotency key protects against duplicate submissions from the same session;
  // cross-session races are mitigated by the low-volume nature of the concierge
  // flow and by manual ops review of every booking. The correct long-term fix is
  // a Postgres exclusion constraint on (accommodation_id, daterange) — tracked
  // for v1.5.
  const conflicts = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(
      eq(bookings.accommodationId, args.stay_id),
      ne(bookings.status, "cancelled"),
      lt(bookings.checkIn, args.check_out),
      gt(bookings.checkOut, args.check_in),
    ))
    .limit(1);
  if (conflicts.length > 0) {
    return { ok: false, error: "stay_not_available" };
  }

  // 4. Server-side pricing. Never trust a price from the model.
  let totalUsd = stay.price * nights;
  const staySubtotal = totalUsd;

  // 5. Price services. Only simple modes supported in v1 — complex modes route to ops.
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
      // Chauffeur-day pricing only. Hourly and self-drive go through ops for v1.
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
      // Private pricing only. Shared departures go through ops for v1.
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
      // Base price only. Shopping, laundry, cleaning, MamaCare all need config — route to ops.
      const subtotal = errand.basePrice;
      totalUsd += subtotal;
      pricedServices.push({ id: errand.id, name: errand.serviceName, subtotal });
      continue;
    }

    return { ok: false, error: "service_not_found", service_id: serviceId };
  }

  // 6. Create booking with the server-calculated total. The model never touched this number.
  const now = new Date().toISOString();
  const booking = await storage.createBooking({
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
    paymentDepositAmount: null,
    paymentAmountPaid: 0,
    paymentHoldExpiresAt: null,
    paidAt: null,
    paymentFailedAt: null,
    totalPrice: Math.round(totalUsd),
    status: "upcoming",
    bookingType: "accommodation",
    createdAt: now,
    idempotencyKey: args.idempotency_key,
  } as any);

  return {
    ok: true,
    booking_id: booking.id,
    payment_link: `/bookings?bookingId=${booking.id}`,
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
  };
}
// ═══════════════════════════════════════════════════════════════════
// SERVICE BOOKINGS — standalone, no stay required
// ═══════════════════════════════════════════════════════════════════
//
// Use this for one-off services where the customer is NOT booking a stay:
// MamaCare, private chefs (session mode), standalone experiences, base errands.
//
// Unlike createDraftBooking, this accepts a single `date` (check_in and
// check_out are the same day) and prices the service from its own row.

export async function createServiceBooking(
  args: {
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    service_id: string;
    date: string;
    mode: string;
    guests?: number;
    service_location?: string;
    service_start_time?: string;
    service_end_time?: string;
    service_request_details?: string;
    mamacare_children?: Array<{ age_band_id: string; count: number }>;
    mamacare_care_mode?: "hourly_daytime" | "hourly_evening" | "overnight" | "full_day";
    mamacare_hours?: number;
    quantity?: number;
    idempotency_key: string;
  },
  sessionId: string,
) {
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
      payment_link: `/bookings?bookingId=${existing[0].id}`,
      total: await formatPrice(existing[0].totalPrice, sessionId),
    };
  }

  // 1. Validate date
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    return { ok: false, error: "invalid_date", hint: "Date must be YYYY-MM-DD." };
  }

  // 2. Look up the service across all tables
  const [cook] = await db.select().from(cooks).where(eq(cooks.id, args.service_id)).limit(1);
  const [errand] = await db.select().from(errands).where(eq(errands.id, args.service_id)).limit(1);
  const [experience] = await db.select().from(experiences).where(eq(experiences.id, args.service_id)).limit(1);

  if (!cook && !errand && !experience) {
    return { ok: false, error: "service_not_found" };
  }

  let totalUsd = 0;
  const serviceAddonSelections: string[] = [];

  // ─── Errand: MamaCare ─────────────────────────────────────────
  if (errand && args.mode === "errand-childcare") {
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
    const careHours = args.mamacare_hours ?? HELP_MAMA_HOURLY_MINIMUM_HOURS;
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
      totalUsd += rate * child.count * qty;
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
  // ─── Errand: base ─────────────────────────────────────────────
  else if (errand && args.mode === "errand-base") {
    if (!errand.isPublic || !errand.managerUserId) {
      return { ok: false, error: "service_not_bookable" };
    }
    totalUsd = errand.basePrice * (args.quantity ?? 1);
  }
  // ─── Errand: other modes → ops ────────────────────────────────
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
    if (args.mode === "cook-service-fee") {
      const sessionRate = cook.serviceFee || cook.pricePerSession;
      if (!sessionRate) return { ok: false, error: "no_pricing_configured" };
      totalUsd = sessionRate * (args.quantity ?? 1);
    } else if (args.mode === "cook-inclusive") {
      const inclusiveRate = cook.inclusivePrice || cook.serviceFee || cook.pricePerSession;
      if (!inclusiveRate) return { ok: false, error: "no_pricing_configured" };
      totalUsd = inclusiveRate * (args.quantity ?? 1);
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
      totalUsd = experience.privatePricePerPerson * (args.guests ?? 2);
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

  // 3. Create the booking
  const now = new Date().toISOString();
  const booking = await storage.createBooking({
    userId: null,
    accommodationId: null,
    guestName: args.customer_name,
    guestEmail: args.customer_email,
    guestPhone: args.customer_phone,
    checkIn: args.date,
    checkOut: args.date,
    guests: args.guests ?? 1,
    selectedServices: [args.service_id],
    serviceMode: args.mode,
    serviceHours: args.mamacare_hours ?? null,
    serviceLocation: args.service_location ?? null,
    servicePickupLocation: null,
    serviceReturnLocation: null,
    serviceZone: null,
    serviceStartTime: args.service_start_time ?? null,
    serviceEndTime: args.service_end_time ?? null,
    serviceBudgetAmount: null,
    serviceLaundryWeightKg: null,
    serviceAddonSelections,
    serviceScheduleSlots: [],
    serviceDepartureId: null,
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
    paymentDepositAmount: null,
    paymentAmountPaid: 0,
    paymentHoldExpiresAt: null,
    paidAt: null,
    paymentFailedAt: null,
    totalPrice: Math.round(totalUsd),
    status: "upcoming",
    bookingType: "service",
    createdAt: now,
    idempotencyKey: args.idempotency_key,
  } as any);

  return {
    ok: true,
    booking_id: booking.id,
    payment_link: `/bookings?bookingId=${booking.id}`,
    status: "draft",
    total: await formatPrice(totalUsd, sessionId),
  };
}
// ═══════════════════════════════════════════════════════════════════
// CUSTOM OFFERS
// ═══════════════════════════════════════════════════════════════════

export async function createCustomOffer(
  args: {
    offer_type: string;
    request_details: string;
    tier?: "intake" | "proposal" | "verification";
    customer_name?: string;
    customer_email?: string;
    customer_phone?: string;
    budget_usd?: number;
    travel_dates?: string;
    idempotency_key: string;
  },
  sessionId: string,
) {
  const tier = args.tier || "intake";
  const tierFees: Record<string, number> = { intake: 5, proposal: 15, verification: 40 };
  const feeUsd = tierFees[tier] ?? 5;
  const currency = await getSessionCurrency(sessionId);

  const existing = await db
    .select()
    .from(customOffers)
    .where(eq(customOffers.id, args.idempotency_key))
    .limit(1);

  if (existing[0]) {
    return {
      ok: true,
      offer_id: existing[0].id,
      idempotent_replay: true,
      tier: existing[0].feeTier,
      fee_display: await formatPrice(existing[0].feeUsd ?? feeUsd, sessionId),
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
      requestDetails: args.request_details,
      budgetUsd: args.budget_usd ?? null,
      travelDates: args.travel_dates ?? null,
      status: "new",
      feeTier: tier,
      feeUsd,
      displayCurrency: currency,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await sendOpsAlert({
    kind: "custom-offer",
    sessionId,
    summary: `New ${tier} request — ${args.offer_type}`,
    customerName: args.customer_name ?? null,
    customerContact: args.customer_email ?? args.customer_phone ?? null,
    details: {
      "Offer ID": row.id,
      Tier: tier,
      Type: args.offer_type,
      "Travel dates": args.travel_dates ?? "not provided",
      Budget: args.budget_usd ? `$${args.budget_usd}` : "not provided",
      Details: args.request_details,
    },
  });

  return {
    ok: true,
    offer_id: row.id,
    tier,
    fee_usd: feeUsd,
    fee_display: await formatPrice(feeUsd, sessionId),
    fee_creditable: true,
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

  await sendOpsAlert({
    kind: "new-lead",
    sessionId,
    summary: `Lead: ${args.name}`,
    customerName: args.name,
    customerContact: args.email ?? args.phone ?? null,
    details: { Interest: args.interest ?? "unspecified", Notes: args.notes ?? "" },
  });

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

  await sendOpsAlert({
    kind: "handoff-requested",
    sessionId,
    summary: `Handoff requested: ${args.reason}`,
    details: { Reason: args.reason },
  });

  return { ok: true, status: "escalated" };
}
