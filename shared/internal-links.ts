// Links from one TBM page to another, as search engines should see them.
//
// A link inside the site should point at the page's one real address. Tracking
// tags (utm_…, sourceType…) on an internal link create a new address for the
// same page: Google crawls each one, files it as a duplicate, and the ranking
// value the link carries is split. The visit is still credited: the page that
// links (an article) records where the reader came from when they click.
//
// A link to a filtered list ("stays in Nyali", /accommodations?destination=Nyali)
// is upgraded to the area page built to rank for exactly that
// (/explore/nyali/stays), when that page is live.
import { areaPagePath, detectSeoArea, type SeoAreaService } from "./listing-seo.ts";

const trackingParams = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "sourceType", "sourceId", "sourceSlug",
  "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid",
]);

// The filter that names a place on each browse page.
const areaFilterByPath: Record<string, { param: string; service: SeoAreaService }> = {
  "/accommodations": { param: "destination", service: "stays" },
};

// Filters that make a list a different search (dates, a guest count): the
// link keeps them and isn't upgraded to the area page.
const searchSpecificParams = new Set(["checkIn", "checkOut", "guests", "startDate", "endDate"]);

const siteHosts = new Set(["tembeabilamatata.com", "www.tembeabilamatata.com", "tembeabilamatata.co.ke", "www.tembeabilamatata.co.ke"]);

export function isTrackingParam(name: string) {
  return trackingParams.has(name) || name.toLowerCase().startsWith("utm_");
}

/**
 * The address an internal link should use: no tracking tags, and a filtered
 * list upgraded to its live area page. `liveAreaPaths` are the area pages that
 * have listings (only those are worth linking to). Links to other sites are
 * returned as they are.
 */
export function cleanInternalHref(href: string, liveAreaPaths: ReadonlySet<string> = new Set()): string {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed, "https://tembeabilamatata.com");
  } catch {
    return trimmed;
  }
  const relative = trimmed.startsWith("/") && !trimmed.startsWith("//");
  if (!relative && !siteHosts.has(url.hostname.toLowerCase())) return trimmed;

  for (const name of Array.from(url.searchParams.keys())) {
    if (isTrackingParam(name)) url.searchParams.delete(name);
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const filter = areaFilterByPath[path];
  const place = filter ? url.searchParams.get(filter.param) : null;
  if (filter && place && !Array.from(url.searchParams.keys()).some((name) => searchSpecificParams.has(name))) {
    const area = detectSeoArea(place);
    const areaPath = area ? areaPagePath(area.key, filter.service) : null;
    if (areaPath && liveAreaPaths.has(areaPath)) return `${areaPath}${url.hash}`;
  }

  const search = url.searchParams.toString();
  return `${path}${search ? `?${search}` : ""}${url.hash}`;
}

/**
 * The area an article is about, so it can link to that area's listings and the
 * area page can link back: its title and address first, then its summary.
 */
export function articleSeoArea(post: { title: string; slug: string; seoTitle?: string | null; excerpt?: string | null }) {
  return detectSeoArea(post.title, post.slug.replace(/-/g, " "), post.seoTitle, post.excerpt);
}
