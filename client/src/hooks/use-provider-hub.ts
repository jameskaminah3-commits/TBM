import { useQuery } from "@tanstack/react-query";
import type { Car, Cook, Errand, Experience, ProviderBookingAssignmentView, Stay } from "@shared/schema";
import { awaitsProviderResponse } from "@shared/provider-dashboard";
import { getProviderWorkspaceKeys, type WorkspaceListingCounts } from "@shared/provider-workspaces";
import { useAuth } from "@/hooks/useAuth";

export type ProviderListings = {
  stays: Stay[];
  cars: Car[];
  cooks: Cook[];
  errands: Errand[];
  experiences: Experience[];
};

export type ProviderProfileSummary = {
  businessName: string;
  photoUrl: string;
  verificationStatus: "not-started" | "in-review" | "verified";
  hasPayout: boolean;
};

const closedStatuses = new Set(["cancelled", "completed"]);

// A custom menu or experience offer still waiting for the provider's quote.
export function needsProviderQuote(entry: ProviderBookingAssignmentView) {
  if (closedStatuses.has(entry.assignment.status)) return false;
  const mode = entry.assignment.serviceConfig?.serviceMode || entry.booking.serviceMode;
  if (mode === "cook-custom-menu") return (entry.booking.customMenuProposalStatus ?? "pending") === "pending";
  if (mode === "experience-custom-offer") return (entry.booking.experienceCustomOfferStatus ?? "pending") === "pending";
  return false;
}

// What Provider Hub's frame needs on every page: which services this provider
// offers, how many listings each has, and what's waiting for them.
export function useProviderHub() {
  const { user, isProvider, isAdmin } = useAuth();
  const enabled = Boolean(isProvider || isAdmin);
  const listingsQuery = useQuery<ProviderListings>({ queryKey: ["/api/provider/assignments"], enabled });
  const bookingsQuery = useQuery<ProviderBookingAssignmentView[]>({ queryKey: ["/api/provider/booking-assignments"], enabled });
  const profileQuery = useQuery<ProviderProfileSummary>({ queryKey: ["/api/provider/profile/summary"], enabled });

  const listings = listingsQuery.data;
  const listingCounts: WorkspaceListingCounts = {
    stays: listings?.stays?.length ?? 0,
    cars: listings?.cars?.length ?? 0,
    cooks: listings?.cooks?.length ?? 0,
    errands: listings?.errands?.length ?? 0,
    experiences: listings?.experiences?.length ?? 0,
  };
  const workspaces = getProviderWorkspaceKeys(isAdmin ? [] : user?.providerTypes ?? [], listingCounts);
  const bookings = bookingsQuery.data ?? [];
  const awaitingResponseCount = bookings.filter((entry) => awaitsProviderResponse(entry.assignment)).length;
  const quotesNeededCount = bookings.filter(needsProviderQuote).length;

  return {
    user,
    isAdmin,
    workspaces,
    listings,
    listingCounts,
    bookings,
    awaitingResponseCount,
    quotesNeededCount,
    profile: profileQuery.data,
    isLoading: listingsQuery.isLoading,
  };
}
