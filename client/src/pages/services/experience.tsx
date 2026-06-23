import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CurrencyAmount } from "@/components/currency-amount";
import { filterExperiences, useConciergeSearch } from "@/lib/concierge-search";
import { CustomServiceCta } from "@/components/custom-service-cta";
import { PublicReviewPreview } from "@/components/public-review-preview";
import { Clock3, Compass, MapPin, Star, Users } from "lucide-react";
import { PremiumMediaGallery } from "@/components/premium-media-gallery";
import type { Experience } from "@shared/schema";

function getLowestExperiencePrice(experience: Experience) {
  const prices = [
    experience.privateEnabled && experience.privatePricePerPerson > 0 ? experience.privatePricePerPerson : null,
    experience.sharedEnabled && experience.sharedPricePerPerson > 0 ? experience.sharedPricePerPerson : null,
  ].filter((value): value is number => value !== null);

  return prices.length ? Math.min(...prices) : experience.price;
}

function ExperienceCard({
  experience,
  onOpen,
}: {
  experience: Experience;
  onOpen: () => void;
}) {
  const lowestPrice = getLowestExperiencePrice(experience);

  return (
    <Card className="group overflow-hidden border-border/60 bg-gradient-to-b from-background via-background to-muted/10 shadow-[0_14px_34px_-24px_rgba(15,23,42,0.42)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_44px_-28px_rgba(15,23,42,0.55)]">
      <PremiumMediaGallery
        item={experience}
        title={experience.title}
        aspectClassName="aspect-[16/10]"
        zoomLabel="View experience photo"
      />

      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Compass className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-xl font-medium tracking-tight">{experience.title}</h2>
          </div>
        </div>

        <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{experience.description}</p>

        <div className="grid gap-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            <span>Rated {experience.rating.toFixed(1)}/5 by verified guests</span>
          </div>
          {experience.experienceLocation ? (
            <div className="flex items-center gap-2 text-foreground">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-medium">{experience.experienceLocation}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4" />
            <span>{experience.durationHours} {experience.durationHours === 1 ? "hour" : "hours"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>Hosted from {experience.location || "Provider base not set"}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {experience.features.slice(0, 2).map((feature) => (
            <Badge key={feature} variant="secondary">{feature}</Badge>
          ))}
        </div>

        <PublicReviewPreview targetType="experience" targetId={experience.id} />

        <div className="flex flex-col gap-3 border-t border-border/60 pt-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              From
            </p>
            <CurrencyAmount
              amountUsd={lowestPrice}
              primaryClassName="mt-1 break-words text-lg font-semibold tracking-tight"
            />
            <p className="text-sm text-muted-foreground">per person</p>
          </div>
          <Button className="w-full rounded-full px-5 sm:w-auto" onClick={onOpen}>
            See More
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function ExperiencePage() {
  const [, setLocation] = useLocation();
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
    <div className="app-shell min-h-screen py-12">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mb-12">
          <h1 className="mb-4 font-serif text-3xl font-medium leading-tight sm:text-4xl md:text-5xl">
            Curated Experiences
          </h1>
          <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            Discover crafted moments, local adventures, and memorable outings designed for travelers who want more than just transport and accommodation.
          </p>
        </div>

        {query ? (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filteredExperiences.length}</span> experience matches for "{query}"
            </p>
            <Button variant="ghost" className="h-9 self-start rounded-full px-4 md:self-auto" onClick={clearQuery}>
              Clear search
            </Button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredExperiences.map((experience) => (
            <ExperienceCard
              key={experience.id}
              experience={experience}
              onOpen={() => setLocation(`/book/experience/${experience.id}`)}
            />
          ))}
        </div>

        {filteredExperiences.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-lg text-muted-foreground">
              {query ? `No experiences matched "${query}" yet.` : "No experiences available yet."}
            </p>
            <CustomServiceCta source="experience-no-results" className="mx-auto mt-6 max-w-xl text-left" />
          </div>
        ) : null}

        {filteredExperiences.length > 0 ? <CustomServiceCta source="experience-bottom" className="mt-10" /> : null}
      </div>
    </div>
  );
}
