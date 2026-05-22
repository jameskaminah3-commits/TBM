import {
  type Accommodation,
  type InsertAccommodation,
  type Service,
  type InsertService,
  type Provider,
  type InsertProvider,
  type Booking,
  type BookingMessage,
  type InsertBooking,
  type InsertBookingMessage,
  type ServerBooking,
  type BlogPost,
  type InsertBlogPost,
  type BookingAttribution,
  type BookingMarketingSummary,
  type InsertMarketingAttributionEvent,
  type MarketingAttributionContentSummary,
  type MarketingAttributionEvent,
  type MarketingAttributionPayload,
  type MarketingAttributionPromoSummary,
  type MarketingAttributionSummary,
  type MarketingPromo,
  type MarketingPromoCostAbsorption,
  type InsertMarketingPromo,
  type UpdateMarketingPromo,
  type Listing,
  type InsertListing,
  type Stay,
  type InsertStay,
  type Car,
  type InsertCar,
  type Cook,
  type InsertCook,
  type Errand,
  type InsertErrand,
  type Experience,
  type InsertExperience,
  type StayReservation,
  type InsertStayReservation,
  type CarReservation,
  type InsertCarReservation,
  type CookReservation,
  type InsertCookReservation,
  type Review,
  type InsertReview,
  type User,
  type UpsertUser,
  type UserRole,
  type ProviderCategory,
  type DashboardServiceKey,
  type DashboardServiceBreakdownItem,
  type DashboardTopServiceItem,
  type DashboardRevenuePoint,
  type DashboardRecentBooking,
  type DashboardMetrics,
  type PopularService,
  type RevenueByMonth,
  type ProviderAccountSummary,
  type ProviderCommissionSetting,
  type BookingPayout,
  type PayoutStatus,
  type PayoutMethod,
  type AdminCommissionSettingSummary,
  type AdminBookingPayout,
  type PaymentManagementData,
  type ProviderPaymentData,
  type BookingAssignmentConfig,
  type BookingServiceAssignment,
  type BookingServiceAssignmentStatus,
  type ProviderNotification,
  type AppInboxItem,
  type AppInboxItemType,
  type AppInboxPriority,
  type AppInboxDeliveryChannel,
  type AppInboxDeliveryState,
  type AppInboxMetadata,
  type InsertUserPushDevice,
  type UpdateUserPushPreferences,
  type UserPushDevice,
  type UserPushPreferences,
  providerCategories,
  marketingPromoCostAbsorptions,
  appInboxItemTypes,
  appInboxPriorities,
  appInboxDeliveryChannels,
  accommodations,
  services,
  providers,
  bookings,
  bookingMessages,
  bookingServiceAssignments,
  bookingAttributions,
  blogPosts,
  marketingAttributionEvents,
  marketingPromos,
  listings,
  stays,
  cars,
  cooks,
  errands,
  experiences,
  reviews,
  providerCommissionSettings,
  bookingPayouts,
  appInboxItems,
  userPushDevices,
  userPushPreferences,
  stayReservations,
  carReservations,
  cookReservations,
  users,
} from "@shared/schema";
import { hasLockedInBookingDeposit } from "@shared/booking-payments";
import { calculateCookInclusiveTotal, calculateCookServiceTotal } from "@shared/cook-pricing";
import { calculateHelpMamaPackagePrice } from "@shared/errand-pricing";
import { buildAppInboxActionUrl, buildInboxWorkspaceUrl } from "@shared/inbox";
import { getWebPushPublicConfig, sendWebPushNotification } from "./push";
import { db, pool } from "./db";
import { sanitizeOptionalUserRecord, sanitizeUserRecord, sanitizeUserRecords } from "./user-sanitizer";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

type DashboardListingCatalog = {
  staysById: Map<string, Stay>;
  carsById: Map<string, Car>;
  cooksById: Map<string, Cook>;
  errandsById: Map<string, Errand>;
  experiencesById: Map<string, Experience>;
};

type DashboardServiceAllocation = {
  category: DashboardServiceKey;
  serviceId: string;
  serviceName: string;
  revenue: number;
};

type ProviderFinancialCatalog = DashboardListingCatalog & {
  providerUsersById: Map<string, User>;
};

type DesiredBookingAssignment = {
  providerCategory: ProviderCategory;
  providerUserId: string | null;
  serviceId: string;
  serviceName: string;
  serviceConfig: BookingAssignmentConfig;
  grossAmount: number;
};

type DesiredBookingAssignmentDraft = DesiredBookingAssignment & {
  revenue: number;
};

type AssignmentPayoutPricing = {
  promoCostAbsorption: MarketingPromoCostAbsorption;
  protectedGrossAmount: number;
};

const dashboardServiceLabels: Record<DashboardServiceKey, string> = {
  stays: "Stays",
  cars: "Cars",
  cooks: "Cooks",
  errands: "Errands",
  experiences: "Experiences",
  custom: "Custom requests",
};

function normalizeOptionalUserId(value: string | null | undefined) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeManagerScopedRecord<T extends { managerUserId?: string | null }>(record: T): T {
  if (!Object.prototype.hasOwnProperty.call(record, "managerUserId")) {
    return record;
  }

  const managerUserId = normalizeOptionalUserId(record.managerUserId);
  if (record.managerUserId === managerUserId) {
    return record;
  }

  return {
    ...record,
    managerUserId,
  };
}

function normalizeManagerScopedWriteData<T extends { managerUserId?: string | null }>(data: T): T {
  if (!Object.prototype.hasOwnProperty.call(data, "managerUserId")) {
    return data;
  }

  return {
    ...data,
    managerUserId: normalizeOptionalUserId(data.managerUserId),
  };
}

function normalizeMarketingPromoInput<T extends Partial<InsertMarketingPromo> | Partial<UpdateMarketingPromo>>(data: T): T {
  const eligibleCategories = data.eligibleCategories
    ? Array.from(new Set(
      data.eligibleCategories.filter((category): category is ProviderCategory => isProviderCategory(category)),
    ))
    : data.eligibleCategories;
  const requiredCategories = data.requiredCategories
    ? Array.from(new Set(
      data.requiredCategories.filter((category): category is ProviderCategory => isProviderCategory(category)),
    ))
    : data.requiredCategories;

  return {
    ...data,
    name: typeof data.name === "string" ? data.name.trim() : data.name,
    code: typeof data.code === "string" ? data.code.trim().toUpperCase() || null : data.code,
    description: typeof data.description === "string" ? data.description.trim() || null : data.description,
    audience: typeof data.audience === "string" ? data.audience.trim() || null : data.audience,
    eligibleCategories,
    requiredCategories,
    bundleLabel: typeof data.bundleLabel === "string" ? data.bundleLabel.trim() || null : data.bundleLabel,
    landingPath: typeof data.landingPath === "string" ? data.landingPath.trim() || null : data.landingPath,
    notes: typeof data.notes === "string" ? data.notes.trim() || null : data.notes,
    startAt: typeof data.startAt === "string" ? data.startAt.trim() || null : data.startAt,
    endAt: typeof data.endAt === "string" ? data.endAt.trim() || null : data.endAt,
  };
}

function isProviderCategory(value: string | null | undefined): value is ProviderCategory {
  return Boolean(value) && providerCategories.includes(value as ProviderCategory);
}

function isMarketingPromoCostAbsorption(value: string | null | undefined): value is MarketingPromoCostAbsorption {
  return Boolean(value) && marketingPromoCostAbsorptions.includes(value as MarketingPromoCostAbsorption);
}

function getMarketingPromoCostAbsorption(value: string | null | undefined): MarketingPromoCostAbsorption {
  return isMarketingPromoCostAbsorption(value) ? value : "shared";
}

function isAppInboxItemType(value: string | null | undefined): value is AppInboxItemType {
  return Boolean(value) && appInboxItemTypes.includes(value as AppInboxItemType);
}

function isAppInboxPriority(value: string | null | undefined): value is AppInboxPriority {
  return Boolean(value) && appInboxPriorities.includes(value as AppInboxPriority);
}

function getAppInboxPriority(value: string | null | undefined): AppInboxPriority {
  return isAppInboxPriority(value) ? value : "normal";
}

function normalizeAppInboxChannels(channels: AppInboxDeliveryChannel[] | null | undefined): AppInboxDeliveryChannel[] {
  const uniqueChannels = Array.from(new Set(
    (channels ?? ["in-app"])
      .filter((channel): channel is AppInboxDeliveryChannel => appInboxDeliveryChannels.includes(channel as AppInboxDeliveryChannel)),
  )) as AppInboxDeliveryChannel[];

  return uniqueChannels.length ? uniqueChannels : ["in-app"];
}

function buildInboxDeliveryState(
  channels: AppInboxDeliveryChannel[],
  now: string,
  existingState?: AppInboxDeliveryState | null,
): AppInboxDeliveryState {
  const nextState: AppInboxDeliveryState = { ...(existingState ?? {}) };

  for (const channel of channels) {
    nextState[channel] = channel === "in-app"
      ? {
          status: "delivered",
          updatedAt: now,
          error: null,
        }
      : {
          status: nextState[channel]?.status ?? "pending",
          updatedAt: now,
          error: nextState[channel]?.error ?? null,
        };
  }

  return nextState;
}

function buildBookingInboxThreadKey(bookingId: string) {
  return `booking:${bookingId}`;
}

function getInboxSenderRoleLabel(role: string | null | undefined) {
  if (role === "admin") {
    return "Admin";
  }

  if (role === "provider") {
    return "Partner";
  }

  return "Guest";
}

function getInboxMessageExcerpt(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137).trimEnd()}...`;
}

function toProviderNotification(item: AppInboxItem): ProviderNotification {
  return {
    id: item.id,
    userId: item.userId,
    bookingId: item.bookingId ?? null,
    assignmentId: item.assignmentId ?? null,
    type: item.type,
    title: item.title,
    body: item.body,
    isRead: item.isRead,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function isPayoutStatus(value: string | null | undefined): value is PayoutStatus {
  return value === "pending" || value === "approved" || value === "paid" || value === "cancelled";
}

function isPayoutMethod(value: string | null | undefined): value is PayoutMethod {
  return value === "bank-transfer" || value === "mobile-money" || value === "cash" || value === "card" || value === "other";
}

function getAssignmentLegacyKey(value: { bookingId: string; providerCategory: string; serviceId: string }) {
  return `${value.bookingId}:${value.providerCategory}:${value.serviceId}`;
}

function getPayoutStatusWeight(status: string | null | undefined) {
  switch (status) {
    case "paid":
      return 4;
    case "approved":
      return 3;
    case "pending":
      return 2;
    case "cancelled":
      return 1;
    default:
      return 0;
  }
}

function pickCanonicalPayoutRow(rows: BookingPayout[], preferredProviderUserId?: string | null) {
  return [...rows].sort((left, right) => {
    const paidDelta = Number(right.status === "paid") - Number(left.status === "paid");
    if (paidDelta !== 0) {
      return paidDelta;
    }

    const providerDelta = Number(Boolean(preferredProviderUserId) && right.providerUserId === preferredProviderUserId)
      - Number(Boolean(preferredProviderUserId) && left.providerUserId === preferredProviderUserId);
    if (providerDelta !== 0) {
      return providerDelta;
    }

    const statusDelta = getPayoutStatusWeight(right.status) - getPayoutStatusWeight(left.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }

    const assignmentDelta = Number(Boolean(right.assignmentId)) - Number(Boolean(left.assignmentId));
    if (assignmentDelta !== 0) {
      return assignmentDelta;
    }

    return (right.updatedAt || right.createdAt || "").localeCompare(left.updatedAt || left.createdAt || "");
  })[0];
}

function appendSystemNote(existingNotes: string | null | undefined, note: string) {
  const normalizedExisting = existingNotes?.trim() || "";
  if (!note.trim()) {
    return normalizedExisting || null;
  }

  if (normalizedExisting.includes(note)) {
    return normalizedExisting || null;
  }

  return [normalizedExisting, note].filter(Boolean).join(" | ");
}

function isBookingServiceAssignmentStatus(value: string | null | undefined): value is BookingServiceAssignmentStatus {
  return value === "upcoming" || value === "in-progress" || value === "completed" || value === "cancelled";
}

function normalizeDateOnly(value: string) {
  const normalized = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isNaN(normalized.getTime())) {
    return normalized;
  }

  return new Date(value);
}

function calculateChargeableDays(checkIn: string, checkOut: string) {
  const startDate = normalizeDateOnly(checkIn);
  const endDate = normalizeDateOnly(checkOut);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 1;
  }

  const diff = endDate.getTime() - startDate.getTime();
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function parseTimeToMinutes(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  return (hours * 60) + minutes;
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentUtcMinutes() {
  const now = new Date();
  return (now.getUTCHours() * 60) + now.getUTCMinutes();
}

function getBookingOperationalStatus(booking: Booking) {
  if (booking.status === "cancelled" || booking.status === "completed") {
    return booking.status;
  }

  if (!isBookingPaymentSettled(booking) && !hasAcceptedQuotedBooking(booking)) {
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

    const startMinutes = parseTimeToMinutes(booking.serviceStartTime);
    const endMinutes = parseTimeToMinutes(booking.serviceEndTime);
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

function isBookingPaymentSettled(booking: Pick<Booking, "paymentStatus">) {
  return (booking.paymentStatus ?? "paid") === "paid";
}

function hasAcceptedQuotedBooking(
  booking: Pick<Booking, "serviceMode" | "customMenuClientDecision" | "experienceCustomOfferClientDecision">,
) {
  return (
    (booking.serviceMode === "cook-custom-menu" && booking.customMenuClientDecision === "accepted")
    || (booking.serviceMode === "experience-custom-offer" && booking.experienceCustomOfferClientDecision === "accepted")
  );
}

function shouldSyncProviderAssignmentsForBooking(
  booking: Pick<Booking, "paymentStatus" | "serviceMode" | "customMenuClientDecision" | "experienceCustomOfferClientDecision">,
) {
  return isBookingPaymentSettled(booking) || hasAcceptedQuotedBooking(booking);
}

function isActiveOperationalStatus(status: string) {
  return status === "upcoming" || status === "in-progress" || status === "late" || status === "pending-payment";
}

function isOpenOperationalStatus(status: string) {
  return status !== "completed" && status !== "cancelled";
}

function isAdminManagedCustomServiceBooking(booking: Pick<Booking, "serviceMode" | "selectedServices">) {
  return booking.serviceMode === "experience-custom-offer" && booking.selectedServices.length === 0;
}

function isPendingExperienceOfferApprovalForAdmin(
  booking: Pick<Booking, "serviceMode" | "selectedServices" | "experienceCustomOfferStatus">,
) {
  return booking.serviceMode === "experience-custom-offer" && (
    booking.experienceCustomOfferStatus === "pending-admin-approval"
    || (isAdminManagedCustomServiceBooking(booking) && booking.experienceCustomOfferStatus === "pending")
  );
}

function getRequestFeeUsd(booking: Pick<Booking, "serviceMode" | "serviceRequestFee" | "serviceRequestFeeKes">) {
  if (booking.serviceRequestFee && booking.serviceRequestFee > 0) {
    return booking.serviceRequestFee;
  }

  if (booking.serviceRequestFeeKes && booking.serviceRequestFeeKes > 0) {
    return Math.max(1, Math.ceil(booking.serviceRequestFeeKes / 130));
  }

  if (booking.serviceMode === "experience-custom-offer") {
    return 4;
  }

  return 0;
}

function getBookingGrossRevenue(booking: Booking) {
  if (!isBookingPaymentSettled(booking)) {
    return 0;
  }

  let grossRevenue = Math.max(0, booking.totalPrice || 0);

  if (booking.serviceMode === "cook-custom-menu" && booking.customMenuClientDecision === "accepted") {
    grossRevenue += Math.max(0, booking.customMenuCreditAmount ?? getRequestFeeUsd(booking));
  }

  if (booking.serviceMode === "experience-custom-offer" && booking.experienceCustomOfferClientDecision === "accepted") {
    grossRevenue += Math.max(0, getRequestFeeUsd(booking));
  }

  return grossRevenue;
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

function getErrandShoppingCommission(budgetAmount: number | null | undefined, commissionPercent: number | null | undefined) {
  const safeBudget = Math.max(0, budgetAmount || 0);
  if (safeBudget <= 0) {
    return 0;
  }

  return Math.ceil((safeBudget * (commissionPercent ?? 5)) / 100);
}

function getErrandPackagePrice(
  errand: Errand,
  serviceMode: string | null | undefined,
  budgetAmount: number | null | undefined,
  addonSelections: string[] | null | undefined,
  serviceHours?: number | null,
) {
  const mode = serviceMode || "errand-base";
  let packagePrice = errand.basePrice;

  if (mode === "errand-shopping") {
    packagePrice += getErrandShoppingCommission(budgetAmount, errand.shoppingCommissionPercent);
    return packagePrice;
  }

  if (mode === "errand-childcare" && errand.helpMamaPricing?.enabled) {
    return calculateHelpMamaPackagePrice(errand, addonSelections, serviceHours);
  }

  const selectedAddons = new Set(addonSelections || []);
  const supportedAddons = mode === "errand-laundry"
    ? errand.laundryAddons || []
    : mode === "errand-house-cleaning"
      ? errand.houseCleaningAddons || []
      : [];

  return packagePrice + supportedAddons
    .filter((addon) => selectedAddons.has(addon.id))
    .reduce((sum, addon) => sum + addon.price, 0);
}

function normalizeAllocationRevenue(allocations: DashboardServiceAllocation[], grossRevenue: number) {
  if (!allocations.length) {
    return [];
  }

  const totalRevenue = allocations.reduce((sum, allocation) => sum + Math.max(0, allocation.revenue), 0);
  if (totalRevenue === grossRevenue) {
    return allocations;
  }

  if (grossRevenue <= 0) {
    return allocations.map((allocation) => ({ ...allocation, revenue: 0 }));
  }

  if (totalRevenue <= 0) {
    return allocations.map((allocation, index) => ({
      ...allocation,
      revenue: index === 0 ? grossRevenue : 0,
    }));
  }

  const normalized = allocations.map((allocation) => ({ ...allocation, revenue: 0 }));
  const rankedIndexes = allocations
    .map((allocation, index) => ({ index, revenue: Math.max(0, allocation.revenue) }))
    .sort((a, b) => b.revenue - a.revenue)
    .map((entry) => entry.index);

  let distributedRevenue = 0;

  for (const index of rankedIndexes) {
    const sourceRevenue = Math.max(0, allocations[index].revenue);
    const scaledRevenue = Math.floor((sourceRevenue / totalRevenue) * grossRevenue);
    normalized[index].revenue = scaledRevenue;
    distributedRevenue += scaledRevenue;
  }

  let remainder = grossRevenue - distributedRevenue;
  let pointer = 0;
  while (remainder > 0 && rankedIndexes.length > 0) {
    const index = rankedIndexes[pointer % rankedIndexes.length];
    normalized[index].revenue += 1;
    remainder -= 1;
    pointer += 1;
  }

  return normalized;
}

function getStaySelectionAllocation(
  booking: Booking,
  selection: Booking["stayServiceSelections"][number],
  catalog: DashboardListingCatalog,
): DashboardServiceAllocation | null {
  const guests = Math.max(1, selection.guests || booking.guests || 1);
  const occupiedDays = calculateChargeableDays(booking.checkIn, booking.checkOut);

  if (selection.category === "cars") {
    const car = catalog.carsById.get(selection.serviceId);
    const serviceMode = selection.serviceMode || "car-chauffeur-day";
    const units = Math.max(1, selection.units || (serviceMode === "car-chauffeur-hourly" ? selection.serviceHours || 3 : occupiedDays));
    const revenue = serviceMode === "car-chauffeur-hourly"
      ? units * (car?.priceWithDriverHourly || car?.priceWithDriver || 0)
      : units * (serviceMode === "car-self-drive-day" && car?.pricePerDay ? car.pricePerDay : car?.priceWithDriver || 0);

    return {
      category: "cars",
      serviceId: selection.serviceId,
      serviceName: car?.model || "Car service",
      revenue,
    };
  }

  if (selection.category === "cooks") {
    const cook = catalog.cooksById.get(selection.serviceId);
    const serviceMode = selection.serviceMode || "cook-service-fee";
    const days = Math.max(1, selection.units || occupiedDays);
    const revenue = cook
      ? serviceMode === "cook-inclusive"
        ? calculateCookInclusiveTotal(cook, guests, days)
        : calculateCookServiceTotal(cook, guests, days)
      : 0;

    return {
      category: "cooks",
      serviceId: selection.serviceId,
      serviceName: cook?.title || "Chef service",
      revenue,
    };
  }

  if (selection.category === "errands") {
    const errand = catalog.errandsById.get(selection.serviceId);
    const packages = Math.max(1, selection.units || 1);
    const packagePrice = errand
      ? getErrandPackagePrice(errand, selection.serviceMode, selection.serviceBudgetAmount, selection.serviceAddonSelections, selection.serviceHours)
      : 0;

    return {
      category: "errands",
      serviceId: selection.serviceId,
      serviceName: errand?.serviceName || "Errand service",
      revenue: packagePrice * packages,
    };
  }

  if (selection.category === "experiences") {
    const experience = catalog.experiencesById.get(selection.serviceId);
    const serviceMode = selection.serviceMode || "experience-private";
    const revenue = !experience
      ? 0
      : serviceMode === "experience-shared"
        ? (experience.sharedPricePerPerson || experience.price) * guests
        : serviceMode === "experience-private"
          ? (experience.privatePricePerPerson || experience.price) * guests
          : 0;

    return {
      category: "experiences",
      serviceId: selection.serviceId,
      serviceName: experience?.title || "Experience service",
      revenue,
    };
  }

  return null;
}

function buildStaySelectionAssignmentConfig(
  booking: Booking,
  selection: Booking["stayServiceSelections"][number],
): BookingAssignmentConfig {
  return {
    serviceId: selection.serviceId,
    category: selection.category,
    serviceMode: selection.serviceMode ?? null,
    units: selection.units ?? null,
    guests: selection.guests ?? booking.guests ?? null,
    serviceHours: selection.serviceHours ?? null,
    serviceLocation: selection.serviceLocation ?? null,
    servicePickupLocation: selection.servicePickupLocation ?? null,
    serviceReturnLocation: selection.serviceReturnLocation ?? null,
    serviceZone: null,
    serviceStartTime: selection.serviceStartTime ?? null,
    serviceEndTime: selection.serviceEndTime ?? null,
    serviceBudgetAmount: selection.serviceBudgetAmount ?? null,
    serviceLaundryWeightKg: selection.serviceLaundryWeightKg ?? null,
    serviceAddonSelections: selection.serviceAddonSelections || [],
    serviceScheduleSlots: [],
    serviceDepartureId: selection.serviceDepartureId ?? null,
    serviceRequestDetails: selection.serviceRequestDetails ?? null,
  };
}

function buildStandaloneAssignmentConfig(
  booking: Booking,
  serviceId: string,
  category: ProviderCategory,
): BookingAssignmentConfig {
  return {
    serviceId,
    category,
    serviceMode: booking.serviceMode ?? null,
    units: null,
    guests: booking.guests ?? null,
    serviceHours: booking.serviceHours ?? null,
    serviceLocation: booking.serviceLocation ?? null,
    servicePickupLocation: booking.servicePickupLocation ?? null,
    serviceReturnLocation: booking.serviceReturnLocation ?? null,
    serviceZone: booking.serviceZone ?? null,
    serviceStartTime: booking.serviceStartTime ?? null,
    serviceEndTime: booking.serviceEndTime ?? null,
    serviceBudgetAmount: booking.serviceBudgetAmount ?? null,
    serviceLaundryWeightKg: booking.serviceLaundryWeightKg ?? null,
    serviceAddonSelections: booking.serviceAddonSelections || [],
    serviceScheduleSlots: booking.serviceScheduleSlots || [],
    serviceDepartureId: booking.serviceDepartureId ?? null,
    serviceRequestDetails: booking.serviceRequestDetails ?? null,
  };
}

function normalizeDesiredAssignments(assignments: Array<DesiredBookingAssignment & { revenue: number }>, grossRevenue: number) {
  const normalized = normalizeAllocationRevenue(
    assignments.map((assignment) => ({
      category: assignment.providerCategory,
      serviceId: assignment.serviceId,
      serviceName: assignment.serviceName,
      revenue: assignment.revenue,
    })),
    grossRevenue,
  );

  return assignments.map((assignment, index) => ({
    ...assignment,
    grossAmount: normalized[index]?.revenue ?? 0,
  }));
}

function getBookingAssignmentWeightAllocations(
  booking: Booking,
  assignments: BookingServiceAssignment[],
  catalog: DashboardListingCatalog,
) {
  const currentGrossWeights = assignments.map((assignment) => ({
    category: assignment.providerCategory as DashboardServiceKey,
    serviceId: assignment.serviceId,
    serviceName: assignment.serviceName,
    revenue: Math.max(0, assignment.grossAmount),
  }));
  const currentGrossTotal = currentGrossWeights.reduce((sum, allocation) => sum + allocation.revenue, 0);
  if (currentGrossTotal > 0) {
    return currentGrossWeights;
  }

  const desiredAssignments = getDesiredBookingAssignmentDrafts(booking, catalog);
  const desiredWeights = new Map<string, number>(
    desiredAssignments.map((assignment) => [`${assignment.providerCategory}:${assignment.serviceId}`, Math.max(0, assignment.revenue)] as const),
  );
  const fallbackWeights = assignments.map((assignment) => ({
    category: assignment.providerCategory as DashboardServiceKey,
    serviceId: assignment.serviceId,
    serviceName: assignment.serviceName,
    revenue: desiredWeights.get(`${assignment.providerCategory}:${assignment.serviceId}`) ?? 0,
  }));
  const fallbackWeightTotal = fallbackWeights.reduce((sum, allocation) => sum + allocation.revenue, 0);
  if (fallbackWeightTotal > 0) {
    return fallbackWeights;
  }

  return assignments.map((assignment, index) => ({
    category: assignment.providerCategory as DashboardServiceKey,
    serviceId: assignment.serviceId,
    serviceName: assignment.serviceName,
    revenue: index === 0 ? 1 : 0,
  }));
}

function getAssignmentPayoutPricingForBooking(
  booking: Booking,
  assignments: BookingServiceAssignment[],
  attribution: BookingAttribution | undefined,
  catalog: DashboardListingCatalog,
) {
  const pricing = new Map<string, AssignmentPayoutPricing>();
  if (!assignments.length) {
    return pricing;
  }

  const marketingSummary = toBookingMarketingSummary(attribution);
  if (!marketingSummary || marketingSummary.discountAmount <= 0) {
    for (const assignment of assignments) {
      pricing.set(assignment.id, {
        promoCostAbsorption: "shared",
        protectedGrossAmount: Math.max(0, assignment.grossAmount),
      });
    }
    return pricing;
  }

  const weights = getBookingAssignmentWeightAllocations(booking, assignments, catalog);
  const currentGrossTotal = assignments.reduce((sum, assignment) => sum + Math.max(0, assignment.grossAmount), 0);
  const promoEligibleFinalTotal = Math.max(0, Math.min(marketingSummary.finalRevenue, currentGrossTotal));
  const originalShares = normalizeAllocationRevenue(weights, Math.max(0, marketingSummary.originalSubtotal));
  const finalShares = normalizeAllocationRevenue(weights, promoEligibleFinalTotal);

  assignments.forEach((assignment, index) => {
    const currentGrossAmount = Math.max(0, assignment.grossAmount);
    const promoEligibleFinalShare = Math.max(0, finalShares[index]?.revenue ?? 0);
    const originalPromoShare = Math.max(0, originalShares[index]?.revenue ?? 0);
    const nonPromoShare = Math.max(0, currentGrossAmount - promoEligibleFinalShare);

    pricing.set(assignment.id, {
      promoCostAbsorption: marketingSummary.promoCostAbsorption,
      protectedGrossAmount: originalPromoShare + nonPromoShare,
    });
  });

  return pricing;
}

function calculateAssignmentPayoutAmounts(
  currentGrossAmount: number,
  protectedGrossAmount: number,
  commissionPercent: number,
  promoCostAbsorption: MarketingPromoCostAbsorption,
) {
  const safeCurrentGross = Math.max(0, Math.round(currentGrossAmount || 0));
  const safeProtectedGross = Math.max(0, Math.round(protectedGrossAmount || 0));
  const safeCommissionPercent = Math.max(0, Math.round(commissionPercent || 0));
  const currentCommissionAmount = Math.round((safeCurrentGross * safeCommissionPercent) / 100);
  const currentPayoutAmount = Math.max(0, safeCurrentGross - currentCommissionAmount);

  if (promoCostAbsorption === "partner") {
    const protectedCommissionAmount = Math.round((safeProtectedGross * safeCommissionPercent) / 100);
    const commissionAmount = Math.max(0, Math.min(safeCurrentGross, protectedCommissionAmount));
    return {
      commissionAmount,
      payoutAmount: Math.max(0, safeCurrentGross - commissionAmount),
    };
  }

  if (promoCostAbsorption === "platform") {
    const protectedCommissionAmount = Math.round((safeProtectedGross * safeCommissionPercent) / 100);
    const payoutAmount = Math.max(0, safeProtectedGross - protectedCommissionAmount);
    return {
      commissionAmount: safeCurrentGross - payoutAmount,
      payoutAmount,
    };
  }

  return {
    commissionAmount: currentCommissionAmount,
    payoutAmount: currentPayoutAmount,
  };
}

function getDesiredStandaloneBookingAssignment(
  booking: Booking,
  serviceId: string,
  catalog: DashboardListingCatalog,
): DesiredBookingAssignmentDraft | null {
  const stay = catalog.staysById.get(serviceId);
  if (stay) {
    return {
      providerCategory: "stays",
      providerUserId: normalizeOptionalUserId(stay.managerUserId),
      serviceId: stay.id,
      serviceName: stay.title,
      serviceConfig: buildStandaloneAssignmentConfig(booking, stay.id, "stays"),
      revenue: getBookingGrossRevenue(booking),
      grossAmount: 0,
    };
  }

  const car = catalog.carsById.get(serviceId);
  if (car) {
    return {
      providerCategory: "cars",
      providerUserId: normalizeOptionalUserId(car.managerUserId),
      serviceId: car.id,
      serviceName: car.model,
      serviceConfig: buildStandaloneAssignmentConfig(booking, car.id, "cars"),
      revenue: getBookingGrossRevenue(booking),
      grossAmount: 0,
    };
  }

  const cook = catalog.cooksById.get(serviceId);
  if (cook) {
    return {
      providerCategory: "cooks",
      providerUserId: normalizeOptionalUserId(cook.managerUserId),
      serviceId: cook.id,
      serviceName: cook.title,
      serviceConfig: buildStandaloneAssignmentConfig(booking, cook.id, "cooks"),
      revenue: getBookingGrossRevenue(booking),
      grossAmount: 0,
    };
  }

  const errand = catalog.errandsById.get(serviceId);
  if (errand) {
    return {
      providerCategory: "errands",
      providerUserId: normalizeOptionalUserId(errand.managerUserId),
      serviceId: errand.id,
      serviceName: errand.serviceName,
      serviceConfig: buildStandaloneAssignmentConfig(booking, errand.id, "errands"),
      revenue: getBookingGrossRevenue(booking),
      grossAmount: 0,
    };
  }

  const experience = catalog.experiencesById.get(serviceId);
  if (experience) {
    return {
      providerCategory: "experiences",
      providerUserId: normalizeOptionalUserId(experience.managerUserId),
      serviceId: experience.id,
      serviceName: experience.title,
      serviceConfig: buildStandaloneAssignmentConfig(booking, experience.id, "experiences"),
      revenue: getBookingGrossRevenue(booking),
      grossAmount: 0,
    };
  }

  return null;
}

function getDesiredBookingAssignmentDrafts(booking: Booking, catalog: DashboardListingCatalog): DesiredBookingAssignmentDraft[] {
  if (booking.accommodationId || booking.bookingType === "accommodation") {
    const assignments: DesiredBookingAssignmentDraft[] = [];
    const stay = booking.accommodationId ? catalog.staysById.get(booking.accommodationId) : undefined;

    if (booking.accommodationId) {
      assignments.push({
        providerCategory: "stays",
        providerUserId: normalizeOptionalUserId(stay?.managerUserId),
        serviceId: booking.accommodationId,
        serviceName: stay?.title || "Stay booking",
        serviceConfig: {
          serviceId: booking.accommodationId,
          category: "stays",
          serviceMode: null,
          units: calculateChargeableDays(booking.checkIn, booking.checkOut),
          guests: booking.guests ?? null,
          serviceHours: null,
          serviceLocation: stay?.location ?? null,
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
          serviceRequestDetails: null,
        },
        revenue: stay ? calculateChargeableDays(booking.checkIn, booking.checkOut) * stay.price : 0,
        grossAmount: 0,
      });
    }

    for (const selection of booking.stayServiceSelections || []) {
      const allocation = getStaySelectionAllocation(booking, selection, catalog);
      if (allocation && isProviderCategory(allocation.category)) {
        assignments.push({
          providerCategory: allocation.category,
          providerUserId: getAllocationProviderUserId(allocation, catalog),
          serviceId: allocation.serviceId,
          serviceName: allocation.serviceName,
          serviceConfig: buildStaySelectionAssignmentConfig(booking, selection),
          revenue: allocation.revenue,
          grossAmount: 0,
        });
      }
    }

    return assignments;
  }

  if (!booking.selectedServices.length) {
    return [];
  }

  return Array.from(new Set(booking.selectedServices))
    .map((serviceId) => getDesiredStandaloneBookingAssignment(booking, serviceId, catalog))
    .filter((assignment): assignment is DesiredBookingAssignmentDraft => Boolean(assignment));
}

function getDesiredBookingAssignments(booking: Booking, catalog: DashboardListingCatalog): DesiredBookingAssignment[] {
  const grossRevenue = getBookingGrossRevenue(booking);
  return normalizeDesiredAssignments(getDesiredBookingAssignmentDrafts(booking, catalog), grossRevenue);
}

function getBookingServiceAllocations(booking: Booking, catalog: DashboardListingCatalog): DashboardServiceAllocation[] {
  const grossRevenue = getBookingGrossRevenue(booking);
  const assignments = getDesiredBookingAssignments(booking, catalog);

  if (!assignments.length) {
    return [{
      category: "custom",
      serviceId: "custom-requests",
      serviceName: "Custom requests",
      revenue: grossRevenue,
    }];
  }

  return assignments.map((assignment) => ({
    category: assignment.providerCategory,
    serviceId: assignment.serviceId,
    serviceName: assignment.serviceName,
    revenue: assignment.grossAmount,
  }));
}

function getBookingExplicitPlatformProfit(booking: Booking, catalog: DashboardListingCatalog) {
  let profit = 0;

  if (booking.serviceMode === "cook-custom-menu") {
    profit += getRequestFeeUsd(booking);
  }

  if (booking.serviceMode === "experience-custom-offer") {
    profit += getRequestFeeUsd(booking);
  }

  if (booking.serviceMode === "errand-shopping") {
    const errand = booking.selectedServices[0] ? catalog.errandsById.get(booking.selectedServices[0]) : undefined;
    profit += getErrandShoppingCommission(booking.serviceBudgetAmount, errand?.shoppingCommissionPercent);
  }

  for (const selection of booking.stayServiceSelections || []) {
    if (selection.category === "errands" && selection.serviceMode === "errand-shopping") {
      const errand = catalog.errandsById.get(selection.serviceId);
      const packages = Math.max(1, selection.units || 1);
      profit += packages * getErrandShoppingCommission(selection.serviceBudgetAmount, errand?.shoppingCommissionPercent);
    }
  }

  return profit;
}

function getProviderDisplayName(user: User | undefined | null) {
  if (!user) {
    return "Unassigned provider";
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return fullName || user.email || "Provider";
}

function getAllocationProviderUserId(
  allocation: DashboardServiceAllocation,
  catalog: DashboardListingCatalog,
) {
  switch (allocation.category) {
    case "stays":
      return normalizeOptionalUserId(catalog.staysById.get(allocation.serviceId)?.managerUserId);
    case "cars":
      return normalizeOptionalUserId(catalog.carsById.get(allocation.serviceId)?.managerUserId);
    case "cooks":
      return normalizeOptionalUserId(catalog.cooksById.get(allocation.serviceId)?.managerUserId);
    case "errands":
      return normalizeOptionalUserId(catalog.errandsById.get(allocation.serviceId)?.managerUserId);
    case "experiences":
      return normalizeOptionalUserId(catalog.experiencesById.get(allocation.serviceId)?.managerUserId);
    default:
      return null;
  }
}

function getBookingProviderTargets(
  booking: Booking,
  catalog: ProviderFinancialCatalog,
) {
  const operationalStatus = getBookingOperationalStatus(booking);
  if (operationalStatus === "cancelled" || operationalStatus === "pending") {
    return [];
  }

  return getBookingServiceAllocations(booking, catalog)
    .map((allocation) => {
      if (!isProviderCategory(allocation.category)) {
        return null;
      }

      const providerUserId = getAllocationProviderUserId(allocation, catalog);
      if (!providerUserId) {
        return null;
      }

      const providerUser = catalog.providerUsersById.get(providerUserId);
      if (!providerUser || providerUser.role !== "provider") {
        return null;
      }

      return {
        bookingId: booking.id,
        providerUserId,
        providerCategory: allocation.category,
        serviceId: allocation.serviceId,
        serviceName: allocation.serviceName,
        guestName: booking.guestName,
        grossAmount: Math.max(0, allocation.revenue),
        dueAt: booking.checkOut || booking.checkIn,
      };
    })
    .filter((target): target is {
      bookingId: string;
      providerUserId: string;
      providerCategory: ProviderCategory;
      serviceId: string;
      serviceName: string;
      guestName: string;
      grossAmount: number;
      dueAt: string;
    } => Boolean(target));
}

function parseProviderTypes(value: string | null | undefined): ProviderAccountSummary["providerTypes"] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is ProviderAccountSummary["providerTypes"][number] => ["stays", "cars", "cooks", "errands", "experiences"].includes(entry));
}

export interface IStorage {
  // Replit Auth Integration: User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserRole(userId: string, role: UserRole): Promise<User>;
  getUsersByRole(role: UserRole): Promise<User[]>;
  getUserByEmail(email: string): Promise<User | undefined>;
  updateUser(userId: string, user: Partial<UpsertUser>): Promise<User | undefined>;
  deleteUser(userId: string): Promise<boolean>;

  // Accommodations
  getAccommodations(): Promise<Accommodation[]>;
  getAccommodation(id: string): Promise<Accommodation | undefined>;
  createAccommodation(accommodation: InsertAccommodation): Promise<Accommodation>;
  updateAccommodation(id: string, accommodation: Partial<InsertAccommodation>): Promise<Accommodation | undefined>;
  deleteAccommodation(id: string): Promise<boolean>;

  // Services
  getServices(): Promise<Service[]>;
  getService(id: string): Promise<Service | undefined>;
  createService(service: InsertService): Promise<Service>;
  updateService(id: string, service: Partial<InsertService>): Promise<Service | undefined>;
  deleteService(id: string): Promise<boolean>;

  // Providers
  getProviders(): Promise<Provider[]>;
  getProvider(id: string): Promise<Provider | undefined>;
  getProvidersByServiceType(serviceType: string): Promise<Provider[]>;
  createProvider(provider: InsertProvider): Promise<Provider>;
  updateProvider(id: string, provider: Partial<InsertProvider>): Promise<Provider | undefined>;
  deleteProvider(id: string): Promise<boolean>;

  // Bookings
  getBookings(): Promise<Booking[]>;
  getBookingsByUserId(userId: string): Promise<Booking[]>;
  getBookingsByAccommodationId(accommodationId: string): Promise<Booking[]>;
  getBookingsBySelectedServiceId(serviceId: string): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking | undefined>;
  createBooking(
    booking: ServerBooking & Partial<Pick<Booking, "paymentStatus" | "paymentProvider" | "paymentReference" | "paymentSessionId" | "paymentCurrency" | "paymentAmount" | "paymentCheckoutAmount" | "paymentDepositAmount" | "paymentAmountPaid" | "paymentHoldExpiresAt" | "paidAt" | "paymentFailedAt">>,
  ): Promise<Booking>;
  updateBooking(
    id: string,
    booking: Partial<InsertBooking> & Partial<Pick<Booking, "paymentStatus" | "paymentProvider" | "paymentReference" | "paymentSessionId" | "paymentCurrency" | "paymentAmount" | "paymentCheckoutAmount" | "paymentDepositAmount" | "paymentAmountPaid" | "paymentHoldExpiresAt" | "paidAt" | "paymentFailedAt">>,
  ): Promise<Booking | undefined>;
  updateBookingPaymentState(
    id: string,
    booking: Partial<Pick<Booking, "paymentStatus" | "paymentProvider" | "paymentReference" | "paymentSessionId" | "paymentCurrency" | "paymentAmount" | "paymentCheckoutAmount" | "paymentDepositAmount" | "paymentAmountPaid" | "paymentHoldExpiresAt" | "paidAt" | "paymentFailedAt">>,
  ): Promise<Booking | undefined>;
  deleteBooking(id: string): Promise<boolean>;
  getBookingMessages(bookingId: string): Promise<BookingMessage[]>;
  createBookingMessage(message: InsertBookingMessage & { userId: string; senderRole: string }): Promise<BookingMessage>;
  syncBookingServiceAssignments(options?: { bookingIds?: string[]; notifyProviders?: boolean }): Promise<{ created: number; updated: number; cancelled: number }>;
  getBookingServiceAssignments(): Promise<BookingServiceAssignment[]>;
  getBookingServiceAssignmentsByBookingId(bookingId: string): Promise<BookingServiceAssignment[]>;
  updateBookingServiceAssignmentStatus(id: string, status: BookingServiceAssignmentStatus): Promise<BookingServiceAssignment | undefined>;
  getUserInbox(userId: string): Promise<AppInboxItem[]>;
  markInboxItemRead(id: string, userId: string): Promise<AppInboxItem | undefined>;
  markInboxItemsRead(userId: string, options?: {
    itemIds?: string[];
    threadKeys?: string[];
    scope?: "all" | "messages" | "alerts";
  }): Promise<number>;
  markInboxItemsReadByThread(userId: string, threadKey: string): Promise<number>;
  getUserPushDevices(userId: string): Promise<UserPushDevice[]>;
  upsertUserPushDevice(userId: string, device: InsertUserPushDevice): Promise<UserPushDevice>;
  unregisterUserPushDevice(userId: string, endpoint: string): Promise<number>;
  getUserPushPreferences(userId: string): Promise<UserPushPreferences>;
  updateUserPushPreferences(userId: string, update: UpdateUserPushPreferences): Promise<UserPushPreferences>;
  createPushTestNotification(userId: string): Promise<AppInboxItem>;
  getPushPublicConfig(): ReturnType<typeof getWebPushPublicConfig>;
  getProviderNotifications(userId: string): Promise<ProviderNotification[]>;
  markProviderNotificationRead(id: string, userId: string): Promise<ProviderNotification | undefined>;

  // Blog Posts
  getBlogPosts(): Promise<BlogPost[]>;
  getPublishedBlogPosts(): Promise<BlogPost[]>;
  getBlogPost(id: string): Promise<BlogPost | undefined>;
  getBlogPostBySlug(slug: string): Promise<BlogPost | undefined>;
  createBlogPost(blogPost: InsertBlogPost): Promise<BlogPost>;
  updateBlogPost(id: string, blogPost: Partial<InsertBlogPost>): Promise<BlogPost | undefined>;
  deleteBlogPost(id: string): Promise<boolean>;

  // Marketing Promos
  getMarketingPromos(): Promise<MarketingPromo[]>;
  getMarketingPromo(id: string): Promise<MarketingPromo | undefined>;
  getMarketingPromoByCode(code: string): Promise<MarketingPromo | undefined>;
  createMarketingPromo(promo: InsertMarketingPromo): Promise<MarketingPromo>;
  updateMarketingPromo(id: string, promo: UpdateMarketingPromo): Promise<MarketingPromo | undefined>;
  deleteMarketingPromo(id: string): Promise<boolean>;
  recordMarketingPromoRedemption(promoId: string, revenue: number): Promise<MarketingPromo | undefined>;
  createMarketingAttributionEvent(event: InsertMarketingAttributionEvent): Promise<MarketingAttributionEvent>;
  getBookingAttributionsByBookingIds(bookingIds: string[]): Promise<BookingAttribution[]>;
  createBookingAttribution(
    bookingId: string,
    attribution: MarketingAttributionPayload & {
      promoId?: string | null;
      promoName?: string | null;
      promoCostAbsorption?: MarketingPromoCostAbsorption | null;
      originalSubtotal: number;
      discountAmount: number;
      finalRevenue: number;
    },
  ): Promise<BookingAttribution>;
  getMarketingAttributionSummary(): Promise<MarketingAttributionSummary>;

  // Listings (DEPRECATED - use stays, cars, cooks, errands instead)
  getListings(): Promise<Listing[]>;
  getListing(id: string): Promise<Listing | undefined>;
  createListing(listing: InsertListing): Promise<Listing>;
  updateListing(id: string, listing: Partial<InsertListing>): Promise<Listing | undefined>;
  deleteListing(id: string): Promise<boolean>;

  // Stays
  getStays(): Promise<Stay[]>;
  getStay(id: string): Promise<Stay | undefined>;
  getStaysByManagerUserId(managerUserId: string): Promise<Stay[]>;
  createStay(stay: InsertStay): Promise<Stay>;
  updateStay(id: string, stay: Partial<InsertStay>): Promise<Stay | undefined>;
  deleteStay(id: string): Promise<boolean>;

  // Cars
  getCars(): Promise<Car[]>;
  getCar(id: string): Promise<Car | undefined>;
  createCar(car: InsertCar): Promise<Car>;
  updateCar(id: string, car: Partial<InsertCar>): Promise<Car | undefined>;
  deleteCar(id: string): Promise<boolean>;

  // Cooks
  getCooks(): Promise<Cook[]>;
  getCook(id: string): Promise<Cook | undefined>;
  createCook(cook: InsertCook): Promise<Cook>;
  updateCook(id: string, cook: Partial<InsertCook>): Promise<Cook | undefined>;
  deleteCook(id: string): Promise<boolean>;

  // Errands
  getErrands(): Promise<Errand[]>;
  getErrand(id: string): Promise<Errand | undefined>;
  createErrand(errand: InsertErrand): Promise<Errand>;
  updateErrand(id: string, errand: Partial<InsertErrand>): Promise<Errand | undefined>;
  deleteErrand(id: string): Promise<boolean>;

  // Experiences
  getExperiences(): Promise<Experience[]>;
  getExperience(id: string): Promise<Experience | undefined>;
  createExperience(experience: InsertExperience): Promise<Experience>;
  updateExperience(id: string, experience: Partial<InsertExperience>): Promise<Experience | undefined>;
  deleteExperience(id: string): Promise<boolean>;

  // Stay Reservations (for availability tracking)
  getStayReservations(stayId: string): Promise<StayReservation[]>;
  createStayReservation(reservation: InsertStayReservation): Promise<StayReservation>;
  deleteStayReservation(id: string): Promise<boolean>;
  getCarReservations(carId: string): Promise<CarReservation[]>;
  createCarReservation(reservation: InsertCarReservation): Promise<CarReservation>;
  deleteCarReservation(id: string): Promise<boolean>;
  getCookReservations(cookId: string): Promise<CookReservation[]>;
  createCookReservation(reservation: InsertCookReservation): Promise<CookReservation>;
  deleteCookReservation(id: string): Promise<boolean>;

  // Reviews
  getReviewsByBookingId(bookingId: string): Promise<Review[]>;
  getReviewsByTarget(targetType: string, targetId: string): Promise<Review[]>;
  createReview(review: InsertReview & { bookingId: string; userId: string }): Promise<Review>;
  updateReview(id: string, review: Partial<InsertReview>): Promise<Review | undefined>;

  // Analytics
  getDashboardMetrics(): Promise<DashboardMetrics>;
  getPopularServices(): Promise<PopularService[]>;
  getRevenueByMonth(): Promise<RevenueByMonth[]>;
  getPaymentManagementData(): Promise<PaymentManagementData>;
  getProviderPaymentData(providerUserId: string): Promise<ProviderPaymentData>;
  upsertProviderCommissionSetting(
    providerUserId: string,
    providerCategory: ProviderCategory,
    commissionPercent: number,
    notes?: string | null,
  ): Promise<ProviderCommissionSetting>;
  syncBookingPayouts(options?: { bookingIds?: string[]; skipAssignmentSync?: boolean }): Promise<{ created: number; updated: number; cancelled: number }>;
  updateBookingPayout(
    id: string,
    data: Partial<Pick<BookingPayout, "status" | "paymentMethod" | "paymentReference" | "notes" | "paidAt">>,
  ): Promise<BookingPayout | undefined>;

  // Admin Clients
  getClientsWithBookings(): Promise<import("@shared/schema").ClientWithBookings[]>;
  getProviderAccountSummaries(): Promise<ProviderAccountSummary[]>;
}

// Database Storage implementation using Drizzle ORM and PostgreSQL
export class DatabaseStorage implements IStorage {
  private paymentsTablesEnsured = false;
  private marketingTablesEnsured = false;
  private providerWorkflowTablesEnsured = false;
  private inboxTablesEnsured = false;
  private pushTablesEnsured = false;
  private tableColumnsCache = new Map<string, Set<string>>();

  private async getTableColumns(tableName: string): Promise<Set<string>> {
    const cached = this.tableColumnsCache.get(tableName);
    if (cached) {
      return cached;
    }

    const result = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [tableName],
    );

    const columns = new Set(result.rows.map((row) => row.column_name));
    this.tableColumnsCache.set(tableName, columns);
    return columns;
  }

  private async selectCompatibleBlogPosts(whereClause?: string, params: unknown[] = []): Promise<BlogPost[]> {
    await this.ensureMarketingTables();
    const columns = await this.getTableColumns("blog_posts");
    const selectParts = [
      "id",
      "title",
      "slug",
      "excerpt",
      columns.has("content_markdown") ? 'content_markdown AS "contentMarkdown"' : "''::text AS \"contentMarkdown\"",
      columns.has("featured_image") ? 'featured_image AS "featuredImage"' : 'NULL::text AS "featuredImage"',
      columns.has("featured_image_alt") ? 'featured_image_alt AS "featuredImageAlt"' : 'NULL::text AS "featuredImageAlt"',
      "author",
      columns.has("seo_title") ? 'seo_title AS "seoTitle"' : 'NULL::text AS "seoTitle"',
      columns.has("seo_description") ? 'seo_description AS "seoDescription"' : 'NULL::text AS "seoDescription"',
      columns.has("seo_keywords") ? 'seo_keywords AS "seoKeywords"' : 'NULL::text AS "seoKeywords"',
      columns.has("primary_cta_label") ? 'primary_cta_label AS "primaryCtaLabel"' : 'NULL::text AS "primaryCtaLabel"',
      columns.has("primary_cta_href") ? 'primary_cta_href AS "primaryCtaHref"' : 'NULL::text AS "primaryCtaHref"',
      columns.has("primary_promo_code") ? 'primary_promo_code AS "primaryPromoCode"' : 'NULL::varchar AS "primaryPromoCode"',
      columns.has("published_at") ? 'published_at AS "publishedAt"' : 'NULL::text AS "publishedAt"',
      columns.has("status") ? "status" : "'draft'::text AS status",
      columns.has("created_at") ? 'created_at AS "createdAt"' : 'NULL::text AS "createdAt"',
      columns.has("updated_at") ? 'updated_at AS "updatedAt"' : 'NULL::text AS "updatedAt"',
    ];

    const suffix = whereClause ? ` ${whereClause}` : "";
    const result = await pool.query<BlogPost>(
      `SELECT ${selectParts.join(", ")} FROM blog_posts${suffix}`,
      params,
    );
    return result.rows;
  }

  private async selectCompatibleStays(whereClause?: string, params: unknown[] = []): Promise<Stay[]> {
    const columns = await this.getTableColumns("stays");
    const selectParts = [
      "id",
      "title",
      columns.has("location") ? "location" : "''::text AS location",
      "description",
      columns.has("price") ? "price" : "0 AS price",
      columns.has("rating") ? "rating" : "5 AS rating",
      columns.has("review_count") ? 'review_count AS "reviewCount"' : '0 AS "reviewCount"',
      columns.has("max_occupancy") ? 'max_occupancy AS "maxOccupancy"' : '1 AS "maxOccupancy"',
      columns.has("bedrooms") ? "bedrooms" : "0 AS bedrooms",
      columns.has("bathrooms") ? "bathrooms" : "0 AS bathrooms",
      columns.has("image_url") ? 'image_url AS "imageUrl"' : 'NULL::text AS "imageUrl"',
      columns.has("gallery_urls") ? 'gallery_urls AS "galleryUrls"' : '\'{}\'::text[] AS "galleryUrls"',
      columns.has("media_type") ? 'media_type AS "mediaType"' : '\'image\'::varchar AS "mediaType"',
      columns.has("is_public") ? 'is_public AS "isPublic"' : 'false AS "isPublic"',
      columns.has("manager_user_id") ? 'manager_user_id AS "managerUserId"' : 'NULL::varchar AS "managerUserId"',
      columns.has("features") ? "features" : '\'{}\'::text[] AS features',
      columns.has("created_at") ? 'created_at AS "createdAt"' : 'NULL::text AS "createdAt"',
      columns.has("updated_at") ? 'updated_at AS "updatedAt"' : 'NULL::text AS "updatedAt"',
    ];

    const suffix = whereClause ? ` ${whereClause}` : "";
    const result = await pool.query<Stay>(
      `SELECT ${selectParts.join(", ")} FROM stays${suffix}`,
      params,
    );
    return result.rows.map((stay) => normalizeManagerScopedRecord(stay));
  }

  private async selectCompatibleCars(whereClause?: string, params: unknown[] = []): Promise<Car[]> {
    const columns = await this.getTableColumns("cars");
    const selectParts = [
      "id",
      "model",
      columns.has("location") ? "location" : "''::text AS location",
      columns.has("price_per_day") ? 'price_per_day AS "pricePerDay"' : 'NULL::integer AS "pricePerDay"',
      columns.has("price_with_driver") ? 'price_with_driver AS "priceWithDriver"' : '0 AS "priceWithDriver"',
      columns.has("price_with_driver_hourly") ? 'price_with_driver_hourly AS "priceWithDriverHourly"' : 'NULL::integer AS "priceWithDriverHourly"',
      columns.has("chauffeur_zones") ? 'chauffeur_zones AS "chauffeurZones"' : '\'[]\'::jsonb AS "chauffeurZones"',
      columns.has("self_drive_mileage_limit_km") ? 'self_drive_mileage_limit_km AS "selfDriveMileageLimitKm"' : 'NULL::integer AS "selfDriveMileageLimitKm"',
      columns.has("self_drive_extra_km_rate") ? 'self_drive_extra_km_rate AS "selfDriveExtraKmRate"' : 'NULL::integer AS "selfDriveExtraKmRate"',
      columns.has("seats") ? "seats" : "1 AS seats",
      columns.has("transmission") ? "transmission" : "'automatic'::text AS transmission",
      columns.has("description") ? "description" : "''::text AS description",
      columns.has("rating") ? "rating" : "5 AS rating",
      columns.has("review_count") ? 'review_count AS "reviewCount"' : '0 AS "reviewCount"',
      columns.has("image_url") ? 'image_url AS "imageUrl"' : 'NULL::text AS "imageUrl"',
      columns.has("gallery_urls") ? 'gallery_urls AS "galleryUrls"' : '\'{}\'::text[] AS "galleryUrls"',
      columns.has("media_type") ? 'media_type AS "mediaType"' : '\'image\'::varchar AS "mediaType"',
      columns.has("is_public") ? 'is_public AS "isPublic"' : 'false AS "isPublic"',
      columns.has("manager_user_id") ? 'manager_user_id AS "managerUserId"' : 'NULL::varchar AS "managerUserId"',
      columns.has("features") ? "features" : '\'{}\'::text[] AS features',
      columns.has("created_at") ? 'created_at AS "createdAt"' : 'NULL::text AS "createdAt"',
      columns.has("updated_at") ? 'updated_at AS "updatedAt"' : 'NULL::text AS "updatedAt"',
    ];

    const suffix = whereClause ? ` ${whereClause}` : "";
    const result = await pool.query<Car>(
      `SELECT ${selectParts.join(", ")} FROM cars${suffix}`,
      params,
    );
    return result.rows.map((car) => normalizeManagerScopedRecord(car));
  }

  private async selectCompatibleCooks(whereClause?: string, params: unknown[] = []): Promise<Cook[]> {
    const columns = await this.getTableColumns("cooks");
    const selectParts = [
      "id",
      "title",
      columns.has("location") ? "location" : "''::text AS location",
      columns.has("service_type") ? 'service_type AS "serviceType"' : '\'Private chef experience\'::text AS "serviceType"',
      columns.has("speciality") ? "speciality" : "''::text AS speciality",
      columns.has("max_guests") ? 'max_guests AS "maxGuests"' : '2 AS "maxGuests"',
      columns.has("minimum_guests") ? 'minimum_guests AS "minimumGuests"' : '2 AS "minimumGuests"',
      columns.has("price_per_session") ? 'price_per_session AS "pricePerSession"' : '0 AS "pricePerSession"',
      columns.has("service_fee") ? 'service_fee AS "serviceFee"' : '0 AS "serviceFee"',
      columns.has("inclusive_price") ? 'inclusive_price AS "inclusivePrice"' : '0 AS "inclusivePrice"',
      columns.has("extra_guest_service_fee") ? 'extra_guest_service_fee AS "extraGuestServiceFee"' : '0 AS "extraGuestServiceFee"',
      columns.has("extra_guest_inclusive_price") ? 'extra_guest_inclusive_price AS "extraGuestInclusivePrice"' : '0 AS "extraGuestInclusivePrice"',
      columns.has("ingredients_included") ? 'ingredients_included AS "ingredientsIncluded"' : 'true AS "ingredientsIncluded"',
      columns.has("shopping_included") ? 'shopping_included AS "shoppingIncluded"' : 'true AS "shoppingIncluded"',
      columns.has("custom_menu_enabled") ? 'custom_menu_enabled AS "customMenuEnabled"' : 'true AS "customMenuEnabled"',
      columns.has("custom_menu_request_fee") ? 'custom_menu_request_fee AS "customMenuRequestFee"' : '0 AS "customMenuRequestFee"',
      columns.has("custom_menu_request_fee_kes") ? 'custom_menu_request_fee_kes AS "customMenuRequestFeeKes"' : '0 AS "customMenuRequestFeeKes"',
      columns.has("description") ? "description" : "''::text AS description",
      columns.has("sample_menus") ? 'sample_menus AS "sampleMenus"' : '\'{}\'::text[] AS "sampleMenus"',
      columns.has("rating") ? "rating" : "5 AS rating",
      columns.has("review_count") ? 'review_count AS "reviewCount"' : '0 AS "reviewCount"',
      columns.has("image_url") ? 'image_url AS "imageUrl"' : 'NULL::text AS "imageUrl"',
      columns.has("gallery_urls") ? 'gallery_urls AS "galleryUrls"' : '\'{}\'::text[] AS "galleryUrls"',
      columns.has("media_type") ? 'media_type AS "mediaType"' : '\'image\'::varchar AS "mediaType"',
      columns.has("is_public") ? 'is_public AS "isPublic"' : 'false AS "isPublic"',
      columns.has("manager_user_id") ? 'manager_user_id AS "managerUserId"' : 'NULL::varchar AS "managerUserId"',
      columns.has("features") ? "features" : '\'{}\'::text[] AS features',
      columns.has("created_at") ? 'created_at AS "createdAt"' : 'NULL::text AS "createdAt"',
      columns.has("updated_at") ? 'updated_at AS "updatedAt"' : 'NULL::text AS "updatedAt"',
    ];

    const suffix = whereClause ? ` ${whereClause}` : "";
    const result = await pool.query<Cook>(
      `SELECT ${selectParts.join(", ")} FROM cooks${suffix}`,
      params,
    );
    return result.rows.map((cook) => normalizeManagerScopedRecord(cook));
  }

  private async selectCompatibleExperiences(whereClause?: string, params: unknown[] = []): Promise<Experience[]> {
    const columns = await this.getTableColumns("experiences");
    const selectParts = [
      "id",
      "title",
      columns.has("location") ? "location" : "''::text AS location",
      columns.has("experience_location") ? 'experience_location AS "experienceLocation"' : "''::text AS \"experienceLocation\"",
      columns.has("experience_type") ? 'experience_type AS "experienceType"' : '\'Curated experience\'::text AS "experienceType"',
      columns.has("price") ? "price" : "0 AS price",
      columns.has("duration_hours") ? 'duration_hours AS "durationHours"' : '3 AS "durationHours"',
      columns.has("min_guests") ? 'min_guests AS "minGuests"' : '1 AS "minGuests"',
      columns.has("max_guests") ? 'max_guests AS "maxGuests"' : '10 AS "maxGuests"',
      columns.has("meeting_point") ? 'meeting_point AS "meetingPoint"' : 'NULL::text AS "meetingPoint"',
      columns.has("inclusions") ? "inclusions" : '\'{}\'::text[] AS inclusions',
      columns.has("exclusions") ? "exclusions" : '\'{}\'::text[] AS exclusions',
      columns.has("custom_quote_enabled") ? 'custom_quote_enabled AS "customQuoteEnabled"' : 'false AS "customQuoteEnabled"',
      columns.has("private_enabled") ? 'private_enabled AS "privateEnabled"' : 'true AS "privateEnabled"',
      columns.has("shared_enabled") ? 'shared_enabled AS "sharedEnabled"' : 'false AS "sharedEnabled"',
      columns.has("private_price_per_person") ? 'private_price_per_person AS "privatePricePerPerson"' : '0 AS "privatePricePerPerson"',
      columns.has("private_minimum_guests") ? 'private_minimum_guests AS "privateMinimumGuests"' : '2 AS "privateMinimumGuests"',
      columns.has("private_addons") ? 'private_addons AS "privateAddons"' : '\'[]\'::jsonb AS "privateAddons"',
      columns.has("shared_price_per_person") ? 'shared_price_per_person AS "sharedPricePerPerson"' : '0 AS "sharedPricePerPerson"',
      columns.has("shared_minimum_guests") ? 'shared_minimum_guests AS "sharedMinimumGuests"' : '4 AS "sharedMinimumGuests"',
      columns.has("shared_max_capacity") ? 'shared_max_capacity AS "sharedMaxCapacity"' : '10 AS "sharedMaxCapacity"',
      columns.has("shared_addons") ? 'shared_addons AS "sharedAddons"' : '\'[]\'::jsonb AS "sharedAddons"',
      columns.has("shared_departures") ? 'shared_departures AS "sharedDepartures"' : '\'[]\'::jsonb AS "sharedDepartures"',
      columns.has("description") ? "description" : "''::text AS description",
      columns.has("rating") ? "rating" : "5 AS rating",
      columns.has("review_count") ? 'review_count AS "reviewCount"' : '0 AS "reviewCount"',
      columns.has("image_url") ? 'image_url AS "imageUrl"' : 'NULL::text AS "imageUrl"',
      columns.has("gallery_urls") ? 'gallery_urls AS "galleryUrls"' : '\'{}\'::text[] AS "galleryUrls"',
      columns.has("media_type") ? 'media_type AS "mediaType"' : '\'image\'::varchar AS "mediaType"',
      columns.has("is_public") ? 'is_public AS "isPublic"' : 'false AS "isPublic"',
      columns.has("manager_user_id") ? 'manager_user_id AS "managerUserId"' : 'NULL::varchar AS "managerUserId"',
      columns.has("features") ? "features" : '\'{}\'::text[] AS features',
      columns.has("created_at") ? 'created_at AS "createdAt"' : 'NULL::text AS "createdAt"',
      columns.has("updated_at") ? 'updated_at AS "updatedAt"' : 'NULL::text AS "updatedAt"',
    ];

    const suffix = whereClause ? ` ${whereClause}` : "";
    const result = await pool.query<Experience>(
      `SELECT ${selectParts.join(", ")} FROM experiences${suffix}`,
      params,
    );
    return result.rows.map((experience) => normalizeManagerScopedRecord(experience));
  }

  private async ensureInboxTables() {
    if (this.inboxTablesEnsured) {
      return;
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_inbox_items (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        actor_user_id varchar,
        actor_role varchar,
        booking_id varchar,
        assignment_id varchar,
        thread_key text,
        type varchar NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        action_url text,
        priority varchar NOT NULL DEFAULT 'normal',
        channels jsonb NOT NULL DEFAULT '["in-app"]'::jsonb,
        delivery_state jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        is_read boolean NOT NULL DEFAULT false,
        read_at text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS app_inbox_items_user_idx
      ON app_inbox_items (user_id, is_read, created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS app_inbox_items_thread_idx
      ON app_inbox_items (user_id, thread_key, is_read);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS app_inbox_items_booking_idx
      ON app_inbox_items (booking_id, assignment_id, created_at DESC);
    `);

    this.inboxTablesEnsured = true;
  }

  private async ensurePushTables() {
    if (this.pushTablesEnsured) {
      return;
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_push_devices (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        platform varchar NOT NULL DEFAULT 'web',
        provider varchar NOT NULL DEFAULT 'web-push',
        endpoint text NOT NULL,
        subscription jsonb NOT NULL,
        device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
        permission varchar NOT NULL DEFAULT 'default',
        is_active boolean NOT NULL DEFAULT true,
        last_seen_at text NOT NULL,
        last_push_sent_at text,
        last_push_failed_at text,
        last_push_error text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_push_devices_endpoint_idx
      ON user_push_devices (endpoint);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS user_push_devices_user_idx
      ON user_push_devices (user_id, is_active, updated_at DESC);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_push_preferences (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        push_enabled boolean NOT NULL DEFAULT true,
        booking_messages boolean NOT NULL DEFAULT true,
        assignment_alerts boolean NOT NULL DEFAULT true,
        marketing_enabled boolean NOT NULL DEFAULT false,
        quiet_hours_start text,
        quiet_hours_end text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_push_preferences_user_idx
      ON user_push_preferences (user_id);
    `);

    this.pushTablesEnsured = true;
  }

  private async ensurePaymentsTables() {
    if (this.paymentsTablesEnsured) {
      return;
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS provider_commission_settings (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_user_id varchar NOT NULL,
        provider_category varchar NOT NULL,
        commission_percent integer NOT NULL DEFAULT 0,
        notes text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS provider_commission_settings_provider_category_idx
      ON provider_commission_settings (provider_user_id, provider_category);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_payouts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        assignment_id varchar,
        booking_id varchar NOT NULL,
        provider_user_id varchar NOT NULL,
        provider_category varchar NOT NULL,
        service_id varchar NOT NULL,
        service_name text NOT NULL,
        guest_name text NOT NULL,
        gross_amount integer NOT NULL,
        commission_percent integer NOT NULL DEFAULT 0,
        commission_amount integer NOT NULL DEFAULT 0,
        payout_amount integer NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'pending',
        due_at text,
        paid_at text,
        payment_method varchar,
        payment_reference text,
        notes text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    const bookingPayoutColumns = await this.getTableColumns("booking_payouts");
    if (!bookingPayoutColumns.has("assignment_id")) {
      await pool.query(`
        ALTER TABLE booking_payouts
        ADD COLUMN assignment_id varchar;
      `);
    }

    await pool.query(`
      DROP INDEX IF EXISTS booking_payouts_booking_provider_service_idx;
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS booking_payouts_assignment_idx
      ON booking_payouts (assignment_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS booking_payouts_booking_service_idx
      ON booking_payouts (booking_id, provider_category, service_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS booking_payouts_status_idx
      ON booking_payouts (status);
    `);

    await pool.query(`
      ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS payment_status varchar NOT NULL DEFAULT 'paid',
      ADD COLUMN IF NOT EXISTS payment_provider varchar,
      ADD COLUMN IF NOT EXISTS payment_reference text,
      ADD COLUMN IF NOT EXISTS payment_session_id text,
      ADD COLUMN IF NOT EXISTS payment_currency varchar NOT NULL DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS payment_amount integer,
      ADD COLUMN IF NOT EXISTS payment_checkout_amount integer,
      ADD COLUMN IF NOT EXISTS payment_deposit_amount integer,
      ADD COLUMN IF NOT EXISTS payment_amount_paid integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS payment_hold_expires_at text,
      ADD COLUMN IF NOT EXISTS paid_at text,
      ADD COLUMN IF NOT EXISTS payment_failed_at text;
    `);

    this.tableColumnsCache.delete("booking_payouts");
    this.tableColumnsCache.delete("bookings");

    this.paymentsTablesEnsured = true;
  }

  private async ensureProviderWorkflowTables() {
    if (this.providerWorkflowTablesEnsured) {
      return;
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_service_assignments (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id varchar NOT NULL,
        provider_user_id varchar,
        provider_category varchar NOT NULL,
        service_id varchar NOT NULL,
        service_name text NOT NULL,
        service_config jsonb NOT NULL,
        gross_amount integer NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'upcoming',
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS booking_service_assignments_booking_service_idx
      ON booking_service_assignments (booking_id, provider_category, service_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS booking_service_assignments_provider_idx
      ON booking_service_assignments (provider_user_id, provider_category, status);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS provider_notifications (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        booking_id varchar,
        assignment_id varchar,
        type varchar NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        is_read boolean NOT NULL DEFAULT false,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS provider_notifications_user_idx
      ON provider_notifications (user_id, is_read, created_at DESC);
    `);

    this.providerWorkflowTablesEnsured = true;
  }

  private async ensureMarketingTables() {
    if (this.marketingTablesEnsured) {
      return;
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS blog_posts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        title text NOT NULL,
        slug text NOT NULL,
        excerpt text NOT NULL,
        content_markdown text NOT NULL,
        featured_image text,
        featured_image_alt text,
        author text NOT NULL,
        seo_title text,
        seo_description text,
        seo_keywords text,
        primary_cta_label text,
        primary_cta_href text,
        primary_promo_code varchar,
        published_at text,
        status text NOT NULL DEFAULT 'draft',
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS blog_posts_slug_idx
      ON blog_posts (slug);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS blog_posts_status_idx
      ON blog_posts (status);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_promos (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        code varchar UNIQUE,
        description text,
        promo_type varchar NOT NULL DEFAULT 'percent',
        cost_absorption varchar NOT NULL DEFAULT 'shared',
        status varchar NOT NULL DEFAULT 'draft',
        channel varchar NOT NULL DEFAULT 'homepage',
        audience text,
        eligible_categories text[] NOT NULL DEFAULT '{}'::text[],
        auto_apply boolean NOT NULL DEFAULT false,
        required_categories text[] NOT NULL DEFAULT '{}'::text[],
        minimum_nights integer,
        minimum_guests integer,
        minimum_service_count integer,
        bundle_label text,
        discount_percent integer,
        discount_amount integer,
        minimum_spend integer,
        usage_limit integer,
        redemption_count integer NOT NULL DEFAULT 0,
        attributed_revenue integer NOT NULL DEFAULT 0,
        landing_path text,
        start_at text,
        end_at text,
        notes text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS marketing_promos_status_idx
      ON marketing_promos (status);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS marketing_promos_channel_idx
      ON marketing_promos (channel);
    `);

    await pool.query(`
      ALTER TABLE blog_posts
      ADD COLUMN IF NOT EXISTS primary_cta_label text,
      ADD COLUMN IF NOT EXISTS primary_cta_href text,
      ADD COLUMN IF NOT EXISTS primary_promo_code varchar;
    `);

    await pool.query(`
      ALTER TABLE marketing_promos
      ADD COLUMN IF NOT EXISTS cost_absorption varchar NOT NULL DEFAULT 'shared',
      ADD COLUMN IF NOT EXISTS auto_apply boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS required_categories text[] NOT NULL DEFAULT '{}'::text[],
      ADD COLUMN IF NOT EXISTS minimum_nights integer,
      ADD COLUMN IF NOT EXISTS minimum_guests integer,
      ADD COLUMN IF NOT EXISTS minimum_service_count integer;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_attribution_events (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id varchar NOT NULL,
        event_type varchar NOT NULL,
        source_type varchar NOT NULL DEFAULT 'direct',
        source_id varchar,
        source_slug text,
        source_path text,
        source_title text,
        promo_id varchar,
        promo_code varchar,
        promo_name text,
        landing_path text,
        referrer_path text,
        entry_path text,
        utm_source text,
        utm_medium text,
        utm_campaign text,
        utm_content text,
        created_at text NOT NULL
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS marketing_attribution_events_session_idx
      ON marketing_attribution_events (session_id, created_at);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS marketing_attribution_events_source_idx
      ON marketing_attribution_events (source_type, source_id);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_attributions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id varchar NOT NULL,
        session_id varchar,
        source_type varchar NOT NULL DEFAULT 'direct',
        source_id varchar,
        source_slug text,
        source_path text,
        source_title text,
        promo_id varchar,
        promo_code varchar,
        promo_name text,
        promo_cost_absorption varchar,
        landing_path text,
        referrer_path text,
        entry_path text,
        utm_source text,
        utm_medium text,
        utm_campaign text,
        utm_content text,
        original_subtotal integer NOT NULL DEFAULT 0,
        discount_amount integer NOT NULL DEFAULT 0,
        final_revenue integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS booking_attributions_booking_id_idx
      ON booking_attributions (booking_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS booking_attributions_source_idx
      ON booking_attributions (source_type, source_id);
    `);

    await pool.query(`
      ALTER TABLE booking_attributions
      ADD COLUMN IF NOT EXISTS promo_cost_absorption varchar;
    `);

    this.marketingTablesEnsured = true;
  }

  private filterErrandWriteData(data: Partial<InsertErrand>, columns: Set<string>): Partial<InsertErrand> {
    const filtered: Partial<InsertErrand> = { ...data };

    if (!columns.has("shopping_enabled")) {
      delete filtered.shoppingEnabled;
    }
    if (!columns.has("location")) {
      delete filtered.location;
    }
    if (!columns.has("shopping_commission_percent")) {
      delete filtered.shoppingCommissionPercent;
    }
    if (!columns.has("laundry_enabled")) {
      delete filtered.laundryEnabled;
    }
    if (!columns.has("house_cleaning_enabled")) {
      delete filtered.houseCleaningEnabled;
    }
    if (!columns.has("laundry_included_kg")) {
      delete filtered.laundryIncludedKg;
    }
    if (!columns.has("laundry_price_per_kg")) {
      delete filtered.laundryPricePerKg;
    }
    if (!columns.has("laundry_addons")) {
      delete filtered.laundryAddons;
    }
    if (!columns.has("house_cleaning_addons")) {
      delete filtered.houseCleaningAddons;
    }
    if (!columns.has("help_mama_pricing")) {
      delete filtered.helpMamaPricing;
    }
    if (!columns.has("gallery_urls")) {
      delete filtered.galleryUrls;
    }
    if (!columns.has("media_type")) {
      delete filtered.mediaType;
    }
    if (!columns.has("is_public")) {
      delete filtered.isPublic;
    }
    if (!columns.has("manager_user_id")) {
      delete filtered.managerUserId;
    }

    return filtered;
  }

  private filterBookingWriteData<T extends Record<string, any>>(data: T, columns: Set<string>): T {
    const filtered = { ...data };

    if (!columns.has("stay_service_selections")) {
      delete filtered.stayServiceSelections;
    }
    if (!columns.has("provider_status_request")) {
      delete filtered.providerStatusRequest;
    }
    if (!columns.has("provider_status_request_note")) {
      delete filtered.providerStatusRequestNote;
    }
    if (!columns.has("provider_status_requested_by_user_id")) {
      delete filtered.providerStatusRequestedByUserId;
    }
    if (!columns.has("provider_status_requested_at")) {
      delete filtered.providerStatusRequestedAt;
    }
    if (!columns.has("provider_status_reviewed_by_user_id")) {
      delete filtered.providerStatusReviewedByUserId;
    }
    if (!columns.has("provider_status_reviewed_at")) {
      delete filtered.providerStatusReviewedAt;
    }
    if (!columns.has("payment_status")) {
      delete filtered.paymentStatus;
    }
    if (!columns.has("payment_provider")) {
      delete filtered.paymentProvider;
    }
    if (!columns.has("payment_reference")) {
      delete filtered.paymentReference;
    }
    if (!columns.has("payment_session_id")) {
      delete filtered.paymentSessionId;
    }
    if (!columns.has("payment_currency")) {
      delete filtered.paymentCurrency;
    }
    if (!columns.has("payment_amount")) {
      delete filtered.paymentAmount;
    }
    if (!columns.has("payment_checkout_amount")) {
      delete filtered.paymentCheckoutAmount;
    }
    if (!columns.has("payment_deposit_amount")) {
      delete filtered.paymentDepositAmount;
    }
    if (!columns.has("payment_amount_paid")) {
      delete filtered.paymentAmountPaid;
    }
    if (!columns.has("payment_hold_expires_at")) {
      delete filtered.paymentHoldExpiresAt;
    }
    if (!columns.has("paid_at")) {
      delete filtered.paidAt;
    }
    if (!columns.has("payment_failed_at")) {
      delete filtered.paymentFailedAt;
    }

    return filtered as T;
  }

  private async getBookingAnalyticsRows(): Promise<Booking[]> {
    const columns = await this.getTableColumns("bookings");
    const result = await pool.query(`
      select
        id,
        user_id as "userId",
        accommodation_id as "accommodationId",
        guest_name as "guestName",
        guest_email as "guestEmail",
        guest_phone as "guestPhone",
        check_in as "checkIn",
        check_out as "checkOut",
        guests,
        selected_services as "selectedServices",
        service_mode as "serviceMode",
        service_hours as "serviceHours",
        service_location as "serviceLocation",
        service_pickup_location as "servicePickupLocation",
        service_return_location as "serviceReturnLocation",
        service_zone as "serviceZone",
        service_start_time as "serviceStartTime",
        service_end_time as "serviceEndTime",
        ${columns.has("service_budget_amount") ? 'service_budget_amount as "serviceBudgetAmount",' : 'NULL::integer as "serviceBudgetAmount",'}
        ${columns.has("service_laundry_weight_kg") ? 'service_laundry_weight_kg as "serviceLaundryWeightKg",' : 'NULL::integer as "serviceLaundryWeightKg",'}
        ${columns.has("service_addon_selections") ? 'service_addon_selections as "serviceAddonSelections",' : '\'{}\'::text[] as "serviceAddonSelections",'}
        ${columns.has("service_schedule_slots") ? 'service_schedule_slots as "serviceScheduleSlots",' : '\'[]\'::jsonb as "serviceScheduleSlots",'}
        ${columns.has("service_departure_id") ? 'service_departure_id as "serviceDepartureId",' : 'NULL::text as "serviceDepartureId",'}
        ${columns.has("service_request_fee") ? 'service_request_fee as "serviceRequestFee",' : 'NULL::integer as "serviceRequestFee",'}
        ${columns.has("service_request_details") ? 'service_request_details as "serviceRequestDetails",' : 'NULL::text as "serviceRequestDetails",'}
        ${columns.has("service_response_message") ? 'service_response_message as "serviceResponseMessage",' : 'NULL::text as "serviceResponseMessage",'}
        ${columns.has("service_request_fee_kes") ? 'service_request_fee_kes as "serviceRequestFeeKes",' : 'NULL::integer as "serviceRequestFeeKes",'}
        ${columns.has("stay_service_selections") ? 'stay_service_selections as "stayServiceSelections",' : '\'[]\'::jsonb as "stayServiceSelections",'}
        ${columns.has("custom_menu_proposal_status") ? 'custom_menu_proposal_status as "customMenuProposalStatus",' : '\'pending\'::text as "customMenuProposalStatus",'}
        ${columns.has("custom_menu_proposed_amount") ? 'custom_menu_proposed_amount as "customMenuProposedAmount",' : 'NULL::integer as "customMenuProposedAmount",'}
        ${columns.has("custom_menu_proposal_message") ? 'custom_menu_proposal_message as "customMenuProposalMessage",' : 'NULL::text as "customMenuProposalMessage",'}
        ${columns.has("custom_menu_decline_reason") ? 'custom_menu_decline_reason as "customMenuDeclineReason",' : 'NULL::text as "customMenuDeclineReason",'}
        ${columns.has("custom_menu_client_decision") ? 'custom_menu_client_decision as "customMenuClientDecision",' : '\'pending\'::text as "customMenuClientDecision",'}
        ${columns.has("custom_menu_client_responded_at") ? 'custom_menu_client_responded_at as "customMenuClientRespondedAt",' : 'NULL::text as "customMenuClientRespondedAt",'}
        ${columns.has("custom_menu_credit_code") ? 'custom_menu_credit_code as "customMenuCreditCode",' : 'NULL::text as "customMenuCreditCode",'}
        ${columns.has("custom_menu_credit_amount") ? 'custom_menu_credit_amount as "customMenuCreditAmount",' : 'NULL::integer as "customMenuCreditAmount",'}
        ${columns.has("custom_menu_reviewed_by_user_id") ? 'custom_menu_reviewed_by_user_id as "customMenuReviewedByUserId",' : 'NULL::text as "customMenuReviewedByUserId",'}
        ${columns.has("custom_menu_reviewed_at") ? 'custom_menu_reviewed_at as "customMenuReviewedAt",' : 'NULL::text as "customMenuReviewedAt",'}
        ${columns.has("experience_custom_offer_status") ? 'experience_custom_offer_status as "experienceCustomOfferStatus",' : '\'pending\'::text as "experienceCustomOfferStatus",'}
        ${columns.has("experience_custom_offer_amount") ? 'experience_custom_offer_amount as "experienceCustomOfferAmount",' : 'NULL::integer as "experienceCustomOfferAmount",'}
        ${columns.has("experience_custom_offer_message") ? 'experience_custom_offer_message as "experienceCustomOfferMessage",' : 'NULL::text as "experienceCustomOfferMessage",'}
        ${columns.has("experience_custom_offer_decline_reason") ? 'experience_custom_offer_decline_reason as "experienceCustomOfferDeclineReason",' : 'NULL::text as "experienceCustomOfferDeclineReason",'}
        ${columns.has("experience_custom_offer_client_decision") ? 'experience_custom_offer_client_decision as "experienceCustomOfferClientDecision",' : '\'pending\'::text as "experienceCustomOfferClientDecision",'}
        ${columns.has("experience_custom_offer_client_responded_at") ? 'experience_custom_offer_client_responded_at as "experienceCustomOfferClientRespondedAt",' : 'NULL::text as "experienceCustomOfferClientRespondedAt",'}
        ${columns.has("experience_custom_offer_reviewed_by_user_id") ? 'experience_custom_offer_reviewed_by_user_id as "experienceCustomOfferReviewedByUserId",' : 'NULL::text as "experienceCustomOfferReviewedByUserId",'}
        ${columns.has("experience_custom_offer_reviewed_at") ? 'experience_custom_offer_reviewed_at as "experienceCustomOfferReviewedAt",' : 'NULL::text as "experienceCustomOfferReviewedAt",'}
        ${columns.has("provider_status_request") ? 'provider_status_request as "providerStatusRequest",' : 'NULL::text as "providerStatusRequest",'}
        ${columns.has("provider_status_request_note") ? 'provider_status_request_note as "providerStatusRequestNote",' : 'NULL::text as "providerStatusRequestNote",'}
        ${columns.has("provider_status_requested_by_user_id") ? 'provider_status_requested_by_user_id as "providerStatusRequestedByUserId",' : 'NULL::text as "providerStatusRequestedByUserId",'}
        ${columns.has("provider_status_requested_at") ? 'provider_status_requested_at as "providerStatusRequestedAt",' : 'NULL::text as "providerStatusRequestedAt",'}
        ${columns.has("provider_status_reviewed_by_user_id") ? 'provider_status_reviewed_by_user_id as "providerStatusReviewedByUserId",' : 'NULL::text as "providerStatusReviewedByUserId",'}
        ${columns.has("provider_status_reviewed_at") ? 'provider_status_reviewed_at as "providerStatusReviewedAt",' : 'NULL::text as "providerStatusReviewedAt",'}
        ${columns.has("payment_status") ? 'payment_status as "paymentStatus",' : '\'paid\'::text as "paymentStatus",'}
        ${columns.has("payment_provider") ? 'payment_provider as "paymentProvider",' : 'NULL::text as "paymentProvider",'}
        ${columns.has("payment_reference") ? 'payment_reference as "paymentReference",' : 'NULL::text as "paymentReference",'}
        ${columns.has("payment_session_id") ? 'payment_session_id as "paymentSessionId",' : 'NULL::text as "paymentSessionId",'}
        ${columns.has("payment_currency") ? 'payment_currency as "paymentCurrency",' : '\'USD\'::text as "paymentCurrency",'}
        ${columns.has("payment_amount") ? 'payment_amount as "paymentAmount",' : 'NULL::integer as "paymentAmount",'}
        ${columns.has("payment_checkout_amount") ? 'payment_checkout_amount as "paymentCheckoutAmount",' : 'NULL::integer as "paymentCheckoutAmount",'}
        ${columns.has("payment_deposit_amount") ? 'payment_deposit_amount as "paymentDepositAmount",' : 'NULL::integer as "paymentDepositAmount",'}
        ${columns.has("payment_amount_paid") ? 'payment_amount_paid as "paymentAmountPaid",' : '0::integer as "paymentAmountPaid",'}
        ${columns.has("payment_hold_expires_at") ? 'payment_hold_expires_at as "paymentHoldExpiresAt",' : 'NULL::text as "paymentHoldExpiresAt",'}
        ${columns.has("paid_at") ? 'paid_at as "paidAt",' : 'NULL::text as "paidAt",'}
        ${columns.has("payment_failed_at") ? 'payment_failed_at as "paymentFailedAt",' : 'NULL::text as "paymentFailedAt",'}
        total_price as "totalPrice",
        status,
        created_at as "createdAt",
        booking_type as "bookingType"
      from bookings
    `);

    return result.rows.map((row: any) => ({
      id: row.id,
      userId: row.userId ?? null,
      accommodationId: row.accommodationId ?? null,
      guestName: row.guestName,
      guestEmail: row.guestEmail,
      guestPhone: row.guestPhone ?? null,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      guests: Number(row.guests ?? 0),
      selectedServices: Array.isArray(row.selectedServices) ? row.selectedServices : [],
      serviceMode: row.serviceMode ?? null,
      serviceHours: row.serviceHours == null ? null : Number(row.serviceHours),
      serviceLocation: row.serviceLocation ?? null,
      servicePickupLocation: row.servicePickupLocation ?? null,
      serviceReturnLocation: row.serviceReturnLocation ?? null,
      serviceZone: row.serviceZone ?? null,
      serviceStartTime: row.serviceStartTime ?? null,
      serviceEndTime: row.serviceEndTime ?? null,
      serviceBudgetAmount: row.serviceBudgetAmount == null ? null : Number(row.serviceBudgetAmount),
      serviceLaundryWeightKg: row.serviceLaundryWeightKg == null ? null : Number(row.serviceLaundryWeightKg),
      serviceAddonSelections: Array.isArray(row.serviceAddonSelections) ? row.serviceAddonSelections : [],
      serviceScheduleSlots: Array.isArray(row.serviceScheduleSlots) ? row.serviceScheduleSlots : [],
      serviceDepartureId: row.serviceDepartureId ?? null,
      serviceRequestFee: row.serviceRequestFee == null ? null : Number(row.serviceRequestFee),
      serviceRequestDetails: row.serviceRequestDetails ?? null,
      serviceResponseMessage: row.serviceResponseMessage ?? null,
      serviceRequestFeeKes: row.serviceRequestFeeKes == null ? null : Number(row.serviceRequestFeeKes),
      stayServiceSelections: Array.isArray(row.stayServiceSelections) ? row.stayServiceSelections : [],
      customMenuProposalStatus: row.customMenuProposalStatus ?? "pending",
      customMenuProposedAmount: row.customMenuProposedAmount == null ? null : Number(row.customMenuProposedAmount),
      customMenuProposalMessage: row.customMenuProposalMessage ?? null,
      customMenuDeclineReason: row.customMenuDeclineReason ?? null,
      customMenuClientDecision: row.customMenuClientDecision ?? "pending",
      customMenuClientRespondedAt: row.customMenuClientRespondedAt ?? null,
      customMenuCreditCode: row.customMenuCreditCode ?? null,
      customMenuCreditAmount: row.customMenuCreditAmount == null ? null : Number(row.customMenuCreditAmount),
      customMenuReviewedByUserId: row.customMenuReviewedByUserId ?? null,
      customMenuReviewedAt: row.customMenuReviewedAt ?? null,
      experienceCustomOfferStatus: row.experienceCustomOfferStatus ?? "pending",
      experienceCustomOfferAmount: row.experienceCustomOfferAmount == null ? null : Number(row.experienceCustomOfferAmount),
      experienceCustomOfferMessage: row.experienceCustomOfferMessage ?? null,
      experienceCustomOfferDeclineReason: row.experienceCustomOfferDeclineReason ?? null,
      experienceCustomOfferClientDecision: row.experienceCustomOfferClientDecision ?? "pending",
      experienceCustomOfferClientRespondedAt: row.experienceCustomOfferClientRespondedAt ?? null,
      experienceCustomOfferReviewedByUserId: row.experienceCustomOfferReviewedByUserId ?? null,
      experienceCustomOfferReviewedAt: row.experienceCustomOfferReviewedAt ?? null,
      providerStatusRequest: row.providerStatusRequest ?? null,
      providerStatusRequestNote: row.providerStatusRequestNote ?? null,
      providerStatusRequestedByUserId: row.providerStatusRequestedByUserId ?? null,
      providerStatusRequestedAt: row.providerStatusRequestedAt ?? null,
      providerStatusReviewedByUserId: row.providerStatusReviewedByUserId ?? null,
      providerStatusReviewedAt: row.providerStatusReviewedAt ?? null,
      paymentStatus: row.paymentStatus ?? "paid",
      paymentProvider: row.paymentProvider ?? null,
      paymentReference: row.paymentReference ?? null,
      paymentSessionId: row.paymentSessionId ?? null,
      paymentCurrency: row.paymentCurrency ?? "USD",
      paymentAmount: row.paymentAmount == null ? null : Number(row.paymentAmount),
      paymentCheckoutAmount: row.paymentCheckoutAmount == null ? null : Number(row.paymentCheckoutAmount),
      paymentDepositAmount: row.paymentDepositAmount == null ? null : Number(row.paymentDepositAmount),
      paymentAmountPaid: row.paymentAmountPaid == null ? 0 : Number(row.paymentAmountPaid),
      paymentHoldExpiresAt: row.paymentHoldExpiresAt ?? null,
      paidAt: row.paidAt ?? null,
      paymentFailedAt: row.paymentFailedAt ?? null,
      totalPrice: Number(row.totalPrice ?? 0),
      status: row.status,
      createdAt: row.createdAt,
      bookingType: row.bookingType ?? "accommodation",
    })) as Booking[];
  }

  // Replit Auth Integration: User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return sanitizeOptionalUserRecord(user);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // Check if user exists by email first to handle OIDC scenarios where
    // the same email might be provided with different IDs
    if (userData.email) {
      const existingUserByEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, userData.email))
        .limit(1);
      
      if (existingUserByEmail.length > 0 && existingUserByEmail[0].id !== userData.id) {
        // Update existing user with the new ID and data
        const [updated] = await db
          .update(users)
          .set({
            ...userData,
            updatedAt: new Date(),
          })
          .where(eq(users.email, userData.email))
          .returning();
        return updated;
      }
    }
    
    // Normal upsert based on ID
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return sanitizeUserRecord(user);
  }

  async updateUserRole(userId: string, role: UserRole): Promise<User> {
    const [updated] = await db
      .update(users)
      .set({ 
        role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    
    if (!updated) {
      throw new Error(`User not found: ${userId}`);
    }
    
    console.log(`Updated user ${userId} role to ${role}`);
    return sanitizeUserRecord(updated);
  }

  async getUsersByRole(role: UserRole): Promise<User[]> {
    const columns = await this.getTableColumns("users");
    const selectParts = [
      "id",
      "email",
      "phone",
      "first_name AS \"firstName\"",
      "last_name AS \"lastName\"",
      columns.has("profile_image_url") ? "profile_image_url AS \"profileImageUrl\"" : "NULL::text AS \"profileImageUrl\"",
      columns.has("password_hash") ? "password_hash AS \"passwordHash\"" : "NULL::text AS \"passwordHash\"",
      "role",
      columns.has("provider_type") ? "provider_type AS \"providerType\"" : "NULL::text AS \"providerType\"",
      columns.has("is_suspended") ? "is_suspended AS \"isSuspended\"" : "false AS \"isSuspended\"",
      columns.has("warning_count") ? "warning_count AS \"warningCount\"" : "0 AS \"warningCount\"",
      columns.has("moderation_note") ? "moderation_note AS \"moderationNote\"" : "NULL::text AS \"moderationNote\"",
      columns.has("created_at") ? "created_at AS \"createdAt\"" : "NULL::timestamp AS \"createdAt\"",
      columns.has("updated_at") ? "updated_at AS \"updatedAt\"" : "NULL::timestamp AS \"updatedAt\"",
    ];

    const result = await pool.query<User>(
      `SELECT ${selectParts.join(", ")} FROM users WHERE role = $1`,
      [role],
    );
    return sanitizeUserRecords(result.rows);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return sanitizeOptionalUserRecord(user);
  }

  async updateUser(userId: string, data: Partial<UpsertUser>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return sanitizeOptionalUserRecord(user);
  }

  async deleteUser(userId: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, userId));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Accommodations
  async getAccommodations(): Promise<Accommodation[]> {
    return await db.select().from(accommodations);
  }

  async getAccommodation(id: string): Promise<Accommodation | undefined> {
    const [accommodation] = await db.select().from(accommodations).where(eq(accommodations.id, id));
    return accommodation;
  }

  async createAccommodation(data: InsertAccommodation): Promise<Accommodation> {
    const [accommodation] = await db.insert(accommodations).values(data).returning();
    return accommodation;
  }

  async updateAccommodation(id: string, data: Partial<InsertAccommodation>): Promise<Accommodation | undefined> {
    const [accommodation] = await db.update(accommodations).set(data).where(eq(accommodations.id, id)).returning();
    return accommodation;
  }

  async deleteAccommodation(id: string): Promise<boolean> {
    const result = await db.delete(accommodations).where(eq(accommodations.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Services
  async getServices(): Promise<Service[]> {
    return await db.select().from(services);
  }

  async getService(id: string): Promise<Service | undefined> {
    const [service] = await db.select().from(services).where(eq(services.id, id));
    return service;
  }

  async createService(data: InsertService): Promise<Service> {
    const [service] = await db.insert(services).values(data).returning();
    return service;
  }

  async updateService(id: string, data: Partial<InsertService>): Promise<Service | undefined> {
    const [service] = await db.update(services).set(data).where(eq(services.id, id)).returning();
    return service;
  }

  async deleteService(id: string): Promise<boolean> {
    const result = await db.delete(services).where(eq(services.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Providers
  async getProviders(): Promise<Provider[]> {
    return await db.select().from(providers);
  }

  async getProvider(id: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.id, id));
    return provider;
  }

  async getProvidersByServiceType(serviceType: string): Promise<Provider[]> {
    return await db.select().from(providers).where(eq(providers.serviceType, serviceType));
  }

  async createProvider(data: InsertProvider): Promise<Provider> {
    const [provider] = await db.insert(providers).values(data).returning();
    return provider;
  }

  async updateProvider(id: string, data: Partial<InsertProvider>): Promise<Provider | undefined> {
    const [provider] = await db.update(providers).set(data).where(eq(providers.id, id)).returning();
    return provider;
  }

  async deleteProvider(id: string): Promise<boolean> {
    const result = await db.delete(providers).where(eq(providers.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Bookings
  async getBookings(): Promise<Booking[]> {
    return await this.getBookingAnalyticsRows();
  }

  async getBookingsByUserId(userId: string): Promise<Booking[]> {
    return (await this.getBookingAnalyticsRows()).filter((booking) => booking.userId === userId);
  }

  async getBookingsByAccommodationId(accommodationId: string): Promise<Booking[]> {
    return (await this.getBookingAnalyticsRows()).filter((booking) => booking.accommodationId === accommodationId);
  }

  async getBookingsBySelectedServiceId(serviceId: string): Promise<Booking[]> {
    const allBookings = await this.getBookingAnalyticsRows();
    return allBookings.filter((booking) => booking.selectedServices.includes(serviceId));
  }

  async getBooking(id: string): Promise<Booking | undefined> {
    return (await this.getBookingAnalyticsRows()).find((booking) => booking.id === id);
  }

  async createBooking(
    data: ServerBooking & Partial<Pick<Booking, "paymentStatus" | "paymentProvider" | "paymentReference" | "paymentSessionId" | "paymentCurrency" | "paymentAmount" | "paymentCheckoutAmount" | "paymentDepositAmount" | "paymentAmountPaid" | "paymentHoldExpiresAt" | "paidAt" | "paymentFailedAt">>,
  ): Promise<Booking> {
    await this.ensurePaymentsTables();
    const now = new Date().toISOString();
    const columns = await this.getTableColumns("bookings");
    const filteredData = this.filterBookingWriteData({ ...data, createdAt: now }, columns);
    const [created] = await db
      .insert(bookings)
      .values(filteredData as typeof bookings.$inferInsert)
      .returning({ id: bookings.id });
    const booking = await this.getBooking(created.id);
    if (!booking) {
      throw new Error("Booking was created but could not be reloaded.");
    }
    return booking;
  }

  async updateBooking(
    id: string,
    data: Partial<InsertBooking> & Partial<Pick<Booking, "paymentStatus" | "paymentProvider" | "paymentReference" | "paymentSessionId" | "paymentCurrency" | "paymentAmount" | "paymentCheckoutAmount" | "paymentDepositAmount" | "paymentAmountPaid" | "paymentHoldExpiresAt" | "paidAt" | "paymentFailedAt">>,
  ): Promise<Booking | undefined> {
    await this.ensurePaymentsTables();
    const columns = await this.getTableColumns("bookings");
    const filteredData = this.filterBookingWriteData(data, columns);
    const [updated] = await db
      .update(bookings)
      .set(filteredData)
      .where(eq(bookings.id, id))
      .returning({ id: bookings.id });
    if (!updated) {
      return undefined;
    }
    await this.syncBookingServiceAssignments({ bookingIds: [updated.id] });
    await this.syncBookingPayouts({ bookingIds: [updated.id], skipAssignmentSync: true });
    return await this.getBooking(updated.id);
  }

  async updateBookingPaymentState(
    id: string,
    data: Partial<Pick<Booking, "paymentStatus" | "paymentProvider" | "paymentReference" | "paymentSessionId" | "paymentCurrency" | "paymentAmount" | "paymentCheckoutAmount" | "paymentDepositAmount" | "paymentAmountPaid" | "paymentHoldExpiresAt" | "paidAt" | "paymentFailedAt">>,
  ): Promise<Booking | undefined> {
    await this.ensurePaymentsTables();
    const columns = await this.getTableColumns("bookings");
    const filteredData = this.filterBookingWriteData(data, columns);
    const [updated] = await db
      .update(bookings)
      .set(filteredData)
      .where(eq(bookings.id, id))
      .returning({ id: bookings.id });
    if (!updated) {
      return undefined;
    }
    return await this.getBooking(updated.id);
  }

  async deleteBooking(id: string): Promise<boolean> {
    const result = await db.delete(bookings).where(eq(bookings.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getBookingMessages(bookingId: string): Promise<BookingMessage[]> {
    return await db
      .select()
      .from(bookingMessages)
      .where(eq(bookingMessages.bookingId, bookingId))
      .orderBy(asc(bookingMessages.createdAt));
  }

  async createBookingMessage(data: InsertBookingMessage & { userId: string; senderRole: string }): Promise<BookingMessage> {
    await this.ensureInboxTables();
    const now = new Date().toISOString();
    const [message] = await db.insert(bookingMessages).values({ ...data, createdAt: now }).returning();
    await this.createBookingMessageInboxItems(message);
    return message;
  }

  private async getProviderWorkflowCatalog(): Promise<ProviderFinancialCatalog> {
    const [allStays, allCars, allCooks, allErrands, allExperiences, providerUsers] = await Promise.all([
      this.getStays(),
      this.getCars(),
      this.getCooks(),
      this.getErrands(),
      this.getExperiences(),
      this.getUsersByRole("provider"),
    ]);

    return {
      staysById: new Map(allStays.map((stay) => [stay.id, stay])),
      carsById: new Map(allCars.map((car) => [car.id, car])),
      cooksById: new Map(allCooks.map((cook) => [cook.id, cook])),
      errandsById: new Map(allErrands.map((errand) => [errand.id, errand])),
      experiencesById: new Map(allExperiences.map((experience) => [experience.id, experience])),
      providerUsersById: new Map(providerUsers.map((user) => [user.id, user])),
    };
  }

  private getDefaultAssignmentStatus(booking: Booking): BookingServiceAssignmentStatus {
    if (booking.status === "in-progress" || booking.status === "completed" || booking.status === "cancelled") {
      return booking.status;
    }

    return "upcoming";
  }

  private async createProviderAssignmentNotification(
    userId: string,
    booking: Booking,
    assignmentId: string,
    serviceName: string,
    type: "assignment-created" | "assignment-reassigned",
  ) {
    const now = new Date().toISOString();
    const bookingWindow = booking.checkOut && booking.checkOut !== booking.checkIn
      ? `${booking.checkIn} to ${booking.checkOut}`
      : booking.checkIn;
    return await this.createInboxItem({
      userId,
      bookingId: booking.id,
      assignmentId,
      type,
      title: type === "assignment-reassigned" ? `Reassigned: ${serviceName}` : `New assignment: ${serviceName}`,
      body: `${booking.guestName} needs ${serviceName} on ${bookingWindow}.`,
      priority: "high",
      channels: ["in-app", "push"],
      metadata: {
        serviceName,
        guestName: booking.guestName,
      },
    });
  }

  private async updateInboxPushDeliveryState(
    item: AppInboxItem,
    status: "pending" | "delivered" | "failed" | "suppressed",
    error?: string | null,
  ) {
    await this.ensureInboxTables();
    const now = new Date().toISOString();
    const nextDeliveryState: AppInboxDeliveryState = {
      ...(item.deliveryState ?? {}),
      push: {
        status,
        updatedAt: now,
        error: error ?? null,
      },
    };

    const [updatedItem] = await db
      .update(appInboxItems)
      .set({
        deliveryState: nextDeliveryState,
        updatedAt: now,
      })
      .where(eq(appInboxItems.id, item.id))
      .returning();

    return updatedItem ?? {
      ...item,
      deliveryState: nextDeliveryState,
      updatedAt: now,
    };
  }

  private async deliverPushForInboxItem(item: AppInboxItem): Promise<AppInboxItem> {
    if (!item.channels.includes("push")) {
      return item;
    }

    await this.ensurePushTables();
    const preferences = await this.getUserPushPreferences(item.userId);
    if (!preferences.pushEnabled) {
      return await this.updateInboxPushDeliveryState(item, "suppressed", "Push is disabled in user preferences.");
    }

    if (item.type === "booking-message" && !preferences.bookingMessages) {
      return await this.updateInboxPushDeliveryState(item, "suppressed", "Booking message push is disabled.");
    }

    if (item.type !== "booking-message" && !preferences.assignmentAlerts) {
      return await this.updateInboxPushDeliveryState(item, "suppressed", "Assignment alert push is disabled.");
    }

    const activeDevices = await this.getUserPushDevices(item.userId);
    if (activeDevices.length === 0) {
      return await this.updateInboxPushDeliveryState(item, "suppressed", "No active push subscriptions are registered.");
    }

    let deliveredCount = 0;
    let lastError: string | null = null;

    for (const device of activeDevices) {
      const result = await sendWebPushNotification(device.subscription, item);
      const now = new Date().toISOString();
      const nextDeviceUpdate: Partial<UserPushDevice> = {
        updatedAt: now,
      };

      if (result.status === "delivered") {
        deliveredCount += 1;
        nextDeviceUpdate.lastPushSentAt = now;
        nextDeviceUpdate.lastPushFailedAt = null;
        nextDeviceUpdate.lastPushError = null;
      } else if (result.status === "failed") {
        lastError = result.error ?? "Push delivery failed.";
        nextDeviceUpdate.lastPushFailedAt = now;
        nextDeviceUpdate.lastPushError = lastError;
        if (result.deactivateSubscription) {
          nextDeviceUpdate.isActive = false;
        }
      }

      await db
        .update(userPushDevices)
        .set(nextDeviceUpdate)
        .where(eq(userPushDevices.id, device.id));
    }

    if (deliveredCount > 0) {
      return await this.updateInboxPushDeliveryState(item, "delivered", null);
    }

    return await this.updateInboxPushDeliveryState(item, "failed", lastError ?? "Push delivery failed.");
  }

  private async createInboxItem(data: {
    userId: string;
    actorUserId?: string | null;
    actorRole?: string | null;
    bookingId?: string | null;
    assignmentId?: string | null;
    threadKey?: string | null;
    type: AppInboxItemType;
    title: string;
    body: string;
    actionUrl?: string | null;
    priority?: AppInboxPriority;
    channels?: AppInboxDeliveryChannel[] | null;
    metadata?: AppInboxMetadata | null;
  }): Promise<AppInboxItem> {
    await this.ensureInboxTables();
    await this.ensurePushTables();
    const now = new Date().toISOString();
    const channels = normalizeAppInboxChannels(data.channels);
    const recipientUser = data.actionUrl ? null : await this.getUser(data.userId);
    const actionUrl = data.actionUrl ?? buildInboxWorkspaceUrl({
      type: data.type,
      threadKey: data.threadKey ?? null,
      bookingId: data.bookingId ?? null,
      assignmentId: data.assignmentId ?? null,
    }, recipientUser?.role ?? null) ?? buildAppInboxActionUrl({
      type: data.type,
      threadKey: data.threadKey ?? null,
      bookingId: data.bookingId ?? null,
      assignmentId: data.assignmentId ?? null,
    });
    const [item] = await db.insert(appInboxItems).values({
      userId: data.userId,
      actorUserId: data.actorUserId ?? null,
      actorRole: data.actorRole ?? null,
      bookingId: data.bookingId ?? null,
      assignmentId: data.assignmentId ?? null,
      threadKey: data.threadKey ?? null,
      type: data.type,
      title: data.title,
      body: data.body,
      actionUrl,
      priority: getAppInboxPriority(data.priority),
      channels,
      deliveryState: buildInboxDeliveryState(channels, now),
      metadata: data.metadata ?? {},
      isRead: false,
      readAt: null,
      createdAt: now,
      updatedAt: now,
    }).returning();

    return await this.deliverPushForInboxItem(item);
  }

  private async createBookingMessageInboxItems(message: BookingMessage) {
    const booking = await this.getBooking(message.bookingId);
    if (!booking) {
      return [];
    }

    const [assignments, sender] = await Promise.all([
      this.getBookingServiceAssignmentsByBookingId(message.bookingId),
      this.getUser(message.userId),
    ]);
    const threadKey = buildBookingInboxThreadKey(message.bookingId);
    const senderLabel = [sender?.firstName, sender?.lastName].filter(Boolean).join(" ").trim() || getInboxSenderRoleLabel(message.senderRole);
    const messageExcerpt = getInboxMessageExcerpt(message.message);
    const recipients = new Map<string, { assignmentId: string | null }>();

    if (booking.userId && booking.userId !== message.userId) {
      recipients.set(booking.userId, { assignmentId: null });
    }

    for (const assignment of assignments) {
      if (!assignment.providerUserId || assignment.providerUserId === message.userId) {
        continue;
      }

      if (!recipients.has(assignment.providerUserId)) {
        recipients.set(assignment.providerUserId, { assignmentId: assignment.id });
      }
    }

    const createdItems: AppInboxItem[] = [];
    for (const [recipientUserId, recipientContext] of Array.from(recipients.entries())) {
      createdItems.push(await this.createInboxItem({
        userId: recipientUserId,
        actorUserId: message.userId,
        actorRole: message.senderRole,
        bookingId: message.bookingId,
        assignmentId: recipientContext.assignmentId,
        threadKey,
        type: "booking-message",
        title: `New message from ${getInboxSenderRoleLabel(message.senderRole)}`,
        body: `${senderLabel}: ${messageExcerpt}`,
        priority: "normal",
        channels: ["in-app", "push"],
        metadata: {
          bookingId: message.bookingId,
          senderRole: message.senderRole,
          senderName: senderLabel,
        },
      }));
    }

    return createdItems;
  }

  async syncBookingServiceAssignments(options?: { bookingIds?: string[]; notifyProviders?: boolean }): Promise<{ created: number; updated: number; cancelled: number }> {
    await this.ensureProviderWorkflowTables();

    const bookingFilter = options?.bookingIds?.length ? new Set(options.bookingIds) : null;
    const notifyProviders = options?.notifyProviders === true;
    const [allBookings, catalog, existingAssignments] = await Promise.all([
      this.getBookingAnalyticsRows(),
      this.getProviderWorkflowCatalog(),
      db.select().from(bookingServiceAssignments),
    ]);

    const bookingsToSync = bookingFilter
      ? allBookings.filter((booking) => bookingFilter.has(booking.id))
      : allBookings;
    const existingAssignmentMap = new Map(
      existingAssignments.map((assignment) => [
        `${assignment.bookingId}:${assignment.providerCategory}:${assignment.serviceId}`,
        assignment,
      ]),
    );
    const candidateKeys = new Set<string>();
    let created = 0;
    let updated = 0;
    let cancelled = 0;

    for (const booking of bookingsToSync) {
      const desiredAssignments = shouldSyncProviderAssignmentsForBooking(booking)
        ? getDesiredBookingAssignments(booking, catalog)
        : [];
      const defaultStatus = this.getDefaultAssignmentStatus(booking);

      for (const desiredAssignment of desiredAssignments) {
        const key = `${booking.id}:${desiredAssignment.providerCategory}:${desiredAssignment.serviceId}`;
        const existingAssignment = existingAssignmentMap.get(key);
        const now = new Date().toISOString();
        candidateKeys.add(key);

        const nextStatus: BookingServiceAssignmentStatus = !existingAssignment
          ? defaultStatus
          : booking.status === "cancelled"
            ? "cancelled"
            : booking.status === "completed"
              ? "completed"
              : existingAssignment.status === "cancelled"
                ? defaultStatus
                : (isBookingServiceAssignmentStatus(existingAssignment.status) ? existingAssignment.status : defaultStatus);

        if (!existingAssignment) {
          const [createdAssignment] = await db.insert(bookingServiceAssignments).values({
            bookingId: booking.id,
            providerUserId: desiredAssignment.providerUserId,
            providerCategory: desiredAssignment.providerCategory,
            serviceId: desiredAssignment.serviceId,
            serviceName: desiredAssignment.serviceName,
            serviceConfig: desiredAssignment.serviceConfig,
            grossAmount: Math.max(0, desiredAssignment.grossAmount),
            status: nextStatus,
            createdAt: now,
            updatedAt: now,
          }).returning();
          created += 1;

          if (notifyProviders && desiredAssignment.providerUserId) {
            await this.createProviderAssignmentNotification(
              desiredAssignment.providerUserId,
              booking,
              createdAssignment.id,
              desiredAssignment.serviceName,
              "assignment-created",
            );
          }
          continue;
        }

        const providerChanged = existingAssignment.providerUserId !== desiredAssignment.providerUserId;
        const shouldUpdate = providerChanged
          || existingAssignment.serviceName !== desiredAssignment.serviceName
          || JSON.stringify(existingAssignment.serviceConfig ?? {}) !== JSON.stringify(desiredAssignment.serviceConfig)
          || Number(existingAssignment.grossAmount ?? 0) !== Math.max(0, desiredAssignment.grossAmount)
          || existingAssignment.status !== nextStatus;

        if (shouldUpdate) {
          const [updatedAssignment] = await db.update(bookingServiceAssignments).set({
            providerUserId: desiredAssignment.providerUserId,
            serviceName: desiredAssignment.serviceName,
            serviceConfig: desiredAssignment.serviceConfig,
            grossAmount: Math.max(0, desiredAssignment.grossAmount),
            status: nextStatus,
            updatedAt: now,
          }).where(eq(bookingServiceAssignments.id, existingAssignment.id)).returning();
          updated += 1;

          if (notifyProviders && providerChanged && desiredAssignment.providerUserId) {
            await this.createProviderAssignmentNotification(
              desiredAssignment.providerUserId,
              booking,
              updatedAssignment.id,
              desiredAssignment.serviceName,
              "assignment-reassigned",
            );
          }
        }
      }
    }

    const assignmentsToConsider = bookingFilter
      ? existingAssignments.filter((assignment) => bookingFilter.has(assignment.bookingId))
      : existingAssignments;

    for (const existingAssignment of assignmentsToConsider) {
      const key = `${existingAssignment.bookingId}:${existingAssignment.providerCategory}:${existingAssignment.serviceId}`;
      if (candidateKeys.has(key) || existingAssignment.status === "cancelled") {
        continue;
      }

      await db.update(bookingServiceAssignments).set({
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      }).where(eq(bookingServiceAssignments.id, existingAssignment.id));
      cancelled += 1;
    }

    return { created, updated, cancelled };
  }

  async getBookingServiceAssignments(): Promise<BookingServiceAssignment[]> {
    await this.ensureProviderWorkflowTables();
    return await db.select().from(bookingServiceAssignments).orderBy(desc(bookingServiceAssignments.createdAt));
  }

  async getBookingServiceAssignmentsByBookingId(bookingId: string): Promise<BookingServiceAssignment[]> {
    await this.ensureProviderWorkflowTables();
    return await db
      .select()
      .from(bookingServiceAssignments)
      .where(eq(bookingServiceAssignments.bookingId, bookingId))
      .orderBy(asc(bookingServiceAssignments.createdAt));
  }

  async updateBookingServiceAssignmentStatus(id: string, status: BookingServiceAssignmentStatus): Promise<BookingServiceAssignment | undefined> {
    await this.ensureProviderWorkflowTables();
    const [updatedAssignment] = await db
      .update(bookingServiceAssignments)
      .set({
        status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(bookingServiceAssignments.id, id))
      .returning();
    return updatedAssignment;
  }

  async getUserInbox(userId: string): Promise<AppInboxItem[]> {
    await this.ensureInboxTables();

    return await db
      .select()
      .from(appInboxItems)
      .where(eq(appInboxItems.userId, userId))
      .orderBy(desc(appInboxItems.createdAt));
  }

  async markInboxItemRead(id: string, userId: string): Promise<AppInboxItem | undefined> {
    await this.ensureInboxTables();
    const now = new Date().toISOString();
    const [updatedItem] = await db
      .update(appInboxItems)
      .set({
        isRead: true,
        readAt: now,
        updatedAt: now,
      })
      .where(and(eq(appInboxItems.id, id), eq(appInboxItems.userId, userId)))
      .returning();

    return updatedItem;
  }

  async markInboxItemsRead(userId: string, options?: {
    itemIds?: string[];
    threadKeys?: string[];
    scope?: "all" | "messages" | "alerts";
  }): Promise<number> {
    await this.ensureInboxTables();

    const normalizedItemIds = Array.from(new Set(
      (options?.itemIds ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ));
    const normalizedThreadKeys = Array.from(new Set(
      (options?.threadKeys ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ));
    const scope = options?.scope ?? "all";

    const unreadItems = await db
      .select({
        id: appInboxItems.id,
        threadKey: appInboxItems.threadKey,
        type: appInboxItems.type,
      })
      .from(appInboxItems)
      .where(
        and(
          eq(appInboxItems.userId, userId),
          eq(appInboxItems.isRead, false),
        ),
      );

    const matchingIds = unreadItems
      .filter((item) => {
        if (normalizedItemIds.length || normalizedThreadKeys.length) {
          return normalizedItemIds.includes(item.id)
            || (item.threadKey ? normalizedThreadKeys.includes(item.threadKey) : false);
        }

        if (scope === "messages") {
          return item.type === "booking-message";
        }

        if (scope === "alerts") {
          return item.type !== "booking-message";
        }

        return true;
      })
      .map((item) => item.id);

    if (matchingIds.length === 0) {
      return 0;
    }

    const now = new Date().toISOString();
    const updatedItems = await db
      .update(appInboxItems)
      .set({
        isRead: true,
        readAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(appInboxItems.userId, userId),
          inArray(appInboxItems.id, matchingIds),
        ),
      )
      .returning({ id: appInboxItems.id });

    return updatedItems.length;
  }

  async markInboxItemsReadByThread(userId: string, threadKey: string): Promise<number> {
    const normalizedThreadKey = threadKey.trim();
    if (!normalizedThreadKey) {
      return 0;
    }

    return this.markInboxItemsRead(userId, { threadKeys: [normalizedThreadKey] });
  }

  async getUserPushDevices(userId: string): Promise<UserPushDevice[]> {
    await this.ensurePushTables();
    return await db
      .select()
      .from(userPushDevices)
      .where(and(eq(userPushDevices.userId, userId), eq(userPushDevices.isActive, true)))
      .orderBy(desc(userPushDevices.updatedAt));
  }

  async upsertUserPushDevice(userId: string, device: InsertUserPushDevice): Promise<UserPushDevice> {
    await this.ensurePushTables();
    const now = new Date().toISOString();
    const normalizedEndpoint = device.subscription.endpoint.trim();
    const existingDevice = await db
      .select()
      .from(userPushDevices)
      .where(eq(userPushDevices.endpoint, normalizedEndpoint))
      .limit(1);

    if (existingDevice[0]) {
      const [updatedDevice] = await db
        .update(userPushDevices)
        .set({
          userId,
          platform: device.platform ?? "web",
          provider: device.provider ?? "web-push",
          subscription: {
            ...device.subscription,
            endpoint: normalizedEndpoint,
          },
          deviceInfo: device.deviceInfo ?? {},
          permission: device.permission ?? "granted",
          isActive: true,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(userPushDevices.id, existingDevice[0].id))
        .returning();
      return updatedDevice;
    }

    const [createdDevice] = await db
      .insert(userPushDevices)
      .values({
        userId,
        platform: device.platform ?? "web",
        provider: device.provider ?? "web-push",
        endpoint: normalizedEndpoint,
        subscription: {
          ...device.subscription,
          endpoint: normalizedEndpoint,
        },
        deviceInfo: device.deviceInfo ?? {},
        permission: device.permission ?? "granted",
        isActive: true,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return createdDevice;
  }

  async unregisterUserPushDevice(userId: string, endpoint: string): Promise<number> {
    await this.ensurePushTables();
    const normalizedEndpoint = endpoint.trim();
    if (!normalizedEndpoint) {
      return 0;
    }

    const now = new Date().toISOString();
    const updatedDevices = await db
      .update(userPushDevices)
      .set({
        isActive: false,
        updatedAt: now,
      })
      .where(and(eq(userPushDevices.userId, userId), eq(userPushDevices.endpoint, normalizedEndpoint)))
      .returning({ id: userPushDevices.id });

    return updatedDevices.length;
  }

  async getUserPushPreferences(userId: string): Promise<UserPushPreferences> {
    await this.ensurePushTables();
    const [existingPreferences] = await db
      .select()
      .from(userPushPreferences)
      .where(eq(userPushPreferences.userId, userId))
      .limit(1);

    if (existingPreferences) {
      return existingPreferences;
    }

    const now = new Date().toISOString();
    const [createdPreferences] = await db
      .insert(userPushPreferences)
      .values({
        userId,
        pushEnabled: true,
        bookingMessages: true,
        assignmentAlerts: true,
        marketingEnabled: false,
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return createdPreferences;
  }

  async updateUserPushPreferences(userId: string, update: UpdateUserPushPreferences): Promise<UserPushPreferences> {
    await this.ensurePushTables();
    const currentPreferences = await this.getUserPushPreferences(userId);
    const now = new Date().toISOString();
    const [updatedPreferences] = await db
      .update(userPushPreferences)
      .set({
        pushEnabled: update.pushEnabled ?? currentPreferences.pushEnabled,
        bookingMessages: update.bookingMessages ?? currentPreferences.bookingMessages,
        assignmentAlerts: update.assignmentAlerts ?? currentPreferences.assignmentAlerts,
        marketingEnabled: update.marketingEnabled ?? currentPreferences.marketingEnabled,
        quietHoursStart: typeof update.quietHoursStart === "string" ? update.quietHoursStart.trim() || null : update.quietHoursStart ?? currentPreferences.quietHoursStart,
        quietHoursEnd: typeof update.quietHoursEnd === "string" ? update.quietHoursEnd.trim() || null : update.quietHoursEnd ?? currentPreferences.quietHoursEnd,
        updatedAt: now,
      })
      .where(eq(userPushPreferences.userId, userId))
      .returning();

    return updatedPreferences;
  }

  async createPushTestNotification(userId: string): Promise<AppInboxItem> {
    await this.ensurePushTables();
    return await this.createInboxItem({
      userId,
      type: "assignment-updated",
      title: "Test notification",
      body: "Local push test from your inbox. Tap to open the notification center.",
      priority: "high",
      channels: ["in-app", "push"],
      actionUrl: "/inbox?view=alerts",
      metadata: {
        source: "push-test",
      },
    });
  }

  getPushPublicConfig() {
    return getWebPushPublicConfig();
  }

  async getProviderNotifications(userId: string): Promise<ProviderNotification[]> {
    const inboxItems = await this.getUserInbox(userId);
    return inboxItems
      .filter((item) => item.assignmentId && isAppInboxItemType(item.type) && item.type !== "booking-message")
      .map(toProviderNotification);
  }

  async markProviderNotificationRead(id: string, userId: string): Promise<ProviderNotification | undefined> {
    const updatedNotification = await this.markInboxItemRead(id, userId);
    return updatedNotification ? toProviderNotification(updatedNotification) : undefined;
  }

  // Blog Posts
  async getBlogPosts(): Promise<BlogPost[]> {
    return await this.selectCompatibleBlogPosts('ORDER BY "updatedAt" DESC NULLS LAST');
  }

  async getPublishedBlogPosts(): Promise<BlogPost[]> {
    return await this.selectCompatibleBlogPosts(
      'WHERE status = $1 ORDER BY "publishedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST',
      ["published"],
    );
  }

  async getBlogPost(id: string): Promise<BlogPost | undefined> {
    const [blogPost] = await this.selectCompatibleBlogPosts("WHERE id = $1 LIMIT 1", [id]);
    return blogPost;
  }

  async getBlogPostBySlug(slug: string): Promise<BlogPost | undefined> {
    const [blogPost] = await this.selectCompatibleBlogPosts("WHERE slug = $1 LIMIT 1", [slug]);
    return blogPost;
  }

  async createBlogPost(data: InsertBlogPost): Promise<BlogPost> {
    await this.ensureMarketingTables();
    const now = new Date().toISOString();
    let publishedAt = data.publishedAt;
    
    // Auto-set publishedAt if status is "published" and publishedAt is not provided
    if (data.status === 'published' && !publishedAt) {
      publishedAt = now;
    }

    const [blogPost] = await db.insert(blogPosts).values({
      ...data,
      featuredImageAlt: data.featuredImageAlt?.trim() || data.title,
      seoTitle: data.seoTitle?.trim() || data.title,
      seoDescription: data.seoDescription?.trim() || data.excerpt,
      seoKeywords: data.seoKeywords?.trim() || null,
      primaryCtaLabel: data.primaryCtaLabel?.trim() || null,
      primaryCtaHref: data.primaryCtaHref?.trim() || null,
      primaryPromoCode: data.primaryPromoCode?.trim().toUpperCase() || null,
      publishedAt,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return blogPost;
  }

  async updateBlogPost(id: string, data: Partial<InsertBlogPost>): Promise<BlogPost | undefined> {
    await this.ensureMarketingTables();
    const now = new Date().toISOString();
    
    // Auto-set publishedAt when changing status to "published" if not already set
    let updateData: Partial<InsertBlogPost> & { updatedAt: string } = {
      ...data,
      updatedAt: now,
    };
    if (data.status === 'published' && !data.publishedAt) {
      const existing = await this.getBlogPost(id);
      if (existing && !existing.publishedAt) {
        updateData.publishedAt = now;
      }
    }

    const existing = await this.getBlogPost(id);
    if (data.title !== undefined || data.featuredImageAlt !== undefined) {
      updateData.featuredImageAlt = data.featuredImageAlt?.trim() || data.title?.trim() || existing?.featuredImageAlt || existing?.title || null;
    }
    if (data.title !== undefined || data.seoTitle !== undefined) {
      updateData.seoTitle = data.seoTitle?.trim() || data.title?.trim() || existing?.seoTitle || existing?.title || null;
    }
    if (data.excerpt !== undefined || data.seoDescription !== undefined) {
      updateData.seoDescription = data.seoDescription?.trim() || data.excerpt?.trim() || existing?.seoDescription || existing?.excerpt || null;
    }
    if (data.seoKeywords !== undefined) {
      updateData.seoKeywords = data.seoKeywords?.trim() || null;
    }
    if (data.primaryCtaLabel !== undefined) {
      updateData.primaryCtaLabel = data.primaryCtaLabel?.trim() || null;
    }
    if (data.primaryCtaHref !== undefined) {
      updateData.primaryCtaHref = data.primaryCtaHref?.trim() || null;
    }
    if (data.primaryPromoCode !== undefined) {
      updateData.primaryPromoCode = data.primaryPromoCode?.trim().toUpperCase() || null;
    }

    const [blogPost] = await db.update(blogPosts).set(updateData).where(eq(blogPosts.id, id)).returning();
    return blogPost;
  }

  async deleteBlogPost(id: string): Promise<boolean> {
    await this.ensureMarketingTables();
    const result = await db.delete(blogPosts).where(eq(blogPosts.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Marketing Promos
  async getMarketingPromos(): Promise<MarketingPromo[]> {
    await this.ensureMarketingTables();
    return await db.select().from(marketingPromos).orderBy(desc(marketingPromos.updatedAt), asc(marketingPromos.name));
  }

  async getMarketingPromo(id: string): Promise<MarketingPromo | undefined> {
    await this.ensureMarketingTables();
    const [promo] = await db.select().from(marketingPromos).where(eq(marketingPromos.id, id));
    return promo;
  }

  async getMarketingPromoByCode(code: string): Promise<MarketingPromo | undefined> {
    await this.ensureMarketingTables();
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      return undefined;
    }

    const [promo] = await db.select().from(marketingPromos).where(eq(marketingPromos.code, normalizedCode));
    return promo;
  }

  async createMarketingPromo(data: InsertMarketingPromo): Promise<MarketingPromo> {
    await this.ensureMarketingTables();
    const now = new Date().toISOString();
    const normalized = normalizeMarketingPromoInput(data);
    const [promo] = await db.insert(marketingPromos).values({
      ...normalized,
      discountPercent: normalized.promoType === "percent" ? normalized.discountPercent ?? null : null,
      discountAmount: normalized.promoType === "percent" ? null : normalized.discountAmount ?? null,
      bundleLabel: normalized.promoType === "bundle" ? normalized.bundleLabel ?? null : null,
      costAbsorption: normalized.costAbsorption ?? "shared",
      eligibleCategories: normalized.eligibleCategories ?? [],
      autoApply: normalized.autoApply ?? false,
      requiredCategories: normalized.requiredCategories ?? [],
      minimumNights: normalized.minimumNights ?? null,
      minimumGuests: normalized.minimumGuests ?? null,
      minimumServiceCount: normalized.minimumServiceCount ?? null,
      redemptionCount: normalized.redemptionCount ?? 0,
      attributedRevenue: normalized.attributedRevenue ?? 0,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return promo;
  }

  async updateMarketingPromo(id: string, data: UpdateMarketingPromo): Promise<MarketingPromo | undefined> {
    await this.ensureMarketingTables();
    const existing = await this.getMarketingPromo(id);
    if (!existing) {
      return undefined;
    }

    const now = new Date().toISOString();
    const normalized = normalizeMarketingPromoInput(data);
    const nextPromoType = normalized.promoType ?? existing.promoType;

    const [promo] = await db.update(marketingPromos).set({
      ...normalized,
      discountPercent: nextPromoType === "percent"
        ? (normalized.discountPercent !== undefined ? normalized.discountPercent : existing.discountPercent)
        : null,
      discountAmount: nextPromoType === "percent"
        ? null
        : (normalized.discountAmount !== undefined ? normalized.discountAmount : existing.discountAmount),
      bundleLabel: nextPromoType === "bundle"
        ? (normalized.bundleLabel !== undefined ? normalized.bundleLabel : existing.bundleLabel)
        : null,
      costAbsorption: normalized.costAbsorption ?? existing.costAbsorption,
      eligibleCategories: normalized.eligibleCategories ?? existing.eligibleCategories,
      autoApply: normalized.autoApply ?? existing.autoApply,
      requiredCategories: normalized.requiredCategories ?? existing.requiredCategories,
      minimumNights: normalized.minimumNights !== undefined ? normalized.minimumNights : existing.minimumNights,
      minimumGuests: normalized.minimumGuests !== undefined ? normalized.minimumGuests : existing.minimumGuests,
      minimumServiceCount: normalized.minimumServiceCount !== undefined ? normalized.minimumServiceCount : existing.minimumServiceCount,
      redemptionCount: normalized.redemptionCount ?? existing.redemptionCount,
      attributedRevenue: normalized.attributedRevenue ?? existing.attributedRevenue,
      updatedAt: now,
    }).where(eq(marketingPromos.id, id)).returning();

    return promo;
  }

  async deleteMarketingPromo(id: string): Promise<boolean> {
    await this.ensureMarketingTables();
    const result = await db.delete(marketingPromos).where(eq(marketingPromos.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async recordMarketingPromoRedemption(promoId: string, revenue: number): Promise<MarketingPromo | undefined> {
    await this.ensureMarketingTables();
    const existing = await this.getMarketingPromo(promoId);
    if (!existing) {
      return undefined;
    }

    const [updated] = await db.update(marketingPromos).set({
      redemptionCount: Math.max(0, existing.redemptionCount + 1),
      attributedRevenue: Math.max(0, existing.attributedRevenue + Math.max(0, revenue)),
      updatedAt: new Date().toISOString(),
    }).where(eq(marketingPromos.id, promoId)).returning();

    return updated;
  }

  async createMarketingAttributionEvent(event: InsertMarketingAttributionEvent): Promise<MarketingAttributionEvent> {
    await this.ensureMarketingTables();
    const now = new Date().toISOString();
    const [created] = await db.insert(marketingAttributionEvents).values({
      ...event,
      sessionId: event.sessionId.trim(),
      sourceId: event.sourceId ?? null,
      sourceSlug: event.sourceSlug ?? null,
      sourcePath: event.sourcePath ?? null,
      sourceTitle: event.sourceTitle ?? null,
      promoCode: event.promoCode ?? null,
      landingPath: event.landingPath ?? null,
      referrerPath: event.referrerPath ?? null,
      entryPath: event.entryPath ?? null,
      utmSource: event.utmSource ?? null,
      utmMedium: event.utmMedium ?? null,
      utmCampaign: event.utmCampaign ?? null,
      utmContent: event.utmContent ?? null,
      createdAt: now,
    }).returning();

    return created;
  }

  async getBookingAttributionsByBookingIds(bookingIds: string[]): Promise<BookingAttribution[]> {
    await this.ensureMarketingTables();

    const uniqueBookingIds = Array.from(new Set(bookingIds.filter(Boolean)));
    if (uniqueBookingIds.length === 0) {
      return [];
    }

    return await db
      .select()
      .from(bookingAttributions)
      .where(inArray(bookingAttributions.bookingId, uniqueBookingIds));
  }

  async createBookingAttribution(
    bookingId: string,
    attribution: MarketingAttributionPayload & {
      promoId?: string | null;
      promoName?: string | null;
      promoCostAbsorption?: MarketingPromoCostAbsorption | null;
      originalSubtotal: number;
      discountAmount: number;
      finalRevenue: number;
    },
  ): Promise<BookingAttribution> {
    await this.ensureMarketingTables();
    const now = new Date().toISOString();
    const payload = {
      bookingId,
      sessionId: attribution.sessionId?.trim() || null,
      sourceType: attribution.sourceType ?? "direct",
      sourceId: attribution.sourceId ?? null,
      sourceSlug: attribution.sourceSlug ?? null,
      sourcePath: attribution.sourcePath ?? null,
      sourceTitle: attribution.sourceTitle ?? null,
      promoId: attribution.promoId ?? null,
      promoCode: attribution.promoCode ?? null,
      promoName: attribution.promoName ?? null,
      promoCostAbsorption: attribution.promoCostAbsorption ?? null,
      landingPath: attribution.landingPath ?? null,
      referrerPath: attribution.referrerPath ?? null,
      entryPath: attribution.entryPath ?? null,
      utmSource: attribution.utmSource ?? null,
      utmMedium: attribution.utmMedium ?? null,
      utmCampaign: attribution.utmCampaign ?? null,
      utmContent: attribution.utmContent ?? null,
      originalSubtotal: Math.max(0, Math.round(attribution.originalSubtotal || 0)),
      discountAmount: Math.max(0, Math.round(attribution.discountAmount || 0)),
      finalRevenue: Math.max(0, Math.round(attribution.finalRevenue || 0)),
      updatedAt: now,
    };

    const existing = await db.select().from(bookingAttributions).where(eq(bookingAttributions.bookingId, bookingId)).limit(1);
    if (existing.length > 0) {
      const [updated] = await db.update(bookingAttributions).set(payload).where(eq(bookingAttributions.bookingId, bookingId)).returning();
      return updated;
    }

    const [created] = await db.insert(bookingAttributions).values({
      ...payload,
      createdAt: now,
    }).returning();

    return created;
  }

  async getMarketingAttributionSummary(): Promise<MarketingAttributionSummary> {
    await this.ensureMarketingTables();
    const [events, attributions] = await Promise.all([
      db.select().from(marketingAttributionEvents),
      db.select().from(bookingAttributions),
    ]);

    const contentMap = new Map<string, MarketingAttributionContentSummary>();
    const promoMap = new Map<string, MarketingAttributionPromoSummary>();

    const upsertContent = (entry: {
      sourceType: string | null;
      sourceId: string | null;
      sourceSlug: string | null;
      sourcePath: string | null;
      sourceTitle: string | null;
    }) => {
      const key = `${entry.sourceType || "direct"}:${entry.sourceId || ""}:${entry.sourcePath || ""}:${entry.sourceSlug || ""}`;
      const existing = contentMap.get(key);
      if (existing) {
        if (!existing.sourceTitle && entry.sourceTitle) {
          existing.sourceTitle = entry.sourceTitle;
        }
        if (!existing.sourceSlug && entry.sourceSlug) {
          existing.sourceSlug = entry.sourceSlug;
        }
        return existing;
      }

      const next: MarketingAttributionContentSummary = {
        sourceId: entry.sourceId ?? null,
        sourceSlug: entry.sourceSlug ?? null,
        sourcePath: entry.sourcePath ?? null,
        sourceTitle: entry.sourceTitle ?? null,
        viewCount: 0,
        clickCount: 0,
        bookingCount: 0,
        revenue: 0,
        discountAmount: 0,
      };
      contentMap.set(key, next);
      return next;
    };

    for (const event of events) {
      const content = upsertContent({
        sourceType: event.sourceType ?? null,
        sourceId: event.sourceId ?? null,
        sourceSlug: event.sourceSlug ?? null,
        sourcePath: event.sourcePath ?? null,
        sourceTitle: event.sourceTitle ?? null,
      });
      if (event.eventType === "view") {
        content.viewCount += 1;
      } else if (event.eventType === "cta-click") {
        content.clickCount += 1;
      }
    }

    for (const attribution of attributions) {
      const content = upsertContent({
        sourceType: attribution.sourceType ?? null,
        sourceId: attribution.sourceId ?? null,
        sourceSlug: attribution.sourceSlug ?? null,
        sourcePath: attribution.sourcePath ?? null,
        sourceTitle: attribution.sourceTitle ?? null,
      });
      content.bookingCount += 1;
      content.revenue += Number(attribution.finalRevenue ?? 0);
      content.discountAmount += Number(attribution.discountAmount ?? 0);

      if (attribution.promoId || attribution.promoCode || attribution.promoName) {
        const promoKey = `${attribution.promoId || ""}:${attribution.promoCode || ""}:${attribution.promoName || ""}`;
        const existingPromo = promoMap.get(promoKey);
        if (existingPromo) {
          existingPromo.bookingCount += 1;
          existingPromo.revenue += Number(attribution.finalRevenue ?? 0);
          existingPromo.discountAmount += Number(attribution.discountAmount ?? 0);
        } else {
          promoMap.set(promoKey, {
            promoId: attribution.promoId ?? null,
            promoName: attribution.promoName || attribution.promoCode || "Campaign",
            promoCode: attribution.promoCode ?? null,
            bookingCount: 1,
            revenue: Number(attribution.finalRevenue ?? 0),
            discountAmount: Number(attribution.discountAmount ?? 0),
          });
        }
      }
    }

    return {
      totalTrackedViews: events.filter((event) => event.eventType === "view").length,
      totalTrackedClicks: events.filter((event) => event.eventType === "cta-click").length,
      totalAttributedBookings: attributions.length,
      totalAttributedRevenue: attributions.reduce((sum, item) => sum + Number(item.finalRevenue ?? 0), 0),
      totalAttributedDiscount: attributions.reduce((sum, item) => sum + Number(item.discountAmount ?? 0), 0),
      topContent: Array.from(contentMap.values())
        .filter((item) => item.viewCount > 0 || item.clickCount > 0 || item.bookingCount > 0)
        .sort((left, right) =>
          right.bookingCount - left.bookingCount
          || right.revenue - left.revenue
          || right.clickCount - left.clickCount
          || right.viewCount - left.viewCount,
        )
        .slice(0, 5),
      topPromos: Array.from(promoMap.values())
        .sort((left, right) =>
          right.bookingCount - left.bookingCount
          || right.revenue - left.revenue
          || right.discountAmount - left.discountAmount,
        )
        .slice(0, 5),
    };
  }

  // Listings
  async getListings(): Promise<Listing[]> {
    return await db.select().from(listings);
  }

  async getListing(id: string): Promise<Listing | undefined> {
    const [listing] = await db.select().from(listings).where(eq(listings.id, id));
    return listing;
  }

  async createListing(data: InsertListing): Promise<Listing> {
    const now = new Date().toISOString();
    const [listing] = await db.insert(listings).values({
      ...data,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return listing;
  }

  async updateListing(id: string, data: Partial<InsertListing>): Promise<Listing | undefined> {
    const now = new Date().toISOString();
    const [listing] = await db.update(listings).set({ ...data, updatedAt: now }).where(eq(listings.id, id)).returning();
    return listing;
  }

  async deleteListing(id: string): Promise<boolean> {
    const result = await db.delete(listings).where(eq(listings.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Stays
  async getStays(): Promise<Stay[]> {
    return await this.selectCompatibleStays();
  }

  async getStay(id: string): Promise<Stay | undefined> {
    const [stay] = await this.selectCompatibleStays("WHERE id = $1 LIMIT 1", [id]);
    return stay;
  }

  async getStaysByManagerUserId(managerUserId: string): Promise<Stay[]> {
    return await db.select().from(stays).where(eq(stays.managerUserId, managerUserId));
  }

  async createStay(data: InsertStay): Promise<Stay> {
    const now = new Date().toISOString();
    const [stay] = await db.insert(stays).values({
      ...normalizeManagerScopedWriteData(data),
      createdAt: now,
      updatedAt: now,
    }).returning();
    return normalizeManagerScopedRecord(stay);
  }

  async updateStay(id: string, data: Partial<InsertStay>): Promise<Stay | undefined> {
    const [stay] = await db.update(stays).set({
      ...normalizeManagerScopedWriteData(data),
      updatedAt: new Date().toISOString(),
    }).where(eq(stays.id, id)).returning();
    return stay ? normalizeManagerScopedRecord(stay) : undefined;
  }

  async deleteStay(id: string): Promise<boolean> {
    const result = await db.delete(stays).where(eq(stays.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Cars
  async getCars(): Promise<Car[]> {
    return await this.selectCompatibleCars();
  }

  async getCar(id: string): Promise<Car | undefined> {
    const [car] = await this.selectCompatibleCars("WHERE id = $1 LIMIT 1", [id]);
    return car;
  }

  async createCar(data: InsertCar): Promise<Car> {
    const now = new Date().toISOString();
    const [car] = await db.insert(cars).values({
      ...normalizeManagerScopedWriteData(data),
      createdAt: now,
      updatedAt: now,
    }).returning();
    return normalizeManagerScopedRecord(car);
  }

  async updateCar(id: string, data: Partial<InsertCar>): Promise<Car | undefined> {
    const [car] = await db.update(cars).set({
      ...normalizeManagerScopedWriteData(data),
      updatedAt: new Date().toISOString(),
    }).where(eq(cars.id, id)).returning();
    return car ? normalizeManagerScopedRecord(car) : undefined;
  }

  async deleteCar(id: string): Promise<boolean> {
    const result = await db.delete(cars).where(eq(cars.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Cooks
  async getCooks(): Promise<Cook[]> {
    return await this.selectCompatibleCooks();
  }

  async getCook(id: string): Promise<Cook | undefined> {
    const [cook] = await this.selectCompatibleCooks("WHERE id = $1 LIMIT 1", [id]);
    return cook;
  }

  async createCook(data: InsertCook): Promise<Cook> {
    const now = new Date().toISOString();
    const [cook] = await db.insert(cooks).values({
      ...normalizeManagerScopedWriteData(data),
      createdAt: now,
      updatedAt: now,
    }).returning();
    return normalizeManagerScopedRecord(cook);
  }

  async updateCook(id: string, data: Partial<InsertCook>): Promise<Cook | undefined> {
    const [cook] = await db.update(cooks).set({
      ...normalizeManagerScopedWriteData(data),
      updatedAt: new Date().toISOString(),
    }).where(eq(cooks.id, id)).returning();
    return cook ? normalizeManagerScopedRecord(cook) : undefined;
  }

  async deleteCook(id: string): Promise<boolean> {
    const result = await db.delete(cooks).where(eq(cooks.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Errands
  async getErrands(): Promise<Errand[]> {
    const columns = await this.getTableColumns("errands");
    const selectParts = [
      "id",
      "service_name AS \"serviceName\"",
      columns.has("location") ? "location" : "''::text AS location",
      "base_price AS \"basePrice\"",
      columns.has("shopping_enabled") ? "shopping_enabled AS \"shoppingEnabled\"" : "false AS \"shoppingEnabled\"",
      columns.has("shopping_commission_percent") ? "shopping_commission_percent AS \"shoppingCommissionPercent\"" : "5 AS \"shoppingCommissionPercent\"",
      columns.has("laundry_enabled") ? "laundry_enabled AS \"laundryEnabled\"" : "false AS \"laundryEnabled\"",
      columns.has("house_cleaning_enabled") ? "house_cleaning_enabled AS \"houseCleaningEnabled\"" : "false AS \"houseCleaningEnabled\"",
      columns.has("laundry_included_kg") ? "laundry_included_kg AS \"laundryIncludedKg\"" : "0 AS \"laundryIncludedKg\"",
      columns.has("laundry_price_per_kg") ? "laundry_price_per_kg AS \"laundryPricePerKg\"" : "0 AS \"laundryPricePerKg\"",
      columns.has("laundry_addons") ? "laundry_addons AS \"laundryAddons\"" : "'[]'::jsonb AS \"laundryAddons\"",
      columns.has("house_cleaning_addons") ? "house_cleaning_addons AS \"houseCleaningAddons\"" : "'[]'::jsonb AS \"houseCleaningAddons\"",
      columns.has("help_mama_pricing") ? "help_mama_pricing AS \"helpMamaPricing\"" : `'{"enabled":false,"hourlyDaytimePrice":0,"hourlyEveningPrice":0,"overnightPrice":0,"fullDayPrice":0,"ageBands":[]}'::jsonb AS "helpMamaPricing"`,
      "description",
      columns.has("rating") ? "rating" : "5 AS rating",
      columns.has("review_count") ? "review_count AS \"reviewCount\"" : "0 AS \"reviewCount\"",
      columns.has("image_url") ? "image_url AS \"imageUrl\"" : "NULL::text AS \"imageUrl\"",
      columns.has("gallery_urls") ? "gallery_urls AS \"galleryUrls\"" : "'{}'::text[] AS \"galleryUrls\"",
      columns.has("media_type") ? "media_type AS \"mediaType\"" : "'image'::varchar AS \"mediaType\"",
      columns.has("is_public") ? "is_public AS \"isPublic\"" : "false AS \"isPublic\"",
      columns.has("manager_user_id") ? "manager_user_id AS \"managerUserId\"" : "NULL::varchar AS \"managerUserId\"",
      columns.has("features") ? "features" : "'{}'::text[] AS features",
      columns.has("created_at") ? "created_at AS \"createdAt\"" : "NULL::text AS \"createdAt\"",
      columns.has("updated_at") ? "updated_at AS \"updatedAt\"" : "NULL::text AS \"updatedAt\"",
    ];

    const result = await pool.query<Errand>(`SELECT ${selectParts.join(", ")} FROM errands`);
    return result.rows.map((errand) => normalizeManagerScopedRecord(errand));
  }

  async getErrand(id: string): Promise<Errand | undefined> {
    const columns = await this.getTableColumns("errands");
    const selectParts = [
      "id",
      "service_name AS \"serviceName\"",
      columns.has("location") ? "location" : "''::text AS location",
      "base_price AS \"basePrice\"",
      columns.has("shopping_enabled") ? "shopping_enabled AS \"shoppingEnabled\"" : "false AS \"shoppingEnabled\"",
      columns.has("shopping_commission_percent") ? "shopping_commission_percent AS \"shoppingCommissionPercent\"" : "5 AS \"shoppingCommissionPercent\"",
      columns.has("laundry_enabled") ? "laundry_enabled AS \"laundryEnabled\"" : "false AS \"laundryEnabled\"",
      columns.has("house_cleaning_enabled") ? "house_cleaning_enabled AS \"houseCleaningEnabled\"" : "false AS \"houseCleaningEnabled\"",
      columns.has("laundry_included_kg") ? "laundry_included_kg AS \"laundryIncludedKg\"" : "0 AS \"laundryIncludedKg\"",
      columns.has("laundry_price_per_kg") ? "laundry_price_per_kg AS \"laundryPricePerKg\"" : "0 AS \"laundryPricePerKg\"",
      columns.has("laundry_addons") ? "laundry_addons AS \"laundryAddons\"" : "'[]'::jsonb AS \"laundryAddons\"",
      columns.has("house_cleaning_addons") ? "house_cleaning_addons AS \"houseCleaningAddons\"" : "'[]'::jsonb AS \"houseCleaningAddons\"",
      columns.has("help_mama_pricing") ? "help_mama_pricing AS \"helpMamaPricing\"" : `'{"enabled":false,"hourlyDaytimePrice":0,"hourlyEveningPrice":0,"overnightPrice":0,"fullDayPrice":0,"ageBands":[]}'::jsonb AS "helpMamaPricing"`,
      "description",
      columns.has("rating") ? "rating" : "5 AS rating",
      columns.has("review_count") ? "review_count AS \"reviewCount\"" : "0 AS \"reviewCount\"",
      columns.has("image_url") ? "image_url AS \"imageUrl\"" : "NULL::text AS \"imageUrl\"",
      columns.has("gallery_urls") ? "gallery_urls AS \"galleryUrls\"" : "'{}'::text[] AS \"galleryUrls\"",
      columns.has("media_type") ? "media_type AS \"mediaType\"" : "'image'::varchar AS \"mediaType\"",
      columns.has("is_public") ? "is_public AS \"isPublic\"" : "false AS \"isPublic\"",
      columns.has("manager_user_id") ? "manager_user_id AS \"managerUserId\"" : "NULL::varchar AS \"managerUserId\"",
      columns.has("features") ? "features" : "'{}'::text[] AS features",
      columns.has("created_at") ? "created_at AS \"createdAt\"" : "NULL::text AS \"createdAt\"",
      columns.has("updated_at") ? "updated_at AS \"updatedAt\"" : "NULL::text AS \"updatedAt\"",
    ];

    const result = await pool.query<Errand>(
      `SELECT ${selectParts.join(", ")} FROM errands WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? normalizeManagerScopedRecord(result.rows[0]) : undefined;
  }

  async createErrand(data: InsertErrand): Promise<Errand> {
    const now = new Date().toISOString();
    const columns = await this.getTableColumns("errands");
    const writeData = normalizeManagerScopedWriteData(this.filterErrandWriteData(data, columns) as InsertErrand);
    const [errand] = await db.insert(errands).values({ ...writeData, createdAt: now, updatedAt: now } as any).returning();
    return normalizeManagerScopedRecord(errand);
  }

  async updateErrand(id: string, data: Partial<InsertErrand>): Promise<Errand | undefined> {
    const columns = await this.getTableColumns("errands");
    const writeData = normalizeManagerScopedWriteData(this.filterErrandWriteData(data, columns));
    const [errand] = await db.update(errands).set({ ...writeData, updatedAt: new Date().toISOString() } as any).where(eq(errands.id, id)).returning();
    return errand ? normalizeManagerScopedRecord(errand) : undefined;
  }

  async deleteErrand(id: string): Promise<boolean> {
    const result = await db.delete(errands).where(eq(errands.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Experiences
  async getExperiences(): Promise<Experience[]> {
    return await this.selectCompatibleExperiences();
  }

  async getExperience(id: string): Promise<Experience | undefined> {
    const [experience] = await this.selectCompatibleExperiences("WHERE id = $1 LIMIT 1", [id]);
    return experience;
  }

  private normalizeExperienceWriteData(data: Partial<InsertExperience>) {
    return {
      ...data,
      privateAddons: Array.isArray(data.privateAddons) ? data.privateAddons : undefined,
      sharedAddons: Array.isArray(data.sharedAddons) ? data.sharedAddons : undefined,
      sharedDepartures: Array.isArray(data.sharedDepartures) ? data.sharedDepartures : undefined,
    };
  }

  async createExperience(data: InsertExperience): Promise<Experience> {
    const now = new Date().toISOString();
    const [experience] = await db.insert(experiences).values({
      ...normalizeManagerScopedWriteData(this.normalizeExperienceWriteData(data)),
      createdAt: now,
      updatedAt: now,
    } as any).returning();
    return normalizeManagerScopedRecord(experience);
  }

  async updateExperience(id: string, data: Partial<InsertExperience>): Promise<Experience | undefined> {
    const [experience] = await db.update(experiences).set({
      ...normalizeManagerScopedWriteData(this.normalizeExperienceWriteData(data)),
      updatedAt: new Date().toISOString(),
    } as any).where(eq(experiences.id, id)).returning();
    return experience ? normalizeManagerScopedRecord(experience) : undefined;
  }

  async deleteExperience(id: string): Promise<boolean> {
    const result = await db.delete(experiences).where(eq(experiences.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Stay Reservations
  async getStayReservations(stayId: string): Promise<StayReservation[]> {
    return await db.select().from(stayReservations).where(eq(stayReservations.stayId, stayId));
  }

  async createStayReservation(data: InsertStayReservation): Promise<StayReservation> {
    const now = new Date().toISOString();
    const [reservation] = await db.insert(stayReservations).values({ ...data, createdAt: now }).returning();
    return reservation;
  }

  async deleteStayReservation(id: string): Promise<boolean> {
    const result = await db.delete(stayReservations).where(eq(stayReservations.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getCarReservations(carId: string): Promise<CarReservation[]> {
    return await db.select().from(carReservations).where(eq(carReservations.carId, carId));
  }

  async createCarReservation(data: InsertCarReservation): Promise<CarReservation> {
    const now = new Date().toISOString();
    const [reservation] = await db.insert(carReservations).values({ ...data, createdAt: now }).returning();
    return reservation;
  }

  async deleteCarReservation(id: string): Promise<boolean> {
    const result = await db.delete(carReservations).where(eq(carReservations.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getCookReservations(cookId: string): Promise<CookReservation[]> {
    return await db.select().from(cookReservations).where(eq(cookReservations.cookId, cookId));
  }

  async createCookReservation(data: InsertCookReservation): Promise<CookReservation> {
    const now = new Date().toISOString();
    const [reservation] = await db.insert(cookReservations).values({ ...data, createdAt: now }).returning();
    return reservation;
  }

  async deleteCookReservation(id: string): Promise<boolean> {
    const result = await db.delete(cookReservations).where(eq(cookReservations.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getReviewsByBookingId(bookingId: string): Promise<Review[]> {
    return await db.select().from(reviews).where(eq(reviews.bookingId, bookingId));
  }

  async getReviewsByTarget(targetType: string, targetId: string): Promise<Review[]> {
    const allReviews = await db.select().from(reviews);
    return allReviews.filter((review) => review.targetType === targetType && review.targetId === targetId);
  }

  async createReview(data: InsertReview & { bookingId: string; userId: string }): Promise<Review> {
    const now = new Date().toISOString();
    const [review] = await db
      .insert(reviews)
      .values({ ...data, createdAt: now, updatedAt: now })
      .returning();
    return review;
  }

  async updateReview(id: string, data: Partial<InsertReview>): Promise<Review | undefined> {
    const [review] = await db
      .update(reviews)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(reviews.id, id))
      .returning();
    return review;
  }

  // Analytics
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const [allBookings, allStays, allCars, allCooks, allErrands, allExperiences, allMessages] = await Promise.all([
      this.getBookingAnalyticsRows(),
      this.getStays(),
      this.getCars(),
      this.getCooks(),
      this.getErrands(),
      this.getExperiences(),
      db.select().from(bookingMessages),
    ]);

    const catalog: DashboardListingCatalog = {
      staysById: new Map(allStays.map((stay) => [stay.id, stay])),
      carsById: new Map(allCars.map((car) => [car.id, car])),
      cooksById: new Map(allCooks.map((cook) => [cook.id, cook])),
      errandsById: new Map(allErrands.map((errand) => [errand.id, errand])),
      experiencesById: new Map(allExperiences.map((experience) => [experience.id, experience])),
    };

    const messagesByBooking = new Map<string, BookingMessage[]>();
    const sortedMessages = [...allMessages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (const message of sortedMessages) {
      const existing = messagesByBooking.get(message.bookingId) || [];
      existing.push(message);
      messagesByBooking.set(message.bookingId, existing);
    }

    const serviceBreakdownMap = new Map<DashboardServiceKey, DashboardServiceBreakdownItem>(
      Object.entries(dashboardServiceLabels).map(([key, label]) => [
        key as DashboardServiceKey,
        {
          key: key as DashboardServiceKey,
          label,
          bookingCount: 0,
          activeBookings: 0,
          cancelledBookings: 0,
          grossRevenue: 0,
        },
      ]),
    );
    const topServicesMap = new Map<string, DashboardTopServiceItem>();

    let activeBookings = 0;
    let pendingBookings = 0;
    let cancelledBookings = 0;
    let completedBookings = 0;
    let lateBookings = 0;
    let totalRevenue = 0;
    let estimatedProviderPayouts = 0;
    let estimatedPlatformProfit = 0;
    let ongoingChats = 0;
    let unansweredChats = 0;
    let resolvedTasks = 0;
    let pendingProviderUpdates = 0;
    let pendingCustomMenuApprovals = 0;
    let pendingExperienceOfferApprovals = 0;

    const bookingSummaries: DashboardRecentBooking[] = [];

    for (const booking of allBookings) {
      const operationalStatus = getBookingOperationalStatus(booking);
      const grossRevenue = getBookingGrossRevenue(booking);
      const trackedProfit = getBookingExplicitPlatformProfit(booking, catalog);
      const estimatedProviderPayout = Math.max(0, grossRevenue - trackedProfit);
      const bookingThread = messagesByBooking.get(booking.id) || [];
      const latestMessage = bookingThread.length ? bookingThread[bookingThread.length - 1] : null;
      const hasMessages = bookingThread.length > 0;
      const unansweredChat = Boolean(
        latestMessage
        && latestMessage.senderRole === "customer"
        && isOpenOperationalStatus(operationalStatus),
      );
      const pendingProviderUpdate = Boolean(booking.providerStatusRequest && !booking.providerStatusReviewedAt);
      const pendingCustomMenuApproval = booking.serviceMode === "cook-custom-menu" && booking.customMenuProposalStatus === "pending-admin-approval";
      const pendingExperienceOfferApproval = isPendingExperienceOfferApprovalForAdmin(booking);
      const needsAttention = operationalStatus === "late"
        || unansweredChat
        || pendingProviderUpdate
        || pendingCustomMenuApproval
        || pendingExperienceOfferApproval;

      if (isActiveOperationalStatus(operationalStatus)) {
        activeBookings += 1;
      }
      if (operationalStatus === "pending") {
        pendingBookings += 1;
      }
      if (operationalStatus === "cancelled") {
        cancelledBookings += 1;
      }
      if (operationalStatus === "completed") {
        completedBookings += 1;
      }
      if (operationalStatus === "late") {
        lateBookings += 1;
      }

      totalRevenue += grossRevenue;
      estimatedProviderPayouts += estimatedProviderPayout;
      estimatedPlatformProfit += trackedProfit;

      if (hasMessages && isOpenOperationalStatus(operationalStatus)) {
        ongoingChats += 1;
      }
      if (unansweredChat) {
        unansweredChats += 1;
      }

      if (pendingProviderUpdate) {
        pendingProviderUpdates += 1;
      }
      if (pendingCustomMenuApproval) {
        pendingCustomMenuApprovals += 1;
      }
      if (pendingExperienceOfferApproval) {
        pendingExperienceOfferApprovals += 1;
      }

      resolvedTasks += [
        booking.providerStatusReviewedAt,
        booking.customMenuReviewedAt,
        booking.experienceCustomOfferReviewedAt,
      ].filter(Boolean).length;

      const allocations = getBookingServiceAllocations(booking, catalog);
      const categoryRevenueByBooking = new Map<DashboardServiceKey, number>();
      const servicesByBooking = new Map<string, DashboardServiceAllocation>();

      for (const allocation of allocations) {
        categoryRevenueByBooking.set(
          allocation.category,
          (categoryRevenueByBooking.get(allocation.category) || 0) + allocation.revenue,
        );

        const serviceKey = `${allocation.category}:${allocation.serviceId}`;
        const existing = servicesByBooking.get(serviceKey);
        if (existing) {
          existing.revenue += allocation.revenue;
        } else {
          servicesByBooking.set(serviceKey, { ...allocation });
        }
      }

      for (const [category, categoryRevenue] of Array.from(categoryRevenueByBooking.entries())) {
        const metric = serviceBreakdownMap.get(category);
        if (!metric) {
          continue;
        }

        metric.bookingCount += 1;
        metric.grossRevenue += categoryRevenue;
        if (isActiveOperationalStatus(operationalStatus)) {
          metric.activeBookings += 1;
        }
        if (operationalStatus === "cancelled") {
          metric.cancelledBookings += 1;
        }
      }

      for (const service of Array.from(servicesByBooking.values())) {
        const serviceKey = `${service.category}:${service.serviceId}`;
        const existing = topServicesMap.get(serviceKey);
        if (existing) {
          existing.bookingCount += 1;
          existing.grossRevenue += service.revenue;
          if (isActiveOperationalStatus(operationalStatus)) {
            existing.activeBookings += 1;
          }
        } else {
          topServicesMap.set(serviceKey, {
            serviceId: service.serviceId,
            serviceName: service.serviceName,
            category: service.category,
            categoryLabel: dashboardServiceLabels[service.category],
            bookingCount: 1,
            activeBookings: isActiveOperationalStatus(operationalStatus) ? 1 : 0,
            grossRevenue: service.revenue,
          });
        }
      }

      bookingSummaries.push({
        id: booking.id,
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        guests: booking.guests,
        bookingType: booking.bookingType,
        status: operationalStatus,
        grossRevenue,
        serviceLabels: Array.from(new Set(allocations.map((allocation) => allocation.serviceName))),
        createdAt: booking.createdAt,
        hasMessages,
        needsAttention,
      });
    }

    const now = new Date();
    const revenueTrendMap = new Map<string, DashboardRevenuePoint>();
    for (let offset = 5; offset >= 0; offset -= 1) {
      const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const monthKey = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`;
      revenueTrendMap.set(monthKey, {
        month: monthKey,
        label: monthDate.toLocaleDateString("en-US", { month: "short" }),
        revenue: 0,
        bookingCount: 0,
      });
    }

    for (const booking of bookingSummaries) {
      const createdAt = new Date(booking.createdAt);
      if (Number.isNaN(createdAt.getTime())) {
        continue;
      }

      const monthKey = `${createdAt.getUTCFullYear()}-${String(createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
      const existing = revenueTrendMap.get(monthKey);
      if (!existing) {
        continue;
      }

      existing.revenue += booking.grossRevenue;
      existing.bookingCount += 1;
    }

    const serviceOrder: DashboardServiceKey[] = ["stays", "cars", "cooks", "errands", "experiences", "custom"];
    const openTasks = pendingProviderUpdates + pendingCustomMenuApprovals + pendingExperienceOfferApprovals + unansweredChats + lateBookings;
    const accommodationBookings = allBookings.filter((booking) => booking.bookingType === "accommodation").length;
    const serviceOnlyBookings = allBookings.filter((booking) => booking.bookingType === "service").length;
    const recentBookings = [...bookingSummaries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);

    return {
      totalBookings: allBookings.length,
      activeBookings,
      pendingBookings,
      cancelledBookings,
      completedBookings,
      lateBookings,
      totalRevenue,
      estimatedProviderPayouts,
      estimatedPlatformProfit,
      ongoingChats,
      unansweredChats,
      openTasks,
      resolvedTasks,
      pendingProviderUpdates,
      pendingCustomMenuApprovals,
      pendingExperienceOfferApprovals,
      accommodationBookings,
      serviceOnlyBookings,
      serviceBreakdown: serviceOrder.map((key) => serviceBreakdownMap.get(key)!),
      topServices: Array.from(topServicesMap.values())
        .sort((a, b) => (b.grossRevenue - a.grossRevenue) || (b.bookingCount - a.bookingCount))
        .slice(0, 6),
      revenueTrend: Array.from(revenueTrendMap.values()),
      recentBookings,
    };
  }

  async getPopularServices(): Promise<PopularService[]> {
    const allBookings = await this.getBookingAnalyticsRows();
    const serviceCounts = new Map<string, number>();

    allBookings.forEach(booking => {
      booking.selectedServices.forEach(serviceId => {
        serviceCounts.set(serviceId, (serviceCounts.get(serviceId) || 0) + 1);
      });
    });

    const allServices = await this.getServices();
    const popularServices: PopularService[] = [];

    serviceCounts.forEach((count, serviceId) => {
      const service = allServices.find(s => s.id === serviceId);
      if (service) {
        popularServices.push({
          serviceId,
          serviceName: service.name,
          bookingCount: count,
        });
      }
    });

    return popularServices.sort((a, b) => b.bookingCount - a.bookingCount).slice(0, 5);
  }

  async getRevenueByMonth(): Promise<RevenueByMonth[]> {
    const allBookings = await this.getBookingAnalyticsRows();
    const monthlyData = new Map<string, { revenue: number; count: number }>();

    allBookings.forEach(booking => {
      const date = new Date(booking.createdAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      const existing = monthlyData.get(monthKey) || { revenue: 0, count: 0 };
      monthlyData.set(monthKey, {
        revenue: existing.revenue + booking.totalPrice,
        count: existing.count + 1,
      });
    });

    return Array.from(monthlyData.entries())
      .map(([month, data]) => ({
        month,
        revenue: data.revenue,
        bookingCount: data.count,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  async upsertProviderCommissionSetting(
    providerUserId: string,
    providerCategory: ProviderCategory,
    commissionPercent: number,
    notes?: string | null,
  ): Promise<ProviderCommissionSetting> {
    await this.ensurePaymentsTables();

    const sanitizedPercent = Math.max(0, Math.min(100, Math.round(commissionPercent)));
    const normalizedNotes = notes?.trim() || null;
    const now = new Date().toISOString();

    const [existing] = await db
      .select()
      .from(providerCommissionSettings)
      .where(
        and(
          eq(providerCommissionSettings.providerUserId, providerUserId),
          eq(providerCommissionSettings.providerCategory, providerCategory),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(providerCommissionSettings)
        .set({
          commissionPercent: sanitizedPercent,
          notes: normalizedNotes,
          updatedAt: now,
        })
        .where(eq(providerCommissionSettings.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(providerCommissionSettings)
      .values({
        providerUserId,
        providerCategory,
        commissionPercent: sanitizedPercent,
        notes: normalizedNotes,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return created;
  }

  async syncBookingPayouts(options?: { bookingIds?: string[]; skipAssignmentSync?: boolean }): Promise<{ created: number; updated: number; cancelled: number }> {
    await this.ensurePaymentsTables();

    const bookingIds = Array.from(new Set((options?.bookingIds ?? []).filter(Boolean)));
    const bookingFilter = bookingIds.length ? new Set(bookingIds) : null;

    if (!options?.skipAssignmentSync) {
      await this.syncBookingServiceAssignments({ bookingIds: bookingIds.length ? bookingIds : undefined });
    }

    const [
      allBookingsRaw,
      allAssignmentsRaw,
      providerCatalog,
      commissionSettings,
      existingPayoutRowsRaw,
      attributionRows,
    ] = await Promise.all([
      this.getBookingAnalyticsRows(),
      this.getBookingServiceAssignments(),
      this.getProviderWorkflowCatalog(),
      db.select().from(providerCommissionSettings),
      db.select().from(bookingPayouts),
      db.select().from(bookingAttributions),
    ]);

    const allBookings = bookingFilter
      ? allBookingsRaw.filter((booking) => bookingFilter.has(booking.id))
      : allBookingsRaw;
    const allAssignments = bookingFilter
      ? allAssignmentsRaw.filter((assignment) => bookingFilter.has(assignment.bookingId))
      : allAssignmentsRaw;
    const existingPayoutRows = bookingFilter
      ? existingPayoutRowsRaw.filter((row) => bookingFilter.has(row.bookingId))
      : existingPayoutRowsRaw;

    const commissionSettingsMap = new Map(
      commissionSettings.map((setting) => [`${setting.providerUserId}:${setting.providerCategory}`, setting]),
    );
    const bookingMap = new Map(allBookings.map((booking) => [booking.id, booking]));
    const providerUserMap = providerCatalog.providerUsersById;
    const bookingAttributionMap = new Map(attributionRows.map((attribution) => [attribution.bookingId, attribution]));
    const assignmentPayoutPricingById = new Map<string, AssignmentPayoutPricing>();
    const assignmentsByBookingId = allAssignments.reduce((groups, assignment) => {
      const existing = groups.get(assignment.bookingId) ?? [];
      existing.push(assignment);
      groups.set(assignment.bookingId, existing);
      return groups;
    }, new Map<string, BookingServiceAssignment[]>());

    assignmentsByBookingId.forEach((bookingAssignments, bookingId) => {
      const booking = bookingMap.get(bookingId);
      if (!booking) {
        return;
      }

      const pricing = getAssignmentPayoutPricingForBooking(
        booking,
        bookingAssignments,
        bookingAttributionMap.get(bookingId),
        providerCatalog,
      );
      pricing.forEach((value, assignmentId) => {
        assignmentPayoutPricingById.set(assignmentId, value);
      });
    });
    const assignmentByLegacyKey = new Map(
      allAssignments.map((assignment) => [getAssignmentLegacyKey(assignment), assignment] as const),
    );
    const payoutRowsByAssignmentId = new Map<string, BookingPayout[]>();
    const payoutRowsByLegacyKey = new Map<string, BookingPayout[]>();

    for (const payoutRow of existingPayoutRows) {
      if (payoutRow.assignmentId) {
        const existingByAssignment = payoutRowsByAssignmentId.get(payoutRow.assignmentId) ?? [];
        existingByAssignment.push(payoutRow);
        payoutRowsByAssignmentId.set(payoutRow.assignmentId, existingByAssignment);
      }

      const legacyKey = getAssignmentLegacyKey(payoutRow);
      const existingByLegacyKey = payoutRowsByLegacyKey.get(legacyKey) ?? [];
      existingByLegacyKey.push(payoutRow);
      payoutRowsByLegacyKey.set(legacyKey, existingByLegacyKey);
    }

    const matchedPayoutRowIds = new Set<string>();
    const duplicatePayoutNote = "Superseded by assignment-based payout sync.";
    let created = 0;
    let updated = 0;
    let cancelled = 0;

    for (const assignment of allAssignments) {
      const legacyKey = getAssignmentLegacyKey(assignment);
      const relatedRows = Array.from(new Map(
        [
          ...(payoutRowsByAssignmentId.get(assignment.id) ?? []),
          ...(payoutRowsByLegacyKey.get(legacyKey) ?? []),
        ].map((row) => [row.id, row] as const),
      ).values());
      const canonicalRow = relatedRows.length ? pickCanonicalPayoutRow(relatedRows, assignment.providerUserId) : undefined;
      const duplicateRows = canonicalRow ? relatedRows.filter((row) => row.id !== canonicalRow.id) : [];

      for (const duplicateRow of duplicateRows) {
        matchedPayoutRowIds.add(duplicateRow.id);
        if (duplicateRow.status === "paid") {
          continue;
        }

        if (duplicateRow.status === "cancelled") {
          continue;
        }

        await db
          .update(bookingPayouts)
          .set({
            status: "cancelled",
            notes: appendSystemNote(duplicateRow.notes, duplicatePayoutNote),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(bookingPayouts.id, duplicateRow.id));
        cancelled += 1;
      }

      const booking = bookingMap.get(assignment.bookingId);
      const providerUser = assignment.providerUserId ? providerUserMap.get(assignment.providerUserId) : undefined;
      const operationalStatus = booking ? getBookingOperationalStatus(booking) : null;
      const commissionSetting = assignment.providerUserId
        ? commissionSettingsMap.get(`${assignment.providerUserId}:${assignment.providerCategory}`)
        : undefined;
      const commissionPercent = Math.max(0, commissionSetting?.commissionPercent ?? 0);
      const payoutPricing = assignmentPayoutPricingById.get(assignment.id);
      const protectedGrossAmount = payoutPricing?.protectedGrossAmount ?? Math.max(0, assignment.grossAmount);
      const promoCostAbsorption = payoutPricing?.promoCostAbsorption ?? "shared";
      const { commissionAmount, payoutAmount } = calculateAssignmentPayoutAmounts(
        assignment.grossAmount,
        protectedGrossAmount,
        commissionPercent,
        promoCostAbsorption,
      );
      const isEligibleForPayout = Boolean(
        assignment.providerUserId
        && providerUser?.role === "provider"
        && booking
        && isBookingPaymentSettled(booking)
        && operationalStatus !== "cancelled"
        && operationalStatus !== "pending"
        && assignment.status !== "cancelled"
        && (assignment.grossAmount > 0 || payoutAmount > 0 || commissionAmount !== 0),
      );

      if (!canonicalRow) {
        if (!isEligibleForPayout || !booking || !assignment.providerUserId) {
          continue;
        }

        const dueAt = booking.checkOut || booking.checkIn;
        const now = new Date().toISOString();

        await db.insert(bookingPayouts).values({
          assignmentId: assignment.id,
          bookingId: assignment.bookingId,
          providerUserId: assignment.providerUserId,
          providerCategory: assignment.providerCategory,
          serviceId: assignment.serviceId,
          serviceName: assignment.serviceName,
          guestName: booking.guestName,
          grossAmount: assignment.grossAmount,
          commissionPercent,
          commissionAmount,
          payoutAmount,
          status: "pending",
          dueAt,
          paidAt: null,
          paymentMethod: null,
          paymentReference: null,
          notes: null,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
        continue;
      }

      matchedPayoutRowIds.add(canonicalRow.id);

      if (!isEligibleForPayout || !booking || !assignment.providerUserId) {
        if (canonicalRow.status === "paid") {
          if (canonicalRow.assignmentId !== assignment.id) {
            await db
              .update(bookingPayouts)
              .set({
                assignmentId: assignment.id,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(bookingPayouts.id, canonicalRow.id));
            updated += 1;
          }
          continue;
        }

        if (canonicalRow.status !== "cancelled" || canonicalRow.assignmentId !== assignment.id) {
          await db
            .update(bookingPayouts)
            .set({
              assignmentId: assignment.id,
              status: "cancelled",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(bookingPayouts.id, canonicalRow.id));
          if (canonicalRow.status !== "cancelled") {
            cancelled += 1;
          } else {
            updated += 1;
          }
        }
        continue;
      }

      const dueAt = booking.checkOut || booking.checkIn;
      const now = new Date().toISOString();

      if (canonicalRow.status === "paid") {
        if (canonicalRow.assignmentId !== assignment.id) {
          await db
            .update(bookingPayouts)
            .set({
              assignmentId: assignment.id,
              updatedAt: now,
            })
            .where(eq(bookingPayouts.id, canonicalRow.id));
          updated += 1;
        }
        continue;
      }

      const nextStatus: PayoutStatus = canonicalRow.status === "cancelled"
        ? "pending"
        : (isPayoutStatus(canonicalRow.status) ? canonicalRow.status : "pending");
      const shouldUpdate = canonicalRow.assignmentId !== assignment.id
        || canonicalRow.providerUserId !== assignment.providerUserId
        || canonicalRow.providerCategory !== assignment.providerCategory
        || canonicalRow.serviceId !== assignment.serviceId
        || canonicalRow.serviceName !== assignment.serviceName
        || canonicalRow.guestName !== booking.guestName
        || Number(canonicalRow.grossAmount) !== assignment.grossAmount
        || Number(canonicalRow.commissionPercent) !== commissionPercent
        || Number(canonicalRow.commissionAmount) !== commissionAmount
        || Number(canonicalRow.payoutAmount) !== payoutAmount
        || canonicalRow.dueAt !== dueAt
        || canonicalRow.status !== nextStatus;

      if (shouldUpdate) {
        await db
          .update(bookingPayouts)
          .set({
            assignmentId: assignment.id,
            providerUserId: assignment.providerUserId,
            providerCategory: assignment.providerCategory,
            serviceId: assignment.serviceId,
            serviceName: assignment.serviceName,
            guestName: booking.guestName,
            grossAmount: assignment.grossAmount,
            commissionPercent,
            commissionAmount,
            payoutAmount,
            dueAt,
            status: nextStatus,
            updatedAt: now,
          })
          .where(eq(bookingPayouts.id, canonicalRow.id));
        updated += 1;
      }
    }

    for (const existingRow of existingPayoutRows) {
      if (matchedPayoutRowIds.has(existingRow.id)) {
        continue;
      }

      const currentAssignment = existingRow.assignmentId
        ? allAssignments.find((assignment) => assignment.id === existingRow.assignmentId)
        : assignmentByLegacyKey.get(getAssignmentLegacyKey(existingRow));
      if (currentAssignment) {
        continue;
      }

      if (existingRow.status === "paid" || existingRow.status === "cancelled") {
        continue;
      }

      await db
        .update(bookingPayouts)
        .set({
          status: "cancelled",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(bookingPayouts.id, existingRow.id));
      cancelled += 1;
    }

    return { created, updated, cancelled };
  }

  async updateBookingPayout(
    id: string,
    data: Partial<Pick<BookingPayout, "status" | "paymentMethod" | "paymentReference" | "notes" | "paidAt">>,
  ): Promise<BookingPayout | undefined> {
    await this.ensurePaymentsTables();

    const updateData: Partial<BookingPayout> = {
      updatedAt: new Date().toISOString(),
    };

    if (data.status && isPayoutStatus(data.status)) {
      updateData.status = data.status;
      if (data.status === "paid") {
        updateData.paidAt = data.paidAt ?? new Date().toISOString();
      } else {
        updateData.paidAt = null;
      }
    }

    if (data.paymentMethod !== undefined) {
      updateData.paymentMethod = data.paymentMethod && isPayoutMethod(data.paymentMethod) ? data.paymentMethod : null;
    }

    if (data.paymentReference !== undefined) {
      updateData.paymentReference = data.paymentReference?.trim() || null;
    }

    if (data.notes !== undefined) {
      updateData.notes = data.notes?.trim() || null;
    }

    const [updated] = await db
      .update(bookingPayouts)
      .set(updateData)
      .where(eq(bookingPayouts.id, id))
      .returning();

    return updated;
  }

  async getPaymentManagementData(): Promise<PaymentManagementData> {
    await this.ensurePaymentsTables();
    await this.ensureMarketingTables();
    await this.syncBookingPayouts();

    const [providerSummaries, providerUsers, commissionSettingsRows, payoutRows, attributionRows, assignmentRows] = await Promise.all([
      this.getProviderAccountSummaries(),
      this.getUsersByRole("provider"),
      db.select().from(providerCommissionSettings),
      db.select().from(bookingPayouts),
      db.select().from(bookingAttributions),
      this.getBookingServiceAssignments(),
    ]);

    const providerSummaryMap = new Map(providerSummaries.map((provider) => [provider.id, provider]));
    const providerUsersById = new Map(providerUsers.map((provider) => [provider.id, provider]));
    const commissionSettingsMap = new Map(
      commissionSettingsRows.map((setting) => [`${setting.providerUserId}:${setting.providerCategory}`, setting]),
    );
    const bookingAttributionMap = new Map(
      attributionRows
        .map((row) => [row.bookingId, toBookingMarketingSummary(row)] as const)
        .filter((entry): entry is readonly [string, BookingMarketingSummary] => Boolean(entry[1])),
    );
    const assignmentById = new Map(assignmentRows.map((assignment) => [assignment.id, assignment]));
    const assignmentIdByLegacyKey = new Map(
      assignmentRows.map((assignment) => [getAssignmentLegacyKey(assignment), assignment.id] as const),
    );
    const payoutGroups = payoutRows.reduce((groups, row) => {
      const resolvedAssignmentId = row.assignmentId ?? assignmentIdByLegacyKey.get(getAssignmentLegacyKey(row)) ?? null;
      const groupKey = resolvedAssignmentId ?? `legacy:${getAssignmentLegacyKey(row)}`;
      const current = groups.get(groupKey) ?? [];
      current.push(row);
      groups.set(groupKey, current);
      return groups;
    }, new Map<string, BookingPayout[]>());
    const canonicalPayoutRows = Array.from(payoutGroups.values())
      .map((rows) => {
        const firstRow = rows[0];
        if (!firstRow) {
          return null;
        }

        const assignmentId = firstRow.assignmentId ?? assignmentIdByLegacyKey.get(getAssignmentLegacyKey(firstRow)) ?? null;
        const assignment = assignmentId ? assignmentById.get(assignmentId) : undefined;
        return pickCanonicalPayoutRow(rows, assignment?.providerUserId);
      })
      .filter((row): row is BookingPayout => Boolean(row));

    const commissionSettings: AdminCommissionSettingSummary[] = providerSummaries
      .flatMap((provider) => {
        const providerName = [provider.firstName, provider.lastName].filter(Boolean).join(" ").trim() || provider.email || "Provider";
        const categories = provider.providerTypes.length
          ? provider.providerTypes
          : (provider.providerType ? [provider.providerType] : []);

        return categories
          .filter((category): category is ProviderCategory => isProviderCategory(category))
          .map((category) => {
            const assignedListings = category === "stays"
              ? provider.assignedStayIds.length
              : category === "cars"
                ? provider.assignedCarIds.length
                : category === "cooks"
                  ? provider.assignedCookIds.length
                  : category === "errands"
                    ? provider.assignedErrandIds.length
                    : provider.assignedExperienceIds.length;
            const setting = commissionSettingsMap.get(`${provider.id}:${category}`);

            return {
              providerUserId: provider.id,
              providerName,
              providerEmail: provider.email,
              providerCategory: category,
              commissionPercent: setting?.commissionPercent ?? 0,
              notes: setting?.notes ?? null,
              assignedListings,
              isConfigured: Boolean(setting),
            };
          });
      })
      .sort((a, b) =>
        a.providerName.localeCompare(b.providerName)
        || a.providerCategory.localeCompare(b.providerCategory),
      );

    const statusOrder: Record<PayoutStatus, number> = {
      pending: 0,
      approved: 1,
      paid: 2,
      cancelled: 3,
    };

    const payouts: AdminBookingPayout[] = canonicalPayoutRows
      .map((row) => {
        const summary = providerSummaryMap.get(row.providerUserId);
        const user = providerUsersById.get(row.providerUserId);

        return {
          id: row.id,
          assignmentId: row.assignmentId ?? assignmentIdByLegacyKey.get(getAssignmentLegacyKey(row)) ?? null,
          bookingId: row.bookingId,
          providerUserId: row.providerUserId,
          providerName: summary
            ? ([summary.firstName, summary.lastName].filter(Boolean).join(" ").trim() || summary.email || "Provider")
            : getProviderDisplayName(user),
          providerEmail: summary?.email || user?.email || "",
          providerCategory: isProviderCategory(row.providerCategory) ? row.providerCategory : "stays",
          serviceId: row.serviceId,
          serviceName: row.serviceName,
          guestName: row.guestName,
          grossAmount: Number(row.grossAmount ?? 0),
          commissionPercent: Number(row.commissionPercent ?? 0),
          commissionAmount: Number(row.commissionAmount ?? 0),
          payoutAmount: Number(row.payoutAmount ?? 0),
          status: isPayoutStatus(row.status) ? row.status : "pending",
          dueAt: row.dueAt ?? null,
          paidAt: row.paidAt ?? null,
          paymentMethod: isPayoutMethod(row.paymentMethod) ? row.paymentMethod : null,
          paymentReference: row.paymentReference ?? null,
          notes: row.notes ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          marketingAttribution: bookingAttributionMap.get(row.bookingId) ?? null,
        };
      })
      .sort((a, b) =>
        statusOrder[a.status] - statusOrder[b.status]
        || (a.dueAt || "").localeCompare(b.dueAt || "")
        || b.createdAt.localeCompare(a.createdAt),
      );

    const activePayouts = payouts.filter((payout) => payout.status !== "cancelled");

    return {
      totalGrossTracked: activePayouts.reduce((sum, payout) => sum + payout.grossAmount, 0),
      totalCommissionTracked: activePayouts.reduce((sum, payout) => sum + payout.commissionAmount, 0),
      totalPendingPayouts: payouts
        .filter((payout) => payout.status === "pending")
        .reduce((sum, payout) => sum + payout.payoutAmount, 0),
      totalApprovedPayouts: payouts
        .filter((payout) => payout.status === "approved")
        .reduce((sum, payout) => sum + payout.payoutAmount, 0),
      totalPaidOut: payouts
        .filter((payout) => payout.status === "paid")
        .reduce((sum, payout) => sum + payout.payoutAmount, 0),
      unpaidPayoutCount: payouts.filter((payout) => payout.status === "pending" || payout.status === "approved").length,
      paidPayoutCount: payouts.filter((payout) => payout.status === "paid").length,
      partnersNeedingCommissionSetup: commissionSettings.filter((setting) => !setting.isConfigured && setting.assignedListings > 0).length,
      commissionSettings,
      payouts,
    };
  }

  async getProviderPaymentData(providerUserId: string): Promise<ProviderPaymentData> {
    const data = await this.getPaymentManagementData();
    const payouts = data.payouts.filter((payout) => payout.providerUserId === providerUserId);
    const activePayouts = payouts.filter((payout) => payout.status !== "cancelled");
    const relevantConfiguredCategories = new Set(
      data.commissionSettings
        .filter((setting) => setting.providerUserId === providerUserId && setting.assignedListings > 0)
        .map((setting) => setting.providerCategory),
    );
    payouts.forEach((payout) => {
      relevantConfiguredCategories.add(payout.providerCategory);
    });
    const configuredServiceFeePercents = Array.from(new Set(
      data.commissionSettings
        .filter((setting) =>
          setting.providerUserId === providerUserId
          && setting.isConfigured
          && relevantConfiguredCategories.has(setting.providerCategory),
        )
        .map((setting) => Math.max(0, Number(setting.commissionPercent ?? 0))),
    )).sort((left, right) => left - right);
    const payoutServiceFeePercents = Array.from(new Set(
      activePayouts
        .map((payout) => Math.max(0, Number(payout.commissionPercent ?? 0))),
    )).sort((left, right) => left - right);
    const serviceFeePercents = configuredServiceFeePercents.length
      ? configuredServiceFeePercents
      : payoutServiceFeePercents;

    return {
      totalGrossTracked: activePayouts.reduce((sum, payout) => sum + payout.grossAmount, 0),
      totalCommissionRetained: activePayouts.reduce((sum, payout) => sum + payout.commissionAmount, 0),
      totalProjectedPayouts: activePayouts.reduce((sum, payout) => sum + payout.payoutAmount, 0),
      totalPendingPayouts: payouts
        .filter((payout) => payout.status === "pending")
        .reduce((sum, payout) => sum + payout.payoutAmount, 0),
      totalApprovedPayouts: payouts
        .filter((payout) => payout.status === "approved")
        .reduce((sum, payout) => sum + payout.payoutAmount, 0),
      totalPaidOut: payouts
        .filter((payout) => payout.status === "paid")
        .reduce((sum, payout) => sum + payout.payoutAmount, 0),
      unpaidPayoutCount: payouts.filter((payout) => payout.status === "pending" || payout.status === "approved").length,
      paidPayoutCount: payouts.filter((payout) => payout.status === "paid").length,
      serviceFeePercents,
      payouts,
    };
  }

  async getClientsWithBookings(): Promise<import("@shared/schema").ClientWithBookings[]> {
    const allBookings = await this.getBookingAnalyticsRows();
    
    const accommodationIds = allBookings.filter(b => b.accommodationId).map(b => b.accommodationId!);
    const selectedServiceIds = Array.from(new Set(allBookings.flatMap(b => b.selectedServices)));
    const userIds = allBookings.filter(b => b.userId).map(b => b.userId!);

    const [accommodationsList, carsList, cooksList, errandsList, experiencesList, usersList] = await Promise.all([
      accommodationIds.length > 0
        ? db.select({ id: stays.id, title: stays.title }).from(stays).where(inArray(stays.id, accommodationIds))
        : Promise.resolve([]),
      selectedServiceIds.length > 0
        ? db.select({ id: cars.id, model: cars.model }).from(cars).where(inArray(cars.id, selectedServiceIds))
        : Promise.resolve([]),
      selectedServiceIds.length > 0
        ? db.select({ id: cooks.id, title: cooks.title }).from(cooks).where(inArray(cooks.id, selectedServiceIds))
        : Promise.resolve([]),
      selectedServiceIds.length > 0
        ? db.select({ id: errands.id, serviceName: errands.serviceName }).from(errands).where(inArray(errands.id, selectedServiceIds))
        : Promise.resolve([]),
      selectedServiceIds.length > 0
        ? db.select({ id: experiences.id, title: experiences.title }).from(experiences).where(inArray(experiences.id, selectedServiceIds))
        : Promise.resolve([]),
      userIds.length > 0
        ? db.select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
          }).from(users).where(inArray(users.id, userIds))
        : Promise.resolve([]),
    ]);

    const accommodationsMap = new Map(accommodationsList.map(a => [a.id, a]));
    const carsMap = new Map(carsList.map(car => [car.id, car]));
    const cooksMap = new Map(cooksList.map(cook => [cook.id, cook]));
    const errandsMap = new Map(errandsList.map(errand => [errand.id, errand]));
    const experiencesMap = new Map(experiencesList.map(experience => [experience.id, experience]));
    const usersMap = new Map(usersList.map(u => [u.id, u]));

    const bookingsWithServices: import("@shared/schema").BookingWithServices[] = allBookings.map(booking => {
      const serviceSummaries: import("@shared/schema").ServiceSummary[] = [];
      
      if (booking.accommodationId && accommodationsMap.has(booking.accommodationId)) {
        const stay = accommodationsMap.get(booking.accommodationId)!;
        serviceSummaries.push({ type: "accommodation", id: stay.id, title: stay.title });
      }
      
      booking.selectedServices.forEach(serviceId => {
        const car = carsMap.get(serviceId);
        if (car) {
          serviceSummaries.push({
            type: "car",
            id: car.id,
            title: car.model,
          });
          return;
        }

        const cook = cooksMap.get(serviceId);
        if (cook) {
          serviceSummaries.push({
            type: "cook",
            id: cook.id,
            title: cook.title,
          });
          return;
        }

        const errand = errandsMap.get(serviceId);
        if (errand) {
          serviceSummaries.push({
            type: "errand",
            id: errand.id,
            title: errand.serviceName,
          });
          return;
        }

        const experience = experiencesMap.get(serviceId);
        if (experience) {
          serviceSummaries.push({
            type: "experience",
            id: experience.id,
            title: experience.title,
          });
        }
      });

      const { selectedServices, ...bookingWithoutSelectedServices } = booking;
      return {
        ...bookingWithoutSelectedServices,
        services: serviceSummaries,
      };
    });

    const clientsMap = new Map<string, import("@shared/schema").ClientWithBookings>();

    bookingsWithServices.forEach(booking => {
      const groupKey = booking.userId || booking.guestEmail || "unknown";
      
      if (!clientsMap.has(groupKey)) {
        const user = booking.userId ? usersMap.get(booking.userId) : null;
        
        clientsMap.set(groupKey, {
          user: user ? {
            id: user.id,
            email: user.email || undefined,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
          } : null,
          contactEmail: user?.email || booking.guestEmail || "",
          contactName: user 
            ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Unknown"
            : booking.guestName || booking.guestEmail || "Guest",
          bookings: [],
        });
      }

      clientsMap.get(groupKey)!.bookings.push(booking);
    });

    return Array.from(clientsMap.values()).sort((a, b) => 
      a.contactName.localeCompare(b.contactName)
    );
  }

  async getProviderAccountSummaries(): Promise<ProviderAccountSummary[]> {
    const [providerUsers, allReviews, stayColumns, carColumns, cookColumns, errandColumns, experienceColumns] = await Promise.all([
      this.getUsersByRole("provider"),
      db.select().from(reviews),
      this.getTableColumns("stays"),
      this.getTableColumns("cars"),
      this.getTableColumns("cooks"),
      this.getTableColumns("errands"),
      this.getTableColumns("experiences"),
    ]);

    const [allStays, allCars, allCooks, allErrands, allExperiences] = await Promise.all([
      pool.query<{ id: string; title: string; managerUserId: string | null }>(
        `SELECT id, title, ${
          stayColumns.has("manager_user_id") ? 'manager_user_id AS "managerUserId"' : 'NULL::varchar AS "managerUserId"'
        } FROM stays`,
      ).then((result) => result.rows.map((stay) => normalizeManagerScopedRecord(stay))),
      pool.query<{ id: string; model: string; managerUserId: string | null }>(
        `SELECT id, model, ${
          carColumns.has("manager_user_id") ? 'manager_user_id AS "managerUserId"' : 'NULL::varchar AS "managerUserId"'
        } FROM cars`,
      ).then((result) => result.rows.map((car) => normalizeManagerScopedRecord(car))),
      pool.query<{ id: string; title: string; managerUserId: string | null }>(
        `SELECT id, title, ${
          cookColumns.has("manager_user_id") ? 'manager_user_id AS "managerUserId"' : 'NULL::varchar AS "managerUserId"'
        } FROM cooks`,
      ).then((result) => result.rows.map((cook) => normalizeManagerScopedRecord(cook))),
      pool.query<{ id: string; serviceName: string; managerUserId: string | null }>(
        `SELECT id, service_name AS "serviceName", ${
          errandColumns.has("manager_user_id") ? 'manager_user_id AS "managerUserId"' : 'NULL::varchar AS "managerUserId"'
        } FROM errands`,
      ).then((result) => result.rows.map((errand) => normalizeManagerScopedRecord(errand))),
      pool.query<{ id: string; title: string; managerUserId: string | null }>(
        `SELECT id, title, ${
          experienceColumns.has("manager_user_id") ? 'manager_user_id AS "managerUserId"' : 'NULL::varchar AS "managerUserId"'
        } FROM experiences`,
      ).then((result) => result.rows.map((experience) => normalizeManagerScopedRecord(experience))),
    ]);

    return providerUsers.map((providerUser) => {
      const assignedStays = allStays.filter((stay) => stay.managerUserId === providerUser.id);
      const assignedCars = allCars.filter((car) => car.managerUserId === providerUser.id);
      const assignedCooks = allCooks.filter((cook) => cook.managerUserId === providerUser.id);
      const assignedErrands = allErrands.filter((errand) => errand.managerUserId === providerUser.id);
      const assignedExperiences = allExperiences.filter((experience) => experience.managerUserId === providerUser.id);
      const assignedTargets = [
        ...assignedStays.map((stay) => ({ targetType: "stay", targetId: stay.id })),
        ...assignedCars.map((car) => ({ targetType: "car", targetId: car.id })),
        ...assignedCooks.map((cook) => ({ targetType: "cook", targetId: cook.id })),
        ...assignedErrands.map((errand) => ({ targetType: "errand", targetId: errand.id })),
        ...assignedExperiences.map((experience) => ({ targetType: "experience", targetId: experience.id })),
      ];
      const providerReviews = allReviews.filter((review) =>
        assignedTargets.some((target) => target.targetType === review.targetType && target.targetId === review.targetId),
      );
      const totalReviewCount = providerReviews.length;
      const averageRating = totalReviewCount > 0
        ? Number((providerReviews.reduce((sum, review) => sum + review.rating, 0) / totalReviewCount).toFixed(1))
        : null;
      return {
        id: providerUser.id,
        email: providerUser.email || "",
        phone: providerUser.phone || null,
        firstName: providerUser.firstName || null,
        lastName: providerUser.lastName || null,
        providerType: parseProviderTypes(providerUser.providerType)[0] ?? null,
        providerTypes: parseProviderTypes(providerUser.providerType),
        isSuspended: providerUser.isSuspended,
        warningCount: providerUser.warningCount ?? 0,
        moderationNote: providerUser.moderationNote ?? null,
        averageRating,
        totalReviewCount,
        assignedStayIds: assignedStays.map((stay) => stay.id),
        assignedStayTitles: assignedStays.map((stay) => stay.title),
        assignedCarIds: assignedCars.map((car) => car.id),
        assignedCarTitles: assignedCars.map((car) => car.model),
        assignedCookIds: assignedCooks.map((cook) => cook.id),
        assignedCookTitles: assignedCooks.map((cook) => cook.title),
        assignedErrandIds: assignedErrands.map((errand) => errand.id),
        assignedErrandTitles: assignedErrands.map((errand) => errand.serviceName),
        assignedExperienceIds: assignedExperiences.map((experience) => experience.id),
        assignedExperienceTitles: assignedExperiences.map((experience) => experience.title),
      };
    });
  }
}

export const storage = new DatabaseStorage();
