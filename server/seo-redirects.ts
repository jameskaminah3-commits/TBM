// Permanent redirects that give every page one address: no trailing slash, no
// /index.html, the journal at /blog, and a bare listing prefix (/transport) to
// its service page. Search engines then count one URL per page instead of
// splitting it across copies.
const bareListingPrefixes: Record<string, string> = {
  "/accommodation": "/accommodations",
  "/transport": "/services/drive",
  "/chef": "/services/dine",
  "/errand": "/services/relax",
  "/experience": "/services/experience",
};

/** Where a page request should go instead, or null to serve it as it is. Keeps the query string. */
export function getSeoRedirect(pathname: string, search = ""): string | null {
  if (pathname === "/index.html") return `/${search}`;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  const articles = /^\/articles(?:\/([^/]+))?$/.exec(path);
  const target = articles
    ? `/blog${articles[1] ? `/${articles[1]}` : ""}`
    : bareListingPrefixes[path] ?? path;
  return target === pathname ? null : `${target}${search}`;
}
