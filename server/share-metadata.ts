import type { Request } from "express";
import type { BlogPost, Car, Cook, Errand, Experience, Stay } from "@shared/schema";
import { getHelpMamaStartingPrice, hasHelpMamaPricing } from "@shared/errand-pricing";
import { storage } from "./storage";

type ListingKind = "stay" | "car" | "cook" | "errand" | "experience";
type ParsedListingRoute = { kind: ListingKind; id: string; isShortLink?: boolean };

type ShareMetadata = {
  title: string;
  description: string;
  imageUrl: string;
  canonicalUrl: string;
  type: "article" | "website";
  publishedTime?: string | null;
  modifiedTime?: string | null;
  author?: string | null;
};

const siteName = "Tembea Bila Matata";
const defaultTitle = "Tembea Bila Matata - Travel Local, Stay Easy";
const defaultDescription =
  "Book curated stays, cars, private chefs, errands, and experiences across Kenya with Tembea Bila Matata.";
const defaultImagePath = "/tembeabilamatata-logo.jpg";

function isPublicListing<T extends { isPublic: boolean; managerUserId?: string | null }>(
  listing: T | null | undefined,
): listing is T {
  return Boolean(listing?.isPublic && listing.managerUserId?.trim());
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ");
}

function stripMarkdown(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#-]+/g, " ");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  const normalized = normalizeWhitespace(stripMarkdown(stripHtml(value)));
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const clipped = normalized.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 80 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}...`;
}

function getRequestBaseUrl(req: Request) {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
}

function toAbsoluteUrl(url: string | null | undefined, baseUrl: string) {
  const value = url?.trim();
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) {
    return `${baseUrl}${defaultImagePath}`;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  return `${baseUrl}${value.startsWith("/") ? value : `/${value}`}`;
}

function getListingImage(
  listing: { imageUrl?: string | null; galleryUrls?: string[] | null; mediaType?: string | null },
  baseUrl: string,
) {
  const firstImage = [listing.imageUrl, ...(listing.galleryUrls ?? [])].find((url) => {
    if (!url?.trim()) {
      return false;
    }

    return !/\.(mp4|webm|mov)(\?.*)?$/i.test(url.trim());
  });

  return toAbsoluteUrl(listing.mediaType === "video" ? firstImage : (firstImage ?? listing.imageUrl), baseUrl);
}

function formatUsd(amount: number | null | undefined, suffix: string) {
  if (!amount || amount <= 0) {
    return null;
  }

  return `$${amount.toLocaleString("en-US")}${suffix}`;
}

function joinDetails(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(" · ");
}

function buildStayMetadata(stay: Stay, baseUrl: string, canonicalUrl: string): ShareMetadata {
  const details = joinDetails([
    stay.location,
    formatUsd(stay.price, " per night"),
    `${stay.bedrooms} bedroom${stay.bedrooms === 1 ? "" : "s"}`,
    `up to ${stay.maxOccupancy} guest${stay.maxOccupancy === 1 ? "" : "s"}`,
  ]);

  return {
    title: `${stay.title} | ${siteName}`,
    description: truncate([details, stay.description].filter(Boolean).join(". "), 220),
    imageUrl: getListingImage(stay, baseUrl),
    canonicalUrl,
    type: "website",
  };
}

function buildCarMetadata(car: Car, baseUrl: string, canonicalUrl: string): ShareMetadata {
  const details = joinDetails([
    car.location,
    formatUsd(car.priceWithDriverHourly, "/hour chauffeur"),
    formatUsd(car.pricePerDay, "/day self-drive"),
    `${car.seats} seats`,
    car.transmission,
  ]);

  return {
    title: `${car.model} | Drive with ${siteName}`,
    description: truncate([details, car.description].filter(Boolean).join(". "), 220),
    imageUrl: getListingImage(car, baseUrl),
    canonicalUrl,
    type: "website",
  };
}

function buildCookMetadata(cook: Cook, baseUrl: string, canonicalUrl: string): ShareMetadata {
  const details = joinDetails([
    cook.location,
    cook.serviceType,
    cook.speciality,
    formatUsd(cook.serviceFee || cook.pricePerSession, " service fee"),
    `up to ${cook.maxGuests} guests`,
  ]);

  return {
    title: `${cook.title} | Dine with ${siteName}`,
    description: truncate([details, cook.description].filter(Boolean).join(". "), 220),
    imageUrl: getListingImage(cook, baseUrl),
    canonicalUrl,
    type: "website",
  };
}

function buildErrandMetadata(errand: Errand, baseUrl: string, canonicalUrl: string): ShareMetadata {
  const services = [
    errand.shoppingEnabled ? "shopping" : null,
    errand.laundryEnabled ? "laundry" : null,
    errand.houseCleaningEnabled ? "house cleaning" : null,
  ];
  const details = joinDetails([
    errand.location,
    hasHelpMamaPricing(errand)
      ? formatUsd(getHelpMamaStartingPrice(errand.helpMamaPricing), " starting Help Mama rate")
      : formatUsd(errand.basePrice, " base fee"),
    ...services,
  ]);

  return {
    title: `${errand.serviceName} | Relax with ${siteName}`,
    description: truncate([details, errand.description].filter(Boolean).join(". "), 220),
    imageUrl: getListingImage(errand, baseUrl),
    canonicalUrl,
    type: "website",
  };
}

function buildExperienceMetadata(experience: Experience, baseUrl: string, canonicalUrl: string): ShareMetadata {
  const details = joinDetails([
    experience.experienceLocation || experience.location,
    experience.experienceType,
    formatUsd(experience.privatePricePerPerson || experience.price, " per person"),
    `${experience.durationHours} hour${experience.durationHours === 1 ? "" : "s"}`,
  ]);

  return {
    title: `${experience.title} | Experience with ${siteName}`,
    description: truncate([details, experience.description].filter(Boolean).join(". "), 220),
    imageUrl: getListingImage(experience, baseUrl),
    canonicalUrl,
    type: "website",
  };
}

function parseListingRoute(pathname: string): ParsedListingRoute | null {
  const shortMatch = /^\/b\/([sckrx])\/([^/?#]+)\/?$/.exec(pathname);
  if (shortMatch) {
    const shortKindMap: Record<string, ListingKind> = {
      s: "stay",
      c: "car",
      k: "cook",
      r: "errand",
      x: "experience",
    };

    return {
      kind: shortKindMap[shortMatch[1]],
      id: decodeURIComponent(shortMatch[2]),
      isShortLink: true,
    };
  }

  const stayMatch = /^\/accommodation\/([^/?#]+)\/?$/.exec(pathname);
  if (stayMatch) {
    return { kind: "stay", id: decodeURIComponent(stayMatch[1]) };
  }

  const legacyStayMatch = /^\/book\/([^/?#]+)\/?$/.exec(pathname);
  if (legacyStayMatch) {
    return { kind: "stay", id: decodeURIComponent(legacyStayMatch[1]) };
  }

  const serviceMatch = /^\/book\/(car|cook|errand|experience)\/([^/?#]+)\/?$/.exec(pathname);
  if (!serviceMatch) {
    return null;
  }

  return {
    kind: serviceMatch[1] as ListingKind,
    id: decodeURIComponent(serviceMatch[2]),
  };
}

function parseBlogRoute(pathname: string) {
  const match = /^\/(?:blog|articles)\/([^/?#]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function buildBlogMetadata(post: BlogPost, baseUrl: string): ShareMetadata {
  const canonicalUrl = `${baseUrl}/blog/${post.slug}`;
  return {
    title: `${post.seoTitle || post.title} | ${siteName}`,
    description: truncate(post.seoDescription || post.excerpt || post.contentMarkdown, 220),
    imageUrl: toAbsoluteUrl(post.featuredImage, baseUrl),
    canonicalUrl,
    type: "article",
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt,
    author: post.author,
  };
}

async function resolveListing(route: ParsedListingRoute) {
  const normalizedId = route.id.toLowerCase();

  if (route.kind === "stay") {
    if (!route.isShortLink) {
      return storage.getStay(route.id);
    }
    return (await storage.getStays()).find((stay) => stay.id.toLowerCase().startsWith(normalizedId));
  }

  if (route.kind === "car") {
    if (!route.isShortLink) {
      return storage.getCar(route.id);
    }
    return (await storage.getCars()).find((car) => car.id.toLowerCase().startsWith(normalizedId));
  }

  if (route.kind === "cook") {
    if (!route.isShortLink) {
      return storage.getCook(route.id);
    }
    return (await storage.getCooks()).find((cook) => cook.id.toLowerCase().startsWith(normalizedId));
  }

  if (route.kind === "errand") {
    if (!route.isShortLink) {
      return storage.getErrand(route.id);
    }
    return (await storage.getErrands()).find((errand) => errand.id.toLowerCase().startsWith(normalizedId));
  }

  if (!route.isShortLink) {
    return storage.getExperience(route.id);
  }
  return (await storage.getExperiences()).find((experience) => experience.id.toLowerCase().startsWith(normalizedId));
}

function defaultMetadata(req: Request): ShareMetadata {
  const baseUrl = getRequestBaseUrl(req);
  return {
    title: defaultTitle,
    description: defaultDescription,
    imageUrl: `${baseUrl}${defaultImagePath}`,
    canonicalUrl: `${baseUrl}${req.path === "/" ? "/" : req.path}`,
    type: "website",
  };
}

export async function resolveShareMetadata(req: Request): Promise<ShareMetadata> {
  const fallback = defaultMetadata(req);
  const blogSlug = parseBlogRoute(req.path);
  if (blogSlug) {
    const baseUrl = getRequestBaseUrl(req);
    try {
      const post = await storage.getBlogPostBySlug(blogSlug);
      if (!post || post.status !== "published") {
        return fallback;
      }

      return buildBlogMetadata(post, baseUrl);
    } catch (error) {
      console.error("[SEO] Failed to resolve blog share metadata:", error);
      return fallback;
    }
  }

  const route = parseListingRoute(req.path);
  if (!route) {
    return fallback;
  }

  const baseUrl = getRequestBaseUrl(req);
  const canonicalUrl = `${baseUrl}${req.path}`;

  try {
    if (route.kind === "stay") {
      const stay = await resolveListing(route) as Stay | undefined;
      if (!isPublicListing(stay)) {
        return fallback;
      }
      return buildStayMetadata(stay, baseUrl, canonicalUrl);
    }

    if (route.kind === "car") {
      const car = await resolveListing(route) as Car | undefined;
      if (!isPublicListing(car)) {
        return fallback;
      }
      return buildCarMetadata(car, baseUrl, canonicalUrl);
    }

    if (route.kind === "cook") {
      const cook = await resolveListing(route) as Cook | undefined;
      if (!isPublicListing(cook)) {
        return fallback;
      }
      return buildCookMetadata(cook, baseUrl, canonicalUrl);
    }

    if (route.kind === "errand") {
      const errand = await resolveListing(route) as Errand | undefined;
      if (!isPublicListing(errand)) {
        return fallback;
      }
      return buildErrandMetadata(errand, baseUrl, canonicalUrl);
    }

    const experience = await resolveListing(route) as Experience | undefined;
    if (!isPublicListing(experience)) {
      return fallback;
    }
    return buildExperienceMetadata(experience, baseUrl, canonicalUrl);
  } catch (error) {
    console.error("[SEO] Failed to resolve listing share metadata:", error);
    return fallback;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function metaTag(attribute: "name" | "property", key: string, content: string) {
  return `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`;
}

function getGoogleSiteVerificationTag() {
  const verificationCode = (
    process.env.GOOGLE_SITE_VERIFICATION
    ?? process.env.GOOGLE_SEARCH_CONSOLE_VERIFICATION
    ?? ""
  ).trim();

  if (!verificationCode) {
    return null;
  }

  return metaTag("name", "google-site-verification", verificationCode);
}

export function injectShareMetadata(html: string, metadata: ShareMetadata) {
  const tags = [
    metaTag("property", "og:site_name", siteName),
    metaTag("property", "og:title", metadata.title),
    metaTag("property", "og:description", metadata.description),
    metaTag("property", "og:type", metadata.type),
    metaTag("property", "og:url", metadata.canonicalUrl),
    metaTag("property", "og:image", metadata.imageUrl),
    metaTag("property", "og:image:secure_url", metadata.imageUrl),
    metaTag("property", "og:image:alt", metadata.title),
    metaTag("name", "twitter:card", "summary_large_image"),
    metaTag("name", "twitter:title", metadata.title),
    metaTag("name", "twitter:description", metadata.description),
    metaTag("name", "twitter:image", metadata.imageUrl),
    metadata.publishedTime ? metaTag("property", "article:published_time", metadata.publishedTime) : null,
    metadata.modifiedTime ? metaTag("property", "article:modified_time", metadata.modifiedTime) : null,
    metadata.author ? metaTag("property", "article:author", metadata.author) : null,
    getGoogleSiteVerificationTag(),
    `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}" />`,
  ].filter(Boolean).join("\n    ");

  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[\s\S]*?"\s*\/?>/i, metaTag("name", "description", metadata.description))
    .replace("</head>", `    ${tags}\n  </head>`);
}
