// zaina-platform/src/db/platform-scope.ts
//
// The platform's own work across businesses, on the owner connection (which
// row-level security doesn't limit): staff identities and sign-in, the list
// of a person's businesses, and creating businesses. Nothing here reads a
// business's conversations or data.

import { and, eq, sql } from "drizzle-orm";
import { ownerDb } from "./platform-db.ts";
import {
  businessSettings,
  businesses,
  staffMemberships,
  staffPushSubscriptions,
  staffUsers,
  type BusinessStatus,
  type BusinessType,
  type PauseReason,
  type StaffedHours,
  type StaffRole,
  type StaffUser,
} from "./schema.ts";

export async function findStaffByEmail(email: string): Promise<StaffUser | undefined> {
  const [row] = await ownerDb().select().from(staffUsers).where(eq(staffUsers.email, email.trim().toLowerCase())).limit(1);
  return row;
}

export async function getStaffUser(id: string): Promise<StaffUser | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await ownerDb().select().from(staffUsers).where(eq(staffUsers.id, id)).limit(1);
  return row;
}

export async function createStaffUser(input: { email: string; name: string; passwordHash: string; isPlatformAdmin?: boolean }): Promise<StaffUser> {
  const [row] = await ownerDb()
    .insert(staffUsers)
    .values({
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      passwordHash: input.passwordHash,
      isPlatformAdmin: input.isPlatformAdmin ?? false,
    })
    .returning();
  return row;
}

/** A new password signs the person out everywhere. */
export async function setStaffPassword(userId: string, passwordHash: string): Promise<void> {
  await ownerDb()
    .update(staffUsers)
    .set({ passwordHash, tokenVersion: sql`${staffUsers.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(staffUsers.id, userId));
}

/** The businesses a person works for, as what, whether each is live yet, and why one is paused. */
export async function membershipsOf(userId: string): Promise<Array<{ businessId: string; businessName: string; role: StaffRole; businessType: BusinessType; businessStatus: BusinessStatus; pauseReason: PauseReason | null }>> {
  return ownerDb()
    .select({ businessId: staffMemberships.businessId, businessName: businesses.name, role: staffMemberships.role, businessType: businesses.businessType, businessStatus: businesses.status, pauseReason: businesses.pauseReason })
    .from(staffMemberships)
    .innerJoin(businesses, eq(businesses.id, staffMemberships.businessId))
    .where(eq(staffMemberships.userId, userId));
}

/**
 * A new business, its settings and its first owner, all or nothing: a
 * business is never left without an owner. The owner is an existing account
 * (found by email) or a new one.
 */
export async function createBusinessWithOwner(input: {
  business: {
    id: string;
    name: string;
    publicKey: string;
    allowedOrigins: string[];
    timeZone: string;
    dailyTokenCap: number;
    retentionDays: number;
    businessType: BusinessType;
  };
  owner: { email: string; name: string; passwordHash: string | null };
}): Promise<StaffUser> {
  return ownerDb().transaction(async (tx) => {
    await tx.insert(businesses).values(input.business);
    await tx.insert(businessSettings).values({ businessId: input.business.id, displayName: input.business.name });
    const email = input.owner.email.trim().toLowerCase();
    let [owner] = await tx.select().from(staffUsers).where(eq(staffUsers.email, email)).limit(1);
    if (!owner) {
      if (!input.owner.passwordHash) throw new Error("A new owner needs a password");
      [owner] = await tx.insert(staffUsers).values({ email, name: input.owner.name.trim(), passwordHash: input.owner.passwordHash }).returning();
    }
    await tx.insert(staffMemberships).values({ businessId: input.business.id, userId: owner.id, role: "owner" });
    return owner;
  });
}

// ── Alerts on a person's phones and browsers ─────────────────────────
// Subscriptions belong to the person, not to one business: written here on
// their behalf; each business reads only its own people's (row-level security).

export async function savePushSubscription(userId: string, subscription: { endpoint: string; p256dh: string; auth: string }, userAgent: string | null): Promise<void> {
  await ownerDb()
    .insert(staffPushSubscriptions)
    .values({ userId, ...subscription, userAgent })
    .onConflictDoUpdate({
      target: staffPushSubscriptions.endpoint,
      set: { userId, p256dh: subscription.p256dh, auth: subscription.auth, userAgent, createdAt: new Date() },
    });
}

/** Removes a subscription: the person's own (turning alerts off), or any that the push service says is gone. */
export async function deletePushSubscription(endpoint: string, userId?: string): Promise<boolean> {
  const where = userId
    ? and(eq(staffPushSubscriptions.endpoint, endpoint), eq(staffPushSubscriptions.userId, userId))
    : eq(staffPushSubscriptions.endpoint, endpoint);
  const rows = await ownerDb().delete(staffPushSubscriptions).where(where).returning({ id: staffPushSubscriptions.id });
  return rows.length > 0;
}

export async function markPushSubscriptionUsed(endpoint: string): Promise<void> {
  await ownerDb().update(staffPushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(staffPushSubscriptions.endpoint, endpoint));
}

export async function pushSubscriptionCount(userId: string): Promise<number> {
  const [row] = await ownerDb().select({ count: sql<number>`count(*)::int` }).from(staffPushSubscriptions).where(eq(staffPushSubscriptions.userId, userId));
  return row?.count ?? 0;
}

// ── The business directory, changed by the business's own people ─────
// The directory is read-only to the service (a business must not lift its
// own model budget), so the few fields a business runs itself change here,
// after the route has checked the person's role.

export type DirectoryPatch = {
  allowedOrigins?: string[];
  timeZone?: string;
  staffedHours?: StaffedHours | null;
  unclaimedTimeoutMinutes?: number;
};

export async function updateBusinessDirectory(businessId: string, patch: DirectoryPatch): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await ownerDb().update(businesses).set({ ...patch, updatedAt: new Date() }).where(eq(businesses.id, businessId));
}

// ── Self-serve (Phase 5) ──────────────────────────────────────────────

/**
 * A business that signed up itself: setting up (onboarding) until it goes
 * live, with its settings and its first owner, whose email isn't confirmed
 * yet. All or nothing.
 */
export async function createSelfServeBusiness(input: {
  business: { id: string; name: string; publicKey: string; allowedOrigins: string[]; timeZone: string; dailyTokenCap: number; retentionDays: number; businessType: BusinessType; websiteUrl: string | null };
  owner: { email: string; name: string; passwordHash: string };
}): Promise<StaffUser> {
  return ownerDb().transaction(async (tx) => {
    const { websiteUrl, ...business } = input.business;
    await tx.insert(businesses).values({ ...business, status: "onboarding", source: "self_serve" });
    await tx.insert(businessSettings).values({ businessId: business.id, displayName: business.name, websiteUrl });
    const [owner] = await tx.insert(staffUsers).values({
      email: input.owner.email.trim().toLowerCase(), name: input.owner.name.trim(), passwordHash: input.owner.passwordHash, emailVerifiedAt: null,
    }).returning();
    await tx.insert(staffMemberships).values({ businessId: business.id, userId: owner.id, role: "owner" });
    return owner;
  });
}

/** Confirms a person's email, if it's still the email the link was for. */
export async function confirmStaffEmail(userId: string, email: string): Promise<StaffUser | undefined> {
  const [row] = await ownerDb().update(staffUsers)
    .set({ emailVerifiedAt: sql`coalesce(${staffUsers.emailVerifiedAt}, now())`, updatedAt: new Date() })
    .where(and(eq(staffUsers.id, userId), eq(staffUsers.email, email.trim().toLowerCase())))
    .returning();
  return row;
}

/**
 * Moves a business between setting up, live and paused (by the platform
 * team, unless billing says otherwise). Going live the first time is
 * remembered.
 */
export async function setBusinessStatus(businessId: string, status: BusinessStatus, pauseReason: PauseReason = "platform"): Promise<void> {
  await ownerDb().update(businesses)
    .set({
      status,
      pauseReason: status === "paused" ? pauseReason : null,
      ...(status === "active" ? { wentLiveAt: sql`coalesce(${businesses.wentLiveAt}, now())` } : {}),
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, businessId));
}
