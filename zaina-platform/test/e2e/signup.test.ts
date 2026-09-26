// End-to-end, Phase 5: a business signs up by itself and goes live, with no
// one from the platform team and no code changes (the plan's exit check).
//
//   sign up        the owner's name, email and password, the business's name,
//                  kind and website; the email is confirmed by its link
//   set up         the console's checklist, read from what the business did:
//                  profile, hours, team and services, its own deposit, where
//                  customers chat, and a test chat with Zaina
//   go live        only when every required step is done; then its website
//                  chat answers customers, and the platform team can pause it
//
// Email is the stand-in of scripted-model.mjs (every email is logged).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addDays, isoDate, parseDate } from "../../src/booking/pricing.ts";
import { businessDay } from "../../src/gateway/spend-cap.ts";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5080;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = "https://studio-nywele.example";
const OWNER = { name: "Neema Achieng", email: "neema@example.com", password: "LocalTest#2026" };

let platform: Platform;
let api: Api;
let token = "";
let businessId = "";

const staff = (method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/${businessId}${route}`, body, token);
const emails = () => platform.log("emails") as Array<{ subject: string; text: string }>;
const linkIn = (text: string) => /(http:\/\/127\.0\.0\.1:\d+\/v1\/signup\/confirm\?token=\S+)/.exec(text)?.[1] ?? assert.fail(`no link in: ${text}`);
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;

async function chat(origin: string, sessionToken: string, message: string) {
  const response = await fetch(`${BASE}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}`, origin },
    body: JSON.stringify({ message }),
  });
  return { status: response.status, body: await response.json() as any };
}

async function openSession(origin: string, key: string) {
  const response = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ business_key: key, display_currency: "KES" }),
  });
  return { status: response.status, body: await response.json() as any };
}

before(async () => {
  platform = await startPlatform({
    port: PORT,
    env: { PUBLIC_BASE_URL: BASE, PLATFORM_SIGNUP: "open", RESEND_API_KEY: "re_scripted", ALERT_FROM_EMAIL: "hello@zaina.example" },
  });
  api = apiFor(platform.base);
});

after(async () => {
  await platform?.stop();
});

test("a business signs up; the owner confirms their email before signing in", async () => {
  const config = await api("GET", "/v1/signup/config");
  assert.equal(config.body.open, true);
  assert.deepEqual(config.body.business_types.map((entry: any) => entry.type), ["guesthouse", "salon", "restaurant", "general"]);

  const form = { ...OWNER, business_name: "Studio Nywele", business_type: "salon", website: "studio-nywele.example", accept_terms: true };
  assert.equal((await api("POST", "/v1/signup", { ...form, password: "short" })).status, 400);
  assert.equal((await api("POST", "/v1/signup", { ...form, accept_terms: false })).status, 400);
  assert.equal((await api("POST", "/v1/signup", { ...form, business_type: "travel_concierge" })).status, 400, "a concierge needs the platform team");
  const signed = await api("POST", "/v1/signup", form);
  assert.equal(signed.status, 202, JSON.stringify(signed.body));
  const confirm = emails().find((email) => email.subject === "Confirm your email for Zaina");
  assert.ok(confirm);
  assert.match(confirm.text, /Thanks for signing up Studio Nywele on Zaina/);

  const early = await api("POST", "/v1/staff/login", { email: OWNER.email, password: OWNER.password });
  assert.equal(early.status, 403);
  assert.equal(early.body.error, "email_not_confirmed");
  assert.equal((await api("POST", "/v1/staff/login", { email: OWNER.email, password: "WrongPass#2026" })).status, 401, "the wrong password learns nothing");

  // Signing up again with the same email looks the same, and tells the owner by email instead.
  const again = await api("POST", "/v1/signup", { ...form, business_name: "Studio Two" });
  assert.equal(again.status, 202);
  assert.deepEqual(again.body, signed.body);
  assert.ok(emails().some((email) => email.subject === "You already have a Zaina account"));
  assert.equal((await platform.db.query("select count(*)::int as n from businesses where source = 'self_serve'")).rows[0].n, 1);

  const forged = await fetch(`${BASE}/v1/signup/confirm?token=ev1.e30.bad`, { redirect: "manual" });
  assert.equal(forged.headers.get("location"), `${BASE}/console/?confirmed=expired`);
  const confirmed = await fetch(linkIn(confirm.text), { redirect: "manual" });
  assert.equal(confirmed.status, 303);
  assert.equal(confirmed.headers.get("location"), `${BASE}/console/?confirmed=yes`);

  const signedIn = await api("POST", "/v1/staff/login", { email: OWNER.email, password: OWNER.password });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
  token = signedIn.body.token;
  const [membership] = signedIn.body.businesses;
  assert.match(membership.businessId, /^studio-nywele-[0-9a-f]{4}$/);
  assert.deepEqual([membership.role, membership.businessType, membership.businessStatus], ["owner", "salon", "onboarding"]);
  businessId = membership.businessId;
});

test("setting up: the checklist follows what the business does, and it can't go live early", async () => {
  const operations = await staff("GET", "/operations");
  assert.equal(operations.body.status, "onboarding");
  assert.deepEqual(operations.body.allowed_origins, [SITE], "the website from sign-up");
  const closed = await openSession(SITE, operations.body.public_key);
  assert.equal(closed.status, 404, "customers aren't answered before it's live");

  const start = await staff("GET", "/onboarding");
  assert.deepEqual(start.body.steps.map((step: any) => step.id), ["profile", "knowledge", "offerings", "rules", "payments", "channels", "try"]);
  assert.deepEqual(start.body.steps.filter((step: any) => step.done).map((step: any) => step.id), ["channels"]);
  assert.equal(start.body.ready, false);
  const early = await staff("POST", "/go-live");
  assert.equal(early.status, 409);
  assert.match(early.body.message, /Tell Zaina about your business/);

  assert.equal((await staff("PATCH", "/settings", { about: "Studio Nywele is a hair salon in Kilimani, Nairobi: cuts, braids and colour.", contactPhone: "+254700111222" })).status, 200);
  const weekdays = Object.fromEntries(["1", "2", "3", "4", "5", "6"].map((day) => [day, [["09:00", "18:00"]]]));
  assert.equal((await staff("PATCH", "/booking-settings", { opening_hours: weekdays })).status, 200);
  assert.equal((await staff("POST", "/resources", { name: "Amina", kind: "staff" })).status, 201);
  assert.equal((await staff("POST", "/offerings", { name: "Haircut", duration_minutes: 60, pricing: { price: 150000 } })).status, 201);
  const middle = await staff("GET", "/onboarding");
  const done = (id: string) => middle.body.steps.find((step: any) => step.id === id).done;
  assert.equal(done("profile"), true);
  assert.equal(done("offerings"), true);
  assert.equal(done("rules"), false, "the deposit is the business's choice: it isn't made for it");
  assert.equal(done("payments"), false);

  assert.equal((await staff("PATCH", "/booking-settings", { deposit_type: "percent", deposit_percent: 20 })).status, 200);
  assert.equal((await staff("GET", "/onboarding")).body.steps.find((step: any) => step.id === "payments").done, false, "a deposit needs a way to pay it");
  assert.equal((await staff("PUT", "/payments/mpesa-manual", { type: "till", number: "5566778" })).status, 200);

  // Trying Zaina in the console, before it's live.
  const preview = await staff("POST", "/preview");
  assert.equal(preview.status, 201, JSON.stringify(preview.body));
  assert.equal((await chat("https://elsewhere.example", preview.body.token, "Hello")).status, 403, "only from the console");
  const monday = (() => {
    let date = addDays(parseDate(businessDay("Africa/Nairobi"))!, 7);
    while (date.getUTCDay() !== 1) date = addDays(date, 1);
    return isoDate(date);
  })();
  const tried = await chat(BASE, preview.body.token, raw64("check_times", { service: "haircut", date: monday }));
  assert.equal(tried.status, 200, JSON.stringify(tried.body));
  assert.match(tried.body.reply, /Free on .*: 09:00/);

  const ready = await staff("GET", "/onboarding");
  assert.equal(ready.body.ready, true, JSON.stringify(ready.body.steps.filter((step: any) => !step.done)));
  assert.equal(ready.body.steps.find((step: any) => step.id === "knowledge").required, false, "knowledge is recommended for a salon");
});

test("going live: the website chat answers customers; test chats stay out of the reports", async () => {
  const live = await staff("POST", "/go-live");
  assert.equal(live.status, 200, JSON.stringify(live.body));
  assert.equal(live.body.status, "active");
  assert.ok(live.body.went_live_at);
  assert.equal((await staff("POST", "/go-live")).status, 409, "already live");

  const { public_key } = (await staff("GET", "/operations")).body;
  const session = await openSession(SITE, public_key);
  assert.equal(session.status, 201, JSON.stringify(session.body));
  const hello = await chat(SITE, session.body.token, raw64("list_services", {}));
  assert.equal(hello.status, 200);
  assert.match(hello.body.reply, /Haircut \(1 h, KSh 1,500\)/);
  assert.match(hello.body.reply, /20% to confirm/, "the business's own deposit");

  const report = await staff("GET", "/reports?days=7");
  assert.equal(report.status, 200);
  assert.equal(report.body.chats.total, 1, "the customer's chat, not the owner's test");
});

test("the platform team can pause a business and resume it; paused, its team still has the console", async () => {
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  const listed = await api("GET", "/v1/platform/businesses", undefined, ops);
  const entry = listed.body.businesses.find((business: any) => business.id === businessId);
  assert.equal(entry.source, "self_serve");
  assert.ok(entry.went_live_at);

  assert.equal((await api("PATCH", `/v1/platform/businesses/${businessId}`, { status: "paused" }, ops)).status, 200);
  const { public_key } = (await staff("GET", "/operations")).body;
  assert.equal((await openSession(SITE, public_key)).status, 404, "paused: customers aren't answered");
  assert.equal((await staff("GET", "/onboarding")).status, 200, "the team still reaches its console");
  assert.equal((await staff("POST", "/go-live")).status, 409, "only the platform team resumes a paused business");
  assert.equal((await api("PATCH", `/v1/platform/businesses/${businessId}`, { status: "active" }, ops)).status, 200);
  assert.equal((await openSession(SITE, public_key)).status, 201);
});
