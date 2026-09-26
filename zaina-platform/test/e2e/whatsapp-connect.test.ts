// End-to-end: connecting a business's WhatsApp number with "Connect with
// Facebook" (Meta's Embedded Signup). The owner signs in with Facebook on the
// platform's own page; the platform exchanges the sign-in's code for the
// business's token, checks the number is in the account shared, registers it
// with a PIN of its own, subscribes to its messages and saves the connection.
// The console then offers the number's click-to-chat link, and customers who
// message it are answered.
//
// Meta's Graph API is the stand-in of scripted-model.mjs.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5094;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_SECRET = "whatsapp-connect-app-secret";
const NUMBER = "7200001111";
const WABA = "300000000001";

let platform: Platform;
let api: Api;
const tokens: Record<string, string> = {};
const staff = (method: string, route: string, body?: unknown, who = "owner") => api(method, `/v1/staff/businesses/coral${route}`, body, tokens[who]);

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

before(async () => {
  platform = await startPlatform({
    port: PORT,
    webAssets: true,
    env: {
      PUBLIC_BASE_URL: BASE,
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: "verify-token-for-connect-tests",
      WHATSAPP_APP_ID: "1234567890123",
      WHATSAPP_CONFIG_ID: "9876543210987",
      WHATSAPP_BATCH_MS: "0",
    },
  });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = await login("ops@example.com");
  const created = await api("POST", "/v1/platform/businesses", { id: "coral", name: "Coral Cove", business_type: "guesthouse", allowed_origins: [], owner: { email: "amani@example.com", name: "Amani", password: PASSWORD } }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  tokens.owner = await login("amani@example.com");
  assert.equal((await staff("POST", "/members", { email: "mary@example.com", name: "Mary", role: "manager", password: PASSWORD })).status, 201);
  tokens.manager = await login("mary@example.com");
});

after(async () => {
  await platform?.stop();
});

test("the console offers Connect with Facebook, on a page of its own that may run Meta's SDK", async () => {
  const state = await staff("GET", "/whatsapp");
  assert.deepEqual(state.body.embedded_signup, { app_id: "1234567890123", config_id: "9876543210987", graph_version: "v23.0" });
  assert.equal(state.body.connection, null);
  assert.equal(state.body.chat_link, null);

  const page = await fetch(`${BASE}/connect/whatsapp?business=coral`);
  assert.equal(page.status, 200);
  const policy = page.headers.get("content-security-policy") ?? "";
  assert.match(policy, /script-src 'self' https:\/\/connect\.facebook\.net/);
  assert.match(policy, /frame-src https:\/\/\*\.facebook\.com/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /unsafe-eval/);
  assert.equal(page.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
  assert.match(await page.text(), /Continue with Facebook/);
  assert.match(await (await fetch(`${BASE}/connect/whatsapp.js`)).text(), /WA_EMBEDDED_SIGNUP/);
  // The console's own policy never lets Meta's script in.
  const console = await fetch(`${BASE}/console/`);
  assert.doesNotMatch(console.headers.get("content-security-policy") ?? "", /facebook/);
});

test("only an owner connects; a code Meta refuses or a number outside the account changes nothing", async () => {
  const good = { code: "good-signup-code", phone_number_id: NUMBER, waba_id: WABA };
  assert.equal((await staff("POST", "/whatsapp/embedded", good, "manager")).status, 403);
  const refused = await staff("POST", "/whatsapp/embedded", { ...good, code: "expired-code" });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "signin_refused");
  const outside = await staff("POST", "/whatsapp/embedded", { ...good, phone_number_id: "7299999999" });
  assert.equal(outside.status, 400);
  assert.equal(outside.body.error, "number_not_shared");
  assert.equal((await staff("POST", "/whatsapp/embedded", { ...good, phone_number_id: "" })).status, 400);
  assert.equal((await staff("GET", "/whatsapp")).body.connection, null, "nothing was saved");
});

test("a finished sign-in connects the number: registered, subscribed, and its click-to-chat link", async () => {
  const connected = await staff("POST", "/whatsapp/embedded", { code: "good-signup-code", phone_number_id: NUMBER, waba_id: WABA });
  assert.equal(connected.status, 200, JSON.stringify(connected.body));
  assert.equal(connected.body.connection.display_phone_number, "+254 711 000 111");
  assert.equal(connected.body.connection.verified_name, "Coral Cove");
  assert.equal(connected.body.connection.has_token, true);
  assert.match(connected.body.pin, /^\d{6}$/);
  assert.deepEqual(connected.body.warnings, []);
  assert.equal(connected.body.chat_link, "https://wa.me/254711000111");

  const log = platform.log("whatsapp");
  assert.ok(log.some((entry) => entry.kind === "code-exchange" && entry.ok));
  assert.ok(log.some((entry) => entry.kind === "subscribed" && entry.waba === WABA));
  const registered = log.find((entry) => entry.kind === "registered");
  assert.deepEqual([registered.phoneNumberId, registered.pin, registered.product], [NUMBER, connected.body.pin, "whatsapp"], "registered with the PIN the owner was shown");
  const secrets = (await staff("GET", "/secrets")).body.secrets.map((secret: any) => secret.name).sort();
  assert.deepEqual(secrets, ["whatsapp_access_token", "whatsapp_pin"], "the token and PIN are kept encrypted, never shown again");

  // A customer's message to the number reaches Coral Cove, and Zaina answers on WhatsApp.
  const delivery = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: WABA, changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "254711000111", phone_number_id: NUMBER },
      contacts: [{ profile: { name: "Jane" }, wa_id: "254712345678" }],
      messages: [{ from: "254712345678", id: "wamid.connect-1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Habari! Do you have rooms in December?" } }],
    } }] }],
  });
  const signature = `sha256=${createHmac("sha256", APP_SECRET).update(delivery).digest("hex")}`;
  const webhook = await fetch(`${BASE}/v1/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: delivery });
  assert.equal(webhook.status, 200);
  await eventually(() => platform.log("whatsapp").some((entry) => entry.kind === "text" && entry.phoneNumberId === NUMBER && entry.to === "254712345678"), "Zaina answered on WhatsApp", 15_000);
  const chats = await staff("GET", "/sessions?filter=everything");
  assert.equal(chats.body.sessions.filter((chat: any) => chat.channel === "whatsapp").length, 1);
});

test("a number already registered elsewhere still connects, with a warning and no new PIN", async () => {
  const again = await staff("POST", "/whatsapp/embedded", { code: "good-signup-code", phone_number_id: "7200002222", waba_id: WABA });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.pin, null);
  assert.equal(again.body.warnings.length, 1);
  assert.match(again.body.warnings[0], /didn't register the number/);
  assert.equal(again.body.connection.phone_number_id, "7200002222");

  // Disconnecting removes the token and the PIN.
  assert.equal((await staff("DELETE", "/whatsapp")).status, 200);
  assert.deepEqual((await staff("GET", "/secrets")).body.secrets, []);
});
