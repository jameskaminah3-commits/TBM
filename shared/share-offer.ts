// A friend's discount on a guest's share link. TBM's admin marks one live promo
// for "Guest shares"; a guest's link carries its code, and the friend who books
// through it gets the discount at checkout, through the existing promo codes.
// The person sharing gets nothing in return: no referral payments, and who pays
// for the discount is the promo's own setting (TBM, the provider, or shared).
export const GUEST_SHARE_CHANNEL = "guest-share";

export type ShareOffer = {
  code: string;
  name: string;
  promoType: "percent" | "fixed";
  discountPercent: number | null;
  /** US dollars. */
  discountAmount: number | null;
  minimumNights: number | null;
  /** US dollars. */
  minimumSpend: number | null;
  /** YYYY-MM-DD, the last day it applies. */
  endAt: string | null;
};

type PromoLike = {
  code: string | null;
  name: string;
  channel: string;
  promoType: string;
  discountPercent: number | null;
  discountAmount: number | null;
  minimumNights: number | null;
  minimumSpend: number | null;
  endAt: string | null;
  updatedAt?: string | null;
};

/** The live guest-share promo, as the public sees it: no IDs, counts or notes. */
export function pickShareOffer(livePromos: PromoLike[]): ShareOffer | null {
  const offer = livePromos
    .filter((promo) => promo.channel === GUEST_SHARE_CHANNEL && Boolean(promo.code)
      && ((promo.promoType === "percent" && (promo.discountPercent ?? 0) > 0) || (promo.promoType === "fixed" && (promo.discountAmount ?? 0) > 0)))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  if (!offer) return null;
  return {
    code: offer.code!,
    name: offer.name,
    promoType: offer.promoType as ShareOffer["promoType"],
    discountPercent: offer.promoType === "percent" ? offer.discountPercent : null,
    discountAmount: offer.promoType === "fixed" ? offer.discountAmount : null,
    minimumNights: offer.minimumNights ?? null,
    minimumSpend: offer.minimumSpend ?? null,
    endAt: offer.endAt ?? null,
  };
}

/** "10%" or a formatted amount ("KSh 2,580"). */
export function shareOfferValue(offer: ShareOffer, formatUsd: (amountUsd: number) => string) {
  return offer.promoType === "percent" ? `${offer.discountPercent}%` : formatUsd(offer.discountAmount ?? 0);
}

/** The conditions, in a few words: "on 2 nights or more · until 31 Dec". */
export function shareOfferTerms(offer: ShareOffer, formatUsd: (amountUsd: number) => string) {
  const terms: string[] = [];
  if (offer.minimumNights) terms.push(`on ${offer.minimumNights} night${offer.minimumNights === 1 ? "" : "s"} or more`);
  if (offer.minimumSpend) terms.push(`on bookings from ${formatUsd(offer.minimumSpend)}`);
  if (offer.endAt) {
    const [year, month, day] = offer.endAt.split("-").map(Number);
    if (year && month && day) {
      terms.push(`until ${new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`);
    }
  }
  return terms.join(" · ");
}

/** The line the sharer sends, in their own voice. */
export function shareOfferMessageLine(value: string) {
  return `Book through my link and you get ${value} off with TBM:`;
}

export function withPromoCode(url: string, code: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("promoCode", code);
  return parsed.toString();
}
