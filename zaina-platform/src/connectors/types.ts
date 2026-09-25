// zaina-platform/src/connectors/types.ts
//
// What a business plugs into the engine. The engine runs the conversation;
// a connector supplies the business's instructions and tools, tells its team
// about events, and records payments it takes in chat. TBM is the first
// connector. The data stays in the business's system; Zaina reaches it only
// through these calls.

import type { FunctionDeclaration } from "@google/genai";
import type { Business, ChatLanguage } from "../db/schema.ts";

export type ToolContext = { business: Business; sessionId: string };

export type TeamEvent =
  | { kind: "conversation-started"; sessionId: string; firstMessage: string }
  /** A customer is waiting for a person (offered first to routedTo, when someone was available). */
  | { kind: "handoff"; sessionId: string; reason: string; routedTo?: { userId: string; name: string } | null }
  /** No one can answer now (outside staffed hours, or nobody claimed it): call the customer back. */
  | { kind: "callback"; sessionId: string; reason: string; why: "offline" | "unclaimed"; staffBackAt: Date | null }
  | { kind: "system-error"; sessionId: string; summary: string; details?: Record<string, unknown> }
  /** The business used its daily model budget; Zaina is answering with contact details. */
  | { kind: "spend-cap"; day: string; usedTokens: number; capTokens: number };

export type ChatPaymentResult =
  | {
      ok: true;
      bookingRef: string;
      /** The amount the team should see, as the customer was asked for it ("KSh 2,500"). */
      expectedAmount: string;
      /** Set when the dates were taken meanwhile: the team moves or refunds. */
      conflict: string | null;
      /** Whether the booking's dates are now held while the team checks the code. */
      datesHeld: boolean;
      alreadyRecorded: boolean;
    }
  | { ok: false; reason: "no_booking" | "already_paid" | "failed"; detail?: string };

export interface BusinessConnector {
  /** The business's instructions and knowledge for the model. */
  systemPrompt(business: Business): string | Promise<string>;
  toolDeclarations(): FunctionDeclaration[];
  /** Tools that only read, so several can run at once. */
  readOnlyTools: ReadonlySet<string>;
  executeTool(name: string, args: unknown, context: ToolContext): Promise<any>;
  notifyTeam(business: Business, event: TeamEvent): Promise<void>;
  /** C5: record a payment code the customer sent in chat against the booking made in that chat. */
  recordChatPayment?(business: Business, input: { sessionId: string; code: string }): Promise<ChatPaymentResult>;
  /** How customers reach the business when Zaina can't help ("WhatsApp or call +254 …"), in the chat's language. */
  contactLine(business: Business, language?: ChatLanguage): string | Promise<string>;
}
