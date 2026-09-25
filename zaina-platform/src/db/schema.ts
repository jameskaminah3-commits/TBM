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

export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
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

export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: text("business_id").notNull(),
  managedBy: text("managed_by").notNull().default("AI"),
  assignedAgentId: text("assigned_agent_id"),
  handoffReason: text("handoff_reason"),
  handoffAt: timestamp("handoff_at", { withTimezone: true, mode: "date" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
  callbackRequestedAt: timestamp("callback_requested_at", { withTimezone: true, mode: "date" }),
  displayCurrency: text("display_currency").notNull().default("USD"),
  visitorKey: text("visitor_key"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  turnLockId: uuid("turn_lock_id"),
  turnLockUntil: timestamp("turn_lock_until", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
export type ChatSession = typeof chatSessions.$inferSelect;

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
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.businessId, table.userId] })]);

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
