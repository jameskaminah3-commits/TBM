import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPublicListingPath, type PublicListingKind } from "@shared/seo";

type ListingSummary = {
  id: string;
  title?: string;
  model?: string;
  make?: string | null;
  serviceName?: string;
  location?: string;
  experienceLocation?: string | null;
  imageUrl?: string | null;
};

const listEndpoint: Record<PublicListingKind, string> = {
  stay: "/api/stays",
  car: "/api/cars",
  cook: "/api/cooks",
  errand: "/api/errands",
  experience: "/api/experiences",
};

function summaryName(kind: PublicListingKind, listing: ListingSummary) {
  if (kind === "car") return `${listing.make ? `${listing.make} ` : ""}${listing.model ?? ""}`.trim();
  if (kind === "errand") return listing.serviceName ?? "";
  return listing.title ?? "";
}

// What a shared link shows when its listing is unpublished, removed or never
// existed: a way on to similar listings instead of a dead end.
export function ListingUnavailable({
  kind,
  browseHref,
  browseLabel,
}: {
  kind: PublicListingKind;
  browseHref: string;
  browseLabel: string;
}) {
  const { data: listings = [] } = useQuery<ListingSummary[]>({ queryKey: [listEndpoint[kind]] });
  const suggestions = listings.slice(0, 3);

  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6" data-testid="listing-unavailable">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="font-serif text-3xl font-medium">This listing isn't available right now</h1>
        <p className="mt-3 text-muted-foreground">
          It may have been taken down or be under review. Here are similar options on Tembea Bila Matata.
        </p>
      </div>
      {suggestions.length ? (
        <ul className="mt-10 grid gap-4 sm:grid-cols-3">
          {suggestions.map((listing) => {
            const name = summaryName(kind, listing);
            return (
              <li key={listing.id}>
                <Link
                  href={getPublicListingPath(kind, listing.id, name)}
                  className="group block overflow-hidden rounded-2xl border bg-card transition-shadow hover:shadow-md"
                >
                  {listing.imageUrl ? (
                    <img src={listing.imageUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  ) : (
                    <div className="aspect-[4/3] w-full bg-muted" />
                  )}
                  <div className="space-y-1 p-4">
                    <p className="font-medium text-foreground group-hover:underline">{name}</p>
                    <p className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      {listing.experienceLocation || listing.location}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="mt-8 text-center">
        <Button asChild className="rounded-full">
          <Link href={browseHref}>{browseLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
