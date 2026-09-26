// zaina-platform/src/signup/routes.ts
//
// A business signs up by itself (Phase 5), when the platform team has opened
// sign-up (PLATFORM_SIGNUP=open):
//
//   GET  /v1/signup/config   whether sign-up is open, and the kinds of business that can join
//   POST /v1/signup          { name, email, password, business_name, business_type, time_zone?, website?, accept_terms }
//   GET  /v1/signup/confirm  the link in the email: confirms the address, then on to the console
//   POST /v1/signup/resend   { email }: the link again, for an account not confirmed yet
//
// The business starts "setting up" (onboarding): its owner signs in once the
// email is confirmed, sets it up in the console and puts it live. The answer
// is the same whether or not the email already has an account (that person
// gets an email saying so instead), so sign-up can't be used to find out who
// has one. Sign-ups are limited per visitor, per email and in all.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { clearBusinessCache } from "../businesses/registry.ts";
import { confirmStaffEmail, createSelfServeBusiness, findStaffByEmail } from "../db/platform-scope.ts";
import type { BusinessType } from "../db/schema.ts";
import { normalizeOrigin } from "../gateway/origin.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { visitorKey } from "../gateway/visitor.ts";
import { sendEmail } from "../platform/mailer.ts";
import { DEFAULT_DAILY_TOKEN_CAP, DEFAULT_RETENTION_DAYS } from "../platform/routes.ts";
import { hashPassword, passwordProblem } from "../staff/passwords.ts";

/** The kinds of business that can sign up (a travel concierge needs its own connector, set up by the platform team). */
export const SIGNUP_TYPES: Array<{ type: BusinessType; label: string }> = [
  { type: "guesthouse", label: "A place to stay (guesthouse, lodge, small hotel, apartments)" },
  { type: "salon", label: "A salon, barber or spa" },
  { type: "restaurant", label: "A restaurant or café" },
  { type: "general", label: "Another business (Zaina answers questions and takes enquiries)" },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CONFIRM_TTL_SECONDS = 48 * 60 * 60;

// ── The confirmation link ─────────────────────────────────────────────
//   ev1.<payload>.<signature>   payload = base64url(JSON {u, e, exp})
// It names the person and the email it was sent to: a link for an old
// address can't confirm a changed one.

function signature(secret: string, payload: string): string {
  const key = createHmac("sha256", secret).update("zaina-email-confirm").digest();
  return createHmac("sha256", key).update(`ev1.${payload}`).digest("base64url");
}

export function confirmToken(secret: string, user: { id: string; email: string }, now = new Date()): string {
  const payload = Buffer.from(JSON.stringify({ u: user.id, e: user.email, exp: Math.floor(now.getTime() / 1000) + CONFIRM_TTL_SECONDS })).toString("base64url");
  return `ev1.${payload}.${signature(secret, payload)}`;
}

export function readConfirmToken(secret: string, token: unknown, now = new Date()): { userId: string; email: string } | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const [version, payload, given, extra] = token.split(".");
  if (version !== "ev1" || !payload || !given || extra !== undefined) return null;
  const expected = Buffer.from(signature(secret, payload));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims?.u !== "string" || typeof claims?.e !== "string" || !Number.isInteger(claims?.exp)) return null;
    if (claims.exp <= Math.floor(now.getTime() / 1000)) return null;
    return { userId: claims.u, email: claims.e };
  } catch {
    return null;
  }
}

/** A business's id from its name: "Coral Cove Guesthouse" → "coral-cove-guesthouse-4f2a". */
export function businessIdFor(name: string, suffix = randomBytes(2).toString("hex")): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const start = /^[a-z]/.test(base) ? base : `biz${base ? `-${base}` : ""}`;
  return `${start.slice(0, 34).replace(/-+$/, "")}-${suffix}`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

export function registerSignupRoutes(app: Express, config: PlatformConfig): void {
  const secret = config.sessionTokenSecret;
  const origin = config.publicBaseUrl ?? "";
  const accepted = { ok: true, message: "Check your email: we've sent a link to confirm your address. It works for 48 hours." };

  function sendConfirmation(user: { id: string; email: string; name: string }, businessName: string | null) {
    const link = `${origin}/v1/signup/confirm?token=${encodeURIComponent(confirmToken(secret, user))}`;
    void sendEmail({
      to: user.email,
      subject: "Confirm your email for Zaina",
      text: [
        `Hi ${firstName(user.name)},`,
        "",
        businessName ? `Thanks for signing up ${businessName} on Zaina. Confirm your email to start setting it up:` : "Confirm your email to start setting up on Zaina:",
        link,
        "",
        "The link works for 48 hours. If you didn't sign up, ignore this email and nothing happens.",
      ].join("\n"),
    });
  }

  app.get("/v1/signup/config", (_req: Request, res: Response) => {
    res.json({ open: config.signupOpen, business_types: config.signupOpen ? SIGNUP_TYPES : [], terms_url: config.termsUrl, privacy_url: config.privacyUrl });
  });

  app.post("/v1/signup", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!config.signupOpen) return res.status(404).json({ error: "signup_closed", message: "Sign-up isn't open yet. Please ask the Zaina team." });
      const body = req.body ?? {};
      const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const businessName = typeof body.business_name === "string" ? body.business_name.trim().replace(/\s+/g, " ") : "";
      const businessType = body.business_type as BusinessType;
      const timeZone = typeof body.time_zone === "string" && body.time_zone ? body.time_zone : "Africa/Nairobi";
      const website = typeof body.website === "string" && body.website.trim() ? body.website.trim() : null;
      if (!name || name.length > 120) return res.status(400).json({ error: "name_required", message: "Your name, please." });
      if (!EMAIL.test(email) || email.length > 200) return res.status(400).json({ error: "invalid_email", message: "An email address we can send the link to, please." });
      const weak = passwordProblem(body.password);
      if (weak) return res.status(400).json({ error: "weak_password", message: weak });
      if (businessName.length < 2 || businessName.length > 120) return res.status(400).json({ error: "business_name_required", message: "Your business's name, please." });
      if (!SIGNUP_TYPES.some((entry) => entry.type === businessType)) return res.status(400).json({ error: "invalid_business_type", message: "Choose what kind of business it is." });
      try {
        new Intl.DateTimeFormat("en", { timeZone });
      } catch {
        return res.status(400).json({ error: "invalid_time_zone", message: "That time zone isn't one we know." });
      }
      const websiteOrigin = website ? normalizeOrigin(/^https?:\/\//i.test(website) ? website : `https://${website}`) : null;
      if (website && !websiteOrigin) return res.status(400).json({ error: "invalid_website", message: "Your website's address, like https://www.example.com (or leave it empty)." });
      if (body.accept_terms !== true) return res.status(400).json({ error: "terms_required", message: "Please accept the terms to sign up." });

      const verdict = await consumeLimits([
        { key: `signup:visitor:${visitorKey(secret, req.ip)}`, limit: 5, windowSeconds: 3600 },
        { key: `signup:email:${visitorKey(secret, email)}`, limit: 3, windowSeconds: 86_400 },
        { key: "signup:all", limit: 500, windowSeconds: 86_400 },
      ]);
      if (!verdict.allowed) {
        res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
        return res.status(429).json({ error: "rate_limited", message: "Too many sign-ups just now. Please try again later." });
      }

      // The same work, and the same answer, whether or not the email has an account.
      const passwordHash = await hashPassword(body.password);
      const existing = await findStaffByEmail(email);
      if (existing) {
        void sendEmail({
          to: existing.email,
          subject: "You already have a Zaina account",
          text: [
            `Hi ${firstName(existing.name)},`,
            "",
            "Someone (probably you) tried to sign up on Zaina with this email, which already has an account.",
            `Sign in at ${origin}/console/`,
            existing.emailVerifiedAt ? "" : "Your email isn't confirmed yet: sign in and ask for a new confirmation link.",
            "If it wasn't you, ignore this email: nothing has changed.",
          ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n"),
        });
        return res.status(202).json(accepted);
      }

      let owner = null;
      for (let attempt = 0; attempt < 4 && !owner; attempt += 1) {
        const id = businessIdFor(businessName);
        try {
          owner = await createSelfServeBusiness({
            business: {
              id, name: businessName, publicKey: `pk_${id.replace(/-/g, "_")}_${randomBytes(6).toString("hex")}`, allowedOrigins: websiteOrigin ? [websiteOrigin] : [],
              timeZone, dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP, retentionDays: DEFAULT_RETENTION_DAYS, businessType, websiteUrl: websiteOrigin,
            },
            owner: { email, name, passwordHash },
          });
        } catch (error) {
          const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
          if (database.code === "23505" && database.constraint === "businesses_pkey") continue;
          // Signed up twice at once: the second is answered like any existing account.
          if (database.code === "23505") return res.status(202).json(accepted);
          throw error;
        }
      }
      if (!owner) throw new Error("No free business id after four tries");
      clearBusinessCache();
      sendConfirmation(owner, businessName);
      res.status(202).json(accepted);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/signup/confirm", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const claims = readConfirmToken(secret, req.query.token);
      const user = claims ? await confirmStaffEmail(claims.userId, claims.email) : undefined;
      res.redirect(303, `${origin}/console/?confirmed=${user ? "yes" : "expired"}`);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/signup/resend", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!EMAIL.test(email)) return res.status(400).json({ error: "invalid_email", message: "The email you signed up with, please." });
      const verdict = await consumeLimits([
        { key: `signup-resend:visitor:${visitorKey(secret, req.ip)}`, limit: 5, windowSeconds: 3600 },
        { key: `signup-resend:email:${visitorKey(secret, email)}`, limit: 3, windowSeconds: 86_400 },
      ]);
      if (!verdict.allowed) return res.status(429).json({ error: "rate_limited", message: "Too many requests just now. Please try again later." });
      const user = await findStaffByEmail(email);
      if (user && !user.emailVerifiedAt && !user.disabledAt) sendConfirmation(user, null);
      res.status(202).json({ ok: true, message: "If that email has an account waiting to be confirmed, a new link is on its way." });
    } catch (error) {
      next(error);
    }
  });
}
