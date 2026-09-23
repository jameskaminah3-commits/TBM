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

export function getBookingPath(kind: PublicListingKind, id: string) {
  if (kind === "stay") {
    return `/book/${encodeURIComponent(id)}`;
  }

  const bookingType = kind === "car" ? "car" : kind === "cook" ? "cook" : kind === "errand" ? "errand" : "experience";
  return `/book/${bookingType}/${encodeURIComponent(id)}`;
}
