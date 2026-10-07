import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CurrencyAmount } from "@/components/currency-amount";
import { filterExperiences, useConciergeSearch } from "@/lib/concierge-search";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { ListingCard, ListingPrice } from "@/components/listing-card";
import type { Experience } from "@shared/schema";
import { getPublicListingPath, getShortSeoLocation } from "@/lib/public-listing";

/** "Half a day", "3 hours": how long it takes, as guests say it. */
function describeDuration(hours: number) {
  if (hours >= 8) return "A full day";
  if (hours === 1) return "1 hour";
  return `${hours} hours`;
}

function getLowestExperiencePrice(experience: Experience) {
  const prices = [
    experience.privateEnabled && experience.privatePricePerPerson > 0 ? experience.privatePricePerPerson : null,
    experience.sharedEnabled && experience.sharedPricePerPerson > 0 ? experience.sharedPricePerPerson : null,
  ].filter((value): value is number => value !== null);

  return prices.length ? Math.min(...prices) : experience.price;
}

export default function ExperiencePage() {
  const { query, clearQuery } = useConciergeSearch();
  const { data: experiences = [], isLoading, isError, error, refetch } = useQuery<Experience[]>({
    queryKey: ["/api/experiences"],
  });
  const filteredExperiences = query ? filterExperiences(experiences, query) : experiences;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background py-12">
        <div className="container mx-auto px-4 md:px-8">
          <div className="py-20 text-center">
            <p className="text-lg text-muted-foreground">Loading experiences...</p>
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
            <h1 className="font-serif text-2xl text-foreground">Experiences are not available right now</h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              {error instanceof Error ? error.message : "We could not load the latest experiences."}
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
            Coastal Experiences from Mombasa
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            Days on the water, old towns, forests and food, from Mombasa, Nyali, Diani and along the Kenyan Coast. Book them on their own or with your stay.
          </p>
        </header>

        {query ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{filteredExperiences.length}</span> experience{filteredExperiences.length === 1 ? "" : "s"} for "{query}"
            </span>
            <button type="button" onClick={clearQuery} className="min-h-9 px-1 font-medium text-primary underline-offset-4 hover:underline">
              Clear search
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredExperiences.map((experience, index) => {
            const sharedOnly = experience.sharedEnabled && !experience.privateEnabled;
            return (
              <ListingCard
                key={experience.id}
                href={getPublicListingPath("experience", experience.id, experience.title)}
                title={experience.title}
                media={experience}
                badge={experience.sharedEnabled && experience.sharedDepartures?.length ? "Join a group" : experience.privateEnabled ? "Private" : null}
                subtitle={`${describeDuration(experience.durationHours)} · ${getShortSeoLocation(experience.experienceLocation || experience.location)}`}
                details={experience.meetingPoint ? `Meeting point: ${experience.meetingPoint}` : null}
                rating={experience.rating}
                reviewCount={experience.reviewCount}
                eagerImage={index < 3}
                price={(
                  <>
                    From <ListingPrice><CurrencyAmount amountUsd={getLowestExperiencePrice(experience)} /></ListingPrice> a person{sharedOnly ? ", in a group" : ""}
                  </>
                )}
                data-testid={`card-service-${experience.id}`}
              />
            );
          })}
        </div>

        {filteredExperiences.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-lg text-muted-foreground">
              {query ? `No experiences matched "${query}" yet.` : "No experiences are listed right now."}
            </p>
            <CustomServiceCta source="experience-no-results" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        ) : null}

        {filteredExperiences.length > 0 ? <CustomServiceCta source="experience-bottom" className="mt-10" /> : null}
      </div>
    </div>
  );
}
