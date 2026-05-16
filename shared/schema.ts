import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Replit Auth Integration: Session storage table
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const userRoles = ["admin", "customer", "provider"] as const;
export type UserRole = typeof userRoles[number];
export const providerCategories = ["stays", "cars", "cooks", "errands", "experiences"] as const;
export type ProviderCategory = typeof providerCategories[number];
export const marketingPromoTypes = ["percent", "fixed", "bundle"] as const;
export type MarketingPromoType = typeof marketingPromoTypes[number];
export const marketingPromoCostAbsorptions = ["shared", "partner", "platform"] as const;
export type MarketingPromoCostAbsorption = typeof marketingPromoCostAbsorptions[number];
export const marketingPromoStatuses = ["draft", "scheduled", "active", "paused", "expired"] as const;
export type MarketingPromoStatus = typeof marketingPromoStatuses[number];
export const marketingPromoChannels = ["homepage", "blog", "email", "social", "whatsapp", "partner"] as const;
export type MarketingPromoChannel = typeof marketingPromoChannels[number];
export const marketingAttributionSourceTypes = ["blog", "promo", "homepage", "service-page", "stay-page", "campaign", "direct"] as const;
export type MarketingAttributionSourceType = typeof marketingAttributionSourceTypes[number];
export const marketingAttributionEventTypes = ["view", "cta-click", "booking"] as const;
export type MarketingAttributionEventType = typeof marketingAttributionEventTypes[number];
export const listingMediaTypes = ["image", "video"] as const;
export type ListingMediaType = typeof listingMediaTypes[number];
export const customMenuProposalStatuses = ["pending", "pending-admin-approval", "proposed", "declined"] as const;
export type CustomMenuProposalStatus = typeof customMenuProposalStatuses[number];
export const customMenuClientDecisionStatuses = ["pending", "accepted", "declined"] as const;
export type CustomMenuClientDecisionStatus = typeof customMenuClientDecisionStatuses[number];
export const experienceCustomOfferStatuses = ["pending", "pending-admin-approval", "proposed", "declined"] as const;
export type ExperienceCustomOfferStatus = typeof experienceCustomOfferStatuses[number];
export const experienceCustomOfferDecisionStatuses = ["pending", "accepted", "declined"] as const;
export type ExperienceCustomOfferDecisionStatus = typeof experienceCustomOfferDecisionStatuses[number];
export const cookBookingModes = ["cook-service-fee", "cook-inclusive", "cook-custom-menu"] as const;
export type CookBookingMode = typeof cookBookingModes[number];
export const errandBookingModes = ["errand-base", "errand-shopping", "errand-laundry", "errand-house-cleaning", "errand-childcare"] as const;
export type ErrandBookingMode = typeof errandBookingModes[number];
export const experienceBookingModes = ["experience-private", "experience-shared", "experience-custom-offer"] as const;
export type ExperienceBookingMode = typeof experienceBookingModes[number];
export const customerPaymentMethods = ["card", "mpesa"] as const;
export type CustomerPaymentMethod = typeof customerPaymentMethods[number];
export const customerPaymentProviders = ["paystack", "pesapal"] as const;
export type CustomerPaymentProvider = typeof customerPaymentProviders[number];
export const bookingPaymentStatuses = ["pending", "processing", "paid", "failed", "cancelled", "refunded"] as const;
export type BookingPaymentStatus = typeof bookingPaymentStatuses[number];
export const errandAddonSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Add-on name is required"),
  price: z.number().int().min(0, "Add-on price cannot be negative"),
});
export type ErrandAddon = z.infer<typeof errandAddonSchema>;
export const helpMamaAgeBandSchema = z.object({
  id: z.string(),
  label: z.string().min(1, "Age band label is required"),
  price: z.number().int().min(0, "Age band price cannot be negative"),
  hourlyDaytimePrice: z.number().int().min(0).optional().default(0),
  hourlyEveningPrice: z.number().int().min(0).optional().default(0),
  overnightPrice: z.number().int().min(0).optional().default(0),
  fullDayPrice: z.number().int().min(0).optional().default(0),
});
export type HelpMamaAgeBand = z.infer<typeof helpMamaAgeBandSchema>;
export const helpMamaPricingSchema = z.object({
  enabled: z.boolean().default(false),
  hourlyDaytimePrice: z.number().int().min(0).optional().default(0),
  hourlyEveningPrice: z.number().int().min(0).optional().default(0),
  overnightPrice: z.number().int().min(0).optional().default(0),
  fullDayPrice: z.number().int().min(0).optional().default(0),
  ageBands: z.array(helpMamaAgeBandSchema).default([]),
});
export type HelpMamaPricing = z.infer<typeof helpMamaPricingSchema>;
export const experienceAddonSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Add-on name is required"),
  price: z.number().int().min(0, "Add-on price cannot be negative"),
});
export type ExperienceAddon = z.infer<typeof experienceAddonSchema>;
export const experienceDepartureSchema = z.object({
  id: z.string(),
  date: z.string().min(1, "Departure date is required"),
  time: z.string().min(1, "Departure time is required"),
});
export type ExperienceDeparture = z.infer<typeof experienceDepartureSchema>;
export const serviceScheduleSlotSchema = z.object({
  date: z.string().min(1, "Date is required"),
  note: z.string().max(120, "Note is too long").optional().default(""),
});
export type ServiceScheduleSlot = z.infer<typeof serviceScheduleSlotSchema>;
export const bookingAssignmentConfigSchema = z.object({
  serviceId: z.string(),
  category: z.enum(providerCategories),
  serviceMode: z.string().optional().nullable(),
  units: z.number().int().min(1).optional().nullable(),
  guests: z.number().int().min(1).optional().nullable(),
  serviceHours: z.number().int().min(1).optional().nullable(),
  serviceLocation: z.string().optional().nullable(),
  servicePickupLocation: z.string().optional().nullable(),
  serviceReturnLocation: z.string().optional().nullable(),
  serviceZone: z.string().optional().nullable(),
  serviceStartTime: z.string().optional().nullable(),
  serviceEndTime: z.string().optional().nullable(),
  serviceBudgetAmount: z.number().int().min(1).optional().nullable(),
  serviceLaundryWeightKg: z.number().int().min(1).optional().nullable(),
  serviceAddonSelections: z.array(z.string()).optional().default([]),
  serviceScheduleSlots: z.array(serviceScheduleSlotSchema).optional().default([]),
  serviceDepartureId: z.string().optional().nullable(),
  serviceRequestDetails: z.string().optional().nullable(),
});
export type BookingAssignmentConfig = z.infer<typeof bookingAssignmentConfigSchema>;
export const stayServiceSelectionSchema = z.object({
  serviceId: z.string(),
  category: z.enum(["cars", "cooks", "errands", "experiences"]),
  serviceMode: z.string().optional().nullable(),
  units: z.number().int().min(1).optional().nullable(),
  guests: z.number().int().min(1).optional().nullable(),
  serviceHours: z.number().int().min(1).optional().nullable(),
  serviceLocation: z.string().optional().nullable(),
  servicePickupLocation: z.string().optional().nullable(),
  serviceReturnLocation: z.string().optional().nullable(),
  serviceStartTime: z.string().optional().nullable(),
  serviceEndTime: z.string().optional().nullable(),
  serviceBudgetAmount: z.number().int().min(1).optional().nullable(),
  serviceLaundryWeightKg: z.number().int().min(1).optional().nullable(),
  serviceAddonSelections: z.array(z.string()).optional().default([]),
  serviceDepartureId: z.string().optional().nullable(),
  serviceRequestDetails: z.string().optional().nullable(),
});
export type StayServiceSelection = z.infer<typeof stayServiceSelectionSchema>;
export const customMenuRequestFeeKesDefault = 500;
export const customMenuRequestFeeDefault = 4;
export const carZoneRateSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Zone name is required"),
  dailyPrice: z.number().int().positive().optional(),
  hourlyPrice: z.number().int().positive().optional(),
  selfDrivePrice: z.number().int().positive().optional(),
}).refine((value) => value.dailyPrice || value.hourlyPrice || value.selfDrivePrice, {
  message: "Zone pricing must include a daily or hourly price",
});
export type CarZoneRate = z.infer<typeof carZoneRateSchema>;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  emailVerifiedAt: timestamp("email_verified_at"),
  phone: varchar("phone"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  passwordHash: text("password_hash"),
  role: varchar("role").notNull().default("customer"),
  providerType: varchar("provider_type"),
  isSuspended: boolean("is_suspended").notNull().default(false),
  warningCount: integer("warning_count").notNull().default(0),
  moderationNote: text("moderation_note"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const passwordResetOtps = pgTable("password_reset_otps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").notNull(),
  otpHash: text("otp_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const emailVerificationOtps = pgTable(
  "email_verification_otps",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    email: varchar("email").notNull(),
    otpHash: text("otp_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("IDX_email_verification_otps_email").on(table.email)],
);

export const signUpSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(7, "Phone number is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const signInSchema = z.object({
  identifier: z.string().min(1, "Email or phone is required"),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Valid email is required"),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Valid email is required"),
  otp: z.string().length(6, "OTP must be 6 digits"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export const verifyEmailSchema = z.object({
  email: z.string().email("Valid email is required"),
  otp: z.string().length(6, "OTP must be 6 digits"),
});

export const resendVerificationSchema = z.object({
  email: z.string().email("Valid email is required"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

// Accommodations
export const accommodations = pgTable("accommodations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  location: text("location").notNull(),
  description: text("description").notNull(),
  pricePerNight: integer("price_per_night").notNull(),
  maxGuests: integer("max_guests").notNull(),
  bedrooms: integer("bedrooms").notNull(),
  bathrooms: integer("bathrooms").notNull(),
  imageUrl: text("image_url").notNull(),
  rating: integer("rating").notNull(),
  reviewCount: integer("review_count").notNull(),
  amenities: text("amenities").array().notNull(),
});

export const insertAccommodationSchema = createInsertSchema(accommodations).omit({
  id: true,
});

export type InsertAccommodation = z.infer<typeof insertAccommodationSchema>;
export type Accommodation = typeof accommodations.$inferSelect;

// Service Types
export const serviceTypes = ["car-rental", "car-with-driver", "personal-cook", "shopping", "fridge-stocking"] as const;
export type ServiceType = typeof serviceTypes[number];

// Booking Status
export const bookingStatus = z.enum(["upcoming", "in-progress", "completed", "cancelled"]);
export type BookingStatus = z.infer<typeof bookingStatus>;

// Services
export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  pricePerDay: integer("price_per_day").notNull(),
  priceType: text("price_type").notNull(), // "per-day", "one-time", "per-hour"
  imageUrl: text("image_url"),
  // Car rental specific fields
  deliveryType: text("delivery_type"), // "self-driven", "chauffeur"
  vehicleType: text("vehicle_type"), // "sedan", "suv", "luxury", "van"
  transmission: text("transmission"), // "automatic", "manual"
  seatingCapacity: integer("seating_capacity"),
});

export const insertServiceSchema = createInsertSchema(services).omit({
  id: true,
});

export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof services.$inferSelect;

// Service Providers
export const providers = pgTable("providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  serviceType: text("service_type").notNull(),
  rating: integer("rating").notNull(),
  reviewCount: integer("review_count").notNull(),
  experience: integer("experience").notNull(),
  bio: text("bio").notNull(),
  imageUrl: text("image_url"),
  verified: boolean("verified").notNull().default(true),
  slaResponseTime: text("sla_response_time").notNull(),
});

export const insertProviderSchema = createInsertSchema(providers).omit({
  id: true,
});

export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providers.$inferSelect;

// Bookings
export const bookings = pgTable("bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"), // Links booking to authenticated user
  accommodationId: varchar("accommodation_id"), // Optional - allows standalone service bookings
  guestName: text("guest_name").notNull(),
  guestEmail: text("guest_email").notNull(),
  guestPhone: text("guest_phone"), // Contact phone number
  checkIn: text("check_in").notNull(),
  checkOut: text("check_out").notNull(),
  guests: integer("guests").notNull(),
  selectedServices: text("selected_services").array().notNull(),
  serviceMode: text("service_mode"),
  serviceHours: integer("service_hours"),
  serviceLocation: text("service_location"),
  servicePickupLocation: text("service_pickup_location"),
  serviceReturnLocation: text("service_return_location"),
  serviceZone: text("service_zone"),
  serviceStartTime: text("service_start_time"),
  serviceEndTime: text("service_end_time"),
  serviceBudgetAmount: integer("service_budget_amount"),
  serviceLaundryWeightKg: integer("service_laundry_weight_kg"),
  serviceAddonSelections: text("service_addon_selections").array().notNull().default(sql`'{}'::text[]`),
  serviceScheduleSlots: jsonb("service_schedule_slots").$type<ServiceScheduleSlot[]>().notNull().default(sql`'[]'::jsonb`),
  serviceDepartureId: text("service_departure_id"),
  serviceRequestFee: integer("service_request_fee"),
  serviceRequestDetails: text("service_request_details"),
  serviceResponseMessage: text("service_response_message"),
  serviceRequestFeeKes: integer("service_request_fee_kes"),
  stayServiceSelections: jsonb("stay_service_selections").$type<StayServiceSelection[]>().notNull().default(sql`'[]'::jsonb`),
  customMenuProposalStatus: text("custom_menu_proposal_status").notNull().default("pending"),
  customMenuProposedAmount: integer("custom_menu_proposed_amount"),
  customMenuProposalMessage: text("custom_menu_proposal_message"),
  customMenuDeclineReason: text("custom_menu_decline_reason"),
  customMenuClientDecision: text("custom_menu_client_decision").notNull().default("pending"),
  customMenuClientRespondedAt: text("custom_menu_client_responded_at"),
  customMenuCreditCode: text("custom_menu_credit_code"),
  customMenuCreditAmount: integer("custom_menu_credit_amount"),
  customMenuReviewedByUserId: varchar("custom_menu_reviewed_by_user_id"),
  customMenuReviewedAt: text("custom_menu_reviewed_at"),
  experienceCustomOfferStatus: text("experience_custom_offer_status").notNull().default("pending"),
  experienceCustomOfferAmount: integer("experience_custom_offer_amount"),
  experienceCustomOfferMessage: text("experience_custom_offer_message"),
  experienceCustomOfferDeclineReason: text("experience_custom_offer_decline_reason"),
  experienceCustomOfferClientDecision: text("experience_custom_offer_client_decision").notNull().default("pending"),
  experienceCustomOfferClientRespondedAt: text("experience_custom_offer_client_responded_at"),
  experienceCustomOfferReviewedByUserId: varchar("experience_custom_offer_reviewed_by_user_id"),
  experienceCustomOfferReviewedAt: text("experience_custom_offer_reviewed_at"),
  providerStatusRequest: text("provider_status_request"),
  providerStatusRequestNote: text("provider_status_request_note"),
  providerStatusRequestedByUserId: varchar("provider_status_requested_by_user_id"),
  providerStatusRequestedAt: text("provider_status_requested_at"),
  providerStatusReviewedByUserId: varchar("provider_status_reviewed_by_user_id"),
  providerStatusReviewedAt: text("provider_status_reviewed_at"),
  paymentStatus: text("payment_status").notNull().default("paid"),
  paymentProvider: varchar("payment_provider"),
  paymentReference: text("payment_reference"),
  paymentSessionId: text("payment_session_id"),
  paymentCurrency: varchar("payment_currency").notNull().default("USD"),
  paymentAmount: integer("payment_amount"),
  paymentCheckoutAmount: integer("payment_checkout_amount"),
  paymentDepositAmount: integer("payment_deposit_amount"),
  paymentAmountPaid: integer("payment_amount_paid").notNull().default(0),
  paymentHoldExpiresAt: text("payment_hold_expires_at"),
  paidAt: text("paid_at"),
  paymentFailedAt: text("payment_failed_at"),
  totalPrice: integer("total_price").notNull(),
  status: text("status").notNull().default("upcoming"),
  createdAt: text("created_at").notNull(),
  bookingType: text("booking_type").notNull().default("accommodation"), // "accommodation" or "service"
});

export const bookingMessages = pgTable("booking_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull(),
  userId: varchar("user_id").notNull(),
  senderRole: text("sender_role").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

// Client-side booking schema - omits fields that backend injects from session
export const insertBookingSchema = createInsertSchema(bookings).omit({
  id: true,
  createdAt: true,
  userId: true, // Backend injects from session
  guestEmail: true, // Backend injects from session
  paymentStatus: true,
  paymentProvider: true,
  paymentReference: true,
  paymentSessionId: true,
  paymentCurrency: true,
  paymentAmount: true,
  paymentCheckoutAmount: true,
  paymentDepositAmount: true,
  paymentAmountPaid: true,
  paymentHoldExpiresAt: true,
  paidAt: true,
  paymentFailedAt: true,
}).extend({
  accommodationId: z.string().nullable(),
  guestPhone: z.preprocess(
    (value) => (value == null ? undefined : value),
    z.string().optional(),
  ),
  serviceScheduleSlots: z.array(serviceScheduleSlotSchema).optional(),
  stayServiceSelections: z.array(stayServiceSelectionSchema).optional(),
});

export const publicBookingRequestSchema = insertBookingSchema.omit({
  bookingType: true,
  status: true,
  totalPrice: true,
  serviceRequestFee: true,
  serviceRequestFeeKes: true,
  serviceResponseMessage: true,
  customMenuProposalStatus: true,
  customMenuProposedAmount: true,
  customMenuProposalMessage: true,
  customMenuDeclineReason: true,
  customMenuClientDecision: true,
  customMenuClientRespondedAt: true,
  customMenuCreditCode: true,
  customMenuCreditAmount: true,
  customMenuReviewedByUserId: true,
  customMenuReviewedAt: true,
  experienceCustomOfferStatus: true,
  experienceCustomOfferAmount: true,
  experienceCustomOfferMessage: true,
  experienceCustomOfferDeclineReason: true,
  experienceCustomOfferClientDecision: true,
  experienceCustomOfferClientRespondedAt: true,
  experienceCustomOfferReviewedByUserId: true,
  experienceCustomOfferReviewedAt: true,
  providerStatusRequest: true,
  providerStatusRequestNote: true,
  providerStatusRequestedByUserId: true,
  providerStatusRequestedAt: true,
  providerStatusReviewedByUserId: true,
  providerStatusReviewedAt: true,
});

// Server-side schema for validation after injecting session data
export const serverBookingSchema = insertBookingSchema.extend({
  userId: z.string(),
  guestEmail: z.string().email(),
});

export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type PublicBookingRequest = z.infer<typeof publicBookingRequestSchema>;
export type ServerBooking = z.infer<typeof serverBookingSchema>;
export type Booking = typeof bookings.$inferSelect;
export const bookingPaymentSessionRequestSchema = z.object({
  paymentMethod: z.enum(customerPaymentMethods),
});
export type BookingPaymentSessionRequest = z.infer<typeof bookingPaymentSessionRequestSchema>;
export const bookingServiceAssignmentStatuses = ["upcoming", "in-progress", "completed", "cancelled"] as const;
export type BookingServiceAssignmentStatus = typeof bookingServiceAssignmentStatuses[number];
export const bookingServiceAssignments = pgTable("booking_service_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull(),
  providerUserId: varchar("provider_user_id"),
  providerCategory: varchar("provider_category").notNull(),
  serviceId: varchar("service_id").notNull(),
  serviceName: text("service_name").notNull(),
  serviceConfig: jsonb("service_config").$type<BookingAssignmentConfig>().notNull(),
  grossAmount: integer("gross_amount").notNull().default(0),
  status: varchar("status").notNull().default("upcoming"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type BookingServiceAssignment = typeof bookingServiceAssignments.$inferSelect;
export const insertBookingMessageSchema = createInsertSchema(bookingMessages).omit({
  id: true,
  createdAt: true,
  userId: true,
  senderRole: true,
}).extend({
  bookingId: z.string(),
  message: z.string().min(1, "Message is required").max(2000, "Message is too long"),
});
export type InsertBookingMessage = z.infer<typeof insertBookingMessageSchema>;
export type BookingMessage = typeof bookingMessages.$inferSelect;
export const providerNotificationTypes = ["assignment-created", "assignment-reassigned", "assignment-updated"] as const;
export type ProviderNotificationType = typeof providerNotificationTypes[number];
export const providerNotifications = pgTable("provider_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  bookingId: varchar("booking_id"),
  assignmentId: varchar("assignment_id"),
  type: varchar("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type ProviderNotification = typeof providerNotifications.$inferSelect;
export type ProviderBookingAssignmentView = {
  assignment: BookingServiceAssignment;
  booking: Booking;
};
export const appInboxItemTypes = ["assignment-created", "assignment-reassigned", "assignment-updated", "booking-message"] as const;
export type AppInboxItemType = typeof appInboxItemTypes[number];
export const appInboxPriorities = ["low", "normal", "high", "urgent"] as const;
export type AppInboxPriority = typeof appInboxPriorities[number];
export const appInboxDeliveryChannels = ["in-app", "push", "email", "sms"] as const;
export type AppInboxDeliveryChannel = typeof appInboxDeliveryChannels[number];
export type AppInboxDeliveryStatus = "pending" | "delivered" | "failed" | "suppressed";
export type AppInboxDeliveryState = Partial<Record<AppInboxDeliveryChannel, {
  status: AppInboxDeliveryStatus;
  updatedAt: string;
  error?: string | null;
}>>;
export type AppInboxMetadata = Record<string, string | number | boolean | null>;
export const appInboxItems = pgTable("app_inbox_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  actorUserId: varchar("actor_user_id"),
  actorRole: varchar("actor_role"),
  bookingId: varchar("booking_id"),
  assignmentId: varchar("assignment_id"),
  threadKey: text("thread_key"),
  type: varchar("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  actionUrl: text("action_url"),
  priority: varchar("priority").notNull().default("normal"),
  channels: jsonb("channels").$type<AppInboxDeliveryChannel[]>().notNull().default(sql`'["in-app"]'::jsonb`),
  deliveryState: jsonb("delivery_state").$type<AppInboxDeliveryState>().notNull().default(sql`'{}'::jsonb`),
  metadata: jsonb("metadata").$type<AppInboxMetadata>().notNull().default(sql`'{}'::jsonb`),
  isRead: boolean("is_read").notNull().default(false),
  readAt: text("read_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type AppInboxItem = typeof appInboxItems.$inferSelect;
export const pushPlatforms = ["web", "android", "ios"] as const;
export type PushPlatform = typeof pushPlatforms[number];
export const pushProviders = ["web-push", "fcm", "apns"] as const;
export type PushProvider = typeof pushProviders[number];
export const pushPermissionStates = ["default", "granted", "denied"] as const;
export type PushPermissionState = typeof pushPermissionStates[number];
export type UserPushDeviceSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};
export type UserPushDeviceInfo = {
  userAgent?: string | null;
  language?: string | null;
  platformLabel?: string | null;
  appVersion?: string | null;
};
export const userPushDevices = pgTable("user_push_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  platform: varchar("platform").notNull().default("web"),
  provider: varchar("provider").notNull().default("web-push"),
  endpoint: text("endpoint").notNull(),
  subscription: jsonb("subscription").$type<UserPushDeviceSubscription>().notNull(),
  deviceInfo: jsonb("device_info").$type<UserPushDeviceInfo>().notNull().default(sql`'{}'::jsonb`),
  permission: varchar("permission").notNull().default("default"),
  isActive: boolean("is_active").notNull().default(true),
  lastSeenAt: text("last_seen_at").notNull(),
  lastPushSentAt: text("last_push_sent_at"),
  lastPushFailedAt: text("last_push_failed_at"),
  lastPushError: text("last_push_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const insertUserPushDeviceSchema = createInsertSchema(userPushDevices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSeenAt: true,
  lastPushSentAt: true,
  lastPushFailedAt: true,
  lastPushError: true,
  userId: true,
  isActive: true,
}).extend({
  platform: z.enum(pushPlatforms).optional(),
  provider: z.enum(pushProviders).optional(),
  permission: z.enum(pushPermissionStates).default("granted"),
  subscription: z.object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
  deviceInfo: z.object({
    userAgent: z.string().optional().nullable(),
    language: z.string().optional().nullable(),
    platformLabel: z.string().optional().nullable(),
    appVersion: z.string().optional().nullable(),
  }).optional(),
});
export type InsertUserPushDevice = z.infer<typeof insertUserPushDeviceSchema>;
export type UserPushDevice = typeof userPushDevices.$inferSelect;
export const userPushPreferences = pgTable("user_push_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  bookingMessages: boolean("booking_messages").notNull().default(true),
  assignmentAlerts: boolean("assignment_alerts").notNull().default(true),
  marketingEnabled: boolean("marketing_enabled").notNull().default(false),
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const updateUserPushPreferencesSchema = createInsertSchema(userPushPreferences).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
}).partial().extend({
  pushEnabled: z.boolean().optional(),
  bookingMessages: z.boolean().optional(),
  assignmentAlerts: z.boolean().optional(),
  marketingEnabled: z.boolean().optional(),
  quietHoursStart: z.string().optional().nullable(),
  quietHoursEnd: z.string().optional().nullable(),
});
export type UpdateUserPushPreferences = z.infer<typeof updateUserPushPreferencesSchema>;
export type UserPushPreferences = typeof userPushPreferences.$inferSelect;

// Blog Posts
export const blogPosts = pgTable("blog_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  excerpt: text("excerpt").notNull(),
  contentMarkdown: text("content_markdown").notNull(),
  featuredImage: text("featured_image"),
  featuredImageAlt: text("featured_image_alt"),
  author: text("author").notNull(),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  seoKeywords: text("seo_keywords"),
  primaryCtaLabel: text("primary_cta_label"),
  primaryCtaHref: text("primary_cta_href"),
  primaryPromoCode: varchar("primary_promo_code"),
  publishedAt: text("published_at"),
  status: text("status").notNull().default("draft"), // "draft" or "published"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertBlogPostSchema = createInsertSchema(blogPosts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBlogPost = z.infer<typeof insertBlogPostSchema>;
export type BlogPost = typeof blogPosts.$inferSelect;

// Marketing Promos
export const marketingPromos = pgTable("marketing_promos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: varchar("code").unique(),
  description: text("description"),
  promoType: varchar("promo_type").notNull().default("percent"),
  costAbsorption: varchar("cost_absorption").notNull().default("shared"),
  status: varchar("status").notNull().default("draft"),
  channel: varchar("channel").notNull().default("homepage"),
  audience: text("audience"),
  eligibleCategories: text("eligible_categories").array().notNull().default(sql`'{}'::text[]`),
  autoApply: boolean("auto_apply").notNull().default(false),
  requiredCategories: text("required_categories").array().notNull().default(sql`'{}'::text[]`),
  minimumNights: integer("minimum_nights"),
  minimumGuests: integer("minimum_guests"),
  minimumServiceCount: integer("minimum_service_count"),
  bundleLabel: text("bundle_label"),
  discountPercent: integer("discount_percent"),
  discountAmount: integer("discount_amount"),
  minimumSpend: integer("minimum_spend"),
  usageLimit: integer("usage_limit"),
  redemptionCount: integer("redemption_count").notNull().default(0),
  attributedRevenue: integer("attributed_revenue").notNull().default(0),
  landingPath: text("landing_path"),
  startAt: text("start_at"),
  endAt: text("end_at"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const marketingAttributionEvents = pgTable("marketing_attribution_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  eventType: varchar("event_type").notNull(),
  sourceType: varchar("source_type").notNull().default("direct"),
  sourceId: varchar("source_id"),
  sourceSlug: text("source_slug"),
  sourcePath: text("source_path"),
  sourceTitle: text("source_title"),
  promoId: varchar("promo_id"),
  promoCode: varchar("promo_code"),
  promoName: text("promo_name"),
  landingPath: text("landing_path"),
  referrerPath: text("referrer_path"),
  entryPath: text("entry_path"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  createdAt: text("created_at").notNull(),
});

export const bookingAttributions = pgTable("booking_attributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull(),
  sessionId: varchar("session_id"),
  sourceType: varchar("source_type").notNull().default("direct"),
  sourceId: varchar("source_id"),
  sourceSlug: text("source_slug"),
  sourcePath: text("source_path"),
  sourceTitle: text("source_title"),
  promoId: varchar("promo_id"),
  promoCode: varchar("promo_code"),
  promoName: text("promo_name"),
  promoCostAbsorption: varchar("promo_cost_absorption"),
  landingPath: text("landing_path"),
  referrerPath: text("referrer_path"),
  entryPath: text("entry_path"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  originalSubtotal: integer("original_subtotal").notNull().default(0),
  discountAmount: integer("discount_amount").notNull().default(0),
  finalRevenue: integer("final_revenue").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const optionalTrimmedString = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().max(500).nullable().optional(),
);

const optionalManagerUserId = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().nullable().optional(),
);

const optionalDateString = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().nullable().optional(),
);

const optionalPromoCode = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim().toUpperCase();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().max(40).regex(/^[A-Z0-9-]+$/, "Promo code can only contain letters, numbers, and hyphens").nullable().optional(),
);

const optionalNonNegativeInteger = z.preprocess(
  (value) => {
    if (value === "" || value == null) {
      return null;
    }

    return value;
  },
  z.coerce.number().int().min(0).nullable().optional(),
);

const optionalPositiveInteger = z.preprocess(
  (value) => {
    if (value === "" || value == null) {
      return null;
    }

    return value;
  },
  z.coerce.number().int().positive().nullable().optional(),
);

const marketingPromoInputShape = {
  name: z.string().trim().min(2, "Promo name is required").max(120, "Promo name is too long"),
  code: optionalPromoCode,
  description: optionalTrimmedString,
  promoType: z.enum(marketingPromoTypes),
  costAbsorption: z.enum(marketingPromoCostAbsorptions).optional().default("shared"),
  status: z.enum(marketingPromoStatuses),
  channel: z.enum(marketingPromoChannels),
  audience: z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().max(120).nullable().optional(),
  ),
  eligibleCategories: z.array(z.enum(providerCategories)).optional().default([]),
  autoApply: z.boolean().optional().default(false),
  requiredCategories: z.array(z.enum(providerCategories)).optional().default([]),
  minimumNights: optionalPositiveInteger,
  minimumGuests: optionalPositiveInteger,
  minimumServiceCount: optionalPositiveInteger,
  bundleLabel: z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().max(120).nullable().optional(),
  ),
  discountPercent: z.preprocess(
    (value) => {
      if (value === "" || value == null) {
        return null;
      }

      return value;
    },
    z.coerce.number().int().min(0).max(100).nullable().optional(),
  ),
  discountAmount: optionalNonNegativeInteger,
  minimumSpend: optionalNonNegativeInteger,
  usageLimit: optionalPositiveInteger,
  redemptionCount: z.preprocess(
    (value) => {
      if (value === "" || value == null) {
        return 0;
      }

      return value;
    },
    z.coerce.number().int().min(0).default(0),
  ),
  attributedRevenue: z.preprocess(
    (value) => {
      if (value === "" || value == null) {
        return 0;
      }

      return value;
    },
    z.coerce.number().int().min(0).default(0),
  ),
  landingPath: z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().max(200).nullable().optional(),
  ),
  startAt: optionalDateString,
  endAt: optionalDateString,
  notes: optionalTrimmedString,
} satisfies z.ZodRawShape;

const marketingPromoBaseSchema = z.object(marketingPromoInputShape);

export const insertMarketingPromoSchema = marketingPromoBaseSchema.superRefine((value, ctx) => {
  if (value.promoType === "percent" && (!value.discountPercent || value.discountPercent <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["discountPercent"],
      message: "Percent promos need a discount percentage greater than zero",
    });
  }

  if ((value.promoType === "fixed" || value.promoType === "bundle") && (!value.discountAmount || value.discountAmount <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["discountAmount"],
      message: "This promo needs a value amount greater than zero",
    });
  }

  if (value.promoType === "bundle" && !value.bundleLabel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bundleLabel"],
      message: "Bundle promos need a bundle summary",
    });
  }

  if (
    value.promoType === "bundle"
    && value.requiredCategories.length === 0
    && !value.minimumNights
    && !value.minimumGuests
    && !value.minimumServiceCount
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requiredCategories"],
      message: "Bundle promos need at least one qualification rule",
    });
  }

  if (value.landingPath && !value.landingPath.startsWith("/")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["landingPath"],
      message: "Landing path should start with /",
    });
  }

  if (value.startAt && value.endAt && value.startAt > value.endAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endAt"],
      message: "End date must be after the start date",
    });
  }
});

export const updateMarketingPromoSchema = marketingPromoBaseSchema.partial();

export type InsertMarketingPromo = z.infer<typeof insertMarketingPromoSchema>;
export type UpdateMarketingPromo = z.infer<typeof updateMarketingPromoSchema>;
export type MarketingPromo = typeof marketingPromos.$inferSelect;
export const marketingAttributionPayloadSchema = z.object({
  sessionId: z.string().trim().min(8).max(120),
  sourceType: z.enum(marketingAttributionSourceTypes).optional().default("direct"),
  sourceId: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(120).nullable().optional()),
  sourceSlug: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(200).nullable().optional()),
  sourcePath: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(240).nullable().optional()),
  sourceTitle: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(240).nullable().optional()),
  promoCode: optionalPromoCode,
  landingPath: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(240).nullable().optional()),
  referrerPath: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(240).nullable().optional()),
  entryPath: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(240).nullable().optional()),
  utmSource: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(120).nullable().optional()),
  utmMedium: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(120).nullable().optional()),
  utmCampaign: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(120).nullable().optional()),
  utmContent: z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(120).nullable().optional()),
});
export const marketingAttributionEventSchema = marketingAttributionPayloadSchema.extend({
  eventType: z.enum(marketingAttributionEventTypes),
});
export type MarketingAttributionPayload = z.infer<typeof marketingAttributionPayloadSchema>;
export type MarketingAttributionEvent = typeof marketingAttributionEvents.$inferSelect;
export type BookingAttribution = typeof bookingAttributions.$inferSelect;
export type BookingMarketingSummary = {
  promoId: string | null;
  promoName: string | null;
  promoCode: string | null;
  promoCostAbsorption: MarketingPromoCostAbsorption;
  originalSubtotal: number;
  discountAmount: number;
  finalRevenue: number;
};
export type BookingWithMarketing = Booking & {
  marketingAttribution: BookingMarketingSummary | null;
};
export type InsertMarketingAttributionEvent = z.infer<typeof marketingAttributionEventSchema>;
export type MarketingPromoPreview = {
  promoId: string;
  promoName: string;
  promoCode: string | null;
  costAbsorption: MarketingPromoCostAbsorption;
  bundleLabel: string | null;
  description: string | null;
  discountAmount: number;
  originalSubtotal: number;
  discountedSubtotal: number;
  appliedAutomatically: boolean;
  requiredCategories: ProviderCategory[];
  matchedCategories: ProviderCategory[];
  landingPath: string | null;
};
export type MarketingPromoPreviewResult = {
  promo: MarketingPromoPreview | null;
  rejectionReason: string | null;
};
export type MarketingAttributionContentSummary = {
  sourceId: string | null;
  sourceSlug: string | null;
  sourcePath: string | null;
  sourceTitle: string | null;
  viewCount: number;
  clickCount: number;
  bookingCount: number;
  revenue: number;
  discountAmount: number;
};
export type MarketingAttributionPromoSummary = {
  promoId: string | null;
  promoName: string;
  promoCode: string | null;
  bookingCount: number;
  revenue: number;
  discountAmount: number;
};
export type MarketingAttributionSummary = {
  totalTrackedViews: number;
  totalTrackedClicks: number;
  totalAttributedBookings: number;
  totalAttributedRevenue: number;
  totalAttributedDiscount: number;
  topContent: MarketingAttributionContentSummary[];
  topPromos: MarketingAttributionPromoSummary[];
};

// Listings (Admin-managed service listings) - DEPRECATED: Use separate tables below
export const listingCategories = ["stays", "cars", "cooks", "errands"] as const;
export type ListingCategory = typeof listingCategories[number];

export const listings = pgTable("listings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  category: text("category").notNull(), // "stays", "cars", "cooks", "errands"
  price: integer("price").notNull(),
  location: text("location").notNull(),
  imageUrl: text("image_url"),
  galleryUrls: text("gallery_urls").array().notNull().default(sql`'{}'::text[]`),
  mediaType: varchar("media_type").notNull().default("image"),
  isPublic: boolean("is_public").notNull().default(false),
  description: text("description").notNull(),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertListingSchema = createInsertSchema(listings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listings.$inferSelect;

// ===== NEW SEPARATE SERVICE TABLES =====

// Stays
export const stays = pgTable("stays", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  location: text("location").notNull(),
  description: text("description").notNull(),
  price: integer("price").notNull(), // price per night
  rating: integer("rating").notNull().default(5),
  reviewCount: integer("review_count").notNull().default(0),
  maxOccupancy: integer("max_occupancy").notNull(),
  bedrooms: integer("bedrooms").notNull(),
  bathrooms: integer("bathrooms").notNull(),
  imageUrl: text("image_url"),
  galleryUrls: text("gallery_urls").array().notNull().default(sql`'{}'::text[]`),
  mediaType: varchar("media_type").notNull().default("image"),
  isPublic: boolean("is_public").notNull().default(false),
  managerUserId: varchar("manager_user_id"),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertStaySchema = createInsertSchema(stays).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  managerUserId: optionalManagerUserId,
});

export type InsertStay = z.infer<typeof insertStaySchema>;
export type Stay = typeof stays.$inferSelect;

// Stay Reservations (for availability tracking)
export const stayReservations = pgTable("stay_reservations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stayId: varchar("stay_id").notNull(),
  startDate: text("start_date").notNull(), // ISO date string
  endDate: text("end_date").notNull(), // ISO date string
  status: text("status").notNull().default("booked"), // "booked" or "blocked"
  bookingId: varchar("booking_id"), // Optional reference to booking
  createdAt: text("created_at").notNull(),
});

export const insertStayReservationSchema = createInsertSchema(stayReservations).omit({
  id: true,
  createdAt: true,
});

export type InsertStayReservation = z.infer<typeof insertStayReservationSchema>;
export type StayReservation = typeof stayReservations.$inferSelect;

export const carReservations = pgTable("car_reservations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  carId: varchar("car_id").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status").notNull().default("blocked"),
  bookingId: varchar("booking_id"),
  createdAt: text("created_at").notNull(),
});

export const insertCarReservationSchema = createInsertSchema(carReservations).omit({
  id: true,
  createdAt: true,
});

export type InsertCarReservation = z.infer<typeof insertCarReservationSchema>;
export type CarReservation = typeof carReservations.$inferSelect;

export const cookReservations = pgTable("cook_reservations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cookId: varchar("cook_id").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status").notNull().default("blocked"),
  bookingId: varchar("booking_id"),
  createdAt: text("created_at").notNull(),
});

export const insertCookReservationSchema = createInsertSchema(cookReservations).omit({
  id: true,
  createdAt: true,
});

export type InsertCookReservation = z.infer<typeof insertCookReservationSchema>;
export type CookReservation = typeof cookReservations.$inferSelect;

// Cars
export const cars = pgTable("cars", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  model: text("model").notNull(),
  location: text("location").notNull().default(""),
  pricePerDay: integer("price_per_day"),
  priceWithDriver: integer("price_with_driver").notNull(),
  priceWithDriverHourly: integer("price_with_driver_hourly"),
  chauffeurZones: jsonb("chauffeur_zones").$type<CarZoneRate[]>().notNull().default(sql`'[]'::jsonb`),
  selfDriveMileageLimitKm: integer("self_drive_mileage_limit_km"),
  selfDriveExtraKmRate: integer("self_drive_extra_km_rate"),
  seats: integer("seats").notNull(),
  transmission: text("transmission").notNull(), // "automatic" or "manual"
  description: text("description").notNull(),
  rating: integer("rating").notNull().default(5),
  reviewCount: integer("review_count").notNull().default(0),
  imageUrl: text("image_url"),
  galleryUrls: text("gallery_urls").array().notNull().default(sql`'{}'::text[]`),
  mediaType: varchar("media_type").notNull().default("image"),
  isPublic: boolean("is_public").notNull().default(false),
  managerUserId: varchar("manager_user_id"),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertCarSchema = createInsertSchema(cars).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  chauffeurZones: z.array(carZoneRateSchema).optional(),
  managerUserId: optionalManagerUserId,
});

export type InsertCar = z.infer<typeof insertCarSchema>;
export type Car = typeof cars.$inferSelect;

// Cooks
export const cooks = pgTable("cooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(), // e.g., "Chef John Doe"
  location: text("location").notNull().default(""),
  serviceType: text("service_type").notNull().default("Private chef experience"),
  speciality: text("speciality").notNull(), // e.g., "Italian Cuisine"
  maxGuests: integer("max_guests").notNull().default(2),
  minimumGuests: integer("minimum_guests").notNull().default(2),
  pricePerSession: integer("price_per_session").notNull(),
  serviceFee: integer("service_fee").notNull().default(0),
  inclusivePrice: integer("inclusive_price").notNull().default(0),
  extraGuestServiceFee: integer("extra_guest_service_fee").notNull().default(0),
  extraGuestInclusivePrice: integer("extra_guest_inclusive_price").notNull().default(0),
  ingredientsIncluded: boolean("ingredients_included").notNull().default(true),
  shoppingIncluded: boolean("shopping_included").notNull().default(true),
  customMenuEnabled: boolean("custom_menu_enabled").notNull().default(true),
  customMenuRequestFee: integer("custom_menu_request_fee").notNull().default(customMenuRequestFeeDefault),
  customMenuRequestFeeKes: integer("custom_menu_request_fee_kes").notNull().default(customMenuRequestFeeKesDefault),
  description: text("description").notNull(),
  sampleMenus: text("sample_menus").array().notNull().default(sql`'{}'::text[]`),
  rating: integer("rating").notNull().default(5),
  reviewCount: integer("review_count").notNull().default(0),
  imageUrl: text("image_url"),
  galleryUrls: text("gallery_urls").array().notNull().default(sql`'{}'::text[]`),
  mediaType: varchar("media_type").notNull().default("image"),
  isPublic: boolean("is_public").notNull().default(false),
  managerUserId: varchar("manager_user_id"),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertCookSchema = createInsertSchema(cooks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  managerUserId: optionalManagerUserId,
});

export type InsertCook = z.infer<typeof insertCookSchema>;
export type Cook = typeof cooks.$inferSelect;

// Errands
export const errands = pgTable("errands", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceName: text("service_name").notNull(), // e.g., "Grocery Shopping"
  location: text("location").notNull().default(""),
  basePrice: integer("base_price").notNull(),
  shoppingEnabled: boolean("shopping_enabled").notNull().default(false),
  shoppingCommissionPercent: integer("shopping_commission_percent").notNull().default(10),
  laundryEnabled: boolean("laundry_enabled").notNull().default(false),
  houseCleaningEnabled: boolean("house_cleaning_enabled").notNull().default(false),
  laundryIncludedKg: integer("laundry_included_kg").notNull().default(0),
  laundryPricePerKg: integer("laundry_price_per_kg").notNull().default(0),
  laundryAddons: jsonb("laundry_addons").$type<ErrandAddon[]>().notNull().default(sql`'[]'::jsonb`),
  houseCleaningAddons: jsonb("house_cleaning_addons").$type<ErrandAddon[]>().notNull().default(sql`'[]'::jsonb`),
  helpMamaPricing: jsonb("help_mama_pricing").$type<HelpMamaPricing>().notNull().default(sql`'{"enabled":false,"hourlyDaytimePrice":0,"hourlyEveningPrice":0,"overnightPrice":0,"fullDayPrice":0,"ageBands":[]}'::jsonb`),
  description: text("description").notNull(),
  rating: integer("rating").notNull().default(5),
  reviewCount: integer("review_count").notNull().default(0),
  imageUrl: text("image_url"),
  galleryUrls: text("gallery_urls").array().notNull().default(sql`'{}'::text[]`),
  mediaType: varchar("media_type").notNull().default("image"),
  isPublic: boolean("is_public").notNull().default(false),
  managerUserId: varchar("manager_user_id"),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertErrandSchema = createInsertSchema(errands).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  basePrice: z.coerce.number().int().min(0),
  helpMamaPricing: helpMamaPricingSchema.optional(),
  managerUserId: optionalManagerUserId,
});

export type InsertErrand = z.infer<typeof insertErrandSchema>;
export type Errand = typeof errands.$inferSelect;

// Experiences
export const experiences = pgTable("experiences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  location: text("location").notNull().default(""),
  experienceLocation: text("experience_location").notNull().default(""),
  experienceType: text("experience_type").notNull().default("Curated experience"),
  price: integer("price").notNull().default(0),
  durationHours: integer("duration_hours").notNull().default(3),
  minGuests: integer("min_guests").notNull().default(1),
  maxGuests: integer("max_guests").notNull().default(10),
  meetingPoint: text("meeting_point"),
  inclusions: text("inclusions").array().notNull().default(sql`'{}'::text[]`),
  exclusions: text("exclusions").array().notNull().default(sql`'{}'::text[]`),
  customQuoteEnabled: boolean("custom_quote_enabled").notNull().default(false),
  privateEnabled: boolean("private_enabled").notNull().default(true),
  sharedEnabled: boolean("shared_enabled").notNull().default(false),
  privatePricePerPerson: integer("private_price_per_person").notNull().default(0),
  privateMinimumGuests: integer("private_minimum_guests").notNull().default(2),
  privateAddons: jsonb("private_addons").$type<ExperienceAddon[]>().notNull().default(sql`'[]'::jsonb`),
  sharedPricePerPerson: integer("shared_price_per_person").notNull().default(0),
  sharedMinimumGuests: integer("shared_minimum_guests").notNull().default(4),
  sharedMaxCapacity: integer("shared_max_capacity").notNull().default(10),
  sharedAddons: jsonb("shared_addons").$type<ExperienceAddon[]>().notNull().default(sql`'[]'::jsonb`),
  sharedDepartures: jsonb("shared_departures").$type<ExperienceDeparture[]>().notNull().default(sql`'[]'::jsonb`),
  description: text("description").notNull(),
  rating: integer("rating").notNull().default(5),
  reviewCount: integer("review_count").notNull().default(0),
  imageUrl: text("image_url"),
  galleryUrls: text("gallery_urls").array().notNull().default(sql`'{}'::text[]`),
  mediaType: varchar("media_type").notNull().default("image"),
  isPublic: boolean("is_public").notNull().default(false),
  managerUserId: varchar("manager_user_id"),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertExperienceSchema = createInsertSchema(experiences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  managerUserId: optionalManagerUserId,
});

export type InsertExperience = z.infer<typeof insertExperienceSchema>;
export type Experience = typeof experiences.$inferSelect;

// Analytics Types
export const dashboardServiceKeys = ["stays", "cars", "cooks", "errands", "experiences", "custom"] as const;
export type DashboardServiceKey = typeof dashboardServiceKeys[number];

export type DashboardServiceBreakdownItem = {
  key: DashboardServiceKey;
  label: string;
  bookingCount: number;
  activeBookings: number;
  cancelledBookings: number;
  grossRevenue: number;
};

export type DashboardTopServiceItem = {
  serviceId: string;
  serviceName: string;
  category: DashboardServiceKey;
  categoryLabel: string;
  bookingCount: number;
  activeBookings: number;
  grossRevenue: number;
};

export type DashboardRevenuePoint = {
  month: string;
  label: string;
  revenue: number;
  bookingCount: number;
};

export type DashboardRecentBooking = {
  id: string;
  guestName: string;
  guestEmail: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  bookingType: string;
  status: string;
  grossRevenue: number;
  serviceLabels: string[];
  createdAt: string;
  hasMessages: boolean;
  needsAttention: boolean;
};

export type DashboardMetrics = {
  totalBookings: number;
  activeBookings: number;
  pendingBookings: number;
  cancelledBookings: number;
  completedBookings: number;
  lateBookings: number;
  totalRevenue: number;
  estimatedProviderPayouts: number;
  estimatedPlatformProfit: number;
  ongoingChats: number;
  unansweredChats: number;
  openTasks: number;
  resolvedTasks: number;
  pendingProviderUpdates: number;
  pendingCustomMenuApprovals: number;
  pendingExperienceOfferApprovals: number;
  accommodationBookings: number;
  serviceOnlyBookings: number;
  serviceBreakdown: DashboardServiceBreakdownItem[];
  topServices: DashboardTopServiceItem[];
  revenueTrend: DashboardRevenuePoint[];
  recentBookings: DashboardRecentBooking[];
};

export type PopularService = {
  serviceId: string;
  serviceName: string;
  bookingCount: number;
};

export type RevenueByMonth = {
  month: string;
  revenue: number;
  bookingCount: number;
};

export const reviewTargetTypes = ["stay", "car", "cook", "errand", "experience"] as const;
export type ReviewTargetType = typeof reviewTargetTypes[number];

export const reviews = pgTable("reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull(),
  userId: varchar("user_id").notNull(),
  targetType: varchar("target_type").notNull(),
  targetId: varchar("target_id").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertReviewSchema = createInsertSchema(reviews).omit({
  id: true,
  bookingId: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  rating: z.coerce.number().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;

export const payoutStatuses = ["pending", "approved", "paid", "cancelled"] as const;
export type PayoutStatus = typeof payoutStatuses[number];
export const payoutMethods = ["bank-transfer", "mobile-money", "cash", "card", "other"] as const;
export type PayoutMethod = typeof payoutMethods[number];

export const providerCommissionSettings = pgTable("provider_commission_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerUserId: varchar("provider_user_id").notNull(),
  providerCategory: varchar("provider_category").notNull(),
  commissionPercent: integer("commission_percent").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ProviderCommissionSetting = typeof providerCommissionSettings.$inferSelect;

export const bookingPayouts = pgTable("booking_payouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assignmentId: varchar("assignment_id"),
  bookingId: varchar("booking_id").notNull(),
  providerUserId: varchar("provider_user_id").notNull(),
  providerCategory: varchar("provider_category").notNull(),
  serviceId: varchar("service_id").notNull(),
  serviceName: text("service_name").notNull(),
  guestName: text("guest_name").notNull(),
  grossAmount: integer("gross_amount").notNull(),
  commissionPercent: integer("commission_percent").notNull().default(0),
  commissionAmount: integer("commission_amount").notNull().default(0),
  payoutAmount: integer("payout_amount").notNull().default(0),
  status: varchar("status").notNull().default("pending"),
  dueAt: text("due_at"),
  paidAt: text("paid_at"),
  paymentMethod: varchar("payment_method"),
  paymentReference: text("payment_reference"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type BookingPayout = typeof bookingPayouts.$inferSelect;

export type AdminCommissionSettingSummary = {
  providerUserId: string;
  providerName: string;
  providerEmail: string;
  providerCategory: ProviderCategory;
  commissionPercent: number;
  notes: string | null;
  assignedListings: number;
  isConfigured: boolean;
};

export type AdminBookingPayout = {
  id: string;
  assignmentId: string | null;
  bookingId: string;
  providerUserId: string;
  providerName: string;
  providerEmail: string;
  providerCategory: ProviderCategory;
  serviceId: string;
  serviceName: string;
  guestName: string;
  grossAmount: number;
  commissionPercent: number;
  commissionAmount: number;
  payoutAmount: number;
  status: PayoutStatus;
  dueAt: string | null;
  paidAt: string | null;
  paymentMethod: PayoutMethod | null;
  paymentReference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  marketingAttribution: BookingMarketingSummary | null;
};

export type PaymentManagementData = {
  totalGrossTracked: number;
  totalCommissionTracked: number;
  totalPendingPayouts: number;
  totalApprovedPayouts: number;
  totalPaidOut: number;
  unpaidPayoutCount: number;
  paidPayoutCount: number;
  partnersNeedingCommissionSetup: number;
  commissionSettings: AdminCommissionSettingSummary[];
  payouts: AdminBookingPayout[];
};

export type ProviderPaymentData = {
  totalGrossTracked: number;
  totalCommissionRetained: number;
  totalProjectedPayouts: number;
  totalPendingPayouts: number;
  totalApprovedPayouts: number;
  totalPaidOut: number;
  unpaidPayoutCount: number;
  paidPayoutCount: number;
  serviceFeePercents: number[];
  payouts: AdminBookingPayout[];
};

// Admin Clients Types
export type ServiceSummary = {
  type: "accommodation" | "car" | "cook" | "errand" | "experience";
  id: string;
  title: string;
};

export type BookingWithServices = Omit<Booking, "selectedServices"> & {
  services: ServiceSummary[];
};

export type ClientUser = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
} | null;

export type ClientWithBookings = {
  user: ClientUser;
  contactEmail: string;
  contactName: string;
  bookings: BookingWithServices[];
};

export type ProviderAccountSummary = {
  id: string;
  email: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  providerType: ProviderCategory | null;
  providerTypes: ProviderCategory[];
  isSuspended: boolean;
  warningCount: number;
  moderationNote: string | null;
  averageRating: number | null;
  totalReviewCount: number;
  assignedStayIds: string[];
  assignedStayTitles: string[];
  assignedCarIds: string[];
  assignedCarTitles: string[];
  assignedCookIds: string[];
  assignedCookTitles: string[];
  assignedErrandIds: string[];
  assignedErrandTitles: string[];
  assignedExperienceIds: string[];
  assignedExperienceTitles: string[];
};
