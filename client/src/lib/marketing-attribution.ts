import {
  marketingAttributionSourceTypes,
  type MarketingAttributionEventType,
  type MarketingAttributionPayload,
  type MarketingAttributionSourceType,
} from "@shared/schema";
import type { PublicListingKind } from "@shared/seo";
import {
  addTouch,
  currentTouch,
  getShareClaim,
  isShareCode,
  touchFromParams,
  type AttributionTouch,
  type ShareChannel,
  type ShareClaim,
} from "@shared/share-attribution";
import { safeLocalStorage } from "./safe-storage";

// One record per source (a share link, an ad, a promo link), newest last, kept
// for 30 days. The latest tagged source wins; direct visits don't replace it.
// See shared/share-attribution.ts for the rules.
const TOUCHES_STORAGE_KEY = "tembea-marketing-touches-v3";
const LEGACY_ATTRIBUTION_STORAGE_KEY = "tembea-marketing-attribution-v2";
const SESSION_STORAGE_KEY = "tembea-marketing-session-v2";
const TRACKED_VIEWS_STORAGE_KEY = "tembea-marketing-tracked-views-v2";

// When the browser blocks storage, safeLocalStorage keeps things for this page
// instead; the share code also travels in the Book link and the sign-in redirect.
const readItem = (key: string) => safeLocalStorage.getItem(key);
const writeItem = (key: string, value: string) => safeLocalStorage.setItem(key, value);
const removeItem = (key: string) => safeLocalStorage.removeItem(key);

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `mkt-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function getCurrentPath() {
  if (typeof window === "undefined") {
    return "/";
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getSameOriginPath(url: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function readTouches(): AttributionTouch[] {
  const raw = readItem(TOUCHES_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((touch) => touch && typeof touch.at === "number") : [];
  } catch {
    removeItem(TOUCHES_STORAGE_KEY);
    return [];
  }
}

function writeTouches(touches: AttributionTouch[]) {
  writeItem(TOUCHES_STORAGE_KEY, JSON.stringify(touches));
}

function readTrackedViews() {
  const raw = readItem(TRACKED_VIEWS_STORAGE_KEY);
  if (!raw) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    removeItem(TRACKED_VIEWS_STORAGE_KEY);
    return [] as string[];
  }
}

function writeTrackedViews(values: string[]) {
  writeItem(TRACKED_VIEWS_STORAGE_KEY, JSON.stringify(values.slice(-200)));
}

function hasMeaningfulMarketingContext(payload: MarketingAttributionPayload) {
  return payload.sourceType !== "direct"
    || Boolean(
      payload.sourceId
      || payload.sourceSlug
      || payload.sourceTitle
      || payload.promoCode
      || payload.utmSource
      || payload.utmMedium
      || payload.utmCampaign
      || payload.utmContent,
    );
}

function buildTrackedViewKey(payload: MarketingAttributionPayload) {
  return [
    payload.sessionId,
    payload.sourceType,
    payload.sourceId ?? "",
    payload.sourceSlug ?? "",
    payload.sourcePath ?? "",
    payload.landingPath ?? getCurrentPath(),
    payload.promoCode ?? "",
    payload.utmCampaign ?? "",
  ].join("::");
}

export function getMarketingSessionId() {
  const existing = readItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const nextId = createId();
  writeItem(SESSION_STORAGE_KEY, nextId);
  return nextId;
}

// The device's id for share visits, only when it can be kept between visits.
// Without one the server falls back to the address (R2, R7).
function getShareDeviceId() {
  return typeof window !== "undefined" && safeLocalStorage.isPersistent() ? getMarketingSessionId() : null;
}

// Record a tagged visit from the current address. Listing and booking pages
// pass which listing it is, so older share links can be credited (R1).
export function captureMarketingQueryParams(context: { listingKind?: PublicListingKind; listingId?: string } = {}) {
  if (typeof window === "undefined") {
    return null;
  }

  // The old merged record is replaced by one record per source.
  if (readItem(LEGACY_ATTRIBUTION_STORAGE_KEY)) {
    removeItem(LEGACY_ATTRIBUTION_STORAGE_KEY);
  }

  const now = Date.now();
  const touch = touchFromParams(new URLSearchParams(window.location.search), {
    listingKind: context.listingKind ?? null,
    listingId: context.listingId ?? null,
    path: getCurrentPath(),
    referrerPath: getSameOriginPath(document.referrer),
  }, now);
  if (!touch) {
    return null;
  }
  writeTouches(addTouch(readTouches(), touch, now));
  return touch;
}

// A source the page knows about without tags in the address, such as a TBM blog post.
export function setMarketingAttributionContext(partial: Partial<MarketingAttributionPayload>) {
  const now = Date.now();
  const touch: AttributionTouch = {
    at: now,
    sourceType: partial.sourceType ?? "campaign",
    sourceId: partial.sourceId ?? null,
    sourceSlug: partial.sourceSlug ?? null,
    sourcePath: partial.sourcePath ?? null,
    sourceTitle: partial.sourceTitle ?? null,
    promoCode: partial.promoCode?.trim().toUpperCase() || null,
    landingPath: partial.landingPath ?? null,
    entryPath: partial.entryPath ?? getCurrentPath(),
    referrerPath: partial.referrerPath ?? null,
    utmSource: partial.utmSource ?? null,
    utmMedium: partial.utmMedium ?? null,
    utmCampaign: partial.utmCampaign ?? null,
    utmContent: partial.utmContent ?? null,
  };
  writeTouches(addTouch(readTouches(), touch, now));
}

// After a booking: a promo isn't offered again, but sources are kept so other
// listings booked in the same visit count as assisted (R9).
export function clearMarketingAttributionContext() {
  writeTouches(readTouches().map((touch) => ({ ...touch, promoCode: null })));
}

export function getMarketingAttributionPayload(overrides: Partial<MarketingAttributionPayload> = {}): MarketingAttributionPayload {
  const current = currentTouch(readTouches(), Date.now());
  const entryPath = overrides.entryPath || current?.entryPath || getCurrentPath();
  const referrerPath = overrides.referrerPath || current?.referrerPath || (typeof document !== "undefined" ? getSameOriginPath(document.referrer) : null);
  const tagged = Boolean(current && (current.utmSource || current.utmMedium || current.utmCampaign || current.promoCode || current.shareCode));
  const knownSourceType = marketingAttributionSourceTypes.find((type) => type === current?.sourceType);

  return {
    sessionId: getMarketingSessionId(),
    sourceType: overrides.sourceType || knownSourceType || (tagged ? "campaign" : "direct"),
    sourceId: overrides.sourceId || current?.sourceId || null,
    sourceSlug: overrides.sourceSlug || current?.sourceSlug || null,
    sourcePath: overrides.sourcePath || current?.sourcePath || (typeof window !== "undefined" ? window.location.pathname : null),
    sourceTitle: overrides.sourceTitle || current?.sourceTitle || null,
    promoCode: overrides.promoCode?.trim().toUpperCase() || current?.promoCode || null,
    landingPath: overrides.landingPath || current?.landingPath || (typeof window !== "undefined" ? window.location.pathname : null),
    referrerPath,
    entryPath,
    utmSource: overrides.utmSource || current?.utmSource || null,
    utmMedium: overrides.utmMedium || current?.utmMedium || null,
    utmCampaign: overrides.utmCampaign || current?.utmCampaign || null,
    utmContent: overrides.utmContent || current?.utmContent || null,
  };
}

// Sent with a booking. The server checks every part of it (R13).
export function getBookingShareClaim(): ShareClaim & { deviceId: string | null } {
  return { ...getShareClaim(readTouches(), Date.now()), deviceId: getShareDeviceId() };
}

// The share code that currently holds the credit on this device, if any.
export function getCurrentShareCode() {
  return getShareClaim(readTouches(), Date.now()).code;
}

// R6: the Book link carries the code too, for browsers that block storage.
export function withShareRef(path: string) {
  const code = getCurrentShareCode();
  if (!code || typeof window === "undefined") {
    return path;
  }
  try {
    const url = new URL(path, window.location.origin);
    if (!url.searchParams.has("ref")) {
      url.searchParams.set("ref", code);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return path;
  }
}

// R2: a visit or Book tap from a share link. Never blocks the page.
export async function trackShareEvent(event: "visit" | "book", code: string | null = getCurrentShareCode(), channel?: string | null) {
  if (!isShareCode(code)) {
    return;
  }
  try {
    await fetch("/api/share-links/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({ code, event, deviceId: getShareDeviceId(), channel: channel ?? null }),
    });
  } catch {
    // Attribution should never block the product flow.
  }
}

// Listing pages: record the visit, and tell the server about a share visit.
export function captureListingVisit(listingKind: PublicListingKind, listingId: string) {
  const touch = captureMarketingQueryParams({ listingKind, listingId });
  if (touch?.shareCode) {
    void trackShareEvent("visit", touch.shareCode, touch.utmMedium);
  }
  void trackMarketingPageView();
}

export function buildTrackedHref(
  href: string,
  context: {
    sourceType: MarketingAttributionSourceType;
    sourceId?: string | null;
    sourceSlug?: string | null;
    promoCode?: string | null;
  },
) {
  if (typeof window === "undefined") {
    return href;
  }

  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      return href;
    }

    if (context.promoCode && !url.searchParams.has("promoCode")) {
      url.searchParams.set("promoCode", context.promoCode);
    }
    if (!url.searchParams.has("sourceType")) {
      url.searchParams.set("sourceType", context.sourceType);
    }
    if (context.sourceId && !url.searchParams.has("sourceId")) {
      url.searchParams.set("sourceId", context.sourceId);
    }
    if (context.sourceSlug && !url.searchParams.has("sourceSlug")) {
      url.searchParams.set("sourceSlug", context.sourceSlug);
    }
    if (!url.searchParams.has("utm_source")) {
      url.searchParams.set("utm_source", context.sourceType === "blog" ? "blog" : "campaign");
    }
    if (!url.searchParams.has("utm_medium")) {
      url.searchParams.set("utm_medium", context.sourceType === "blog" ? "content" : "promo");
    }
    if (context.sourceSlug && !url.searchParams.has("utm_campaign")) {
      url.searchParams.set("utm_campaign", context.sourceSlug);
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

export async function trackMarketingEvent(
  eventType: MarketingAttributionEventType,
  overrides: Partial<MarketingAttributionPayload> = {},
) {
  try {
    const payload = getMarketingAttributionPayload(overrides);
    await fetch("/api/marketing/track", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        ...payload,
        eventType,
      }),
    });
  } catch {
    // Attribution should never block the product flow.
  }
}

export async function trackMarketingPageView(overrides: Partial<MarketingAttributionPayload> = {}) {
  const payload = getMarketingAttributionPayload(overrides);
  if (!hasMeaningfulMarketingContext(payload)) {
    return false;
  }

  const trackedViewKey = buildTrackedViewKey(payload);
  const trackedViews = readTrackedViews();
  if (trackedViews.includes(trackedViewKey)) {
    return false;
  }

  await trackMarketingEvent("view", payload);
  writeTrackedViews([...trackedViews, trackedViewKey]);
  return true;
}

export type { ShareChannel };
