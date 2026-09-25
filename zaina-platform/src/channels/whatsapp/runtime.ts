// zaina-platform/src/channels/whatsapp/runtime.ts
//
// The running WhatsApp channel, for code outside it that adds replies (a
// team reply from the console): "deliver this chat's replies now". Does
// nothing when the platform has no WhatsApp set up.

import type { WhatsappContext } from "./context.ts";
import { deliverSession, type DeliveryResult } from "./delivery.ts";

let current: WhatsappContext | null = null;

export function setWhatsappRuntime(context: WhatsappContext | null) {
  current = context;
}

export function whatsappRuntime(): WhatsappContext | null {
  return current;
}

/** Delivers a WhatsApp chat's waiting replies; gives up waiting after `waitMs` (delivery carries on). */
export async function requestDelivery(businessId: string, sessionId: string, waitMs = 8_000): Promise<DeliveryResult | { status: "pending" | "off"; sent: number }> {
  if (!current) return { status: "off", sent: 0 };
  const delivery = deliverSession(current, businessId, sessionId).catch((error) => {
    console.error(`[whatsapp] delivering ${sessionId} failed:`, error);
    return { status: "retry" as const, sent: 0 };
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ status: "pending"; sent: number }>((resolve) => {
    timer = setTimeout(() => resolve({ status: "pending", sent: 0 }), waitMs);
  });
  try {
    return await Promise.race([delivery, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
