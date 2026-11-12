// Listings of one service in one area of the Coast, as cards linking to each
// listing, plus the area page and the area's other services. Used on the area
// page itself, under every listing ("More places to stay in Nyali") and under
// articles about an area, so each new listing is linked from the pages around
// it the day it goes live, and search engines find and rank it sooner.
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, MapPin, Sparkles, Star } from "lucide-react";
import { CurrencyAmount } from "@/components/currency-amount";
import { formatRating, hasPublicRating } from "@shared/review-eligibility";
import type { SeoAreaService } from "@shared/listing-seo";
import type { PublicListingKind } from "@shared/seo";
import { photoSrcSet } from "@shared/photo-variants";

export type AreaCard = {
  kind: PublicListingKind;
  id: string;
  name: string;
  location: string;
  imageUrl: string | null;
  imageAlt: string;
  path: string;
  price: number | null;
  priceUnit: string;
  rating: number | null;
  reviewCount: number;
};

export type AreaPageData = {
  area: { key: string; name: string; landmarks: string[] };
  service: SeoAreaService;
  kind: PublicListingKind;
  heading: string;
  intro: string;
  title: string;
  description: string;
  listings: AreaCard[];
  otherServices: Array<{ service: string; heading: string; path: string; count: number }>;
  otherAreas: Array<{ key: string; heading: string; path: string; count: number }>;
  articles?: Array<{ title: string; path: string; excerpt: string }>;
};

export function AreaListingCard({ card, headingLevel = "h2" }: { card: AreaCard; headingLevel?: "h2" | "h3" }) {
  const rated = hasPublicRating({ rating: card.rating ?? 0, reviewCount: card.reviewCount });
  const Heading = headingLevel;
  return (
    <Link href={card.path} className="group flex min-w-0 flex-col overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-[0_24px_50px_-40px_rgba(15,61,58,0.6)]" data-testid={`area-listing-${card.id}`}>
      <div className="aspect-[4/3] overflow-hidden bg-stone-100">
        {card.imageUrl ? <img src={card.imageUrl} srcSet={photoSrcSet(card.imageUrl)} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" alt={card.imageAlt} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" /> : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <Heading className="font-serif text-lg font-semibold leading-snug text-stone-950">{card.name}</Heading>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{card.location}</span>
          <span className="inline-flex items-center gap-1">
            {rated ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
            {rated ? `${formatRating(card.rating!)} · ${card.reviewCount} reviews` : "New on TBM"}
          </span>
        </div>
        {card.price ? (
          <div className="mt-auto flex items-baseline gap-1.5 pt-2 text-sm">
            {card.priceUnit === "from" ? <span className="text-muted-foreground">From</span> : null}
            <CurrencyAmount amountUsd={card.price} primaryClassName="font-semibold text-stone-950" />
            {card.priceUnit !== "from" ? <span className="text-muted-foreground">{card.priceUnit}</span> : null}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

/**
 * "More places to stay in Nyali": other live listings in the same area and
 * service, the area page, and the area's other services. Shows nothing until
 * there's something to link to.
 */
export function AreaCrossLinks({ areaKey, service, excludeId, title, testId = "area-cross-links" }: {
  areaKey: string;
  service: SeoAreaService;
  excludeId?: string;
  title?: string;
  testId?: string;
}) {
  const { data } = useQuery<AreaPageData>({ queryKey: ["/api/seo/areas", areaKey, service], staleTime: 5 * 60_000 });
  if (!data) return null;
  const others = data.listings.filter((card) => card.id !== excludeId);
  const areaPath = `/explore/${data.area.key}/${data.service}`;
  if (!others.length && !data.otherServices.length) return null;
  return (
    <section className="mt-12" aria-labelledby={`${testId}-heading`} data-testid={testId}>
      {others.length ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id={`${testId}-heading`} className="font-serif text-2xl font-semibold text-stone-950">{title ?? `More ${data.heading.charAt(0).toLowerCase()}${data.heading.slice(1)}`}</h2>
            <Link href={areaPath} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              See all {data.listings.length} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {others.slice(0, 3).map((card) => <AreaListingCard key={card.id} card={card} headingLevel="h3" />)}
          </div>
        </>
      ) : (
        <h2 id={`${testId}-heading`} className="font-serif text-2xl font-semibold text-stone-950">Plan the rest of your trip to {data.area.name}</h2>
      )}
      {data.otherServices.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {others.length ? <Link href={areaPath} className="inline-flex min-h-11 items-center rounded-full border border-stone-200 bg-white px-4 text-sm font-medium hover:border-teal-300">{data.heading}</Link> : null}
          {data.otherServices.map((other) => (
            <Link key={other.path} href={other.path} className="inline-flex min-h-11 items-center rounded-full border border-stone-200 bg-white px-4 text-sm font-medium hover:border-teal-300">{other.heading} <span className="ml-2 text-xs text-muted-foreground">{other.count}</span></Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
