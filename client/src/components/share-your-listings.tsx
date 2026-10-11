import { Share2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListingShareSheet } from "@/components/listing-share-sheet";
import { getCarDisplayName, getListingSharePrice } from "@shared/listing-share";
import type { PublicListingKind } from "@shared/seo";

type Named = { id: string; isPublic: boolean; description?: string | null };
type Assignments = {
  stays?: Array<Named & { title: string }>;
  cars?: Array<Named & { make?: string | null; model: string }>;
  cooks?: Array<Named & { title: string }>;
  errands?: Array<Named & { serviceName: string }>;
  experiences?: Array<Named & { title: string }>;
};

// The partner's public listings, each one tap from the share sheet, at the top
// of Overview: from landing on Partner Hub to WhatsApp in two taps.
export function ShareYourListings({ data }: { data?: Assignments }) {
  const listings: Array<{ kind: PublicListingKind; id: string; name: string; isPublic: boolean; description?: string | null; item: object }> = [
    ...(data?.stays ?? []).map((item) => ({ kind: "stay" as const, id: item.id, name: item.title, isPublic: item.isPublic, description: item.description, item })),
    ...(data?.cars ?? []).map((item) => ({ kind: "car" as const, id: item.id, name: getCarDisplayName(item), isPublic: item.isPublic, description: item.description, item })),
    ...(data?.cooks ?? []).map((item) => ({ kind: "cook" as const, id: item.id, name: item.title, isPublic: item.isPublic, description: item.description, item })),
    ...(data?.errands ?? []).map((item) => ({ kind: "errand" as const, id: item.id, name: item.serviceName, isPublic: item.isPublic, description: item.description, item })),
    ...(data?.experiences ?? []).map((item) => ({ kind: "experience" as const, id: item.id, name: item.title, isPublic: item.isPublic, description: item.description, item })),
  ];
  if (!listings.length) {
    return null;
  }
  const live = listings.filter((listing) => listing.isPublic);

  return (
    <Card className="border-emerald-200/80 bg-white/90 shadow-[0_20px_60px_-42px_rgba(31,122,77,0.4)]" data-testid="card-share-your-listings">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Share2 className="h-5 w-5 text-[#1f7a4d]" />
          Share your listings
        </CardTitle>
        <CardDescription>
          Send a listing on WhatsApp in two taps. Visits and bookings from your links show in Your shares, under Listings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {live.length ? live.map((listing) => (
          <div key={`${listing.kind}-${listing.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 px-3 py-2">
            <span className="min-w-0 truncate text-sm font-medium">{listing.name}</span>
            <ListingShareSheet
              kind={listing.kind}
              id={listing.id}
              name={listing.name}
              description={listing.description}
              {...getListingSharePrice(listing.kind, listing.item)}
              isPublic
              source="provider"
              triggerClassName="shrink-0 border-[#1f7a4d] bg-white text-[#1f7a4d]"
            />
          </div>
        )) : (
          <p className="text-sm text-muted-foreground">
            Your listings can be shared once TBM has checked and published them.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
