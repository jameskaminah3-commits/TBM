import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import type { PublicListingKind } from "@shared/seo";

const listingGroup: Record<PublicListingKind, string> = {
  stay: "stays",
  car: "cars",
  cook: "cooks",
  errand: "errands",
  experience: "experiences",
};

// Whether the signed-in provider manages this listing, so their shares count as
// provider-led. Public listing data no longer names the owner, so this asks the
// provider's own listings.
export function useOwnsListing(kind: PublicListingKind, id: string | null | undefined) {
  const { user } = useAuth();
  const isProvider = user?.role === "provider";
  const { data } = useQuery<Record<string, Array<{ id: string }>>>({
    queryKey: ["/api/provider/assignments"],
    enabled: isProvider,
    staleTime: 5 * 60_000,
  });
  return Boolean(isProvider && id && data?.[listingGroup[kind]]?.some((listing) => listing.id === id));
}
