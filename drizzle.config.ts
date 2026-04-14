import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

function shouldRejectUnauthorizedDatabaseSsl(databaseUrl: URL) {
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

function buildPostgresCredentials() {
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  const overrideHost = process.env.DATABASE_HOST_OVERRIDE?.trim();
  if (!overrideHost) {
    return {
      url: process.env.DATABASE_URL!,
    };
  }

  const sslMode = databaseUrl.searchParams.get("sslmode")?.trim().toLowerCase();
  const ssl = sslMode === "disable"
    ? false
    : {
        rejectUnauthorized: shouldRejectUnauthorizedDatabaseSsl(databaseUrl),
        servername: process.env.DATABASE_SSL_SERVERNAME?.trim() || databaseUrl.hostname,
      };

  return {
    host: overrideHost,
    port: databaseUrl.port ? Number(databaseUrl.port) : 5432,
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: databaseUrl.pathname.replace(/^\/+/, "") || "postgres",
    ssl,
  };
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: buildPostgresCredentials(),
});
