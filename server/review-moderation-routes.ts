// Replies to reviews (providers), reply approval and review hiding (TBM), and
// the Founding Provider badge (TBM). See review-moderation.ts and
// founding-providers.ts for the rules.
import type { Express } from "express";
import { z } from "zod";
import { reviewHideReasons } from "@shared/review-eligibility";
import { foundingRevokeReasons } from "@shared/founding-provider";
import { requireAdmin, requireProviderOrAdmin } from "./middleware/auth";
import { queueNotificationTask } from "./notifications";
import { storage } from "./storage";
import {
  decideReviewReply,
  listAdminReviews,
  listProviderReviews,
  saveProviderReply,
  setReviewHidden,
  withdrawProviderReply,
} from "./review-moderation";
import { grantFoundingProvider, listFoundingCandidates, revokeFoundingProvider } from "./founding-providers";
import { checkStoredRatings, recountStoredRatings } from "./rating-recount";

const userIdOf = (req: any): string => req.user.claims.sub;
const privateJson = (res: any) => res.setHeader("Cache-Control", "private, no-store");

export function registerReviewModerationRoutes(app: Express) {
  // ── The provider's reviews and replies ─────────────────────────────────
  app.get("/api/provider/reviews", requireProviderOrAdmin, async (req: any, res) => {
    try {
      privateJson(res);
      return res.json(await listProviderReviews(userIdOf(req)));
    } catch (error) {
      console.error("[REVIEWS] Provider reviews failed:", error);
      return res.status(500).json({ error: "Couldn't load your reviews" });
    }
  });

  app.put("/api/provider/reviews/:id/reply", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const result = await saveProviderReply(userIdOf(req), req.params.id, req.body?.text);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      queueNotificationTask(`reply alert for review ${req.params.id}`, storage.notifyAdminsOfProviderAccount({
        actorUserId: userIdOf(req),
        title: "A reply to a review is waiting",
        body: `A provider replied to a review of ${result.review.listingName}. Check it before it's public.`,
        actionUrl: "/admin/reviews",
      }));
      return res.json({ review: result.review });
    } catch (error) {
      console.error("[REVIEWS] Saving a reply failed:", error);
      return res.status(500).json({ error: "Couldn't save your reply" });
    }
  });

  app.delete("/api/provider/reviews/:id/reply", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const result = await withdrawProviderReply(userIdOf(req), req.params.id);
      return result.ok ? res.json({ review: result.review }) : res.status(result.status).json({ error: result.error });
    } catch (error) {
      console.error("[REVIEWS] Withdrawing a reply failed:", error);
      return res.status(500).json({ error: "Couldn't remove your reply" });
    }
  });

  // ── TBM: replies and hiding ────────────────────────────────────────────
  app.get("/api/admin/reviews", requireAdmin, async (_req, res) => {
    try {
      privateJson(res);
      return res.json({ reviews: await listAdminReviews() });
    } catch (error) {
      console.error("[REVIEWS] Admin reviews failed:", error);
      return res.status(500).json({ error: "Couldn't load reviews" });
    }
  });

  app.post("/api/admin/reviews/:id/reply", requireAdmin, async (req: any, res) => {
    const parsed = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(300).optional().nullable() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Approve or turn down the reply." });
    if (parsed.data.decision === "reject" && !parsed.data.note) return res.status(400).json({ error: "Say briefly why, so the provider can change it." });
    try {
      const result = await decideReviewReply(req.params.id, { decision: parsed.data.decision, note: parsed.data.note || null, adminId: userIdOf(req) });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      if (result.providerUserId) {
        queueNotificationTask(`reply decision for review ${req.params.id}`, storage.notifyProviderOfAccount({
          providerUserId: result.providerUserId,
          title: parsed.data.decision === "approve" ? "Your reply is public" : "Your reply wasn't approved",
          body: parsed.data.decision === "approve"
            ? `Your reply to a review of ${result.review.listingName} now shows with the review.`
            : `${parsed.data.note} You can change it and send it again.`,
          actionUrl: "/provider/reviews",
        }));
      }
      return res.json({ review: result.review });
    } catch (error) {
      console.error("[REVIEWS] Reply decision failed:", error);
      return res.status(500).json({ error: "Couldn't save the decision" });
    }
  });

  // Hidden only for abuse, personal details or the wrong booking; the reason is kept.
  app.post("/api/admin/reviews/:id/hide", requireAdmin, async (req: any, res) => {
    const parsed = z.object({ reason: z.enum(reviewHideReasons) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Choose why: abuse, personal details or the wrong booking. A review is never hidden for being negative." });
    try {
      const result = await setReviewHidden(req.params.id, { reason: parsed.data.reason, adminId: userIdOf(req) });
      return result.ok ? res.json({ review: result.review }) : res.status(result.status).json({ error: result.error });
    } catch (error) {
      console.error("[REVIEWS] Hiding failed:", error);
      return res.status(500).json({ error: "Couldn't hide the review" });
    }
  });

  app.post("/api/admin/reviews/:id/unhide", requireAdmin, async (req: any, res) => {
    try {
      const result = await setReviewHidden(req.params.id, { reason: null, adminId: userIdOf(req) });
      return result.ok ? res.json({ review: result.review }) : res.status(result.status).json({ error: result.error });
    } catch (error) {
      console.error("[REVIEWS] Unhiding failed:", error);
      return res.status(500).json({ error: "Couldn't show the review again" });
    }
  });

  // ── TBM: stored ratings against eligible reviews ───────────────────────
  app.get("/api/admin/ratings/check", requireAdmin, async (_req, res) => {
    try {
      privateJson(res);
      return res.json(await checkStoredRatings());
    } catch (error) {
      console.error("[REVIEWS] Rating check failed:", error);
      return res.status(500).json({ error: "Couldn't check the stored ratings" });
    }
  });

  // Only when TBM asks, after seeing the differences.
  app.post("/api/admin/ratings/recount", requireAdmin, async (req: any, res) => {
    try {
      const result = await recountStoredRatings();
      console.info(`[REVIEWS] Stored ratings recounted by ${userIdOf(req)}: ${result.updated} of ${result.checked} listings changed.`);
      return res.json(result);
    } catch (error) {
      console.error("[REVIEWS] Rating recount failed:", error);
      return res.status(500).json({ error: "Couldn't recount the stored ratings" });
    }
  });

  // ── TBM: the Founding Provider badge ───────────────────────────────────
  app.get("/api/admin/founding-providers", requireAdmin, async (_req, res) => {
    try {
      privateJson(res);
      return res.json({ candidates: await listFoundingCandidates() });
    } catch (error) {
      console.error("[FOUNDING] List failed:", error);
      return res.status(500).json({ error: "Couldn't load the list" });
    }
  });

  app.post("/api/admin/founding-providers/:id/grant", requireAdmin, async (req: any, res) => {
    try {
      const result = await grantFoundingProvider(req.params.id);
      if (!result.ok) return res.status(result.status).json({ error: result.error, reasons: "reasons" in result ? result.reasons : undefined });
      queueNotificationTask(`founding badge for ${req.params.id}`, storage.notifyProviderOfAccount({
        providerUserId: req.params.id,
        title: "You're a Founding Provider",
        body: "Your public page now shows the Founding Provider badge: one of the first providers to join TBM. Thank you for joining early.",
        actionUrl: "/provider/share",
      }));
      return res.json({ ok: true });
    } catch (error) {
      console.error("[FOUNDING] Grant failed:", error);
      return res.status(500).json({ error: "Couldn't grant the badge" });
    }
  });

  app.post("/api/admin/founding-providers/:id/revoke", requireAdmin, async (req: any, res) => {
    const parsed = z.object({ reason: z.enum(foundingRevokeReasons) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Choose why the badge is removed." });
    try {
      const result = await revokeFoundingProvider(req.params.id, parsed.data.reason);
      return result.ok ? res.json({ ok: true }) : res.status(result.status).json({ error: result.error });
    } catch (error) {
      console.error("[FOUNDING] Revoke failed:", error);
      return res.status(500).json({ error: "Couldn't remove the badge" });
    }
  });
}
