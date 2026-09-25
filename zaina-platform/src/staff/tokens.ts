// zaina-platform/src/staff/tokens.ts
//
// Staff sign-in tokens: signed, valid for 12 hours, and tied to the person's
// token version, so raising the version (a password change, "sign out
// everywhere") ends every token at once.
//
//   st1.<payload>.<signature>   payload = base64url(JSON {u, v, iat, exp})

import { createHmac, timingSafeEqual } from "node:crypto";

const VERSION = "st1";
export const STAFF_TOKEN_TTL_SECONDS = 12 * 60 * 60;

/** A key for staff tokens only, derived from the service secret. */
function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("zaina-staff-token").digest();
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", signingKey(secret)).update(`${VERSION}.${payload}`).digest("base64url");
}

export type StaffClaims = { userId: string; tokenVersion: number; expiresAt: number };

export function issueStaffToken(secret: string, user: { id: string; tokenVersion: number }, now: Date = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = Buffer.from(JSON.stringify({ u: user.id, v: user.tokenVersion, iat: issuedAt, exp: issuedAt + STAFF_TOKEN_TTL_SECONDS })).toString("base64url");
  return `${VERSION}.${payload}.${sign(secret, payload)}`;
}

export function verifyStaffToken(secret: string, token: unknown, now: Date = new Date()): StaffClaims | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const [version, payload, signature, extra] = token.split(".");
  if (version !== VERSION || !payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims?.u !== "string" || !Number.isInteger(claims?.v) || !Number.isInteger(claims?.exp)) return null;
    if (claims.exp <= Math.floor(now.getTime() / 1000)) return null;
    return { userId: claims.u, tokenVersion: claims.v, expiresAt: claims.exp };
  } catch {
    return null;
  }
}
