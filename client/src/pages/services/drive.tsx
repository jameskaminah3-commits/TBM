import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CurrencyAmount } from "@/components/currency-amount";
import { Car, MapPin, Star } from "lucide-react";
import { filterCars, useConciergeSearch } from "@/lib/concierge-search";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { PublicReviewPreview } from "@/components/public-review-preview";
import { PremiumMediaGallery } from "@/components/premium-media-gallery";
import type { Car as CarType } from "@shared/schema";

function getLeadPrice(car: CarType) {
  const options = [
    car.priceWithDriverHourly ? { amount: car.priceWithDriverHourly, label: "hour chauffeur" } : null,
    car.pricePerDay ? { amount: car.pricePerDay, label: "day self-drive" } : null,
    { amount: car.priceWithDriver, label: "day chauffeur" },
  ].filter((value): value is { amount: number; label: string } => value !== null);

  return options.reduce((lowest, current) => (current.amount < lowest.amount ? current : lowest));
}

const detailChipClassName =
  "surface-subtle rounded-full border px-2.5 py-1 text-[11px] font-medium text-foreground/78 shadow-none";

function CarShowcaseCard({
  car,
  onOpen,
}: {
  car: CarType;
  onOpen: () => void;
}) {
  const leadPrice = getLeadPrice(car);

  return (
    <Card
      className="surface-card group relative overflow-hidden border shadow-[0_14px_36px_-24px_rgba(15,23,42,0.45)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_48px_-28px_rgba(15,23,42,0.52)]"
      data-testid={`card-service-${car.id}`}
    >
      <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/55 to-transparent opacity-80" />

      <div className="relative">
        <PremiumMediaGallery
          item={car}
          title={car.model}
          aspectClassName="aspect-[16/10]"
          zoomLabel="View car photo"
        />
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/10">
            <Car className="h-5 w-5 text-primary" strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-start justify-between gap-3">
              <h3 className="font-serif text-xl font-medium tracking-tight text-foreground">{car.model}</h3>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              <span>Rated {car.rating.toFixed(1)}/5 by verified guests</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span className="line-clamp-1">{car.location}</span>
            </div>
          </div>
        </div>

        <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">
          {car.description}
        </p>

        <PublicReviewPreview targetType="car" targetId={car.id} />

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className={detailChipClassName}>
            {car.transmission}
          </Badge>
          <Badge variant="secondary" className={detailChipClassName}>
            {car.seats} seats
          </Badge>
          {car.features.slice(0, 2).map((feature, idx) => (
            <Badge key={idx} variant="secondary" className={detailChipClassName}>
              {feature}
            </Badge>
          ))}
        </div>

        <div className="flex items-end justify-between border-t border-border/60 pt-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              From {leadPrice.label}
            </p>
            <CurrencyAmount
              amountUsd={leadPrice.amount}
              primaryClassName="mt-1 text-lg font-semibold tracking-tight text-foreground"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              <CurrencyAmount amountUsd={car.priceWithDriver} /> chauffeur per day
            </p>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {car.chauffeurZones.length > 0 ? <span>Zone pricing</span> : null}
            </div>
            {(car.pricePerDay || car.selfDriveMileageLimitKm) ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {car.pricePerDay ? (
                  <>
                    <CurrencyAmount amountUsd={car.pricePerDay} /> self-drive
                  </>
                ) : null}
                {car.pricePerDay && car.selfDriveMileageLimitKm ? " | " : null}
                {car.selfDriveMileageLimitKm ? `${car.selfDriveMileageLimitKm} km/day included` : null}
              </p>
            ) : null}
          </div>
          <Button
            className="rounded-full px-5"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            data-testid={`button-book-${car.id}`}
          >
            View Vehicle
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function DrivePage() {
  const [, setLocation] = useLocation();
  const { query, clearQuery } = useConciergeSearch();
  const { data: cars, isLoading, isError, error, refetch } = useQuery<CarType[]>({
    queryKey: ["/api/cars"],
  });

  const carListings = query ? filterCars(cars || [], query) : cars || [];

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
            <h1 className="font-serif text-2xl text-foreground">Drive services are not available right now</h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              {error instanceof Error ? error.message : "We could not load the latest drive services."}
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
    <div className="app-shell min-h-screen py-12">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mb-12">
          <h1 className="mb-4 font-serif text-3xl font-medium leading-tight sm:text-4xl md:text-5xl">
            Drive Services
          </h1>
          <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            Book chauffeur-driven rides first, with self-drive available only on cars that offer it.
          </p>
        </div>

        {query ? (
          <div className="surface-panel mb-6 flex flex-col gap-3 rounded-2xl border px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{carListings.length}</span> drive matches for "{query}"
            </p>
            <Button variant="ghost" className="h-9 self-start rounded-full px-4 md:self-auto" onClick={clearQuery}>
              Clear search
            </Button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {carListings.map((car) => (
            <CarShowcaseCard
              key={car.id}
              car={car}
              onOpen={() => setLocation(`/book/car/${car.id}`)}
            />
          ))}
        </div>

        {carListings.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-lg text-muted-foreground">
              {query ? `No drive services matched "${query}" yet.` : "No drive services available at the moment."}
            </p>
            <CustomServiceCta source="drive-no-results" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        )}

        {carListings.length > 0 ? <CustomServiceCta source="drive-bottom" className="mt-10" /> : null}
      </div>
    </div>
  );
}
