// server/zaina/idempotency.ts
//
// Server-side duplicate protection for Zaina's create_* tools.
//
// The model used to invent the idempotency key itself. Earlier tool calls are
// stored with that key masked ("***masked***"), so a model that retried by
// copying its earlier arguments sent the same placeholder key in every
// conversation — and a new customer could be handed an older customer's
// request and payment link. Keys are now derived by the server from the
// conversation and the request itself: an identical retry in the same
// conversation reuses the same record, and different conversations can never
// collide.

import { createHash } from "node:crypto";

/** Tools that create something payable and must not be duplicated. */
export const IDEMPOTENT_ZAINA_TOOLS = new Set([
  "create_draft_booking",
  "create_service_booking",
  "create_custom_offer",
  "create_listing_verification_request",
  // A room booking on the platform (the hospitality connector).
  "create_booking",
]);

function canonicalize(value: unknown): unknown {
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ").toLowerCase();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .filter((key) => key !== "idempotency_key")
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function deriveIdempotencyKey(sessionId: string, toolName: string, args: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([sessionId, toolName, canonicalize(args ?? {})]))
    .digest("hex");
  return `zaina_${digest.slice(0, 40)}`;
}

/** Arguments for a tool call, with the server-derived key for create_* tools. */
export function withServerIdempotencyKey(toolName: string, args: unknown, sessionId: string): any {
  const base = args && typeof args === "object" ? { ...(args as Record<string, unknown>) } : {};
  if (!IDEMPOTENT_ZAINA_TOOLS.has(toolName)) return base;
  return { ...base, idempotency_key: deriveIdempotencyKey(sessionId, toolName, base) };
}
