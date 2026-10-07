import { useMemo, useState } from "react";
import { useParams, useLocation, useSearch, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Baby,
  Bath,
  Bed,
  Car,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  Compass,
  DoorOpen,
  MapPin,
  MessageCircle,
  Minus,
  Plus,
  ShoppingBag,
  Sparkles,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StayMediaCarousel } from "@/components/stay-media-carousel";
import { CurrencyAmount } from "@/components/currency-amount";
import { PublicReviewPreview } from "@/components/public-review-preview";
import { DateRangePicker, countTripUnits, describeTripRange, formatTripDate } from "@/components/date-range-picker";
import { StayRefundNote } from "@/components/stay-refund-note";
import { readStaySearchState, toSearchSuffix } from "@/lib/stay-search";
import type { StayWithRooms } from "@shared/schema";
import { SeoHead } from "@/components/seo-head";
import { MealPlanChips } from "@/components/stay-kind";
import { HotelRoomsSection } from "@/components/hotel-rooms-section";
import { isHotelStay, summarizeHotelRooms } from "@shared/hotel-rooms";
import { buildCanonicalUrl } from "@/lib/canonical-url";
import {
  buildListingSeoDescription,
  formatSeoLocation,
  getListingSeoTitle,
  getPublicListingPath,
} from "@/lib/public-listing";
import { formatCalendarDate, formatKenyaClockTime } from "@shared/calendar-dates";
import { bookingDepositPercent, calculateBookingDepositAmount } from "@shared/booking-payments";
import { useCurrency } from "@/lib/currency";
import { openZaina } from "@/lib/zaina";
import { cn } from "@/lib/utils";

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

type PublicReview = { rating: number; comment?: string | null };

type TripExtraOption = {
  /** The checkout's ?add= key: it opens with these ready to choose. */
  key: string;
  label: string;
  /** For a sentence: "Adding a pickup and a private chef". */
  inSentence: string;
  icon: LucideIcon;
  /** Things done in the home, which a hotel looks after itself. */
  homeOnly: boolean;
};

const tripExtraOptions: TripExtraOption[] = [
  { key: "pickup", label: "Airport or SGR pickup", inSentence: "a pickup", icon: Car, homeOnly: false },
  { key: "chef", label: "A private chef", inSentence: "a private chef", icon: ChefHat, homeOnly: true },
  { key: "shopping", label: "Groceries before you arrive", inSentence: "groceries", icon: ShoppingBag, homeOnly: true },
  { key: "nanny", label: "A nanny", inSentence: "a nanny", icon: Baby, homeOnly: true },
  { key: "home", label: "Cleaning and laundry", inSentence: "cleaning and laundry", icon: Sparkles, homeOnly: true },
  { key: "dayOut", label: "A day out", inSentence: "a day out", icon: Compass, homeOnly: false },
];

/** "a pickup, a chef and a nanny" */
function joinInSentence(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "27 Oct": short enough for the pinned bar. */
function shortDate(value: string) {
  return formatCalendarDate(value, { day: "numeric", month: "short" }, "en-GB");
}

export default function AccommodationDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const staySearch = useMemo(() => readStaySearchState(search), [search]);
  const staySearchSuffix = toSearchSuffix(search);
  const { formatAmount } = useCurrency();
  const [datesOpen, setDatesOpen] = useState(false);

  const { data: accommodation, isLoading } = useQuery<StayWithRooms>({
    queryKey: ["/api/stays", id],
    queryFn: async () => {
      const response = await fetch(`/api/stays/${id}`);
      if (!response.ok) throw new Error("Failed to fetch accommodation");
      return response.json();
    },
  });

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

  // The same reviews the reviews section shows, so the rating at the top agrees with it.
  const { data: reviews } = useQuery<PublicReview[]>({
    queryKey: ["/api/reviews", "stay", id],
    enabled: !!id,
    queryFn: async () => {
      const response = await fetch(`/api/reviews/stay/${id}`);
      if (!response.ok) throw new Error("Failed to fetch public reviews");
      return response.json();
    },
  });

  const isHotel = isHotelStay(accommodation);
  const { checkIn, checkOut } = staySearch;
  const hasStayDates = Boolean(checkIn && checkOut && checkOut > checkIn);
  const nights = hasStayDates ? countTripUnits(checkIn, checkOut, "night") : 0;
  const maxGuests = Math.max(1, accommodation?.maxOccupancy || 1);
  const guests = Math.min(staySearch.guests || 2, maxGuests);
  const addedExtras = useMemo(
    () => new Set((new URLSearchParams(search).get("add") || "").split(",").map((value) => value.trim()).filter(Boolean)),
    [search],
  );

  const { data: roomAvailability } = useQuery<{ rooms: Array<{ roomTypeId: string; roomsLeft: number }> }>({
    queryKey: ["/api/stays", id, "rooms", checkIn, checkOut],
    enabled: Boolean(id && isHotel && hasStayDates),
    queryFn: async () => {
      const params = new URLSearchParams({ checkIn, checkOut });
      const response = await fetch(`/api/stays/${id}/rooms?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch room availability");
      return response.json();
    },
  });
  const roomsLeft = useMemo(
    () => (roomAvailability ? new Map(roomAvailability.rooms.map((room) => [room.roomTypeId, room.roomsLeft])) : undefined),
    [roomAvailability],
  );

  // The trip lives in the page's address, so a refresh or a shared link keeps it.
  const updateTrip = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    setLocation(`${window.location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  };

  const toggleExtra = (key: string) => {
    const next = new Set(addedExtras);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateTrip({ add: next.size ? Array.from(next).join(",") : null });
  };

  // Checkout opens with the dates, guests and extras chosen here.
  const checkoutParams = () => {
    const params = new URLSearchParams(search);
    params.set("guests", String(guests));
    return params;
  };

  const bookRoom = (roomTypeId: string, mealPlan: string) => {
    const params = checkoutParams();
    params.set("room", roomTypeId);
    params.set("plan", mealPlan);
    setLocation(`/book/${id}?${params.toString()}`);
  };

  // From the pinned bar: on a tablet the calendar opens beside the card's
  // date field, so bring the card into view first. Phones get a full screen.
  const openDates = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      document.getElementById("book")?.scrollIntoView({ block: "center" });
    }
    setDatesOpen(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen pb-12 pt-6 md:pt-8">
        <div className="container mx-auto max-w-6xl px-4 sm:px-6 md:px-8">
          <Skeleton className="mb-3 h-5 w-40" />
          <Skeleton className="mb-6 h-10 w-3/4" />
          <Skeleton className="mb-8 aspect-[4/3] w-full rounded-[1.6rem] md:aspect-auto md:h-[26rem] lg:h-[30rem]" />
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-32 w-full" />
            </div>
            <Skeleton className="h-96 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!accommodation) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SeoHead title="Accommodation not found | Tembea Bila Matata" robots="noindex,follow" canonicalUrl={buildCanonicalUrl("/accommodations")} />
        <div className="text-center">
          <h2 className="font-serif text-2xl font-medium mb-2">Accommodation not found</h2>
          <Button onClick={() => setLocation(`/accommodations${staySearchSuffix}`)} data-testid="button-back">
            Back to Accommodations
          </Button>
        </div>
      </div>
    );
  }

  const canonicalUrl = buildCanonicalUrl(getPublicListingPath("stay", accommodation.id, accommodation.title));
  const location = formatSeoLocation(accommodation.location);
  const roomTypes = accommodation.roomTypes ?? [];
  const hotelSummary = summarizeHotelRooms(roomTypes);
  const semanticSummary = isHotel
    ? `${accommodation.starRating ? `${accommodation.starRating}-star hotel` : "Hotel"} in ${location} with ${hotelSummary.roomTypeCount} room type${hotelSummary.roomTypeCount === 1 ? "" : "s"}${hotelSummary.mealPlans.length ? ` on ${hotelSummary.mealPlans.length === 1 ? "one meal plan" : `${hotelSummary.mealPlans.length} meal plans`}` : ""}. Rooms from ${accommodation.price} USD per room per night.`
    : `${accommodation.bedrooms}-bedroom accommodation in ${location}, with ${accommodation.bathrooms} bathrooms and space for up to ${accommodation.maxOccupancy} guests. Available from ${accommodation.price} USD per night.`;
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
    aggregateRating: accommodation.reviewCount > 0 ? {
      "@type": "AggregateRating",
      ratingValue: accommodation.rating,
      reviewCount: accommodation.reviewCount,
    } : undefined,
    offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: accommodation.price, url: canonicalUrl },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: buildCanonicalUrl("/") },
        { "@type": "ListItem", position: 2, name: "Accommodation in Mombasa and Nyali", item: buildCanonicalUrl("/accommodations") },
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
    aggregateRating: accommodation.reviewCount > 0 ? {
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
        { "@type": "ListItem", position: 2, name: "Accommodation in Mombasa and Nyali", item: buildCanonicalUrl("/accommodations") },
        { "@type": "ListItem", position: 3, name: accommodation.title, item: canonicalUrl },
      ],
    },
  };

  const stayTotal = accommodation.price * nights;
  const dueToday = calculateBookingDepositAmount(stayTotal);
  const extraOptions = tripExtraOptions.filter((option) => !isHotel || !option.homeOnly);
  const addedOptions = extraOptions.filter((option) => addedExtras.has(option.key));
  const reviewCount = reviews ? reviews.length : accommodation.reviewCount;
  const averageRating = reviews?.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : accommodation.rating;
  const hasWrittenReviews = Boolean(reviews?.some((review) => review.comment?.trim()));
  const kindLine = isHotel
    ? accommodation.starRating ? `${accommodation.starRating}-star hotel` : "Hotel"
    : "Entire place";
  const arrivalTimes = [
    accommodation.checkInTime ? `Check-in from ${formatKenyaClockTime(accommodation.checkInTime)}` : null,
    accommodation.checkOutTime ? `check-out by ${formatKenyaClockTime(accommodation.checkOutTime)}` : null,
  ].filter(Boolean).join(", ");

  const askZaina = () => {
    const dates = hasStayDates ? ` from ${formatTripDate(checkIn)} to ${formatTripDate(checkOut)}` : "";
    openZaina(`I'm looking at ${accommodation.title}${dates} for ${guests} guest${guests === 1 ? "" : "s"}. Can you help me plan the rest of the trip?`);
  };
  const scrollToRooms = () => document.getElementById("rooms")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const reserve = () => setLocation(`/book/${accommodation.id}?${checkoutParams().toString()}`);
  // Hotels: the room is the decision. Entire places: the dates, then reserve.
  const primaryAction = isHotel
    ? { label: "Choose a room", onClick: scrollToRooms }
    : hasStayDates
      ? { label: "Reserve", onClick: reserve }
      : { label: "Check dates", onClick: openDates };

  return (
    <div className="min-h-screen pb-28 pt-4 sm:pt-6 md:pt-8 lg:pb-12">
      <SeoHead
        title={getListingSeoTitle("stay", accommodation.title, accommodation.location)}
        description={buildListingSeoDescription([semanticSummary, accommodation.description])}
        image={accommodation.imageUrl}
        canonicalUrl={canonicalUrl}
        structuredData={structuredData}
      />
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 md:px-8">
        <nav aria-label="Breadcrumb" className="mb-4 hidden text-sm text-muted-foreground md:block">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span className="mx-2">/</span>
          <Link href={`/accommodations${staySearchSuffix}`} className="hover:text-foreground">Places to stay</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{accommodation.title}</span>
        </nav>

        {/* What it is, where, and what guests thought: above the photos on a
            laptop, just below them on a phone. */}
        <div className="flex flex-col gap-5 md:gap-6">
          <header className="order-2 md:order-1">
            <p className="text-sm font-medium text-primary">{kindLine} · {location}</p>
            <h1 className="mt-1 font-serif text-3xl font-medium leading-tight md:text-4xl" data-testid="text-stay-title">
              {accommodation.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {reviewCount > 0 ? (
                hasWrittenReviews ? (
                  <a href="#reviews" className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4 hover:text-primary" data-testid="link-stay-rating">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                    {averageRating.toFixed(1)} · {reviewCount} review{reviewCount === 1 ? "" : "s"}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground" data-testid="link-stay-rating">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                    {averageRating.toFixed(1)} · {reviewCount} review{reviewCount === 1 ? "" : "s"}
                  </span>
                )
              ) : (
                <span>No reviews yet</span>
              )}
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {location}
              </span>
            </div>
          </header>
          <div className="order-1 md:order-2">
            <StayMediaCarousel
              stay={accommodation}
              layout="mosaic"
              aspectClassName="aspect-[4/3] md:aspect-[16/9]"
            />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 space-y-10">
            <section aria-labelledby="about-heading" className="space-y-5">
              <ul className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border/70 pb-5 text-sm text-foreground/85" aria-label="At a glance">
                {isHotel ? (
                  <>
                    <li className="inline-flex items-center gap-2">
                      <Bed className="h-4 w-4 text-primary" aria-hidden="true" />
                      {hotelSummary.roomTypeCount} room type{hotelSummary.roomTypeCount === 1 ? "" : "s"}
                    </li>
                    {hotelSummary.largestRoom ? (
                      <li className="inline-flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                        Rooms for up to {hotelSummary.largestRoom} guests
                      </li>
                    ) : null}
                  </>
                ) : (
                  <>
                    <li className="inline-flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                      Up to {accommodation.maxOccupancy} guests
                    </li>
                    <li className="inline-flex items-center gap-2">
                      <Bed className="h-4 w-4 text-primary" aria-hidden="true" />
                      {accommodation.bedrooms} bedroom{accommodation.bedrooms === 1 ? "" : "s"}
                    </li>
                    <li className="inline-flex items-center gap-2">
                      <Bath className="h-4 w-4 text-primary" aria-hidden="true" />
                      {accommodation.bathrooms} bathroom{accommodation.bathrooms === 1 ? "" : "s"}
                    </li>
                  </>
                )}
                {accommodation.checkInTime ? (
                  <li className="inline-flex items-center gap-2">
                    <DoorOpen className="h-4 w-4 text-primary" aria-hidden="true" />
                    Check-in from {formatKenyaClockTime(accommodation.checkInTime)}
                  </li>
                ) : null}
              </ul>
              <div>
                <h2 id="about-heading" className="mb-3 font-serif text-2xl font-medium">{isHotel ? "About this hotel" : "About this place"}</h2>
                <p className="whitespace-pre-line leading-relaxed text-muted-foreground">{accommodation.description}</p>
              </div>
            </section>

            {isHotel ? (
              <HotelRoomsSection roomTypes={roomTypes} roomsLeft={roomsLeft} onBook={bookRoom} />
            ) : null}

            <PublicReviewPreview targetType="stay" targetId={accommodation.id} variant="open" maxItems={4} />

            {accommodation.features.length > 0 ? (
              <section aria-labelledby="features-heading">
                <h2 id="features-heading" className="mb-4 font-serif text-2xl font-medium">{isHotel ? "Hotel facilities" : "What this place offers"}</h2>
                <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                  {accommodation.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Build the trip around the stay: checkout opens with these ready to choose. */}
            <section id="make-it-a-trip" aria-labelledby="trip-heading" className="scroll-mt-24 rounded-2xl border border-border/70 bg-muted/20 p-5 sm:p-6">
              <h2 id="trip-heading" className="font-serif text-2xl font-medium">Make it a trip</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {isHotel
                  ? "Add a ride from the airport or SGR, or a day out. You choose the details at checkout, and it all comes in one booking."
                  : "Add what you'd like ready for you. You choose the details at checkout, and it all comes in one booking."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {extraOptions.map((option) => {
                  const added = addedExtras.has(option.key);
                  const Icon = added ? Check : option.icon;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={added}
                      onClick={() => toggleExtra(option.key)}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        added
                          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                          : "border-border bg-background text-foreground hover:border-primary/50",
                      )}
                      data-testid={`toggle-extra-${option.key}`}
                    >
                      <Icon className={cn("h-4 w-4", added ? "" : "text-primary")} aria-hidden="true" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={askZaina}
                className="mt-4 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Something else in mind? Ask Zaina to arrange it
              </button>
            </section>

            <section aria-labelledby="good-to-know-heading">
              <h2 id="good-to-know-heading" className="mb-4 font-serif text-2xl font-medium">Good to know</h2>
              <dl className="grid gap-5 text-sm sm:grid-cols-2">
                {arrivalTimes ? (
                  <div>
                    <dt className="flex items-center gap-2 font-semibold text-foreground">
                      <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                      Arriving and leaving
                    </dt>
                    <dd className="mt-1 leading-6 text-muted-foreground">{arrivalTimes}.</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="flex items-center gap-2 font-semibold text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                    Paying
                  </dt>
                  <dd className="mt-1 leading-6 text-muted-foreground">
                    Pay {bookingDepositPercent}% to lock your dates, by M-Pesa or card. The rest is paid later.
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 font-semibold text-foreground">
                    <MessageCircle className="h-4 w-4 text-primary" aria-hidden="true" />
                    Help
                  </dt>
                  <dd className="mt-1 leading-6 text-muted-foreground">
                    Zaina answers any time. Our team is here Monday to Saturday, 8am to 8pm.
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <aside className="lg:sticky lg:top-24 lg:h-fit" aria-label="Book this stay">
            <Card id="book" className="scroll-mt-24 rounded-2xl border-border/70 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
              <div>
                {isHotel ? (
                  <>
                    <p className="text-sm text-muted-foreground">Rooms from</p>
                    <p className="flex flex-wrap items-baseline gap-x-1.5">
                      <CurrencyAmount amountUsd={accommodation.price} primaryClassName="text-2xl font-semibold text-foreground" />
                      <span className="text-sm text-muted-foreground">a room a night</span>
                    </p>
                    <MealPlanChips plans={hotelSummary.mealPlans} className="mt-2" />
                  </>
                ) : hasStayDates ? (
                  <>
                    <p className="flex flex-wrap items-baseline gap-x-1.5">
                      <CurrencyAmount amountUsd={stayTotal} primaryClassName="text-2xl font-semibold text-foreground" data-testid="text-trip-total" />
                      <span className="text-sm text-muted-foreground">for {nights} night{nights === 1 ? "" : "s"}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">{formatAmount(accommodation.price)} a night</p>
                  </>
                ) : (
                  <p className="flex flex-wrap items-baseline gap-x-1.5">
                    <CurrencyAmount amountUsd={accommodation.price} primaryClassName="text-2xl font-semibold text-foreground" />
                    <span className="text-sm text-muted-foreground">a night</span>
                  </p>
                )}
              </div>

              <div className="mt-5 divide-y divide-border/70 rounded-xl border border-border/80">
                <div className="px-3 pb-1 pt-2.5">
                  <span className="block text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Dates</span>
                  <DateRangePicker
                    checkIn={checkIn}
                    checkOut={checkOut}
                    onChange={(next) => updateTrip({ checkIn: next.checkIn || null, checkOut: next.checkOut || null })}
                    bookedRanges={availability?.blockedRanges}
                    placeholder="Add your dates"
                    className="min-h-10 border-0 px-0 shadow-none"
                    open={datesOpen}
                    onOpenChange={setDatesOpen}
                    data-testid="input-stay-dates"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div>
                    <span className="block text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Guests</span>
                    <span className="text-xs text-muted-foreground">
                      {isHotel ? `Rooms for up to ${hotelSummary.largestRoom || maxGuests} each` : `Up to ${maxGuests}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 rounded-full"
                      aria-label="One guest fewer"
                      disabled={guests <= 1}
                      onClick={() => updateTrip({ guests: String(guests - 1) })}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="min-w-[2ch] text-center text-base font-semibold tabular-nums" aria-live="polite" data-testid="text-stay-guests">
                      {guests}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 rounded-full"
                      aria-label="One guest more"
                      disabled={guests >= maxGuests}
                      onClick={() => updateTrip({ guests: String(guests + 1) })}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-4 text-sm leading-6">
                {addedOptions.length ? (
                  <p className="text-muted-foreground" data-testid="text-stay-extras">
                    Adding <span className="font-medium text-foreground">{joinInSentence(addedOptions.map((option) => option.inSentence))}</span>. You choose the details at checkout.{" "}
                    <a href="#make-it-a-trip" className="font-medium text-primary underline-offset-4 hover:underline">Change</a>
                  </p>
                ) : (
                  <a href="#make-it-a-trip" className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {isHotel ? "Add a pickup or a day out" : "Add a pickup, a chef or a nanny"}
                  </a>
                )}
              </div>

              {!isHotel && hasStayDates ? (
                <p className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm leading-6" data-testid="text-commitment-today">
                  Pay <span className="font-semibold">{formatAmount(dueToday)}</span> today ({bookingDepositPercent}%) to lock these dates. The rest is paid later.
                  {addedOptions.length ? " Extras are priced at checkout." : ""}
                </p>
              ) : null}

              <Button
                className="mt-4 h-12 w-full rounded-full text-base"
                onClick={primaryAction.onClick}
                data-testid={isHotel ? "button-choose-room" : "button-book-now"}
              >
                {primaryAction.label}
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {isHotel
                  ? "Pick a room and meal plan, then check your trip before you book."
                  : hasStayDates
                    ? "You won't pay anything yet."
                    : "Booked nights are crossed out on the calendar."}
              </p>

              <StayRefundNote checkIn={hasStayDates ? checkIn : null} className="mt-4 border-t border-border/60 pt-4" />

              <Button
                variant="outline"
                className="mt-4 w-full rounded-full"
                onClick={askZaina}
                data-testid="button-plan-trip-with-zaina"
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                Plan my trip with Zaina
              </Button>
            </Card>
          </aside>
        </div>
      </div>

      {/* Phones and tablets: the price and the next step stay in reach, above the tab bar. */}
      <div
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t border-border/70 bg-background/95 px-4 py-3 shadow-[0_-18px_40px_rgba(15,23,42,0.16)] backdrop-blur lg:hidden"
        data-testid="stay-bar"
      >
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            {isHotel ? (
              <>
                <div className="text-base font-semibold text-foreground">
                  From <CurrencyAmount amountUsd={accommodation.price} />
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  a room a night{hasStayDates ? ` · ${shortDate(checkIn)} – ${shortDate(checkOut)}` : ""}
                </div>
              </>
            ) : hasStayDates ? (
              <>
                <div className="text-base font-semibold text-foreground" data-testid="text-stay-bar-total">
                  <CurrencyAmount amountUsd={stayTotal} />{" "}
                  <span className="text-sm font-normal text-muted-foreground">for {nights} night{nights === 1 ? "" : "s"}</span>
                </div>
                <button
                  type="button"
                  onClick={openDates}
                  className="max-w-full truncate text-xs font-medium text-foreground underline underline-offset-4"
                  aria-label={`Change dates: ${describeTripRange(checkIn, checkOut)}`}
                >
                  {shortDate(checkIn)} – {shortDate(checkOut)}
                </button>
              </>
            ) : (
              <>
                <div className="text-base font-semibold text-foreground">
                  <CurrencyAmount amountUsd={accommodation.price} />{" "}
                  <span className="text-sm font-normal text-muted-foreground">a night</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">Add your dates to see the total</div>
              </>
            )}
          </div>
          <Button className="min-h-12 shrink-0 rounded-full px-6" onClick={primaryAction.onClick} data-testid="button-stay-bar">
            {primaryAction.label}
          </Button>
        </div>
      </div>
    </div>
  );
}
