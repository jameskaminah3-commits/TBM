import assert from "node:assert/strict";
import test from "node:test";
import {
  generateOneTimeCode,
  hashOtp,
  hashPassword,
  isLocalDevelopmentHostname,
  normalizePhone,
  shouldBypassOtpVerificationForLocalTesting,
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

test("isLocalDevelopmentHostname matches localhost and private network hosts", () => {
  assert.equal(isLocalDevelopmentHostname("localhost"), true);
  assert.equal(isLocalDevelopmentHostname("app.localhost"), true);
  assert.equal(isLocalDevelopmentHostname("127.0.0.1"), true);
  assert.equal(isLocalDevelopmentHostname("::1"), true);
  assert.equal(isLocalDevelopmentHostname("192.168.1.24"), true);
  assert.equal(isLocalDevelopmentHostname("10.0.0.15"), true);
  assert.equal(isLocalDevelopmentHostname("172.20.5.9"), true);
  assert.equal(isLocalDevelopmentHostname("example.com"), false);
});

test("shouldBypassOtpVerificationForLocalTesting stays local unless explicitly forced", () => {
  assert.equal(shouldBypassOtpVerificationForLocalTesting({
    nodeEnv: "development",
    hostname: "localhost",
  }), true);

  assert.equal(shouldBypassOtpVerificationForLocalTesting({
    nodeEnv: "development",
    hostname: "example.com",
  }), false);

  assert.equal(shouldBypassOtpVerificationForLocalTesting({
    nodeEnv: "production",
    hostname: "localhost",
  }), false);

  assert.equal(shouldBypassOtpVerificationForLocalTesting({
    nodeEnv: "production",
    hostname: "example.com",
    localOtpBypass: "true",
  }), true);
});
