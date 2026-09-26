// Emailed password links without a database: what a link carries, how long
// it works, and that nothing else passes for one.

import assert from "node:assert/strict";
import test from "node:test";
import { confirmToken } from "../../src/signup/routes.ts";
import { inviteEmail, passwordChangedEmail, passwordLink, passwordLinkToken, readPasswordLinkToken, resetEmail } from "../../src/staff/password-links.ts";
import { issueStaffToken } from "../../src/staff/tokens.ts";

const SECRET = "unit-test-secret-long-enough-0123456789";
const jane = { id: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b", email: "jane@example.com", tokenVersion: 4 };
const now = new Date("2026-09-26T08:00:00Z");
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

test("a reset link names the person, their email and token version, and works for an hour", () => {
  const token = passwordLinkToken(SECRET, jane, "reset", now);
  assert.match(token, /^pr1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(readPasswordLinkToken(SECRET, token, now), { userId: jane.id, email: jane.email, tokenVersion: 4, purpose: "reset" });
  assert.ok(readPasswordLinkToken(SECRET, token, later(3599)));
  assert.equal(readPasswordLinkToken(SECRET, token, later(3600)), null, "an hour later it has expired");
});

test("an invitation works for three days", () => {
  const token = passwordLinkToken(SECRET, jane, "invite", now);
  assert.equal(readPasswordLinkToken(SECRET, token, later(72 * 3600 - 1))?.purpose, "invite");
  assert.equal(readPasswordLinkToken(SECRET, token, later(72 * 3600)), null);
});

test("a changed, forged or different token isn't a password link", () => {
  const token = passwordLinkToken(SECRET, jane, "reset", now);
  const [version, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const other = Buffer.from(JSON.stringify({ ...claims, u: "00000000-0000-4000-8000-000000000000" })).toString("base64url");
  const longer = Buffer.from(JSON.stringify({ ...claims, p: "invite" })).toString("base64url");
  for (const bad of [
    `${version}.${other}.${signature}`,
    `${version}.${longer}.${signature}`,
    `${version}.${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`,
    `${token}.extra`,
    `pr2.${payload}.${signature}`,
    passwordLinkToken("another-secret-long-enough-0123456789", jane, "reset", now),
    issueStaffToken(SECRET, jane, now),
    confirmToken(SECRET, jane, now),
    "pr1.e30.bad",
    "",
    null,
    42,
    `pr1.${"a".repeat(900)}.x`,
  ]) {
    assert.equal(readPasswordLinkToken(SECRET, bad, now), null, String(bad).slice(0, 40));
  }
});

test("the link opens the console on a fragment, so the token never reaches a server's logs", () => {
  const token = passwordLinkToken(SECRET, jane, "reset", now);
  assert.equal(passwordLink("https://zaina.example", token, "reset"), `https://zaina.example/console/#/reset/${token}`);
  assert.equal(passwordLink("https://zaina.example", token, "invite"), `https://zaina.example/console/#/welcome/${token}`);
});

test("the emails say what happened and how long a link works", () => {
  const reset = resetEmail({ name: "Jane Wanjiru" }, "https://zaina.example/console/#/reset/pr1.x.y");
  assert.equal(reset.subject, "Choose a new password for Zaina");
  assert.match(reset.text, /^Hi Jane,/);
  assert.match(reset.text, /works once, for an hour/);
  const invite = inviteEmail({ name: "Brian" }, "Coral Cove", "agent", "https://zaina.example/console/#/welcome/pr1.x.y", "Amani Otieno");
  assert.equal(invite.subject, "You've been added to Coral Cove on Zaina");
  assert.match(invite.text, /Amani Otieno added you to Coral Cove on Zaina, as agent/);
  assert.match(invite.text, /three days/);
  assert.match(inviteEmail({ name: "Neema" }, "Studio", "owner", "link", null).text, /The Zaina team added you/);
  assert.match(passwordChangedEmail({ name: "Jane" }, "https://zaina.example/console/").text, /signed out/);
});
