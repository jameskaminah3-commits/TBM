import type { Request } from "express";
import type { BlogPost, Car, Cook, Errand, Experience, Stay } from "@shared/schema";
import { getHelpMamaStartingPrice, hasHelpMamaPricing } from "@shared/errand-pricing";
import {
  buildListingSeoDescription,
  formatSeoLocation,
  getListingSeoTitle,
  getPublicListingPath,
} from "@shared/seo";
import { storage } from "./storage";

type ListingKind = "stay" | "car" | "cook" | "errand" | "experience";
type ParsedListingRoute = { kind: ListingKind; id: string; isShortLink?: boolean; publicPath?: boolean };
type ShareCurrency = "USD" | "KES";

type ShareMetadata = {
  title: string;
  description: string;
  imageUrl: string;
  canonicalUrl: string;
  type: "article" | "website";
  robots?: string;
  statusCode?: number;
  structuredData?: Record<string, unknown> | null;
  publishedTime?: string | null;
  modifiedTime?: string | null;
  author?: string | null;
};

const siteName = "Tembea Bila Matata";
const defaultTitle = "Tembea Bila Matata - Travel Local, Stay Easy";
const defaultDescription =
  "Book curated stays, cars, private chefs, errands, and experiences across Kenya with Tembea Bila Matata.";
const defaultImagePath = "/tembeabilamatata-logo.jpg";
const sharePreviewUsdToKes = 130;

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

function getShareCurrency(req: Request): ShareCurrency {
  const value = Array.isArray(req.query.currency) ? req.query.currency[0] : req.query.currency;
  return value === "KES" ? "KES" : "USD";
}

function formatShareAmount(amount: number | null | undefined, suffix: string, currency: ShareCurrency) {
  if (!amount || amount <= 0) {
    return null;
  }

  if (currency === "KES") {
    return `KSh ${Math.round(amount * sharePreviewUsdToKes).toLocaleString("en-KE")}${suffix}`;
  }

  return `$${amount.toLocaleString("en-US")}${suffix}`;
}

function joinDetails(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(" · ");
}

function buildStayMetadata(stay: Stay, baseUrl: string, canonicalUrl: string, currency: ShareCurrency): ShareMetadata {
  const location = formatSeoLocation(stay.location);
  const details = joinDetails([
    location,
    `${stay.bedrooms}-bedroom accommodation with ${stay.bathrooms} bathrooms`,
    formatShareAmount(stay.price, " per night", currency),
    `up to ${stay.maxOccupancy} guest${stay.maxOccupancy === 1 ? "" : "s"}`,
  ]);

  return {
    title: getListingSeoTitle("stay", stay.title, stay.location),
    description: buildListingSeoDescription([details, stay.description]),
    imageUrl: getListingImage(stay, baseUrl),
    canonicalUrl,
    type: "website",
  };
}

function buildCarMetadata(car: Car, baseUrl: string, canonicalUrl: string, currency: ShareCurrency): ShareMetadata {
  const location = formatSeoLocation(car.location);
  const details = joinDetails([
    location,
    "car hire",
    formatShareAmount(car.priceWithDriverHourly, "/hour chauffeur", currency),
    formatShareAmount(car.pricePerDay, "/day self-drive", currency),
    `${car.seats} seats`,
    car.transmission,
  ]);

  return {
    title: getListingSeoTitle("car", `${car.make ? `${car.make} ` : ""}${car.model}`, car.location),
    description: buildListingSeoDescription([details, car.description]),
    imageUrl: getListingImage(car, baseUrl),
    canonicalUrl,
    type: "website",
  };
}

function buildCookMetadata(cook: Cook, baseUrl: string, canonicalUrl: string, currency: ShareCurrency): ShareMetadata {
  const location = formatSeoLocation(cook.location);
  const details = joinDetails([
    location,
    cook.serviceType,
    cook.speciality,
    formatShareAmount(cook.serviceFee || cook.pricePerSession, " service fee", currency),
    `up to ${cook.maxGuests} guests`,
  ]);

  return {
    title: getListingSeoTitle("cook", cook.title, cook.location),
    description: buildListingSeoDescription([details, cook.description]),
    imageUrl: getListingImage(cook, baseUrl),
    canonicalUrl,
    type: "website",
  };
}

function buildErrandMetadata(errand: Errand, baseUrl: string, canonicalUrl: string, currency: ShareCurrency): ShareMetadata {
  const location = formatSeoLocation(errand.location);
  const services = [
    errand.shoppingEnabled ? "shopping" : null,
    errand.laundryEnabled ? "laundry" : null,
    errand.houseCleaningEnabled ? "house cleaning" : null,
  ];
  const details = joinDetails([
    location,
    hasHelpMamaPricing(errand)
      ? formatShareAmount(getHelpMamaStartingPrice(errand.helpMamaPricing), " starting Help Mama rate", currency)
      : formatShareAmount(errand.basePrice, " base fee", currency),
    ...services,
  ]);

  return {
    title: getListingSeoTitle("errand", errand.serviceName, errand.location),
    description: buildListingSeoDescription([details, errand.description]),
    imageUrl: getListingImage(errand, baseUrl),
    canonicalUrl,
    type: "website",
  };
}

function buildExperienceMetadata(experience: Experience, baseUrl: string, canonicalUrl: string, currency: ShareCurrency): ShareMetadata {
  const location = formatSeoLocation(experience.experienceLocation || experience.location);
  const details = joinDetails([
    location,
    experience.experienceType,
    formatShareAmount(experience.privatePricePerPerson || experience.price, " per person", currency),
    `${experience.durationHours} hour${experience.durationHours === 1 ? "" : "s"}`,
  ]);

  return {
    title: getListingSeoTitle("experience", experience.title, experience.experienceLocation || experience.location),
    description: buildListingSeoDescription([details, experience.description]),
    imageUrl: getListingImage(experience, baseUrl),
    canonicalUrl,
    type: "website",
  };
}

function getListingName(kind: ListingKind, listing: Stay | Car | Cook | Errand | Experience) {
  if (kind === "stay") return (listing as Stay).title;
  if (kind === "car") {
    const car = listing as Car;
    return `${car.make ? `${car.make} ` : ""}${car.model}`.trim();
  }
  if (kind === "cook") return (listing as Cook).title;
  if (kind === "errand") return (listing as Errand).serviceName;
  return (listing as Experience).title;
}

function getListingStructuredData(
  kind: ListingKind,
  listing: Stay | Car | Cook | Errand | Experience,
  canonicalUrl: string,
) {
  const name = getListingName(kind, listing);
  const location = formatSeoLocation("experienceLocation" in listing
    ? listing.experienceLocation || listing.location
    : listing.location);
  const type = kind === "stay" ? "LodgingBusiness" : kind === "car" ? "Car" : kind === "experience" ? "TouristAttraction" : "Service";
  const structuredData: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": type,
    name,
    description: truncate(listing.description, 320),
    url: canonicalUrl,
    areaServed: { "@type": "Place", name: location || "Mombasa, Kenya" },
    address: { "@type": "PostalAddress", addressLocality: location, addressCountry: "KE" },
    provider: { "@type": "Organization", name: siteName, url: canonicalUrl.split("/").slice(0, 3).join("/") },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: canonicalUrl.split("/").slice(0, 3).join("/") },
        { "@type": "ListItem", position: 2, name: kind === "stay" ? "Accommodation in Mombasa and Nyali" : `${kind} services in Mombasa`, item: canonicalUrl.split("/").slice(0, 3).join("/") },
        { "@type": "ListItem", position: 3, name, item: canonicalUrl },
      ],
    },
  };

  const imageUrl = getListingImage(listing, canonicalUrl.split("/").slice(0, 3).join("/"));
  if (imageUrl) structuredData.image = imageUrl;
  if (listing.rating > 0 && listing.reviewCount > 0) {
    structuredData.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: listing.rating,
      reviewCount: listing.reviewCount,
    };
  }

  if (kind === "stay") {
    const stay = listing as Stay;
    structuredData.numberOfRooms = stay.bedrooms;
    structuredData.occupancy = { "@type": "QuantitativeValue", maxValue: stay.maxOccupancy };
    structuredData.offers = { "@type": "Offer", priceCurrency: "USD", price: stay.price, url: canonicalUrl };
  } else if (kind === "car") {
    const car = listing as Car;
    structuredData.vehicleTransmission = car.transmission;
    structuredData.seatingCapacity = car.seats;
    structuredData.offers = { "@type": "Offer", priceCurrency: "USD", price: car.pricePerDay || car.priceWithDriver, url: canonicalUrl };
  } else if (kind === "cook") {
    const cook = listing as Cook;
    structuredData.serviceType = cook.serviceType;
    structuredData.offers = { "@type": "Offer", priceCurrency: "USD", price: cook.serviceFee || cook.pricePerSession, url: canonicalUrl };
  } else if (kind === "errand") {
    const errand = listing as Errand;
    structuredData.serviceType = "Holiday concierge and errand service";
    structuredData.offers = { "@type": "Offer", priceCurrency: "USD", price: errand.basePrice, url: canonicalUrl };
  } else {
    const experience = listing as Experience;
    structuredData.duration = `PT${experience.durationHours}H`;
    structuredData.offers = { "@type": "Offer", priceCurrency: "USD", price: experience.privatePricePerPerson || experience.sharedPricePerPerson || experience.price, url: canonicalUrl };
  }

  return structuredData;
}

function getStaticMetadata(pathname: string, baseUrl: string): ShareMetadata | null {
  const metadata: Record<string, { title: string; description: string }> = {
    "/": {
      title: "Mombasa Stays, Car Hire, Private Chefs & Concierge Services | Tembea Bila Matata",
      description: "Discover curated accommodation, car hire, private chefs, holiday errands and coastal experiences in Mombasa, Nyali and across the Kenyan Coast.",
    },
    "/accommodations": {
      title: "Accommodation in Mombasa & Nyali | Furnished Apartments and Holiday Stays",
      description: "Browse curated furnished apartments, holiday homes and short-stay accommodation in Mombasa, Nyali and the Kenyan Coast.",
    },
    "/services/drive": {
      title: "Car Hire, Self-Drive & Chauffeur Service in Mombasa | Tembea Bila Matata",
      description: "Find self-drive cars, chauffeur-driven vehicles, airport transfers and coastal transport in Mombasa, Nyali and nearby destinations.",
    },
    "/services/dine": {
      title: "Private Chefs and In-Villa Dining in Mombasa & Nyali",
      description: "Book a private chef, personal cook or in-villa dining experience in Mombasa, Nyali and across the Kenyan Coast.",
    },
    "/services/relax": {
      title: "Concierge, Errand and In-Villa Family Services in Mombasa",
      description: "Arrange holiday errands, shopping, laundry, housekeeping and in-villa childcare support across Mombasa and the Kenyan Coast.",
    },
    "/services/experience": {
      title: "Coastal Experiences, Tours and Activities in Mombasa",
      description: "Explore curated coastal experiences, local activities and memorable outings from Mombasa, Nyali and the wider Kenyan Coast.",
    },
    "/services": {
      title: "Coastal Travel Services in Mombasa | Tembea Bila Matata",
      description: "Plan a smoother coastal stay with accommodation, transport, private dining, errands and experiences in Mombasa and Nyali.",
    },
    "/blog": {
      title: "Mombasa and Kenyan Coast Travel Journal | Tembea Bila Matata",
      description: "Local guides and practical travel advice for stays, transport, dining, family support and experiences in Mombasa and along the Kenyan Coast.",
    },
    "/about": {
      title: "About Tembea Bila Matata | Mombasa Coastal Concierge",
      description: "Learn how Tembea Bila Matata combines curated stays and practical concierge services for travellers in Mombasa and the Kenyan Coast.",
    },
    "/contact": {
      title: "Contact Tembea Bila Matata | Mombasa and Kenyan Coast",
      description: "Contact Tembea Bila Matata for accommodation, transport, private chef, concierge and coastal travel support.",
    },
    "/faq": {
      title: "Frequently Asked Questions | Tembea Bila Matata",
      description: "Find answers about booking stays, transport, chefs, errands, experiences and concierge services in Mombasa and the Kenyan Coast.",
    },
  };
  const item = metadata[pathname];
  if (!item) return null;
  return {
    ...item,
    imageUrl: `${baseUrl}${defaultImagePath}`,
    canonicalUrl: `${baseUrl}${pathname === "/" ? "/" : pathname}`,
    type: "website",
    structuredData: pathname === "/" ? {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          name: siteName,
          url: baseUrl,
          areaServed: ["Mombasa", "Nyali", "Bamburi", "Shanzu", "Diani", "Kilifi", "Watamu", "Kenyan Coast"],
        },
        {
          "@type": "WebSite",
          name: siteName,
          url: baseUrl,
          description: item.description,
        },
      ],
    } : null,
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

  const publicMatch = /^\/(accommodation|transport|chef|errand|experience)\/([^/?#]+)(?:\/[^/?#]+)?\/?$/.exec(pathname);
  if (publicMatch) {
    const publicKindMap: Record<string, ListingKind> = {
      accommodation: "stay",
      transport: "car",
      chef: "cook",
      errand: "errand",
      experience: "experience",
    };
    return {
      kind: publicKindMap[publicMatch[1]],
      id: decodeURIComponent(publicMatch[2]),
      publicPath: true,
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

function getRobotsForPath(pathname: string) {
  if (/^\/(?:book(?:ings)?|b\/|auth(?:\/|$)|admin(?:\/|$)|provider(?:\/|$)|inbox(?:\/|$))/.test(pathname)) {
    return "noindex,follow";
  }
  return "index,follow";
}

function defaultMetadata(req: Request): ShareMetadata {
  const baseUrl = getRequestBaseUrl(req);
  const staticMetadata = getStaticMetadata(req.path, baseUrl);
  if (staticMetadata) {
    return { ...staticMetadata, robots: getRobotsForPath(req.path) };
  }
  return {
    title: defaultTitle,
    description: defaultDescription,
    imageUrl: `${baseUrl}${defaultImagePath}`,
    canonicalUrl: `${baseUrl}${req.path === "/" ? "/" : req.path}`,
    type: "website",
    robots: getRobotsForPath(req.path),
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
        return { ...fallback, robots: "noindex,follow", statusCode: 404 };
      }

      const metadata = buildBlogMetadata(post, baseUrl);
      metadata.structuredData = {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: post.seoTitle || post.title,
        description: truncate(post.seoDescription || post.excerpt || post.contentMarkdown, 320),
        image: post.featuredImage ? [toAbsoluteUrl(post.featuredImage, baseUrl)] : undefined,
        datePublished: post.publishedAt || undefined,
        dateModified: post.updatedAt || undefined,
        author: { "@type": "Person", name: post.author },
        mainEntityOfPage: metadata.canonicalUrl,
        breadcrumb: {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: baseUrl },
            { "@type": "ListItem", position: 2, name: "Travel Journal", item: `${baseUrl}/blog` },
            { "@type": "ListItem", position: 3, name: post.title, item: metadata.canonicalUrl },
          ],
        },
      };
      return metadata;
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
  const currency = getShareCurrency(req);

  try {
    if (route.kind === "stay") {
      const stay = await resolveListing(route) as Stay | undefined;
      if (!isPublicListing(stay)) {
        return { ...fallback, robots: "noindex,follow", statusCode: 404 };
      }
      const canonicalUrl = `${baseUrl}${getPublicListingPath("stay", stay.id, stay.title)}`;
      const metadata = buildStayMetadata(stay, baseUrl, canonicalUrl, currency);
      metadata.robots = route.publicPath ? "index,follow" : "noindex,follow";
      metadata.structuredData = getListingStructuredData("stay", stay, canonicalUrl);
      return metadata;
    }

    if (route.kind === "car") {
      const car = await resolveListing(route) as Car | undefined;
      if (!isPublicListing(car)) {
        return { ...fallback, robots: "noindex,follow", statusCode: 404 };
      }
      const canonicalUrl = `${baseUrl}${getPublicListingPath("car", car.id, getListingName("car", car))}`;
      const metadata = buildCarMetadata(car, baseUrl, canonicalUrl, currency);
      metadata.robots = route.publicPath ? "index,follow" : "noindex,follow";
      metadata.structuredData = getListingStructuredData("car", car, canonicalUrl);
      return metadata;
    }

    if (route.kind === "cook") {
      const cook = await resolveListing(route) as Cook | undefined;
      if (!isPublicListing(cook)) {
        return { ...fallback, robots: "noindex,follow", statusCode: 404 };
      }
      const canonicalUrl = `${baseUrl}${getPublicListingPath("cook", cook.id, cook.title)}`;
      const metadata = buildCookMetadata(cook, baseUrl, canonicalUrl, currency);
      metadata.robots = route.publicPath ? "index,follow" : "noindex,follow";
      metadata.structuredData = getListingStructuredData("cook", cook, canonicalUrl);
      return metadata;
    }

    if (route.kind === "errand") {
      const errand = await resolveListing(route) as Errand | undefined;
      if (!isPublicListing(errand)) {
        return { ...fallback, robots: "noindex,follow", statusCode: 404 };
      }
      const canonicalUrl = `${baseUrl}${getPublicListingPath("errand", errand.id, errand.serviceName)}`;
      const metadata = buildErrandMetadata(errand, baseUrl, canonicalUrl, currency);
      metadata.robots = route.publicPath ? "index,follow" : "noindex,follow";
      metadata.structuredData = getListingStructuredData("errand", errand, canonicalUrl);
      return metadata;
    }

    const experience = await resolveListing(route) as Experience | undefined;
    if (!isPublicListing(experience)) {
      return { ...fallback, robots: "noindex,follow", statusCode: 404 };
    }
    const canonicalUrl = `${baseUrl}${getPublicListingPath("experience", experience.id, experience.title)}`;
    const metadata = buildExperienceMetadata(experience, baseUrl, canonicalUrl, currency);
    metadata.robots = route.publicPath ? "index,follow" : "noindex,follow";
    metadata.structuredData = getListingStructuredData("experience", experience, canonicalUrl);
    return metadata;
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
  const cspNonce = /<meta\s+name="csp-nonce"\s+content="([^"]*)"/i.exec(html)?.[1] ?? "";
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
    metaTag("name", "robots", metadata.robots || "index,follow"),
    getGoogleSiteVerificationTag(),
    `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}" />`,
    metadata.structuredData
      ? `<script type="application/ld+json" data-seo-structured="true"${cspNonce ? ` nonce="${escapeHtml(cspNonce)}"` : ""}>${JSON.stringify(metadata.structuredData).replace(/</g, "\\u003c")}</script>`
      : null,
  ].filter(Boolean).join("\n    ");

  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[\s\S]*?"\s*\/?>/i, metaTag("name", "description", metadata.description))
    .replace("</head>", `    ${tags}\n  </head>`);
}
