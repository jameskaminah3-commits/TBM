import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config.ts";
import { isOriginAllowed, normalizeOrigin } from "../../src/gateway/origin.ts";
import { businessDay, isOverCap } from "../../src/gateway/spend-cap.ts";
import {
  bearerToken,
  issueSessionToken,
  SESSION_TOKEN_TTL_SECONDS,
  verifySessionToken,
} from "../../src/gateway/session-token.ts";
import { visitorKey } from "../../src/gateway/visitor.ts";

const SECRET = "test-secret-that-is-long-enough-1234567890";

test("a session token proves which chat and business it belongs to", () => {
  const now = new Date("2026-09-25T10:00:00Z");
  const token = issueSessionToken(SECRET, { sessionId: "3f1c2b8e-1111-4a4a-9999-123456789abc", businessId: "tbm" }, now);
  const claims = verifySessionToken(SECRET, token, now);
  assert.equal(claims?.sessionId, "3f1c2b8e-1111-4a4a-9999-123456789abc");
  assert.equal(claims?.businessId, "tbm");
  assert.equal(claims?.expiresAt, Math.floor(now.getTime() / 1000) + SESSION_TOKEN_TTL_SECONDS);
});

test("a forged, altered, foreign or expired token is refused", () => {
  const now = new Date("2026-09-25T10:00:00Z");
  const token = issueSessionToken(SECRET, { sessionId: "3f1c2b8e-1111-4a4a-9999-123456789abc", businessId: "tbm" }, now);
  const [version, payload, signature] = token.split(".");

  // Another business's session, with the signature of the original.
  const moved = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), b: "other" })).toString("base64url");
  assert.equal(verifySessionToken(SECRET, `${version}.${moved}.${signature}`, now), null);
  assert.equal(verifySessionToken("another-secret-that-is-long-enough-12345", token, now), null);
  assert.equal(verifySessionToken(SECRET, `${token}x`, now), null);
  assert.equal(verifySessionToken(SECRET, "3f1c2b8e-1111-4a4a-9999-123456789abc", now), null);
  assert.equal(verifySessionToken(SECRET, undefined, now), null);
  const later = new Date(now.getTime() + (SESSION_TOKEN_TTL_SECONDS + 1) * 1000);
  assert.equal(verifySessionToken(SECRET, token, later), null);
});

test("the token comes from a Bearer header", () => {
  assert.equal(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(bearerToken("bearer abc"), "abc");
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken(undefined), null);
});

test("a visitor is a keyed hash of their address, never the address", () => {
  const key = visitorKey(SECRET, "197.248.10.20");
  assert.equal(key.length, 32);
  assert.equal(key.includes("197"), false);
  assert.equal(visitorKey(SECRET, "::ffff:197.248.10.20"), key);
  assert.notEqual(visitorKey(SECRET, "197.248.10.21"), key);
  assert.notEqual(visitorKey("another-secret-that-is-long-enough-12345", "197.248.10.20"), key);
});

test("only the business's own websites may call its chat from a browser", () => {
  const allowed = ["https://tembeabilamatata.com", "https://www.tembeabilamatata.com"];
  assert.equal(isOriginAllowed("https://tembeabilamatata.com", allowed), true);
  assert.equal(isOriginAllowed("https://WWW.tembeabilamatata.com", allowed), true);
  assert.equal(isOriginAllowed("https://evil.example", allowed), false);
  assert.equal(isOriginAllowed("https://tembeabilamatata.com.evil.example", allowed), false);
  assert.equal(isOriginAllowed("http://tembeabilamatata.com", allowed), false);
  assert.equal(isOriginAllowed("null", allowed), false);
  // Not a browser: no Origin header. Tokens and rate limits still apply.
  assert.equal(isOriginAllowed(undefined, allowed), true);
  assert.equal(normalizeOrigin("javascript:alert(1)"), null);
});

test("a business's day and its daily model budget", () => {
  // 22:30 on 24 Sept in UTC is already 25 Sept in Nairobi.
  assert.equal(businessDay("Africa/Nairobi", new Date("2026-09-24T22:30:00Z")), "2026-09-25");
  assert.equal(isOverCap({ inputTokens: 900, outputTokens: 99, turns: 3 }, 1000), false);
  assert.equal(isOverCap({ inputTokens: 900, outputTokens: 100, turns: 3 }, 1000), true);
  assert.equal(isOverCap({ inputTokens: 10 ** 9, outputTokens: 0, turns: 3 }, null), false);
});

test("the service refuses to start with missing or weak secrets", () => {
  const env = {
    PLATFORM_DATABASE_URL: "postgres://localhost/zaina",
    SESSION_TOKEN_SECRET: SECRET,
    PLATFORM_ADMIN_TOKEN: "admin-token-that-is-long-enough",
    GEMINI_API_KEY: "key",
  };
  const config = loadConfig(env);
  assert.equal(config.turnBudgetMs, 25_000);
  assert.equal(config.rateLimits.sessionMessagesPerMinute, 20);
  assert.equal(config.modelPriceUsdPerMillion, null);
  assert.throws(() => loadConfig({ ...env, SESSION_TOKEN_SECRET: "short" }), /at least 32/);
  assert.throws(() => loadConfig({ ...env, PLATFORM_ADMIN_TOKEN: "short" }), /at least 24/);
  assert.throws(() => loadConfig({ ...env, GEMINI_API_KEY: "" }), /GEMINI_API_KEY is required/);
  assert.throws(() => loadConfig({ ...env, TURN_BUDGET_MS: "-5" }), /positive whole number/);
  assert.deepEqual(
    loadConfig({ ...env, MODEL_PRICE_INPUT_USD_PER_MTOK: "0.1", MODEL_PRICE_OUTPUT_USD_PER_MTOK: "0.4" }).modelPriceUsdPerMillion,
    { input: 0.1, output: 0.4 },
  );
});
