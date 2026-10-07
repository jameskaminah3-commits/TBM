import type { PublicListingKind } from "@shared/seo";
import {
  buildListingSeoDescription,
  formatSeoLocation,
  getListingSeoTitle,
  getPublicListingPath,
  getShortSeoLocation,
  slugifyForUrl,
  truncateSeoText,
} from "@shared/seo";

export {
  buildListingSeoDescription,
  formatSeoLocation,
  getListingSeoTitle,
  getPublicListingPath,
  getShortSeoLocation,
  slugifyForUrl,
  truncateSeoText,
};
export type { PublicListingKind };

/** A listing's own page (a stay, car, chef, errand or experience), which has a pinned booking bar on phones. */
export function isListingDetailPath(pathname: string) {
  return /^\/(accommodation|transport|chef|errand|experience)\/[^/]+/.test(pathname);
}

export function getBookingPath(kind: PublicListingKind, id: string) {
  if (kind === "stay") {
    return `/book/${encodeURIComponent(id)}`;
  }

  const bookingType = kind === "car" ? "car" : kind === "cook" ? "cook" : kind === "errand" ? "errand" : "experience";
  return `/book/${bookingType}/${encodeURIComponent(id)}`;
}
