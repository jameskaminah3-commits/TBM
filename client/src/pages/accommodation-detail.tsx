import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, useSearch, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Star, Sparkles, MapPin, Users, Bed, Bath, Car, ChefHat, ShoppingBag, CheckCircle2, CalendarDays, Clock, Compass, DoorOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { StayMediaCarousel } from "@/components/stay-media-carousel";
import { CurrencyAmount } from "@/components/currency-amount";
import { PublicReviewPreview } from "@/components/public-review-preview";
import { YourHost } from "@/components/your-host";
import { ShareGiftBanner } from "@/components/share-gift-banner";
import {
  formatStaySearchDate,
  getStaySearchNights,
  hasStructuredStayFilters,
  readStaySearchState,
  toSearchSuffix,
} from "@/lib/stay-search";
import type { StayWithRooms } from "@shared/schema";
import { SeoHead } from "@/components/seo-head";
import { MealPlanChips, StayKindBadge, describeStayKind } from "@/components/stay-kind";
import { HotelRoomsSection } from "@/components/hotel-rooms-section";
import { isHotelStay, summarizeHotelRooms } from "@shared/hotel-rooms";
import { buildCanonicalUrl } from "@/lib/canonical-url";
import {
  buildListingSeoDescription,
  formatSeoLocation,
  getListingSeoTitle,
  getPublicListingPath,
} from "@/lib/public-listing";
import { eachDayOfInterval, format, parseISO, startOfDay } from "date-fns";
import { formatKenyaClockTime, parseCalendarDate, todayInKenya } from "@shared/calendar-dates";
import { ListingShareSheet } from "@/components/listing-share-sheet";
import { useOwnsListing } from "@/hooks/use-owns-listing";
import { captureListingVisit, trackShareEvent, withShareRef } from "@/lib/marketing-attribution";
import { getListingSharePrice } from "@shared/listing-share";
import { ListingUnavailable } from "@/components/listing-unavailable";
import { formatRating, hasPublicRating } from "@shared/review-eligibility";
import { CONTACT_PHONE_DISPLAY } from "@/lib/contact-info";
import { listingBreadcrumb, listingSeoArea, toSeoListingInput, type PublicListingSeo } from "@shared/listing-seo";

// "today", or "Wed 14 Oct" for a later date.
function formatAvailableFrom(value: string | undefined, today: Date) {
  const date = value ? parseCalendarDate(value) : null;
  if (!date || date <= today) return "today";
  return format(date, "EEE d MMM");
}

type StayAvailability = {
  propertyType?: "hotel" | "entire_place";
  blockedRanges: Array<{
    id: string;
    source: "booking" | "manual" | "sold-out";
    startDate: string;
    endDate: string;
    checkoutDate: string;
    status: string;
    guestName: string;
  }>;
  availableFrom: string;
};

export default function AccommodationDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const search = useSearch();
  // Kenya's today: a guest abroad sees the coast's calendar.
  const kenyaToday = useMemo(() => parseCalendarDate(todayInKenya()) ?? startOfDay(new Date()), []);
  const [calendarMonth, setCalendarMonth] = useState(kenyaToday);
  const staySearch = useMemo(() => readStaySearchState(search), [search]);
  const staySearchSuffix = toSearchSuffix(search);
  const hasTripFilters = hasStructuredStayFilters(staySearch);
  const stayNights = getStaySearchNights(staySearch.checkIn, staySearch.checkOut);
  
  const { data: accommodation, isLoading } = useQuery<StayWithRooms & { seo?: PublicListingSeo | null }>({
    queryKey: ["/api/stays", id],
    queryFn: async () => {
      const response = await fetch(`/api/stays/${id}`);
      if (!response.ok) throw new Error("Failed to fetch accommodation");
      return response.json();
    },
  });
  const ownsListing = useOwnsListing("stay", accommodation?.id);

  // Phase 3: a visit from a share link (or another tagged link) is recorded,
  // once per device per day on the server.
  useEffect(() => {
    if (id) captureListingVisit("stay", id);
  }, [id]);

  const { data: availability } = useQuery<StayAvailability>({
    queryKey: ["/api/stays", id, "availability"],
    enabled: !!id,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const response = await fetch(`/api/stays/${id}/availability`);
      if (!response.ok) throw new Error("Failed to fetch availability");
      return response.json();
    },
  });

  const isHotel = isHotelStay(accommodation);
  const hasStayDates = Boolean(staySearch.checkIn && staySearch.checkOut && staySearch.checkOut >= staySearch.checkIn);
  const { data: roomAvailability } = useQuery<{ rooms: Array<{ roomTypeId: string; roomsLeft: number }> }>({
    queryKey: ["/api/stays", id, "rooms", staySearch.checkIn, staySearch.checkOut],
    enabled: Boolean(id && isHotel && hasStayDates),
    queryFn: async () => {
      const params = new URLSearchParams({ checkIn: staySearch.checkIn, checkOut: staySearch.checkOut });
      const response = await fetch(`/api/stays/${id}/rooms?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch room availability");
      return response.json();
    },
  });
  const roomsLeft = useMemo(
    () => (roomAvailability ? new Map(roomAvailability.rooms.map((room) => [room.roomTypeId, room.roomsLeft])) : undefined),
    [roomAvailability],
  );

  // Booking a hotel room carries the room and meal plan, with the trip's dates and guests.
  const bookRoom = (roomTypeId: string, mealPlan: string) => {
    const params = new URLSearchParams(staySearchSuffix.replace(/^\?/, ""));
    params.set("room", roomTypeId);
    params.set("plan", mealPlan);
    void trackShareEvent("book");
    setLocation(withShareRef(`/book/${id}?${params.toString()}`));
  };

  const blockedDates = useMemo(() => {
    if (!availability) return [];

    return availability.blockedRanges.flatMap((range) =>
      eachDayOfInterval({
        start: parseISO(range.startDate),
        end: parseISO(range.endDate),
      }),
    );
  }, [availability]);

  if (isLoading) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4 md:px-8 max-w-6xl">
          <Skeleton className="w-full aspect-[16/9] rounded-xl mb-8" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-32 w-full" />
            </div>
            <div>
              <Skeleton className="h-96 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!accommodation) {
    return (
      <div className="min-h-screen">
        <SeoHead title="Stay not available | Tembea Bila Matata" robots="noindex,follow" canonicalUrl={buildCanonicalUrl("/accommodations")} />
        <ListingUnavailable kind="stay" browseHref={`/accommodations${staySearchSuffix}`} browseLabel="Browse places to stay" />
      </div>
    );
  }

  const canonicalUrl = buildCanonicalUrl(getPublicListingPath("stay", accommodation.id, accommodation.title));
  const location = formatSeoLocation(accommodation.location);
  // Filed under its area page ("Places to stay in Diani") when the area is known.
  const crumb = listingBreadcrumb("stay", listingSeoArea(toSeoListingInput("stay", accommodation as unknown as Record<string, unknown>)));
  const roomTypes = accommodation.roomTypes ?? [];
  const hotelSummary = summarizeHotelRooms(roomTypes);
  const stayFacts = isHotel
    ? `${accommodation.starRating ? `${accommodation.starRating}-star hotel` : "Hotel"} in ${location} with ${hotelSummary.roomTypeCount} room type${hotelSummary.roomTypeCount === 1 ? "" : "s"}${hotelSummary.mealPlans.length ? ` on ${hotelSummary.mealPlans.length === 1 ? "one meal plan" : `${hotelSummary.mealPlans.length} meal plans`}` : ""}.`
    : `${accommodation.bedrooms}-bedroom accommodation in ${location}, with ${accommodation.bathrooms} bathrooms and space for up to ${accommodation.maxOccupancy} guests.`;
  // Search engines get the price; guests see it in their own currency below.
  const semanticSummary = isHotel
    ? `${stayFacts} Rooms from ${accommodation.price} USD per room per night.`
    : `${stayFacts} Available from ${accommodation.price} USD per night.`;
  const availableFrom = formatAvailableFrom(availability?.availableFrom, kenyaToday);
  const goToBooking = () => {
    void trackShareEvent("book");
    setLocation(withShareRef(`/book/${accommodation.id}${staySearchSuffix}`));
  };
  // At a hotel, the guest picks a room first.
  const chooseRoom = () => document.getElementById("rooms")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const structuredData = isHotel ? {
    "@context": "https://schema.org",
    "@type": "Hotel",
    name: accommodation.title,
    description: accommodation.description,
    image: accommodation.imageUrl ? [accommodation.imageUrl] : undefined,
    url: canonicalUrl,
    numberOfRooms: hotelSummary.totalRooms,
    starRating: accommodation.starRating ? { "@type": "Rating", ratingValue: accommodation.starRating } : undefined,
    checkinTime: accommodation.checkInTime ?? undefined,
    checkoutTime: accommodation.checkOutTime ?? undefined,
    address: { "@type": "PostalAddress", addressLocality: location, addressCountry: "KE" },
    aggregateRating: hasPublicRating(accommodation) ? {
      "@type": "AggregateRating",
      ratingValue: accommodation.rating,
      reviewCount: accommodation.reviewCount,
    } : undefined,
    offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: accommodation.price, url: canonicalUrl },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: buildCanonicalUrl("/") },
        { "@type": "ListItem", position: 2, name: crumb.label, item: buildCanonicalUrl(crumb.path) },
        { "@type": "ListItem", position: 3, name: accommodation.title, item: canonicalUrl },
      ],
    },
  } : {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: accommodation.title,
    description: accommodation.description,
    image: accommodation.imageUrl ? [accommodation.imageUrl] : undefined,
    url: canonicalUrl,
    numberOfRooms: accommodation.bedrooms,
    occupancy: { "@type": "QuantitativeValue", maxValue: accommodation.maxOccupancy },
    address: { "@type": "PostalAddress", addressLocality: location, addressCountry: "KE" },
    areaServed: { "@type": "Place", name: location },
    aggregateRating: hasPublicRating(accommodation) ? {
      "@type": "AggregateRating",
      ratingValue: accommodation.rating,
      reviewCount: accommodation.reviewCount,
    } : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: accommodation.price,
      url: canonicalUrl,
    },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: buildCanonicalUrl("/") },
        { "@type": "ListItem", position: 2, name: crumb.label, item: buildCanonicalUrl(crumb.path) },
        { "@type": "ListItem", position: 3, name: accommodation.title, item: canonicalUrl },
      ],
    },
  };

  return (
    <div className="min-h-screen py-12">
      <SeoHead
        title={accommodation.seo?.title || getListingSeoTitle("stay", accommodation.title, accommodation.location)}
        description={accommodation.seo?.description || buildListingSeoDescription([semanticSummary, accommodation.description])}
        image={accommodation.imageUrl}
        canonicalUrl={canonicalUrl}
        structuredData={structuredData}
      />
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 md:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span className="mx-2">/</span>
          <Link href={crumb.path} className="hover:text-foreground">{crumb.label}</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{accommodation.title}</span>
        </nav>
        <ShareGiftBanner className="mb-6" />
        <div className="mb-10">
          <StayMediaCarousel
            stay={accommodation}
            imageAlts={accommodation.seo?.imageAlts}
            aspectClassName="aspect-[16/9]"
            thumbnailPlacement="below"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            <div>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <StayKindBadge stay={accommodation} />
                    <span className="text-sm text-muted-foreground">{describeStayKind(accommodation)}</span>
                  </div>
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <h1 className="min-w-0 font-serif text-3xl font-medium md:text-4xl" data-testid="text-stay-title">
                      {accommodation.title}
                    </h1>
                    <ListingShareSheet
                      kind="stay"
                      id={accommodation.id}
                      name={accommodation.title}
                      description={accommodation.description}
                      {...getListingSharePrice("stay", accommodation)}
                      isPublic
                      source={ownsListing ? "provider" : "visitor"}
                      triggerClassName="mt-1 min-h-11 shrink-0"
                    />
                  </div>
                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                    {stayFacts}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      <span className="break-words">{location}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {hasPublicRating(accommodation)
                        ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                        : <Sparkles className="h-4 w-4 text-primary" />}
                      <span className="break-words">{hasPublicRating(accommodation) ? `Rated ${formatRating(accommodation.rating)}/5 from ${accommodation.reviewCount} reviews` : "New on TBM"}</span>
                    </div>
                  </div>
                </div>
              </div>

              <Separator className="my-6" />

              {isHotel ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Bed className="h-4 w-4 shrink-0 text-primary" />
                      <span>{hotelSummary.roomTypeCount} room type{hotelSummary.roomTypeCount === 1 ? "" : "s"}</span>
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <DoorOpen className="h-4 w-4 shrink-0 text-primary" />
                      <span>Check-in {accommodation.checkInTime ? `from ${formatKenyaClockTime(accommodation.checkInTime)}` : "as agreed"}</span>
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4 shrink-0 text-primary" />
                      <span>Check-out {accommodation.checkOutTime ? `by ${formatKenyaClockTime(accommodation.checkOutTime)}` : "as agreed"}</span>
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
                      <span>Available from {availability?.availableFrom ?? "today"}</span>
                    </div>
                  </Card>
                </div>
              ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4 text-primary" />
                    <span>Up to {accommodation.maxOccupancy} guests</span>
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Bed className="h-4 w-4 text-primary" />
                    <span>{accommodation.bedrooms} bedrooms</span>
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Bath className="h-4 w-4 text-primary" />
                    <span>{accommodation.bathrooms} bathrooms</span>
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <span>Available from {availableFrom}</span>
                  </div>
                </Card>
              </div>
              )}

              <div className="mt-6">
                <h2 className="mb-3 font-serif text-2xl font-medium">{isHotel ? "About this hotel" : "About this place"}</h2>
                <p className="text-muted-foreground leading-relaxed">
                  {accommodation.description}
                </p>
              </div>
            </div>

            {isHotel ? (
              <HotelRoomsSection roomTypes={roomTypes} roomsLeft={roomsLeft} onBook={bookRoom} />
            ) : null}

            <div>
              <h2 className="mb-4 font-serif text-2xl font-medium">{isHotel ? "Hotel facilities" : "Features"}</h2>
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                {accommodation.features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-4 font-serif text-2xl font-medium">Available Services</h2>
              <p className="text-muted-foreground mb-4">
                {isHotel
                  ? "Meals come with your room's meal plan. Add transport and experiences to your hotel stay during booking."
                  : "Enhance your stay with our curated local services. Select add-ons during booking."}
              </p>
              {isHotel ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Car className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium mb-1">Car Rental &amp; transfers</div>
                        <div className="text-sm text-muted-foreground">With or without driver</div>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Compass className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium mb-1">Experiences</div>
                        <div className="text-sm text-muted-foreground">Tours and activities on the coast</div>
                      </div>
                    </div>
                  </Card>
                </div>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Car className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium mb-1">Car Rental</div>
                      <div className="text-sm text-muted-foreground">
                        With or without driver
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <ChefHat className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium mb-1">Personal Chef</div>
                      <div className="text-sm text-muted-foreground">
                        In-home dining experience
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <ShoppingBag className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium mb-1">Shopping Service</div>
                      <div className="text-sm text-muted-foreground">
                        Pre-arrival grocery stocking
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium mb-1">Errand Services</div>
                      <div className="text-sm text-muted-foreground">
                        Local assistance
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
              )}
            </div>

            <PublicReviewPreview targetType="stay" targetId={accommodation.id} variant="full" maxItems={4} />

            <YourHost kind="stay" listingId={accommodation.id} />
          </div>

          {/* Booking Sidebar */}
          <div className="lg:sticky lg:top-24 h-fit">
            <Card className="p-5 sm:p-6">
              {hasTripFilters ? (
                <div className="mb-5 rounded-2xl border bg-muted/30 p-4 text-sm">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Your trip
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {staySearch.destination ? (
                      <span className="rounded-full bg-background px-3 py-1 text-foreground">
                        {staySearch.destination}
                      </span>
                    ) : null}
                    {staySearch.checkIn ? (
                      <span className="rounded-full bg-background px-3 py-1 text-foreground">
                        Check in {formatStaySearchDate(staySearch.checkIn)}
                      </span>
                    ) : null}
                    {staySearch.checkOut ? (
                      <span className="rounded-full bg-background px-3 py-1 text-foreground">
                        Check out {formatStaySearchDate(staySearch.checkOut)}
                      </span>
                    ) : null}
                    {stayNights ? (
                      <span className="rounded-full bg-background px-3 py-1 text-foreground">
                        {stayNights} night{stayNights === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {staySearch.guests ? (
                      <span className="rounded-full bg-background px-3 py-1 text-foreground">
                        {staySearch.guests} guest{staySearch.guests === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    These details will be prefilled when you continue to booking.
                  </p>
                </div>
              ) : null}

              <div className="mb-6">
                {isHotel ? <div className="text-sm text-muted-foreground">Rooms from</div> : null}
                <CurrencyAmount
                  amountUsd={accommodation.price}
                  primaryClassName="text-3xl font-semibold"
                  className="mb-1"
                />
                <div className="text-sm text-muted-foreground">{isHotel ? "per room / night" : "per night"}</div>
                {isHotel ? <MealPlanChips plans={hotelSummary.mealPlans} className="mt-3" /> : null}
              </div>

              <div className="space-y-3 mb-6 rounded-xl border bg-muted/30 p-4 text-sm">
                {isHotel ? (
                  <div className="flex flex-col gap-1 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                    <span className="font-medium">Rooms</span>
                    <span className="text-muted-foreground">Up to {hotelSummary.largestRoom} guests each</span>
                  </div>
                ) : (
                <div className="flex flex-col gap-1 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                  <span className="font-medium">Guest limit</span>
                  <span className="text-muted-foreground">Up to {accommodation.maxOccupancy}</span>
                </div>
                )}
                <div className="flex flex-col gap-1 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                  <span className="font-medium">Next available</span>
                  <span className="text-muted-foreground first-letter:uppercase">{availableFrom}</span>
                </div>
                <div className="rounded-xl border bg-background p-2">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {isHotel ? "Fully booked days" : "Booked days"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {format(calendarMonth, "MMM yyyy")}
                    </span>
                  </div>
                  <Calendar
                    mode="single"
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    today={kenyaToday}
                    disabled={{ before: kenyaToday }}
                    modifiers={{
                      booked: blockedDates,
                    }}
                    modifiersClassNames={{
                      booked: "bg-red-100 text-red-700 hover:bg-red-100 hover:text-red-700 rounded-md font-medium",
                    }}
                    className="mx-auto w-full max-w-[19rem] p-0"
                    classNames={{
                      month: "space-y-2",
                      caption: "flex items-center justify-center pt-1 relative",
                      caption_label: "text-sm font-semibold",
                      nav_button: "h-7 w-7",
                      head_row: "flex",
                      head_cell: "w-8 text-[10px] font-medium text-muted-foreground",
                      row: "mt-1 flex w-full",
                      cell: "h-8 w-8 p-0 text-center text-sm",
                      day: "h-8 w-8 rounded-md text-xs font-normal",
                      day_today: "bg-primary/10 text-primary font-semibold",
                    }}
                  />
                  <div className="mt-2 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-sm bg-red-100" />
                    <span>{isHotel ? "No rooms left" : "Booked days"}</span>
                  </div>
                </div>
              </div>

              {isHotel ? (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={chooseRoom}
                  data-testid="button-choose-room"
                >
                  Choose your room
                </Button>
              ) : (
              <Button
                className="w-full"
                size="lg"
                onClick={goToBooking}
                data-testid="button-book-now"
              >
                Book Now
              </Button>
              )}

              <Separator className="my-6" />

              <div className="space-y-3 text-sm" data-testid="stay-assurances">
                <div className="flex items-start gap-2 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>Pay securely in your My Bookings checkout: card or M-Pesa</span>
                </div>
                <div className="flex items-start gap-2 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>Hosts are approved by TBM before they can list</span>
                </div>
                <div className="flex items-start gap-2 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>TBM's team on WhatsApp or {CONTACT_PHONE_DISPLAY} before, during and after your stay</span>
                </div>
                <div className="flex items-start gap-2 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    Refunds follow our{" "}
                    <Link href="/refund-cancellation" className="underline underline-offset-2 hover:text-foreground">cancellation policy</Link>
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
      <div className="h-20 lg:hidden" aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t border-border/70 bg-background px-4 py-3 shadow-[0_-18px_40px_rgba(15,23,42,0.16)] lg:hidden" data-testid="stay-book-bar">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <CurrencyAmount amountUsd={accommodation.price} primaryClassName="text-base font-semibold text-foreground" />
            <div className="truncate text-xs text-muted-foreground">
              {isHotel ? "lowest room rate per night" : `per night · available from ${availableFrom}`}
            </div>
          </div>
          <Button className="min-h-11 shrink-0 px-6" onClick={isHotel ? chooseRoom : goToBooking} data-testid="button-book-now-bar">
            {isHotel ? "Choose a room" : "Book"}
          </Button>
        </div>
      </div>
    </div>
  );
}
