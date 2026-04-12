import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const oneTimeTaskKey = "publish-existing-manager-assigned-listings-v1";
const publishableTables = [
  "stays",
  "cars",
  "cooks",
  "errands",
  "experiences",
];

function getDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL must be set before publishing existing listings.");
  }

  return new URL(raw);
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

async function main() {
  const databaseUrl = getDatabaseUrl();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    keepAlive: true,
    ssl: shouldUseDatabaseSsl(databaseUrl)
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_deployment_tasks (
        task_key text PRIMARY KEY,
        completed_at timestamptz NOT NULL DEFAULT now(),
        details jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);

    const existingTask = await client.query(
      "SELECT 1 FROM app_deployment_tasks WHERE task_key = $1 LIMIT 1",
      [oneTimeTaskKey],
    );

    if ((existingTask.rowCount ?? 0) > 0) {
      console.log("[publish:listings] Existing listings have already been published on a previous deploy.");
      await client.query("COMMIT");
      return;
    }

    const summary = [];

    for (const tableName of publishableTables) {
      const result = await client.query(`
        UPDATE ${tableName}
        SET is_public = true
        WHERE is_public = false
          AND NULLIF(BTRIM(COALESCE(manager_user_id, '')), '') IS NOT NULL
      `);

      summary.push({
        tableName,
        publishedCount: result.rowCount ?? 0,
      });
    }

    await client.query(
      "INSERT INTO app_deployment_tasks (task_key, details) VALUES ($1, $2::jsonb)",
      [oneTimeTaskKey, JSON.stringify({ summary })],
    );

    await client.query("COMMIT");

    console.log("[publish:listings] Published existing manager-assigned listings.");
    for (const entry of summary) {
      console.log(`[publish:listings] ${entry.tableName}: ${entry.publishedCount} listing(s) published.`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[publish:listings] Failed to publish existing listings:", error);
  process.exit(1);
});
