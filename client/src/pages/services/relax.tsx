import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListingMedia } from "@/components/listing-media";
import { CurrencyAmount } from "@/components/currency-amount";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { PublicReviewPreview } from "@/components/public-review-preview";
import { MapPin, ShoppingBag, Star } from "lucide-react";
import { filterErrands, useConciergeSearch } from "@/lib/concierge-search";
import type { Errand } from "@shared/schema";

export default function RelaxPage() {
  const [, setLocation] = useLocation();
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
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mb-12">
          <h1 className="mb-4 font-serif text-3xl font-medium leading-tight sm:text-4xl md:text-5xl">
            Relax Services
          </h1>
          <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            Let us handle the errands. Shopping, fridge stocking, and personal assistance services.
          </p>
        </div>

        {query ? (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{errandListings.length}</span> concierge matches for "{query}"
            </p>
            <Button variant="ghost" className="h-9 self-start rounded-full px-4 md:self-auto" onClick={clearQuery}>
              Clear search
            </Button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {errandListings.map((errand) => (
            <Card
              key={errand.id}
              className="group cursor-pointer overflow-hidden border-border/60 bg-gradient-to-b from-background via-background to-muted/10 shadow-[0_14px_34px_-24px_rgba(15,23,42,0.42)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_44px_-28px_rgba(15,23,42,0.55)]"
              data-testid={`card-service-${errand.id}`}
            >
              {errand.imageUrl && (
                <div className="aspect-[16/10] overflow-hidden bg-muted">
                  <ListingMedia
                    src={errand.imageUrl}
                    alt={errand.serviceName}
                    mediaType={errand.mediaType}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div className="p-4">
                <div className="mb-3 flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <ShoppingBag className="h-5 w-5 text-primary" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1">
                    <h3 className="mb-1 font-serif text-xl font-medium tracking-tight">{errand.serviceName}</h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                      <span>Rated {errand.rating.toFixed(1)}/5 by verified guests</span>
                    </div>
                  </div>
                </div>

                <p className="mb-3 line-clamp-2 text-sm leading-5 text-muted-foreground">
                  {errand.description}
                </p>

                <PublicReviewPreview targetType="errand" targetId={errand.id} />

                {errand.location ? (
                  <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span>{errand.location}</span>
                  </div>
                ) : null}

                <div className="mb-3 flex flex-wrap gap-2">
                  {errand.features.slice(0, 3).map((feature, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                  {errand.features.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{errand.features.length - 3} more
                    </Badge>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-border/60 pt-3">
                  <div>
                    <CurrencyAmount
                      amountUsd={errand.basePrice}
                      primaryClassName="text-lg font-semibold tracking-tight"
                    />
                    <p className="text-sm text-muted-foreground">base service fee</p>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {errand.shoppingEnabled ? (
                        <div>Shopping: budget + {errand.shoppingCommissionPercent}% service charge</div>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    className="rounded-full px-5"
                    onClick={() => setLocation(`/book/errand/${errand.id}`)}
                    data-testid={`button-book-${errand.id}`}
                  >
                    Book Now
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {errandListings.length === 0 && (
          <div className="text-center py-12">
            <p className="text-lg text-muted-foreground">
              {query ? `No concierge services matched "${query}" yet.` : "No relax services available at the moment."}
            </p>
            <CustomServiceCta source="relax-no-results" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        )}

        {errandListings.length > 0 ? <CustomServiceCta source="relax-bottom" className="mt-10" /> : null}
      </div>
    </div>
  );
}
