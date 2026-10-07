// Opens Zaina's chat from anywhere on the site. A message, when given, is
// typed into her box for the guest to check and send, so pages can start a
// conversation with context ("I'm looking at this villa for these dates").
//
// When Zaina is switched off, the same message opens WhatsApp instead, so
// a "Plan with Zaina" button never leads nowhere.

import { WHATSAPP_URL } from "@/lib/contact-info";

export const ZAINA_OPEN_EVENT = "tbm:open-zaina";

export type OpenZainaDetail = { message?: string };

let zainaAvailable = false;

/** Called by the Zaina widget once it knows whether the chat is switched on. */
export function setZainaAvailable(available: boolean) {
  zainaAvailable = available;
}

export function whatsAppUrlWithText(text: string) {
  const separator = WHATSAPP_URL.includes("?") ? "&" : "?";
  return `${WHATSAPP_URL}${separator}text=${encodeURIComponent(text)}`;
}

export function openZaina(message?: string) {
  if (!zainaAvailable) {
    const text = message?.trim() || "Hi Tembea Bila Matata, I'd like help planning my Coast trip.";
    window.open(whatsAppUrlWithText(text), "_blank", "noopener");
    return;
  }
  window.dispatchEvent(new CustomEvent<OpenZainaDetail>(ZAINA_OPEN_EVENT, { detail: { message } }));
}
