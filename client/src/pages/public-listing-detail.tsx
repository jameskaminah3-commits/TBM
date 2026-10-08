import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearch } from "wouter";
import {
  Baby,
  CalendarDays,
  Car,
  CheckCircle2,
  ChefHat,
  Clock3,
  Fuel,
  MapPin,
  MessageCircle,
  Settings2,
  ShoppingBag,
  Star,
  Users,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";
import type { Car as CarType, Cook, Errand, Experience } from "@shared/schema";
import type { PublicListingKind } from "@shared/seo";
import {
  getCookCustomMenuRequestFee,
  getCookExtraGuestInclusivePrice,
  getCookExtraGuestServiceFee,
  getCookInclusivePrice,
  getCookMinimumGuests,
  getCookServiceFee,
} from "@shared/cook-pricing";
import {
  HELP_MAMA_HOURLY_MINIMUM_HOURS,
  HELP_MAMA_TIME_RATE_IDS,
  HOUSE_CLEANING_BASE_ROOM_LABEL,
  getHelpMamaRateOptions,
  hasHelpMamaPricing,
  normalizeHelpMamaPricing,
} from "@shared/errand-pricing";
import { serviceCancellationSummaries, type ServiceCancellationKind } from "@shared/cancellation-policy";
import { bookingDepositPercent } from "@shared/booking-payments";
import { formatCalendarDate, formatKenyaClockTime, todayInKenya } from "@shared/calendar-dates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CurrencyAmount } from "@/components/currency-amount";
import { PremiumMediaGallery } from "@/components/premium-media-gallery";
import { PublicReviewPreview } from "@/components/public-review-preview";
import { SeoHead } from "@/components/seo-head";
import { buildCanonicalUrl } from "@/lib/canonical-url";
import { useCurrency } from "@/lib/currency";
import { openZaina } from "@/lib/zaina";
import { cn } from "@/lib/utils";
import {
  buildListingSeoDescription,
  formatSeoLocation,
  getBookingPath,
  getListingSeoTitle,
  getPublicListingPath,
  getShortSeoLocation,
} from "@/lib/public-listing";

type ListingKind = Exclude<PublicListingKind, "stay">;
type PublicListing = CarType | Cook | Errand | Experience;

const endpointByKind: Record<ListingKind, string> = {
  car: "/api/cars",
  cook: "/api/cooks",
  errand: "/api/errands",
  experience: "/api/experiences",
};

const categoryByKind: Record<ListingKind, { href: string; label: string }> = {
  car: { href: "/services/drive", label: "Car hire and transport in Mombasa" },
  cook: { href: "/services/dine", label: "Private chefs and dining in Mombasa" },
  errand: { href: "/services/relax", label: "Concierge and errands in Mombasa" },
  experience: { href: "/services/experience", label: "Coastal experiences in Mombasa" },
};

const bookLabelByKind: Record<ListingKind, string> = {
  car: "Book this car",
  cook: "Book this chef",
  errand: "Book this service",
  experience: "Book this experience",
};

/** Help Mama's rates, as guests say them. */
const helpMamaRateLabels: Record<string, string> = {
  [HELP_MAMA_TIME_RATE_IDS.hourlyDaytime]: "Daytime, by the hour",
  [HELP_MAMA_TIME_RATE_IDS.hourlyEvening]: "Evening, by the hour",
  [HELP_MAMA_TIME_RATE_IDS.overnight]: "Overnight",
  [HELP_MAMA_TIME_RATE_IDS.fullDay]: "A full day",
};

function getListingName(kind: ListingKind, listing: PublicListing) {
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
    return formatSeoLocation(listing.experienceLocation || listing.location);
  }
  return formatSeoLocation(listing.location);
}

function getListingDescription(kind: ListingKind, listing: PublicListing) {
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

/** One way to book a listing, with its price and the checkout's ?mode= for it. */
type BookingOption = {
  mode: string | null;
  label: string;
  amountUsd: number;
  unit: string;
  note?: string;
  cancellation: ServiceCancellationKind;
};

function getBookingOptions(kind: ListingKind, listing: PublicListing, formatAmount: (amountUsd: number) => string): BookingOption[] {
  const options: Array<BookingOption | null> = [];
  if (kind === "car") {
    const car = listing as CarType;
    options.push(
      car.priceWithDriver > 0
        ? { mode: "car-chauffeur-day", label: "With a driver", amountUsd: car.priceWithDriver, unit: "a day", cancellation: "chauffeur" }
        : null,
      car.pricePerDay
        ? {
            mode: "car-self-drive-day",
            label: "Self-drive",
            amountUsd: car.pricePerDay,
            unit: "a day",
            note: car.selfDriveMileageLimitKm
              ? `${car.selfDriveMileageLimitKm} km a day included${car.selfDriveExtraKmRate ? `, then ${formatAmount(car.selfDriveExtraKmRate)} a km` : ""}.`
              : undefined,
            cancellation: "selfDrive",
          }
        : null,
      car.priceWithDriverHourly
        ? { mode: "car-chauffeur-hourly", label: "By the hour", amountUsd: car.priceWithDriverHourly, unit: "an hour", note: "With a driver.", cancellation: "chauffeur" }
        : null,
    );
  } else if (kind === "cook") {
    const cook = listing as Cook;
    const minimumGuests = getCookMinimumGuests(cook);
    const extraGuest = getCookExtraGuestServiceFee(cook);
    options.push({
      mode: "cook-service-fee",
      label: "Chef's service",
      amountUsd: getCookServiceFee(cook),
      unit: `a day for up to ${minimumGuests} guests`,
      note: `Ingredients not included.${extraGuest > 0 ? ` Each extra guest ${formatAmount(extraGuest)} a day.` : ""}`,
      cancellation: "concierge",
    });
    if (cook.inclusivePrice > 0 && cook.inclusivePrice !== getCookServiceFee(cook)) {
      const extraInclusive = getCookExtraGuestInclusivePrice(cook);
      options.push({
        mode: "cook-inclusive",
        label: "With ingredients and shopping",
        amountUsd: getCookInclusivePrice(cook),
        unit: `a day for up to ${minimumGuests} guests`,
        note: extraInclusive > 0 ? `Each extra guest ${formatAmount(extraInclusive)} a day.` : undefined,
        cancellation: "concierge",
      });
    }
  } else if (kind === "errand") {
    const errand = listing as Errand;
    if (hasHelpMamaPricing(errand)) {
      for (const rate of getHelpMamaRateOptions(errand.helpMamaPricing)) {
        options.push({
          mode: "errand-childcare",
          label: helpMamaRateLabels[rate.id] ?? rate.label,
          amountUsd: rate.price,
          unit: rate.unit === "hour" ? "an hour" : `a ${rate.unit}`,
          note: rate.unit === "hour" ? `At least ${HELP_MAMA_HOURLY_MINIMUM_HOURS} hours.` : undefined,
          cancellation: "concierge",
        });
      }
    }
    if (errand.houseCleaningEnabled) {
      options.push({ mode: "errand-house-cleaning", label: "Cleaning", amountUsd: errand.basePrice, unit: `a visit, ${HOUSE_CLEANING_BASE_ROOM_LABEL.toLowerCase()}`, note: "Bigger homes are priced by the bedroom.", cancellation: "concierge" });
    }
    if (errand.shoppingEnabled) {
      options.push({ mode: "errand-shopping", label: "Shopping and delivery", amountUsd: errand.basePrice, unit: "a trip", note: `Plus the shopping itself, and ${errand.shoppingCommissionPercent}% of the receipt.`, cancellation: "concierge" });
    }
    if (errand.laundryEnabled) {
      options.push({
        mode: "errand-laundry",
        label: "Laundry",
        amountUsd: errand.basePrice,
        unit: "a pickup",
        note: errand.laundryIncludedKg ? `${errand.laundryIncludedKg} kg included${errand.laundryPricePerKg ? `, then ${formatAmount(errand.laundryPricePerKg)} a kg` : ""}.` : undefined,
        cancellation: "concierge",
      });
    }
    if (!options.some(Boolean)) options.push({ mode: null, label: "From", amountUsd: errand.basePrice, unit: "", cancellation: "concierge" });
  } else {
    const experience = listing as Experience;
    if (experience.privateEnabled && experience.privatePricePerPerson > 0) {
      options.push({
        mode: "experience-private",
        label: "Private, just your group",
        amountUsd: experience.privatePricePerPerson,
        unit: "a person",
        note: experience.privateMinimumGuests > 1 ? `For ${experience.privateMinimumGuests} guests or more.` : undefined,
        cancellation: "experience",
      });
    }
    if (experience.sharedEnabled && experience.sharedPricePerPerson > 0) {
      options.push({ mode: "experience-shared", label: "Join a group", amountUsd: experience.sharedPricePerPerson, unit: "a person", note: "On set dates, with other guests.", cancellation: "experience" });
    }
    if (!options.some(Boolean) && experience.price > 0) {
      options.push({ mode: null, label: "From", amountUsd: experience.price, unit: "a person", cancellation: "experience" });
    }
  }
  return options.filter((option): option is BookingOption => Boolean(option) && option!.amountUsd > 0);
}

function getStructuredData(kind: ListingKind, listing: PublicListing, canonicalUrl: string, leadPrice: number) {
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
    address: { "@type": "PostalAddress", addressLocality: location, addressCountry: "KE" },
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
    data.aggregateRating = { "@type": "AggregateRating", ratingValue: listing.rating, reviewCount: listing.reviewCount };
  }
  if (leadPrice > 0) {
    data.offers = { "@type": "Offer", priceCurrency: "USD", price: leadPrice, availability: "https://schema.org/InStock", url: canonicalUrl };
  }
  return data;
}

export default function PublicListingDetail({ kind }: { kind: ListingKind }) {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { formatAmount } = useCurrency();
  const endpoint = endpointByKind[kind];
  const category = categoryByKind[kind];
  // A choice made elsewhere (the cars list's With a driver / Self-drive / By the hour).
  const requestedMode = useMemo(() => new URLSearchParams(search).get("mode"), [search]);
  const [chosenMode, setChosenMode] = useState<string | null>(null);

  const { data: listing, isLoading, isError } = useQuery<PublicListing>({
    queryKey: [endpoint, id],
    enabled: Boolean(id),
    queryFn: async () => {
      const response = await fetch(`${endpoint}/${encodeURIComponent(id || "")}`);
      if (!response.ok) throw new Error("Listing not found");
      return response.json();
    },
  });

  // The same reviews the reviews section shows, so the rating at the top agrees with it.
  const { data: reviews } = useQuery<Array<{ rating: number; comment?: string | null }>>({
    queryKey: ["/api/reviews", kind, id],
    enabled: Boolean(id),
    queryFn: async () => {
      const response = await fetch(`/api/reviews/${kind}/${id}`);
      if (!response.ok) throw new Error("Failed to fetch public reviews");
      return response.json();
    },
  });

  const listingName = listing ? getListingName(kind, listing) : category.label;
  const options = useMemo(() => (listing ? getBookingOptions(kind, listing, formatAmount) : []), [formatAmount, kind, listing]);
  // Options sharing a checkout mode (Help Mama's rates) are one choice at checkout.
  const selectable = useMemo(
    () => options.filter((option, index) => option.mode && options.findIndex((other) => other.mode === option.mode) === index),
    [options],
  );
  const selected = options.find((option) => option.mode && option.mode === (chosenMode ?? requestedMode)) ?? options[0];
  const leadPrice = options.length ? Math.min(...options.map((option) => option.amountUsd)) : 0;
  const canonicalUrl = listing ? buildCanonicalUrl(getPublicListingPath(kind, listing.id, listingName)) : buildCanonicalUrl(`${category.href}/${id || ""}`);
  const description = listing ? getListingDescription(kind, listing) : `Explore ${category.label} with Tembea Bila Matata.`;
  const seoTitle = listing ? getListingSeoTitle(kind, listingName, getListingLocation(listing)) : "Listing not found | Tembea Bila Matata";
  const seoDescription = listing ? buildListingSeoDescription([description]) : description;
  const structuredData = useMemo(
    () => (listing ? getStructuredData(kind, listing, canonicalUrl, leadPrice) : null),
    [canonicalUrl, kind, leadPrice, listing],
  );

  if (isLoading) {
    return <div className="min-h-screen py-20 text-center text-muted-foreground">Loading listing details...</div>;
  }

  if (isError || !listing) {
    return (
      <div className="min-h-screen py-20 text-center">
        <SeoHead title="Listing not found | Tembea Bila Matata" robots="noindex,follow" canonicalUrl={buildCanonicalUrl(category.href)} />
        <h1 className="font-serif text-3xl font-medium">Listing not found</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">This listing is no longer available. Browse the current services instead.</p>
        <Button className="mt-6 rounded-full" onClick={() => setLocation(category.href)}>Browse services</Button>
      </div>
    );
  }

  const location = getListingLocation(listing);
  const pageDescription = listing.description?.trim() || description;
  const car = kind === "car" ? (listing as CarType) : null;
  const cook = kind === "cook" ? (listing as Cook) : null;
  const errand = kind === "errand" ? (listing as Errand) : null;
  const experience = kind === "experience" ? (listing as Experience) : null;
  const reviewCount = reviews ? reviews.length : listing.reviewCount;
  const averageRating = reviews?.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : listing.rating;
  const hasWrittenReviews = Boolean(reviews?.some((review) => review.comment?.trim()));
  const bookingHref = `${getBookingPath(kind, listing.id)}${selected?.mode ? `?mode=${selected.mode}` : ""}`;
  const kindLine = car
    ? "Car hire"
    : cook
      ? cook.serviceType
      : errand
        ? hasHelpMamaPricing(errand) ? "Childcare" : "Help at your stay"
        : experience?.experienceType ?? "Experience";
  const askZaina = () => openZaina(`I have a question about ${listingName}: `);
  const today = todayInKenya();
  const upcomingDepartures = (experience?.sharedEnabled ? experience.sharedDepartures ?? [] : [])
    .filter((departure) => departure.date >= today)
    .sort((left, right) => `${left.date}${left.time}`.localeCompare(`${right.date}${right.time}`))
    .slice(0, 6);
  const experienceAddons = experience
    ? [...(experience.privateEnabled ? experience.privateAddons ?? [] : []), ...(experience.sharedEnabled ? experience.sharedAddons ?? [] : [])]
        .filter((addon, index, all) => addon.price > 0 && all.findIndex((other) => other.name === addon.name) === index)
    : [];
  const helpMama = errand && hasHelpMamaPricing(errand) ? normalizeHelpMamaPricing(errand.helpMamaPricing) : null;

  return (
    <div className="app-shell min-h-screen pb-28 pt-4 sm:pt-6 md:pt-8 lg:pb-12">
      <SeoHead title={seoTitle} description={seoDescription} image={listing.imageUrl} canonicalUrl={canonicalUrl} structuredData={structuredData} />

      <div className="container mx-auto max-w-6xl px-4 sm:px-6 md:px-8">
        <nav aria-label="Breadcrumb" className="mb-4 hidden text-sm text-muted-foreground md:block">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span className="mx-2">/</span>
          <Link href={category.href} className="hover:text-foreground">{category.label}</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{listingName}</span>
        </nav>

        <div className="flex flex-col gap-5 md:gap-6">
          <header className="order-2 md:order-1">
            <p className="text-sm font-medium text-primary">{kindLine} · {getShortSeoLocation(location)}</p>
            <h1 className="mt-1 font-serif text-3xl font-medium leading-tight md:text-4xl" data-testid="text-listing-title">{listingName}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {reviewCount > 0 ? (
                hasWrittenReviews ? (
                  <a href="#reviews" className="inline-flex min-h-11 items-center gap-1 font-medium text-foreground underline underline-offset-4 hover:text-primary" data-testid="link-listing-rating">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                    {averageRating.toFixed(1)} · {reviewCount} review{reviewCount === 1 ? "" : "s"}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground" data-testid="link-listing-rating">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                    {averageRating.toFixed(1)} · {reviewCount} review{reviewCount === 1 ? "" : "s"}
                  </span>
                )
              ) : (
                <span>No reviews yet</span>
              )}
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" aria-hidden="true" />{location}</span>
            </div>
          </header>
          <div className="order-1 md:order-2">
            <PremiumMediaGallery item={listing} title={listingName} layout="mosaic" aspectClassName="aspect-[4/3] md:aspect-auto md:h-[26rem] lg:h-[30rem]" />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
          <div className="min-w-0 space-y-10">
            <section aria-labelledby="about-heading" className="space-y-5">
              <ul className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border/70 pb-5 text-sm text-foreground/85" aria-label="At a glance">
                {car ? (
                  <>
                    <Fact icon={<Users className="h-4 w-4" />} text={`${car.seats} seats`} />
                    <Fact icon={<Settings2 className="h-4 w-4" />} text={`${car.transmission.charAt(0).toUpperCase()}${car.transmission.slice(1)}`} />
                    {car.fuelType ? <Fact icon={<Fuel className="h-4 w-4" />} text={car.fuelType} /> : null}
                    <Fact icon={<MapPin className="h-4 w-4" />} text={`Based in ${getShortSeoLocation(car.location)}`} />
                  </>
                ) : null}
                {cook ? (
                  <>
                    <Fact icon={<UtensilsCrossed className="h-4 w-4" />} text={cook.speciality} />
                    <Fact icon={<Users className="h-4 w-4" />} text={cook.maxGuests > getCookMinimumGuests(cook) ? `${getCookMinimumGuests(cook)} to ${cook.maxGuests} guests` : `Up to ${getCookMinimumGuests(cook)} guests`} />
                    <Fact icon={<MapPin className="h-4 w-4" />} text={`Cooks in ${getShortSeoLocation(cook.location)}`} />
                  </>
                ) : null}
                {errand ? (
                  <>
                    {hasHelpMamaPricing(errand) ? <Fact icon={<Baby className="h-4 w-4" />} text="Daytime, evening and overnight care" /> : null}
                    {errand.shoppingEnabled ? <Fact icon={<ShoppingBag className="h-4 w-4" />} text="Shopping and delivery" /> : null}
                    {errand.houseCleaningEnabled ? <Fact icon={<CheckCircle2 className="h-4 w-4" />} text="Cleaning" /> : null}
                    {errand.laundryEnabled ? <Fact icon={<CheckCircle2 className="h-4 w-4" />} text="Laundry" /> : null}
                    <Fact icon={<MapPin className="h-4 w-4" />} text={errand.location ? `In ${getShortSeoLocation(errand.location)}` : "Along the Coast"} />
                  </>
                ) : null}
                {experience ? (
                  <>
                    <Fact icon={<Clock3 className="h-4 w-4" />} text={experience.durationHours >= 8 ? "A full day" : `${experience.durationHours} hour${experience.durationHours === 1 ? "" : "s"}`} />
                    <Fact icon={<Users className="h-4 w-4" />} text={`${experience.minGuests} to ${experience.maxGuests} guests`} />
                    <Fact icon={<MapPin className="h-4 w-4" />} text={getShortSeoLocation(experience.experienceLocation || experience.location)} />
                  </>
                ) : null}
              </ul>
              <div>
                <h2 id="about-heading" className="mb-3 font-serif text-2xl font-medium">About</h2>
                <p className="whitespace-pre-line leading-relaxed text-muted-foreground">{pageDescription}</p>
              </div>
            </section>

            {/* Every way to book it, with what each includes. */}
            {options.length > 0 ? (
              <section aria-labelledby="prices-heading">
                <h2 id="prices-heading" className="mb-4 font-serif text-2xl font-medium">{car ? "Ways to book this car" : "Prices"}</h2>
                {helpMama ? (
                  <HelpMamaRates pricing={helpMama} formatAmount={formatAmount} />
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2" data-testid="list-listing-prices">
                    {options.map((option) => (
                      <li key={`${option.mode}-${option.label}`} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                        <div className="text-sm font-semibold text-foreground">{option.label}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          <span className="text-base font-semibold text-foreground">{formatAmount(option.amountUsd)}</span> {option.unit}
                        </div>
                        {option.note ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{option.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {car && car.chauffeurZones.length > 0 ? (
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[22rem] text-sm">
                      <caption className="mb-2 text-left font-semibold text-foreground">Prices by area</caption>
                      <thead className="text-left text-muted-foreground">
                        <tr className="border-b border-border/70">
                          <th scope="col" className="py-2 pr-3 font-medium">Area</th>
                          <th scope="col" className="py-2 pr-3 font-medium">With a driver, a day</th>
                          <th scope="col" className="py-2 pr-3 font-medium">An hour</th>
                          <th scope="col" className="py-2 font-medium">Self-drive, a day</th>
                        </tr>
                      </thead>
                      <tbody>
                        {car.chauffeurZones.map((zone) => (
                          <tr key={zone.id} className="border-b border-border/50">
                            <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">{zone.name}</th>
                            <td className="py-2 pr-3">{zone.dailyPrice ? formatAmount(zone.dailyPrice) : "–"}</td>
                            <td className="py-2 pr-3">{zone.hourlyPrice ? formatAmount(zone.hourlyPrice) : "–"}</td>
                            <td className="py-2">{zone.selfDrivePrice ? formatAmount(zone.selfDrivePrice) : "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {cook?.customMenuEnabled ? (
                  <p className="mt-4 rounded-2xl border border-border/70 bg-muted/25 p-4 text-sm leading-6 text-muted-foreground">
                    <span className="font-semibold text-foreground">Want a menu of your own?</span> Ask {cook.title.split(/\s[–-]\s/)[0]} for a custom menu. The request costs <CurrencyAmount amountUsd={getCookCustomMenuRequestFee(cook)} quotedKes={cook.customMenuRequestFeeKes} />, taken off the price if you accept the quote.
                  </p>
                ) : null}
              </section>
            ) : null}

            {cook && cook.sampleMenus.length > 0 ? (
              <section aria-labelledby="menus-heading">
                <h2 id="menus-heading" className="mb-4 font-serif text-2xl font-medium">Sample menus</h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {cook.sampleMenus.map((menu) => (
                    <li key={menu} className="flex items-start gap-2 text-sm leading-6">
                      <ChefHat className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      {menu}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-muted-foreground">Tell us about allergies and dietary needs when you book.</p>
              </section>
            ) : null}

            {experience && (experience.meetingPoint || experience.inclusions.length > 0 || experience.exclusions.length > 0 || upcomingDepartures.length > 0 || experienceAddons.length > 0) ? (
              <section aria-labelledby="experience-plan-heading" className="space-y-5">
                <h2 id="experience-plan-heading" className="font-serif text-2xl font-medium">The plan</h2>
                {experience.meetingPoint ? (
                  <p className="flex items-start gap-2 text-sm leading-6">
                    <MapPin className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span><span className="font-medium">Meeting point:</span> {experience.meetingPoint}</span>
                  </p>
                ) : null}
                {experience.inclusions.length > 0 || experience.exclusions.length > 0 ? (
                  <div className="grid gap-6 sm:grid-cols-2">
                    {experience.inclusions.length > 0 ? (
                      <div>
                        <h3 className="text-sm font-semibold">Included</h3>
                        <ul className="mt-2 grid gap-2">
                          {experience.inclusions.map((item) => <li key={item} className="flex items-start gap-2 text-sm leading-6"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{item}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {experience.exclusions.length > 0 ? (
                      <div>
                        <h3 className="text-sm font-semibold">Not included</h3>
                        <ul className="mt-2 grid gap-2">
                          {experience.exclusions.map((item) => <li key={item} className="flex items-start gap-2 text-sm leading-6"><XCircle className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{item}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {upcomingDepartures.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-semibold">Group dates coming up</h3>
                    <ul className="mt-2 flex flex-wrap gap-2" data-testid="list-experience-departures">
                      {upcomingDepartures.map((departure) => (
                        <li key={departure.id} className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-sm">
                          <CalendarDays className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                          {formatCalendarDate(departure.date, { weekday: "short", day: "numeric", month: "short" }, "en-GB")} · {formatKenyaClockTime(departure.time)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {experienceAddons.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-semibold">Add to it</h3>
                    <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                      {experienceAddons.map((addon) => (
                        <li key={addon.id} className="flex items-baseline justify-between gap-3 rounded-xl border border-border/60 px-3 py-2 text-sm">
                          <span>{addon.name}</span>
                          <span className="font-medium">{formatAmount(addon.price)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}

            <PublicReviewPreview targetType={kind} targetId={listing.id} variant="open" maxItems={4} />

            {listing.features.length > 0 ? (
              <section aria-labelledby="features-heading">
                <h2 id="features-heading" className="mb-4 font-serif text-2xl font-medium">What to expect</h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {listing.features.map((feature) => <li key={feature} className="flex items-start gap-2 text-sm leading-6"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{feature}</li>)}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="good-to-know-heading">
              <h2 id="good-to-know-heading" className="mb-4 font-serif text-2xl font-medium">Good to know</h2>
              <dl className="grid gap-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-foreground">Paying</dt>
                  <dd className="mt-1 leading-6 text-muted-foreground">Pay {bookingDepositPercent}% to book, by M-Pesa or card. The rest is paid later.</dd>
                </div>
                {selected ? (
                  <div>
                    <dt className="font-semibold text-foreground">Cancelling</dt>
                    <dd className="mt-1 leading-6 text-muted-foreground" data-testid="text-listing-cancellation">
                      {serviceCancellationSummaries[selected.cancellation]}{" "}
                      <Link href="/refund-cancellation" className="font-medium text-primary underline-offset-4 hover:underline">Full policy</Link>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-semibold text-foreground">Help</dt>
                  <dd className="mt-1 leading-6 text-muted-foreground">Zaina answers any time. Our team is here Monday to Saturday, 8am to 8pm.</dd>
                </div>
              </dl>
            </section>
          </div>

          <aside className="lg:sticky lg:top-24 lg:h-fit" aria-label="Book">
            <Card id="book" className="scroll-mt-24 rounded-2xl border-border/70 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
              {selectable.length > 1 ? (
                <div role="radiogroup" aria-label="How you want it" className="mb-4 grid gap-2">
                  {selectable.map((option) => {
                    const active = selected?.mode === option.mode;
                    return (
                      <button
                        key={option.mode}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setChosenMode(option.mode)}
                        className={cn(
                          "flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "border-primary bg-primary/5 font-semibold text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/40",
                        )}
                        data-testid={`button-listing-option-${option.mode}`}
                      >
                        <span>{option.label}</span>
                        <span className="shrink-0 tabular-nums">{formatAmount(option.amountUsd)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {selected ? (
                <div data-testid="text-listing-price">
                  <p className="flex flex-wrap items-baseline gap-x-1.5">
                    {helpMama || selected.label === "From" ? <span className="text-sm text-muted-foreground">From</span> : null}
                    <CurrencyAmount amountUsd={helpMama ? leadPrice : selected.amountUsd} primaryClassName="text-2xl font-semibold text-foreground" />
                    <span className="text-sm text-muted-foreground">{helpMama ? "an hour" : selected.unit}</span>
                  </p>
                  {!helpMama && selected.note ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{selected.note}</p> : null}
                </div>
              ) : null}
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Pick your date{kind === "car" || kind === "cook" ? "s" : ""} and see the total before you pay.</p>
              <Button className="mt-4 h-12 w-full rounded-full text-base" onClick={() => setLocation(bookingHref)} data-testid="button-book-listing">
                {bookLabelByKind[kind]}
              </Button>
              <Button variant="outline" className="mt-3 h-11 w-full rounded-full" onClick={askZaina} data-testid="button-ask-zaina-listing">
                <MessageCircle className="mr-2 h-4 w-4" />
                Ask Zaina about this
              </Button>
              <Link href={category.href} className="mt-2 flex min-h-11 items-center justify-center text-sm font-medium text-primary hover:underline">Browse more</Link>
            </Card>
          </aside>
        </div>
      </div>

      {/* Phones and tablets: the price and Book stay in reach, above the tab bar. */}
      <div
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t border-border/70 bg-background/95 px-4 py-3 shadow-[0_-18px_40px_rgba(15,23,42,0.16)] backdrop-blur lg:hidden"
        data-testid="listing-bar"
      >
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            {selected ? (
              <>
                <div className="text-base font-semibold text-foreground">
                  {helpMama ? "From " : ""}<CurrencyAmount amountUsd={helpMama ? leadPrice : selected.amountUsd} />{" "}
                  <span className="text-sm font-normal text-muted-foreground">{helpMama ? "an hour" : selected.unit}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{helpMama ? "Daytime, evening or overnight" : selected.label}</div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Ask for a price</div>
            )}
          </div>
          <Button className="min-h-12 shrink-0 rounded-full px-6" onClick={() => setLocation(bookingHref)} data-testid="button-listing-bar">
            Book
          </Button>
        </div>
      </div>
    </div>
  );
}

function Fact({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <li className="inline-flex items-center gap-2">
      <span className="text-primary" aria-hidden="true">{icon}</span>
      {text}
    </li>
  );
}

/** Help Mama's rates: one column, or one per age when the ages are priced differently. */
function HelpMamaRates({ pricing, formatAmount }: { pricing: ReturnType<typeof normalizeHelpMamaPricing>; formatAmount: (amountUsd: number) => string }) {
  const rates = getHelpMamaRateOptions(pricing);
  const bands = pricing.ageBands.map((band) => ({
    band,
    prices: rates.map((rate) => getHelpMamaRateOptions(pricing, band.id).find((option) => option.id === rate.id)?.price ?? 0),
  }));
  const samePriceForAllAges = bands.every((entry) => entry.prices.every((price, index) => price === bands[0].prices[index]));

  return (
    <div className="space-y-3" data-testid="table-help-mama-rates">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b border-border/70">
              <th scope="col" className="py-2 pr-3 font-medium">Care</th>
              {samePriceForAllAges
                ? <th scope="col" className="py-2 font-medium">Price</th>
                : bands.map((entry) => <th key={entry.band.id} scope="col" className="py-2 pr-3 font-medium">{entry.band.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rates.map((rate, index) => (
              <tr key={rate.id} className="border-b border-border/50">
                <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">{helpMamaRateLabels[rate.id] ?? rate.label}</th>
                {samePriceForAllAges ? (
                  <td className="py-2">{formatAmount(rate.price)} {rate.unit === "hour" ? "an hour" : `a ${rate.unit}`}</td>
                ) : (
                  bands.map((entry) => (
                    <td key={entry.band.id} className="py-2 pr-3">{entry.prices[index] ? formatAmount(entry.prices[index]) : "–"}</td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        Hourly care is booked for at least {HELP_MAMA_HOURLY_MINIMUM_HOURS} hours.{" "}
        {pricing.ageBands.length ? `For ${joinWithAnd(pricing.ageBands.map((band) => band.label.toLowerCase()))}${samePriceForAllAges ? ", all at the same price" : ""}.` : ""}
      </p>
    </div>
  );
}

/** "a, b and c" */
function joinWithAnd(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
