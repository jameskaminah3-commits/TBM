import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CurrencyAmount } from "@/components/currency-amount";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { ListingCard, ListingPrice } from "@/components/listing-card";
import { getCookMinimumGuests, getCookServiceFee } from "@shared/cook-pricing";
import { filterCooks, useConciergeSearch } from "@/lib/concierge-search";
import type { Cook } from "@shared/schema";
import { getPublicListingPath, getShortSeoLocation } from "@/lib/public-listing";

export default function DinePage() {
  const { query, clearQuery } = useConciergeSearch();
  const { data: cooks, isLoading, isError, error, refetch } = useQuery<Cook[]>({
    queryKey: ["/api/cooks"],
  });

  const cookListings = query ? filterCooks(cooks || [], query) : cooks || [];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background py-12">
        <div className="container mx-auto px-4 md:px-8">
          <div className="py-20 text-center">
            <p className="text-lg text-muted-foreground">Loading services...</p>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4 md:px-8">
          <div className="rounded-[1.75rem] border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
            <h1 className="font-serif text-2xl text-foreground">Dine services are not available right now</h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              {error instanceof Error ? error.message : "We could not load the latest chef services."}
            </p>
            <Button className="mt-5 rounded-full px-5" onClick={() => refetch()}>
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen pb-12 pt-6 md:pt-10">
      <div className="container mx-auto px-4 md:px-8">
        <header className="mb-6">
          <h1 className="font-serif text-2xl font-medium leading-tight sm:text-3xl md:text-4xl">
            Private Chefs and In-Villa Dining in Mombasa
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            A private chef who cooks at your villa or apartment, with or without the shopping, in Mombasa, Nyali and along the Kenyan Coast.
          </p>
        </header>

        {query ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{cookListings.length}</span> chef{cookListings.length === 1 ? "" : "s"} for "{query}"
            </span>
            <button type="button" onClick={clearQuery} className="min-h-9 px-1 font-medium text-primary underline-offset-4 hover:underline">
              Clear search
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cookListings.map((cook, index) => {
            const minimumGuests = getCookMinimumGuests(cook);
            return (
              <ListingCard
                key={cook.id}
                href={getPublicListingPath("cook", cook.id, cook.title)}
                title={cook.title}
                media={cook}
                badge={cook.speciality || null}
                subtitle={`${cook.serviceType} · ${getShortSeoLocation(cook.location)}`}
                details={cook.maxGuests > minimumGuests ? `Cooks for ${minimumGuests} to ${cook.maxGuests} guests` : `Cooks for up to ${minimumGuests} guests`}
                rating={cook.rating}
                reviewCount={cook.reviewCount}
                eagerImage={index < 3}
                price={(
                  <>
                    <ListingPrice><CurrencyAmount amountUsd={getCookServiceFee(cook)} /></ListingPrice> a day for up to {minimumGuests} guests
                  </>
                )}
                data-testid={`card-service-${cook.id}`}
              />
            );
          })}
        </div>

        {cookListings.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-lg text-muted-foreground">
              {query ? `No chefs matched "${query}" yet.` : "No chefs are listed right now."}
            </p>
            <CustomServiceCta source="dine-no-results" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        ) : null}

        {cookListings.length > 0 ? <CustomServiceCta source="dine-bottom" className="mt-10" /> : null}
      </div>
    </div>
  );
}
