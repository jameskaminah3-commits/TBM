// zaina-platform/src/config.ts
//
// Everything the service reads from its environment, checked once at start.
// A missing or weak secret stops the service instead of running unprotected.

import { appAddressProblem, describeDatabaseUrl, parseDatabaseCa } from "./db/connection.ts";

export type RateLimits = {
  /** Messages one chat session may send per minute. */
  sessionMessagesPerMinute: number;
  /** Messages one visitor (IP address) may send per 10 minutes, across sessions. */
  visitorMessagesPer10Minutes: number;
  /** Chat sessions one visitor may open per hour. */
  visitorSessionsPerHour: number;
  /** Messages a whole business may receive per hour. */
  businessMessagesPerHour: number;
};

export type WhatsappConfig = {
  /** The Meta app's secret: every webhook delivery is signed with it. */
  appSecret: string;
  /** What Meta sends back when the webhook is set up (hub.verify_token). */
  verifyToken: string;
  /** Graph API version, e.g. v23.0. */
  graphVersion: string;
  /** How long to wait for more messages from the same customer before answering. */
  batchMs: number;
};

export type WebPushConfig = { publicKey: string; privateKey: string; subject: string };

export type AlertEmailConfig = { resendApiKey: string; from: string };

export type PlatformConfig = {
  port: number;
  /** The service's public address (https://…): widget snippet, webhook address, links in alerts. */
  publicBaseUrl: string | null;
  /** Where the built widget and console are served from (default: dist/public next to the service). */
  publicDir: string | null;
  /** WhatsApp Cloud API; null until the platform's Meta app is configured. */
  whatsapp: WhatsappConfig | null;
  /** Alerts on staff phones and browsers; null when no VAPID keys are set. */
  webPush: WebPushConfig | null;
  /** Alert emails to staff; null when no email provider is set. */
  alertEmail: AlertEmailConfig | null;
  /** A waiting chat offered to one person goes to everyone after this many minutes. */
  routeEscalateMinutes: number;
  /** How long a person who said they're available counts as available without the console open. */
  availabilityHours: number;
  /** The database owner: migrations and the platform's own work. */
  platformDatabaseUrl: string;
  /**
   * Optional: business queries sign in as the restricted zaina_app role
   * itself, rather than the owner switching to it.
   */
  platformAppDatabaseUrl: string | null;
  /** The CA certificate that signs the database server's (Supabase's), so it is checked. */
  platformDatabaseCa: string | null;
  /** Connections business queries may hold at once. */
  databasePoolMax: number;
  /** TBM's own database, read and written by the TBM connector through TBM's code. */
  tbmDatabaseUrl: string | null;
  /** Signs chat and staff tokens (each with its own derived key). */
  sessionTokenSecret: string;
  geminiApiKey: string;
  model: string;
  /** The longest one chat turn may take, model calls and tools included (I4). */
  turnBudgetMs: number;
  /** Proxy hops in front of the service, for the visitor's IP address. */
  trustProxy: number;
  migrateOnStart: boolean;
  rateLimits: RateLimits;
  /** Optional model prices, for cost reports. Unset means tokens only. */
  modelPriceUsdPerMillion: { input: number; output: number } | null;
  /** The platform's own Paystack account, for businesses paid through its subaccounts; null when there is none. */
  platformPaystackKey: string | null;
  /** The platform's Google OAuth app, for businesses connecting Google Calendar; null when there is none. */
  google: { clientId: string; clientSecret: string } | null;
  /** Whether businesses can sign up by themselves (PLATFORM_SIGNUP=open); off until the platform team opens it. */
  signupOpen: boolean;
  /** The platform's terms of service and privacy policy, linked from the sign-up form. */
  termsUrl: string | null;
  privacyUrl: string | null;
  /** Days a live business keeps answering after an invoice is due, before it pauses (BILLING_GRACE_DAYS, default 7). */
  billingGraceDays: number;
  /** How to pay an invoice by hand (bank or M-Pesa), shown with every invoice (BILLING_PAYMENT_INSTRUCTIONS). */
  billingPaymentInstructions: string | null;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`);
  return value;
}

function price(env: NodeJS.ProcessEnv, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a number of US dollars`);
  return value;
}

function publicBaseUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env.PUBLIC_BASE_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be an address like https://zaina.example.com");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error("PUBLIC_BASE_URL must start with https://");
  return url.origin;
}

/** WhatsApp is on when the Meta app's secret and the webhook's verify token are both set. */
function whatsappConfig(env: NodeJS.ProcessEnv): WhatsappConfig | null {
  const appSecret = env.WHATSAPP_APP_SECRET?.trim();
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!appSecret && !verifyToken) return null;
  if (!appSecret || !verifyToken) throw new Error("Set both WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN, or neither");
  if (verifyToken.length < 16) throw new Error("WHATSAPP_VERIFY_TOKEN must be at least 16 characters");
  const graphVersion = env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0";
  if (!/^v\d{1,3}\.\d$/.test(graphVersion)) throw new Error("WHATSAPP_GRAPH_VERSION looks like v23.0");
  const batchRaw = env.WHATSAPP_BATCH_MS?.trim();
  const batchMs = batchRaw === undefined || batchRaw === "" ? 2000 : Number(batchRaw);
  if (!Number.isInteger(batchMs) || batchMs < 0 || batchMs > 30_000) throw new Error("WHATSAPP_BATCH_MS is 0 to 30000");
  return { appSecret, verifyToken, graphVersion, batchMs };
}

function webPushConfig(env: NodeJS.ProcessEnv): WebPushConfig | null {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_PRIVATE_KEY?.trim();
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey) throw new Error("Set both WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY, or neither");
  const subject = env.WEB_PUSH_SUBJECT?.trim() || "mailto:alerts@example.com";
  if (!/^(mailto:|https:\/\/)/.test(subject)) throw new Error("WEB_PUSH_SUBJECT is a mailto: or https:// address");
  return { publicKey, privateKey, subject };
}

function alertEmailConfig(env: NodeJS.ProcessEnv): AlertEmailConfig | null {
  const resendApiKey = env.RESEND_API_KEY?.trim();
  const from = env.ALERT_FROM_EMAIL?.trim() || env.RESEND_FROM_EMAIL?.trim();
  if (!resendApiKey || !from) return null;
  return { resendApiKey, from };
}

/** The owner's and the restricted role's addresses: valid, and the same database. */
function databaseUrls(env: NodeJS.ProcessEnv): { owner: string; app: string | null } {
  const owner = required(env, "PLATFORM_DATABASE_URL");
  const ownerAddress = describeDatabaseUrl(owner, "PLATFORM_DATABASE_URL");
  const app = env.PLATFORM_APP_DATABASE_URL?.trim() || null;
  if (app) {
    const problem = appAddressProblem(ownerAddress, describeDatabaseUrl(app, "PLATFORM_APP_DATABASE_URL"));
    if (problem) throw new Error(problem);
  }
  return { owner, app };
}

/** PLATFORM_PAYSTACK_SECRET_KEY: not TBM's PAYSTACK_SECRET_KEY, so one can't be taken for the other. */
function platformPaystackKey(env: NodeJS.ProcessEnv): string | null {
  const key = env.PLATFORM_PAYSTACK_SECRET_KEY?.trim();
  if (!key) return null;
  if (!/^sk_(live|test)_[A-Za-z0-9]{10,100}$/.test(key)) throw new Error("PLATFORM_PAYSTACK_SECRET_KEY is a Paystack secret key (sk_live_… or sk_test_…)");
  return key;
}

/** PLATFORM_GOOGLE_CLIENT_ID and PLATFORM_GOOGLE_CLIENT_SECRET: both or neither, and Google sends people back to PUBLIC_BASE_URL. */
function googleConfig(env: NodeJS.ProcessEnv): { clientId: string; clientSecret: string } | null {
  const clientId = env.PLATFORM_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.PLATFORM_GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new Error("Set both PLATFORM_GOOGLE_CLIENT_ID and PLATFORM_GOOGLE_CLIENT_SECRET, or neither");
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error("PLATFORM_GOOGLE_CLIENT_ID looks like 1234-abc.apps.googleusercontent.com");
  if (!env.PUBLIC_BASE_URL?.trim()) throw new Error("PUBLIC_BASE_URL is needed for Google sign-in (Google sends people back to it)");
  return { clientId, clientSecret };
}

/** An optional https address (a page of the platform's). */
function httpsUrl(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return url.toString();
  } catch {
    // Reported below.
  }
  throw new Error(`${name} is an https:// address`);
}

/** PLATFORM_SIGNUP=open lets businesses sign up; it needs email (to confirm accounts) and the public address (for the links). */
function signupOpen(env: NodeJS.ProcessEnv): boolean {
  const value = env.PLATFORM_SIGNUP?.trim().toLowerCase();
  if (!value || value === "closed") return false;
  if (value !== "open") throw new Error("PLATFORM_SIGNUP is open or closed");
  if (!alertEmailConfig(env)) throw new Error("PLATFORM_SIGNUP=open needs RESEND_API_KEY and ALERT_FROM_EMAIL (new accounts confirm their email)");
  if (!env.PUBLIC_BASE_URL?.trim()) throw new Error("PLATFORM_SIGNUP=open needs PUBLIC_BASE_URL (the links in its emails)");
  return true;
}

/** BILLING_GRACE_DAYS: 0 to 60 days (0 pauses a live business as soon as an invoice is overdue). */
function billingGraceDays(env: NodeJS.ProcessEnv): number {
  const raw = env.BILLING_GRACE_DAYS?.trim();
  if (!raw) return 7;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 60) throw new Error("BILLING_GRACE_DAYS is a whole number of days, 0 to 60");
  return value;
}

function billingPaymentInstructions(env: NodeJS.ProcessEnv): string | null {
  const raw = env.BILLING_PAYMENT_INSTRUCTIONS?.trim().replace(/\s+/g, " ");
  if (!raw) return null;
  if (raw.length > 500) throw new Error("BILLING_PAYMENT_INSTRUCTIONS is up to 500 characters");
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const sessionTokenSecret = required(env, "SESSION_TOKEN_SECRET");
  if (sessionTokenSecret.length < 32) throw new Error("SESSION_TOKEN_SECRET must be at least 32 characters");
  const database = databaseUrls(env);

  const inputPrice = price(env, "MODEL_PRICE_INPUT_USD_PER_MTOK");
  const outputPrice = price(env, "MODEL_PRICE_OUTPUT_USD_PER_MTOK");

  return {
    port: positiveInt(env, "PORT", 5070),
    publicBaseUrl: publicBaseUrl(env),
    publicDir: env.PLATFORM_PUBLIC_DIR?.trim() || null,
    whatsapp: whatsappConfig(env),
    webPush: webPushConfig(env),
    alertEmail: alertEmailConfig(env),
    routeEscalateMinutes: positiveInt(env, "ROUTE_ESCALATE_MINUTES", 3),
    availabilityHours: positiveInt(env, "AVAILABILITY_HOURS", 2),
    platformDatabaseUrl: database.owner,
    platformAppDatabaseUrl: database.app,
    platformDatabaseCa: parseDatabaseCa(env.PLATFORM_DATABASE_CA),
    databasePoolMax: positiveInt(env, "PLATFORM_DB_POOL_MAX", 10),
    tbmDatabaseUrl: env.TBM_DATABASE_URL?.trim() || null,
    sessionTokenSecret,
    geminiApiKey: required(env, "GEMINI_API_KEY"),
    model: env.ZAINA_MODEL?.trim() || "gemini-3.5-flash-lite",
    turnBudgetMs: positiveInt(env, "TURN_BUDGET_MS", 25_000),
    trustProxy: Number(env.TRUST_PROXY ?? "1") || 0,
    migrateOnStart: env.MIGRATE_ON_START === "true",
    rateLimits: {
      sessionMessagesPerMinute: positiveInt(env, "LIMIT_SESSION_MESSAGES_PER_MINUTE", 20),
      visitorMessagesPer10Minutes: positiveInt(env, "LIMIT_VISITOR_MESSAGES_PER_10_MINUTES", 60),
      visitorSessionsPerHour: positiveInt(env, "LIMIT_VISITOR_SESSIONS_PER_HOUR", 30),
      businessMessagesPerHour: positiveInt(env, "LIMIT_BUSINESS_MESSAGES_PER_HOUR", 3000),
    },
    modelPriceUsdPerMillion: inputPrice !== null && outputPrice !== null
      ? { input: inputPrice, output: outputPrice }
      : null,
    platformPaystackKey: platformPaystackKey(env),
    google: googleConfig(env),
    signupOpen: signupOpen(env),
    termsUrl: httpsUrl(env, "PLATFORM_TERMS_URL"),
    privacyUrl: httpsUrl(env, "PLATFORM_PRIVACY_URL"),
    billingGraceDays: billingGraceDays(env),
    billingPaymentInstructions: billingPaymentInstructions(env),
  };
}
