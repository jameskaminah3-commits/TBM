// zaina-platform/src/staff/routes.ts
//
// Staff accounts and running a business on the platform.
//
//   POST   /v1/staff/login                    { email, password } → token
//   GET    /v1/staff/me                        the account and its businesses
//   POST   /v1/staff/me/password               { current, next } → signs out everywhere, new token
//
//   Per business (/v1/staff/businesses/:businessId/…), by role:
//   GET    settings                  viewer    PATCH settings                manager
//   GET    members                   manager   POST members                  manager (managers and owners: owner)
//   DELETE members/:userId           manager (managers and owners: owner; never the last owner)
//   GET    secrets (names only)      manager   PUT / DELETE secrets/:name    owner
//   GET    leads                     agent
//   GET    metrics?days=7            manager
//   POST   erase { email?, phone? }  manager   DELETE sessions/:id           manager

import type { Express, NextFunction, Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PlatformConfig } from "../config.ts";
import { deleteSecret, listSecrets, putSecret, SECRET_NAME_PATTERN } from "../businesses/secrets.ts";
import { getBusinessSettings, updateBusinessSettings, validateSettingsPatch } from "../businesses/settings.ts";
import { deleteConversation, eraseCustomer } from "../conversations/retention.ts";
import { createStaffUser, findStaffByEmail, getStaffUser, membershipsOf, setStaffPassword } from "../db/platform-scope.ts";
import { leads, staffMemberships, staffRoles, staffUsers, type StaffRole } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { summarizeTurns } from "../engine/telemetry.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { visitorKey } from "../gateway/visitor.ts";
import { requireBusinessRole, requireStaff, ROLE_RANK, staffOf } from "./auth.ts";
import { hashPassword, passwordProblem, verifyAgainstNothing, verifyPassword } from "./passwords.ts";
import { issueStaffToken } from "./tokens.ts";

const publicUser = (user: { id: string; email: string; name: string; isPlatformAdmin: boolean }) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  is_platform_admin: user.isPlatformAdmin,
});

export function registerStaffAccountRoutes(app: Express, config: PlatformConfig): void {
  const secret = config.sessionTokenSecret;
  const staff = requireStaff(secret);
  const base = "/v1/staff/businesses/:businessId";

  app.post("/v1/staff/login", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      // Guessing is slow: ten tries per account and fifty per address every 15 minutes.
      const verdict = await consumeLimits([
        { key: `login:account:${visitorKey(secret, email)}`, limit: 10, windowSeconds: 900 },
        { key: `login:visitor:${visitorKey(secret, req.ip)}`, limit: 50, windowSeconds: 900 },
      ]);
      if (!verdict.allowed) {
        res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
        return res.status(429).json({ error: "rate_limited", message: "Too many sign-in attempts. Please wait and try again." });
      }
      const user = email ? await findStaffByEmail(email) : undefined;
      const valid = user && !user.disabledAt ? await verifyPassword(password, user.passwordHash) : await verifyAgainstNothing(password);
      if (!user || !valid) return res.status(401).json({ error: "invalid_login", message: "That email and password don't match." });
      res.json({
        token: issueStaffToken(secret, user),
        user: publicUser(user),
        businesses: await membershipsOf(user.id),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/staff/me", staff, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user } = staffOf(req);
      res.json({ user: publicUser(user), businesses: await membershipsOf(user.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/staff/me/password", staff, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user } = staffOf(req);
      if (!(await verifyPassword(String(req.body?.current ?? ""), user.passwordHash))) {
        return res.status(401).json({ error: "invalid_password", message: "The current password isn't right." });
      }
      const problem = passwordProblem(req.body?.next);
      if (problem) return res.status(400).json({ error: "weak_password", message: problem });
      await setStaffPassword(user.id, await hashPassword(req.body.next));
      const updated = await getStaffUser(user.id);
      res.json({ token: issueStaffToken(secret, updated!) });
    } catch (error) {
      next(error);
    }
  });

  // ── Settings ─────────────────────────────────────────────────────────
  app.get(`${base}/settings`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ settings: await getBusinessSettings(staffOf(req).business!.id) });
    } catch (error) {
      next(error);
    }
  });

  app.patch(`${base}/settings`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const checked = validateSettingsPatch(req.body ?? {});
      if (!checked.ok) return res.status(400).json({ error: "invalid_settings", message: checked.error });
      const { business, user } = staffOf(req);
      res.json({ settings: await updateBusinessSettings(business!.id, checked.patch, user.id) });
    } catch (error) {
      next(error);
    }
  });

  // ── Members ──────────────────────────────────────────────────────────
  app.get(`${base}/members`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = await inBusiness((db) => db
        .select({ userId: staffMemberships.userId, role: staffMemberships.role, email: staffUsers.email, name: staffUsers.name, since: staffMemberships.createdAt })
        .from(staffMemberships)
        .innerJoin(staffUsers, eq(staffUsers.id, staffMemberships.userId))
        .where(eq(staffMemberships.businessId, staffOf(req).business!.id))
        .orderBy(staffUsers.name));
      res.json({ members });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/members`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, role: actorRole } = staffOf(req);
      const role = req.body?.role as StaffRole;
      if (!staffRoles.includes(role)) return res.status(400).json({ error: "invalid_role", message: `Role is one of ${staffRoles.join(", ")}.` });
      if (ROLE_RANK[role] >= ROLE_RANK.manager && actorRole !== "owner") {
        return res.status(403).json({ error: "forbidden", message: "Only an owner can add managers and owners." });
      }
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "invalid_email" });

      let user = await findStaffByEmail(email);
      if (!user) {
        // A new account: the person gets a starting password to change.
        const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
        if (!name) return res.status(400).json({ error: "name_required", message: "A new account needs a name." });
        const problem = passwordProblem(req.body?.password);
        if (problem) return res.status(400).json({ error: "weak_password", message: problem });
        user = await createStaffUser({ email, name, passwordHash: await hashPassword(req.body.password) });
      }
      const userId = user.id;
      await inBusiness((db) => db
        .insert(staffMemberships)
        .values({ businessId: business!.id, userId, role })
        .onConflictDoUpdate({ target: [staffMemberships.businessId, staffMemberships.userId], set: { role } }));
      res.status(201).json({ member: { userId, email: user.email, name: user.name, role } });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${base}/members/:userId`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, role: actorRole } = staffOf(req);
      if (!/^[0-9a-f-]{36}$/i.test(req.params.userId)) return res.status(404).json({ error: "not_found" });
      const ofBusiness = eq(staffMemberships.businessId, business!.id);
      const outcome = await inBusiness(async (db) => {
        const [member] = await db.select().from(staffMemberships).where(and(ofBusiness, eq(staffMemberships.userId, req.params.userId))).limit(1);
        if (!member) return { status: 404, body: { error: "not_found" } };
        if (ROLE_RANK[member.role] >= ROLE_RANK.manager && actorRole !== "owner") {
          return { status: 403, body: { error: "forbidden", message: "Only an owner can remove managers and owners." } };
        }
        if (member.role === "owner") {
          const [owners] = await db.select({ count: sql<number>`count(*)::int` }).from(staffMemberships).where(and(ofBusiness, eq(staffMemberships.role, "owner")));
          if ((owners?.count ?? 0) <= 1) return { status: 409, body: { error: "last_owner", message: "A business needs at least one owner." } };
        }
        await db.delete(staffMemberships).where(and(eq(staffMemberships.businessId, business!.id), eq(staffMemberships.userId, member.userId)));
        return { status: 200, body: { removed: member.userId } };
      });
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      next(error);
    }
  });

  // ── Secrets (write-only) ─────────────────────────────────────────────
  app.get(`${base}/secrets`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ secrets: await listSecrets(staffOf(req).business!.id) });
    } catch (error) {
      next(error);
    }
  });

  app.put(`${base}/secrets/:name`, staff, requireBusinessRole("owner"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const value = req.body?.value;
      if (!SECRET_NAME_PATTERN.test(req.params.name)) return res.status(400).json({ error: "invalid_name" });
      if (typeof value !== "string" || !value || value.length > 8192) return res.status(400).json({ error: "invalid_value" });
      const { business, user } = staffOf(req);
      await putSecret(business!.id, req.params.name, value, user.id);
      res.json({ saved: req.params.name });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${base}/secrets/:name`, staff, requireBusinessRole("owner"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await deleteSecret(staffOf(req).business!.id, req.params.name);
      res.status(deleted ? 200 : 404).json({ deleted });
    } catch (error) {
      next(error);
    }
  });

  // ── Leads, reports, deletion requests ───────────────────────────────
  app.get(`${base}/leads`, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const businessId = staffOf(req).business!.id;
      res.json({ leads: await inBusiness((db) => db.select().from(leads).where(eq(leads.businessId, businessId)).orderBy(desc(leads.createdAt)).limit(200)) });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/metrics`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = Math.min(90, Math.max(1, Number(req.query.days ?? 7) || 7));
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
      res.json(await summarizeTurns(staffOf(req).business!.id, { from, to }, config.modelPriceUsdPerMillion));
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/erase`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email : undefined;
      const phone = typeof req.body?.phone === "string" ? req.body.phone : undefined;
      if (!email && !phone) return res.status(400).json({ error: "contact_required", message: "Send an email or phone number." });
      const deleted = await eraseCustomer({ email, phone });
      res.json({ deleted_conversations: deleted.conversations, deleted_leads: deleted.leads });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${base}/sessions/:id`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await deleteConversation(req.params.id);
      res.status(deleted ? 200 : 404).json({ deleted });
    } catch (error) {
      next(error);
    }
  });
}
