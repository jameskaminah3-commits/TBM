// A provider's public page on TBM (/p/<code>/<slug>): who they are, what they
// offer, what guests said, and how to book through TBM. Everything on it comes
// from the server's allowlisted response; there's no contact route but TBM's.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { Eye, Languages, MapPin, MessageCircle, ShieldCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyAmount } from "@/components/currency-amount";
import { SeoHead } from "@/components/seo-head";
import { ProviderAvatar, ProviderBadges, ProviderRatingLine } from "@/components/provider-public-bits";
import { buildCanonicalUrl } from "@/lib/canonical-url";
import { capturePageVisit, trackShareEvent, withShareRef } from "@/lib/marketing-attribution";
import { openZaina } from "@/lib/zaina";
import {
  providerHowToBook,
  providerPageBlockerLabels,
  providerPaySafely,
  providerPaySafelyHeading,
  type ProviderPageBlocker,
  type PublicProviderProfile,
} from "@shared/provider-public";
import { publicReviewerName } from "@shared/public-review";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_WHATSAPP_URL } from "@shared/support-contact";

type PageResponse = { provider: PublicProviderProfile; preview?: boolean; blockers?: ProviderPageBlocker[] };

function monthYear(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function Unavailable() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6" data-testid="provider-unavailable">
      <SeoHead title="Not taking bookings right now | Tembea Bila Matata" robots="noindex,follow" canonicalUrl={buildCanonicalUrl("/accommodations")} />
      <h1 className="font-serif text-3xl font-medium">This provider isn't taking bookings on TBM right now</h1>
      <p className="mt-3 text-muted-foreground">The page may be switched off or under review. Here are other ways to plan your trip with Tembea Bila Matata.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Button asChild className="rounded-full"><Link href="/accommodations">Browse stays</Link></Button>
        <Button asChild variant="outline" className="rounded-full"><Link href="/services">Cars, chefs and experiences</Link></Button>
      </div>
    </div>
  );
}

export default function ProviderPublicPage() {
  const { code = "" } = useParams<{ code: string }>();
  const [location, setLocation] = useLocation();
  const { data, isLoading, isError } = useQuery<PageResponse | null>({
    queryKey: ["/api/public/providers", code],
    queryFn: async () => {
      const response = await fetch(`/api/public/providers/${encodeURIComponent(code)}`, { credentials: "include" });
      // Read the body either way, so the request is finished and the connection freed.
      const body = await response.json().catch(() => null);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Couldn't load this page");
      return body;
    },
    retry: false,
  });
  const provider = data?.provider;

  // The share code (if any) is kept on the device for the listing pages and checkout.
  useEffect(() => {
    capturePageVisit();
  }, [code]);

  // An old or bare address moves to the current one, keeping ?ref and the rest.
  useEffect(() => {
    if (provider && !data?.preview && location !== provider.path) {
      setLocation(`${provider.path}${window.location.search}`, { replace: true });
    }
  }, [provider, data?.preview, location, setLocation]);

  if (isLoading) {
    return <div className="min-h-screen py-20 text-center text-muted-foreground">Loading…</div>;
  }
  if (isError || !provider) {
    return <div className="min-h-screen"><Unavailable /></div>;
  }

  const services = provider.serviceTypes.join(" · ");
  const askTbm = () => {
    void trackShareEvent("enquire");
    openZaina(`I'd like to ask about ${provider.displayName}${services ? ` (${services})` : ""}: `);
  };
  const whatsappHref = `${SUPPORT_WHATSAPP_URL}?text=${encodeURIComponent(`Hi TBM, I'd like to ask about ${provider.displayName} (${typeof window === "undefined" ? "" : window.location.origin}${provider.path}).`)}`;

  return (
    <div className="app-shell min-h-screen pb-16 pt-4 sm:pt-6 md:pt-8" data-testid="provider-page">
      <SeoHead
        title={`${provider.displayName}${services ? ` · ${services}` : ""} | Tembea Bila Matata`}
        description={`${services}${provider.serviceAreas.length ? ` in ${provider.serviceAreas.slice(0, 3).join(", ")}` : ""}. Book through TBM.`}
        image={provider.photoUrl ?? provider.listings.find((listing) => listing.imageUrl)?.imageUrl ?? null}
        canonicalUrl={buildCanonicalUrl(provider.path)}
        robots={data?.preview ? "noindex,follow" : undefined}
      />
      <div className="container mx-auto max-w-5xl space-y-10 px-4 sm:px-6 md:px-8">
        {data?.preview ? (
          <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status" data-testid="provider-preview-banner">
            <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">Preview: only you and TBM can see this page right now.</p>
              <ul className="list-disc pl-4">
                {(data.blockers ?? []).map((blocker) => <li key={blocker}>{providerPageBlockerLabels[blocker]}</li>)}
              </ul>
              <Link href="/provider/share" className="font-medium underline underline-offset-4">Page settings in your Provider Hub</Link>
            </div>
          </div>
        ) : null}

        <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <ProviderAvatar provider={provider} className="h-28 w-28 sm:h-32 sm:w-32" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h1 className="font-serif text-3xl font-medium leading-tight md:text-4xl" data-testid="text-provider-name">{provider.displayName}</h1>
              {services ? <p className="mt-1 text-base text-muted-foreground" data-testid="text-provider-services">{services}</p> : null}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {provider.serviceAreas.length ? (
                <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" aria-hidden="true" />{provider.serviceAreas.join(", ")}</span>
              ) : null}
              {provider.languages.length ? (
                <span className="inline-flex items-center gap-1"><Languages className="h-4 w-4" aria-hidden="true" />{provider.languages.join(", ")}</span>
              ) : null}
            </div>
            <ProviderBadges provider={provider} />
            {provider.rating ? (
              <a href="#reviews" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"><ProviderRatingLine rating={provider.rating} /></a>
            ) : (
              <ProviderRatingLine rating={null} />
            )}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button asChild className="h-12 rounded-full px-6"><a href="#services" data-testid="button-provider-services">See services</a></Button>
              <Button variant="outline" className="h-12 rounded-full px-6" onClick={askTbm} data-testid="button-ask-tbm-provider">
                <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />Ask TBM about this provider
              </Button>
            </div>
          </div>
        </header>

        {provider.about ? (
          <section aria-labelledby="about-heading" className="max-w-prose space-y-3">
            <h2 id="about-heading" className="font-serif text-2xl font-medium">About</h2>
            <p className="whitespace-pre-line leading-7 text-muted-foreground" data-testid="text-provider-about">{provider.about}</p>
          </section>
        ) : null}

        <section id="services" aria-labelledby="services-heading" className="scroll-mt-24 space-y-4">
          <h2 id="services-heading" className="font-serif text-2xl font-medium">Services</h2>
          {provider.listings.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="list-provider-listings">
              {provider.listings.map((listing) => (
                <li key={listing.path}>
                  <Link href={withShareRef(listing.path)} className="group block h-full overflow-hidden rounded-2xl border bg-card transition-shadow hover:shadow-md">
                    {listing.imageUrl ? (
                      <img src={listing.imageUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                    ) : (
                      <div className="aspect-[4/3] w-full bg-muted" />
                    )}
                    <div className="space-y-1 p-4">
                      <p className="font-medium text-foreground group-hover:underline">{listing.name}</p>
                      {listing.area ? <p className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{listing.area}</p> : null}
                      {listing.priceFrom ? (
                        <p className="text-sm text-muted-foreground">From <CurrencyAmount amountUsd={listing.priceFrom} primaryClassName="font-medium text-foreground" /> {listing.priceUnit}</p>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No services are published yet.</p>
          )}
        </section>

        {provider.reviews.length ? (
          <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="reviews-heading" className="flex items-center gap-2 font-serif text-2xl font-medium">
                <Star className="h-5 w-5 fill-amber-400 text-amber-400" aria-hidden="true" />
                {provider.rating ? `${provider.rating.average.toFixed(1)} · ` : ""}{provider.reviews.length} review{provider.reviews.length === 1 ? "" : "s"}
              </h2>
              <span className="text-sm text-muted-foreground">From guests who booked through TBM</span>
            </div>
            <ul className="grid gap-3 md:grid-cols-2" data-testid="list-provider-reviews">
              {provider.reviews.map((review, index) => (
                <li key={`${review.createdAt}-${index}`} className="rounded-2xl border border-border/60 bg-card/70 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-foreground">{publicReviewerName(review.guestName)}</span>
                    <span className="text-xs text-muted-foreground">{monthYear(review.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{review.listingName}</div>
                  <div className="mt-1 flex items-center gap-0.5" role="img" aria-label={`${review.rating} out of 5 stars`}>
                    {Array.from({ length: 5 }).map((_, star) => (
                      <Star key={star} aria-hidden="true" className={`h-3.5 w-3.5 ${star < review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/35"}`} />
                    ))}
                  </div>
                  {review.comment ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{review.comment}</p> : null}
                  {review.reply ? (
                    <div className="mt-3 rounded-xl bg-muted/50 p-3 text-sm">
                      <div className="text-xs font-medium text-foreground">Reply from {provider.displayName}</div>
                      <p className="mt-1 leading-6 text-muted-foreground">{review.reply.text}</p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="book-heading" className="grid gap-4 rounded-2xl border border-border/70 bg-muted/20 p-5 sm:p-6 md:grid-cols-2">
          <div className="space-y-3">
            <h2 id="book-heading" className="font-serif text-2xl font-medium">How to book</h2>
            <p className="leading-7 text-muted-foreground">{providerHowToBook}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="rounded-full"><a href="#services">See services</a></Button>
              <Button asChild variant="outline" className="rounded-full">
                <a href={whatsappHref} target="_blank" rel="noreferrer" onClick={() => void trackShareEvent("enquire")} data-testid="link-provider-whatsapp-tbm">
                  <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />WhatsApp TBM
                </a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">TBM's official number: <span className="font-medium text-foreground">{SUPPORT_PHONE_DISPLAY}</span></p>
          </div>
          <div className="space-y-3">
            <h2 className="flex items-center gap-2 font-serif text-2xl font-medium"><ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" />{providerPaySafelyHeading}</h2>
            <p className="leading-7 text-muted-foreground" data-testid="text-provider-pay-safely">{providerPaySafely}</p>
            <ProviderBadges provider={provider} showMeaning />
            <p className="text-sm text-muted-foreground">Bookings and guest support coordinated by Tembea Bila Matata.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
