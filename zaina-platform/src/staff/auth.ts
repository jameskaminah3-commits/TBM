// zaina-platform/src/staff/auth.ts
//
// Who is calling, and what they may do.
//
//   requireStaff          a valid staff token for an active account
//   requireBusinessRole   a membership in the business named in the URL, with
//                         at least the given role; the rest of the request
//                         then runs inside that business's scope
//   requirePlatformAdmin  the platform's own staff
//
// Roles, least to most: viewer (read conversations), agent (answer them),
// manager (settings, staff, reports, deletion requests), owner (secrets,
// managers and owners). Platform admins act as owner in any business, for
// support.

import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { businessById } from "../businesses/registry.ts";
import { getStaffUser } from "../db/platform-scope.ts";
import { staffMemberships, type Business, type StaffRole, type StaffUser } from "../db/schema.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { verifyStaffToken } from "./tokens.ts";

export const ROLE_RANK: Record<StaffRole, number> = { viewer: 1, agent: 2, manager: 3, owner: 4 };

export type StaffContext = { user: StaffUser; business?: Business; role?: StaffRole };

export function staffOf(req: Request): StaffContext {
  const context = (req as Request & { staff?: StaffContext }).staff;
  if (!context) throw new Error("requireStaff must run first");
  return context;
}

export function requireStaff(secret: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "")?.[1];
      const claims = verifyStaffToken(secret, token);
      const user = claims ? await getStaffUser(claims.userId) : undefined;
      if (!claims || !user || user.disabledAt || user.tokenVersion !== claims.tokenVersion) {
        res.status(401).json({ error: "unauthorized", message: "Please sign in again." });
        return;
      }
      (req as Request & { staff?: StaffContext }).staff = { user };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** The person's role in a business, or null. */
export async function roleIn(businessId: string, user: StaffUser): Promise<StaffRole | null> {
  if (user.isPlatformAdmin) return "owner";
  const [row] = await inBusiness((db) => db
    .select({ role: staffMemberships.role })
    .from(staffMemberships)
    .where(and(eq(staffMemberships.businessId, businessId), eq(staffMemberships.userId, user.id)))
    .limit(1), businessId);
  return row?.role ?? null;
}

export function requireBusinessRole(minimum: StaffRole) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = staffOf(req);
      const business = await businessById(String(req.params.businessId ?? ""));
      const role = business ? await roleIn(business.id, context.user) : null;
      // The same answer whether the business doesn't exist or isn't theirs.
      if (!business || !role) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
        res.status(403).json({ error: "forbidden", message: `This needs the ${minimum} role.` });
        return;
      }
      context.business = business;
      context.role = role;
      runForBusiness(business.id, async () => next());
    } catch (error) {
      next(error);
    }
  };
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  if (!staffOf(req).user.isPlatformAdmin) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}
