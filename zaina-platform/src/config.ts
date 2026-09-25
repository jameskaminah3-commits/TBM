// zaina-platform/src/config.ts
//
// Everything the service reads from its environment, checked once at start.
// A missing or weak secret stops the service instead of running unprotected.

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

export type PlatformConfig = {
  port: number;
  platformDatabaseUrl: string;
  /** TBM's own database, read and written by the TBM connector through TBM's code. */
  tbmDatabaseUrl: string | null;
  sessionTokenSecret: string;
  adminToken: string;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const sessionTokenSecret = required(env, "SESSION_TOKEN_SECRET");
  if (sessionTokenSecret.length < 32) throw new Error("SESSION_TOKEN_SECRET must be at least 32 characters");
  const adminToken = required(env, "PLATFORM_ADMIN_TOKEN");
  if (adminToken.length < 24) throw new Error("PLATFORM_ADMIN_TOKEN must be at least 24 characters");

  const inputPrice = price(env, "MODEL_PRICE_INPUT_USD_PER_MTOK");
  const outputPrice = price(env, "MODEL_PRICE_OUTPUT_USD_PER_MTOK");

  return {
    port: positiveInt(env, "PORT", 5070),
    platformDatabaseUrl: required(env, "PLATFORM_DATABASE_URL"),
    tbmDatabaseUrl: env.TBM_DATABASE_URL?.trim() || null,
    sessionTokenSecret,
    adminToken,
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
  };
}
