import type { RequestHandler } from "express";

type RateLimitRule = {
  id: string;
  key: (req: any) => string | null | undefined;
  max: number;
  windowMs: number;
  message?: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();
const maxRateLimitEntries = 5000;

function normalizeRateLimitKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 180);
}

function trimForwardedIp(value: string) {
  return value.split(",")[0]?.trim() || null;
}

export function getRequestIp(req: any) {
  if (typeof req.ip === "string" && req.ip.trim()) {
    return req.ip.trim();
  }

  const forwardedFor = req.headers?.["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    return trimForwardedIp(forwardedFor) || "unknown";
  }

  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    const firstForwardedIp = forwardedFor[0];
    return typeof firstForwardedIp === "string" && firstForwardedIp.trim()
      ? trimForwardedIp(firstForwardedIp) || "unknown"
      : "unknown";
  }

  return "unknown";
}

function pruneRateLimitStore(now: number) {
  for (const [key, entry] of Array.from(rateLimitStore.entries())) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }

  if (rateLimitStore.size <= maxRateLimitEntries) {
    return;
  }

  const overflow = rateLimitStore.size - maxRateLimitEntries;
  let removed = 0;
  for (const key of Array.from(rateLimitStore.keys())) {
    rateLimitStore.delete(key);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
}

function consumeRateLimit(rule: RateLimitRule, key: string, now: number) {
  const existingEntry = rateLimitStore.get(key);
  if (!existingEntry || existingEntry.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + rule.windowMs,
    });
    return null;
  }

  if (existingEntry.count >= rule.max) {
    return Math.max(1, Math.ceil((existingEntry.resetAt - now) / 1000));
  }

  existingEntry.count += 1;
  rateLimitStore.set(key, existingEntry);
  return null;
}

export function createRateLimitMiddleware(rules: RateLimitRule[]): RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    pruneRateLimitStore(now);

    for (const rule of rules) {
      const rawKey = rule.key(req);
      if (!rawKey) {
        continue;
      }

      const key = `${rule.id}:${normalizeRateLimitKey(rawKey)}`;
      const retryAfterSeconds = consumeRateLimit(rule, key, now);
      if (retryAfterSeconds === null) {
        continue;
      }

      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        message: rule.message ?? "Too many requests. Please try again later.",
      });
    }

    return next();
  };
}
