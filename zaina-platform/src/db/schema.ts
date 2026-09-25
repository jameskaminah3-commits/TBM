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
export const businessTypes = ["general", "travel_concierge", "guesthouse"] as const;
export type BusinessType = (typeof businessTypes)[number];

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
