import { useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { ArrowRight, Car, CheckCircle2, ChefHat, Clock3, MapPin, ShoppingBag, Star, Users } from "lucide-react";
import type { Car as CarType, Cook, Errand, Experience } from "@shared/schema";
import type { PublicListingKind } from "@shared/seo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CurrencyAmount } from "@/components/currency-amount";
import { PremiumMediaGallery } from "@/components/premium-media-gallery";
import { SeoHead } from "@/components/seo-head";
import { buildCanonicalUrl } from "@/lib/canonical-url";
import { getBookingPath, getPublicListingPath } from "@/lib/public-listing";

type PublicListing = CarType | Cook | Errand | Experience;

const endpointByKind: Record<Exclude<PublicListingKind, "stay">, string> = {
  car: "/api/cars",
  cook: "/api/cooks",
  errand: "/api/errands",
  experience: "/api/experiences",
};

const categoryByKind: Record<Exclude<PublicListingKind, "stay">, { href: string; label: string }> = {
  car: { href: "/services/drive", label: "Car hire and transport in Mombasa" },
  cook: { href: "/services/dine", label: "Private chefs and dining in Mombasa" },
  errand: { href: "/services/relax", label: "Concierge and errands in Mombasa" },
  experience: { href: "/services/experience", label: "Coastal experiences in Mombasa" },
};

function getListingName(kind: Exclude<PublicListingKind, "stay">, listing: PublicListing) {
  if (kind === "car") {
    const car = listing as CarType;
    return `${car.make ? `${car.make} ` : ""}${car.model}`.trim();
  }
  if (kind === "cook") return (listing as Cook).title;
  if (kind === "errand") return (listing as Errand).serviceName;
  return (listing as Experience).title;
}

function getListingLocation(listing: PublicListing) {
  if ("experienceLocation" in listing) {
    return listing.experienceLocation || listing.location || "Mombasa, Kenya";
  }
  return listing.location || "Mombasa, Kenya";
}

function getListingDescription(kind: Exclude<PublicListingKind, "stay">, listing: PublicListing) {
  const location = getListingLocation(listing);
  if (kind === "car") {
    const car = listing as CarType;
    return `${getListingName(kind, listing)} available in ${location} for ${car.transmission} self-drive or chauffeur service, with ${car.seats} seats. ${car.description}`;
  }
  if (kind === "cook") {
    const cook = listing as Cook;
    return `${cook.serviceType} in ${location}, specialising in ${cook.speciality} for up to ${cook.maxGuests} guests. ${cook.description}`;
  }
  if (kind === "errand") {
    const errand = listing as Errand;
    const services = [
      errand.shoppingEnabled ? "shopping" : null,
      errand.laundryEnabled ? "laundry" : null,
      errand.houseCleaningEnabled ? "house cleaning" : null,
    ].filter(Boolean).join(", ");
    return `${getListingName(kind, listing)} in ${location}${services ? `, including ${services}` : ""}. ${errand.description}`;
  }
  const experience = listing as Experience;
  return `${experience.experienceType} in ${location} lasting ${experience.durationHours} hours for groups of ${experience.minGuests} to ${experience.maxGuests}. ${experience.description}`;
}

function getLeadPrice(kind: Exclude<PublicListingKind, "stay">, listing: PublicListing) {
  if (kind === "car") {
    const car = listing as CarType;
    return car.pricePerDay || car.priceWithDriverHourly || car.priceWithDriver;
  }
  if (kind === "cook") {
    const cook = listing as Cook;
    return cook.serviceFee || cook.pricePerSession;
  }
  if (kind === "errand") return (listing as Errand).basePrice;
  const experience = listing as Experience;
  return experience.privatePricePerPerson || experience.sharedPricePerPerson || experience.price;
}

function getPriceLabel(kind: Exclude<PublicListingKind, "stay">) {
  if (kind === "car") return "starting rate per day or chauffeur hour";
  if (kind === "cook") return "chef service package";
  if (kind === "errand") return "service package starting rate";
  return "experience rate per person";
}

function getStructuredData(kind: Exclude<PublicListingKind, "stay">, listing: PublicListing, canonicalUrl: string) {
  const name = getListingName(kind, listing);
  const location = getListingLocation(listing);
  const description = getListingDescription(kind, listing);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": kind === "car" ? "Car" : kind === "experience" ? "TouristAttraction" : "Service",
    name,
    description,
    url: canonicalUrl,
    areaServed: { "@type": "Place", name: location },
    provider: { "@type": "Organization", name: "Tembea Bila Matata", url: buildCanonicalUrl("/") },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: buildCanonicalUrl("/") },
        { "@type": "ListItem", position: 2, name: categoryByKind[kind].label, item: buildCanonicalUrl(categoryByKind[kind].href) },
        { "@type": "ListItem", position: 3, name, item: canonicalUrl },
      ],
    },
  };

  if (listing.imageUrl) data.image = listing.imageUrl;
  if (listing.rating > 0 && listing.reviewCount > 0) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: listing.rating,
      reviewCount: listing.reviewCount,
    };
  }

  const price = getLeadPrice(kind, listing);
  if (price > 0) {
    data.offers = {
      "@type": "Offer",
      priceCurrency: "USD",
      price,
      availability: "https://schema.org/InStock",
      url: canonicalUrl,
    };
  }

  return data;
}

export default function PublicListingDetail({ kind }: { kind: Exclude<PublicListingKind, "stay"> }) {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const endpoint = endpointByKind[kind];
  const category = categoryByKind[kind];
  const { data: listing, isLoading, isError } = useQuery<PublicListing>({
    queryKey: [endpoint, id],
    enabled: Boolean(id),
    queryFn: async () => {
      const response = await fetch(`${endpoint}/${encodeURIComponent(id || "")}`);
      if (!response.ok) throw new Error("Listing not found");
      return response.json();
    },
  });

  const listingName = listing ? getListingName(kind, listing) : category.label;
  const canonicalUrl = listing ? buildCanonicalUrl(getPublicListingPath(kind, listing.id, listingName)) : buildCanonicalUrl(`${category.href}/${id || ""}`);
  const description = listing ? getListingDescription(kind, listing) : `Explore ${category.label} with Tembea Bila Matata.`;
  const structuredData = useMemo(
    () => (listing ? getStructuredData(kind, listing, canonicalUrl) : null),
    [canonicalUrl, kind, listing],
  );

  if (isLoading) {
    return <div className="min-h-screen py-20 text-center text-muted-foreground">Loading listing details...</div>;
  }

  if (isError || !listing) {
    return (
      <div className="min-h-screen py-20 text-center">
        <SeoHead title="Listing not found | Tembea Bila Matata" robots="noindex,follow" canonicalUrl={buildCanonicalUrl(category.href)} />
        <h1 className="font-serif text-3xl font-medium">Listing not found</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">This public listing is no longer available. Browse the current services instead.</p>
        <Button className="mt-6 rounded-full" onClick={() => setLocation(category.href)}>Browse services</Button>
      </div>
    );
  }

  const location = getListingLocation(listing);
  const price = getLeadPrice(kind, listing);
  const bookingPath = getBookingPath(kind, listing.id);

  return (
    <div className="app-shell min-h-screen py-10">
      <SeoHead
        title={`${listingName} in ${location} | Tembea Bila Matata`}
        description={description}
        image={listing.imageUrl}
        canonicalUrl={canonicalUrl}
        structuredData={structuredData}
      />

      <div className="container mx-auto max-w-6xl px-4 md:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
          <Link href="/"><a className="hover:text-foreground">Home</a></Link>
          <span className="mx-2">/</span>
          <Link href={category.href}><a className="hover:text-foreground">{category.label}</a></Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{listingName}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <main>
            <PremiumMediaGallery item={listing} title={listingName} aspectClassName="aspect-[16/9]" thumbnailPlacement="below" />
            <header className="mt-8">
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{location}</span>
                <span className="inline-flex items-center gap-1"><Star className="h-4 w-4 fill-amber-400 text-amber-400" />{listing.rating.toFixed(1)}/5 from {listing.reviewCount} reviews</span>
              </div>
              <h1 className="mt-3 font-serif text-3xl font-medium leading-tight sm:text-5xl">{listingName} in {location}</h1>
              <p className="mt-4 max-w-3xl text-base leading-8 text-muted-foreground">{description}</p>
            </header>

            <section className="mt-8" aria-labelledby="listing-details-heading">
              <h2 id="listing-details-heading" className="font-serif text-2xl font-medium">Details</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {kind === "car" ? (
                  <>
                    <Detail icon={<Car className="h-4 w-4" />} text={`${(listing as CarType).seats} seats, ${(listing as CarType).transmission} transmission`} />
                    <Detail icon={<MapPin className="h-4 w-4" />} text={`Available in ${location}`} />
                  </>
                ) : null}
                {kind === "cook" ? (
                  <>
                    <Detail icon={<ChefHat className="h-4 w-4" />} text={`${(listing as Cook).serviceType} specialising in ${(listing as Cook).speciality}`} />
                    <Detail icon={<Users className="h-4 w-4" />} text={`Serves up to ${(listing as Cook).maxGuests} guests`} />
                  </>
                ) : null}
                {kind === "errand" ? (
                  <>
                    <Detail icon={<ShoppingBag className="h-4 w-4" />} text="Holiday concierge and practical support" />
                    <Detail icon={<MapPin className="h-4 w-4" />} text={`Service area: ${location}`} />
                  </>
                ) : null}
                {kind === "experience" ? (
                  <>
                    <Detail icon={<Clock3 className="h-4 w-4" />} text={`${(listing as Experience).durationHours} hours`} />
                    <Detail icon={<Users className="h-4 w-4" />} text={`For ${(listing as Experience).minGuests} to ${(listing as Experience).maxGuests} guests`} />
                  </>
                ) : null}
              </div>
            </section>

            <section className="mt-8" aria-labelledby="features-heading">
              <h2 id="features-heading" className="font-serif text-2xl font-medium">What to expect</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {listing.features.map((feature) => <li key={feature} className="flex items-start gap-2 text-sm leading-6"><CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-primary" />{feature}</li>)}
              </ul>
            </section>
          </main>

          <aside>
            <Card className="sticky top-24 border-border/60 p-6 shadow-sm">
              <p className="text-sm text-muted-foreground">{getPriceLabel(kind)}</p>
              <div className="mt-1"><CurrencyAmount amountUsd={price} primaryClassName="text-2xl font-semibold" /></div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Confirm dates, guest details and final availability in the secure booking flow.</p>
              <Button className="mt-5 w-full rounded-full" onClick={() => setLocation(bookingPath)}>Book this service</Button>
              <Link href={category.href}><a className="mt-4 flex items-center justify-center gap-2 text-sm text-primary hover:underline">Browse more services <ArrowRight className="h-4 w-4" /></a></Link>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Detail({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/70 p-4 text-sm leading-6"><span className="mt-0.5 text-primary">{icon}</span><span>{text}</span></div>;
}
