import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { CalendarDays, ConciergeBell, MapPin, Search, Star, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ListingMedia } from "@/components/listing-media";
import { CurrencyAmount } from "@/components/currency-amount";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { filterStays } from "@/lib/concierge-search";
import {
  buildStaySearchParams,
  formatStaySearchDate,
  getStaySearchNights,
  hasStructuredStayFilters,
  matchesStayDestination,
  readStaySearchState,
} from "@/lib/stay-search";
import type { Stay } from "@shared/schema";

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
  });

  const textMatchedAccommodations = useMemo(
    () => (activeQuery ? filterStays(accommodations || [], activeQuery) : accommodations || []),
    [accommodations, activeQuery],
  );

  const filteredAccommodations = useMemo(
    () => textMatchedAccommodations.filter((stay) => {
      const matchesDestination = !staySearch.destination || matchesStayDestination(stay.location, staySearch.destination);
      const matchesGuests = staySearch.guests === null || stay.maxOccupancy >= staySearch.guests;
      return matchesDestination && matchesGuests;
    }),
    [staySearch.destination, staySearch.guests, textMatchedAccommodations],
  );

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

    return chips;
  }, [stayNights, staySearch.checkIn, staySearch.checkOut, staySearch.destination, staySearch.guests]);

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
                <Skeleton className="w-full aspect-[4/3]" />
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredAccommodations.map((accommodation) => (
            <Card
              key={accommodation.id}
              className="group overflow-hidden border-border/60 bg-gradient-to-b from-background via-background to-muted/20 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.5)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_70px_-32px_rgba(15,23,42,0.65)]"
              data-testid={`card-accommodation-${accommodation.id}`}
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <ListingMedia
                  src={accommodation.imageUrl || "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800"}
                  alt={accommodation.title}
                  mediaType={accommodation.mediaType}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
              
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
