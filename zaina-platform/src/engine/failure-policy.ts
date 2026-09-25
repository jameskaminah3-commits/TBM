// zaina-platform/src/engine/failure-policy.ts
//
// When the model fails, the customer isn't handed to a person on the first
// error (C4b). Zaina apologises and asks them to try again; only several
// failed turns in a row hand the conversation to the team. A turn that works
// resets the count.

export const FAILURES_BEFORE_HANDOFF = 3;

export type FailureDecision = { failures: number; handOff: boolean };

export function afterFailedTurn(consecutiveFailures: number, threshold = FAILURES_BEFORE_HANDOFF): FailureDecision {
  const failures = Math.max(0, consecutiveFailures) + 1;
  return { failures, handOff: failures >= threshold };
}

export const RETRY_LATER_REPLY =
  "Sorry, I couldn't answer that just now. Could you send your message again?";

export const TIMEOUT_REPLY =
  "Sorry, that took longer than it should. Could you send your message again?";
