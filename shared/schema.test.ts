import assert from "node:assert/strict";
import test from "node:test";
import { resendVerificationSchema, verifyEmailSchema } from "./schema.ts";

test("verifyEmailSchema accepts a valid verification payload", () => {
  const payload = verifyEmailSchema.parse({
    email: "jane@example.com",
    otp: "123456",
  });

  assert.deepEqual(payload, {
    email: "jane@example.com",
    otp: "123456",
  });
});

test("verifyEmailSchema rejects invalid OTP lengths", () => {
  assert.throws(() => verifyEmailSchema.parse({
    email: "jane@example.com",
    otp: "12345",
  }));
});

test("resendVerificationSchema requires a valid email", () => {
  assert.throws(() => resendVerificationSchema.parse({ email: "not-an-email" }));
});
