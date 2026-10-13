// Sharing a listing: the public link (with tracking that names no account) and
// the message that goes with it.
import { getPublicListingPath, type PublicListingKind } from "./seo.ts";

export type ShareChannel = "whatsapp" | "copy" | "native" | "qr";
// "provider" when the listing's own provider shares it; "tbm" for TBM's
// Spotlight; "visitor" for anyone else.
export type ShareSource = "provider" | "tbm" | "visitor";

export function buildListingShareUrl(
  origin: string,
  listing: { kind: PublicListingKind; id: string; name: string },
  // code: the provider's random share code (Phase 3), when they have one.
  options: { source: ShareSource; channel: ShareChannel; code?: string | null },
) {
  return buildShareUrl(origin, getPublicListingPath(listing.kind, listing.id, listing.name), { ...options, campaign: "listing_share" });
}

// A provider's whole page (/p/<code>/<slug>), shared by the provider. Its own
// campaign tag, so it's never mistaken for an older listing link (R1).
export function buildProviderPageShareUrl(origin: string, path: string, options: { channel: ShareChannel; code?: string | null }) {
  return buildShareUrl(origin, path, { ...options, source: "provider", campaign: "provider_page" });
}

// TBM's Spotlight: TBM shares a provider's page (shared/spotlight.ts).
export function buildSpotlightShareUrl(origin: string, path: string, options: { channel: ShareChannel; code?: string | null }) {
  return buildShareUrl(origin, path, { ...options, source: "tbm", campaign: "spotlight" });
}

function buildShareUrl(origin: string, path: string, options: { source: ShareSource; channel: ShareChannel; code?: string | null; campaign: string }) {
  const url = new URL(path, origin);
  if (options.code) {
    url.searchParams.set("ref", options.code);
  }
  url.searchParams.set("utm_source", options.source === "visitor" ? "share" : options.source);
  url.searchParams.set("utm_medium", options.channel);
  url.searchParams.set("utm_campaign", options.campaign);
  return url.toString();
}

// A car's name as guests see it: make and model ("Toyota Noah"), without
// repeating the make when the model already starts with it.
export function getCarDisplayName(car: { make?: string | null; model?: string | null }) {
  const make = car.make?.trim() ?? "";
  const model = car.model?.trim() ?? "";
  if (!model) return make || "Car";
  if (!make || model.toLowerCase().startsWith(make.toLowerCase())) return model;
  return `${make} ${model}`;
}

const kindNoun: Record<PublicListingKind, string> = {
  stay: "stay",
  car: "car",
  cook: "chef",
  errand: "service",
  experience: "experience",
};

// The first sentence, or the first ~140 characters cut at a word.
export function shortShareDescription(text: string | null | undefined, maxLength = 140) {
  const clean = (text ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentence = clean.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? clean;
  if (sentence.length <= maxLength) return sentence;
  const clipped = sentence.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 60 ? clipped.slice(0, lastSpace) : clipped).replace(/[,;:\s]+$/, "")}…`;
}

// A price only goes in when the sharer chooses, and always with its conditions.
export function formatSharePriceLine(amountKes: number, unit: string) {
  return `From KSh ${Math.round(amountKes).toLocaleString("en-KE")} ${unit}, subject to availability and TBM's terms.`;
}

export function buildListingShareMessage(args: {
  kind: PublicListingKind;
  name: string;
  description?: string | null;
  url: string;
  priceLine?: string | null;
}) {
  return [
    `Check out this ${kindNoun[args.kind]} on Tembea Bila Matata: ${args.name}`,
    shortShareDescription(args.description),
    args.priceLine ?? "",
    `View details: ${args.url}`,
  ].filter(Boolean).join("\n");
}

// No personal number: guests reach the provider through TBM.
export function buildProviderPageShareMessage(args: { name: string; services?: string | null; url: string }) {
  return [
    `${args.name}${args.services ? `: ${args.services}` : ""}, on Tembea Bila Matata.`,
    "See my services and book through TBM, with M-Pesa or card and TBM's support throughout.",
    args.url,
  ].join("\n");
}

export function buildWhatsAppShareHref(message: string) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

type PricedListing = {
  price?: number | null;
  propertyType?: string | null;
  pricePerDay?: number | null;
  priceWithDriver?: number | null;
  serviceFee?: number | null;
  pricePerSession?: number | null;
  basePrice?: number | null;
  privatePricePerPerson?: number | null;
  sharedPricePerPerson?: number | null;
};

// The listing's current public starting price (US dollars) and how it's counted.
export function getListingSharePrice(kind: PublicListingKind, listing: PricedListing): { priceUsd: number; priceUnit: string } | null {
  const pick = (...amounts: Array<number | null | undefined>) => amounts.find((amount) => (amount ?? 0) > 0) ?? 0;
  const options: Record<PublicListingKind, { priceUsd: number; priceUnit: string }> = {
    stay: { priceUsd: pick(listing.price), priceUnit: listing.propertyType === "hotel" ? "a room a night" : "a night" },
    car: listing.pricePerDay && listing.pricePerDay > 0
      ? { priceUsd: listing.pricePerDay, priceUnit: "a day, self-drive" }
      : { priceUsd: pick(listing.priceWithDriver), priceUnit: "a day with a driver" },
    cook: { priceUsd: pick(listing.serviceFee, listing.pricePerSession), priceUnit: "for the chef's service" },
    errand: { priceUsd: pick(listing.basePrice), priceUnit: "to start" },
    experience: { priceUsd: pick(listing.privatePricePerPerson, listing.sharedPricePerPerson, listing.price), priceUnit: "a person" },
  };
  const option = options[kind];
  return option.priceUsd > 0 ? option : null;
}
