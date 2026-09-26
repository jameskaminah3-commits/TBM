// End-to-end: choosing a password by email.
//
//   forgotten      "Forgot your password?" answers the same for any email; the
//                  link works once, for an hour, for its own person, and a new
//                  password signs them out everywhere
//   invitations    a new team member (or a business's first owner, added by
//                  the platform team) is emailed a link to choose their own
//                  password; nobody has to pass one on
//   no email       without an email provider, there are no links: a new
//                  person needs a starting password, as before
//
// Email is the stand-in of scripted-model.mjs (every email is logged).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5084;
const BASE = `http://127.0.0.1:${PORT}`;
const NEW_PASSWORD = "LocalTest#2027";

let platform: Platform;
let api: Api;
let ops = "";
let owner = "";

type Email = { to: string[]; subject: string; text: string };
const emails = () => platform.log("emails") as Email[];
const emailsTo = (address: string) => emails().filter((email) => email.to.includes(address));
const linkIn = (email: Email | undefined, page: "reset" | "welcome") => {
  const match = new RegExp(`${BASE.replace(/[.]/g, "\\.")}/console/#/${page}/(pr1\\.[\\w-]+\\.[\\w-]+)`).exec(email?.text ?? "");
  return match?.[1] ?? assert.fail(`no ${page} link in: ${email?.text}`);
};
const staff = (method: string, route: string, body?: unknown, token = owner) => api(method, `/v1/staff/businesses/coral${route}`, body, token);

async function login(email: string, password: string) {
  return api("POST", "/v1/staff/login", { email, password });
}

/** Waits for the emails sent after an answer (they go out in the background). */
async function waitForEmail(address: string, subject: string, count = 1): Promise<Email> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = emailsTo(address).filter((email) => email.subject === subject);
    if (found.length >= count) return found[count - 1];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return assert.fail(`no email "${subject}" to ${address}`);
}

before(async () => {
  platform = await startPlatform({
    port: PORT,
    env: { PUBLIC_BASE_URL: BASE, RESEND_API_KEY: "re_scripted", ALERT_FROM_EMAIL: "hello@zaina.example" },
  });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = (await login("ops@example.com", PASSWORD)).body.token;
  const created = await api("POST", "/v1/platform/businesses", {
    id: "coral", name: "Coral Cove", business_type: "guesthouse", allowed_origins: ["https://coral.example"],
    owner: { email: "amani@example.com", name: "Amani Otieno", password: PASSWORD },
  }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.owner.invited, false);
  owner = (await login("amani@example.com", PASSWORD)).body.token;
});

after(async () => {
  await platform?.stop();
});

test("a forgotten password: the same answer for any email, and a link for the account's own person", async () => {
  assert.equal((await api("GET", "/v1/signup/config")).body.password_reset, true, "the sign-in page offers it");
  assert.equal((await api("POST", "/v1/staff/password/forgot", { email: "not an email" })).status, 400);

  const known = await api("POST", "/v1/staff/password/forgot", { email: " Amani@Example.com " });
  const unknown = await api("POST", "/v1/staff/password/forgot", { email: "nobody@example.com" });
  assert.equal(known.status, 202);
  assert.deepEqual([unknown.status, unknown.body], [known.status, known.body], "nobody can tell which emails have accounts");
  const email = await waitForEmail("amani@example.com", "Choose a new password for Zaina");
  assert.match(email.text, /^Hi Amani,/);
  assert.equal(emailsTo("nobody@example.com").length, 0);

  const token = linkIn(email, "reset");
  const checked = await api("POST", "/v1/staff/password/check", { token });
  assert.equal(checked.status, 200);
  assert.deepEqual(checked.body, { email: "amani@example.com", name: "Amani Otieno", purpose: "reset" });

  // A weak password is refused, and the link still works.
  const weak = await api("POST", "/v1/staff/password/reset", { token, password: "short" });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.error, "weak_password");
  const reset = await api("POST", "/v1/staff/password/reset", { token, password: NEW_PASSWORD });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.email, "amani@example.com");

  // Signed out everywhere; the old password no longer works, the new one does.
  assert.equal((await api("GET", "/v1/staff/me", undefined, owner)).status, 401);
  assert.equal((await login("amani@example.com", PASSWORD)).status, 401);
  const signedIn = await login("amani@example.com", NEW_PASSWORD);
  assert.equal(signedIn.status, 200);
  owner = signedIn.body.token;
  await waitForEmail("amani@example.com", "Your Zaina password was changed");

  // The link worked once.
  for (const route of ["check", "reset"]) {
    const again = await api("POST", `/v1/staff/password/${route}`, { token, password: "LocalTest#2028" });
    assert.equal(again.status, 400, route);
    assert.equal(again.body.error, "invalid_link");
  }
  assert.equal((await login("amani@example.com", NEW_PASSWORD)).status, 200);
});

test("two uses of one link at the same moment: only one changes the password", async () => {
  assert.equal((await api("POST", "/v1/staff/password/forgot", { email: "amani@example.com" })).status, 202);
  const token = linkIn(await waitForEmail("amani@example.com", "Choose a new password for Zaina", 2), "reset");
  const tries = await Promise.all(["LocalTest#3001", "LocalTest#3002", "LocalTest#3003"].map((password) => api("POST", "/v1/staff/password/reset", { token, password })));
  assert.deepEqual(tries.map((attempt) => attempt.status).sort(), [200, 400, 400]);
  const winner = ["LocalTest#3001", "LocalTest#3002", "LocalTest#3003"][tries.findIndex((attempt) => attempt.status === 200)];
  assert.equal((await login("amani@example.com", winner)).status, 200);
  owner = (await login("amani@example.com", winner)).body.token;
});

test("forged links fail, a disabled account gets no link, and asking is limited", async () => {
  for (const token of ["pr1.e30.bad", "", "st1.x.y"]) {
    assert.equal((await api("POST", "/v1/staff/password/reset", { token, password: NEW_PASSWORD })).status, 400);
  }
  platform.cli("create-staff.ts", ["--email", "gone@example.com", "--name", "Gone"], { STAFF_PASSWORD: PASSWORD });
  await platform.db.query("update staff_users set disabled_at = now() where email = 'gone@example.com'");
  assert.equal((await api("POST", "/v1/staff/password/forgot", { email: "gone@example.com" })).status, 202);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(emailsTo("gone@example.com").length, 0);

  // Five requests an hour from one visitor (this test's machine has made four).
  assert.equal((await api("POST", "/v1/staff/password/forgot", { email: "someone@example.com" })).status, 202);
  const limited = await api("POST", "/v1/staff/password/forgot", { email: "someone@example.com" });
  assert.equal(limited.status, 429);
});

test("a new team member is emailed a link to choose their password; nobody passes one on", async () => {
  const added = await staff("POST", "/members", { email: "brian@example.com", name: "Brian Otieno", role: "agent" });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.invited, true);
  const invite = await waitForEmail("brian@example.com", "You've been added to Coral Cove on Zaina");
  assert.match(invite.text, /Amani Otieno added you to Coral Cove on Zaina, as agent/);
  const token = linkIn(invite, "welcome");
  assert.equal((await login("brian@example.com", PASSWORD)).status, 401, "no password works until they choose one");

  const checked = await api("POST", "/v1/staff/password/check", { token });
  assert.deepEqual(checked.body, { email: "brian@example.com", name: "Brian Otieno", purpose: "invite" });
  assert.equal((await api("POST", "/v1/staff/password/reset", { token, password: NEW_PASSWORD })).status, 200);
  const brian = await login("brian@example.com", NEW_PASSWORD);
  assert.equal(brian.status, 200);
  assert.deepEqual(brian.body.businesses.map((entry: any) => [entry.businessId, entry.role]), [["coral", "agent"]]);
  assert.equal(emailsTo("brian@example.com").filter((email) => email.subject === "Your Zaina password was changed").length, 0, "choosing a first password isn't a change");

  // Someone who already has an account is told they were added; a role change sends nothing more.
  const before = emailsTo("ops@example.com").length;
  assert.equal((await staff("POST", "/members", { email: "ops@example.com", role: "viewer" })).body.invited, false);
  await waitForEmail("ops@example.com", "You've been added to Coral Cove on Zaina");
  assert.equal((await staff("POST", "/members", { email: "ops@example.com", role: "agent" })).status, 201);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(emailsTo("ops@example.com").length, before + 1);

  // A starting password still works for a manager who prefers it.
  const chosen = await staff("POST", "/members", { email: "wanjiru@example.com", name: "Wanjiru", role: "viewer", password: PASSWORD });
  assert.equal(chosen.body.invited, false);
  assert.equal((await login("wanjiru@example.com", PASSWORD)).status, 200);
});

test("the platform team adds a business; its new owner chooses their password by email", async () => {
  const created = await api("POST", "/v1/platform/businesses", {
    id: "studio", name: "Studio Nywele", business_type: "salon", allowed_origins: [],
    owner: { email: "neema@example.com", name: "Neema Achieng" },
  }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.owner.invited, true);
  const invite = await waitForEmail("neema@example.com", "You've been added to Studio Nywele on Zaina");
  assert.match(invite.text, /The Zaina team added you to Studio Nywele on Zaina, as owner/);
  assert.equal((await api("POST", "/v1/staff/password/reset", { token: linkIn(invite, "welcome"), password: NEW_PASSWORD })).status, 200);
  const neema = await login("neema@example.com", NEW_PASSWORD);
  assert.equal(neema.status, 200);
  assert.deepEqual(neema.body.businesses.map((entry: any) => [entry.businessId, entry.role]), [["studio", "owner"]]);
});

test("without email set up, there are no links: new people need a starting password", async () => {
  await platform.stop();
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = (await login("ops@example.com", PASSWORD)).body.token;
  assert.equal((await api("GET", "/v1/signup/config")).body.password_reset, false);
  assert.equal((await api("POST", "/v1/staff/password/forgot", { email: "ops@example.com" })).status, 503);
  const refused = await api("POST", "/v1/platform/businesses", { id: "coral", name: "Coral Cove", owner: { email: "amani@example.com", name: "Amani Otieno" } }, ops);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "password_required");
  const created = await api("POST", "/v1/platform/businesses", { id: "coral", name: "Coral Cove", owner: { email: "amani@example.com", name: "Amani Otieno", password: PASSWORD } }, ops);
  assert.equal(created.status, 201);
  owner = (await login("amani@example.com", PASSWORD)).body.token;
  const member = await staff("POST", "/members", { email: "brian@example.com", name: "Brian Otieno", role: "agent" });
  assert.equal(member.status, 400);
  assert.equal(member.body.error, "password_required");
});
