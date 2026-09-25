// zaina-platform/src/db/tenant.ts
//
// Business scope. A request names its business once (runForBusiness), and
// every query in it goes through inBusiness(), which runs one short
// transaction as the restricted role with app.business_id set. Postgres then
// shows and accepts only that business's rows. No scope, no rows: a
// forgotten scope fails closed.

import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { APP_ROLE, appPool, type PlatformDb } from "./platform-db.ts";
import * as schema from "./schema.ts";

const scope = new AsyncLocalStorage<{ businessId: string }>();

export function runForBusiness<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  return scope.run({ businessId }, fn);
}

export function currentBusinessId(): string {
  const current = scope.getStore();
  if (!current) throw new Error("No business in scope");
  return current.businessId;
}

/** Runs fn in one transaction scoped to a business (the current one by default). */
export async function inBusiness<T>(
  fn: (db: PlatformDb, client: pg.PoolClient) => Promise<T>,
  businessId: string = currentBusinessId(),
): Promise<T> {
  const client = await appPool().connect();
  try {
    await client.query("begin");
    // The role is set again per transaction, so the scope never depends on
    // how the connection was left.
    await client.query("select set_config('role', $1, true), set_config('app.business_id', $2, true)", [APP_ROLE, businessId]);
    const result = await fn(drizzle(client, { schema }), client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
