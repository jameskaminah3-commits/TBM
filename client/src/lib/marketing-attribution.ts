import type {
  MarketingAttributionEventType,
  MarketingAttributionPayload,
  MarketingAttributionSourceType,
} from "@shared/schema";

const ATTRIBUTION_STORAGE_KEY = "tembea-marketing-attribution-v2";
const SESSION_STORAGE_KEY = "tembea-marketing-session-v2";
const TRACKED_VIEWS_STORAGE_KEY = "tembea-marketing-tracked-views-v2";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

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

function readStoredAttribution(): Partial<MarketingAttributionPayload> {
  if (!canUseStorage()) {
    return {};
  }

  const raw = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Partial<MarketingAttributionPayload>;
  } catch {
    window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
    return {};
  }
}

function writeStoredAttribution(value: Partial<MarketingAttributionPayload>) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(value));
}

function readTrackedViews() {
  if (!canUseStorage()) {
    return [] as string[];
  }

  const raw = window.localStorage.getItem(TRACKED_VIEWS_STORAGE_KEY);
  if (!raw) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    window.localStorage.removeItem(TRACKED_VIEWS_STORAGE_KEY);
    return [] as string[];
  }
}

function writeTrackedViews(values: string[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(
    TRACKED_VIEWS_STORAGE_KEY,
    JSON.stringify(values.slice(-200)),
  );
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
  if (!canUseStorage()) {
    return createId();
  }

  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const nextId = createId();
  window.localStorage.setItem(SESSION_STORAGE_KEY, nextId);
  return nextId;
}

export function captureMarketingQueryParams() {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const promoCode = params.get("promoCode") || params.get("promo");
  const sourceType = params.get("sourceType") as MarketingAttributionSourceType | null;
  const sourceId = params.get("sourceId");
  const sourceSlug = params.get("sourceSlug");
  const utmSource = params.get("utm_source");
  const utmMedium = params.get("utm_medium");
  const utmCampaign = params.get("utm_campaign");
  const utmContent = params.get("utm_content");

  if (!promoCode && !sourceType && !sourceId && !sourceSlug && !utmSource && !utmMedium && !utmCampaign && !utmContent) {
    return;
  }

  const current = readStoredAttribution();
  writeStoredAttribution({
    ...current,
    promoCode: promoCode?.trim().toUpperCase() || current.promoCode || null,
    sourceType: sourceType || current.sourceType || "campaign",
    sourceId: sourceId?.trim() || current.sourceId || null,
    sourceSlug: sourceSlug?.trim() || current.sourceSlug || null,
    sourcePath: current.sourcePath || window.location.pathname,
    entryPath: current.entryPath || getCurrentPath(),
    referrerPath: current.referrerPath || getSameOriginPath(document.referrer) || null,
    utmSource: utmSource?.trim() || current.utmSource || null,
    utmMedium: utmMedium?.trim() || current.utmMedium || null,
    utmCampaign: utmCampaign?.trim() || current.utmCampaign || null,
    utmContent: utmContent?.trim() || current.utmContent || null,
  });
}

export function setMarketingAttributionContext(partial: Partial<MarketingAttributionPayload>) {
  const current = readStoredAttribution();
  writeStoredAttribution({
    ...current,
    ...partial,
    promoCode: partial.promoCode?.trim().toUpperCase() || current.promoCode || null,
  });
}

export function clearMarketingAttributionContext() {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
}

export function getMarketingAttributionPayload(overrides: Partial<MarketingAttributionPayload> = {}): MarketingAttributionPayload {
  const current = readStoredAttribution();
  const entryPath = overrides.entryPath || current.entryPath || getCurrentPath();
  const referrerPath = overrides.referrerPath || current.referrerPath || (typeof document !== "undefined" ? getSameOriginPath(document.referrer) : null);

  return {
    sessionId: getMarketingSessionId(),
    sourceType: overrides.sourceType || current.sourceType || "direct",
    sourceId: overrides.sourceId || current.sourceId || null,
    sourceSlug: overrides.sourceSlug || current.sourceSlug || null,
    sourcePath: overrides.sourcePath || current.sourcePath || (typeof window !== "undefined" ? window.location.pathname : null),
    sourceTitle: overrides.sourceTitle || current.sourceTitle || null,
    promoCode: overrides.promoCode?.trim().toUpperCase() || current.promoCode || null,
    landingPath: overrides.landingPath || current.landingPath || (typeof window !== "undefined" ? window.location.pathname : null),
    referrerPath,
    entryPath,
    utmSource: overrides.utmSource || current.utmSource || null,
    utmMedium: overrides.utmMedium || current.utmMedium || null,
    utmCampaign: overrides.utmCampaign || current.utmCampaign || null,
    utmContent: overrides.utmContent || current.utmContent || null,
  };
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
