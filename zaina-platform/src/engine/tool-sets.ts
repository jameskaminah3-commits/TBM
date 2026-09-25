// zaina-platform/src/engine/tool-sets.ts
//
// Which tools Zaina gets, by business type. Every business gets its
// knowledge search and a handoff to its team; the rest comes from the
// business's connector:
//
//   general           answers from its knowledge, and leads for its team
//   guesthouse        the same until room bookings arrive (Phase 4)
//   travel_concierge  search, pricing and booking over the business's own
//                     system (TBM)
//
// A business only ever sees the tools of its own type, so a guesthouse's
// calls don't carry TBM's car-hire and chef tools.

import { Type, type FunctionDeclaration } from "@google/genai";
import type { BusinessConnector } from "../connectors/types.ts";
import type { Business, BusinessType } from "../db/schema.ts";
import { SEARCH_KNOWLEDGE, searchKnowledgeDeclaration } from "../knowledge/tool.ts";

export const ESCALATE_TO_HUMAN = "escalate_to_human";

export const escalateDeclaration: FunctionDeclaration = {
  name: ESCALATE_TO_HUMAN,
  description: "Hand the chat to a person on the team (see when in your instructions).",
  parameters: {
    type: Type.OBJECT,
    properties: { reason: { type: Type.STRING, description: "Short reason, for the team." } },
    required: ["reason"],
  },
};

/** Tools every business gets, answered by the engine itself. */
export const SHARED_TOOLS: FunctionDeclaration[] = [searchKnowledgeDeclaration, escalateDeclaration];
/** Shared tools that only read, and may run alongside other reads. */
export const SHARED_READ_ONLY = new Set([SEARCH_KNOWLEDGE]);

/** Business types whose tools need a connector of their own (no fallback). */
export const TYPES_WITH_OWN_CONNECTOR: ReadonlySet<BusinessType> = new Set(["travel_concierge"]);

export function toolDeclarationsFor(_business: Business, connector: BusinessConnector): FunctionDeclaration[] {
  return [...connector.toolDeclarations(), ...SHARED_TOOLS];
}

export function isReadOnlyTool(name: string, connector: BusinessConnector): boolean {
  return SHARED_READ_ONLY.has(name) || connector.readOnlyTools.has(name);
}
