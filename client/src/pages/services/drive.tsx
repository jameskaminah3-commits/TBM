import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { CurrencyAmount } from "@/components/currency-amount";
import { filterCars, useConciergeSearch } from "@/lib/concierge-search";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { ListingCard, ListingPrice } from "@/components/listing-card";
import type { Car as CarType } from "@shared/schema";
import { getPublicListingPath, getShortSeoLocation } from "@/lib/public-listing";

type DriveMode = "driver" | "self" | "hourly";

// How a guest wants the car; each card then shows that one price.
// bookingMode is how the car's page and checkout name it (?mode=).
const driveModes: Array<{ value: DriveMode; label: string; unit: string; bookingMode: string }> = [
  { value: "driver", label: "With a driver", unit: "a day with a driver", bookingMode: "car-chauffeur-day" },
  { value: "self", label: "Self-drive", unit: "a day, self-drive", bookingMode: "car-self-drive-day" },
  { value: "hourly", label: "By the hour", unit: "an hour with a driver", bookingMode: "car-chauffeur-hourly" },
];

function priceForMode(car: CarType, mode: DriveMode) {
  const price = mode === "driver" ? car.priceWithDriver : mode === "self" ? car.pricePerDay : car.priceWithDriverHourly;
  return price && price > 0 ? price : null;
}

function readDriveMode(search: string): DriveMode {
  const mode = new URLSearchParams(search).get("mode");
  return mode === "self" || mode === "hourly" ? mode : "driver";
}

export default function DrivePage() {
  const [, setLocation] = useLocation();
  const { query, clearQuery } = useConciergeSearch();
  const { data: cars, isLoading, isError, error, refetch } = useQuery<CarType[]>({
    queryKey: ["/api/cars"],
  });

  const search = useSearch();
  const mode = readDriveMode(search);
  const matchedCars = query ? filterCars(cars || [], query) : cars || [];
  const carListings = matchedCars.filter((car) => priceForMode(car, mode) !== null);
  const modeCounts = Object.fromEntries(
    driveModes.map((option) => [option.value, matchedCars.filter((car) => priceForMode(car, option.value) !== null).length]),
  ) as Record<DriveMode, number>;
  const modeOption = driveModes.find((option) => option.value === mode) ?? driveModes[0];
  const modeUnit = modeOption.unit;
  const setMode = (next: DriveMode) => {
    const params = new URLSearchParams(search);
    if (next === "driver") params.delete("mode");
    else params.set("mode", next);
    const nextSearch = params.toString();
    setLocation(`/services/drive${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
  };

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
    <div className="app-shell min-h-screen pb-12 pt-6 md:pt-10">
      <div className="container mx-auto px-4 md:px-8">
        <header className="mb-6">
          <h1 className="font-serif text-2xl font-medium leading-tight sm:text-3xl md:text-4xl">
            Car Hire and Chauffeur Service in Mombasa
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            A driver for the day, a car to drive yourself, or a ride by the hour: airport and SGR pickups, days out and getting around Mombasa, Nyali, Diani and beyond.
          </p>
        </header>

        <div
          role="radiogroup"
          aria-label="How you want the car"
          className="mb-4 grid w-full grid-cols-3 gap-1 rounded-full border border-border/60 bg-muted/30 p-1 sm:inline-flex sm:w-auto"
        >
          {driveModes.map((option) => {
            const active = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(option.value)}
                className={`min-h-11 whitespace-nowrap rounded-full px-2 py-1.5 text-sm font-medium transition-colors sm:px-4 ${
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`button-drive-mode-${option.value}`}
              >
                {option.label}
                <span className="ml-1.5 hidden text-xs text-muted-foreground sm:inline">{modeCounts[option.value]}</span>
              </button>
            );
          })}
        </div>

        {query ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{carListings.length}</span> car{carListings.length === 1 ? "" : "s"} for "{query}"
            </span>
            <button type="button" onClick={clearQuery} className="min-h-9 px-1 font-medium text-primary underline-offset-4 hover:underline">
              Clear search
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {carListings.map((car, index) => {
            const title = `${car.make ? `${car.make} ` : ""}${car.model}`;
            const price = priceForMode(car, mode) ?? 0;
            return (
              <ListingCard
                key={car.id}
                href={`${getPublicListingPath("car", car.id, title)}?mode=${modeOption.bookingMode}`}
                title={title}
                media={car}
                subtitle={[`${car.seats} seats`, car.transmission, car.fuelType].filter(Boolean).join(" · ")}
                details={`Based in ${getShortSeoLocation(car.location)}`}
                rating={car.rating}
                reviewCount={car.reviewCount}
                eagerImage={index < 3}
                price={(
                  <>
                    <ListingPrice><CurrencyAmount amountUsd={price} /></ListingPrice> {modeUnit}
                    {mode === "self" && car.selfDriveMileageLimitKm ? ` · ${car.selfDriveMileageLimitKm} km a day included` : ""}
                  </>
                )}
                data-testid={`card-service-${car.id}`}
              />
            );
          })}
        </div>

        {carListings.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-lg text-muted-foreground">
              {query
                ? `No cars matched "${query}" ${mode === "driver" ? "with a driver" : mode === "self" ? "for self-drive" : "by the hour"} yet.`
                : `No cars are listed ${mode === "driver" ? "with a driver" : mode === "self" ? "for self-drive" : "by the hour"} right now.`}
            </p>
            <CustomServiceCta source="drive-no-results" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        )}

        {carListings.length > 0 ? <CustomServiceCta source="drive-bottom" className="mt-10" /> : null}
      </div>
    </div>
  );
}
