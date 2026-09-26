// zaina-platform/src/db/schema.ts
//
// The platform's tables, as Drizzle sees them. The SQL in ../../migrations is
// the source of truth; keep these definitions in step with it.

import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export type StaffedHours = { days: number[]; open: string; close: string };

/** Which tools Zaina gets: see engine/tool-sets.ts. */
export const businessTypes = ["general", "travel_concierge", "guesthouse", "salon", "restaurant"] as const;
export type BusinessType = (typeof businessTypes)[number];
/** The types that take bookings and payments through the platform: nights (guesthouse) or time slots (salon, restaurant). */
export const bookingBusinessTypes: readonly BusinessType[] = ["guesthouse", "salon", "restaurant"];
export const takesBookings = (type: BusinessType) => bookingBusinessTypes.includes(type);
export const booksTime = (type: BusinessType) => type === "salon" || type === "restaurant";

/** The languages Zaina answers in; fixed texts exist in each. */
export const chatLanguages = ["en", "sw"] as const;
export type ChatLanguage = (typeof chatLanguages)[number];

export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  businessType: text("business_type").$type<BusinessType>().notNull().default("general"),
  publicKey: text("public_key").notNull(),
  allowedOrigins: text("allowed_origins").array().notNull().default([]),
  timeZone: text("time_zone").notNull().default("Africa/Nairobi"),
  staffedHours: jsonb("staffed_hours").$type<StaffedHours | null>(),
  unclaimedTimeoutMinutes: integer("unclaimed_timeout_minutes").notNull().default(10),
  dailyTokenCap: bigint("daily_token_cap", { mode: "number" }),
  retentionDays: integer("retention_days"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
export type Business = typeof businesses.$inferSelect;

/** Where a conversation happens. */
export const channels = ["web", "whatsapp"] as const;
export type Channel = (typeof channels)[number];

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: text("business_id").notNull(),
  managedBy: text("managed_by").notNull().default("AI"),
  assignedAgentId: text("assigned_agent_id"),
  handoffReason: text("handoff_reason"),
  handoffAt: at("handoff_at"),
  claimedAt: at("claimed_at"),
  callbackRequestedAt: at("callback_requested_at"),
  displayCurrency: text("display_currency").notNull().default("USD"),
  language: text("language").$type<ChatLanguage>().notNull().default("en"),
  visitorKey: text("visitor_key"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  turnLockId: uuid("turn_lock_id"),
  turnLockUntil: at("turn_lock_until"),
  channel: text("channel").$type<Channel>().notNull().default("web"),
  customerAddress: text("customer_address"),
  customerName: text("customer_name"),
  customerLastMessageAt: at("customer_last_message_at"),
  deliveredEventId: bigint("delivered_event_id", { mode: "number" }).notNull().default(0),
  deliveryLockUntil: at("delivery_lock_until"),
  followupSentAt: at("followup_sent_at"),
  firstHandoffAt: at("first_handoff_at"),
  claimedBy: uuid("claimed_by"),
  routedTo: uuid("routed_to"),
  routedAt: at("routed_at"),
  teamAlertedAt: at("team_alerted_at"),
  createdAt: createdAt(),
  updatedAt: at("updated_at").notNull().defaultNow(),
  lastActivityAt: at("last_activity_at").notNull().defaultNow(),
});
export type ChatSession = typeof chatSessions.$inferSelect;

/** Something the customer sent that isn't text, by its channel's media id. */
export type ChatMedia = { kind: string; id: string; mimeType?: string | null; caption?: string | null; fileName?: string | null };

export const chatEvents = pgTable("chat_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  businessId: text("business_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  createdAt: createdAt(),
  actor: text("actor").notNull(),
  content: text("content"),
  toolName: text("tool_name"),
  toolArguments: jsonb("tool_arguments"),
  toolResponse: jsonb("tool_response"),
  media: jsonb("media").$type<ChatMedia[] | null>(),
  /** The staff member who wrote a team reply. */
  author: uuid("author"),
});
export type ChatEvent = typeof chatEvents.$inferSelect;

export const turnMetrics = pgTable("turn_metrics", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  businessId: text("business_id").notNull(),
  sessionId: uuid("session_id"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  modelMs: integer("model_ms").notNull().default(0),
  toolMs: integer("tool_ms").notNull().default(0),
  modelCalls: integer("model_calls").notNull().default(0),
  modelRetries: integer("model_retries").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  tools: text("tools").array().notNull().default([]),
  outcome: text("outcome").notNull(),
  error: text("error"),
});

export const usageDaily = pgTable("usage_daily", {
  businessId: text("business_id").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  turns: integer("turns").notNull().default(0),
  capAlertSentAt: timestamp("cap_alert_sent_at", { withTimezone: true, mode: "date" }),
}, (table) => [primaryKey({ columns: [table.businessId, table.day] })]);

export const paymentClaims = pgTable("payment_claims", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  businessId: text("business_id").notNull(),
  sessionId: uuid("session_id"),
  bookingRef: text("booking_ref").notNull(),
  method: text("method").notNull().default("mpesa"),
  code: text("code").notNull(),
  expectedAmount: text("expected_amount"),
  status: text("status").notNull().default("recorded"),
  note: text("note"),
  createdAt: createdAt(),
});

export const staffRoles = ["owner", "manager", "agent", "viewer"] as const;
export type StaffRole = (typeof staffRoles)[number];

export const staffUsers = pgTable("staff_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  tokenVersion: integer("token_version").notNull().default(1),
  disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
export type StaffUser = typeof staffUsers.$inferSelect;

export const staffMemberships = pgTable("staff_memberships", {
  businessId: text("business_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").$type<StaffRole>().notNull(),
  alertEmail: boolean("alert_email").notNull().default(true),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.businessId, table.userId] })]);

export const staffPresence = pgTable("staff_presence", {
  businessId: text("business_id").notNull(),
  userId: uuid("user_id").notNull(),
  available: boolean("available").notNull().default(false),
  lastSeenAt: at("last_seen_at").notNull().defaultNow(),
  lastRoutedAt: at("last_routed_at"),
}, (table) => [primaryKey({ columns: [table.businessId, table.userId] })]);

export const staffPushSubscriptions = pgTable("staff_push_subscriptions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  lastUsedAt: at("last_used_at"),
});

export const businessSettings = pgTable("business_settings", {
  businessId: text("business_id").primaryKey(),
  displayName: text("display_name").notNull(),
  assistantName: text("assistant_name").notNull().default("Zaina"),
  about: text("about").notNull().default(""),
  contactPhone: text("contact_phone"),
  contactPhoneDisplay: text("contact_phone_display"),
  websiteUrl: text("website_url"),
  supportEmail: text("support_email"),
  allowedLinkHosts: text("allowed_link_hosts").array().notNull().default([]),
  allowedLinkHostSuffixes: text("allowed_link_host_suffixes").array().notNull().default([]),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  widgetColor: text("widget_color").notNull().default("#0f766e"),
  widgetPosition: text("widget_position").$type<"right" | "left">().notNull().default("right"),
  widgetGreeting: text("widget_greeting"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});
export type BusinessSettings = typeof businessSettings.$inferSelect;

export const businessSecrets = pgTable("business_secrets", {
  businessId: text("business_id").notNull(),
  name: text("name").notNull(),
  ciphertext: bytea("ciphertext").notNull(),
  iv: bytea("iv").notNull(),
  authTag: bytea("auth_tag").notNull(),
  keyId: text("key_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
}, (table) => [primaryKey({ columns: [table.businessId, table.name] })]);

export const leads = pgTable("leads", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  businessId: text("business_id").notNull(),
  sessionId: uuid("session_id"),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  interest: text("interest"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const knowledgeKinds = ["page", "faq", "policy", "guide", "menu", "document"] as const;
export type KnowledgeKind = (typeof knowledgeKinds)[number];

export const knowledgeSources = pgTable("knowledge_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: text("business_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind").$type<KnowledgeKind>().notNull().default("page"),
  url: text("url"),
  language: text("language").$type<ChatLanguage>().notNull().default("en"),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  status: text("status").$type<"published" | "draft">().notNull().default("published"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});
export type KnowledgeSource = typeof knowledgeSources.$inferSelect;

export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  businessId: text("business_id").notNull(),
  sourceId: uuid("source_id").notNull(),
  position: integer("position").notNull(),
  heading: text("heading"),
  content: text("content").notNull(),
});

export const knowledgeMisses = pgTable("knowledge_misses", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  businessId: text("business_id").notNull(),
  sessionId: uuid("session_id"),
  query: text("query").notNull(),
  createdAt: createdAt(),
});

export const followupParameters = ["none", "business_name", "customer_name"] as const;
export type FollowupParameter = (typeof followupParameters)[number];

export const whatsappNumbers = pgTable("whatsapp_numbers", {
  businessId: text("business_id").primaryKey(),
  phoneNumberId: text("phone_number_id").notNull(),
  wabaId: text("waba_id"),
  displayPhoneNumber: text("display_phone_number"),
  verifiedName: text("verified_name"),
  followupTemplate: text("followup_template"),
  followupTemplateLanguage: text("followup_template_language").notNull().default("en"),
  followupTemplateParameter: text("followup_template_parameter").$type<FollowupParameter>().notNull().default("none"),
  status: text("status").$type<"active" | "paused">().notNull().default("active"),
  connectedAt: at("connected_at").notNull().defaultNow(),
  connectedBy: uuid("connected_by"),
  updatedAt: at("updated_at").notNull().defaultNow(),
});
export type WhatsappNumber = typeof whatsappNumbers.$inferSelect;

export const whatsappInbound = pgTable("whatsapp_inbound", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  businessId: text("business_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  messageId: text("message_id").notNull(),
  kind: text("kind").notNull(),
  body: text("body"),
  media: jsonb("media").$type<ChatMedia | null>(),
  receivedAt: at("received_at").notNull().defaultNow(),
  status: text("status").$type<"pending" | "processing" | "done" | "ignored" | "failed">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  processedAt: at("processed_at"),
});

export const whatsappOutbound = pgTable("whatsapp_outbound", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  businessId: text("business_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  eventId: bigint("event_id", { mode: "number" }),
  messageId: text("message_id"),
  kind: text("kind").$type<"text" | "template">().notNull(),
  status: text("status").$type<"sent" | "delivered" | "read" | "failed">().notNull().default("sent"),
  errorCode: integer("error_code"),
  errorTitle: text("error_title"),
  createdAt: createdAt(),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

// ── Phase 4: rooms, bookings and payments (migration 0007) ─────────────

export const bookingCurrencies = ["KES", "USD"] as const;
export type BookingCurrency = (typeof bookingCurrencies)[number];

/** How a business takes deposits; not_set until it has chosen (then nothing is charged online). */
export const depositTypes = ["not_set", "none", "percent", "fixed", "full"] as const;
export type DepositType = (typeof depositTypes)[number];

/** The ways to pay a payment page can offer, in the business's order. */
export const paymentWays = ["mpesa_express", "paystack", "mpesa_manual", "pay_at_venue"] as const;
export type PaymentWay = (typeof paymentWays)[number];

/** room_type: nights in a place to stay; service: an appointment (a haircut); table: a table booking. */
export const offeringKinds = ["room_type", "service", "table"] as const;
export type OfferingKind = (typeof offeringKinds)[number];

export const bookingModes = ["instant", "request", "enquiry"] as const;
export type BookingMode = (typeof bookingModes)[number];

export const bookingSettings = pgTable("booking_settings", {
  businessId: text("business_id").primaryKey(),
  currency: text("currency").$type<BookingCurrency>().notNull().default("KES"),
  depositPercent: integer("deposit_percent").notNull().default(30),
  holdMinutes: integer("hold_minutes").notNull().default(30),
  requestHoldHours: integer("request_hold_hours").notNull().default(24),
  checkInTime: text("check_in_time").notNull().default("14:00"),
  checkOutTime: text("check_out_time").notNull().default("10:00"),
  cancellationPolicy: text("cancellation_policy"),
  taxName: text("tax_name"),
  taxPercent: text("tax_percent"),
  taxIncluded: boolean("tax_included").notNull().default(true),
  paystackMode: text("paystack_mode").$type<"off" | "own_keys" | "subaccount">().notNull().default("off"),
  paystackSubaccount: text("paystack_subaccount"),
  mpesaExpress: boolean("mpesa_express").notNull().default(false),
  mpesaEnvironment: text("mpesa_environment").$type<"sandbox" | "production">().notNull().default("production"),
  mpesaType: text("mpesa_type").$type<"paybill" | "till" | null>(),
  mpesaShortcode: text("mpesa_shortcode"),
  mpesaTill: text("mpesa_till"),
  mpesaManualType: text("mpesa_manual_type").$type<"paybill" | "till" | null>(),
  mpesaManualNumber: text("mpesa_manual_number"),
  mpesaManualAccount: text("mpesa_manual_account"),
  payAtVenue: boolean("pay_at_venue").notNull().default(false),
  openingHours: jsonb("opening_hours").$type<WeekHours>().notNull().default({}),
  slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(30),
  depositType: text("deposit_type").$type<DepositType>().notNull().default("not_set"),
  depositFixedMinor: bigint("deposit_fixed_minor", { mode: "number" }),
  paymentOrder: text("payment_order").array().$type<PaymentWay[]>().notNull().default([]),
  methodMaxMinor: jsonb("method_max_minor").$type<Partial<Record<PaymentWay, number>>>().notNull().default({}),
  acceptedHoldHours: integer("accepted_hold_hours").notNull().default(24),
  paymentHoldMinutes: integer("payment_hold_minutes").notNull().default(15),
  codeCheckHours: integer("code_check_hours").notNull().default(12),
  bookingHorizonDays: integer("booking_horizon_days").notNull().default(548),
  maxNights: integer("max_nights").notNull().default(30),
  minNoticeHours: integer("min_notice_hours").notNull().default(0),
  payAttemptsLimit: integer("pay_attempts_limit").notNull().default(12),
  mpesaPromptsLimit: integer("mpesa_prompts_limit").notNull().default(3),
  rulesConfirmedAt: at("rules_confirmed_at"),
  updatedAt: at("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});
export type BookingSettings = typeof bookingSettings.$inferSelect;

export const offerings = pgTable("offerings", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: text("business_id").notNull(),
  kind: text("kind").$type<OfferingKind>().notNull().default("room_type"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  units: integer("units").notNull(),
  maxGuests: integer("max_guests").notNull(),
  bookingMode: text("booking_mode").$type<BookingMode>().notNull().default("instant"),
  pricing: jsonb("pricing").$type<Record<string, unknown>>().notNull(),
  /** A service or table booking's length, and the time after it before its resource is free. */
  durationMinutes: integer("duration_minutes"),
  bufferMinutes: integer("buffer_minutes").notNull().default(0),
  minParty: integer("min_party").notNull().default(1),
  status: text("status").$type<"active" | "hidden">().notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: at("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});
export type Offering = typeof offerings.$inferSelect;

export const offeringBlocks = pgTable("offering_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: text("business_id").notNull(),
  offeringId: uuid("offering_id").notNull(),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }).notNull(),
  units: integer("units").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: createdAt(),
  createdBy: uuid("created_by"),
});
export type OfferingBlock = typeof offeringBlocks.$inferSelect;

/** A business's week: for each weekday (0 Sunday … 6 Saturday) the times it is open, like [["09:00", "13:00"], ["14:00", "18:00"]]. */
export type WeekHours = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", Array<[string, string]>>>;

export const resourceKinds = ["staff", "chair", "table", "room", "other"] as const;
export type ResourceKind = (typeof resourceKinds)[number];

export const resources = pgTable("resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: text("business_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<ResourceKind>().notNull(),
  seats: integer("seats").notNull().default(1),
  minParty: integer("min_party").notNull().default(1),
  hours: jsonb("hours").$type<WeekHours | null>(),
  status: text("status").$type<"active" | "hidden">().notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: at("updated_at").notNull().defaultNow(),
});
export type Resource = typeof resources.$inferSelect;

export const offeringResources = pgTable("offering_resources", {
  businessId: text("business_id").notNull(),
  offeringId: uuid("offering_id").notNull(),
  resourceId: uuid("resource_id").notNull(),
});

export const resourceBlocks = pgTable("resource_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: text("business_id").notNull(),
  resourceId: uuid("resource_id"),
  startsAt: at("starts_at").notNull(),
  endsAt: at("ends_at").notNull(),
  reason: text("reason").notNull().default(""),
  source: text("source").$type<"staff" | "calendar">().notNull().default("staff"),
  externalId: text("external_id"),
  createdAt: createdAt(),
  createdBy: uuid("created_by"),
});
export type ResourceBlock = typeof resourceBlocks.$inferSelect;

export const bookingStatuses = ["held", "requested", "awaiting_payment", "confirmed", "conflict", "declined", "cancelled", "expired"] as const;
export type BookingStatus = (typeof bookingStatuses)[number];

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: text("business_id").notNull(),
  reference: text("reference").notNull(),
  offeringId: uuid("offering_id").notNull(),
  checkIn: date("check_in", { mode: "string" }).notNull(),
  checkOut: date("check_out", { mode: "string" }).notNull(),
  units: integer("units").notNull().default(1),
  guests: integer("guests").notNull(),
  /** A time-slot booking: when it starts and ends, when its resource is free again, and which resource. */
  startsAt: at("starts_at"),
  endsAt: at("ends_at"),
  busyUntil: at("busy_until"),
  resourceId: uuid("resource_id"),
  status: text("status").$type<BookingStatus>().notNull(),
  holdExpiresAt: at("hold_expires_at"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  customerNotes: text("customer_notes"),
  quote: jsonb("quote").$type<Record<string, unknown>>().notNull(),
  currency: text("currency").$type<BookingCurrency>().notNull(),
  totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
  depositMinor: bigint("deposit_minor", { mode: "number" }).notNull(),
  paidMinor: bigint("paid_minor", { mode: "number" }).notNull().default(0),
  payToken: text("pay_token").notNull(),
  source: text("source").$type<"chat" | "staff">().notNull(),
  sessionId: uuid("session_id"),
  idempotencyKey: text("idempotency_key"),
  conflict: text("conflict"),
  staffNote: text("staff_note"),
  decidedBy: uuid("decided_by"),
  confirmedAt: at("confirmed_at"),
  cancelledAt: at("cancelled_at"),
  createdAt: createdAt(),
  updatedAt: at("updated_at").notNull().defaultNow(),
});
export type Booking = typeof bookings.$inferSelect;

export const paymentMethods = ["paystack", "mpesa_express", "mpesa_code", "cash", "bank", "other"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: text("business_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  method: text("method").$type<PaymentMethod>().notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").$type<BookingCurrency>().notNull(),
  status: text("status").$type<"pending" | "succeeded" | "failed" | "rejected">().notNull(),
  providerReference: text("provider_reference"),
  receipt: text("receipt"),
  payerPhone: text("payer_phone"),
  payerEmail: text("payer_email"),
  failure: text("failure"),
  callbackToken: text("callback_token"),
  recordedBy: uuid("recorded_by"),
  createdAt: createdAt(),
  settledAt: at("settled_at"),
  updatedAt: at("updated_at").notNull().defaultNow(),
});
export type Payment = typeof payments.$inferSelect;
