// zaina-platform/src/engine/turn-context.ts
//
// What changes from one message to the next (the date and time, the currency
// prices are shown in, the customer's language) travels with the customer's
// latest message, not in the instructions. The instructions then stay the
// same for every call and every customer, so the model provider can cache
// them, and nothing about one turn is repeated in the history of the next.

import type { ChatLanguage } from "../db/schema.ts";
import { timeZoneLabel } from "../conversations/staffed-hours.ts";
import { businessDay } from "../gateway/spend-cap.ts";

const LANGUAGE_NAMES: Record<ChatLanguage, string> = { en: "English", sw: "Swahili" };

function weekday(at: Date, timeZone: string): string {
  return at.toLocaleDateString("en-GB", { timeZone, weekday: "long" });
}

export function turnContext(input: {
  timeZone: string;
  now: Date;
  currency: string;
  language: ChatLanguage;
  /** On WhatsApp: the customer's number (digits), which they don't need to type. */
  whatsappNumber?: string | null;
}): string {
  const { timeZone, now } = input;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const time = now.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return [
    "<turn_context>",
    `Now: ${weekday(now, timeZone)} ${businessDay(timeZone, now)}, ${time} ${timeZoneLabel(timeZone)}. Tomorrow: ${weekday(tomorrow, timeZone)} ${businessDay(timeZone, tomorrow)}.`,
    `Prices are shown in ${input.currency}. The customer writes in ${LANGUAGE_NAMES[input.language]}.`,
    ...(input.whatsappNumber
      ? [`This chat is on WhatsApp. The customer's WhatsApp number is +${input.whatsappNumber}: use it when a tool needs their phone number, unless they give another. Don't ask for it.`]
      : []),
    "</turn_context>",
  ].join("\n");
}

/** Removes a turn context from text shown back to anyone (it is the system's, not the customer's). */
export function withoutTurnContext(text: string): string {
  return text.replace(/\s*<turn_context>[\s\S]*?<\/turn_context>\s*/g, " ").trim();
}
