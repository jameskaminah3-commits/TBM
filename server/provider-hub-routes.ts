// Routes for the provider profile (business, payout, verification) and for
// date blocks on home help and experience listings. Payout details are only
// ever returned to the provider themselves and to TBM's admins.
import crypto from "crypto";
import type { Express } from "express";
import { ZodError } from "zod";
import { storage } from "./storage";
import { db } from "./db";
import { users } from "@shared/schema";
import { hashPassword } from "./auth-utils";
import { createRateLimitMiddleware, getRequestIp } from "./middleware/rate-limit";
import { getPrivateFile } from "./private-files";
import { privateFileKeyFromUrl } from "./private-file-key";
import { isAuthenticated, issueAccountSetupLink, requireAdmin, requireProviderOrAdmin } from "./middleware/auth";
import { providerAppUrl, queueNotificationTask, sendSimpleEmail } from "./notifications";
import { emailPayoutDetailsConfirmed, emailProviderVerified } from "./provider-emails";
import {
  confirmPayoutDetails,
  createProviderApplication,
  getApplicationByStatusToken,
  getProviderApplication,
  listProviderApplications,
  updateProviderApplication,
  createListingBlock,
  deleteListingBlock,
  getListingBlocks,
  getProviderProfile,
  requestVerification,
  saveBusinessProfile,
  savePayoutDetails,
  setVerification,
} from "./provider-hub";
import {
  describePayoutDestination,
  providerBusinessProfileSchema,
  providerPayoutDetailsSchema,
  verificationStatuses,
  type VerificationStatus,
} from "@shared/provider-profile";
import { listingBlockInputSchema, type ListingBlockKind } from "@shared/listing-blocks";
import {
  ACCOUNT_SETUP_LINK_HOURS,
  applicationDeclineReasonLabels,
  applicationDeclineReasons,
  applicationDetailFields,
  applicationStage,
  officialContactLine,
  PROVIDER_STATS_THRESHOLD,
  providerApplicationSchema,
  verificationDocuments,
  verificationDocumentsWhy,
  type ApplicationServiceType,
} from "@shared/provider-applications";
import { providerWorkspaces } from "@shared/provider-workspaces";

// Applications come from anyone, so each address can send only a few.
const applicationRateLimit = createRateLimitMiddleware([
  {
    id: "provider-applications:ip",
    key: (req) => getRequestIp(req),
    max: 5,
    windowMs: 60 * 60 * 1000,
    message: "Too many applications from here. Please try again later, or call TBM.",
  },
]);

const applicationStatusRateLimit = createRateLimitMiddleware([
  {
    id: "provider-applications:status:ip",
    key: (req) => getRequestIp(req),
    max: 30,
    windowMs: 60 * 60 * 1000,
    message: "Too many checks from here. Please try again later.",
  },
]);

const statusLinkFor = (token: string) => providerAppUrl(`/partner/application#${token}`);

function firstNameOf(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || undefined;
}

function serviceLabelOf(serviceType: string) {
  return (providerWorkspaces[serviceType as keyof typeof providerWorkspaces]?.label ?? "your service").toLowerCase();
}

function describeAnswers(serviceType: keyof typeof applicationDetailFields, details: Record<string, unknown>) {
  return applicationDetailFields[serviceType]
    .filter((field) => details[field.key] !== undefined && details[field.key] !== "")
    .map((field) => {
      const value = details[field.key];
      return `${field.label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`;
    });
}

const userIdOf = (req: any): string => req.user.claims.sub;
const isAdminRequest = (req: any) => req.user?.claims?.role === "admin";

function zodMessage(error: unknown) {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Check the details and try again.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

function displayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | undefined) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "A provider";
}

async function assertManagesListing(req: any, kind: ListingBlockKind, listingId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const listing = kind === "errand" ? await storage.getErrand(listingId) : await storage.getExperience(listingId);
  if (!listing) return { ok: false, status: 404, error: "Listing not found" };
  if (!isAdminRequest(req) && listing.managerUserId !== userIdOf(req)) {
    return { ok: false, status: 403, error: "This listing isn't yours to manage." };
  }
  return { ok: true };
}

export function registerProviderHubRoutes(app: Express) {
  // ── The provider's own profile ──────────────────────────────────────────
  app.get("/api/provider/profile", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const user = await storage.getUser(userIdOf(req));
      const profile = await getProviderProfile(userIdOf(req));
      res.json({
        account: {
          firstName: user?.firstName ?? "",
          lastName: user?.lastName ?? "",
          phone: user?.phone ?? "",
          email: user?.email ?? "",
        },
        profile,
      });
    } catch (error) {
      console.error("[PROVIDER_PROFILE] Load failed:", error);
      res.status(500).json({ error: "Couldn't load your profile" });
    }
  });

  app.put("/api/provider/profile/business", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const input = providerBusinessProfileSchema.parse(req.body ?? {});
      res.json({ profile: await saveBusinessProfile(userIdOf(req), input) });
    } catch (error) {
      res.status(400).json({ error: zodMessage(error) });
    }
  });

  // New payout details wait for TBM to confirm them. TBM is alerted, and the
  // provider is emailed, so a change they didn't make doesn't go unnoticed.
  app.put("/api/provider/profile/payout", requireProviderOrAdmin, async (req: any, res) => {
    let input;
    try {
      input = providerPayoutDetailsSchema.parse(req.body ?? {});
    } catch (error) {
      return res.status(400).json({ error: zodMessage(error) });
    }
    try {
      const userId = userIdOf(req);
      const profile = await savePayoutDetails(userId, input);
      const user = await storage.getUser(userId);
      const destination = describePayoutDestination(profile) ?? "new payout details";
      queueNotificationTask(`payout details alert for ${userId}`, storage.notifyAdminsOfProviderAccount({
        actorUserId: userId,
        title: `Payout details changed: ${displayName(user)}`,
        body: `${displayName(user)} set payouts to ${destination}. Check and confirm them before the next payout.`,
        actionUrl: `/admin/providers?provider=${encodeURIComponent(userId)}`,
        priority: "high",
      }));
      if (user?.email) {
        queueNotificationTask(`payout details email for ${userId}`, sendSimpleEmail({
          to: [user.email],
          greetingName: user.firstName,
          subject: "Your payout details were changed",
          paragraphs: [
            `Your Provider Hub payout details were changed to ${destination}.`,
            "TBM confirms new payout details before the next payout. If you didn't make this change, contact TBM straight away.",
          ],
          link: { label: "See your payout details", url: providerAppUrl("/provider/profile#payout") },
        }));
      }
      res.json({ profile });
    } catch (error) {
      console.error("[PROVIDER_PROFILE] Payout save failed:", error);
      res.status(500).json({ error: "Couldn't save your payout details" });
    }
  });

  app.post("/api/provider/profile/verification", requireProviderOrAdmin, async (req: any, res) => {
    try {
      const userId = userIdOf(req);
      const { profile, changed } = await requestVerification(userId);
      if (changed) {
        const user = await storage.getUser(userId);
        queueNotificationTask(`verification request alert for ${userId}`, storage.notifyAdminsOfProviderAccount({
          actorUserId: userId,
          title: `Verification asked for: ${displayName(user)}`,
          body: `${displayName(user)} asked TBM to verify their account. Check their ID and their right to offer the service.`,
          actionUrl: `/admin/providers?provider=${encodeURIComponent(userId)}`,
        }));
      }
      res.json({ profile });
    } catch (error) {
      console.error("[PROVIDER_PROFILE] Verification request failed:", error);
      res.status(500).json({ error: "Couldn't send your request" });
    }
  });

  // ── TBM's side ─────────────────────────────────────────────────────────
  app.get("/api/admin/providers/:id/profile", requireAdmin, async (req, res) => {
    try {
      res.json({ profile: await getProviderProfile(req.params.id) });
    } catch (error) {
      res.status(500).json({ error: "Couldn't load the provider's profile" });
    }
  });

  app.post("/api/admin/providers/:id/payout-details/confirm", requireAdmin, async (req: any, res) => {
    try {
      const confirmed = await confirmPayoutDetails(req.params.id, userIdOf(req));
      if (!confirmed) return res.status(409).json({ error: "There are no new payout details to confirm." });
      queueNotificationTask(`payout confirmed alert for ${req.params.id}`, storage.notifyProviderOfAccount({
        providerUserId: req.params.id,
        title: "Payout details confirmed",
        body: "TBM confirmed your payout details. Your next payout goes there.",
        actionUrl: "/provider/profile#payout",
      }));
      emailPayoutDetailsConfirmed(req.params.id);
      res.json({ profile: await getProviderProfile(req.params.id) });
    } catch (error) {
      res.status(500).json({ error: "Couldn't confirm the payout details" });
    }
  });

  app.post("/api/admin/providers/:id/verification", requireAdmin, async (req: any, res) => {
    const status = req.body?.status as VerificationStatus;
    if (!verificationStatuses.includes(status)) return res.status(400).json({ error: "Choose a verification status." });
    const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 300) : null;
    try {
      const before = await getProviderProfile(req.params.id);
      const profile = await setVerification(req.params.id, status, note, userIdOf(req));
      if (status === "verified" || note) {
        queueNotificationTask(`verification result for ${req.params.id}`, storage.notifyProviderOfAccount({
          providerUserId: req.params.id,
          title: status === "verified" ? "You're verified" : "A note about your verification",
          body: status === "verified" ? "TBM has verified your account." : note ?? "",
          actionUrl: "/provider/profile#verification",
        }));
      }
      // Emailed once, when the account becomes verified.
      if (status === "verified" && before.verificationStatus !== "verified") emailProviderVerified(req.params.id);
      res.json({ profile });
    } catch (error) {
      res.status(500).json({ error: "Couldn't update verification" });
    }
  });

  // ── Date blocks on home help and experiences ───────────────────────────
  for (const [segment, kind] of [["errands", "errand"], ["experiences", "experience"]] as const) {
    app.get(`/api/provider/${segment}/:id/blocks`, requireProviderOrAdmin, async (req: any, res) => {
      const access = await assertManagesListing(req, kind, req.params.id);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
      res.json({ blocks: await getListingBlocks(kind, req.params.id) });
    });

    app.post(`/api/provider/${segment}/:id/blocks`, requireProviderOrAdmin, async (req: any, res) => {
      const access = await assertManagesListing(req, kind, req.params.id);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
      let input;
      try {
        input = listingBlockInputSchema.parse(req.body ?? {});
      } catch (error) {
        return res.status(400).json({ error: zodMessage(error) });
      }
      const existing = await getListingBlocks(kind, req.params.id);
      if (existing.some((block) => block.startDate <= input.endDate && input.startDate <= block.endDate)) {
        return res.status(409).json({ error: "Those dates are already blocked." });
      }
      const block = await createListingBlock({ kind, listingId: req.params.id, startDate: input.startDate, endDate: input.endDate, reason: input.reason ?? null, userId: userIdOf(req) });
      res.status(201).json({ block });
    });

    app.delete(`/api/provider/${segment}/:id/blocks/:blockId`, requireProviderOrAdmin, async (req: any, res) => {
      const access = await assertManagesListing(req, kind, req.params.id);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
      const deleted = await deleteListingBlock(kind, req.params.id, req.params.blockId);
      if (!deleted) return res.status(404).json({ error: "Block not found" });
      res.status(204).send();
    });

    // Guests' booking pages grey these dates out. Dates only: no reasons.
    app.get(`/api/${segment}/:id/blocked-dates`, async (req, res) => {
      try {
        const blocks = await getListingBlocks(kind, req.params.id);
        res.json({ blockedRanges: blocks.map((block) => ({ startDate: block.startDate, endDate: block.endDate })) });
      } catch {
        res.json({ blockedRanges: [] });
      }
    });
  }

  // ── Joining TBM: applications from hosts, chefs, home help and experiences ──
  app.post("/api/provider-applications", applicationRateLimit, async (req, res) => {
    let input;
    try {
      input = providerApplicationSchema.parse(req.body ?? {});
    } catch (error) {
      return res.status(400).json({ error: zodMessage(error) });
    }
    try {
      // Photos must be this site's private application uploads.
      const photos: Array<{ label: string; url: string }> = [];
      for (const photo of input.photos) {
        const key = privateFileKeyFromUrl(photo.url);
        const file = key ? await getPrivateFile(key) : null;
        if (!file || file.kind !== "fleet-application") {
          return res.status(400).json({ error: "Please add your photos again." });
        }
        photos.push({ label: photo.label || "Photo", url: photo.url });
      }
      const { application, statusToken } = await createProviderApplication({
        serviceType: input.serviceType,
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        town: input.town,
        details: input.details,
        photos,
        documents: [],
      });
      const label = providerWorkspaces[input.serviceType].label;
      const answers = describeAnswers(input.serviceType, input.details);
      queueNotificationTask(`provider application alert ${application.id}`, storage.notifyAdminsOfProviderAccount({
        title: `New provider application: ${label}`,
        body: `${input.fullName} from ${input.town} applied to offer ${label.toLowerCase()} through TBM.`,
        actionUrl: `/admin/provider-applications?application=${application.id}`,
        priority: "high",
      }));
      queueNotificationTask(`provider application team email ${application.id}`, sendSimpleEmail({
        to: "team",
        subject: `New provider application ${application.reference}: ${label} from ${input.fullName}`,
        paragraphs: [
          `${input.fullName} (${input.town}) applied to offer ${label.toLowerCase()} through TBM. Reference ${application.reference}.`,
          `Phone ${input.phone}, email ${input.email}.`,
          ...answers,
          `${photos.length} photo${photos.length === 1 ? "" : "s"} attached (private).`,
        ],
        link: { label: "Review the application", url: providerAppUrl(`/admin/provider-applications?application=${application.id}`) },
      }));
      queueNotificationTask(`provider application receipt ${application.id}`, sendSimpleEmail({
        to: [input.email],
        greetingName: input.fullName.split(/\s+/)[0],
        subject: `We've got your application (${application.reference})`,
        paragraphs: [
          `Asante for applying to offer ${label.toLowerCase()} with Tembea Bila Matata. Your reference is ${application.reference}.`,
          "Our team reviews applications in the order they arrive. We'll call or WhatsApp you to talk it through. You can check where your application is at any time with the link below.",
          `You don't need any documents yet. Before your listing goes live, TBM checks your ID and ${verificationDocuments[input.serviceType as ApplicationServiceType]}, ${verificationDocumentsWhy[input.serviceType as ApplicationServiceType]}. You'll add them in your Provider Hub, where only TBM's team sees them.`,
          "There's no joining fee and no monthly subscription fee. TBM earns a commission on bookings made through TBM, agreed with you before your first payout.",
          officialContactLine,
        ],
        link: { label: "Check your application", url: statusLinkFor(statusToken) },
      }));
      res.status(201).json({ reference: application.reference, statusToken });
    } catch (error) {
      console.error("[PROVIDER_APPLICATIONS] Create failed:", error);
      res.status(500).json({ error: "Couldn't send your application. Please try again, or call TBM." });
    }
  });

  // The applicant's status page. The link's token is the only key; the answer
  // names the service and the stage, and nothing personal beyond a first name.
  app.post("/api/provider-applications/status", applicationStatusRateLimit, async (req, res) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      const application = await getApplicationByStatusToken(req.body?.token);
      if (!application) return res.status(404).json({ error: "This link isn't valid or has expired. Call or WhatsApp TBM and quote your reference." });
      const stage = applicationStage(application.status);
      const reason = application.status === "declined" && application.declineReason && application.declineReason in applicationDeclineReasonLabels
        ? applicationDeclineReasonLabels[application.declineReason as keyof typeof applicationDeclineReasonLabels]
        : null;
      res.json({
        reference: application.reference,
        firstName: firstNameOf(application.fullName) ?? null,
        service: serviceLabelOf(application.serviceType),
        status: application.status,
        stageLabel: stage.label,
        next: stage.next,
        message: application.status === "needs-info" || application.status === "declined" ? application.applicantMessage : null,
        reason,
        appliedAt: application.createdAt,
        updatedAt: application.updatedAt,
      });
    } catch (error) {
      console.error("[PROVIDER_APPLICATIONS] Status failed:", error);
      res.status(500).json({ error: "Couldn't load your application. Please try again." });
    }
  });

  app.get("/api/admin/provider-applications", requireAdmin, async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      res.json(await listProviderApplications());
    } catch (error) {
      res.status(500).json({ error: "Couldn't load applications" });
    }
  });

  // Status changes. "More information needed" and "declined" are emailed to the
  // applicant with the message TBM writes for them; the team note stays internal.
  app.post("/api/admin/provider-applications/:id/status", requireAdmin, async (req: any, res) => {
    const status = req.body?.status;
    if (status !== "contacted" && status !== "declined" && status !== "new" && status !== "needs-info") {
      return res.status(400).json({ error: "Choose in review, more information needed, declined or new." });
    }
    const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 500) : undefined;
    const applicantMessage = typeof req.body?.applicantMessage === "string" && req.body.applicantMessage.trim()
      ? req.body.applicantMessage.trim().slice(0, 800)
      : null;
    const declineReason = typeof req.body?.declineReason === "string" && (applicationDeclineReasons as readonly string[]).includes(req.body.declineReason)
      ? req.body.declineReason
      : null;
    if (status === "needs-info" && !applicantMessage) {
      return res.status(400).json({ error: "Write what you need from the applicant. It's emailed to them." });
    }
    if (status === "declined" && !declineReason) {
      return res.status(400).json({ error: "Choose a reason. It's emailed to the applicant." });
    }
    const current = await getProviderApplication(req.params.id);
    if (!current) return res.status(404).json({ error: "Application not found" });
    if (current.status === "approved") return res.status(409).json({ error: "This application is already approved." });
    const updated = await updateProviderApplication(req.params.id, {
      status,
      reviewNote: note,
      reviewedBy: userIdOf(req),
      applicantMessage: status === "needs-info" || status === "declined" ? applicantMessage : null,
      declineReason: status === "declined" ? declineReason : null,
    });
    if (!updated) return res.status(404).json({ error: "Application not found" });
    const label = serviceLabelOf(updated.serviceType);
    if (status === "needs-info") {
      queueNotificationTask(`provider application needs info ${updated.id}`, sendSimpleEmail({
        to: [updated.email],
        greetingName: firstNameOf(updated.fullName),
        subject: `TBM needs a little more information (${updated.reference})`,
        paragraphs: [
          `Thank you for applying to offer ${label} with Tembea Bila Matata. To keep going, we need:`,
          applicantMessage!,
          "Reply to this email, or call or WhatsApp TBM and quote your reference.",
          officialContactLine,
        ],
      }));
    }
    if (status === "declined" && current.status !== "declined") {
      queueNotificationTask(`provider application declined ${updated.id}`, sendSimpleEmail({
        to: [updated.email],
        greetingName: firstNameOf(updated.fullName),
        subject: `Your TBM application (${updated.reference})`,
        paragraphs: [
          `Thank you for applying to offer ${label} with Tembea Bila Matata, and for your time.`,
          `We can't take your application further at the moment. ${applicationDeclineReasonLabels[declineReason as keyof typeof applicationDeclineReasonLabels]}`,
          ...(applicantMessage ? [applicantMessage] : []),
          "You're welcome to apply again when things change. If you think we've got something wrong, reply to this email.",
          officialContactLine,
        ],
      }));
    }
    res.json(updated);
  });

  // A new account set-up link, for an approved applicant who hasn't used theirs.
  app.post("/api/admin/provider-applications/:id/setup-link", requireAdmin, async (req: any, res) => {
    try {
      const application = await getProviderApplication(req.params.id);
      if (!application) return res.status(404).json({ error: "Application not found" });
      if (application.status !== "approved" || !application.createdUserId) return res.status(409).json({ error: "Approve the application first." });
      const { url } = await issueAccountSetupLink(application.email);
      queueNotificationTask(`account setup resend ${application.id}`, sendSimpleEmail({
        to: [application.email],
        greetingName: firstNameOf(application.fullName),
        subject: "Your link to set up your TBM account",
        paragraphs: [
          `Here's your link to choose a password for your Provider Hub. It works once, for the next ${ACCOUNT_SETUP_LINK_HOURS} hours.`,
          "If this email address is a Gmail one, you can also tap Continue with Google on the sign-in page.",
          officialContactLine,
        ],
        link: { label: "Set up your account", url },
      }));
      res.json({ sent: true });
    } catch (error) {
      console.error("[PROVIDER_APPLICATIONS] Setup link failed:", error);
      res.status(500).json({ error: "Couldn't send the link" });
    }
  });

  // Approving makes the provider's account with the service they applied for.
  // Nobody at TBM knows the password: the provider sets their own with
  // "Forgot password?", which also proves the email is theirs.
  app.post("/api/admin/provider-applications/:id/approve", requireAdmin, async (req: any, res) => {
    try {
      const application = await getProviderApplication(req.params.id);
      if (!application) return res.status(404).json({ error: "Application not found" });
      if (application.status === "approved") return res.status(409).json({ error: "This application is already approved." });
      const existingUser = await storage.getUserByEmail(application.email);
      if (existingUser) {
        return res.status(409).json({ error: "An account with this email already exists. Add the service to that account under Providers." });
      }
      const nameParts = application.fullName.trim().split(/\s+/).filter(Boolean);
      const [created] = await db.insert(users).values({
        email: application.email,
        phone: application.phone,
        firstName: nameParts[0] ?? null,
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
        passwordHash: hashPassword(crypto.randomBytes(24).toString("hex")),
        role: "provider",
        providerType: application.serviceType,
      }).returning();
      const updated = await updateProviderApplication(application.id, { status: "approved", createdUserId: created.id, reviewedBy: userIdOf(req), applicantMessage: null, declineReason: null });
      const label = serviceLabelOf(application.serviceType);
      const service = application.serviceType as ApplicationServiceType;
      const { url } = await issueAccountSetupLink(application.email);
      queueNotificationTask(`provider application approved ${application.id}`, sendSimpleEmail({
        to: [application.email],
        greetingName: nameParts[0],
        subject: "Karibu: your Provider Hub is ready",
        paragraphs: [
          `You're approved to offer ${label} with Tembea Bila Matata.`,
          `Start by choosing your password with the link below. It's yours alone: nobody at TBM knows it. The link works once, for the next ${ACCOUNT_SETUP_LINK_HOURS} hours. If this email address is a Gmail one, you can also tap Continue with Google on the sign-in page.`,
          `Then add your first listing with photos and your price, and upload your ID and ${verificationDocuments[service] ?? "your documents"} in the Hub. TBM checks them, publishes your listing, and you can share it straight away.`,
          officialContactLine,
        ],
        link: { label: "Set up your account", url },
      }));
      res.json(updated);
    } catch (error) {
      console.error("[PROVIDER_APPLICATIONS] Approve failed:", error);
      res.status(500).json({ error: "Couldn't approve the application" });
    }
  });

  // Real numbers for the Become a Provider page, shown only once there are
  // enough to mean something. Counts only: no names or listings.
  app.get("/api/provider-program/stats", async (_req, res) => {
    try {
      const [stays, cars, cooks, errands, experiences] = await Promise.all([
        storage.getStays(), storage.getCars(), storage.getCooks(), storage.getErrands(), storage.getExperiences(),
      ]);
      const byType = {
        stays: stays.filter((item) => item.isPublic).length,
        cars: cars.filter((item) => item.isPublic).length,
        cooks: cooks.filter((item) => item.isPublic).length,
        errands: errands.filter((item) => item.isPublic).length,
        experiences: experiences.filter((item) => item.isPublic).length,
      };
      const liveListings = Object.values(byType).reduce((sum, count) => sum + count, 0);
      res.setHeader("Cache-Control", "public, max-age=600");
      res.json(liveListings >= PROVIDER_STATS_THRESHOLD ? { show: true, liveListings, byType } : { show: false });
    } catch {
      res.json({ show: false });
    }
  });

  // Signed-in only; kept here so the Hub shell can ask without a provider check.
  app.get("/api/provider/profile/summary", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProviderProfile(userIdOf(req));
      res.json({
        businessName: profile.businessName,
        photoUrl: profile.photoUrl,
        verificationStatus: profile.verificationStatus,
        hasPayout: Boolean(profile.payoutMethod),
      });
    } catch {
      res.json({ businessName: "", photoUrl: "", verificationStatus: "not-started", hasPayout: false });
    }
  });
}
