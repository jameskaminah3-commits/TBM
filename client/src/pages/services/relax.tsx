import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CurrencyAmount } from "@/components/currency-amount";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { ListingCard, ListingPrice } from "@/components/listing-card";
import { filterErrands, useConciergeSearch } from "@/lib/concierge-search";
import { HELP_MAMA_HOURLY_MINIMUM_HOURS, HOUSE_CLEANING_BASE_ROOM_LABEL, getHelpMamaRateOptions, getHelpMamaStartingPrice, hasHelpMamaPricing } from "@shared/errand-pricing";
import type { Errand } from "@shared/schema";
import { getPublicListingPath, getShortSeoLocation } from "@/lib/public-listing";

/** What an errand is, in one word for its card: the first thing it does. */
function errandKind(errand: Errand) {
  if (hasHelpMamaPricing(errand)) return "Childcare";
  if (errand.shoppingEnabled) return "Shopping";
  if (errand.laundryEnabled) return "Laundry";
  if (errand.houseCleaningEnabled) return "Cleaning";
  return null;
}

export default function RelaxPage() {
  const { query, clearQuery } = useConciergeSearch();
  const { data: errands, isLoading, isError, error, refetch } = useQuery<Errand[]>({
    queryKey: ["/api/errands"],
  });

  const errandListings = query ? filterErrands(errands || [], query) : errands || [];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background py-12">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center py-20">
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
            <h1 className="font-serif text-2xl text-foreground">Relax services are not available right now</h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              {error instanceof Error ? error.message : "We could not load the latest errand services."}
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
            Concierge and Errand Services in Mombasa
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            Groceries waiting when you arrive, laundry, cleaning, and a nanny for the children, in Mombasa, Nyali and along the Kenyan Coast.
          </p>
        </header>

        {query ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{errandListings.length}</span> service{errandListings.length === 1 ? "" : "s"} for "{query}"
            </span>
            <button type="button" onClick={clearQuery} className="min-h-9 px-1 font-medium text-primary underline-offset-4 hover:underline">
              Clear search
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {errandListings.map((errand, index) => {
            const usesHelpMamaPricing = hasHelpMamaPricing(errand);
            const displayPrice = usesHelpMamaPricing ? getHelpMamaStartingPrice(errand.helpMamaPricing) : errand.basePrice;
            // The cheapest care option, with its unit: "an hour, 3-hour minimum".
            const cheapestCare = usesHelpMamaPricing
              ? getHelpMamaRateOptions(errand.helpMamaPricing).find((option) => option.price === displayPrice)
              : undefined;
            const priceLabel = cheapestCare
              ? cheapestCare.unit === "hour"
                ? `an hour, ${HELP_MAMA_HOURLY_MINIMUM_HOURS}-hour minimum`
                : `a ${cheapestCare.unit}`
              : errand.houseCleaningEnabled && !errand.shoppingEnabled && !errand.laundryEnabled
                ? `for a ${HOUSE_CLEANING_BASE_ROOM_LABEL} clean`
              : errand.laundryEnabled && !errand.shoppingEnabled
                ? "a laundry pickup"
                : errand.shoppingEnabled
                  ? "a shopping trip"
                  : "a visit";
            // What changes the price, in one line.
            const priceRule = usesHelpMamaPricing
              ? "Daytime, evening and overnight care"
              : errand.shoppingEnabled
                ? `Plus the shopping, and ${errand.shoppingCommissionPercent}% for buying and delivery`
                : errand.houseCleaningEnabled
                  ? "The price depends on the number of bedrooms"
                  : errand.laundryEnabled
                    ? "Picked up and brought back"
                    : null;
            return (
              <ListingCard
                key={errand.id}
                href={getPublicListingPath("errand", errand.id, errand.serviceName)}
                title={errand.serviceName}
                media={errand}
                badge={errandKind(errand)}
                subtitle={errand.location ? getShortSeoLocation(errand.location) : "Along the Coast"}
                details={priceRule}
                rating={errand.rating}
                reviewCount={errand.reviewCount}
                eagerImage={index < 3}
                price={(
                  <>
                    {usesHelpMamaPricing ? "From " : ""}<ListingPrice><CurrencyAmount amountUsd={displayPrice} /></ListingPrice> {priceLabel}
                  </>
                )}
                data-testid={`card-service-${errand.id}`}
              />
            );
          })}
        </div>

        {errandListings.length === 0 && (
          <div className="text-center py-12">
            <p className="text-lg text-muted-foreground">
              {query ? `No services matched "${query}" yet.` : "No services are listed right now."}
            </p>
            <CustomServiceCta source="relax-no-results" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        )}

        {errandListings.length > 0 ? <CustomServiceCta source="relax-bottom" className="mt-10" /> : null}
      </div>
    </div>
  );
}
