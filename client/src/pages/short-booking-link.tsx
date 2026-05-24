import * as React from "react";
import { useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BedDouble, CarFront, ChefHat, ChevronLeft, ChevronRight, Compass, MapPin, ShoppingBag, Star, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Carousel,
  CarouselApi,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { CurrencyAmount } from "@/components/currency-amount";
import { ListingMedia } from "@/components/listing-media";
import { cn } from "@/lib/utils";
import {
  getCanonicalBookingPath,
  serviceByShortType,
  type ShareServiceType,
} from "@/lib/share-links";
import { getCookServiceFee } from "@shared/cook-pricing";
import { HOUSE_CLEANING_BASE_ROOM_LABEL, getHelpMamaStartingPrice, hasHelpMamaPricing } from "@shared/errand-pricing";
import type { Car, Cook, Errand, Experience, Stay } from "@shared/schema";

type PublicListing = Stay | Car | Cook | Errand | Experience;

const endpointByService: Record<ShareServiceType, string> = {
  stay: "/api/stays",
  car: "/api/cars",
  cook: "/api/cooks",
  errand: "/api/errands",
  experience: "/api/experiences",
};

const serviceLabelByType: Record<ShareServiceType, string> = {
  stay: "Stay",
  car: "Drive",
  cook: "Dine",
  errand: "Relax",
  experience: "Experience",
};

const serviceIconByType = {
  stay: BedDouble,
  car: CarFront,
  cook: ChefHat,
  errand: ShoppingBag,
  experience: Compass,
} satisfies Record<ShareServiceType, React.ComponentType<{ className?: string }>>;

function getListingGalleryImages(listing: PublicListing) {
  return [listing.imageUrl, ...(listing.galleryUrls ?? [])].filter(
    (imageUrl, index, allImages): imageUrl is string => !!imageUrl && allImages.indexOf(imageUrl) === index,
  );
}

function getListingTitle(serviceType: ShareServiceType, listing: PublicListing) {
  if (serviceType === "car") return (listing as Car).model;
  if (serviceType === "errand") return (listing as Errand).serviceName;
  return (listing as Stay | Cook | Experience).title;
}

function getListingLocation(serviceType: ShareServiceType, listing: PublicListing) {
  if (serviceType === "experience") {
    const experience = listing as Experience;
    return experience.experienceLocation || experience.location;
  }

  return listing.location;
}

function getListingFeatures(serviceType: ShareServiceType, listing: PublicListing) {
  if (serviceType === "experience") {
    const experience = listing as Experience;
    return [...(experience.inclusions ?? []), ...(experience.features ?? [])].slice(0, 6);
  }

  return (listing.features ?? []).slice(0, 6);
}

function getPriceInfo(serviceType: ShareServiceType, listing: PublicListing) {
  if (serviceType === "stay") {
    return { amount: (listing as Stay).price, label: "per night" };
  }

  if (serviceType === "car") {
    const car = listing as Car;
    const options = [
      car.priceWithDriverHourly ? { amount: car.priceWithDriverHourly, label: "per chauffeur hour" } : null,
      car.pricePerDay ? { amount: car.pricePerDay, label: "per self-drive day" } : null,
      { amount: car.priceWithDriver, label: "per chauffeur day" },
    ].filter((option): option is { amount: number; label: string } => option !== null);

    return options.reduce((lowest, current) => (current.amount < lowest.amount ? current : lowest));
  }

  if (serviceType === "cook") {
    return { amount: getCookServiceFee(listing as Cook), label: "chef service fee" };
  }

  if (serviceType === "errand") {
    const errand = listing as Errand;
    if (hasHelpMamaPricing(errand)) {
      return { amount: getHelpMamaStartingPrice(errand.helpMamaPricing), label: "starting Mama Care rate" };
    }

    return {
      amount: errand.basePrice,
      label: errand.houseCleaningEnabled && !errand.shoppingEnabled && !errand.laundryEnabled
        ? `${HOUSE_CLEANING_BASE_ROOM_LABEL} cleaning`
        : errand.laundryEnabled && !errand.shoppingEnabled
        ? "laundry package"
        : errand.shoppingEnabled
          ? "service fee per shopping trip"
          : "service package",
    };
  }

  const experience = listing as Experience;
  const prices = [
    experience.privateEnabled && experience.privatePricePerPerson > 0 ? experience.privatePricePerPerson : null,
    experience.sharedEnabled && experience.sharedPricePerPerson > 0 ? experience.sharedPricePerPerson : null,
  ].filter((price): price is number => price !== null);

  return { amount: prices.length ? Math.min(...prices) : experience.price, label: "per person" };
}

function getDetailChips(serviceType: ShareServiceType, listing: PublicListing) {
  if (serviceType === "stay") {
    const stay = listing as Stay;
    return [
      `${stay.bedrooms} bedroom${stay.bedrooms === 1 ? "" : "s"}`,
      `${stay.bathrooms} bathroom${stay.bathrooms === 1 ? "" : "s"}`,
      `Up to ${stay.maxOccupancy} guests`,
    ];
  }

  if (serviceType === "car") {
    const car = listing as Car;
    return [`${car.seats} seats`, car.transmission];
  }

  if (serviceType === "cook") {
    const cook = listing as Cook;
    return [cook.serviceType, cook.speciality, `Up to ${cook.maxGuests} guests`];
  }

  if (serviceType === "errand") {
    const errand = listing as Errand;
    return [
      errand.shoppingEnabled ? "Shopping" : null,
      errand.laundryEnabled ? "Laundry" : null,
      errand.houseCleaningEnabled ? "House cleaning" : null,
      hasHelpMamaPricing(errand) ? "Mama Care" : null,
    ];
  }

  const experience = listing as Experience;
  return [
    experience.experienceType,
    `${experience.durationHours} hour${experience.durationHours === 1 ? "" : "s"}`,
    experience.privateEnabled ? "Private" : null,
    experience.sharedEnabled ? "Shared departures" : null,
  ];
}

function ListingGallery({
  listing,
  title,
}: {
  listing: PublicListing;
  title: string;
}) {
  const galleryImages = getListingGalleryImages(listing);
  const [carouselApi, setCarouselApi] = React.useState<CarouselApi>();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const thumbnailRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  React.useEffect(() => {
    if (!carouselApi) {
      return;
    }

    carouselApi.scrollTo(0, true);
    setActiveIndex(0);

    const syncSelection = () => {
      setActiveIndex(carouselApi.selectedScrollSnap());
    };

    syncSelection();
    carouselApi.on("select", syncSelection);
    carouselApi.on("reInit", syncSelection);

    return () => {
      carouselApi.off("select", syncSelection);
      carouselApi.off("reInit", syncSelection);
    };
  }, [carouselApi, galleryImages.length]);

  React.useEffect(() => {
    thumbnailRefs.current[activeIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeIndex]);

  if (galleryImages.length === 0) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center bg-muted text-sm text-muted-foreground">
        Photos coming soon
      </div>
    );
  }

  return (
    <div className="bg-background">
      <div className="relative overflow-hidden bg-muted">
        <Carousel className="overflow-hidden" opts={{ loop: galleryImages.length > 1 }} setApi={setCarouselApi}>
          <CarouselContent className="ml-0">
            {galleryImages.map((imageUrl, index) => (
              <CarouselItem key={`${listing.id}-share-image-${index}`} className="pl-0">
                <div className="aspect-[16/10] overflow-hidden bg-muted">
                  <ListingMedia
                    src={imageUrl}
                    alt={`${title} photo ${index + 1}`}
                    mediaType={listing.mediaType}
                    className="h-full w-full object-cover"
                    loading={index === 0 ? "eager" : "lazy"}
                  />
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>

        {galleryImages.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous listing photo"
              className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur-md transition hover:bg-black/50"
              onClick={(event) => {
                event.stopPropagation();
                carouselApi?.scrollPrev();
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next listing photo"
              className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur-md transition hover:bg-black/50"
              onClick={(event) => {
                event.stopPropagation();
                carouselApi?.scrollNext();
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        ) : null}
      </div>

      {galleryImages.length > 1 ? (
        <div className="space-y-3 border-t border-border/60 bg-background p-4">
          <p className="text-sm font-medium text-foreground">Browse photos</p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {galleryImages.map((imageUrl, index) => (
              <button
                key={`${listing.id}-share-thumb-${index}`}
                ref={(node) => {
                  thumbnailRefs.current[index] = node;
                }}
                type="button"
                aria-label={`View photo ${index + 1}`}
                aria-current={activeIndex === index ? "true" : undefined}
                className={cn(
                  "h-20 w-28 flex-shrink-0 overflow-hidden rounded-lg border bg-muted shadow-sm transition",
                  activeIndex === index
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border/60 opacity-80 hover:opacity-100",
                )}
                onClick={() => carouselApi?.scrollTo(index)}
              >
                <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ShortBookingLink() {
  const { shortType = "", code = "" } = useParams<{ shortType: string; code: string }>();
  const [, setLocation] = useLocation();
  const serviceType = serviceByShortType[shortType.toLowerCase()];
  const normalizedCode = code.trim().toLowerCase();
  const currencyQuery = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }

    const currency = new URLSearchParams(window.location.search).get("currency");
    return currency === "USD" || currency === "KES" ? `?currency=${currency}` : "";
  }, []);

  const { data: listings = [], isLoading, isError } = useQuery<PublicListing[]>({
    queryKey: ["short-share-link", serviceType],
    enabled: Boolean(serviceType && normalizedCode),
    queryFn: async () => {
      const response = await fetch(endpointByService[serviceType], { credentials: "include" });
      if (!response.ok) {
        throw new Error("Could not resolve this share link");
      }
      return response.json();
    },
  });

  const matchingListing = useMemo(
    () => listings.find((listing) => listing.id.toLowerCase().startsWith(normalizedCode)),
    [listings, normalizedCode],
  );

  if (!serviceType || !normalizedCode || isError || (!isLoading && !matchingListing)) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-6 py-16">
        <Card className="w-full space-y-4 border-stone-200 p-6 text-center">
          <h1 className="font-serif text-2xl text-foreground">Share link not found</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            This listing may be private, still under review, or the link may have been copied incorrectly.
          </p>
          <Button type="button" onClick={() => setLocation("/")}>
            Go Home
          </Button>
        </Card>
      </main>
    );
  }

  if (isLoading || !matchingListing) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-6 py-16">
        <Card className="w-full space-y-3 border-stone-200 p-6 text-center">
          <h1 className="font-serif text-2xl text-foreground">Opening listing</h1>
          <p className="text-sm text-muted-foreground">One moment while we prepare the photos and details.</p>
        </Card>
      </main>
    );
  }

  const title = getListingTitle(serviceType, matchingListing);
  const Icon = serviceIconByType[serviceType];
  const priceInfo = getPriceInfo(serviceType, matchingListing);
  const location = getListingLocation(serviceType, matchingListing);
  const features = getListingFeatures(serviceType, matchingListing);
  const detailChips = getDetailChips(serviceType, matchingListing).filter((chip): chip is string => Boolean(chip?.trim()));
  const bookingPath = `${getCanonicalBookingPath(serviceType, matchingListing.id)}${currencyQuery}`;

  return (
    <main className="min-h-screen bg-background py-10">
      <div className="container mx-auto max-w-6xl px-4 md:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="ghost" className="rounded-full px-4" onClick={() => setLocation("/")}>
            Tembea Bila Matata
          </Button>
          <Badge variant="secondary" className="rounded-full px-3 py-1">
            Shared {serviceLabelByType[serviceType]} listing
          </Badge>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] lg:items-start">
          <section className="overflow-hidden rounded-2xl border border-border/70 bg-background shadow-[0_18px_46px_-34px_rgba(15,23,42,0.5)]">
            <ListingGallery listing={matchingListing} title={title} />
          </section>

          <section className="space-y-5">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h1 className="break-words font-serif text-3xl font-medium leading-tight text-foreground md:text-4xl">
                    {title}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    {location ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-4 w-4" />
                        {location}
                      </span>
                    ) : null}
                    {"rating" in matchingListing ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                        {Number(matchingListing.rating || 5).toFixed(1)}
                      </span>
                    ) : null}
                    {"maxOccupancy" in matchingListing ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-4 w-4" />
                        Up to {matchingListing.maxOccupancy}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-muted/25 p-4">
                <div className="text-sm font-medium text-muted-foreground">From</div>
                <CurrencyAmount
                  amountUsd={priceInfo.amount}
                  primaryClassName="text-2xl font-semibold tracking-tight text-foreground"
                  showSecondary
                  secondaryClassName="text-sm text-muted-foreground"
                />
                <div className="mt-1 text-sm text-muted-foreground">{priceInfo.label}</div>
              </div>

              {detailChips.length ? (
                <div className="flex flex-wrap gap-2">
                  {detailChips.map((chip) => (
                    <Badge key={chip} variant="outline" className="rounded-full">
                      {chip}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <p className="max-h-56 overflow-y-auto rounded-xl border border-border/70 bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
              {matchingListing.description}
            </p>

            {features.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {features.map((feature) => (
                  <div key={feature} className="rounded-lg bg-muted/35 px-3 py-2 text-sm text-foreground/80">
                    {feature}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" className="rounded-full px-6" onClick={() => setLocation(bookingPath)}>
                Book this listing
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" className="rounded-full px-6" onClick={() => setLocation("/")}>
                Explore more
              </Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
