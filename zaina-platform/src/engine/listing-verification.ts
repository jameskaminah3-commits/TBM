// server/zaina/listing-verification.ts
//
// Pure helpers for Zaina's paid listing-verification requests. A traveller
// may find a stay on Facebook, Jiji, Airbnb — or through an agent who only
// shared photos and a phone number on WhatsApp. TBM can check any of these on
// the ground, so a request works from a link, from the details the customer
// has, or both.

const KNOWN_COAST_LOCATIONS = [
  "nyali", "diani", "shanzu", "mtwapa", "bamburi", "mombasa", "malindi", "watamu", "mambrui", "kilifi", "tudor", "likoni",
];

const DOMAIN_LIKE = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]\S*)?$/i;

/**
 * A usable web link from what the customer pasted, or null if there isn't
 * one. "jiji.co.ke/…" pasted without https:// is completed automatically.
 */
export function normalizeListingLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim().split(/\s+/).find((part) => /^https?:\/\//i.test(part) || DOMAIN_LIKE.test(part));
  if (!token) return null;
  let value = token.replace(/[.,;:!?)]+$/, "");
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) return null;
    return value;
  } catch {
    return null;
  }
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Where the listing came from and which Coast area it is in, for the team. */
export function describeListingSource(
  link: string | null,
  context: string,
  location?: string,
): { sourcePlatform: string; location: string | null } {
  const contextText = context.toLowerCase();
  let linkText = "";
  let sourcePlatform: string;

  if (link) {
    const url = new URL(link);
    linkText = `${url.hostname} ${url.pathname} ${url.search}`.toLowerCase();
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    sourcePlatform = host.includes("jiji")
      ? "Jiji"
      : host.includes("facebook") || host.includes("fb.")
        ? "Facebook"
        : host.includes("airbnb")
          ? "Airbnb"
          : host;
  } else if (/whats\s?app/.test(contextText)) {
    sourcePlatform = "WhatsApp (no link)";
  } else if (/facebook|\bfb\b/.test(contextText)) {
    sourcePlatform = "Facebook (no link)";
  } else if (/instagram|\binsta\b/.test(contextText)) {
    sourcePlatform = "Instagram (no link)";
  } else if (/tiktok/.test(contextText)) {
    sourcePlatform = "TikTok (no link)";
  } else {
    sourcePlatform = "Agent or private listing (no link)";
  }

  // The link is the most reliable source, then the location Zaina was told,
  // then anything the customer wrote.
  const detected = KNOWN_COAST_LOCATIONS.find((place) => linkText.includes(place))
    ?? (location?.trim() || KNOWN_COAST_LOCATIONS.find((place) => contextText.includes(place)))
    ?? null;
  return { sourcePlatform, location: detected ? titleCase(detected) : null };
}

/** At least this much description is needed to verify a listing that has no link. */
export const MIN_LISTING_DETAILS_LENGTH = 15;
