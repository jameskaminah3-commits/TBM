import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ArrowUpDown, Bath, BedDouble, CalendarDays, ConciergeBell, MapPin, Search, SlidersHorizontal, Star, Users, WalletCards } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StayMediaCarousel } from "@/components/stay-media-carousel";
import { CurrencyAmount } from "@/components/currency-amount";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { filterStays, getMeaningfulTokens, normalizeConciergeQuery } from "@/lib/concierge-search";
import {
  buildStaySearchParams,
  formatStaySearchDate,
  getStaySearchNights,
  hasStructuredStayFilters,
  matchesStayDestination,
  readStaySearchState,
  type StaySearchSort,
} from "@/lib/stay-search";
import type { Stay } from "@shared/schema";

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

function sortStays(stays: Stay[], sort: StaySearchSort, query: string) {
  return [...stays].sort((left, right) => {
    if (sort === "price-low") return left.price - right.price;
    if (sort === "price-high") return right.price - left.price;
    if (sort === "rating") return right.rating - left.rating || right.reviewCount - left.reviewCount;
    if (sort === "capacity") return right.maxOccupancy - left.maxOccupancy || left.price - right.price;

    const relevanceDelta = scoreStayRelevance(right, query) - scoreStayRelevance(left, query);
    return relevanceDelta || right.rating - left.rating || right.reviewCount - left.reviewCount || left.price - right.price;
  });
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
  
  const { data: accommodations, isLoading } = useQuery<Stay[]>({
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
      const matchesDestination = !staySearch.destination || matchesStayDestination(stay.location, staySearch.destination);
      const matchesGuests = staySearch.guests === null || stay.maxOccupancy >= staySearch.guests;
      const matchesBedrooms = staySearch.bedrooms === null || stay.bedrooms >= staySearch.bedrooms;
      const matchesBathrooms = staySearch.bathrooms === null || stay.bathrooms >= staySearch.bathrooms;
      const matchesPrice = staySearch.maxPrice === null || stay.price <= staySearch.maxPrice;
      const matchesRating = staySearch.minRating === null || stay.rating >= staySearch.minRating;
      const matchesFeatures = staySearch.features.every((feature) => matchesStayFeature(stay, feature));

      return matchesDestination && matchesGuests && matchesBedrooms && matchesBathrooms && matchesPrice && matchesRating && matchesFeatures;
    });

      return sortStays(nextStays, staySearch.sort, activeQuery);
    },
    [activeQuery, staySearch.bathrooms, staySearch.bedrooms, staySearch.destination, staySearch.features, staySearch.guests, staySearch.maxPrice, staySearch.minRating, staySearch.sort, textMatchedAccommodations],
  );

  const availableFeatureSuggestions = useMemo(() => {
    const matchedSuggestions = featureSuggestions.filter((feature) => {
      return (accommodations || []).some((stay) => matchesStayFeature(stay, feature));
    });

    return matchedSuggestions.length ? matchedSuggestions : featureSuggestions;
  }, [accommodations]);

  const updateStaySearch = (updates: Partial<typeof staySearch>) => {
    const nextSearch = buildStaySearchParams({ ...staySearch, ...updates });
    setLocation(nextSearch ? `/accommodations?${nextSearch}` : "/accommodations");
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

  const searchChips = useMemo(() => {
    const chips: string[] = [];

    if (staySearch.destination) {
      chips.push(staySearch.destination);
    }

    if (staySearch.checkIn && staySearch.checkOut) {
      const rangeLabel = `${formatStaySearchDate(staySearch.checkIn)} - ${formatStaySearchDate(staySearch.checkOut)}`;
      chips.push(stayNights ? `${rangeLabel} · ${stayNights} night${stayNights === 1 ? "" : "s"}` : rangeLabel);
    } else if (staySearch.checkIn) {
      chips.push(`Check in ${formatStaySearchDate(staySearch.checkIn)}`);
    } else if (staySearch.checkOut) {
      chips.push(`Check out ${formatStaySearchDate(staySearch.checkOut)}`);
    }

    if (staySearch.guests) {
      chips.push(`${staySearch.guests} guest${staySearch.guests === 1 ? "" : "s"}`);
    }

    if (staySearch.bedrooms) {
      chips.push(`${staySearch.bedrooms}+ bedroom${staySearch.bedrooms === 1 ? "" : "s"}`);
    }

    if (staySearch.bathrooms) {
      chips.push(`${staySearch.bathrooms}+ bathroom${staySearch.bathrooms === 1 ? "" : "s"}`);
    }

    if (staySearch.maxPrice) {
      chips.push(`Up to $${staySearch.maxPrice}/day`);
    }

    if (staySearch.minRating) {
      chips.push(`${staySearch.minRating}+ rating`);
    }

    staySearch.features.forEach((feature) => chips.push(feature));

    return chips;
  }, [stayNights, staySearch.bathrooms, staySearch.bedrooms, staySearch.checkIn, staySearch.checkOut, staySearch.destination, staySearch.features, staySearch.guests, staySearch.maxPrice, staySearch.minRating]);

  const clearAllFilters = () => {
    setLocation("/accommodations");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4 md:px-8">
          <div className="mb-12">
            <Skeleton className="h-12 w-64 mb-4" />
            <Skeleton className="h-6 w-96" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="w-full aspect-[16/10]" />
                <div className="p-4 space-y-3">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mb-12">
          <h1 className="mb-4 font-serif text-3xl font-medium leading-tight sm:text-4xl md:text-5xl">
            Luxury Accommodations
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Discover exceptional stays in the world's most desirable destinations
          </p>
        </div>

        {activeQuery || hasTripFilters ? (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Showing <span className="font-medium text-foreground">{filteredAccommodations.length}</span> stay match{filteredAccommodations.length === 1 ? "" : "es"}
                {activeQuery && !hasTripFilters ? (
                  <>
                    {" "}for <span className="font-medium text-foreground">"{activeQuery}"</span>
                  </>
                ) : null}
              </p>
              <div className="flex flex-wrap gap-2">
                {activeQuery && !hasTripFilters ? (
                  <Badge variant="secondary" className="gap-1 rounded-full px-3 py-1">
                    <Search className="h-3.5 w-3.5" />
                    {activeQuery}
                  </Badge>
                ) : null}
                {searchChips.map((chip) => (
                  <Badge key={chip} variant="secondary" className="rounded-full px-3 py-1">
                    {chip}
                  </Badge>
                ))}
              </div>
              {staySearch.checkIn || staySearch.checkOut ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Selected trip dates carry through to the stay detail and booking flow.
                </p>
              ) : null}
            </div>
            <Button variant="ghost" className="h-9 self-start rounded-full px-4 md:self-auto" onClick={clearAllFilters}>
              Clear search
            </Button>
          </div>
        ) : null}

        {accommodations && accommodations.length > 0 ? (
          <details
            className="mb-5 rounded-xl border border-border/60 bg-background/95 p-3 shadow-[0_16px_42px_-36px_rgba(15,23,42,0.34)]"
            open={hasTripFilters}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold leading-6 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Filters
              </span>
              <span className="text-xs font-medium text-muted-foreground">Show options</span>
            </summary>

            <div className="mt-3 flex flex-col gap-3">
              <div className="w-full md:w-52">
                <Select value={staySearch.sort} onValueChange={(value) => updateStaySearch({ sort: value as StaySearchSort })}>
                  <SelectTrigger className="h-9 rounded-full" aria-label="Sort stays">
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
              </div>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                <label className="space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    Guests
                  </span>
                  <Input
                    type="number"
                    min="1"
                    value={staySearch.guests ?? ""}
                    onChange={(event) => updateNumberFilter("guests", event.target.value)}
                    placeholder="Any"
                    className="h-9 rounded-full"
                    data-testid="input-stay-filter-guests"
                  />
                </label>

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
                    className="h-9 rounded-full"
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
                    className="h-9 rounded-full"
                    data-testid="input-stay-filter-bathrooms"
                  />
                </label>

                <label className="space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <WalletCards className="h-3.5 w-3.5" />
                    Max price
                  </span>
                  <Input
                    type="number"
                    min="1"
                    value={staySearch.maxPrice ?? ""}
                    onChange={(event) => updateNumberFilter("maxPrice", event.target.value)}
                    placeholder="USD / day"
                    className="h-9 rounded-full"
                    data-testid="input-stay-filter-max-price"
                  />
                </label>

                <label className="space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Star className="h-3.5 w-3.5" />
                    Minimum rating
                  </span>
                  <Select value={staySearch.minRating ? String(staySearch.minRating) : "any"} onValueChange={(value) => updateNumberFilter("minRating", value === "any" ? "" : value)}>
                    <SelectTrigger className="h-9 rounded-full" data-testid="select-stay-filter-rating">
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

              <div className="flex flex-wrap gap-1.5">
                {availableFeatureSuggestions.map((feature) => {
                  const isActive = staySearch.features.includes(feature);
                  return (
                    <button
                      key={feature}
                      type="button"
                      onClick={() => toggleFeature(feature)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
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
          </details>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredAccommodations.map((accommodation, index) => (
            <Card
              key={accommodation.id}
              className="group overflow-hidden border-border/60 bg-gradient-to-b from-background via-background to-muted/20 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.5)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_70px_-32px_rgba(15,23,42,0.65)]"
              data-testid={`card-accommodation-${accommodation.id}`}
            >
              <StayMediaCarousel
                stay={accommodation}
                aspectClassName="aspect-[16/10]"
                containerClassName="relative overflow-hidden bg-muted"
                imageClassName="transition-transform duration-500 group-hover:scale-[1.03]"
                eagerFirstImage={index < 4}
                showArrows={false}
              />
              
              <div className="p-5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-serif text-xl font-medium leading-tight line-clamp-2">
                    {accommodation.title}
                  </h3>
                </div>

                <div className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
                  <MapPin className="h-4 w-4" />
                  <span className="line-clamp-1">{accommodation.location}</span>
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    <span>Rated {accommodation.rating.toFixed(1)}/5</span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>Up to {accommodation.maxOccupancy}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {accommodation.features.slice(0, 3).map((feature, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                  {accommodation.features.length > 3 && (
                    <Badge variant="secondary" className="text-xs">
                      +{accommodation.features.length - 3} more
                    </Badge>
                  )}
                </div>

                <div className="flex flex-col gap-3 border-t border-border/60 pt-4 min-[460px]:flex-row min-[460px]:items-center min-[460px]:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <ConciergeBell className="h-4 w-4" />
                    </span>
                    <span className="text-sm text-muted-foreground">Curated stay</span>
                  </div>
                  <div className="flex flex-col gap-3 min-[460px]:items-end">
                    <div className="text-right">
                      <CurrencyAmount
                        amountUsd={accommodation.price}
                        primaryClassName="text-lg font-semibold tracking-tight"
                      />
                      <div className="text-xs text-muted-foreground">per day</div>
                    </div>
                    <Button
                      className="w-full rounded-full px-5 min-[460px]:w-auto"
                      onClick={() => setLocation(`/accommodation/${accommodation.id}${staySearchSuffix}`)}
                      data-testid={`button-view-stay-${accommodation.id}`}
                    >
                      View Stay
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {accommodations && accommodations.length === 0 && (
          <div className="text-center py-20">
            <p className="text-lg text-muted-foreground">
              No accommodations found. Please adjust your search criteria.
            </p>
            <CustomServiceCta source="stay-no-inventory" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        )}

        {accommodations && accommodations.length > 0 && filteredAccommodations.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-lg text-muted-foreground">
              No stays matched {activeQuery ? `"${activeQuery}"` : "your current trip filters"}. Try a different location, broader guest count, or clear the search.
            </p>
            <CustomServiceCta source="stay-no-results" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        ) : null}

        {filteredAccommodations.length > 0 ? <CustomServiceCta source="stay-bottom" className="mt-10" /> : null}
      </div>
    </div>
  );
}
