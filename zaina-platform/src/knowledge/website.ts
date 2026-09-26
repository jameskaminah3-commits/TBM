// zaina-platform/src/knowledge/website.ts
//
// Reading a business's website into knowledge: its home page, then the pages
// it links to on the same site (the ones most likely to answer customers
// first: rooms, menu, services, FAQs, policies, contact), up to a limit.
// Only pages robots.txt allows; only HTML; each page's readable text. Pages
// that have no text without JavaScript are skipped and reported. Every
// address is read through fetchPublic (net/public-fetch.ts).

import { createHash } from "node:crypto";
import type { KnowledgeKind } from "../db/schema.ts";
import { fetchPublic, PublicFetchError, publicUrl } from "../net/public-fetch.ts";
import { htmlToText } from "./import.ts";

export const MAX_WEBSITE_PAGES = 25;
const PAGE_BYTES = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 12_000;
const MIN_TEXT = 80;

export type WebsitePage = { url: string; title: string; text: string; description: string | null };
export type WebsiteRead = { site: string; pages: WebsitePage[]; skipped: Array<{ url: string; reason: string }> };

/** Paths worth reading first: what customers ask about. */
const USEFUL = /(about|room|suite|accommodation|stay|rate|price|tariff|menu|food|drink|restaurant|dining|service|treatment|spa|salon|faq|question|polic|terms|cancel|booking|reserv|contact|location|direction|amenit|facilit|gallery|offer|package|event|wedding|conference|check-in|checkin|house-rules|kuhusu|huduma|bei)/i;
/** Paths never worth reading. */
const SKIP_PATH = /(\/wp-admin|\/wp-json|\/wp-login|\/login|\/logout|\/signin|\/sign-in|\/register|\/account|\/my-account|\/cart|\/checkout|\/basket|\/search|\/feed\/?$|\/tag\/|\/author\/|\/page\/\d+|\/cdn-cgi\/|\?replytocom=|\/xmlrpc)/i;
const FILE = /\.(pdf|jpe?g|png|gif|webp|svg|ico|bmp|tiff?|mp[34]|m4a|mov|avi|webm|zip|rar|gz|7z|docx?|xlsx?|pptx?|csv|xml|json|js|css|woff2?|ttf|eot|apk|exe|dmg)$/i;

/** One site: the same host, with or without "www.". */
const siteOf = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** A link's address without its fragment and tracking parameters, for knowing a page was seen. */
export function pageKey(url: URL): string {
  const copy = new URL(url);
  copy.hash = "";
  for (const name of [...copy.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_|ref$|_ga$)/i.test(name)) copy.searchParams.delete(name);
  }
  copy.hostname = siteOf(copy.hostname);
  const path = copy.pathname.replace(/\/+$/, "") || "/";
  return `${copy.hostname}${path}${copy.search}`;
}

/** The links on a page that stay on the site and may be pages. */
export function linksOn(html: string, page: URL): URL[] {
  const links: URL[] = [];
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = (match[1] ?? match[2] ?? match[3] ?? "").trim().replace(/&amp;/g, "&");
    if (!href || /^(mailto:|tel:|javascript:|data:|#|sms:|whatsapp:)/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, page);
    } catch {
      continue;
    }
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:" || siteOf(url.hostname) !== siteOf(page.hostname)) continue;
    if (FILE.test(url.pathname) || SKIP_PATH.test(url.pathname + url.search)) continue;
    url.hash = "";
    links.push(url);
  }
  return links;
}

/** The paths robots.txt keeps every robot (and ours) away from. */
export function disallowedPaths(robots: string): string[] {
  const groups: Array<{ agents: string[]; rules: string[] }> = [];
  let current: { agents: string[]; rules: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "disallow" && current && value) current.rules.push(value);
  }
  const ours = groups.filter((group) => group.agents.some((agent) => agent.startsWith("zainabot")));
  const chosen = ours.length ? ours : groups.filter((group) => group.agents.includes("*"));
  return chosen.flatMap((group) => group.rules);
}

export function allowedBy(rules: string[], url: URL): boolean {
  const path = url.pathname + url.search;
  return !rules.some((rule) => {
    const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${pattern.endsWith("\\$") ? `${pattern.slice(0, -2)}$` : pattern}`).test(path);
  });
}

/** The page's own description, if it gives one (a suggestion for the business's "about"). */
function descriptionOf(html: string): string | null {
  const tag = /<meta\b[^>]*\b(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*>/i.exec(html)?.[0];
  const content = tag ? /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag) : null;
  const text = (content?.[1] ?? content?.[2] ?? "").replace(/\s+/g, " ").trim();
  return text ? htmlToText(`<p>${text}</p>`).text.slice(0, 600) : null;
}

/** Most useful first: what customers ask about, then shorter addresses. */
function score(url: URL): number {
  const path = decodeURIComponent(url.pathname).toLowerCase();
  return (USEFUL.test(path) ? 0 : 100) + path.split("/").filter(Boolean).length * 10 + path.length / 10;
}

/**
 * Reads a website: the page at `start`, then pages it links to on the same
 * site, most useful first, until `maxPages` have text or time runs out.
 */
export async function readWebsite(start: string, options: { maxPages?: number; timeBudgetMs?: number } = {}): Promise<WebsiteRead> {
  const maxPages = Math.min(Math.max(options.maxPages ?? 10, 1), MAX_WEBSITE_PAGES);
  const deadline = Date.now() + (options.timeBudgetMs ?? 45_000);
  const first = publicUrl(start);
  const pages: WebsitePage[] = [];
  const skipped: WebsiteRead["skipped"] = [];
  const seen = new Set<string>();
  const texts = new Set<string>();

  let rules: string[] = [];
  try {
    const robots = await fetchPublic(new URL("/robots.txt", first), { accept: "text/plain", maxBytes: 256 * 1024, timeoutMs: 8_000 });
    if (robots.status === 200 && !robots.contentType.includes("html")) rules = disallowedPaths(robots.body.toString("utf8"));
  } catch {
    // No robots.txt, or it can't be read: nothing is off limits.
  }

  let site = siteOf(first.hostname);
  let queue: URL[] = [first];
  seen.add(pageKey(first));
  while (queue.length && pages.length < maxPages && Date.now() < deadline) {
    const url = queue.shift()!;
    if (!allowedBy(rules, url)) {
      skipped.push({ url: url.toString(), reason: "robots.txt asks robots not to read it" });
      continue;
    }
    let response;
    try {
      response = await fetchPublic(url, { accept: "text/html,application/xhtml+xml", maxBytes: PAGE_BYTES, timeoutMs: Math.min(PAGE_TIMEOUT_MS, Math.max(1_000, deadline - Date.now())) });
    } catch (error) {
      if (pages.length === 0 && url === first) throw error;
      skipped.push({ url: url.toString(), reason: error instanceof PublicFetchError ? error.message : "It couldn't be read." });
      continue;
    }
    // The home page may redirect to another name for the same site ("www.", a new domain).
    if (url === first) site = siteOf(response.url.hostname);
    if (siteOf(response.url.hostname) !== site) {
      skipped.push({ url: url.toString(), reason: "It leads to another website." });
      continue;
    }
    seen.add(pageKey(response.url));
    if (response.status !== 200) {
      if (pages.length === 0 && url === first) throw new PublicFetchError(`The website answered ${response.status}.`);
      skipped.push({ url: url.toString(), reason: `The website answered ${response.status}.` });
      continue;
    }
    if (!/text\/html|application\/xhtml/.test(response.contentType)) {
      skipped.push({ url: url.toString(), reason: "It isn't a web page." });
      continue;
    }
    const html = response.body.toString("utf8");
    const { title, text } = htmlToText(html);
    const fingerprint = createHash("sha256").update(text).digest("hex");
    if (text.length < MIN_TEXT) {
      skipped.push({ url: response.url.toString(), reason: "It has no text to read (it may need JavaScript)." });
    } else if (texts.has(fingerprint)) {
      skipped.push({ url: response.url.toString(), reason: "The same text as another page." });
    } else {
      texts.add(fingerprint);
      pages.push({ url: response.url.toString(), title: (title ?? "").trim() || response.url.pathname, text, description: descriptionOf(html) });
    }
    const next = linksOn(html, response.url).filter((link) => {
      const key = pageKey(link);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    queue = [...queue, ...next].sort((a, b) => score(a) - score(b));
  }
  if (!pages.length) throw new PublicFetchError(skipped[0]?.reason ?? "No page on the website had text to read.");
  return { site, pages, skipped };
}

/**
 * Titles for the pages' knowledge sources: the page's title, told apart by
 * its address when two pages share one (every page titled "Coral Cove").
 */
export function pageTitles(pages: WebsitePage[]): string[] {
  const counts = new Map<string, number>();
  for (const page of pages) counts.set(page.title, (counts.get(page.title) ?? 0) + 1);
  const used = new Set<string>();
  return pages.map((page) => {
    const path = decodeURIComponent(new URL(page.url).pathname).replace(/\/+$/, "") || "/";
    let title = (counts.get(page.title) ?? 0) > 1 ? `${page.title} (${path === "/" ? "home" : path})` : page.title;
    title = title.slice(0, 200);
    for (let n = 2; used.has(title); n += 1) title = `${title.slice(0, 190)} (${n})`;
    used.add(title);
    return title;
  });
}

/** What kind of knowledge a page probably is, from its address and title. */
export function kindOfPage(page: Pick<WebsitePage, "url" | "title">): KnowledgeKind {
  const words = `${decodeURIComponent(new URL(page.url).pathname).replace(/[/_-]+/g, " ")} ${page.title}`.toLowerCase();
  if (/\b(menu|menus|food|drinks|wine list)\b/.test(words)) return "menu";
  if (/\b(faq|faqs|questions)\b/.test(words)) return "faq";
  if (/\b(polic(y|ies)|terms|conditions|cancellation|house rules|privacy)\b/.test(words)) return "policy";
  return "page";
}
