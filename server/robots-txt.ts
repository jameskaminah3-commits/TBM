// robots.txt: which addresses search engines may fetch.
//
// Google reads a page the way a browser does: it runs the page's scripts, and
// those load the listing, article or area from /api/. Google obeys robots.txt
// for those requests too, so the API must stay open to it. When /api/ was
// disallowed, every listing, article and area page loaded without its data,
// fell back to "not available" with a noindex tag, and dropped out of Google.
// API answers are kept out of search results by an X-Robots-Tag header instead
// (apiNoIndexHeader, set on every /api/ response).
//
// Disallowed: private pages only. (Pages such as /set-up-account stay
// crawlable so Google can read the noindex in their head.)

export const privatePathPrefixes = [
  "/admin/",
  "/provider/",
  "/auth",
  "/book/",
  "/bookings",
  "/b/",
  "/inbox",
] as const;

export const apiNoIndexHeader = { name: "X-Robots-Tag", value: "noindex" } as const;

export function buildRobotsTxt(baseUrl: string) {
  return [
    "User-agent: *",
    "Allow: /",
    ...privatePathPrefixes.map((prefix) => `Disallow: ${prefix}`),
    "",
    `Sitemap: ${baseUrl.replace(/\/+$/, "")}/sitemap.xml`,
    "",
  ].join("\n");
}

/** Whether robots.txt keeps search engines from fetching this path (Google's rule: the longest match wins). */
export function isDisallowedByRobots(robotsTxt: string, pathname: string) {
  let best: { allow: boolean; length: number } | null = null;
  for (const line of robotsTxt.split("\n")) {
    const match = /^(allow|disallow):\s*(\S*)/i.exec(line.trim());
    if (!match || !match[2]) continue;
    const allow = match[1].toLowerCase() === "allow";
    const length = match[2].length;
    if (pathname.startsWith(match[2]) && (!best || length > best.length || (length === best.length && allow))) {
      best = { allow, length };
    }
  }
  return best ? !best.allow : false;
}
