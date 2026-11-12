// Each public page's main content, written into the HTML the server sends.
//
// The site is built in the browser, so the HTML a crawler first receives was
// an empty shell. Google fills it in later by running the page's scripts (when
// it gets round to it); Bing, the AI answer engines (ChatGPT search,
// Perplexity) and link previews mostly don't run scripts at all. This puts the
// page's real words, photos and links in that first HTML: a listing's facts and
// guest reviews, an article's full text, an area's listings, and links from
// every page to the area pages, so each new listing is found, linked and
// indexed from the moment it goes live.
//
// It sits inside #root, below the loading screen, and the app replaces it as
// soon as it starts, so visitors see the page as before. It says only what the
// page itself shows (the same public data the API serves), never more.
import type { Request } from "express";
import type { BlogPost } from "@shared/schema";
import { getPublicListingPath, type PublicListingKind } from "@shared/seo";
import {
  areaPageHeading,
  areaPagePath,
  defaultAreaPageCopy,
  getSeoArea,
  isSeoAreaService,
  listingBreadcrumb,
  listingSeoArea,
  seoCategoryPages,
  seoKindByService,
  seoServiceByKind,
  toPublicListingSeo,
  toSeoListingInput,
} from "@shared/listing-seo";
import { photoVariantPath } from "@shared/photo-variants";
import { staticPageKey, staticPageMetadata } from "@shared/page-metadata";
import { articleSeoArea as articleArea, cleanInternalHref } from "@shared/internal-links";
import type { PublicReview } from "@shared/public-review";
import type { PublicProviderProfile } from "@shared/provider-public";
import {
  articleListItems,
  breadcrumb,
  cardList,
  esc,
  link,
  listingSnapshot,
  paragraphs,
  renderArticleMarkdown,
  siteSections,
  snapshotFrame,
  withoutLeadingTitle,
  type SnapshotAreaLink,
  type SnapshotCard,
} from "./seo-snapshot-html";
import { storage } from "./storage";
import {
  getAreaPageOverride,
  getListingSeoOverride,
  isLiveListing,
  listingAreaKey,
  liveAreaPageCounts,
  loadListings,
  type AnyListing,
} from "./listing-seo-store";
import { getRatingSummary, reviewSource } from "./review-ratings";
import { listPublicReviews } from "./public-reviews";
import { getPublicProviderPage } from "./provider-pages";

// ── Data ────────────────────────────────────────────────────────────────────

const listingKinds: PublicListingKind[] = ["stay", "car", "cook", "errand", "experience"];
const listingPrefixes: Record<string, PublicListingKind> = { accommodation: "stay", transport: "car", chef: "cook", errand: "errand", experience: "experience" };
const cacheMs = 30_000;
let liveCache: { at: number; value: Map<PublicListingKind, AnyListing[]> } | null = null;

/** Every live listing of each kind, kept for half a minute (pages ask often). */
async function liveListings() {
  if (liveCache && Date.now() - liveCache.at < cacheMs) return liveCache.value;
  const lists = await Promise.all(listingKinds.map((kind) => loadListings(kind)));
  const value = new Map(listingKinds.map((kind, index) => [kind, lists[index].filter(isLiveListing)]));
  liveCache = { at: Date.now(), value };
  return value;
}

let postsCache: { at: number; value: BlogPost[] } | null = null;
async function publishedPosts() {
  if (postsCache && Date.now() - postsCache.at < cacheMs) return postsCache.value;
  const value = (await storage.getPublishedBlogPosts()).filter((post) => post.status === "published");
  postsCache = { at: Date.now(), value };
  return value;
}

async function areaLinks(): Promise<SnapshotAreaLink[]> {
  const counts = await liveAreaPageCounts();
  return counts
    .map((entry) => ({ path: areaPagePath(entry.areaKey, entry.service), heading: areaPageHeading(getSeoArea(entry.areaKey)!, entry.service), count: entry.count }))
    .sort((a, b) => b.count - a.count || a.heading.localeCompare(b.heading));
}

const asRecord = (listing: AnyListing) => listing as unknown as Record<string, unknown>;

async function toCards(kind: PublicListingKind, listings: AnyListing[]): Promise<SnapshotCard[]> {
  return Promise.all(listings.map(async (listing) => {
    const input = toSeoListingInput(kind, asRecord(listing));
    const rating = await getRatingSummary(kind, listing.id).catch(() => ({ count: 0, average: null }));
    return { name: input.name, path: getPublicListingPath(kind, listing.id, input.name), location: input.experience?.destination || input.location, rating: rating.average, reviewCount: rating.count };
  }));
}

async function listingPage(kind: PublicListingKind, id: string, areas: SnapshotAreaLink[]) {
  const listing = (await liveListings()).get(kind)?.find((candidate) => candidate.id === id);
  if (!listing) return null;
  const input = toSeoListingInput(kind, asRecord(listing));
  const area = listingSeoArea(input);
  const service = seoServiceByKind[kind];
  const [override, rating, reviews] = await Promise.all([
    getListingSeoOverride(kind, listing.id).catch(() => null),
    getRatingSummary(kind, listing.id).catch(() => ({ count: 0, average: null })),
    listPublicReviews(reviewSource, kind, listing.id).catch(() => [] as PublicReview[]),
  ]);
  const siblings = area
    ? ((await liveListings()).get(kind) ?? []).filter((other) => other.id !== listing.id && listingAreaKey(kind, other) === area.key).slice(0, 6)
    : [];
  const areaPage = area ? areas.find((page) => page.path === areaPagePath(area.key, service)) ?? null : null;
  const category = seoCategoryPages[kind];
  return listingSnapshot({
    input,
    crumb: listingBreadcrumb(kind, area),
    categoryPath: category.path,
    categoryLabel: category.label,
    imageAlts: toPublicListingSeo(override, input.photos)?.imageAlts ?? {},
    rating: rating.average,
    reviewCount: rating.count,
    reviews,
    area,
    sameArea: await toCards(kind, siblings),
    areaPage,
    otherServicesInArea: area ? areas.filter((page) => page.path.startsWith(`/explore/${area.key}/`) && page.path !== areaPagePath(area.key, service)) : [],
  });
}

async function areaPage(areaKey: string, service: string, areas: SnapshotAreaLink[]) {
  const area = getSeoArea(areaKey);
  if (!area || !isSeoAreaService(service)) return null;
  const kind = seoKindByService[service];
  const listings = ((await liveListings()).get(kind) ?? []).filter((listing) => listingAreaKey(kind, listing) === area.key);
  if (!listings.length) return null;
  const override = await getAreaPageOverride(area.key, service).catch(() => null);
  const copy = defaultAreaPageCopy(area, service);
  const heading = override?.heading || copy.heading;
  const category = seoCategoryPages[kind];
  const articles = (await publishedPosts()).filter((post) => articleArea(post)?.key === area.key).slice(0, 6);
  const otherServices = areas.filter((page) => page.path.startsWith(`/explore/${area.key}/`) && page.path !== areaPagePath(area.key, service));
  const otherAreas = areas.filter((page) => page.path.endsWith(`/${service}`) && page.path !== areaPagePath(area.key, service));
  return [
    breadcrumb([{ label: "Home", path: "/" }, { label: category.label, path: category.path }, { label: heading }]),
    `<h1>${esc(heading)}</h1>`,
    paragraphs(override?.intro || copy.intro),
    cardList(await toCards(kind, listings)),
    otherServices.length ? `<section><h2>More in ${esc(area.name)}</h2><ul>${otherServices.map((page) => `<li>${link(page.path, page.heading)} (${page.count})</li>`).join("")}</ul></section>` : "",
    articles.length ? `<section><h2>Read before you go to ${esc(area.name)}</h2>${articleListItems(articles)}</section>` : "",
    otherAreas.length ? `<section><h2>${esc(category.label)} elsewhere on the Coast</h2><ul>${otherAreas.map((page) => `<li>${link(page.path, page.heading)} (${page.count})</li>`).join("")}</ul></section>` : "",
  ].join("");
}

async function articlePage(slug: string, areas: SnapshotAreaLink[]) {
  const post = await storage.getBlogPostBySlug(slug);
  if (!post || post.status !== "published") return null;
  const liveAreaPaths = new Set(areas.map((page) => page.path));
  const area = articleArea(post);
  const stayPage = area ? areas.find((page) => page.path === areaPagePath(area.key, "stays")) : null;
  const stays = area && stayPage
    ? ((await liveListings()).get("stay") ?? []).filter((listing) => listingAreaKey("stay", listing) === area.key).slice(0, 4)
    : [];
  const more = (await publishedPosts()).filter((other) => other.slug !== post.slug).slice(0, 4);
  const date = post.publishedAt ? new Date(post.publishedAt) : null;
  return [
    breadcrumb([{ label: "Home", path: "/" }, { label: "Travel Journal", path: "/blog" }, { label: post.title }]),
    "<article>",
    `<h1>${esc(post.title)}</h1>`,
    `<p>By ${esc(post.author)}${date && !Number.isNaN(date.getTime()) ? `, ${esc(date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi" }))}` : ""}</p>`,
    post.featuredImage ? `<img src="${esc(photoVariantPath(post.featuredImage, 1200) ?? post.featuredImage)}" alt="${esc(post.featuredImageAlt || post.title)}" loading="lazy" decoding="async" width="1200">` : "",
    renderArticleMarkdown(withoutLeadingTitle(post.contentMarkdown), liveAreaPaths),
    post.primaryCtaLabel && post.primaryCtaHref ? `<p>${link(cleanInternalHref(post.primaryCtaHref, liveAreaPaths), post.primaryCtaLabel)}</p>` : "",
    "</article>",
    area && stayPage && stays.length
      ? `<section><h2>Where to stay in ${esc(area.name)}</h2>${cardList(await toCards("stay", stays))}<p>${link(stayPage.path, `See all ${stayPage.count} places to stay in ${area.name}`)}</p></section>`
      : "",
    area ? (() => {
      const others = areas.filter((page) => page.path.startsWith(`/explore/${area.key}/`) && page.path !== stayPage?.path);
      return others.length ? `<section><h2>Plan the rest of your trip to ${esc(area.name)}</h2><ul>${others.map((page) => `<li>${link(page.path, page.heading)}</li>`).join("")}</ul></section>` : "";
    })() : "",
    more.length ? `<section><h2>More from the Travel Journal</h2>${articleListItems(more)}</section>` : "",
  ].join("");
}

async function categoryPage(kind: PublicListingKind, pageKey: string, areas: SnapshotAreaLink[]) {
  const meta = staticPageMetadata[pageKey];
  const listings = (await liveListings()).get(kind) ?? [];
  const service = seoServiceByKind[kind];
  const byArea = areas.filter((page) => page.path.endsWith(`/${service}`));
  return [
    breadcrumb([{ label: "Home", path: "/" }, { label: seoCategoryPages[kind].label }]),
    `<h1>${esc(seoCategoryPages[kind].label)} on the Kenyan Coast</h1>`,
    meta ? `<p>${esc(meta.description)}</p>` : "",
    byArea.length ? `<section><h2>By area</h2><ul>${byArea.map((page) => `<li>${link(page.path, page.heading)} (${page.count})</li>`).join("")}</ul></section>` : "",
    listings.length ? `<section><h2>All ${esc(seoCategoryPages[kind].label.toLowerCase())}</h2>${cardList(await toCards(kind, listings.slice(0, 80)))}</section>` : "",
  ].join("");
}

async function homePage(areas: SnapshotAreaLink[]) {
  const meta = staticPageMetadata["/"];
  const stays = ((await liveListings()).get("stay") ?? []).slice(0, 8);
  const posts = (await publishedPosts()).slice(0, 6);
  return [
    "<h1>Your Kenyan Coast trip, sorted: stays, drivers, chefs and days out</h1>",
    `<p>${esc(meta.description)}</p>`,
    `<section><h2>Plan your trip</h2><ul>${siteSections.map(([href, label]) => `<li>${link(href, label)}</li>`).join("")}</ul></section>`,
    stays.length ? `<section><h2>Places to stay</h2>${cardList(await toCards("stay", stays))}</section>` : "",
    posts.length ? `<section><h2>From the Travel Journal</h2>${articleListItems(posts)}</section>` : "",
  ].join("");
}

async function blogIndex() {
  const posts = await publishedPosts();
  return [
    breadcrumb([{ label: "Home", path: "/" }, { label: "Travel Journal" }]),
    "<h1>Travel Journal: the Kenyan Coast, from people who live here</h1>",
    `<p>${esc(staticPageMetadata["/blog"]?.description ?? "")}</p>`,
    articleListItems(posts),
  ].join("");
}

function providerPage(profile: PublicProviderProfile) {
  const reviews = profile.reviews.filter((review) => review.comment?.trim()).slice(0, 5);
  return [
    breadcrumb([{ label: "Home", path: "/" }, { label: profile.displayName }]),
    `<h1>${esc(profile.displayName)}</h1>`,
    `<p>${esc([profile.serviceTypes.join(", "), profile.serviceAreas.length ? `in ${profile.serviceAreas.join(", ")}` : ""].filter(Boolean).join(" "))}${profile.verified ? ". Verified by TBM" : ""}</p>`,
    profile.about?.trim() ? paragraphs(profile.about) : "",
    profile.listings.length ? `<section><h2>Book with ${esc(profile.displayName)}</h2><ul>${profile.listings.map((listing) => `<li>${link(listing.path, listing.name)}${listing.area ? `, ${esc(listing.area)}` : ""}</li>`).join("")}</ul></section>` : "",
    reviews.length ? `<section><h2>Guest reviews</h2><ul>${reviews.map((review) => `<li><blockquote><p>${esc(review.comment)}</p></blockquote><p>${esc(review.guestName)}, ${esc(review.listingName)}</p></li>`).join("")}</ul></section>` : "",
  ].join("");
}

function plainPage(pageKey: string) {
  const meta = staticPageMetadata[pageKey];
  if (!meta) return null;
  // The title's first part ("About Tembea Bila Matata | Your People…" → "About Tembea Bila Matata").
  return `<h1>${esc(meta.title.split(" | ")[0])}</h1><p>${esc(meta.description)}</p>`;
}

const categoryByPath: Record<string, PublicListingKind> = Object.fromEntries(
  listingKinds.map((kind) => [seoCategoryPages[kind].path, kind]),
) as Record<string, PublicListingKind>;

/**
 * The HTML to put in the page for crawlers, or null for a page that shouldn't
 * have any (private, missing, not indexed, or about to redirect).
 */
export async function buildSeoSnapshot(req: Request, metadata: { robots?: string; statusCode?: number; redirectTo?: string | null }) {
  if (metadata.redirectTo || (metadata.statusCode && metadata.statusCode !== 200) || /noindex/i.test(metadata.robots ?? "")) return null;
  const path = staticPageKey(req.path);
  const areas = await areaLinks().catch(() => [] as SnapshotAreaLink[]);
  let main: string | null = null;

  const listingMatch = /^\/(accommodation|transport|chef|errand|experience)\/([^/?#]+)(?:\/[^/?#]+)?$/.exec(path);
  const areaMatch = /^\/explore\/([a-z-]+)\/([a-z-]+)$/.exec(path);
  const blogMatch = /^\/blog\/([^/?#]+)$/.exec(path);
  const providerMatch = /^\/p\/([^/?#]+)(?:\/[^/?#]+)?$/.exec(path);

  if (listingMatch) main = await listingPage(listingPrefixes[listingMatch[1]], decodeURIComponent(listingMatch[2]), areas);
  else if (areaMatch) main = await areaPage(areaMatch[1], areaMatch[2], areas);
  else if (blogMatch) main = await articlePage(decodeURIComponent(blogMatch[1]), areas);
  else if (path === "/blog") main = await blogIndex();
  else if (path === "/") main = await homePage(areas);
  else if (categoryByPath[path]) main = await categoryPage(categoryByPath[path], path, areas);
  else if (providerMatch) {
    const result = await getPublicProviderPage(decodeURIComponent(providerMatch[1]), { userId: null, isAdmin: false });
    main = result.status === "ok" ? providerPage(result.profile) : null;
  } else main = plainPage(path);

  return main ? snapshotFrame(main, areas) : null;
}

