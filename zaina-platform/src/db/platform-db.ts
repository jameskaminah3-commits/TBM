// zaina-platform/src/db/platform-db.ts
//
// Two connections to the platform database.
//
//   The app pool runs as zaina_app, the role row-level security applies to.
//   Business data is only reached through inBusiness() (db/tenant.ts), which
//   scopes each transaction to one business: a query can't see another
//   business's rows even if it forgets to filter.
//
//   The owner pool bypasses row-level security. It is used for migrations
//   and for the platform's own work across businesses (db/platform-scope.ts:
//   creating businesses, staff sign-in), and nowhere else.
//
//   App connections either sign in as zaina_app (appConnectionString, the
//   stronger setup) or sign in as the owner and switch to zaina_app.

import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

export const APP_ROLE = "zaina_app";

export type PlatformDb = NodePgDatabase<typeof schema>;

let app: pg.Pool | null = null;
let owner: pg.Pool | null = null;

export function initPlatformDb(
  connectionString: string,
  options: { max?: number; appConnectionString?: string | null } = {},
): void {
  if (app) return;
  app = new pg.Pool({ connectionString: options.appConnectionString || connectionString, max: options.max ?? 10 });
  // Every connection switches to the restricted role before it is used.
  // (inBusiness() sets the role again per transaction; assertAppRole() checks it at start.)
  app.on("connect", (client) => {
    client.query(`set role ${APP_ROLE}`).catch((error) => {
      console.error("[platform-db] switching to the app role failed:", error.message);
    });
  });
  app.on("error", (error) => console.error("[platform-db] idle app client error:", error.message));
  owner = new pg.Pool({ connectionString, max: 3 });
  owner.on("error", (error) => console.error("[platform-db] idle owner client error:", error.message));
}

export function appPool(): pg.Pool {
  if (!app) throw new Error("The platform database is not open (call initPlatformDb first)");
  return app;
}

/** The app role outside any business: for the business directory and rate-limit counters only. */
export function appDb(): PlatformDb {
  return drizzle(appPool(), { schema });
}

/** Bypasses row-level security: only for migrations and db/platform-scope.ts. */
export function ownerPool(): pg.Pool {
  if (!owner) throw new Error("The platform database is not open (call initPlatformDb first)");
  return owner;
}

export function ownerDb(): PlatformDb {
  return drizzle(ownerPool(), { schema });
}

/** Refuses to run if app connections aren't restricted: isolation must not silently fail. */
export async function assertAppRole(): Promise<void> {
  const { rows } = await appPool().query<{ role: string; bypass: boolean }>(
    "select current_user as role, rolbypassrls or rolsuper as bypass from pg_roles where rolname = current_user",
  );
  if (rows[0]?.role !== APP_ROLE || rows[0]?.bypass) {
    throw new Error(`App connections run as ${rows[0]?.role ?? "unknown"}, not the restricted ${APP_ROLE} role`);
  }
}

export async function closePlatformDb(): Promise<void> {
  const pools = [app, owner];
  app = null;
  owner = null;
  await Promise.all(pools.map((pool) => pool?.end()));
}
