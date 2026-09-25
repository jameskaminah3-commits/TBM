// zaina-platform/src/engine/turn-budget.ts
//
// A time budget for one chat turn (I4). Every model call gets only the time
// that is left, and a call that would start with too little time left isn't
// made: the customer gets an answer within the budget instead of a spinner.

export class TurnTimeoutError extends Error {
  constructor(message = "The turn ran out of time") {
    super(message);
    this.name = "TurnTimeoutError";
  }
}

export type TurnBudget = {
  /** Milliseconds left, never below 0. */
  remainingMs(): number;
  expired(): boolean;
  /** Whether there is at least this much time left. */
  hasAtLeast(ms: number): boolean;
  /** An abort signal that fires when the budget runs out. */
  signal(): AbortSignal;
};

export function createTurnBudget(totalMs: number, now: () => number = Date.now): TurnBudget {
  const deadline = now() + totalMs;
  const remainingMs = () => Math.max(0, deadline - now());
  return {
    remainingMs,
    expired: () => remainingMs() <= 0,
    hasAtLeast: (ms: number) => remainingMs() >= ms,
    signal: () => AbortSignal.timeout(Math.max(1, remainingMs())),
  };
}

/** Whether an error came from the budget running out (our abort or timeout). */
export function isBudgetError(error: unknown): boolean {
  if (error instanceof TurnTimeoutError) return true;
  const name = (error as { name?: unknown })?.name;
  return name === "AbortError" || name === "TimeoutError";
}
