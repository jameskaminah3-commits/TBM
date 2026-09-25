// zaina-platform/src/businesses/settings.ts
//
// How a business presents itself and what Zaina may pass on for it: its
// name, the assistant's name, how customers reach it, and which links and
// phone numbers can appear in replies. Kept inside the business (row-level
// security) and cached briefly.

import { eq } from "drizzle-orm";
import { businessSettings, type BusinessSettings } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";

const CACHE_MS = Number(process.env.BUSINESS_CACHE_MS ?? "") || 30_000;
const cache = new Map<string, { at: number; settings: BusinessSettings | null }>();

export async function getBusinessSettings(businessId: string): Promise<BusinessSettings | null> {
  const hit = cache.get(businessId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;
  const [row] = await inBusiness((db) => db.select().from(businessSettings).where(eq(businessSettings.businessId, businessId)).limit(1), businessId);
  cache.set(businessId, { at: Date.now(), settings: row ?? null });
  return row ?? null;
}

export type SettingsPatch = Partial<Pick<BusinessSettings,
  | "displayName" | "assistantName" | "about" | "contactPhone" | "contactPhoneDisplay" | "websiteUrl" | "supportEmail"
  | "allowedLinkHosts" | "allowedLinkHostSuffixes" | "defaultCurrency">>;

const TEXT_FIELDS = ["displayName", "assistantName", "about", "contactPhone", "contactPhoneDisplay", "websiteUrl", "supportEmail"] as const;
const HOST_PATTERN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/;

/** Checks a patch sent by staff; returns the clean patch or the first problem. */
export function validateSettingsPatch(input: Record<string, unknown>): { ok: true; patch: SettingsPatch } | { ok: false; error: string } {
  const patch: SettingsPatch = {};
  for (const field of TEXT_FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value === null && field !== "displayName" && field !== "assistantName" && field !== "about") {
      (patch as Record<string, unknown>)[field] = null;
      continue;
    }
    if (typeof value !== "string" || value.length > (field === "about" ? 4000 : 200)) return { ok: false, error: `${field} must be text` };
    if ((field === "displayName" || field === "assistantName") && !value.trim()) return { ok: false, error: `${field} can't be empty` };
    (patch as Record<string, unknown>)[field] = value.trim();
  }
  if (typeof patch.contactPhone === "string" && !/^\+\d{7,15}$/.test(patch.contactPhone)) {
    return { ok: false, error: "contactPhone must be in international form, e.g. +254718475264" };
  }
  if (typeof patch.websiteUrl === "string" && !/^https:\/\/[^\s/]+/.test(patch.websiteUrl)) {
    return { ok: false, error: "websiteUrl must start with https://" };
  }
  if (typeof patch.supportEmail === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(patch.supportEmail)) {
    return { ok: false, error: "supportEmail must be an email address" };
  }
  for (const field of ["allowedLinkHosts", "allowedLinkHostSuffixes"] as const) {
    if (!(field in input)) continue;
    const value = input[field];
    if (!Array.isArray(value) || value.length > 50 || !value.every((host) => typeof host === "string")) {
      return { ok: false, error: `${field} must be a list of host names` };
    }
    const hosts = value.map((host) => (host as string).trim().toLowerCase());
    const valid = field === "allowedLinkHosts"
      ? hosts.every((host) => HOST_PATTERN.test(host))
      : hosts.every((host) => host.startsWith(".") && HOST_PATTERN.test(host.slice(1)));
    if (!valid) return { ok: false, error: `${field} has an entry that isn't a host name` };
    patch[field] = hosts;
  }
  if ("defaultCurrency" in input) {
    if (input.defaultCurrency !== "USD" && input.defaultCurrency !== "KES") return { ok: false, error: "defaultCurrency must be USD or KES" };
    patch.defaultCurrency = input.defaultCurrency;
  }
  return { ok: true, patch };
}

export async function updateBusinessSettings(businessId: string, patch: SettingsPatch, updatedBy: string | null): Promise<BusinessSettings> {
  const [row] = await inBusiness((db) => db
    .update(businessSettings)
    .set({ ...patch, updatedBy, updatedAt: new Date() })
    .where(eq(businessSettings.businessId, businessId))
    .returning(), businessId);
  cache.delete(businessId);
  if (!row) throw new Error(`No settings for business ${businessId}`);
  return row;
}

export async function createBusinessSettings(businessId: string, displayName: string): Promise<void> {
  await inBusiness((db) => db.insert(businessSettings).values({ businessId, displayName }).onConflictDoNothing(), businessId);
  cache.delete(businessId);
}

/** The reply rules the business's settings give: which links and numbers Zaina may pass on. */
export function replyRulesFor(settings: BusinessSettings | null): { allowedHosts: string[]; allowedHostSuffixes: string[]; officialPhones: string[] } {
  const siteHost = (() => {
    try {
      return settings?.websiteUrl ? new URL(settings.websiteUrl).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();
  return {
    allowedHosts: [...new Set([...(settings?.allowedLinkHosts ?? []), ...(siteHost ? [siteHost] : [])])],
    allowedHostSuffixes: settings?.allowedLinkHostSuffixes ?? [],
    officialPhones: settings?.contactPhone ? [settings.contactPhone] : [],
  };
}
