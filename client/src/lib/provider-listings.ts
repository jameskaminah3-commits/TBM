// Every listing a provider manages, in one shape, so Overview, Share & grow and
// the service pages can treat stays, vehicles, chefs, home help and
// experiences alike.
import type { ProviderCategory } from "@shared/schema";
import type { PublicListingKind } from "@shared/seo";
import { getCarDisplayName, getListingSharePrice } from "@shared/listing-share";
import type { ProviderListings } from "@/hooks/use-provider-hub";

export type HubListing = {
  workspace: ProviderCategory;
  kind: PublicListingKind;
  id: string;
  name: string;
  location: string | null;
  isPublic: boolean;
  imageUrl: string | null;
  description: string | null;
  manageHref: string;
  calendarHref: string;
  share: { priceUsd: number; priceUnit: string } | null;
};

const listingKinds: Record<ProviderCategory, PublicListingKind> = {
  stays: "stay",
  cars: "car",
  cooks: "cook",
  errands: "errand",
  experiences: "experience",
};

const managePaths: Record<ProviderCategory, (id: string) => string> = {
  stays: (id) => `/provider/stays/${id}/availability`,
  cars: (id) => `/provider/cars/${id}/availability`,
  cooks: (id) => `/provider/cooks/${id}/edit`,
  errands: (id) => `/provider/errands/${id}/edit`,
  experiences: (id) => `/provider/experiences/${id}/edit`,
};

type AnyListing = {
  id: string;
  isPublic: boolean;
  imageUrl?: string | null;
  mediaType?: string | null;
  description?: string | null;
  location?: string | null;
};

function imageOf(listing: AnyListing) {
  return listing.mediaType === "video" ? null : listing.imageUrl || null;
}

export function toHubListings(data: ProviderListings | undefined, workspaces?: readonly ProviderCategory[]): HubListing[] {
  if (!data) return [];
  const rows: HubListing[] = [];
  const push = (workspace: ProviderCategory, listing: AnyListing, name: string) => {
    const kind = listingKinds[workspace];
    const manageHref = managePaths[workspace](listing.id);
    rows.push({
      workspace,
      kind,
      id: listing.id,
      name,
      location: listing.location ?? null,
      isPublic: listing.isPublic,
      imageUrl: imageOf(listing),
      description: listing.description ?? null,
      manageHref,
      calendarHref: `${manageHref}#availability`,
      share: getListingSharePrice(kind, listing as Parameters<typeof getListingSharePrice>[1]),
    });
  };
  for (const stay of data.stays ?? []) push("stays", stay, stay.title);
  for (const car of data.cars ?? []) push("cars", car, getCarDisplayName(car));
  for (const cook of data.cooks ?? []) push("cooks", cook, cook.title);
  for (const errand of data.errands ?? []) push("errands", errand, errand.serviceName);
  for (const experience of data.experiences ?? []) push("experiences", experience, experience.title);
  return workspaces ? rows.filter((row) => workspaces.includes(row.workspace)) : rows;
}
