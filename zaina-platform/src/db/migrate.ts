// zaina-platform/src/db/migrate.ts
//
// Reviewed SQL migrations instead of schema push (I18). Each file in
// migrations/ runs once, in name order, inside its own transaction, and is
// recorded with a checksum. A migration that changes after it ran is an
// error: fix forward with a new file. An advisory lock keeps two starting
// instances from migrating at the same time.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const LOCK_KEY = 7_270_451_001; // any constant; shared by every instance

export type Migration = { version: string; sql: string; checksum: string };

/**
 * The platform's migrations/, next to src/ (run from source) or dist/
 * (bundled). Found by its first migration, so the TBM app's own migrations
 * folder one level up is never picked by mistake.
 */
export function migrationsDirectory(): string {
  const override = process.env.PLATFORM_MIGRATIONS_DIR?.trim();
  if (override) return override;
  for (const relative of ["../migrations/", "../../migrations/"]) {
    const directory = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(`${directory}/0001_platform_core.sql`)) return directory;
  }
  throw new Error("The platform's migrations directory was not found");
}

export function readMigrations(directory = migrationsDirectory()): Migration[] {
  return readdirSync(directory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => {
      const sql = readFileSync(`${directory}/${name}`, "utf8");
      return { version: name.replace(/\.sql$/, ""), sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

async function appliedMigrations(client: pg.PoolClient): Promise<Map<string, string>> {
  await client.query(`create table if not exists schema_migrations (
    version text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  const { rows } = await client.query<{ version: string; checksum: string }>("select version, checksum from schema_migrations");
  return new Map(rows.map((row) => [row.version, row.checksum]));
}

function checkUnchanged(migrations: Migration[], applied: Map<string, string>) {
  for (const migration of migrations) {
    const checksum = applied.get(migration.version);
    if (checksum && checksum !== migration.checksum) {
      throw new Error(`Migration ${migration.version} changed after it ran. Add a new migration instead of editing it.`);
    }
  }
}

/** Migrations not yet applied, in order. */
export async function pendingMigrations(pool: pg.Pool, migrations = readMigrations()): Promise<Migration[]> {
  const client = await pool.connect();
  try {
    const applied = await appliedMigrations(client);
    checkUnchanged(migrations, applied);
    return migrations.filter((migration) => !applied.has(migration.version));
  } finally {
    client.release();
  }
}

/** Applies every pending migration; returns the versions applied. */
export async function migrate(
  pool: pg.Pool,
  options: { migrations?: Migration[]; log?: (message: string) => void } = {},
): Promise<string[]> {
  const migrations = options.migrations ?? readMigrations();
  const log = options.log ?? (() => {});
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    const applied = await appliedMigrations(client);
    checkUnchanged(migrations, applied);
    const done: string[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      log(`applying ${migration.version}`);
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query("insert into schema_migrations (version, checksum) values ($1, $2)", [migration.version, migration.checksum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${migration.version} failed: ${(error as Error).message}`);
      }
      done.push(migration.version);
    }
    return done;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}
