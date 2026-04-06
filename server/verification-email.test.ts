import assert from "node:assert/strict";
import test from "node:test";
import { buildVerificationEmail } from "./verification-email.ts";

test("buildVerificationEmail uses verification wording for signup checks", () => {
  const email = buildVerificationEmail({
    code: "123456",
    purpose: "email-verification",
  });

  assert.match(email.subject, /email verification/i);
  assert.match(email.text, /verify your tembea bila matata account/i);
  assert.match(email.html, /123456/);
});

test("buildVerificationEmail keeps password reset wording distinct", () => {
  const email = buildVerificationEmail({
    code: "654321",
    purpose: "password-reset",
  });

  assert.match(email.subject, /password reset/i);
  assert.match(email.text, /reset your tembea bila matata password/i);
});
