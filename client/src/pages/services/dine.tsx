import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CurrencyAmount } from "@/components/currency-amount";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { PublicReviewPreview } from "@/components/public-review-preview";
import { useCurrency } from "@/lib/currency";
import { ChefHat, Clock, MapPin, Star, Users, Utensils } from "lucide-react";
import {
  getCookCustomMenuRequestFee,
  getCookMinimumGuests,
  getCookServiceFee,
} from "@shared/cook-pricing";
import { filterCooks, useConciergeSearch } from "@/lib/concierge-search";
import { PremiumMediaGallery } from "@/components/premium-media-gallery";
import type { Cook } from "@shared/schema";

function CookCard({
  cook,
  onOpen,
  usdToKes,
}: {
  cook: Cook;
  onOpen: () => void;
  usdToKes: number;
}) {
  return (
    <Card
      className="group overflow-hidden border-border/60 bg-gradient-to-b from-background via-background to-muted/10 shadow-[0_14px_34px_-24px_rgba(15,23,42,0.42)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_44px_-28px_rgba(15,23,42,0.55)]"
      data-testid={`card-service-${cook.id}`}
    >
      <PremiumMediaGallery
        item={cook}
        title={cook.title}
        aspectClassName="aspect-[16/10]"
        zoomLabel="View chef photo"
      />

      <div className="p-4">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <ChefHat className="h-5 w-5 text-primary" strokeWidth={1.5} />
          </div>
          <div className="flex-1">
            <h3 className="mb-1 font-serif text-xl font-medium tracking-tight">{cook.title}</h3>
            <div className="mb-1.5 flex items-center gap-2 text-sm text-muted-foreground">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              <span>Rated {cook.rating.toFixed(1)}/5 by verified guests</span>
            </div>
            <Badge variant="secondary" className="text-xs capitalize">
              <Utensils className="mr-1 h-3 w-3" />
              {cook.speciality}
            </Badge>
            <p className="mt-1 text-sm font-medium text-foreground">{cook.serviceType}</p>
          </div>
        </div>

        <p className="mb-3 line-clamp-2 text-sm leading-5 text-muted-foreground">
          {cook.description}
        </p>

        <PublicReviewPreview targetType="cook" targetId={cook.id} />

        <div className="mb-3 flex flex-wrap gap-2">
          {cook.features.slice(0, 2).map((feature, idx) => (
            <Badge key={idx} variant="outline" className="text-xs">
              {feature}
            </Badge>
          ))}
          {cook.customMenuEnabled ? (
            <Badge variant="outline" className="text-xs">
              Custom menu available
            </Badge>
          ) : null}
          {cook.features.length > 2 ? (
            <Badge variant="outline" className="text-xs">
              +{cook.features.length - 2} more
            </Badge>
          ) : null}
        </div>

        <div className="mb-2.5 flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span>Custom scheduling available</span>
        </div>

        <div className="mb-2.5 flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <span>{cook.location}</span>
        </div>

        <div className="mb-3 flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span>Minimum {getCookMinimumGuests(cook)} {getCookMinimumGuests(cook) === 1 ? "guest" : "guests"}</span>
        </div>

        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CurrencyAmount
                amountUsd={getCookServiceFee(cook)}
                primaryClassName="text-lg font-semibold tracking-tight"
              />
              <p className="text-sm text-muted-foreground">
                base package per day for {getCookMinimumGuests(cook)} guests
              </p>
              {cook.customMenuEnabled ? (
                <p className="text-sm text-muted-foreground">
                  Custom menu request from <CurrencyAmount amountUsd={getCookCustomMenuRequestFee(cook, usdToKes)} />
                </p>
              ) : null}
            </div>
            <div className="text-right text-sm font-medium text-primary">
              <Button
                className="rounded-full px-5"
                onClick={onOpen}
                data-testid={`button-view-cook-${cook.id}`}
              >
                View Details
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function DinePage() {
  const [, setLocation] = useLocation();
  const { usdToKes } = useCurrency();
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
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mb-12">
          <h1 className="mb-4 font-serif text-3xl font-medium leading-tight sm:text-4xl md:text-5xl">
            Dine Services
          </h1>
          <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            Experience gourmet dining with our expert personal chefs. Custom menus tailored to your taste.
          </p>
        </div>

        {query ? (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{cookListings.length}</span> chef matches for "{query}"
            </p>
            <Button variant="ghost" className="h-9 self-start rounded-full px-4 md:self-auto" onClick={clearQuery}>
              Clear search
            </Button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {cookListings.map((cook) => (
            <CookCard
              key={cook.id}
              cook={cook}
              usdToKes={usdToKes}
              onOpen={() => setLocation(`/book/cook/${cook.id}`)}
            />
          ))}
        </div>

        {cookListings.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-lg text-muted-foreground">
              {query ? `No chefs matched "${query}" yet.` : "No dine services available at the moment."}
            </p>
            <CustomServiceCta source="dine-no-results" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        ) : null}

        {cookListings.length > 0 ? <CustomServiceCta source="dine-bottom" className="mt-10" /> : null}
      </div>
    </div>
  );
}
