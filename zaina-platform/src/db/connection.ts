// zaina-platform/src/db/connection.ts
//
// How the platform reaches its database: Supabase in production, through
// its session pooler; a local Postgres in development and tests.
//
//   Encryption. sslmode in an address means what it means to psql, not what
//   node-postgres makes of it. "require" encrypts, and checks the server's
//   certificate when PLATFORM_DATABASE_CA holds the certificate that signs it
//   (Supabase's, downloaded from the project's database settings).
//   "verify-ca" and "verify-full" always check it; "verify-full" checks the
//   host name too. With no sslmode, a database elsewhere is encrypted and one
//   on this machine or a private network isn't. "disable" is refused for a
//   database elsewhere: passwords would cross the internet readable.
//
//   Supabase. The address to use is the session pooler (port 5432 on
//   *.pooler.supabase.com), where user names carry the project:
//   postgres.<project-ref>, zaina_app.<project-ref>. The transaction pooler
//   (port 6543) is refused: the platform keeps a role, settings and locks for
//   the length of a connection, which that pooler drops between
//   transactions. The direct address (db.<project-ref>.supabase.co) answers
//   on IPv6 only, which Railway may not reach.

import { X509Certificate } from "node:crypto";
import type { ConnectionOptions } from "node:tls";
import type pg from "pg";

/** The role business queries run as, subject to row-level security. */
export const APP_ROLE = "zaina_app";

export type DatabaseAddress = {
  host: string;
  port: number;
  database: string;
  /** The role signed in as (on Supabase's pooler, without the project suffix). */
  role: string;
  /** The Supabase project, when the address is Supabase's. */
  supabaseProject: string | null;
  supabasePooler: boolean;
  /** On this machine or a private network. */
  local: boolean;
};

export type TlsState = "off" | "encrypted" | "verified";

export type DatabaseConnection = {
  address: DatabaseAddress;
  config: pg.PoolConfig;
  tls: TlsState;
  /** Worth a line in the log: setups that work but could be better. */
  warnings: string[];
};

const POOLER_HOST = /\.pooler\.supabase\.com$/i;
const DIRECT_HOST = /^db\.([a-z0-9]+)\.supabase\.co$/i;
const TRANSACTION_POOLER_PORT = 6543;

function parseUrl(url: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`${label} isn't a valid postgresql:// address (percent-encode special characters in the password)`);
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`${label} isn't a valid postgresql:// address`);
  }
  return parsed;
}

/** This machine, a private network, or a Unix socket. */
export function isLocalHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!name || name.startsWith("/")) return true;
  if (name === "localhost" || name.endsWith(".localhost") || name === "::1") return true;
  if (/^(127|10)\./.test(name) || /^192\.168\./.test(name) || /^172\.(1[6-9]|2\d|3[01])\./.test(name)) return true;
  if (name.endsWith(".local") || name.endsWith(".internal")) return true;
  // One name without dots: a service on a private network (docker compose and the like).
  return !name.includes(".") && !name.includes(":");
}

/** What an address points at, checked. */
export function describeDatabaseUrl(url: string, label = "PLATFORM_DATABASE_URL"): DatabaseAddress {
  const parsed = parseUrl(url, label);
  const host = parsed.hostname || parsed.searchParams.get("host") || "";
  const port = Number(parsed.port || 5432);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres";
  const user = decodeURIComponent(parsed.username);
  const supabasePooler = POOLER_HOST.test(host);
  const direct = DIRECT_HOST.exec(host);

  let role = user;
  let supabaseProject = direct ? direct[1].toLowerCase() : null;
  if (supabasePooler) {
    const match = /^(.+)\.([a-z0-9]{8,40})$/.exec(user);
    if (!match) {
      throw new Error(
        `${label}: on Supabase's pooler the user name ends with the project, like postgres.<project-ref> ` +
        "(copy the address from Connect → Session pooler in Supabase)",
      );
    }
    role = match[1];
    supabaseProject = match[2];
  }
  if ((supabasePooler || direct) && port === TRANSACTION_POOLER_PORT) {
    throw new Error(
      `${label} is Supabase's transaction pooler (port 6543). Use the session pooler (port 5432): ` +
      "the platform keeps settings and locks for a whole connection, which the transaction pooler drops.",
    );
  }
  return { host, port, database, role, supabaseProject, supabasePooler, local: isLocalHost(host) };
}

/**
 * The CA certificate from PLATFORM_DATABASE_CA: the certificate's text, the
 * same with "\n" for its line breaks, or that text in base64. Line breaks
 * lost when pasting are restored.
 */
export function parseDatabaseCa(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const marker = /-----BEGIN CERTIFICATE-----/;
  let text = value.replace(/\\n/g, "\n");
  if (!marker.test(text)) {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!marker.test(decoded)) {
      throw new Error("PLATFORM_DATABASE_CA must be the certificate's text (it starts with -----BEGIN CERTIFICATE-----), or that text in base64");
    }
    text = decoded;
  }
  const certificates = [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)].map((match) => {
    const body = match[1].replace(/\s+/g, "");
    return `-----BEGIN CERTIFICATE-----\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n-----END CERTIFICATE-----`;
  });
  if (!certificates.length) throw new Error("PLATFORM_DATABASE_CA has no complete certificate (-----BEGIN CERTIFICATE----- … -----END CERTIFICATE-----)");
  for (const certificate of certificates) {
    try {
      new X509Certificate(certificate);
    } catch {
      throw new Error("PLATFORM_DATABASE_CA isn't a valid certificate: copy the whole file's text");
    }
  }
  return `${certificates.join("\n")}\n`;
}

/** "Supabase Root 2021 CA, until 2031-04-26": for the log. */
export function describeCa(ca: string): string {
  const certificate = new X509Certificate(ca.split(/(?<=-----END CERTIFICATE-----)/)[0]);
  const name = /(?:^|\n)CN=([^\n]+)/.exec(certificate.subject)?.[1] ?? certificate.subject.replace(/\n/g, ", ");
  return `${name}, until ${new Date(certificate.validTo).toISOString().slice(0, 10)}`;
}

const SSL_OPTIONS = ["sslmode", "ssl", "uselibpqcompat"];
const SSL_FILES = ["sslrootcert", "sslcert", "sslkey", "sslpassword"];

/** Pool settings for an address, with TLS as described above. */
export function databaseConnection(
  url: string,
  options: { label?: string; ca?: string | null; max: number; applicationName?: string },
): DatabaseConnection {
  const label = options.label ?? "PLATFORM_DATABASE_URL";
  const address = describeDatabaseUrl(url, label);
  const parsed = parseUrl(url, label);
  const ca = options.ca ?? null;
  const warnings: string[] = [];

  for (const name of SSL_FILES) {
    if (parsed.searchParams.has(name)) {
      throw new Error(`${label}: remove ${name}=… from the address; give the server's CA certificate in PLATFORM_DATABASE_CA instead`);
    }
  }
  const mode = parsed.searchParams.get("sslmode")?.trim().toLowerCase() || null;
  for (const name of SSL_OPTIONS) parsed.searchParams.delete(name);

  // Verify the chain but not the host name (verify-ca).
  const anyHostName = { checkServerIdentity: () => undefined };
  let ssl: false | ConnectionOptions;
  switch (mode) {
    case "disable":
      if (!address.local) throw new Error(`${label}: sslmode=disable is only for a database on this machine or a private network`);
      ssl = false;
      break;
    case null:
    case "allow":
    case "prefer":
    case "require":
      if (address.local && mode !== "require") {
        ssl = false;
      } else if (ca) {
        ssl = { ca, rejectUnauthorized: true, ...anyHostName };
      } else {
        ssl = { rejectUnauthorized: false };
      }
      break;
    case "verify-ca":
      ssl = { ...(ca ? { ca } : {}), rejectUnauthorized: true, ...anyHostName };
      break;
    case "verify-full":
      ssl = { ...(ca ? { ca } : {}), rejectUnauthorized: true };
      break;
    case "no-verify":
      ssl = { rejectUnauthorized: false };
      break;
    default:
      throw new Error(`${label}: sslmode=${mode} isn't one of disable, prefer, require, verify-ca, verify-full, no-verify`);
  }

  const tls: TlsState = ssl === false ? "off" : ssl.rejectUnauthorized ? "verified" : "encrypted";
  if (tls === "encrypted" && !address.local) {
    warnings.push(`${label}: the connection is encrypted, but the server's certificate isn't checked. Set PLATFORM_DATABASE_CA to check it.`);
  }
  if (address.supabaseProject && !address.supabasePooler) {
    warnings.push(`${label}: db.${address.supabaseProject}.supabase.co answers on IPv6 only. If the platform can't reach it, use the session pooler address (Connect → Session pooler).`);
  }

  return {
    address,
    tls,
    warnings,
    config: {
      connectionString: parsed.toString(),
      ssl,
      max: options.max,
      keepAlive: true,
      connectionTimeoutMillis: 15_000,
      application_name: options.applicationName ?? "zaina-platform",
    },
  };
}

/** Why an app address isn't the restricted role on the owner's database, or null. */
export function appAddressProblem(owner: DatabaseAddress, app: DatabaseAddress): string | null {
  if (app.role !== APP_ROLE) {
    const expected = app.supabasePooler ? `${APP_ROLE}.<project-ref>` : APP_ROLE;
    return `PLATFORM_APP_DATABASE_URL must sign in as ${APP_ROLE} (user ${expected}), not "${app.role}"`;
  }
  const same = app.host.toLowerCase() === owner.host.toLowerCase()
    && app.port === owner.port
    && app.database === owner.database
    && app.supabaseProject === owner.supabaseProject;
  if (!same) return "PLATFORM_APP_DATABASE_URL must reach the same database as PLATFORM_DATABASE_URL (same host, port, database and project)";
  return null;
}

/** A hint for the first connection's failure, when it's a known setup mistake. */
export function connectionHint(error: unknown, address: DatabaseAddress): string | null {
  const message = String((error as Error)?.message ?? error);
  if (/does not match certificate's altnames/i.test(message)) {
    return "The certificate is valid but made out to another host name: use sslmode=require, which checks the certificate but not the name.";
  }
  if (/self[- ]signed certificate|unable to (get|verify) (local )?issuer certificate|certificate/i.test(message)) {
    return "The server's certificate wasn't accepted: check that PLATFORM_DATABASE_CA is the certificate from this project's database settings.";
  }
  if (/tenant or user not found/i.test(message)) {
    return "Supabase's pooler doesn't know this user: the user name is <role>.<project-ref>, and the pooler host must be your project's region.";
  }
  if (/password authentication failed/i.test(message)) return "Wrong password for this user.";
  if (/ENETUNREACH|EHOSTUNREACH/.test(message) && address.supabaseProject && !address.supabasePooler) {
    return "This network can't reach Supabase's IPv6-only direct address: use the session pooler address.";
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return `The database host ${address.host} wasn't found.`;
  if (/timeout|ETIMEDOUT/i.test(message) && address.supabaseProject) {
    return "Supabase didn't answer in time: check that the project isn't paused.";
  }
  return null;
}
