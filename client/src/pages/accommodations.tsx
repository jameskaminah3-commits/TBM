import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ArrowUpDown, Bath, BedDouble, MapPin, Minus, Plus, SlidersHorizontal, Star, Users, WalletCards, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CurrencyAmount } from "@/components/currency-amount";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { DateRangePicker } from "@/components/date-range-picker";
import { ListingCard, ListingPrice } from "@/components/listing-card";
import { useCurrency } from "@/lib/currency";
import { filterStays, getMeaningfulTokens, normalizeConciergeQuery } from "@/lib/concierge-search";
import {
  buildStaySearchParams,
  getStaySearchNights,
  hasStructuredStayFilters,
  matchesStayDestination,
  readStaySearchState,
  type StaySearchSort,
} from "@/lib/stay-search";
import type { Stay, StayWithRooms } from "@shared/schema";
import { getPublicListingPath, getShortSeoLocation } from "@/lib/public-listing";
import { MealPlanChips } from "@/components/stay-kind";
import { isHotelStay, summarizeHotelRooms } from "@shared/hotel-rooms";
import type { StaySearchType } from "@/lib/stay-search";

const stayTypeOptions: Array<{ value: StaySearchType; label: string }> = [
  { value: "all", label: "All stays" },
  { value: "hotel", label: "Hotels" },
  { value: "entire_place", label: "Entire places" },
];

// Areas guests ask for; the trip bar offers the ones with stays listed.
const coastAreaSuggestions = ["Diani", "Nyali", "Mombasa", "Shanzu", "Mtwapa", "Kilifi", "Watamu", "Malindi", "Tiwi"];

const featureSuggestions = [
  "Pool",
  "Beachfront",
  "Ocean view",
  "WiFi",
  "Kitchen",
  "Air conditioning",
  "Parking",
  "Pet friendly",
  "Wheelchair accessible",
];

function matchesStayFeature(stay: Stay, feature: string) {
  const normalizedFeature = normalizeConciergeQuery(feature);
  const searchableFeatures = normalizeConciergeQuery(
    [stay.title, stay.location, stay.description, ...stay.features].join(" "),
  );
  return searchableFeatures.includes(normalizedFeature);
}

function scoreStayRelevance(stay: Stay, query: string) {
  const tokens = getMeaningfulTokens(query);
  if (!tokens.length) {
    return 0;
  }

  const title = normalizeConciergeQuery(stay.title);
  const location = normalizeConciergeQuery(stay.location);
  const features = normalizeConciergeQuery(stay.features.join(" "));
  const description = normalizeConciergeQuery(stay.description);

  return tokens.reduce((score, token) => {
    if (title.includes(token)) return score + 8;
    if (location.includes(token)) return score + 6;
    if (features.includes(token)) return score + 4;
    if (description.includes(token)) return score + 2;
    return score;
  }, 0);
}

function sortStays<T extends Stay>(stays: T[], sort: StaySearchSort, query: string): T[] {
  return [...stays].sort((left, right) => {
    if (sort === "price-low") return left.price - right.price;
    if (sort === "price-high") return right.price - left.price;
    if (sort === "rating") return right.rating - left.rating || right.reviewCount - left.reviewCount;
    if (sort === "capacity") return right.maxOccupancy - left.maxOccupancy || left.price - right.price;

    const relevanceDelta = scoreStayRelevance(right, query) - scoreStayRelevance(left, query);
    return relevanceDelta || right.rating - left.rating || right.reviewCount - left.reviewCount || left.price - right.price;
  });
}

/**
 * Max price per night, typed and shown in the currency the guest has chosen.
 * The search itself keeps US dollars, the currency stays are priced in; the
 * amount is applied when the guest leaves the field or presses Enter.
 */
function MaxPriceInput({ maxPriceUsd, onCommit }: { maxPriceUsd: number | null; onCommit: (maxPriceUsd: number | null) => void }) {
  const { selectedCurrency, convertFromUsd, convertToUsd } = useCurrency();
  const shown = maxPriceUsd ? String(Math.round(convertFromUsd(maxPriceUsd))) : "";
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  const commit = () => {
    const amount = Number.parseInt(text.replace(/[^\d]/g, ""), 10);
    const next = Number.isNaN(amount) || amount < 1 ? null : Math.max(1, Math.ceil(convertToUsd(amount)));
    if (next !== maxPriceUsd) onCommit(next);
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      placeholder={`${selectedCurrency === "KES" ? "KSh" : "US$"} a night`}
      className="h-9 rounded-full"
      data-testid="input-stay-filter-max-price"
    />
  );
}

export default function Accommodations() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const staySearch = useMemo(() => readStaySearchState(search), [search]);
  const activeQuery = staySearch.query;
  const staySearchSuffix = useMemo(() => {
    const params = buildStaySearchParams(staySearch);
    return params ? `?${params}` : "";
  }, [staySearch]);
  const hasTripFilters = hasStructuredStayFilters(staySearch);
  const stayNights = getStaySearchNights(staySearch.checkIn, staySearch.checkOut);
  const { formatAmount } = useCurrency();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data: accommodations, isLoading } = useQuery<StayWithRooms[]>({
    queryKey: ["/api/stays"],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const textMatchedAccommodations = useMemo(
    () => (activeQuery ? filterStays(accommodations || [], activeQuery) : accommodations || []),
    [accommodations, activeQuery],
  );

  const filteredAccommodations = useMemo(
    () => {
      const nextStays = textMatchedAccommodations.filter((stay) => {
      const hotel = isHotelStay(stay);
      const matchesType = staySearch.stayType === "all" || (staySearch.stayType === "hotel") === hotel;
      const matchesDestination = !staySearch.destination || matchesStayDestination(stay.location, staySearch.destination);
      const matchesGuests = staySearch.guests === null || stay.maxOccupancy >= staySearch.guests;
      // Bedrooms and bathrooms describe a home's layout: a hotel's are its rooms.
      const matchesBedrooms = staySearch.bedrooms === null || (!hotel && stay.bedrooms >= staySearch.bedrooms);
      const matchesBathrooms = staySearch.bathrooms === null || (!hotel && stay.bathrooms >= staySearch.bathrooms);
      const matchesPrice = staySearch.maxPrice === null || stay.price <= staySearch.maxPrice;
      const matchesRating = staySearch.minRating === null || stay.rating >= staySearch.minRating;
      const matchesFeatures = staySearch.features.every((feature) => matchesStayFeature(stay, feature));

      return matchesType && matchesDestination && matchesGuests && matchesBedrooms && matchesBathrooms && matchesPrice && matchesRating && matchesFeatures;
    });

      return sortStays(nextStays, staySearch.sort, activeQuery);
    },
    [activeQuery, staySearch.bathrooms, staySearch.bedrooms, staySearch.destination, staySearch.features, staySearch.guests, staySearch.maxPrice, staySearch.minRating, staySearch.sort, staySearch.stayType, textMatchedAccommodations],
  );

  // The Hotels / Entire places switch shows once there are hotels to tell apart.
  const stayTypeCounts = useMemo(() => {
    const hotels = (accommodations || []).filter((stay) => isHotelStay(stay)).length;
    return { all: (accommodations || []).length, hotel: hotels, entire_place: (accommodations || []).length - hotels };
  }, [accommodations]);

  const availableFeatureSuggestions = useMemo(() => {
    const matchedSuggestions = featureSuggestions.filter((feature) => {
      return (accommodations || []).some((stay) => matchesStayFeature(stay, feature));
    });

    return matchedSuggestions.length ? matchedSuggestions : featureSuggestions;
  }, [accommodations]);

  // Adjusting the trip or a filter replaces the address, so Back leaves the results.
  const updateStaySearch = (updates: Partial<typeof staySearch>) => {
    const nextSearch = buildStaySearchParams({ ...staySearch, ...updates });
    setLocation(nextSearch ? `/accommodations?${nextSearch}` : "/accommodations", { replace: true });
  };

  const updateNumberFilter = (key: "guests" | "bedrooms" | "bathrooms" | "maxPrice" | "minRating", value: string) => {
    const parsed = Number.parseInt(value, 10);
    updateStaySearch({ [key]: Number.isNaN(parsed) || parsed < 1 ? null : parsed });
  };

  const toggleFeature = (feature: string) => {
    const isActive = staySearch.features.includes(feature);
    updateStaySearch({
      features: isActive
        ? staySearch.features.filter((activeFeature) => activeFeature !== feature)
        : [...staySearch.features, feature],
    });
  };

  // Areas guests can pick, among the places stays are listed in.
  const coastAreas = useMemo(
    () => coastAreaSuggestions.filter((area) => (accommodations || []).some((stay) => matchesStayDestination(stay.location, area))),
    [accommodations],
  );

  // Filters beyond the trip itself, each removable with a tap.
  const filterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: Partial<typeof staySearch> }> = [];
    if (activeQuery) chips.push({ key: "query", label: `"${activeQuery}"`, clear: { query: "" } });
    if (staySearch.stayType !== "all") chips.push({ key: "type", label: staySearch.stayType === "hotel" ? "Hotels" : "Entire places", clear: { stayType: "all" } });
    if (staySearch.bedrooms) chips.push({ key: "bedrooms", label: `${staySearch.bedrooms}+ bedroom${staySearch.bedrooms === 1 ? "" : "s"}`, clear: { bedrooms: null } });
    if (staySearch.bathrooms) chips.push({ key: "bathrooms", label: `${staySearch.bathrooms}+ bathroom${staySearch.bathrooms === 1 ? "" : "s"}`, clear: { bathrooms: null } });
    if (staySearch.maxPrice) chips.push({ key: "maxPrice", label: `Up to ${formatAmount(staySearch.maxPrice)} a night`, clear: { maxPrice: null } });
    if (staySearch.minRating) chips.push({ key: "minRating", label: `${staySearch.minRating}+ rating`, clear: { minRating: null } });
    staySearch.features.forEach((feature) => chips.push({
      key: `feature-${feature}`,
      label: feature,
      clear: { features: staySearch.features.filter((activeFeature) => activeFeature !== feature) },
    }));
    return chips;
  }, [activeQuery, formatAmount, staySearch.bathrooms, staySearch.bedrooms, staySearch.features, staySearch.maxPrice, staySearch.minRating, staySearch.stayType]);
  const filterCount = filterChips.filter((chip) => chip.key !== "query" && chip.key !== "type").length;

  const clearAllFilters = () => {
    setLocation("/accommodations", { replace: true });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen pb-12 pt-6 md:pt-10">
        <div className="container mx-auto px-4 md:px-8">
          <div className="mb-6">
            <Skeleton className="mb-3 h-10 w-72" />
            <Skeleton className="h-5 w-96 max-w-full" />
          </div>
          <Skeleton className="mb-6 h-14 w-full rounded-2xl" />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-border/60">
                <Skeleton className="aspect-[4/3] w-full" />
                <div className="space-y-2 p-4">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const fewResults = filteredAccommodations.length > 0 && filteredAccommodations.length <= 3;

  return (
    <div className="min-h-screen pb-12 pt-6 md:pt-10">
      <div className="container mx-auto px-4 md:px-8">
        <header className="mb-6">
          <h1 className="font-serif text-2xl font-medium leading-tight sm:text-3xl md:text-4xl">
            Accommodation in Mombasa and Nyali
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            {stayTypeCounts.hotel > 0 ? "Hotels, villas" : "Villas"}, apartments and holiday homes along the Kenyan Coast. Add your dates to see the price for your whole stay.
          </p>
        </header>

        {/* The trip, adjustable right here: where, when and who. */}
        <section
          aria-label="Your trip"
          className="mb-4 grid divide-y divide-border/70 rounded-2xl border border-border/80 bg-background shadow-[0_12px_32px_-26px_rgba(15,23,42,0.45)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_auto] md:divide-x md:divide-y-0"
          data-testid="stay-trip-bar"
        >
          <DestinationInput
            value={staySearch.destination}
            areas={coastAreas}
            onCommit={(destination) => updateStaySearch({ destination })}
          />
          <div className="px-2 py-1">
            <DateRangePicker
              checkIn={staySearch.checkIn}
              checkOut={staySearch.checkOut}
              onChange={({ checkIn, checkOut }) => updateStaySearch({ checkIn, checkOut })}
              placeholder="Add dates"
              className="h-11 border-0 px-2 shadow-none"
              data-testid="input-results-dates"
            />
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-1">
            <span className="flex items-center gap-2 text-sm text-foreground" aria-live="polite" data-testid="text-results-guests">
              <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {staySearch.guests ? `${staySearch.guests} guest${staySearch.guests === 1 ? "" : "s"}` : "Any guests"}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-full"
                aria-label="One guest fewer"
                disabled={!staySearch.guests}
                onClick={() => updateStaySearch({ guests: staySearch.guests && staySearch.guests > 1 ? staySearch.guests - 1 : null })}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-full"
                aria-label="One guest more"
                onClick={() => updateStaySearch({ guests: (staySearch.guests ?? 0) + 1 })}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {stayTypeCounts.hotel > 0 ? (
            <div
              role="radiogroup"
              aria-label="Kind of stay"
              className="inline-flex max-w-full flex-wrap gap-1 rounded-full border border-border/60 bg-muted/30 p-1"
            >
              {stayTypeOptions.map((option) => {
                const active = staySearch.stayType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => updateStaySearch({ stayType: option.value })}
                    className={`min-h-11 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors sm:min-h-9 ${
                      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`button-stay-type-${option.value}`}
                  >
                    {option.label}
                    <span className="ml-1.5 text-xs text-muted-foreground">{stayTypeCounts[option.value]}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <Select value={staySearch.sort} onValueChange={(value) => updateStaySearch({ sort: value as StaySearchSort })}>
            <SelectTrigger className="h-11 w-auto min-w-[10rem] rounded-full" aria-label="Sort stays">
              <ArrowUpDown className="mr-2 h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="Sort stays" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recommended">Recommended</SelectItem>
              <SelectItem value="price-low">Lowest price</SelectItem>
              <SelectItem value="price-high">Highest price</SelectItem>
              <SelectItem value="rating">Top rated</SelectItem>
              <SelectItem value="capacity">Largest capacity</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-full"
            aria-expanded={filtersOpen}
            aria-controls="stay-filters"
            onClick={() => setFiltersOpen((open) => !open)}
            data-testid="button-stay-filters"
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters{filterCount ? ` (${filterCount})` : ""}
          </Button>
        </div>

        {filtersOpen ? (
          <div id="stay-filters" className="mb-5 space-y-3 rounded-2xl border border-border/60 bg-background/95 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <BedDouble className="h-3.5 w-3.5" />
                  Bedrooms
                </span>
                <Input
                  type="number"
                  min="1"
                  value={staySearch.bedrooms ?? ""}
                  onChange={(event) => updateNumberFilter("bedrooms", event.target.value)}
                  placeholder="Any"
                  className="h-11 rounded-full"
                  data-testid="input-stay-filter-bedrooms"
                />
              </label>
              <label className="space-y-1">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Bath className="h-3.5 w-3.5" />
                  Bathrooms
                </span>
                <Input
                  type="number"
                  min="1"
                  value={staySearch.bathrooms ?? ""}
                  onChange={(event) => updateNumberFilter("bathrooms", event.target.value)}
                  placeholder="Any"
                  className="h-11 rounded-full"
                  data-testid="input-stay-filter-bathrooms"
                />
              </label>
              <label className="space-y-1">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <WalletCards className="h-3.5 w-3.5" />
                  Max price
                </span>
                <MaxPriceInput
                  maxPriceUsd={staySearch.maxPrice}
                  onCommit={(maxPrice) => updateStaySearch({ maxPrice })}
                />
              </label>
              <label className="space-y-1">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Star className="h-3.5 w-3.5" />
                  Minimum rating
                </span>
                <Select value={staySearch.minRating ? String(staySearch.minRating) : "any"} onValueChange={(value) => updateNumberFilter("minRating", value === "any" ? "" : value)}>
                  <SelectTrigger className="h-11 rounded-full" data-testid="select-stay-filter-rating">
                    <SelectValue placeholder="Any rating" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any rating</SelectItem>
                    <SelectItem value="3">3+</SelectItem>
                    <SelectItem value="4">4+</SelectItem>
                    <SelectItem value="5">5</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableFeatureSuggestions.map((feature) => {
                const isActive = staySearch.features.includes(feature);
                return (
                  <button
                    key={feature}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => toggleFeature(feature)}
                    className={`min-h-9 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                    data-testid={`button-stay-feature-${feature.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    {feature}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <span data-testid="text-results-count">
            <span className="font-medium text-foreground">{filteredAccommodations.length}</span> stay{filteredAccommodations.length === 1 ? "" : "s"}
            {stayNights ? ` for ${stayNights} night${stayNights === 1 ? "" : "s"}` : ""}
          </span>
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => updateStaySearch(chip.clear)}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-3 text-sm text-foreground hover:border-primary/40"
              aria-label={`Remove ${chip.label}`}
            >
              {chip.label}
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ))}
          {hasTripFilters || activeQuery || staySearch.stayType !== "all" ? (
            <button type="button" onClick={clearAllFilters} className="min-h-9 px-1 font-medium text-primary underline-offset-4 hover:underline">
              Clear all
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredAccommodations.map((accommodation, index) => {
            const hotel = isHotelStay(accommodation);
            const hotelSummary = hotel ? summarizeHotelRooms(accommodation.roomTypes ?? []) : null;
            const kind = hotel
              ? accommodation.starRating ? `${accommodation.starRating}-star hotel` : "Hotel"
              : "Entire place";
            return (
              <ListingCard
                key={accommodation.id}
                href={`${getPublicListingPath("stay", accommodation.id, accommodation.title)}${staySearchSuffix}`}
                title={accommodation.title}
                media={accommodation}
                badge={getStayBadge(accommodation)}
                subtitle={`${kind} · ${getShortSeoLocation(accommodation.location)}`}
                details={hotelSummary
                  ? `${hotelSummary.roomTypeCount} room type${hotelSummary.roomTypeCount === 1 ? "" : "s"}${hotelSummary.largestRoom ? ` · rooms for up to ${hotelSummary.largestRoom}` : ""}`
                  : `${accommodation.bedrooms} bedroom${accommodation.bedrooms === 1 ? "" : "s"} · up to ${accommodation.maxOccupancy} guests`}
                extra={hotelSummary ? <MealPlanChips plans={hotelSummary.mealPlans} className="mt-1" /> : null}
                rating={accommodation.rating}
                reviewCount={accommodation.reviewCount}
                eagerImage={index < 4}
                price={hotel ? (
                  <>From <ListingPrice><CurrencyAmount amountUsd={accommodation.price} /></ListingPrice> a room a night</>
                ) : stayNights && stayNights > 0 ? (
                  <>
                    <ListingPrice>
                      <CurrencyAmount amountUsd={accommodation.price * stayNights} data-testid={`text-stay-total-${accommodation.id}`} />
                    </ListingPrice>{" "}
                    for {stayNights} night{stayNights === 1 ? "" : "s"} · {formatAmount(accommodation.price)} a night
                  </>
                ) : (
                  <><ListingPrice><CurrencyAmount amountUsd={accommodation.price} /></ListingPrice> a night</>
                )}
                data-testid={`card-accommodation-${accommodation.id}`}
              />
            );
          })}
          {/* A short list ends with a way to ask for more, not a dead end. */}
          {fewResults ? <CustomServiceCta source="stay-few-results" compact className="flex flex-col justify-center border-dashed border-primary/40 bg-primary/5" /> : null}
        </div>

        {accommodations && accommodations.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-lg text-muted-foreground">
              No stays are listed right now.
            </p>
            <CustomServiceCta source="stay-no-inventory" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        )}

        {accommodations && accommodations.length > 0 && filteredAccommodations.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-lg text-muted-foreground">
              No stays matched {activeQuery ? `"${activeQuery}"` : "your trip"}. Try other dates, fewer filters, or a nearby area.
            </p>
            <CustomServiceCta source="stay-no-results" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        ) : null}

        {filteredAccommodations.length > 3 ? <CustomServiceCta source="stay-bottom" className="mt-10" /> : null}
      </div>
    </div>
  );
}

/** The one thing worth a badge on a stay's photo, if it has one. */
function getStayBadge(stay: Stay) {
  const features = stay.features.map((feature) => feature.toLowerCase());
  const pick = stayBadgeFeatures.find((candidate) => features.some((feature) => feature.includes(candidate.match)));
  return pick?.label ?? null;
}

const stayBadgeFeatures = [
  { match: "beachfront", label: "Beachfront" },
  { match: "private pool", label: "Private pool" },
  { match: "ocean view", label: "Ocean view" },
  { match: "sea view", label: "Sea view" },
  { match: "pool", label: "Pool" },
];

/** Where to: typed, or picked from the Coast's areas; applied on Enter, on leaving the field, or on a pick. */
function DestinationInput({ value, areas, onCommit }: { value: string; areas: string[]; onCommit: (destination: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (next: string) => {
    const trimmed = next.trim();
    if (trimmed !== value) onCommit(trimmed);
  };

  return (
    <div className="relative px-2 py-1">
      <MapPin className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        list="stay-areas"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (areas.includes(event.target.value)) commit(event.target.value);
        }}
        onBlur={() => commit(text)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(text);
          }
        }}
        placeholder="Anywhere on the Coast"
        aria-label="Where"
        className="h-11 border-0 pl-9 shadow-none focus-visible:ring-1"
        data-testid="input-results-destination"
      />
      <datalist id="stay-areas">
        {areas.map((area) => <option key={area} value={area} />)}
      </datalist>
    </div>
  );
}
