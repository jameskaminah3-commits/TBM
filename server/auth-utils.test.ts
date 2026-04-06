import assert from "node:assert/strict";
import test from "node:test";
import {
  generateOneTimeCode,
  hashOtp,
  hashPassword,
  normalizePhone,
  splitName,
  verifyPassword,
} from "./auth-utils.ts";

test("splitName separates first and last names", () => {
  assert.deepEqual(splitName("  Jane   Mary Doe "), {
    firstName: "Jane",
    lastName: "Mary Doe",
  });
});

test("normalizePhone keeps digits and a leading plus", () => {
  assert.equal(normalizePhone("+254 700-123 456"), "+254700123456");
});

test("hashPassword round-trips with verifyPassword", () => {
  const hash = hashPassword("super-secret-password");

  assert.equal(verifyPassword("super-secret-password", hash), true);
  assert.equal(verifyPassword("wrong-password", hash), false);
});

test("generateOneTimeCode returns a 6-digit numeric code", () => {
  const code = generateOneTimeCode();

  assert.match(code, /^\d{6}$/);
});

test("hashOtp is deterministic", () => {
  assert.equal(hashOtp("123456"), hashOtp("123456"));
  assert.notEqual(hashOtp("123456"), hashOtp("654321"));
});
