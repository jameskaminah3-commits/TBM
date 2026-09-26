// End-to-end: leads. A customer asks the team to get back to them; Zaina
// takes the details they typed; the team is alerted, sees the lead with its
// conversation, and follows it up (contacted, then won or lost, with a note
// of its own). Each business sees only its own leads.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5092;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = "https://dhowtours.example";

let platform: Platform;
let api: Api;
const tokens: Record<string, string> = {};
const staff = (method: string, route: string, body?: unknown, who = "owner", business = "dhow") => api(method, `/v1/staff/businesses/${business}${route}`, body, tokens[who]);
type Email = { to: string[]; subject: string; text: string };

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

async function say(token: string, message: string) {
  const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: SITE }, body: JSON.stringify({ message }) });
  const body = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.reply as string;
}

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, RESEND_API_KEY: "re_scripted", ALERT_FROM_EMAIL: "alerts@zaina.example" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = await login("ops@example.com");
  for (const [id, name, email] of [["dhow", "Diani Dhow Tours", "baraka@example.com"], ["other", "Other Business", "other@example.com"]]) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, business_type: "general", allowed_origins: [SITE], owner: { email, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  tokens.owner = await login("baraka@example.com");
  tokens.other = await login("other@example.com");
  for (const [email, role] of [["wanjiru@example.com", "agent"], ["viewer@example.com", "viewer"]]) {
    assert.equal((await staff("POST", "/members", { email, name: role, role, password: PASSWORD })).status, 201);
  }
  tokens.agent = await login("wanjiru@example.com");
  tokens.viewer = await login("viewer@example.com");
});

after(async () => {
  await platform?.stop();
});

test("a customer leaves their details: the team is alerted and sees the lead with its chat", async () => {
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ business: "dhow" }) });
  const chat = await opened.json() as any;
  await say(chat.token, "I'm Jane Wanjiru, jane@example.com");
  assert.equal(await say(chat.token, "TEST:lead"), "Tool said: ok");

  let alerts: Email[] = [];
  for (let attempt = 0; attempt < 40 && alerts.length < 2; attempt += 1) {
    alerts = (platform.log("emails") as Email[]).filter((email) => email.subject === "[Diani Dhow Tours] A customer wants you to get back to them");
    if (alerts.length < 2) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual(alerts.map((email) => email.to[0]).sort(), ["baraka@example.com", "wanjiru@example.com"], "people who answer chats, not a viewer");
  assert.match(alerts[0].text, /Jane Wanjiru wants: December family trip to Diani\./);
  assert.match(alerts[0].text, new RegExp(`Open your leads: ${BASE.replace(/[.]/g, "\\.")}/console/#/b/dhow/leads`));

  const open = await staff("GET", "/leads?status=open", undefined, "agent");
  assert.equal(open.status, 200);
  assert.deepEqual(open.body.counts, { new: 1, contacted: 0, won: 0, lost: 0 });
  const [lead] = open.body.leads;
  assert.deepEqual([lead.name, lead.email, lead.interest, lead.status, lead.channel, lead.sessionId], ["Jane Wanjiru", "jane@example.com", "December family trip to Diani", "new", "web", chat.session_id]);
  assert.equal((await staff("GET", "/pending-count", undefined, "viewer")).body.leads, 1, "the console shows how many are new");
  assert.equal((await staff("GET", "/leads", undefined, "viewer")).status, 403, "a viewer doesn't see customers' details");
});

test("the team follows a lead up: contacted with a note, then won", async () => {
  const [lead] = (await staff("GET", "/leads", undefined, "agent")).body.leads;
  const contacted = await staff("PATCH", `/leads/${lead.id}`, { status: "contacted", team_note: "Called on Tuesday; sending a quote." }, "agent");
  assert.equal(contacted.status, 200, JSON.stringify(contacted.body));
  assert.deepEqual([contacted.body.lead.status, contacted.body.lead.teamNote], ["contacted", "Called on Tuesday; sending a quote."]);
  assert.ok(contacted.body.lead.updatedAt);
  assert.equal((await staff("GET", "/pending-count")).body.leads, 0);
  assert.equal((await staff("GET", "/leads?status=new")).body.leads.length, 0);
  assert.equal((await staff("GET", "/leads?status=open")).body.leads.length, 1);

  assert.equal((await staff("PATCH", `/leads/${lead.id}`, { status: "booked" })).status, 400);
  assert.equal((await staff("PATCH", `/leads/${lead.id}`, { team_note: "x".repeat(1001) })).status, 400);
  assert.equal((await staff("PATCH", `/leads/${lead.id}`, {})).status, 400);
  assert.equal((await staff("PATCH", "/leads/999999", { status: "won" })).status, 404);

  const won = await staff("PATCH", `/leads/${lead.id}`, { status: "won" });
  assert.equal(won.body.lead.teamNote, "Called on Tuesday; sending a quote.", "the note stays");
  assert.deepEqual((await staff("GET", "/leads?status=won")).body.leads.map((entry: any) => entry.id), [lead.id]);
  assert.equal((await staff("GET", "/leads?status=open")).body.leads.length, 0);

  // Another business can't see or change it.
  assert.deepEqual((await staff("GET", "/leads", undefined, "other", "other")).body.leads, []);
  assert.equal((await staff("PATCH", `/leads/${lead.id}`, { status: "lost" }, "other", "other")).status, 404);
  assert.equal((await staff("GET", "/leads?status=won")).body.leads[0].status, "won");
});
