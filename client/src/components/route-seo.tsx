import { SeoHead } from "@/components/seo-head";
import { buildCanonicalUrl } from "@/lib/canonical-url";
import { staticPageKey, staticPageMetadata } from "@shared/page-metadata";

// Private pages: named, never indexed.
const privateTitles: Array<[RegExp, string]> = [
  [/^\/auth/, "Sign in or create an account | Tembea Bila Matata"],
  [/^\/bookings/, "My Bookings | Tembea Bila Matata"],
  [/^\/book\//, "Complete your booking | Tembea Bila Matata"],
  [/^\/inbox/, "Messages | Tembea Bila Matata"],
];

export function RouteSeo({ pathname }: { pathname: string }) {
  const key = staticPageKey(pathname);
  const metadata = staticPageMetadata[key];
  if (!metadata) {
    if (/^\/(?:book(?:ings)?|b\/|auth(?:\/|$)|admin(?:\/|$)|provider(?:\/|$)|inbox(?:\/|$))/.test(key)) {
      const title = privateTitles.find(([pattern]) => pattern.test(key))?.[1] ?? "Tembea Bila Matata";
      return <SeoHead title={title} robots="noindex,follow" canonicalUrl={buildCanonicalUrl(key)} />;
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
