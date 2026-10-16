import crypto from "node:crypto";
import type { Express, RequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  emailVerificationOtps,
  forgotPasswordSchema,
  passwordResetOtps,
  providerCategories,
  resendVerificationSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type UserRole,
  users,
  verifyEmailSchema,
} from "@shared/schema";
import {
  generateOneTimeCode,
  hashOtp,
  hashPassword,
  normalizePhone,
  shouldBypassOtpVerificationForLocalTesting,
  splitName,
  verifyPassword,
} from "../auth-utils";
import { db, sessionPool } from "../db";
import {
  isTransactionalEmailConfigured,
  providerAppUrl,
  queueNotificationTask,
  sendSignupNotificationEmails,
  sendSimpleEmail,
  sendVerificationCode,
} from "../notifications";
import { ACCOUNT_SETUP_LINK_HOURS, officialContactLine } from "@shared/provider-applications";
import supabase from "../supabase";
import { storage } from "../storage";
import { createRateLimitMiddleware, getRequestIp } from "./rate-limit";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    role?: UserRole;
  }
}

const PgStore = connectPgSimple(session);

const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const defaultDevSessionSecret = "dev-session-secret-change-me";
const authRateLimitWindowMs = 15 * 60 * 1000;
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

function parseProviderTypes(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is typeof providerCategories[number] => providerCategories.includes(entry as typeof providerCategories[number]));
}

function normalizeRateLimitValue(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

async function getSessionUser(sessionUserId: string) {
  const user = await storage.getUser(sessionUserId);
  if (!user) {
    return null;
  }

  const email = user.email?.toLowerCase();
  const isAllowedAdmin = email ? adminEmails.has(email) : false;

  if (user.isSuspended) {
    return user;
  }

  if (isAllowedAdmin && user.role !== "admin") {
    const promoted = await storage.updateUserRole(user.id, "admin");
    return promoted;
  }

  return user;
}

async function resolveAuthenticatedUser(req: any, res: any) {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }

  try {
    const user = await getSessionUser(userId);
    if (!user) {
      req.session.destroy(() => undefined);
      res.status(401).json({ message: "Unauthorized" });
      return null;
    }

    if (user.isSuspended) {
      req.session.destroy(() => undefined);
      res.status(403).json({ message: "This account has been suspended." });
      return null;
    }

    return user;
  } catch (error) {
    console.error(`[AUTH] Failed to load session user for ${req.method} ${req.originalUrl ?? req.url}:`, {
      userId,
      error,
    });
    res.status(503).json({
      message: "Authentication is temporarily unavailable. Please try again.",
    });
    return null;
  }
}

function attachRequestUser(req: any, user: Awaited<ReturnType<typeof getSessionUser>>) {
  const providerTypes = user ? parseProviderTypes(user.providerType) : [];
  req.user = user
    ? {
        claims: {
          sub: user.id,
          email: user.email,
          phone: user.phone,
          first_name: user.firstName,
          last_name: user.lastName,
          role: user.role,
          provider_type: providerTypes[0] ?? user.providerType,
          provider_types: providerTypes,
        },
      }
    : undefined;
}

function setAuthenticatedSession(req: any, userId: string, role: UserRole) {
  req.session.userId = userId;
  req.session.role = role;
}

function resolveSessionSecret() {
  const configuredSecret = process.env.SESSION_SECRET?.trim();
  if (configuredSecret) {
    if (process.env.NODE_ENV === "production" && configuredSecret === defaultDevSessionSecret) {
      throw new Error("SESSION_SECRET must not use the development fallback value in production.");
    }
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production.");
  }

  console.warn("[SESSION] SESSION_SECRET is not set. Falling back to a development-only secret.");
  return defaultDevSessionSecret;
}

const signUpRateLimit = createRateLimitMiddleware([
  {
    id: "auth:signup:ip",
    key: (req) => getRequestIp(req),
    max: 6,
    windowMs: authRateLimitWindowMs,
    message: "Too many sign-up attempts. Please try again in a few minutes.",
  },
  {
    id: "auth:signup:email",
    key: (req) => normalizeRateLimitValue(req.body?.email),
    max: 3,
    windowMs: authRateLimitWindowMs,
    message: "Too many sign-up attempts for that email. Please try again later.",
  },
]);

const signInRateLimit = createRateLimitMiddleware([
  {
    id: "auth:signin:ip",
    key: (req) => getRequestIp(req),
    max: 10,
    windowMs: authRateLimitWindowMs,
    message: "Too many sign-in attempts. Please wait a few minutes and try again.",
  },
  {
    id: "auth:signin:identifier",
    key: (req) => normalizeRateLimitValue(req.body?.identifier),
    max: 8,
    windowMs: authRateLimitWindowMs,
    message: "Too many sign-in attempts for that account. Please wait and try again.",
  },
]);

const forgotPasswordRateLimit = createRateLimitMiddleware([
  {
    id: "auth:forgot-password:ip",
    key: (req) => getRequestIp(req),
    max: 5,
    windowMs: authRateLimitWindowMs,
    message: "Too many password reset requests. Please try again later.",
  },
  {
    id: "auth:forgot-password:email",
    key: (req) => normalizeRateLimitValue(req.body?.email),
    max: 3,
    windowMs: authRateLimitWindowMs,
    message: "Too many password reset requests for that account. Please try again later.",
  },
]);

const resetPasswordRateLimit = createRateLimitMiddleware([
  {
    id: "auth:reset-password:ip",
    key: (req) => getRequestIp(req),
    max: 8,
    windowMs: authRateLimitWindowMs,
    message: "Too many password reset attempts. Please try again later.",
  },
  {
    id: "auth:reset-password:email",
    key: (req) => normalizeRateLimitValue(req.body?.email),
    max: 5,
    windowMs: authRateLimitWindowMs,
    message: "Too many password reset attempts for that account. Please try again later.",
  },
]);

const accountSetupRateLimit = createRateLimitMiddleware([
  {
    id: "auth:account-setup:ip",
    key: (req) => getRequestIp(req),
    max: 20,
    windowMs: authRateLimitWindowMs,
    message: "Too many attempts. Please try again later, or call TBM.",
  },
]);

// ── Account set-up links ──────────────────────────────────────────────────
// When TBM approves a provider, they get a one-time link to choose their own
// password. Nobody at TBM knows it. The link works once, for 72 hours, and
// only its hash is stored (in password_reset_otps, purpose "account-setup").

const setupLinkTtlMs = ACCOUNT_SETUP_LINK_HOURS * 60 * 60 * 1000;

/** A new set-up link for this account. Earlier unused links stop working. */
// The live database can miss password_reset_otps.purpose (migration 0025)
// when its schema push didn't run: add it once, at start-up and before use.
let resetPurposeReady: Promise<void> | null = null;
export function ensurePasswordResetPurposeColumn() {
  resetPurposeReady ??= db.execute(sql`ALTER TABLE password_reset_otps ADD COLUMN IF NOT EXISTS purpose varchar NOT NULL DEFAULT 'password-reset'`)
    .then(() => undefined)
    .catch((error) => {
      resetPurposeReady = null;
      throw error;
    });
  return resetPurposeReady;
}

export async function issueAccountSetupLink(email: string) {
  await ensurePasswordResetPurposeColumn();
  const normalized = email.trim().toLowerCase();
  const token = crypto.randomBytes(32).toString("base64url");
  await db.update(passwordResetOtps)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetOtps.email, normalized), eq(passwordResetOtps.purpose, "account-setup"), isNull(passwordResetOtps.usedAt)));
  await db.insert(passwordResetOtps).values({
    email: normalized,
    otpHash: hashOtp(token),
    expiresAt: new Date(Date.now() + setupLinkTtlMs),
    purpose: "account-setup",
  });
  return { token, url: providerAppUrl(`/set-up-account#${token}`) };
}

async function findSetupLink(token: unknown) {
  if (typeof token !== "string" || token.length < 32 || token.length > 100) return null;
  await ensurePasswordResetPurposeColumn();
  const [record] = await db.select().from(passwordResetOtps)
    .where(and(eq(passwordResetOtps.otpHash, hashOtp(token)), eq(passwordResetOtps.purpose, "account-setup")))
    .limit(1);
  if (!record) return null;
  const state = record.usedAt ? "used" : record.expiresAt.getTime() < Date.now() ? "expired" : "ok";
  return { record, state } as const;
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return "your email";
  return `${name.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
}

const verifyEmailRateLimit = createRateLimitMiddleware([
  {
    id: "auth:verify-email:ip",
    key: (req) => getRequestIp(req),
    max: 8,
    windowMs: authRateLimitWindowMs,
    message: "Too many verification attempts. Please try again shortly.",
  },
  {
    id: "auth:verify-email:email",
    key: (req) => normalizeRateLimitValue(req.body?.email),
    max: 5,
    windowMs: authRateLimitWindowMs,
    message: "Too many verification attempts for that account. Please wait and try again.",
  },
]);

const resendVerificationRateLimit = createRateLimitMiddleware([
  {
    id: "auth:resend-verification:ip",
    key: (req) => getRequestIp(req),
    max: 5,
    windowMs: authRateLimitWindowMs,
    message: "Too many verification code requests. Please try again later.",
  },
  {
    id: "auth:resend-verification:email",
    key: (req) => normalizeRateLimitValue(req.body?.email),
    max: 3,
    windowMs: authRateLimitWindowMs,
    message: "Too many verification code requests for that account. Please try again later.",
  },
]);

const resetPasswordWithoutOtpSchema = resetPasswordSchema.omit({ otp: true });
const socialSessionSchema = z.object({
  accessToken: z.string().min(1, "Supabase access token is required"),
});

function isEmailVerified(user: { email: string | null; emailVerifiedAt: Date | null }) {
  return !user.email || Boolean(user.emailVerifiedAt);
}

function buildDevelopmentOtp(code: string) {
  return process.env.NODE_ENV === "development" ? code : undefined;
}

function shouldBypassOtpVerification(req: { hostname?: string | null | undefined }) {
  return shouldBypassOtpVerificationForLocalTesting({
    nodeEnv: process.env.NODE_ENV,
    hostname: typeof req.hostname === "string" ? req.hostname : null,
    localOtpBypass: process.env.LOCAL_OTP_BYPASS ?? null,
  });
}

function formatAuthError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function issueEmailVerificationCode(user: { id: string; email: string | null }) {
  if (!user.email) {
    throw new Error("Account is missing a valid email address.");
  }

  const email = user.email.trim().toLowerCase();
  const otp = generateOneTimeCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.delete(emailVerificationOtps).where(eq(emailVerificationOtps.email, email));

  const [createdOtp] = await db.insert(emailVerificationOtps).values({
    userId: user.id,
    email,
    otpHash: hashOtp(otp),
    expiresAt,
  }).returning({ id: emailVerificationOtps.id });

  const delivered = await sendVerificationCode({
    channel: "email",
    email,
    code: otp,
    purpose: "email-verification",
  });

  if (!delivered) {
    await db.delete(emailVerificationOtps).where(eq(emailVerificationOtps.id, createdOtp.id));
  }

  return {
    delivered,
    email,
    devOtp: buildDevelopmentOtp(otp),
  };
}

async function markUserEmailVerified(userId: string, now = new Date()) {
  const [updatedUser] = await db
    .update(users)
    .set({
      emailVerifiedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId))
    .returning();

  return updatedUser;
}

async function authenticateSessionUser(req: any, userId: string, notFoundMessage = "Unable to load account") {
  const sessionUser = await getSessionUser(userId);
  if (!sessionUser) {
    return {
      ok: false,
      status: 404,
      body: { message: notFoundMessage },
    } as const;
  }

  if (sessionUser.isSuspended) {
    return {
      ok: false,
      status: 403,
      body: { message: "This provider account has been suspended. Please contact support." },
    } as const;
  }

  setAuthenticatedSession(req, sessionUser.id, sessionUser.role as UserRole);
  attachRequestUser(req, sessionUser);

  return {
    ok: true,
    sessionUser,
  } as const;
}

function getSupabaseUserName(metadata: Record<string, unknown>) {
  const fullName = [metadata.full_name, metadata.name]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim();

  if (!fullName) {
    return { firstName: null, lastName: null };
  }

  return splitName(fullName);
}

async function upsertSocialUser(supabaseUser: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}) {
  const email = supabaseUser.email?.trim().toLowerCase();
  if (!email) {
    throw new Error("Your social account did not return an email address.");
  }

  const metadata = supabaseUser.user_metadata ?? {};
  const { firstName, lastName } = getSupabaseUserName(metadata);
  const profileImageUrl = [metadata.avatar_url, metadata.picture]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim() ?? null;
  const now = new Date();
  const existingUser = await storage.getUserByEmail(email);

  if (existingUser) {
    const updatedUser = await storage.updateUser(existingUser.id, {
      email,
      emailVerifiedAt: existingUser.emailVerifiedAt ?? now,
      firstName: existingUser.firstName ?? firstName,
      lastName: existingUser.lastName ?? lastName,
      profileImageUrl: existingUser.profileImageUrl ?? profileImageUrl,
    });

    return updatedUser ?? existingUser;
  }

  const [createdUser] = await db
    .insert(users)
    .values({
      id: supabaseUser.id,
      email,
      emailVerifiedAt: now,
      firstName,
      lastName,
      profileImageUrl,
      role: adminEmails.has(email) ? "admin" : "customer",
    })
    .returning();

  return createdUser;
}

export function setupAuth(app: Express) {
  void ensurePasswordResetPurposeColumn().catch((error) => console.error("[AUTH] Couldn't add password_reset_otps.purpose:", error));
  // Railway and similar hosts may add more than one proxy hop before the app.
  // Trusting forwarded proto headers avoids silently dropping secure session cookies.
  app.set("trust proxy", true);
  const shouldUsePostgresSessionStore = process.env.NODE_ENV === "production" || process.env.USE_PG_SESSION_STORE === "true";
  const store = shouldUsePostgresSessionStore
    ? new PgStore({
        pool: sessionPool,
        createTableIfMissing: false,
        tableName: "sessions",
        ttl: sessionTtlMs / 1000,
        disableTouch: true,
        errorLog: (error) => {
          console.error("[SESSION] Postgres session store error:", error);
        },
      })
    : new session.MemoryStore();

  app.use(
    session({
      store,
      secret: resolveSessionSecret(),
      proxy: process.env.NODE_ENV === "production",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production" ? "auto" : false,
        maxAge: sessionTtlMs,
      },
    }),
  );
}

export function registerAuthRoutes(app: Express) {
  app.get("/api/login", (_req, res) => {
    res.redirect("/auth");
  });

  app.get("/admin/auth/login", (_req, res) => {
    res.redirect("/auth?next=/admin/dashboard");
  });

  app.post("/api/auth/signup", signUpRateLimit, async (req, res) => {
    try {
      const bypassOtpVerification = shouldBypassOtpVerification(req);

      if (!bypassOtpVerification && !isTransactionalEmailConfigured()) {
        return res.status(503).json({
          message: "Email verification is not configured yet. Please set up the email provider first.",
        });
      }

      const input = signUpSchema.parse(req.body);
      const normalizedEmail = input.email.trim().toLowerCase();
      const normalizedPhone = normalizePhone(input.phone);

      const [existingUser] = await db
        .select()
        .from(users)
        .where(or(eq(users.email, normalizedEmail), eq(users.phone, normalizedPhone)))
        .limit(1);

      if (existingUser) {
        if (existingUser.email === normalizedEmail && !isEmailVerified(existingUser)) {
          if (bypassOtpVerification) {
            return res.status(409).json({
              message: "This account already exists. Sign in to continue.",
            });
          }

          return res.status(409).json({
            message: "This account already exists but still needs email verification.",
            requiresEmailVerification: true,
            email: normalizedEmail,
          });
        }

        return res.status(409).json({ message: "An account with that email or phone already exists" });
      }

      const { firstName, lastName } = splitName(input.name);
      const [createdUser] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          phone: normalizedPhone,
          firstName,
          lastName,
          passwordHash: hashPassword(input.password),
          role: adminEmails.has(normalizedEmail) ? "admin" : "customer",
          emailVerifiedAt: bypassOtpVerification ? new Date() : null,
        })
        .returning();

      if (bypassOtpVerification) {
        const authenticated = await authenticateSessionUser(req, createdUser.id);
        if (!authenticated.ok) {
          return res.status(authenticated.status).json(authenticated.body);
        }

        if (isTransactionalEmailConfigured()) {
          queueNotificationTask(
            `signup emails for ${createdUser.id}`,
            sendSignupNotificationEmails(createdUser, req),
          );
        }

        return res.status(201).json({
          message: "Account created. OTP verification is skipped for local testing.",
          otpBypassed: true,
          user: authenticated.sessionUser,
        });
      }

      const verification = await issueEmailVerificationCode(createdUser);
      if (!verification.delivered) {
        await db.delete(users).where(eq(users.id, createdUser.id));
        console.error(`[AUTH] Signup verification delivery failed for ${verification.email}.`);
        return res.status(503).json({
          message: "We couldn't send the verification code right now. Please try again.",
        });
      }

      return res.status(201).json({
        message: "Account created. Verify your email to continue.",
        email: verification.email,
        devOtp: verification.devOtp,
      });
    } catch (error) {
      console.error("[AUTH] Signup failed:", formatAuthError(error));
      return res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to create account",
      });
    }
  });

  app.post("/api/auth/verify-email", verifyEmailRateLimit, async (req, res) => {
    try {
      const input = verifyEmailSchema.parse(req.body);
      const email = input.email.trim().toLowerCase();

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) {
        return res.status(404).json({ message: "Account not found. Please sign up again." });
      }

      if (isEmailVerified(user)) {
        return res.status(409).json({ message: "This email is already verified. Please sign in." });
      }

      const [otpRecord] = await db
        .select()
        .from(emailVerificationOtps)
        .where(
          and(
            eq(emailVerificationOtps.email, email),
            eq(emailVerificationOtps.otpHash, hashOtp(input.otp)),
            gt(emailVerificationOtps.expiresAt, new Date()),
            isNull(emailVerificationOtps.usedAt),
          ),
        )
        .orderBy(desc(emailVerificationOtps.createdAt))
        .limit(1);

      if (!otpRecord) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }

      const now = new Date();
      const [updatedUser] = await db
        .update(users)
        .set({
          emailVerifiedAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, user.id))
        .returning();

      if (!updatedUser) {
        return res.status(404).json({ message: "Account not found" });
      }

      await db
        .update(emailVerificationOtps)
        .set({ usedAt: now })
        .where(eq(emailVerificationOtps.id, otpRecord.id));

      const sessionUser = await getSessionUser(updatedUser.id);
      if (!sessionUser) {
        return res.status(404).json({ message: "Unable to load account" });
      }

      setAuthenticatedSession(req, sessionUser.id, sessionUser.role as UserRole);
      attachRequestUser(req, sessionUser);
      queueNotificationTask(
        `signup emails for ${updatedUser.id}`,
        sendSignupNotificationEmails(updatedUser, req),
      );

      return res.json(sessionUser);
    } catch (error) {
      console.error("[AUTH] Email verification failed:", formatAuthError(error));
      return res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to verify email",
      });
    }
  });

  app.post("/api/auth/resend-verification", resendVerificationRateLimit, async (req, res) => {
    try {
      if (!isTransactionalEmailConfigured()) {
        return res.status(503).json({
          message: "Email verification is not configured yet. Please set up the email provider first.",
        });
      }

      const input = resendVerificationSchema.parse(req.body);
      const email = input.email.trim().toLowerCase();
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (!user) {
        return res.status(404).json({ message: "Account not found. Please sign up again." });
      }

      if (isEmailVerified(user)) {
        return res.status(409).json({ message: "This email is already verified. Please sign in." });
      }

      const verification = await issueEmailVerificationCode(user);
      if (!verification.delivered) {
        console.error(`[AUTH] Verification resend failed for ${verification.email}.`);
        return res.status(503).json({
          message: "We couldn't send the verification code right now. Please try again.",
        });
      }

      return res.json({
        message: "A new verification code has been sent.",
        devOtp: verification.devOtp,
      });
    } catch (error) {
      console.error("[AUTH] Resend verification failed:", formatAuthError(error));
      return res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to resend verification code",
      });
    }
  });

  app.post("/api/auth/signin", signInRateLimit, async (req, res) => {
    try {
      const input = signInSchema.parse(req.body);
      const bypassOtpVerification = shouldBypassOtpVerification(req);
      const identifier = input.identifier.trim();
      const normalizedEmail = identifier.toLowerCase();
      const normalizedPhone = normalizePhone(identifier);

      const [user] = await db
        .select()
        .from(users)
        .where(or(eq(users.email, normalizedEmail), eq(users.phone, normalizedPhone)))
        .limit(1);

      if (!user || !verifyPassword(input.password, user.passwordHash)) {
        return res.status(401).json({ message: "Invalid email/phone or password" });
      }

      if (!isEmailVerified(user) && !bypassOtpVerification) {
        return res.status(403).json({
          message: "Please verify your email before signing in.",
          requiresEmailVerification: true,
          email: user.email,
        });
      }

      if (!isEmailVerified(user) && bypassOtpVerification) {
        const verifiedUser = await markUserEmailVerified(user.id);
        if (!verifiedUser) {
          return res.status(404).json({ message: "Account not found" });
        }
      }

      const authenticated = await authenticateSessionUser(req, user.id, "Unable to load account");
      if (!authenticated.ok) {
        return res.status(authenticated.status).json(authenticated.body);
      }

      return res.json(authenticated.sessionUser);
    } catch (error) {
      console.error("[AUTH] Signin failed:", formatAuthError(error));
      return res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to sign in",
      });
    }
  });

  app.post("/api/auth/social-session", async (req, res) => {
    try {
      if (!supabase) {
        return res.status(503).json({
          message: "Social login is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.",
        });
      }

      const input = socialSessionSchema.parse(req.body);
      const { data, error } = await supabase.auth.getUser(input.accessToken);
      if (error || !data.user) {
        return res.status(401).json({ message: "Social login session could not be verified." });
      }

      const user = await upsertSocialUser(data.user);
      const authenticated = await authenticateSessionUser(req, user.id, "Unable to load account");
      if (!authenticated.ok) {
        return res.status(authenticated.status).json(authenticated.body);
      }

      return res.json(authenticated.sessionUser);
    } catch (error) {
      console.error("[AUTH] Social login failed:", formatAuthError(error));
      return res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to complete social login",
      });
    }
  });

  app.post("/api/auth/forgot-password", forgotPasswordRateLimit, async (req, res) => {
    try {
      const input = forgotPasswordSchema.parse(req.body);
      const bypassOtpVerification = shouldBypassOtpVerification(req);

      if (!bypassOtpVerification && !isTransactionalEmailConfigured()) {
        return res.status(503).json({
          message: "Password reset email is not configured yet. Please set up the email provider first.",
        });
      }

      const email = input.email.trim().toLowerCase();

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) {
        return res.json({
          message: bypassOtpVerification
            ? "If that account exists, you can set a new password locally without an OTP."
            : "If that account exists, an OTP has been sent.",
          otpBypassed: bypassOtpVerification || undefined,
        });
      }

      if (bypassOtpVerification) {
        return res.json({
          message: "OTP verification is skipped for local testing. Enter your new password to continue.",
          otpBypassed: true,
        });
      }

      const otp = generateOneTimeCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      const [createdOtp] = await db.insert(passwordResetOtps).values({
        email,
        otpHash: hashOtp(otp),
        expiresAt,
      }).returning({ id: passwordResetOtps.id });

      const delivered = await sendVerificationCode({
        channel: "email",
        email,
        code: otp,
        purpose: "password-reset",
      });
      if (!delivered) {
        await db.delete(passwordResetOtps).where(eq(passwordResetOtps.id, createdOtp.id));
        console.error(`[AUTH] Password reset OTP delivery failed for ${email}.`);
        return res.status(503).json({
          message: "We couldn't send the reset code right now. Please try again.",
        });
      }

      return res.json({
        message: "If that account exists, an OTP has been sent.",
        devOtp: buildDevelopmentOtp(otp),
      });
    } catch (error) {
      console.error("[AUTH] Forgot password failed:", formatAuthError(error));
      return res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to process password reset",
      });
    }
  });

  app.post("/api/auth/reset-password", resetPasswordRateLimit, async (req, res) => {
    try {
      const bypassOtpVerification = shouldBypassOtpVerification(req);
      const email = bypassOtpVerification
        ? resetPasswordWithoutOtpSchema.parse(req.body).email.trim().toLowerCase()
        : resetPasswordSchema.parse(req.body).email.trim().toLowerCase();

      let otpRecord: { id: string } | undefined;
      if (!bypassOtpVerification) {
        const input = resetPasswordSchema.parse(req.body);
        [otpRecord] = await db
          .select({ id: passwordResetOtps.id })
          .from(passwordResetOtps)
          .where(
            and(
              eq(passwordResetOtps.email, email),
              eq(passwordResetOtps.otpHash, hashOtp(input.otp)),
              eq(passwordResetOtps.purpose, "password-reset"),
              gt(passwordResetOtps.expiresAt, new Date()),
              isNull(passwordResetOtps.usedAt),
            ),
          )
          .orderBy(desc(passwordResetOtps.createdAt))
          .limit(1);

        if (!otpRecord) {
          return res.status(400).json({ message: "Invalid or expired OTP" });
        }
      }

      const parsedInput = bypassOtpVerification
        ? resetPasswordWithoutOtpSchema.parse(req.body)
        : resetPasswordSchema.parse(req.body);

      const [updatedUser] = await db
        .update(users)
        .set({
          passwordHash: hashPassword(parsedInput.newPassword),
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.email, email))
        .returning();

      if (!updatedUser) {
        return res.status(404).json({ message: "Account not found" });
      }

      if (otpRecord) {
        await db
          .update(passwordResetOtps)
          .set({ usedAt: new Date() })
          .where(eq(passwordResetOtps.id, otpRecord.id));
      }

      const authenticated = await authenticateSessionUser(req, updatedUser.id, "Account not found");
      if (!authenticated.ok) {
        return res.status(authenticated.status).json(authenticated.body);
      }

      return res.json(authenticated.sessionUser);
    } catch (error) {
      console.error("[AUTH] Reset password failed:", formatAuthError(error));
      return res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to reset password",
      });
    }
  });

  // Is this set-up link still good? Says whose account, masked, and nothing else.
  app.post("/api/auth/account-setup/check", accountSetupRateLimit, async (req, res) => {
    const found = await findSetupLink(req.body?.token);
    if (!found) return res.status(404).json({ state: "invalid" });
    const [user] = await db.select().from(users).where(eq(users.email, found.record.email)).limit(1);
    if (!user) return res.status(404).json({ state: "invalid" });
    return res.json({ state: found.state, firstName: user.firstName ?? null, email: maskEmail(found.record.email) });
  });

  app.post("/api/auth/account-setup", accountSetupRateLimit, async (req, res) => {
    try {
      const password = z.string().min(8, "Use at least 8 characters").max(200).parse(req.body?.password);
      const found = await findSetupLink(req.body?.token);
      if (!found) return res.status(404).json({ message: "This link isn't valid. Ask TBM for a new one." });
      if (found.state === "used") return res.status(410).json({ message: "This link has already been used. Sign in with your password." });
      if (found.state === "expired") return res.status(410).json({ message: "This link has expired. Ask for a new one below." });
      // Used once, even if two tabs submit together.
      const claimed = await db.update(passwordResetOtps)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetOtps.id, found.record.id), isNull(passwordResetOtps.usedAt)))
        .returning({ id: passwordResetOtps.id });
      if (!claimed.length) return res.status(410).json({ message: "This link has already been used. Sign in with your password." });
      const [updatedUser] = await db.update(users)
        .set({ passwordHash: hashPassword(password), emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.email, found.record.email))
        .returning();
      if (!updatedUser) return res.status(404).json({ message: "Account not found" });
      const authenticated = await authenticateSessionUser(req, updatedUser.id, "Account not found");
      if (!authenticated.ok) return res.status(authenticated.status).json(authenticated.body);
      return res.json(authenticated.sessionUser);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message ?? "Choose a password" });
      console.error("[AUTH] Account set-up failed:", formatAuthError(error));
      return res.status(500).json({ message: "Couldn't set up your account. Please try again." });
    }
  });

  // An expired link: a new one goes to the account's own email, never to whoever asks.
  app.post("/api/auth/account-setup/renew", accountSetupRateLimit, async (req, res) => {
    const reply = { message: "If that link was yours, we've emailed you a new one." };
    try {
      const found = await findSetupLink(req.body?.token);
      if (!found || found.state !== "expired") return res.json(reply);
      const [user] = await db.select().from(users).where(eq(users.email, found.record.email)).limit(1);
      if (!user) return res.json(reply);
      const { url } = await issueAccountSetupLink(found.record.email);
      queueNotificationTask(`account setup renew ${user.id}`, sendSimpleEmail({
        to: [found.record.email],
        greetingName: user.firstName ?? undefined,
        subject: "Your new link to set up your TBM account",
        paragraphs: [
          `Here's a new link to choose your password. It works once, for the next ${ACCOUNT_SETUP_LINK_HOURS} hours.`,
          "If this email address is a Gmail one, you can also tap Continue with Google on the sign-in page.",
          officialContactLine,
        ],
        link: { label: "Set up your account", url },
      }));
      return res.json(reply);
    } catch (error) {
      console.error("[AUTH] Account set-up renew failed:", formatAuthError(error));
      return res.json(reply);
    }
  });

  app.post("/api/logout", (req: any, res) => {
    req.session.destroy(() => {
      res.status(204).send();
    });
  });
}

export const isAuthenticated: RequestHandler = async (req: any, res, next) => {
  const user = await resolveAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  setAuthenticatedSession(req, user.id, user.role as UserRole);
  attachRequestUser(req, user);
  return next();
};

export const requireAdmin: RequestHandler = async (req: any, res, next) => {
  const user = await resolveAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  if (user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden - Admin access required" });
  }

  setAuthenticatedSession(req, user.id, user.role as UserRole);
  attachRequestUser(req, user);
  return next();
};

export const requireProviderOrAdmin: RequestHandler = async (req: any, res, next) => {
  const user = await resolveAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  if (user.role !== "admin" && user.role !== "provider") {
    return res.status(403).json({ message: "Forbidden - Provider or admin access required" });
  }

  setAuthenticatedSession(req, user.id, user.role as UserRole);
  attachRequestUser(req, user);
  return next();
};
