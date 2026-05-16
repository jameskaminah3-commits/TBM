import { FormEvent, useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConciergeSection, getRouteForSection, inferSectionFromQuery, useConciergeSearch } from "@/lib/concierge-search";
import { buildStaySearchParams, readStaySearchState } from "@/lib/stay-search";

const searchBarContent: Record<
  ConciergeSection,
  { label: string; placeholder: string; chips: string[] }
> = {
  stays: {
    label: "Find the right stay for this trip",
    placeholder: "2 bedroom in Nyali, beachfront stay, family stay with pool...",
    chips: ["2 Bedroom Nyali", "Beachfront Stay", "Family Stay", "Pool Stay", "Watamu Getaway"],
  },
  drive: {
    label: "What drive service do you need today?",
    placeholder: "Chauffeur to Diani, self-drive SUV, airport pickup from Malindi, full day driver...",
    chips: ["Airport Pickup", "Chauffeur Hourly", "Self-Drive 4x4", "Transfer to Diani", "Luxury SUV"],
  },
  dine: {
    label: "Book a private chef or dining experience",
    placeholder: "Swahili seafood dinner for 4, daily villa chef, vegan coastal menu, cooking class...",
    chips: ["Signature Swahili Feast", "Daily Home Cook", "Seafood Dinner", "Cooking Class"],
  },
  relax: {
    label: "Zero-hassle villa support and errands",
    placeholder: "Help Mama family care, grocery delivery, mama fua laundry, house cleaning...",
    chips: ["Grocery Shopping", "Laundry Pickup", "House Cleaning", "Shopping + Laundry Bundle"],
  },
  experience: {
    label: "Discover curated Coast experiences",
    placeholder: "Mambrui Sunset Drive, Swahili cooking class, Gede Ruins tour, dhow cruise...",
    chips: ["Sunset Drives", "Cooking Classes", "Heritage Ruins", "Beach & Nature"],
  },
};

export function ConciergeSearchBar({ currentSection }: { currentSection: ConciergeSection }) {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { query, setQuery, clearQuery } = useConciergeSearch();
  const staySearch = currentSection === "stays" ? readStaySearchState(search) : null;
  const effectiveQuery = currentSection === "stays" ? staySearch?.query || "" : query;
  const [draft, setDraft] = useState(effectiveQuery);
  const content = searchBarContent[currentSection];

  useEffect(() => {
    setDraft(effectiveQuery);
  }, [effectiveQuery]);

  const runSearch = (rawQuery: string) => {
    const nextQuery = rawQuery.trim();

    if (!nextQuery) {
      if (currentSection === "stays") {
        const targetRoute = getRouteForSection(currentSection);
        if (targetRoute) {
          setLocation(targetRoute);
        }
      }
      return;
    }

    const targetSection = inferSectionFromQuery(nextQuery, currentSection);
    const targetRoute = getRouteForSection(targetSection);

    if (targetRoute) {
      if (targetSection === "stays") {
        const currentStaySearch = currentSection === "stays"
          ? staySearch || readStaySearchState(search)
          : { destination: "", checkIn: "", checkOut: "", guests: null, query: "" };
        const nextSearch = buildStaySearchParams({
          checkIn: currentStaySearch.checkIn,
          checkOut: currentStaySearch.checkOut,
          guests: currentStaySearch.guests,
          query: nextQuery,
        });

        setLocation(nextSearch ? `${targetRoute}?${nextSearch}` : targetRoute);
        return;
      }

      setQuery(nextQuery);
      setLocation(targetRoute);
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runSearch(draft);
  };

  return (
    <section className="border-b border-border/60 bg-[linear-gradient(180deg,rgba(255,250,244,0.96),rgba(255,255,255,0.98),rgba(249,243,235,0.86))] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(17,24,39,0.95),rgba(15,23,42,0.92))]">
      <div className="container mx-auto px-4 py-2 md:px-8 md:py-2.5">
        <form className="space-y-2" onSubmit={submitSearch}>
          <div className="flex flex-col gap-1.5 xl:flex-row xl:items-center xl:gap-3">
            <div className="min-w-0 xl:w-[220px]">
              <p className="text-sm font-medium leading-6 text-foreground/88 md:text-[0.88rem] dark:text-foreground/82">
                {content.label}
              </p>
            </div>

            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 min-[560px]:grid-cols-[minmax(0,1fr)_auto] min-[560px]:items-center min-[560px]:gap-1.5">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={content.placeholder}
                  className="h-10 rounded-full border-border/70 bg-background/92 pl-10 pr-4 text-sm shadow-[0_16px_24px_-22px_rgba(146,118,89,0.28)] placeholder:text-muted-foreground/85 dark:border-white/10 dark:bg-slate-950/36 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] min-[560px]:h-9"
                  data-testid="input-concierge-search"
                />
              </div>

              <div className="flex flex-col gap-1.5 min-[420px]:flex-row min-[420px]:items-center min-[560px]:flex-shrink-0">
                <Button type="submit" className="h-10 w-full rounded-full px-4 text-sm whitespace-nowrap min-[420px]:w-auto min-[560px]:h-9 min-[560px]:min-w-[104px]" data-testid="button-concierge-search">
                  Search
                </Button>

                {effectiveQuery ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-10 w-full rounded-full px-3.5 text-sm whitespace-nowrap text-muted-foreground dark:text-foreground/72 min-[420px]:w-auto min-[560px]:h-9"
                    onClick={() => {
                      setDraft("");
                      if (currentSection === "stays") {
                        const targetRoute = getRouteForSection(currentSection);
                        if (targetRoute) {
                          setLocation(targetRoute);
                        }
                        return;
                      }
                      clearQuery();
                    }}
                    data-testid="button-clear-concierge-search"
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {content.chips.map((chip) => (
              <button
                key={chip}
                type="button"
                className="rounded-full border border-border/70 bg-background/92 px-2.5 py-1 text-[0.72rem] font-medium text-muted-foreground shadow-[0_10px_18px_-18px_rgba(146,118,89,0.34)] transition-colors hover:border-primary/40 hover:text-foreground dark:border-white/10 dark:bg-slate-950/34 dark:text-foreground/74 dark:hover:border-primary/45 dark:hover:bg-slate-950/52 dark:hover:text-foreground dark:shadow-none md:px-3 md:py-1.5 md:text-[0.78rem]"
                onClick={() => {
                  setDraft(chip);
                  runSearch(chip);
                }}
                data-testid={`chip-concierge-${chip.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                {chip}
              </button>
            ))}
          </div>
        </form>
      </div>
    </section>
  );
}
