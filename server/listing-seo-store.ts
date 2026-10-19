// TBM's SEO for listings and area pages, from the database. The rules are in
// shared/listing-seo.ts. Admins write it; the listing pages, the page metadata
// and the sitemap read it.
import { and, eq } from "drizzle-orm";
import { listingSeo, seoAreaPages, type Car, type Cook, type Errand, type Experience, type ListingSeoRow, type SeoAreaPageRow, type Stay } from "@shared/schema";
import type { PublicListingKind } from "@shared/seo";
import {
  getSeoArea,
  listingSeoArea,
  seoKindByService,
  toPublicListingSeo,
  toSeoListingInput,
  type ListingSeoOverride,
  type PublicListingSeo,
  type SeoAreaService,
} from "@shared/listing-seo";
import { db, pool } from "./db";
import { storage } from "./storage";
import { isSuspendedProvider } from "./provider-status";

export type AnyListing = Stay | Car | Cook | Errand | Experience;

let tablesReady: Promise<void> | null = null;

// The tables from migration 0029, created here too so an older database keeps
// working before the deploy step has run.
export function ensureSeoTables(): Promise<void> {
  tablesReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS listing_seo (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_kind varchar NOT NULL,
      listing_id varchar NOT NULL,
      seo_title text,
      seo_description text,
      focus_keyword text,
      keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
      image_alts jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_by varchar,
      updated_at text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS listing_seo_listing_idx ON listing_seo (listing_kind, listing_id);
    CREATE TABLE IF NOT EXISTS seo_area_pages (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      area_key varchar NOT NULL,
      service varchar NOT NULL,
      heading text,
      seo_title text,
      seo_description text,
      intro text,
      updated_by varchar,
      updated_at text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS seo_area_pages_area_service_idx ON seo_area_pages (area_key, service);
  `).then(() => undefined).catch((error) => {
    tablesReady = null;
    throw error;
  });
  return tablesReady;
}

function toOverride(row: ListingSeoRow): ListingSeoOverride {
  return {
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    focusKeyword: row.focusKeyword,
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    imageAlts: row.imageAlts && typeof row.imageAlts === "object" ? row.imageAlts : {},
  };
}

// Listing pages read this on every view; a minute's cache keeps that cheap. A save clears it.
const overrideCache = new Map<string, { value: ListingSeoOverride | null; at: number }>();
const cacheMs = 60_000;
const cacheKey = (kind: string, id: string) => `${kind}:${id}`;

export async function getListingSeoOverride(kind: PublicListingKind, id: string): Promise<ListingSeoOverride | null> {
  const key = cacheKey(kind, id);
  const cached = overrideCache.get(key);
  if (cached && Date.now() - cached.at < cacheMs) return cached.value;
  await ensureSeoTables();
  const [row] = await db.select().from(listingSeo).where(and(eq(listingSeo.listingKind, kind), eq(listingSeo.listingId, id))).limit(1);
  const value = row ? toOverride(row) : null;
  overrideCache.set(key, { value, at: Date.now() });
  return value;
}

/** What a public listing response carries: TBM's title, description and photo text. Never throws: SEO must not break a listing page. */
export async function publicListingSeo(kind: PublicListingKind, listing: AnyListing): Promise<PublicListingSeo | null> {
  try {
    const override = await getListingSeoOverride(kind, listing.id);
    return toPublicListingSeo(override, toSeoListingInput(kind, listing as unknown as Record<string, unknown>).photos);
  } catch (error) {
    console.error("[SEO] Couldn't read a listing's SEO:", error);
    return null;
  }
}

export async function listListingSeoOverrides(): Promise<Map<string, ListingSeoOverride>> {
  await ensureSeoTables();
  const rows = await db.select().from(listingSeo);
  return new Map(rows.map((row) => [cacheKey(row.listingKind, row.listingId), toOverride(row)]));
}

export async function saveListingSeoOverride(kind: PublicListingKind, id: string, value: ListingSeoOverride, userId: string) {
  await ensureSeoTables();
  const data = {
    seoTitle: value.seoTitle?.trim() || null,
    seoDescription: value.seoDescription?.trim() || null,
    focusKeyword: value.focusKeyword?.trim() || null,
    keywords: value.keywords,
    imageAlts: value.imageAlts,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  };
  await db.insert(listingSeo)
    .values({ listingKind: kind, listingId: id, ...data })
    .onConflictDoUpdate({ target: [listingSeo.listingKind, listingSeo.listingId], set: data });
  overrideCache.delete(cacheKey(kind, id));
}

// ── Listings ─────────────────────────────────────────────────────────────

export async function loadListings(kind: PublicListingKind): Promise<AnyListing[]> {
  if (kind === "stay") return storage.getStays();
  if (kind === "car") return storage.getCars();
  if (kind === "cook") return storage.getCooks();
  if (kind === "errand") return storage.getErrands();
  return storage.getExperiences();
}

export async function loadListing(kind: PublicListingKind, id: string): Promise<AnyListing | undefined> {
  if (kind === "stay") return storage.getStay(id);
  if (kind === "car") return storage.getCar(id);
  if (kind === "cook") return storage.getCook(id);
  if (kind === "errand") return storage.getErrand(id);
  return storage.getExperience(id);
}

// Public, with a provider who isn't suspended: the same rule as the public listing endpoints.
export function isLiveListing(listing: { isPublic?: boolean | null; managerUserId?: string | null }) {
  return Boolean(listing.isPublic && listing.managerUserId?.trim() && !isSuspendedProvider(listing.managerUserId));
}

export function listingAreaKey(kind: PublicListingKind, listing: AnyListing) {
  return listingSeoArea(toSeoListingInput(kind, listing as unknown as Record<string, unknown>))?.key ?? null;
}

export async function liveListingsInArea(areaKey: string, service: SeoAreaService) {
  const kind = seoKindByService[service];
  const listings = await loadListings(kind);
  return listings.filter((listing) => isLiveListing(listing) && listingAreaKey(kind, listing) === areaKey);
}

type AreaPageCount = { areaKey: string; service: SeoAreaService; count: number; lastmod: string | null };
let areaCountsCache: { value: AreaPageCount[]; at: number } | null = null;

/** Every area page with at least one live listing, for the sitemap and the cross-links. Kept for a minute. */
export async function liveAreaPageCounts(): Promise<AreaPageCount[]> {
  if (areaCountsCache && Date.now() - areaCountsCache.at < cacheMs) return areaCountsCache.value;
  const value = await countLiveAreaPages();
  areaCountsCache = { value, at: Date.now() };
  return value;
}

async function countLiveAreaPages(): Promise<AreaPageCount[]> {
  const counts = new Map<string, AreaPageCount>();
  const kinds = Object.entries(seoKindByService) as Array<[SeoAreaService, PublicListingKind]>;
  await Promise.all(kinds.map(async ([service, kind]) => {
    for (const listing of await loadListings(kind)) {
      if (!isLiveListing(listing)) continue;
      const areaKey = listingAreaKey(kind, listing);
      if (!areaKey) continue;
      const key = `${areaKey}/${service}`;
      const entry = counts.get(key) ?? { areaKey, service, count: 0, lastmod: null };
      entry.count += 1;
      const updated = (listing as { updatedAt?: string | null }).updatedAt ?? null;
      if (updated && (!entry.lastmod || updated > entry.lastmod)) entry.lastmod = updated;
      counts.set(key, entry);
    }
  }));
  return Array.from(counts.values());
}

// ── Area pages ───────────────────────────────────────────────────────────

export type AreaPageOverride = Pick<SeoAreaPageRow, "heading" | "seoTitle" | "seoDescription" | "intro">;

export async function getAreaPageOverride(areaKey: string, service: SeoAreaService): Promise<AreaPageOverride | null> {
  await ensureSeoTables();
  const [row] = await db.select().from(seoAreaPages).where(and(eq(seoAreaPages.areaKey, areaKey), eq(seoAreaPages.service, service))).limit(1);
  return row ? { heading: row.heading, seoTitle: row.seoTitle, seoDescription: row.seoDescription, intro: row.intro } : null;
}

export async function listAreaPageOverrides() {
  await ensureSeoTables();
  const rows = await db.select().from(seoAreaPages);
  return new Map(rows.map((row) => [`${row.areaKey}/${row.service}`, row]));
}

export async function saveAreaPageOverride(areaKey: string, service: SeoAreaService, value: AreaPageOverride, userId: string) {
  if (!getSeoArea(areaKey)) throw new Error("Unknown area");
  await ensureSeoTables();
  const data = {
    heading: value.heading?.trim() || null,
    seoTitle: value.seoTitle?.trim() || null,
    seoDescription: value.seoDescription?.trim() || null,
    intro: value.intro?.trim() || null,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  };
  await db.insert(seoAreaPages)
    .values({ areaKey, service, ...data })
    .onConflictDoUpdate({ target: [seoAreaPages.areaKey, seoAreaPages.service], set: data });
}
