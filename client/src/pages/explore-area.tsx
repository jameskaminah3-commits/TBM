// An area page (/explore/diani/stays): every live listing of one service in one
// place, TBM's own introduction, and links to the area's other services and the
// same service elsewhere on the Coast. Google lands here for searches like
// "where to stay in Diani"; the server sends the same title, description and
// ItemList (share-metadata.ts) before the page loads.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowRight } from "lucide-react";
import { SeoHead } from "@/components/seo-head";
import { PageLoadError } from "@/components/page-load-error";
import { isNotFoundError, retryUnlessNotFound } from "@/lib/queryClient";
import { AreaListingCard as ListingCard, type AreaPageData as AreaPage } from "@/components/area-listings";
import { Button } from "@/components/ui/button";
import { buildCanonicalUrl } from "@/lib/canonical-url";
import { areaPagePath, seoCategoryPages, type SeoAreaService } from "@shared/listing-seo";

export default function ExploreArea() {
  const { area = "", service = "" } = useParams<{ area: string; service: string }>();
  const { data, isLoading, isError, error, refetch } = useQuery<AreaPage>({ queryKey: ["/api/seo/areas", area, service], enabled: Boolean(area && service), retry: retryUnlessNotFound });
  const canonicalUrl = buildCanonicalUrl(areaPagePath(area, service as SeoAreaService));
  const category = data ? seoCategoryPages[data.kind] : null;
  const structuredData = useMemo(() => (data && category ? {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: data.heading,
    description: data.description,
    url: canonicalUrl,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: data.listings.length,
      itemListElement: data.listings.slice(0, 30).map((card, index) => ({ "@type": "ListItem", position: index + 1, name: card.name, url: buildCanonicalUrl(card.path) })),
    },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: buildCanonicalUrl("/") },
        { "@type": "ListItem", position: 2, name: category.label, item: buildCanonicalUrl(category.path) },
        { "@type": "ListItem", position: 3, name: data.heading, item: canonicalUrl },
      ],
    },
  } : null), [canonicalUrl, category, data]);

  if (isLoading) return <div className="min-h-screen py-20 text-center text-muted-foreground">Loading…</div>;
  // Couldn't load (as opposed to "doesn't exist"): the server's robots and
  // canonical tags stay, so search engines aren't told the page is gone.
  if (isError && !isNotFoundError(error)) {
    return <PageLoadError onRetry={() => void refetch()} />;
  }

  if (isError || !data || !category) {
    return (
      <div className="app-shell min-h-screen py-16">
        <SeoHead title="Page not found | Tembea Bila Matata" robots="noindex,follow" canonicalUrl={canonicalUrl} />
        <div className="container mx-auto max-w-3xl px-4 text-center">
          <h1 className="font-serif text-3xl font-semibold">We couldn't find that page</h1>
          <p className="mt-3 text-muted-foreground">Browse stays and services across the Kenyan Coast instead.</p>
          <Button asChild className="mt-6 rounded-full"><Link href="/">Go to the home page</Link></Button>
        </div>
      </div>
    );
  }

  const paragraphs = data.intro.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);

  return (
    <div className="app-shell min-h-screen py-10">
      <SeoHead title={data.title} description={data.description} image={data.listings[0]?.imageUrl} canonicalUrl={canonicalUrl} robots={data.listings.length ? "index,follow" : "noindex,follow"} structuredData={structuredData} />
      <div className="container mx-auto max-w-6xl px-4 md:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span className="mx-2">/</span>
          <Link href={category.path} className="hover:text-foreground">{category.label}</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{data.area.name}</span>
        </nav>

        <header className="max-w-3xl">
          <h1 className="font-serif text-3xl font-semibold leading-tight text-stone-950 sm:text-5xl" data-testid="text-area-heading">{data.heading}</h1>
          <div className="mt-4 space-y-3 text-base leading-8 text-stone-700">{paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        </header>

        {data.listings.length ? (
          <section className="mt-10" aria-label={`${data.heading}: ${data.listings.length} listings`}>
            <div className="mb-4 text-sm text-muted-foreground">{data.listings.length} listing{data.listings.length === 1 ? "" : "s"} on TBM</div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.listings.map((card) => <ListingCard key={`${card.kind}-${card.id}`} card={card} />)}
            </div>
          </section>
        ) : (
          <section className="mt-10 rounded-[1.5rem] border border-dashed border-stone-300 bg-white/70 p-6">
            <p className="text-stone-700">Nothing is listed here yet. See {category.label.toLowerCase()} elsewhere on the Coast, or ask Zaina, TBM's assistant, to find one for you.</p>
            <Button asChild className="mt-4 rounded-full"><Link href={category.path}>See {category.label.toLowerCase()} <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
          </section>
        )}

        {data.otherServices.length ? (
          <section className="mt-12">
            <h2 className="font-serif text-2xl font-semibold">More in {data.area.name}</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {data.otherServices.map((other) => (
                <Link key={other.path} href={other.path} className="inline-flex min-h-11 items-center rounded-full border border-stone-200 bg-white px-4 text-sm font-medium hover:border-teal-300">{other.heading} <span className="ml-2 text-xs text-muted-foreground">{other.count}</span></Link>
              ))}
            </div>
          </section>
        ) : null}

        {data.articles?.length ? (
          <section className="mt-12" data-testid="area-articles">
            <h2 className="font-serif text-2xl font-semibold">Read before you go to {data.area.name}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {data.articles.map((article) => (
                <li key={article.path}>
                  <Link href={article.path} className="block h-full rounded-[1.25rem] border border-stone-200 bg-white p-4 hover:border-teal-300">
                    <span className="font-serif text-lg font-semibold text-stone-950">{article.title}</span>
                    {article.excerpt ? <span className="mt-1 block text-sm text-muted-foreground">{article.excerpt}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {data.otherAreas.length ? (
          <section className="mt-10">
            <h2 className="font-serif text-2xl font-semibold">Elsewhere on the Coast</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {data.otherAreas.map((other) => (
                <Link key={other.path} href={other.path} className="inline-flex min-h-11 items-center rounded-full border border-stone-200 bg-white px-4 text-sm font-medium hover:border-teal-300">{other.heading} <span className="ml-2 text-xs text-muted-foreground">{other.count}</span></Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-12 rounded-[1.75rem] bg-gradient-to-br from-[#0f3d3a] to-[#1f5f4f] p-6 text-white sm:p-8">
          <h2 className="font-serif text-2xl font-semibold">Book with clear prices, pay by M-Pesa or card</h2>
          <p className="mt-2 max-w-2xl text-white/85">Every price is shown before you book. You pay through TBM, and TBM confirms the details with you before the day.</p>
        </section>
      </div>
    </div>
  );
}
