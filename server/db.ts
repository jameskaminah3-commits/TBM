import dotenv from "dotenv";
import dns from "dns";
import https from "https";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const { Pool } = pg;

dotenv.config();

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Older Node runtimes may not support this API; Railway uses Node 20+.
}

type DnsCacheEntry = {
  address: string;
  family: 4 | 6;
  expiresAt: number;
};

const dohCache = new Map<string, DnsCacheEntry[]>();
const databaseUrl = process.env.DATABASE_URL ?? "";
const publicDnsServers = ["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"] as const;

function parseDatabaseUrl() {
  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
}

function getDatabaseHostname() {
  return parseDatabaseUrl()?.hostname || null;
}

function isSupabaseDatabaseHostname(hostname: string) {
  return hostname.endsWith(".pooler.supabase.com") || hostname.endsWith(".supabase.co");
}

function isPrivateDatabaseHostname(hostname: string) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.endsWith(".local");
}

function shouldUseDatabaseSsl() {
  const parsedUrl = parseDatabaseUrl();
  if (!parsedUrl) {
    return false;
  }

  const sslMode = parsedUrl.searchParams.get("sslmode")?.trim().toLowerCase();
  if (sslMode === "disable") {
    return false;
  }

  if (sslMode) {
    return true;
  }

  return !isPrivateDatabaseHostname(parsedUrl.hostname);
}

function requestDnsJson(options: {
  ip: string;
  servername: string;
  hostHeader: string;
  path: string;
  timeoutMs: number;
  headers?: Record<string, string>;
}) {
  return new Promise<any>((resolve, reject) => {
    const request = https.request({
      host: options.ip,
      servername: options.servername,
      port: 443,
      method: "GET",
      path: options.path,
      headers: {
        Host: options.hostHeader,
        Accept: "application/dns-json",
        ...options.headers,
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`DNS endpoint responded with ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error("DNS HTTPS request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

function extractDnsAnswers(
  payload: any,
  family: 4 | 6,
): DnsCacheEntry[] {
  const expectedType = family === 6 ? 28 : 1;
  const answers: unknown[] = Array.isArray(payload?.Answer) ? payload.Answer : [];

  return answers
    .filter((answer: unknown): answer is { data: string; TTL?: number; type?: number } => {
      if (!answer || typeof answer !== "object") {
        return false;
      }

      const record = answer as { data?: unknown; TTL?: unknown; type?: unknown };
      return typeof record.data === "string" && record.type === expectedType;
    })
    .map((answer: { data: string; TTL?: number; type?: number }) => ({
      address: answer.data,
      family,
      expiresAt: Date.now() + (Math.max(30, Number(answer.TTL ?? 60)) * 1000),
    }));
}

async function resolveHostnameViaHttpsDns(hostname: string, preferredFamily: number) {
  const cacheKey = `${hostname}:${preferredFamily || 0}`;
  const cached = dohCache.get(cacheKey)?.filter((entry) => entry.expiresAt > Date.now()) ?? [];
  if (cached.length > 0) {
    return cached;
  }

  const preferredFamilies: Array<4 | 6> = preferredFamily === 6
    ? [6, 4]
    : preferredFamily === 4
      ? [4, 6]
      : [4, 6];

  const providers = [
    { ip: "1.1.1.1", servername: "cloudflare-dns.com", hostHeader: "cloudflare-dns.com", pathPrefix: "/dns-query" },
    { ip: "1.0.0.1", servername: "cloudflare-dns.com", hostHeader: "cloudflare-dns.com", pathPrefix: "/dns-query" },
    { ip: "8.8.8.8", servername: "dns.google", hostHeader: "dns.google", pathPrefix: "/resolve" },
    { ip: "8.8.4.4", servername: "dns.google", hostHeader: "dns.google", pathPrefix: "/resolve" },
  ] as const;

  const resolved: DnsCacheEntry[] = [];

  for (const family of preferredFamilies) {
    const recordType = family === 6 ? "AAAA" : "A";

    for (const provider of providers) {
      try {
        const payload = await requestDnsJson({
          ip: provider.ip,
          servername: provider.servername,
          hostHeader: provider.hostHeader,
          path: `${provider.pathPrefix}?name=${encodeURIComponent(hostname)}&type=${recordType}`,
          timeoutMs: 4000,
        });
        const answers = extractDnsAnswers(payload, family);
        if (answers.length > 0) {
          resolved.push(...answers);
          break;
        }
      } catch {
        // Try the next provider.
      }
    }

    if (resolved.some((entry) => entry.family === family)) {
      break;
    }
  }

  if (resolved.length === 0) {
    throw new Error(`Could not resolve ${hostname} via HTTPS DNS fallback`);
  }

  dohCache.set(cacheKey, resolved);
  return resolved;
}

async function resolveHostnameViaPublicDnsResolver(hostname: string, preferredFamily: number) {
  const cacheKey = `resolver:${hostname}:${preferredFamily || 0}`;
  const cached = dohCache.get(cacheKey)?.filter((entry) => entry.expiresAt > Date.now()) ?? [];
  if (cached.length > 0) {
    return cached;
  }

  const resolver = new dns.Resolver();
  resolver.setServers([...publicDnsServers]);
  const resolve4 = (targetHostname: string) => new Promise<string[]>((resolve, reject) => {
    resolver.resolve4(targetHostname, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(addresses);
    });
  });
  const resolve6 = (targetHostname: string) => new Promise<string[]>((resolve, reject) => {
    resolver.resolve6(targetHostname, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(addresses);
    });
  });

  const preferredFamilies: Array<4 | 6> = preferredFamily === 6
    ? [6, 4]
    : preferredFamily === 4
      ? [4, 6]
      : [4, 6];

  const resolved: DnsCacheEntry[] = [];

  for (const family of preferredFamilies) {
    try {
      const addresses = family === 6
        ? await resolve6(hostname)
        : await resolve4(hostname);
      if (addresses.length > 0) {
        resolved.push(
          ...addresses.map((address) => ({
            address,
            family,
            expiresAt: Date.now() + 60_000,
          })),
        );
        break;
      }
    } catch {
      // Fall through to the next family or HTTPS DNS fallback.
    }
  }

  if (resolved.length === 0) {
    throw new Error(`Could not resolve ${hostname} via public DNS resolver fallback`);
  }

  dohCache.set(cacheKey, resolved);
  return resolved;
}

function installDatabaseDnsFallback() {
  const hostname = getDatabaseHostname();
  if (!hostname || !isSupabaseDatabaseHostname(hostname)) {
    return;
  }

  const originalLookup = dns.lookup.bind(dns);

  dns.lookup = ((targetHostname: string, optionsOrCallback?: unknown, maybeCallback?: unknown) => {
    const callback = typeof optionsOrCallback === "function"
      ? optionsOrCallback as (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void
      : maybeCallback as (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;
    const options = typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
    const family = typeof options === "number"
      ? options
      : typeof options === "object" && options && "family" in options && typeof (options as { family?: unknown }).family === "number"
        ? (options as { family: number }).family
        : 0;
    const wantsAll = typeof options === "object" && options !== null && "all" in options
      ? Boolean((options as { all?: unknown }).all)
      : false;

    const handleLookup = (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], resolvedFamily?: number) => {
      if (!error || error.code !== "ENOTFOUND" || !isSupabaseDatabaseHostname(targetHostname)) {
        callback(error, address, resolvedFamily);
        return;
      }

      void resolveHostnameViaPublicDnsResolver(targetHostname, family)
        .catch(() => resolveHostnameViaHttpsDns(targetHostname, family))
        .then((entries) => {
          console.warn(`[DB] Resolved ${targetHostname} via DNS fallback.`);
          if (wantsAll) {
            callback(null, entries.map((entry) => ({ address: entry.address, family: entry.family })));
            return;
          }

          const preferred = entries.find((entry) => family === 0 || entry.family === family) ?? entries[0];
          callback(null, preferred.address, preferred.family);
        })
        .catch((fallbackError) => {
          console.error(`[DB] DNS fallback failed for ${targetHostname}:`, fallbackError);
          callback(error, address, resolvedFamily);
        });
    };

    if (options === undefined) {
      return originalLookup(targetHostname, handleLookup);
    }

    return originalLookup(targetHostname, options as never, handleLookup);
  }) as typeof dns.lookup;
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

installDatabaseDnsFallback();

const basePoolConfig = {
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  ssl: shouldUseDatabaseSsl()
    ? {
        rejectUnauthorized: false,
      }
    : undefined,
};

function resolvePoolMax() {
  const explicitMax = Number(
    process.env.PG_POOL_MAX
    ?? process.env.DB_POOL_MAX
    ?? "",
  );
  if (Number.isFinite(explicitMax) && explicitMax > 0) {
    return Math.max(1, Math.floor(explicitMax));
  }

  try {
    const url = new URL(process.env.DATABASE_URL!);
    const urlPoolSize = Number(
      url.searchParams.get("pool_size")
      ?? url.searchParams.get("connection_limit")
      ?? url.searchParams.get("max")
      ?? "",
    );

    if (Number.isFinite(urlPoolSize) && urlPoolSize > 0) {
      return Math.max(1, Math.min(5, Math.floor(urlPoolSize)));
    }
  } catch {
    // Ignore URL parsing issues and fall back to the safe default below.
  }

  return 5;
}

const resolvedPoolMax = resolvePoolMax();

export const pool = new Pool({
  ...basePoolConfig,
  max: resolvedPoolMax,
});

// Share the same underlying pool with the session store so we do not
// double-count connections against hosted Postgres pool limits.
export const sessionPool = pool;

pool.on("error", (error) => {
  console.error("[DB] Unexpected pool error:", error);
});

export const db = drizzle({ client: pool, schema });
