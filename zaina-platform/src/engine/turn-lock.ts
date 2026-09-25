// zaina-platform/src/engine/turn-lock.ts
//
// One turn at a time per conversation (I3). Two messages sent quickly used to
// start two agent loops that could each create a booking. Now the running
// turn holds a lease on the session; a message that arrives meanwhile gets a
// "still working" reply. The lease expires on its own if a server dies
// mid-turn, so a conversation can never stay locked.

import { randomUUID } from "node:crypto";
import type pg from "pg";

export const BUSY_REPLY = "I'm still working on your last message — send this one again in a moment.";

/** Takes the session's lease for `leaseMs`; null when another turn holds it. */
export async function acquireTurnLock(pool: pg.Pool, sessionId: string, leaseMs: number): Promise<string | null> {
  const lockId = randomUUID();
  const { rowCount } = await pool.query(
    `update chat_sessions
     set turn_lock_id = $2, turn_lock_until = now() + make_interval(secs => $3::double precision / 1000)
     where id = $1 and (turn_lock_until is null or turn_lock_until < now())`,
    [sessionId, lockId, leaseMs],
  );
  return rowCount ? lockId : null;
}

export async function releaseTurnLock(pool: pg.Pool, sessionId: string, lockId: string): Promise<void> {
  await pool.query(
    "update chat_sessions set turn_lock_id = null, turn_lock_until = null where id = $1 and turn_lock_id = $2",
    [sessionId, lockId],
  );
}
