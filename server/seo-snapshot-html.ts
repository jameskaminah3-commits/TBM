// The HTML pieces of a page's crawlable content (server/seo-snapshot.ts):
// plain, escaped, and only what the page itself shows. Pure, so it's tested
// (seo-snapshot-html.test.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BlogPost } from "../shared/schema.ts";
import { areaPageHeading, seoServiceByKind, type SeoArea, type SeoListingInput } from "../shared/listing-seo.ts";
import { photoVariantPath } from "../shared/photo-variants.ts";
import { formatRating } from "../shared/review-eligibility.ts";
import { cleanInternalHref } from "../shared/internal-links.ts";
import type { PublicReview } from "../shared/public-review.ts";

export function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const link = (href: string, label: string) => `<a href="${esc(href)}">${esc(label)}</a>`;
export const paragraphs = (text: string) => text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).map((part) => `<p>${esc(part)}</p>`).join("");
const isVideo = (url: string) => /\.(mp4|webm|mov)(\?.*)?$/i.test(url);

export type SnapshotAreaLink = { path: string; heading: string; count: number };
export type SnapshotCard = { name: string; path: string; location: string; rating: number | null; reviewCount: number };

export const siteSections: Array<[string, string]> = [
  ["/accommodations", "Places to stay"],
  ["/services/drive", "Car hire and drivers"],
  ["/services/dine", "Private chefs"],
  ["/services/relax", "Home help"],
  ["/services/experience", "Experiences"],
  ["/verify", "Check a listing before you pay"],
  ["/blog", "Travel Journal"],
];

/** The page's content between the site's own links and the area pages. */
export function snapshotFrame(main: string, areas: SnapshotAreaLink[]) {
  const nav = `<nav aria-label="Site">${[link("/", "Tembea Bila Matata"), ...siteSections.map(([href, label]) => link(href, label))].join(" · ")}</nav>`;
  const explore = areas.length
    ? `<footer><h2>Explore the Kenyan Coast</h2><ul>${areas.map((area) => `<li>${link(area.path, area.heading)} (${area.count})</li>`).join("")}</ul></footer>`
    : "";
  return `<div class="seo-snapshot" data-seo-snapshot="true">${nav}<main>${main}</main>${explore}</div>`;
}

export function breadcrumb(items: Array<{ label: string; path?: string }>) {
  return `<nav aria-label="Breadcrumb">${items.map((item) => (item.path ? link(item.path, item.label) : `<span>${esc(item.label)}</span>`)).join(" › ")}</nav>`;
}

function ratingText(rating: number | null, reviewCount: number) {
  return rating ? `Rated ${formatRating(rating)} from ${reviewCount} guest review${reviewCount === 1 ? "" : "s"}` : "";
}

export function cardList(cards: SnapshotCard[]) {
  return `<ul>${cards.map((card) => {
    const rating = ratingText(card.rating, card.reviewCount);
    return `<li>${link(card.path, card.name)}${card.location ? `, ${esc(card.location)}` : ""}${rating ? `. ${esc(rating)}` : ""}</li>`;
  }).join("")}</ul>`;
}

/** What a listing is, in a line or two of facts: bedrooms, seats, how long. */
export function listingFacts(input: SeoListingInput): string[] {
  const facts: string[] = [];
  if (input.stay) {
    if (input.stay.hotel) facts.push(input.stay.starRating ? `${input.stay.starRating}-star hotel` : "Hotel");
    else if (input.stay.bedrooms) facts.push(`${input.stay.bedrooms} bedroom${input.stay.bedrooms === 1 ? "" : "s"}`);
    if (input.stay.maxGuests) facts.push(`Sleeps ${input.stay.maxGuests}`);
  }
  if (input.car) {
    if (input.car.seats) facts.push(`${input.car.seats} seats`);
    facts.push(input.car.selfDrive ? "Self-drive or with a driver" : "With a driver");
    facts.push(...input.car.services.slice(0, 4));
  }
  if (input.cook?.speciality) facts.push(input.cook.speciality);
  if (input.errand) {
    const services = [
      input.errand.cleaning && "House cleaning",
      input.errand.laundry && "Laundry",
      input.errand.shopping && "Shopping",
      input.errand.childcare && "Childcare (Help Mama)",
    ].filter((value): value is string => Boolean(value));
    facts.push(...services);
  }
  if (input.experience) {
    if (input.experience.type) facts.push(input.experience.type);
    if (input.experience.durationHours) facts.push(`${input.experience.durationHours} hour${input.experience.durationHours === 1 ? "" : "s"}`);
    if (input.experience.private) facts.push("Private group");
    if (input.experience.shared) facts.push("Shared departures");
    if (input.experience.meetingPoint) facts.push(`Meets at ${input.experience.meetingPoint}`);
  }
  return facts.filter(Boolean);
}

export type ListingSnapshotInput = {
  input: SeoListingInput;
  crumb: { label: string; path: string };
  categoryPath: string;
  categoryLabel: string;
  imageAlts: Record<string, string>;
  rating: number | null;
  reviewCount: number;
  reviews: PublicReview[];
  area: SeoArea | null;
  sameArea: SnapshotCard[];
  areaPage: SnapshotAreaLink | null;
  otherServicesInArea: SnapshotAreaLink[];
};

export function listingSnapshot(data: ListingSnapshotInput) {
  const { input } = data;
  const location = input.experience?.destination || input.location;
  const facts = listingFacts(input);
  const rating = ratingText(data.rating, data.reviewCount);
  const photos = input.photos.filter((url) => !isVideo(url)).slice(0, 6).map((url, index) => {
    const alt = data.imageAlts[url] || `${input.name}${location ? `, ${location}` : ""}${index ? `: photo ${index + 1}` : ""}`;
    return `<img src="${esc(photoVariantPath(url, 1200) ?? url)}" alt="${esc(alt)}" loading="lazy" decoding="async" width="1200">`;
  }).join("");
  const crumbs = [{ label: "Home", path: "/" }, ...(data.crumb.path === data.categoryPath ? [] : [{ label: data.categoryLabel, path: data.categoryPath }]), data.crumb, { label: input.name }];
  const reviews = data.reviews.filter((review) => review.comment?.trim()).slice(0, 5);
  return [
    breadcrumb(crumbs),
    "<article>",
    `<h1>${esc(input.name)}</h1>`,
    location ? `<p>${esc(location)}${data.area && !location.toLowerCase().includes(data.area.name.toLowerCase()) ? `, ${esc(data.area.name)}` : ""}, Kenyan Coast</p>` : "",
    facts.length ? `<p>${facts.map(esc).join(" · ")}</p>` : "",
    rating ? `<p>${esc(rating)}</p>` : "",
    photos,
    input.description.trim() ? `<h2>About ${esc(input.name)}</h2>${paragraphs(input.description)}` : "",
    input.features.length ? `<h2>What's included</h2><ul>${input.features.slice(0, 24).map((feature) => `<li>${esc(feature)}</li>`).join("")}</ul>` : "",
    reviews.length
      ? `<h2>Guest reviews</h2><ul>${reviews.map((review) => `<li><blockquote><p>${esc(review.comment)}</p></blockquote><p>${esc(review.guestName)}, ${esc(review.rating)} out of 5</p></li>`).join("")}</ul>`
      : "",
    "<p>See the price for your dates and book on Tembea Bila Matata. Pay by M-Pesa or card.</p>",
    "</article>",
    data.area && data.sameArea.length
      ? `<section><h2>More ${esc(areaPageHeading(data.area, seoServiceByKind[input.kind]).replace(/^\w/, (letter) => letter.toLowerCase()))}</h2>${cardList(data.sameArea)}${data.areaPage ? `<p>${link(data.areaPage.path, `See all ${data.areaPage.count} on the ${data.areaPage.heading} page`)}</p>` : ""}</section>`
      : data.areaPage ? `<p>${link(data.areaPage.path, data.areaPage.heading)}</p>` : "",
    data.area && data.otherServicesInArea.length
      ? `<section><h2>Also in ${esc(data.area.name)}</h2><ul>${data.otherServicesInArea.map((page) => `<li>${link(page.path, page.heading)} (${page.count})</li>`).join("")}</ul></section>`
      : "",
  ].join("");
}

export function articleListItems(posts: Array<Pick<BlogPost, "slug" | "title" | "excerpt">>) {
  return `<ul>${posts.map((post) => `<li>${link(`/blog/${post.slug}`, post.title)}${post.excerpt ? `: ${esc(post.excerpt)}` : ""}</li>`).join("")}</ul>`;
}

/** An article's text as HTML, its links pointing at each page's one address. */
export function renderArticleMarkdown(markdown: string, liveAreaPaths: ReadonlySet<string>) {
  return renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: [remarkGfm],
    urlTransform: (url: string) => defaultUrlTransform(cleanInternalHref(url, liveAreaPaths)),
    children: markdown,
  }));
}

/** The article without its first line when that line repeats the title as a heading (the page shows the title itself). */
export function withoutLeadingTitle(markdown: string) {
  const lines = markdown.split("\n");
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first === -1 || !/^#\s+/.test(lines[first].trim())) return markdown;
  return [...lines.slice(0, first), ...lines.slice(first + 1)].join("\n").trimStart();
}
