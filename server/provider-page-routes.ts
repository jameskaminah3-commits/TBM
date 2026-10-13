// Public provider pages: the page and the "Your host" block for anyone, the
// switch and photo for the provider, and photo review and TBM's switch for
// admins. Public responses come only from the allowlist builder.
import type { Express } from "express";
import { z } from "zod";
import { providerPhotoKinds } from "@shared/provider-public";
import type { PublicListingKind } from "@shared/seo";
import { createRateLimitMiddleware, getRequestIp } from "./middleware/rate-limit";
import { requireAdmin, requireProviderOrAdmin } from "./middleware/auth";
import { queueNotificationTask } from "./notifications";
import { storage } from "./storage";
import {
  ensureProviderPageColumns,
  getProviderPageSettings,
  getPublicProviderPage,
  getPublicProviderSummaryForListing,
  listWaitingProviderPhotos,
  removeProviderPhoto,
  reviewProviderPhoto,
  setPublicPageBlocked,
  setPublicPageEnabled,
  submitProviderPhoto,
} from "./provider-pages";

const publicProviderRateLimit = createRateLimitMiddleware([
  { id: "public-provider:ip", key: (req) => getRequestIp(req), max: 240, windowMs: 10 * 60 * 1000, message: "Too many requests." },
]);
const photoUploadRateLimit = createRateLimitMiddleware([
  { id: "provider-photo:user", key: (req: any) => req.user?.claims?.sub ?? getRequestIp(req), max: 10, windowMs: 60 * 60 * 1000, message: "Too many photos sent. Please try again later." },
]);

const listingKinds = ["stay", "car", "cook", "errand", "experience"] as const satisfies readonly PublicListingKind[];
const userIdOf = (req: any): string => req.user.claims.sub;

// Who is looking, if anyone: the page's owner and TBM can preview a page that
// isn't live yet. Never needed to see a live page.
async function viewerOf(req: any) {
  const userId = req.session?.userId as string | undefined;
  if (!userId) return { userId: null, isAdmin: false };
  const user = await storage.getUser(userId).catch(() => undefined);
  if (!user || user.isSuspended) return { userId: null, isAdmin: false };
  return { userId: user.id, isAdmin: user.role === "admin" };
}

function displayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | undefined) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "A provider";
}

export function registerProviderPageRoutes(app: Express) {
  void ensureProviderPageColumns().catch((error) => console.error("[PROVIDER_PAGES] Couldn't add page columns:", error));

  // ── Public ─────────────────────────────────────────────────────────────
  app.get("/api/public/providers/:code", publicProviderRateLimit, async (req, res) => {
    try {
      const result = await getPublicProviderPage(String(req.params.code ?? ""), await viewerOf(req));
      if (result.status === "ok") {
        // Short, so a suspension or switch-off shows within a minute or two.
        res.setHeader("Cache-Control", "public, max-age=60");
        return res.json({ provider: result.profile });
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Robots-Tag", "noindex");
      if (result.status === "preview") return res.json({ provider: result.profile, preview: true, blockers: result.blockers });
      // Unavailable and unknown codes look the same from outside.
      return res.status(404).json({ unavailable: true });
    } catch (error) {
      console.error("[PROVIDER_PAGES] Public page failed:", error);
      return res.status(500).json({ error: "Couldn't load this page" });
    }
  });

  app.get("/api/public/providers/by-listing/:kind/:id", publicProviderRateLimit, async (req, res) => {
    const kind = listingKinds.find((value) => value === req.params.kind);
    const id = String(req.params.id ?? "");
    if (!kind || !id || id.length > 120) return res.status(404).json({ unavailable: true });
    try {
      const summary = await getPublicProviderSummaryForListing(kind, id);
      res.setHeader("Cache-Control", summary ? "public, max-age=60" : "private, no-store");
      return summary ? res.json({ provider: summary }) : res.status(404).json({ unavailable: true });
    } catch (error) {
      console.error("[PROVIDER_PAGES] Listing host failed:", error);
      return res.status(500).json({ error: "Couldn't load the host" });
    }
  });

  // ── The provider's own page ────────────────────────────────────────────
  app.get("/api/provider/public-page", requireProviderOrAdmin, async (req: any, res) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      return res.json(await getProviderPageSettings(userIdOf(req)));
    } catch (error) {
      console.error("[PROVIDER_PAGES] Settings failed:", error);
      return res.status(500).json({ error: "Couldn't load your page settings" });
    }
  });

  // On after a preview (decision 2), or off. TBM's switch still wins.
  app.put("/api/provider/public-page", requireProviderOrAdmin, async (req: any, res) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Choose on or off." });
    try {
      await setPublicPageEnabled(userIdOf(req), parsed.data.enabled);
      return res.json(await getProviderPageSettings(userIdOf(req)));
    } catch (error) {
      console.error("[PROVIDER_PAGES] Switch failed:", error);
      return res.status(500).json({ error: "Couldn't change your page" });
    }
  });

  // A new photo waits, privately, for TBM to check it.
  app.post("/api/provider/profile/photo", requireProviderOrAdmin, photoUploadRateLimit, async (req: any, res) => {
    const parsed = z.object({
      dataUrl: z.string().min(20),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      kind: z.enum(providerPhotoKinds),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Choose a JPG, PNG or WebP photo, and say what it shows." });
    try {
      const userId = userIdOf(req);
      await submitProviderPhoto(userId, parsed.data);
      const user = await storage.getUser(userId);
      queueNotificationTask(`photo review alert for ${userId}`, storage.notifyAdminsOfProviderAccount({
        actorUserId: userId,
        title: `Photo to check: ${displayName(user)}`,
        body: `${displayName(user)} sent a new profile photo. Check it before it appears on their public page.`,
        actionUrl: `/admin/providers?provider=${encodeURIComponent(userId)}`,
      }));
      return res.status(201).json(await getProviderPageSettings(userId));
    } catch (error) {
      console.error("[PROVIDER_PAGES] Photo upload failed:", error);
      return res.status(400).json({ error: error instanceof Error ? error.message : "Couldn't upload the photo" });
    }
  });

  app.delete("/api/provider/profile/photo", requireProviderOrAdmin, async (req: any, res) => {
    try {
      await removeProviderPhoto(userIdOf(req));
      return res.json(await getProviderPageSettings(userIdOf(req)));
    } catch (error) {
      console.error("[PROVIDER_PAGES] Photo removal failed:", error);
      return res.status(500).json({ error: "Couldn't remove the photo" });
    }
  });

  // ── TBM's side ─────────────────────────────────────────────────────────
  // Every provider with a photo waiting for a check, in one list.
  app.get("/api/admin/provider-photos", requireAdmin, async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ waiting: await listWaitingProviderPhotos() });
    } catch (error) {
      console.error("[PROVIDER_PAGES] Photo queue failed:", error);
      return res.status(500).json({ error: "Couldn't load the photos to check" });
    }
  });

  app.get("/api/admin/providers/:id/public-page", requireAdmin, async (req, res) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      return res.json(await getProviderPageSettings(req.params.id));
    } catch (error) {
      console.error("[PROVIDER_PAGES] Admin settings failed:", error);
      return res.status(500).json({ error: "Couldn't load the provider's page" });
    }
  });

  app.post("/api/admin/providers/:id/photo", requireAdmin, async (req: any, res) => {
    const parsed = z.object({
      decision: z.enum(["approve", "reject"]),
      note: z.string().trim().max(300).optional().nullable(),
      kind: z.enum(providerPhotoKinds).optional().nullable(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Approve or turn down the photo." });
    if (parsed.data.decision === "reject" && !parsed.data.note) return res.status(400).json({ error: "Say briefly why, so the provider can send a better one." });
    try {
      const result = await reviewProviderPhoto(req.params.id, {
        decision: parsed.data.decision,
        note: parsed.data.note || null,
        kind: parsed.data.kind ?? null,
        adminId: userIdOf(req),
      });
      if (!result.ok) return res.status(409).json({ error: result.error });
      queueNotificationTask(`photo review result for ${req.params.id}`, storage.notifyProviderOfAccount({
        providerUserId: req.params.id,
        title: parsed.data.decision === "approve" ? "Your photo is approved" : "Your photo wasn't approved",
        body: parsed.data.decision === "approve"
          ? "It now shows on your public page."
          : `${parsed.data.note} You can send another from your profile.`,
        actionUrl: "/provider/profile#business",
      }));
      return res.json(await getProviderPageSettings(req.params.id));
    } catch (error) {
      console.error("[PROVIDER_PAGES] Photo review failed:", error);
      return res.status(500).json({ error: "Couldn't save the review" });
    }
  });

  // TBM switches a page off (or back on). The provider can't override it.
  app.post("/api/admin/providers/:id/public-page", requireAdmin, async (req: any, res) => {
    const parsed = z.object({ blocked: z.boolean(), note: z.string().trim().max(300).optional().nullable() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Choose on or off." });
    try {
      await setPublicPageBlocked(req.params.id, parsed.data.blocked, userIdOf(req), parsed.data.note || null);
      if (parsed.data.blocked) {
        queueNotificationTask(`page blocked for ${req.params.id}`, storage.notifyProviderOfAccount({
          providerUserId: req.params.id,
          title: "TBM switched your public page off",
          body: parsed.data.note || "Message TBM to find out why and what to change.",
          actionUrl: "/provider/share",
        }));
      }
      return res.json(await getProviderPageSettings(req.params.id));
    } catch (error) {
      console.error("[PROVIDER_PAGES] Admin switch failed:", error);
      return res.status(500).json({ error: "Couldn't change the page" });
    }
  });
}
