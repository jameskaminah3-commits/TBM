// Which providers are suspended, for everything that decides whether a listing
// can be seen or booked. A suspended provider's listings drop out of public
// lists and pages, and new bookings for them are refused (plan decision 1),
// unless TBM reassigns the listing to someone else.
//
// Public lists read a copy kept in memory: refreshed every minute, and at once
// when an admin suspends or restores a provider on this server. Booking
// creation asks the database directly, so it never relies on the copy.
import { sql, type SQL } from "drizzle-orm";
import { pool } from "./db";

const REFRESH_MS = 60_000;
let suspended = new Set<string>();
let loadedAt = 0;
let loading: Promise<void> | null = null;

export function refreshSuspendedProviders(): Promise<void> {
  loading ??= pool.query<{ id: string }>("SELECT id FROM users WHERE is_suspended = true")
    .then(({ rows }) => {
      suspended = new Set(rows.map((row) => row.id));
      loadedAt = Date.now();
    })
    .catch((error) => {
      console.error("[PROVIDERS] Couldn't load suspended providers:", error);
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

let timer: NodeJS.Timeout | null = null;
export function startSuspendedProviderRefresh() {
  if (timer) return;
  void refreshSuspendedProviders();
  timer = setInterval(() => void refreshSuspendedProviders(), REFRESH_MS);
  timer.unref?.();
}

/** From the copy in memory: for public lists and pages. */
export function isSuspendedProvider(userId: string | null | undefined) {
  if (Date.now() - loadedAt > REFRESH_MS * 2) void refreshSuspendedProviders();
  return Boolean(userId && suspended.has(userId));
}

/** Straight from the database: for creating a booking. */
export async function isProviderSuspendedNow(userId: string | null | undefined) {
  if (!userId) return false;
  const { rows } = await pool.query<{ is_suspended: boolean }>("SELECT is_suspended FROM users WHERE id = $1", [userId]);
  return Boolean(rows[0]?.is_suspended);
}

/** An admin just suspended or restored a provider. */
export function noteProviderSuspension(userId: string, isSuspended: boolean) {
  const next = new Set(suspended);
  if (isSuspended) next.add(userId);
  else next.delete(userId);
  suspended = next;
}

/** For SQL listing searches: the listing's provider isn't suspended. */
export function managerNotSuspended(managerColumn: unknown): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM users suspended_manager WHERE suspended_manager.id = ${managerColumn} AND suspended_manager.is_suspended = true)`;
}
