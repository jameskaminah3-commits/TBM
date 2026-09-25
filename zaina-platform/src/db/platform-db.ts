// zaina-platform/src/db/platform-db.ts
//
// The connection to the platform's own database. Opened once at start
// (initPlatformDb) and shared; tests open it against a test database.

import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

export type PlatformDb = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let database: PlatformDb | null = null;

export function initPlatformDb(connectionString: string, options: { max?: number } = {}): PlatformDb {
  if (database) return database;
  pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  pool.on("error", (error) => console.error("[platform-db] idle client error:", error.message));
  database = drizzle(pool, { schema });
  return database;
}

export function platformDb(): PlatformDb {
  if (!database) throw new Error("The platform database is not open (call initPlatformDb first)");
  return database;
}

export function platformPool(): pg.Pool {
  if (!pool) throw new Error("The platform database is not open (call initPlatformDb first)");
  return pool;
}

export async function closePlatformDb(): Promise<void> {
  const open = pool;
  pool = null;
  database = null;
  await open?.end();
}
