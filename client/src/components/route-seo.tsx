import { SeoHead } from "@/components/seo-head";
import { buildCanonicalUrl } from "@/lib/canonical-url";
import { staticPageKey, staticPageMetadata } from "@shared/page-metadata";

export function RouteSeo({ pathname }: { pathname: string }) {
  const key = staticPageKey(pathname);
  const metadata = staticPageMetadata[key];
  if (!metadata) {
    if (/^\/(?:book(?:ings)?|b\/|auth(?:\/|$)|admin(?:\/|$)|provider(?:\/|$)|inbox(?:\/|$))/.test(key)) {
      return <SeoHead title="Tembea Bila Matata" robots="noindex,follow" canonicalUrl={buildCanonicalUrl(key)} />;
    }
    return null;
  }

  return (
    <SeoHead
      title={metadata.title}
      description={metadata.description}
      canonicalUrl={buildCanonicalUrl(key)}
      structuredData={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: metadata.title,
        description: metadata.description,
        url: buildCanonicalUrl(key),
        isPartOf: {
          "@type": "WebSite",
          name: "Tembea Bila Matata",
          url: buildCanonicalUrl("/"),
        },
      }}
    />
  );
}
