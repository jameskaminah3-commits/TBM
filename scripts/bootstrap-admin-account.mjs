import "dotenv/config";
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function splitName(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "Admin",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function getDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL must be set before bootstrapping an admin account.");
  }

  if (
    raw.includes("[project-ref]")
    || raw.includes("[db-password]")
    || raw.includes("[pooler-host]")
  ) {
    throw new Error(
      "DATABASE_URL is still using the .env.example placeholder. Set Railway DATABASE_URL to your real Supabase session pooler connection string.",
    );
  }

  try {
    return new URL(raw);
  } catch {
    throw new Error(
      "DATABASE_URL is not a valid Postgres connection string. Set Railway DATABASE_URL to your real Supabase session pooler URL.",
    );
  }
}

function isPrivateHostname(hostname) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.endsWith(".local");
}

function shouldUseDatabaseSsl(databaseUrl) {
  const sslMode = databaseUrl.searchParams.get("sslmode")?.trim().toLowerCase();
  if (sslMode === "disable") {
    return false;
  }

  if (sslMode) {
    return true;
  }

  return !isPrivateHostname(databaseUrl.hostname);
}

function shouldRejectUnauthorizedDatabaseSsl(databaseUrl) {
  const explicit = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  if (explicit === "false" || explicit === "0" || explicit === "no") {
    return false;
  }
  if (explicit === "true" || explicit === "1" || explicit === "yes") {
    return true;
  }

  const sslMode = databaseUrl.searchParams.get("sslmode")?.trim().toLowerCase();
  return sslMode !== "no-verify";
}

function buildDatabaseSslConfig(databaseUrl) {
  if (!shouldUseDatabaseSsl(databaseUrl)) {
    return undefined;
  }

  return {
    rejectUnauthorized: shouldRejectUnauthorizedDatabaseSsl(databaseUrl),
    servername: process.env.DATABASE_SSL_SERVERNAME?.trim() || databaseUrl.hostname,
  };
}

function resolveBootstrapAdminEmail() {
  const explicitEmail = normalizeEmail(process.env.ADMIN_BOOTSTRAP_EMAIL);
  if (explicitEmail) {
    return explicitEmail;
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);

  return adminEmails[0] ?? "";
}

async function main() {
  const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() ?? "";
  if (!bootstrapPassword) {
    console.log("[bootstrap:admin] ADMIN_BOOTSTRAP_PASSWORD is not set. Skipping admin bootstrap.");
    return;
  }

  const email = resolveBootstrapAdminEmail();
  if (!email) {
    console.log("[bootstrap:admin] No bootstrap admin email found. Set ADMIN_BOOTSTRAP_EMAIL or ADMIN_EMAILS.");
    return;
  }

  const name = process.env.ADMIN_BOOTSTRAP_NAME?.trim() || "Tembea Admin";
  const { firstName, lastName } = splitName(name);
  const databaseUrl = getDatabaseUrl();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    keepAlive: true,
    ssl: buildDatabaseSslConfig(databaseUrl),
  });

  try {
    const passwordHash = hashPassword(bootstrapPassword);
    const result = await pool.query(`
      INSERT INTO users (
        email,
        first_name,
        last_name,
        password_hash,
        role,
        email_verified_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'admin', now(), now())
      ON CONFLICT (email)
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        password_hash = EXCLUDED.password_hash,
        role = 'admin',
        email_verified_at = COALESCE(users.email_verified_at, now()),
        is_suspended = false,
        updated_at = now()
      RETURNING id
    `, [email, firstName, lastName, passwordHash]);

    const userId = result.rows[0]?.id;
    console.log(`[bootstrap:admin] Admin account is ready for ${email}${userId ? ` (user ${userId})` : ""}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[bootstrap:admin] Failed to bootstrap admin account:", error);
  process.exit(1);
});
