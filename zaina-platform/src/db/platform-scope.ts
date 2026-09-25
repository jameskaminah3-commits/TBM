// zaina-platform/src/db/platform-scope.ts
//
// The platform's own work across businesses, on the owner connection (which
// row-level security doesn't limit): staff identities and sign-in, the list
// of a person's businesses, and creating businesses. Nothing here reads a
// business's conversations or data.

import { eq, sql } from "drizzle-orm";
import { ownerDb } from "./platform-db.ts";
import { businessSettings, businesses, staffMemberships, staffUsers, type BusinessType, type StaffRole, type StaffUser } from "./schema.ts";

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

/** The businesses a person works for, and as what. */
export async function membershipsOf(userId: string): Promise<Array<{ businessId: string; businessName: string; role: StaffRole }>> {
  return ownerDb()
    .select({ businessId: staffMemberships.businessId, businessName: businesses.name, role: staffMemberships.role })
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
