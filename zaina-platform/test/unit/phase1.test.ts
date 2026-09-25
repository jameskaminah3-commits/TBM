import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { loadSecretKeys, openSecret, sealSecret } from "../../src/businesses/secrets.ts";
import { replyRulesFor, validateSettingsPatch } from "../../src/businesses/settings.ts";
import type { BusinessSettings } from "../../src/db/schema.ts";
import { sanitizeModelText } from "../../src/engine/reply-policy.ts";
import { hashPassword, passwordProblem, verifyAgainstNothing, verifyPassword } from "../../src/staff/passwords.ts";
import { issueStaffToken, STAFF_TOKEN_TTL_SECONDS, verifyStaffToken } from "../../src/staff/tokens.ts";
import { issueSessionToken, verifySessionToken } from "../../src/gateway/session-token.ts";

const SECRET = "unit-test-secret-that-is-long-enough-12345";

test("staff passwords are hashed with scrypt and checked in constant time", async () => {
  const hash = await hashPassword("Coast-2026-safe");
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(hash.includes("Coast-2026-safe"), false);
  assert.equal(await verifyPassword("Coast-2026-safe", hash), true);
  assert.equal(await verifyPassword("coast-2026-safe", hash), false);
  assert.notEqual(await hashPassword("Coast-2026-safe"), hash, "salted");
  assert.equal(await verifyAgainstNothing("anything"), false);
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  // A damaged hash is a failed match, not an error.
  assert.equal(await verifyPassword("x", "scrypt$abc$8$1$c2FsdA==$aGFzaA=="), false);
  assert.equal(await verifyPassword("x", "scrypt$3$8$1$c2FsdA==$aGFzaA=="), false, "N must be a power of two");
});

test("weak passwords are refused with a reason", () => {
  assert.match(passwordProblem("short1") ?? "", /10 characters/);
  assert.match(passwordProblem("onlyletterslong") ?? "", /Mix letters/);
  assert.match(passwordProblem("1234567890123") ?? "", /Mix letters/);
  assert.equal(passwordProblem("Coast-2026-safe"), null);
});

test("a staff token names the person and their token version, and expires", () => {
  const now = new Date("2026-09-25T08:00:00Z");
  const token = issueStaffToken(SECRET, { id: "0b3d1c9e-0000-4000-8000-000000000001", tokenVersion: 3 }, now);
  assert.deepEqual(verifyStaffToken(SECRET, token, now), {
    userId: "0b3d1c9e-0000-4000-8000-000000000001",
    tokenVersion: 3,
    expiresAt: Math.floor(now.getTime() / 1000) + STAFF_TOKEN_TTL_SECONDS,
  });
  assert.equal(verifyStaffToken(SECRET, token, new Date(now.getTime() + (STAFF_TOKEN_TTL_SECONDS + 1) * 1000)), null);
  assert.equal(verifyStaffToken("another-secret-that-is-long-enough-12345", token, now), null);
  assert.equal(verifyStaffToken(SECRET, `${token.slice(0, -1)}x`, now), null);
});

test("a chat token can't be used as a staff token, or the other way round", () => {
  const chat = issueSessionToken(SECRET, { sessionId: "0b3d1c9e-0000-4000-8000-000000000002", businessId: "tbm" });
  const staff = issueStaffToken(SECRET, { id: "0b3d1c9e-0000-4000-8000-000000000001", tokenVersion: 1 });
  assert.equal(verifyStaffToken(SECRET, chat), null);
  assert.equal(verifySessionToken(SECRET, staff), null);
});

test("secrets are sealed to their business and name", () => {
  const keys = loadSecretKeys({ PLATFORM_SECRETS_KEY: randomBytes(32).toString("base64") });
  const sealed = sealSecret(keys, "acme", "paystack_secret_key", "sk_live_do_not_leak");
  assert.equal(sealed.ciphertext.toString("utf8").includes("sk_live"), false);
  assert.equal(openSecret(keys, "acme", "paystack_secret_key", sealed), "sk_live_do_not_leak");
  // Moved to another business or another name, it can't be read.
  assert.throws(() => openSecret(keys, "tbm", "paystack_secret_key", sealed));
  assert.throws(() => openSecret(keys, "acme", "whatsapp_token", sealed));
  // Tampered, it can't be read.
  const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext.map((byte, index) => (index === 0 ? byte ^ 1 : byte))) };
  assert.throws(() => openSecret(keys, "acme", "paystack_secret_key", tampered));
});

test("a new key encrypts new secrets while old ones stay readable", () => {
  const oldKey = randomBytes(32).toString("hex");
  const before = loadSecretKeys({ PLATFORM_SECRETS_KEY: oldKey, PLATFORM_SECRETS_KEY_ID: "k1" });
  const sealed = sealSecret(before, "acme", "token", "value-1");
  const after = loadSecretKeys({ PLATFORM_SECRETS_KEY: randomBytes(32).toString("base64"), PLATFORM_SECRETS_KEY_ID: "k2", PLATFORM_SECRETS_OLD_KEYS: `k1:${oldKey}` });
  assert.equal(openSecret(after, "acme", "token", sealed), "value-1");
  assert.equal(sealSecret(after, "acme", "token", "value-2").keyId, "k2");
  assert.throws(() => loadSecretKeys({}), /PLATFORM_SECRETS_KEY is required/);
  assert.throws(() => loadSecretKeys({ PLATFORM_SECRETS_KEY: "too-short" }), /32 bytes/);
});

test("settings changes are checked before they are saved", () => {
  assert.deepEqual(validateSettingsPatch({ assistantName: " Amani ", defaultCurrency: "KES" }), { ok: true, patch: { assistantName: "Amani", defaultCurrency: "KES" } });
  assert.equal(validateSettingsPatch({ contactPhone: "0712345678" }).ok, false);
  assert.equal(validateSettingsPatch({ websiteUrl: "http://insecure.example" }).ok, false);
  assert.equal(validateSettingsPatch({ allowedLinkHosts: ["acme.example", "javascript:alert(1)"] }).ok, false);
  assert.equal(validateSettingsPatch({ allowedLinkHostSuffixes: ["go.ke"] }).ok, false);
  assert.equal(validateSettingsPatch({ displayName: "  " }).ok, false);
  assert.deepEqual(validateSettingsPatch({ supportEmail: null }), { ok: true, patch: { supportEmail: null } });
});

test("each business's links and numbers decide what Zaina may pass on", () => {
  const acme = {
    websiteUrl: "https://www.acme-guesthouse.example",
    allowedLinkHosts: ["booking.acme-guesthouse.example"],
    allowedLinkHostSuffixes: [],
    contactPhone: "+254700111222",
  } as unknown as BusinessSettings;
  const rules = replyRulesFor(acme);
  const text = "Book at https://booking.acme-guesthouse.example/r/1 or see https://www.acme-guesthouse.example/rooms, "
    + "not https://tembeabilamatata.com/x. Call +254 700 111 222, not +254 718 475 264.";
  assert.equal(
    sanitizeModelText(text, { customerTexts: [], ...rules }),
    "Book at https://booking.acme-guesthouse.example/r/1 or see https://www.acme-guesthouse.example/rooms, "
      + "not (link removed). Call +254 700 111 222, not (number removed).",
  );
  // Without business rules, the rules are TBM's (unchanged behaviour).
  assert.match(sanitizeModelText("See https://tembeabilamatata.com/x, call +254 718 475 264", { customerTexts: [] }), /tembeabilamatata\.com\/x, call \+254 718 475 264/);
});
