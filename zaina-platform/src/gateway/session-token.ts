// zaina-platform/src/gateway/session-token.ts
//
// Signed session tokens (C6). Opening a chat returns a token; every message
// must carry it. A session id alone no longer works, and a token can't be
// forged or moved to another business without the server's secret.
//
//   v1.<payload>.<signature>   payload = base64url(JSON {s, b, iat, exp})

import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionClaims = { sessionId: string; businessId: string; issuedAt: number; expiresAt: number };

const VERSION = "v1";
/** A chat can be picked up again for 30 days (for replies after a handoff). */
export const SESSION_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`${VERSION}.${payload}`).digest("base64url");
}

export function issueSessionToken(
  secret: string,
  claims: { sessionId: string; businessId: string },
  now: Date = new Date(),
): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = Buffer.from(JSON.stringify({
    s: claims.sessionId,
    b: claims.businessId,
    iat: issuedAt,
    exp: issuedAt + SESSION_TOKEN_TTL_SECONDS,
  })).toString("base64url");
  return `${VERSION}.${payload}.${sign(secret, payload)}`;
}

/** The token's claims, or null if it is malformed, forged or expired. */
export function verifySessionToken(secret: string, token: unknown, now: Date = new Date()): SessionClaims | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const [version, payload, signature, extra] = token.split(".");
  if (version !== VERSION || !payload || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims?.s !== "string" || typeof claims?.b !== "string") return null;
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return null;
    if (claims.exp <= Math.floor(now.getTime() / 1000)) return null;
    return { sessionId: claims.s, businessId: claims.b, issuedAt: claims.iat, expiresAt: claims.exp };
  } catch {
    return null;
  }
}

/** The token from "Authorization: Bearer <token>". */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  return match ? match[1] : null;
}
