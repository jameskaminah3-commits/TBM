// zaina-platform/src/channels/whatsapp/context.ts
//
// What the WhatsApp channel needs from the service: its Meta settings, the
// engine that answers, and the rate limits every channel shares.

import type { RateLimits, WhatsappConfig } from "../../config.ts";
import type { EngineOptions } from "../../engine/agent.ts";

export type WhatsappContext = {
  whatsapp: WhatsappConfig;
  engine: EngineOptions;
  /** Keys the customer's number for rate limits, as a website visitor's address is keyed. */
  sessionSecret: string;
  limits: RateLimits;
};
