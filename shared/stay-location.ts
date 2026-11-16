// shared/stay-location.ts
//
// Where a stay is, as a Google Maps link its owner pastes.
//
// A hotel's address is public. A home's isn't: by default guests see the
// area an entire place is in, and get the exact pin once they've booked,
// unless its owner chooses to show the pin to everyone.

import { isHotelStay } from "./hotel-rooms.ts";

const MAPS_SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co"]);
const GOOGLE_HOST = /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/i;

export type MapLinkResult = { ok: true; url: string } | { ok: false; error: string };

const NOT_A_MAPS_LINK = "Paste the link Google Maps gives when you tap Share on the place (it starts with https://maps.app.goo.gl or https://www.google.com/maps).";

/** A pasted Google Maps link as an https address, or why it can't be used. Only Google Maps links are taken. */
export function normalizeGoogleMapsLink(input: string | null | undefined): MapLinkResult {
  const text = String(input ?? "").trim();
  if (!text) {
    return { ok: false, error: NOT_A_MAPS_LINK };
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: NOT_A_MAPS_LINK };
  }
  if (url.username || url.password || url.port) {
    return { ok: false, error: NOT_A_MAPS_LINK };
  }
  url.protocol = "https:";
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const isShort = MAPS_SHORT_HOSTS.has(host) && (host === "maps.app.goo.gl" ? path.length > 1 : path.startsWith("/maps"));
  const isGoogleMaps = GOOGLE_HOST.test(host) && (host.startsWith("maps.") || path.startsWith("/maps"));
  if (!isShort && !isGoogleMaps) {
    return { ok: false, error: NOT_A_MAPS_LINK };
  }
  url.hash = "";
  const link = url.toString();
  return link.length <= 600 ? { ok: true, url: link } : { ok: false, error: "That link is too long. Use Share in Google Maps to get a short one." };
}

/** Whether everyone sees a stay's exact pin: a hotel's by default, a home's only when its owner says so. */
export function isExactLocationPublic(stay: { propertyType?: string | null; showExactLocation?: boolean | null }): boolean {
  return stay.showExactLocation ?? isHotelStay(stay);
}

/** Google Maps opened on an area ("Galu Beach, Diani"), not on an address. */
export function getAreaMapsLink(location: string): string {
  const place = /kenya/i.test(location) ? location : `${location}, Kenya`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.trim())}`;
}
