// The admin SEO page (every listing's score, the editor, AI suggestions, area
// page text) and the public area pages. Rules: shared/listing-seo.ts.
import type { Express } from "express";
import { z } from "zod";
import { getPublicListingPath, type PublicListingKind } from "@shared/seo";
import {
  areaPageHeading,
  areaPagePath,
  defaultAreaPageCopy,
  getSeoArea,
  isSeoAreaService,
  scoreListingSeo,
  seoAreas,
  seoAreaServices,
  seoKindByService,
  seoServiceByKind,
  suggestListingSeo,
  toPublicListingSeo,
  toSeoListingInput,
  type ListingSeoOverride,
  type SeoAreaService,
} from "@shared/listing-seo";
import { requireAdmin } from "./middleware/auth";
import { getAutoListingSeoText } from "./share-metadata";
import {
  getAreaPageOverride,
  getListingSeoOverride,
  isLiveListing,
  listAreaPageOverrides,
  listListingSeoOverrides,
  liveAreaPageCounts,
  liveListingsInArea,
  loadListing,
  loadListings,
  saveAreaPageOverride,
  saveListingSeoOverride,
  type AnyListing,
} from "./listing-seo-store";
import { getRatingSummary } from "./review-ratings";
import { seoAiAvailable, suggestSeoWithAi } from "./seo-ai";

const kinds: PublicListingKind[] = ["stay", "car", "cook", "errand", "experience"];
const isKind = (value: unknown): value is PublicListingKind => typeof value === "string" && (kinds as string[]).includes(value);
const adminEditPath: Record<PublicListingKind, string> = { stay: "stays", car: "cars", cook: "cooks", errand: "errands", experience: "experiences" };
const userIdOf = (req: any): string => req.user.claims.sub;
const privateJson = (res: any) => res.setHeader("Cache-Control", "private, no-store");
const asRecord = (listing: AnyListing) => listing as unknown as Record<string, unknown>;

function effectiveText(kind: PublicListingKind, listing: AnyListing, override: ListingSeoOverride | null | undefined) {
  const auto = getAutoListingSeoText(kind, listing);
  return {
    auto,
    title: override?.seoTitle?.trim() || auto.title,
    description: override?.seoDescription?.trim() || auto.description,
  };
}

const titleKey = (title: string) => title.trim().toLowerCase();

async function allListingsWithSeo() {
  const [overrides, ...lists] = await Promise.all([listListingSeoOverrides(), ...kinds.map((kind) => loadListings(kind))]);
  const rows = kinds.flatMap((kind, index) => lists[index].map((listing) => {
    const override = overrides.get(`${kind}:${listing.id}`) ?? null;
    return { kind, listing, override, ...effectiveText(kind, listing, override) };
  }));
  const titleCounts = new Map<string, number>();
  for (const row of rows) titleCounts.set(titleKey(row.title), (titleCounts.get(titleKey(row.title)) ?? 0) + 1);
  return { rows, isDuplicate: (title: string) => (titleCounts.get(titleKey(title)) ?? 0) > 1 };
}

const saveListingSchema = z.object({
  seoTitle: z.string().trim().max(80).nullable().optional(),
  seoDescription: z.string().trim().max(200).nullable().optional(),
  focusKeyword: z.string().trim().max(100).nullable().optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(15).optional().default([]),
  imageAlts: z.record(z.string(), z.string().trim().max(200)).optional().default({}),
});

const saveAreaSchema = z.object({
  heading: z.string().trim().max(90).nullable().optional(),
  seoTitle: z.string().trim().max(80).nullable().optional(),
  seoDescription: z.string().trim().max(200).nullable().optional(),
  intro: z.string().trim().max(2000).nullable().optional(),
});

function leadPrice(kind: PublicListingKind, listing: AnyListing): { amount: number | null; unit: string } {
  const row = listing as unknown as Record<string, number | null | undefined>;
  if (kind === "stay") return { amount: row.price || null, unit: "per night" };
  if (kind === "car") return { amount: row.pricePerDay || row.priceWithDriver || null, unit: "per day" };
  if (kind === "cook") return { amount: row.serviceFee || row.pricePerSession || null, unit: "per chef service" };
  if (kind === "errand") return { amount: row.basePrice || null, unit: "from" };
  return { amount: row.privatePricePerPerson || row.sharedPricePerPerson || row.price || null, unit: "per person" };
}

export function registerSeoRoutes(app: Express) {
  // ── Admin: every listing with its score ────────────────────────────────
  app.get("/api/admin/seo/listings", requireAdmin, async (_req, res) => {
    try {
      privateJson(res);
      const { rows, isDuplicate } = await allListingsWithSeo();
      const listings = rows.map(({ kind, listing, override, title, description }) => {
        const input = toSeoListingInput(kind, asRecord(listing));
        const suggestions = suggestListingSeo(input);
        const score = scoreListingSeo(input, {
          title,
          description,
          focusKeyword: override?.focusKeyword ?? null,
          imageAlts: override?.imageAlts ?? {},
          duplicateTitle: isDuplicate(title),
        });
        return {
          kind,
          id: listing.id,
          name: input.name,
          location: input.location,
          area: suggestions.area?.name ?? null,
          isPublic: input.isPublic,
          live: isLiveListing(listing),
          photo: input.photos[0] ?? null,
          path: getPublicListingPath(kind, listing.id, input.name),
          editPath: `/admin/${adminEditPath[kind]}/${listing.id}/edit`,
          title,
          focusKeyword: override?.focusKeyword ?? null,
          customised: Boolean(override),
          score: score.score,
          grade: score.grade,
          topFix: score.checks.filter((check) => check.status !== "pass").sort((a, b) => (b.max - b.points) - (a.max - a.points))[0]?.label ?? null,
        };
      });
      res.json({ listings, aiAvailable: seoAiAvailable() });
    } catch (error) {
      console.error("[SEO] Couldn't list listings:", error);
      res.status(500).json({ error: "Couldn't load the SEO list" });
    }
  });

  // ── Admin: one listing's editor ────────────────────────────────────────
  app.get("/api/admin/seo/listings/:kind/:id", requireAdmin, async (req, res) => {
    try {
      privateJson(res);
      const { kind, id } = req.params;
      if (!isKind(kind)) return res.status(404).json({ error: "Unknown listing type" });
      const listing = await loadListing(kind, id);
      if (!listing) return res.status(404).json({ error: "Listing not found" });
      const [override, { isDuplicate, rows }] = await Promise.all([getListingSeoOverride(kind, id), allListingsWithSeo()]);
      const input = toSeoListingInput(kind, asRecord(listing));
      const { auto, title, description } = effectiveText(kind, listing, override);
      // Other listings' titles, so the editor can warn about a duplicate while typing.
      const otherTitles = rows.filter((row) => !(row.kind === kind && row.listing.id === id)).map((row) => row.title);
      res.json({
        listing: {
          kind,
          id,
          name: input.name,
          location: input.location,
          live: isLiveListing(listing),
          path: getPublicListingPath(kind, id, input.name),
          editPath: `/admin/${adminEditPath[kind]}/${id}/edit`,
        },
        input,
        auto,
        override,
        suggestions: suggestListingSeo(input),
        score: scoreListingSeo(input, { title, description, focusKeyword: override?.focusKeyword ?? null, imageAlts: override?.imageAlts ?? {}, duplicateTitle: isDuplicate(title) }),
        otherTitles,
        aiAvailable: seoAiAvailable(),
      });
    } catch (error) {
      console.error("[SEO] Couldn't load a listing's SEO:", error);
      res.status(500).json({ error: "Couldn't load this listing's SEO" });
    }
  });

  app.put("/api/admin/seo/listings/:kind/:id", requireAdmin, async (req: any, res) => {
    try {
      privateJson(res);
      const { kind, id } = req.params;
      if (!isKind(kind)) return res.status(404).json({ error: "Unknown listing type" });
      const listing = await loadListing(kind, id);
      if (!listing) return res.status(404).json({ error: "Listing not found" });
      const parsed = saveListingSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the fields" });
      // Photo text only for this listing's own photos.
      const photos = new Set(toSeoListingInput(kind, asRecord(listing)).photos);
      const imageAlts = Object.fromEntries(Object.entries(parsed.data.imageAlts).filter(([url, alt]) => photos.has(url) && alt.length > 0));
      await saveListingSeoOverride(kind, id, {
        seoTitle: parsed.data.seoTitle ?? null,
        seoDescription: parsed.data.seoDescription ?? null,
        focusKeyword: parsed.data.focusKeyword ?? null,
        keywords: Array.from(new Set(parsed.data.keywords)),
        imageAlts,
      }, userIdOf(req));
      res.json({ saved: true });
    } catch (error) {
      console.error("[SEO] Couldn't save a listing's SEO:", error);
      res.status(500).json({ error: "Couldn't save" });
    }
  });

  app.post("/api/admin/seo/listings/:kind/:id/ai", requireAdmin, async (req, res) => {
    try {
      privateJson(res);
      const { kind, id } = req.params;
      if (!isKind(kind)) return res.status(404).json({ error: "Unknown listing type" });
      if (!seoAiAvailable()) return res.status(503).json({ error: "AI suggestions need the Gemini key on the server. The rules-based suggestions still work." });
      const listing = await loadListing(kind, id);
      if (!listing) return res.status(404).json({ error: "Listing not found" });
      const input = toSeoListingInput(kind, asRecord(listing));
      res.json(await suggestSeoWithAi(input, suggestListingSeo(input)));
    } catch (error) {
      console.error("[SEO] AI suggestions failed:", error);
      res.status(502).json({ error: error instanceof Error && error.message.includes("readable") ? error.message : "AI suggestions didn't work this time. Try again." });
    }
  });

  // ── Admin: area pages ──────────────────────────────────────────────────
  app.get("/api/admin/seo/areas", requireAdmin, async (_req, res) => {
    try {
      privateJson(res);
      const [counts, overrides] = await Promise.all([liveAreaPageCounts(), listAreaPageOverrides()]);
      const countOf = new Map(counts.map((entry) => [`${entry.areaKey}/${entry.service}`, entry.count]));
      const pages = seoAreas.flatMap((area) => seoAreaServices.map((service) => {
        const key = `${area.key}/${service}`;
        const row = overrides.get(key);
        return {
          areaKey: area.key,
          areaName: area.name,
          service,
          path: areaPagePath(area.key, service),
          count: countOf.get(key) ?? 0,
          defaults: defaultAreaPageCopy(area, service),
          override: row ? { heading: row.heading, seoTitle: row.seoTitle, seoDescription: row.seoDescription, intro: row.intro } : null,
        };
      }));
      res.json({ pages });
    } catch (error) {
      console.error("[SEO] Couldn't list area pages:", error);
      res.status(500).json({ error: "Couldn't load the area pages" });
    }
  });

  app.put("/api/admin/seo/areas/:area/:service", requireAdmin, async (req: any, res) => {
    try {
      privateJson(res);
      const { area, service } = req.params;
      if (!getSeoArea(area) || !isSeoAreaService(service)) return res.status(404).json({ error: "Unknown area page" });
      const parsed = saveAreaSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the fields" });
      await saveAreaPageOverride(area, service, {
        heading: parsed.data.heading ?? null,
        seoTitle: parsed.data.seoTitle ?? null,
        seoDescription: parsed.data.seoDescription ?? null,
        intro: parsed.data.intro ?? null,
      }, userIdOf(req));
      res.json({ saved: true });
    } catch (error) {
      console.error("[SEO] Couldn't save an area page:", error);
      res.status(500).json({ error: "Couldn't save" });
    }
  });

  // ── Public: the area pages with live listings (footer links) ───────────
  app.get("/api/seo/areas", async (_req, res) => {
    try {
      const counts = await liveAreaPageCounts();
      const pages = counts
        .map((entry) => {
          const area = getSeoArea(entry.areaKey)!;
          return { path: areaPagePath(entry.areaKey, entry.service), heading: areaPageHeading(area, entry.service), count: entry.count };
        })
        .sort((a, b) => b.count - a.count || a.heading.localeCompare(b.heading));
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({ pages });
    } catch (error) {
      console.error("[SEO] Couldn't list area pages:", error);
      res.json({ pages: [] });
    }
  });

  // ── Public: an area page ───────────────────────────────────────────────
  app.get("/api/seo/areas/:area/:service", async (req, res) => {
    try {
      const area = getSeoArea(req.params.area);
      const service = req.params.service;
      if (!area || !isSeoAreaService(service)) return res.status(404).json({ error: "Page not found" });
      const kind = seoKindByService[service];
      const [override, listings, counts] = await Promise.all([
        getAreaPageOverride(area.key, service).catch(() => null),
        liveListingsInArea(area.key, service),
        liveAreaPageCounts(),
      ]);
      const copy = defaultAreaPageCopy(area, service);
      const cards = await Promise.all(listings.map(async (listing) => {
        const input = toSeoListingInput(kind, asRecord(listing));
        const [rating, override] = await Promise.all([
          getRatingSummary(kind, listing.id).catch(() => ({ count: 0, average: null })),
          getListingSeoOverride(kind, listing.id).catch(() => null),
        ]);
        const photo = input.photos.find((url) => !/\.(mp4|webm|mov)(\?.*)?$/i.test(url)) ?? null;
        const seo = toPublicListingSeo(override, input.photos);
        const price = leadPrice(kind, listing);
        // Home help keeps carers private: the service, never a person.
        return {
          kind,
          id: listing.id,
          name: input.name,
          location: input.location,
          imageUrl: photo,
          imageAlt: (photo && seo?.imageAlts[photo]) || `${input.name}, ${input.location}`,
          path: getPublicListingPath(kind, listing.id, input.name),
          price: price.amount,
          priceUnit: price.unit,
          rating: rating.average,
          reviewCount: rating.count,
        };
      }));
      const countOf = (areaKey: string, areaService: SeoAreaService) => counts.find((entry) => entry.areaKey === areaKey && entry.service === areaService)?.count ?? 0;
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({
        area: { key: area.key, name: area.name, landmarks: area.landmarks },
        service,
        heading: override?.heading || copy.heading,
        intro: override?.intro || copy.intro,
        title: override?.seoTitle || copy.title,
        description: override?.seoDescription || copy.description,
        listings: cards,
        otherServices: seoAreaServices
          .filter((other) => other !== service && countOf(area.key, other) > 0)
          .map((other) => ({ service: other, heading: areaPageHeading(area, other), path: areaPagePath(area.key, other), count: countOf(area.key, other) })),
        otherAreas: seoAreas
          .filter((other) => other.key !== area.key && countOf(other.key, service) > 0)
          .map((other) => ({ key: other.key, heading: areaPageHeading(other, service), path: areaPagePath(other.key, service), count: countOf(other.key, service) })),
        kind,
        serviceForKind: seoServiceByKind[kind],
      });
    } catch (error) {
      console.error("[SEO] Couldn't load an area page:", error);
      res.status(500).json({ error: "Couldn't load this page" });
    }
  });
}
