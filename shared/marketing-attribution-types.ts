// Kept apart from schema.ts so the browser can use them without downloading
// the database schema (schema.ts re-exports them).
export const marketingAttributionSourceTypes = ["blog", "promo", "homepage", "service-page", "stay-page", "campaign", "direct"] as const;
export type MarketingAttributionSourceType = typeof marketingAttributionSourceTypes[number];
export const marketingAttributionEventTypes = ["view", "cta-click", "booking"] as const;
export type MarketingAttributionEventType = typeof marketingAttributionEventTypes[number];
