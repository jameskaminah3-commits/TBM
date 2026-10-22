// A public listing's structured data for Google: the listing itself and its
// breadcrumb, as two nodes of one graph. The server sends it with the page and
// the page sets the same once it loads, so Google reads one version.
//
// Each type gets only properties schema.org gives it: a place to stay has a
// price range, not an offer; a car and an experience are sold with an offer; a
// breadcrumb stands on its own, since only a web page can carry one.
import { isHotelStay } from "./hotel-rooms.ts";
import { listingBreadcrumb, listingSeoArea, toSeoListingInput } from "./listing-seo.ts";
import { getShortSeoLocation, truncateSeoText, type PublicListingKind } from "./seo.ts";

export type ListingStructuredDataInput = {
  kind: PublicListingKind;
  listing: Record<string, unknown>;
  name: string;
  /** The listing's canonical address, absolute. */
  url: string;
  /** The site's origin, for the breadcrumb and relative photo addresses. */
  origin: string;
  /** From eligible reviews only, and only once there are enough to show (review-eligibility.ts). */
  rating: { average: number; count: number } | null;
};

const siteName = "Tembea Bila Matata";

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The first photo that isn't a video, as an absolute address. */
export function listingPhotoUrl(listing: Record<string, unknown>, origin: string) {
  const gallery = Array.isArray(listing.galleryUrls) ? listing.galleryUrls : [];
  const photo = [listing.imageUrl, ...gallery]
    .map(str)
    .find((url) => url && !url.startsWith("data:") && !url.startsWith("blob:") && !/\.(mp4|webm|mov)(\?.*)?$/i.test(url));
  if (!photo) return null;
  return /^https?:\/\//.test(photo) ? photo : `${origin}${photo.startsWith("/") ? "" : "/"}${photo}`;
}

/** The price a listing is shown from, in US dollars. */
export function listingLeadPrice(kind: PublicListingKind, listing: Record<string, unknown>) {
  if (kind === "stay") return num(listing.price);
  if (kind === "car") return num(listing.pricePerDay) || num(listing.priceWithDriver);
  if (kind === "cook") return num(listing.serviceFee) || num(listing.pricePerSession);
  if (kind === "errand") return num(listing.basePrice);
  return num(listing.privatePricePerPerson) || num(listing.sharedPricePerPerson) || num(listing.price);
}

export function buildListingStructuredData({ kind, listing, name, url, origin, rating }: ListingStructuredDataInput) {
  const input = toSeoListingInput(kind, listing);
  const area = listingSeoArea(input);
  const place = area?.name ?? getShortSeoLocation(input.experience?.destination || input.location);
  const crumb = listingBreadcrumb(kind, area);
  const image = listingPhotoUrl(listing, origin);
  const price = listingLeadPrice(kind, listing);
  const organization = { "@type": "Organization", name: siteName, url: origin };
  const aggregateRating = rating && rating.count > 0
    ? { "@type": "AggregateRating", ratingValue: rating.average, reviewCount: rating.count }
    : null;
  const offer = (extra: Record<string, unknown> = {}) => (price > 0 ? {
    "@type": "Offer",
    price,
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    url,
    ...extra,
  } : null);

  const entity: Record<string, unknown> = {
    name,
    description: truncateSeoText(str(listing.description) || name, 320),
    url,
    image,
  };

  if (kind === "stay") {
    const hotel = isHotelStay(listing as { propertyType?: string | null });
    const features = Array.isArray(listing.features) ? listing.features.map(str).filter(Boolean).slice(0, 12) : [];
    Object.assign(entity, {
      "@type": hotel ? "Hotel" : "LodgingBusiness",
      address: { "@type": "PostalAddress", addressLocality: place, addressCountry: "KE" },
      // A hotel's bedrooms are its rooms.
      numberOfRooms: num(listing.bedrooms) || undefined,
      starRating: hotel && num(listing.starRating) ? { "@type": "Rating", ratingValue: num(listing.starRating) } : undefined,
      checkinTime: hotel ? str(listing.checkInTime) || undefined : undefined,
      checkoutTime: hotel ? str(listing.checkOutTime) || undefined : undefined,
      priceRange: price > 0 ? `From ${price} USD ${hotel ? "a room " : ""}a night` : undefined,
      amenityFeature: features.length
        ? features.map((feature) => ({ "@type": "LocationFeatureSpecification", name: feature, value: true }))
        : undefined,
      aggregateRating,
    });
  } else if (kind === "car") {
    Object.assign(entity, {
      "@type": "Car",
      brand: str(listing.make) ? { "@type": "Brand", name: str(listing.make) } : undefined,
      vehicleTransmission: str(listing.transmission) || undefined,
      seatingCapacity: num(listing.seats) || undefined,
      aggregateRating,
      offers: offer({
        areaServed: { "@type": "Place", name: place },
        seller: organization,
        priceSpecification: price > 0 ? { "@type": "UnitPriceSpecification", price, priceCurrency: "USD", unitCode: "DAY" } : undefined,
      }),
    });
  } else if (kind === "experience") {
    Object.assign(entity, {
      "@type": "TouristTrip",
      provider: organization,
      itinerary: { "@type": "Place", name: place, address: { "@type": "PostalAddress", addressLocality: place, addressCountry: "KE" } },
      offers: offer({ priceSpecification: price > 0 ? { "@type": "UnitPriceSpecification", price, priceCurrency: "USD", unitText: "per person" } : undefined }),
    });
  } else {
    Object.assign(entity, {
      "@type": "Service",
      serviceType: kind === "cook" ? "Private chef" : "Holiday home help",
      areaServed: { "@type": "Place", name: place },
      provider: organization,
      aggregateRating,
      offers: offer(),
    });
  }

  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: crumb.label, item: `${origin}${crumb.path}` },
      { "@type": "ListItem", position: 3, name, item: url },
    ],
  };

  return { "@context": "https://schema.org", "@graph": [withoutEmpty(entity), breadcrumb] };
}

// Leaves out properties with nothing to say, so no "0 rooms" or empty values reach Google.
function withoutEmpty(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
}
