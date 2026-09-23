import type { PublicListingKind } from "@shared/seo";
import { getPublicListingPath, slugifyForUrl } from "@shared/seo";

export { getPublicListingPath, slugifyForUrl };
export type { PublicListingKind };

export function getBookingPath(kind: PublicListingKind, id: string) {
  if (kind === "stay") {
    return `/book/${encodeURIComponent(id)}`;
  }

  const bookingType = kind === "car" ? "car" : kind === "cook" ? "cook" : kind === "errand" ? "errand" : "experience";
  return `/book/${bookingType}/${encodeURIComponent(id)}`;
}
