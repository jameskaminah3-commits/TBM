// End-to-end, Phase 3: a pilot business (Acme Guesthouse) answers its
// WhatsApp customers end to end, and its team works from the console's API.
//
// The platform runs as in production, with stand-ins at the network edge
// (scripted-model.mjs): the model, email, WhatsApp's Cloud API and a push
// service. Meta's webhook deliveries are signed exactly as Meta signs them.
// The platform database must be local and end in _test (it is wiped).
// Run: npm run test:e2e (from zaina-platform/).

import assert from "node:assert/strict";
import { createHmac, createECDH, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import webpush from "web-push";
import { apiFor, eventually, PASSWORD, sleep, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5073;
const APP_SECRET = "meta-app-secret-for-tests-0123456789";
const VERIFY_TOKEN = "verify-token-for-tests-123";
const ACCESS_TOKEN = "EAAG-test-token-0000000000";
const ACME_NUMBER_ID = "100200300400";
const ACME_WABA_ID = "900800700600";
const ACME_ORIGIN = "https://acme.example";
const vapid = webpush.generateVAPIDKeys();

let platform: Platform;
let api: Api;
let opsToken = "";
let ownerToken = "";
let agentToken = "";
let betaToken = "";
let messageCounter = 0;
let customerCounter = 100;
const nextCustomer = () => `2547110${String(customerCounter++).padStart(5, "0")}`;

function delivery(value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: ACME_WABA_ID, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "254700123456", phone_number_id: ACME_NUMBER_ID }, ...value } }] }],
  };
}

function customerMessage(from: string, message: Record<string, unknown>, name = "Jane Wanjiru") {
  messageCounter += 1;
  const id = `wamid.in-${messageCounter}-${randomBytes(4).toString("hex")}`;
  return {
    id,
    payload: delivery({
      contacts: [{ profile: { name }, wa_id: from }],
      messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
    }),
  };
}

const text = (from: string, body: string, name?: string) => customerMessage(from, { type: "text", text: { body } }, name);

async function webhook(payload: unknown, secret = APP_SECRET) {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const response = await fetch(`${platform.base}/v1/whatsapp/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body: raw,
  });
  return { status: response.status, body: await response.json() };
}

const sentTo = (to: string) => platform.log("whatsapp").filter((entry) => entry.to === to && (entry.kind === "text" || entry.kind === "template"));
const repliesTo = (to: string) => sentTo(to).filter((entry) => entry.kind === "text").map((entry) => entry.text as string);
const chatOf = async (address: string) => (await platform.db.query("select * from chat_sessions where customer_address = $1 order by created_at desc limit 1", [address])).rows[0];

/** A browser's push subscription, as the console would register it. */
function pushSubscription(name: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint: `https://push.example/${name}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}

async function tokenFor(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

before(async () => {
  platform = await startPlatform({
    port: PORT,
    webAssets: true,
    env: {
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      WHATSAPP_BATCH_MS: "400",
      WHATSAPP_SWEEP_INTERVAL_MS: "400",
      WEB_PUSH_PUBLIC_KEY: vapid.publicKey,
      WEB_PUSH_PRIVATE_KEY: vapid.privateKey,
      WEB_PUSH_SUBJECT: "mailto:ops@example.com",
      RESEND_API_KEY: "re_scripted",
      ALERT_FROM_EMAIL: "alerts@example.com",
      PUBLIC_BASE_URL: `http://127.0.0.1:${PORT}`,
      LIMIT_SESSION_MESSAGES_PER_MINUTE: "6",
    },
  });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  opsToken = await tokenFor("ops@example.com");

  for (const [id, name, owner] of [["acme", "Acme Guesthouse", "otieno@example.com"], ["beta", "Beta Lodge", "beta@example.com"]] as const) {
    const created = await api("POST", "/v1/platform/businesses", {
      id, name, allowed_origins: [id === "acme" ? ACME_ORIGIN : "https://beta.example"], business_type: "guesthouse",
      owner: { email: owner, name: owner === "otieno@example.com" ? "Otieno Ochieng" : "Beta Owner", password: PASSWORD },
    }, opsToken);
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  ownerToken = await tokenFor("otieno@example.com");
  betaToken = await tokenFor("beta@example.com");
  assert.equal((await api("POST", "/v1/staff/businesses/acme/members", { email: "wanjiku@example.com", name: "Wanjiku Kamau", password: PASSWORD, role: "agent" }, ownerToken)).status, 201);
  agentToken = await tokenFor("wanjiku@example.com");
  assert.equal((await api("PATCH", "/v1/staff/businesses/acme/settings", { contactPhone: "+254700123456", websiteUrl: "https://acme.example" }, ownerToken)).status, 200);
  platform.cli("import-knowledge.ts", ["--business", "acme", "--dir", "zaina-platform/test/eval/fixtures/acme"]);
});

after(async () => {
  await platform?.stop();
});

test("the webhook answers Meta's set-up handshake only with the right token", async () => {
  const good = await fetch(`${platform.base}/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`);
  assert.equal(good.status, 200);
  assert.equal(await good.text(), "1158201444");
  const bad = await fetch(`${platform.base}/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong-token-xxxxxxxx&hub.challenge=1158201444`);
  assert.equal(bad.status, 403);
});

test("an owner connects Acme's WhatsApp number; Meta checks the token before anything is saved", async () => {
  const before = await api("GET", "/v1/staff/businesses/acme/whatsapp", undefined, ownerToken);
  assert.equal(before.status, 200);
  assert.equal(before.body.available, true);
  assert.equal(before.body.connection, null);
  assert.equal(before.body.webhook_url, `http://127.0.0.1:${PORT}/v1/whatsapp/webhook`);

  const connection = { phone_number_id: ACME_NUMBER_ID, waba_id: ACME_WABA_ID, access_token: ACCESS_TOKEN };
  assert.equal((await api("PUT", "/v1/staff/businesses/acme/whatsapp", connection, agentToken)).status, 403, "an agent can't");
  const wrongToken = await api("PUT", "/v1/staff/businesses/acme/whatsapp", { ...connection, access_token: "EAAG-wrong-token-000000000" }, ownerToken);
  assert.equal(wrongToken.status, 400);
  assert.equal(wrongToken.body.error, "whatsapp_check_failed");
  assert.match(wrongToken.body.message, /access token/i);
  assert.equal((await api("GET", "/v1/staff/businesses/acme/whatsapp", undefined, ownerToken)).body.connection, null, "nothing saved");

  const connected = await api("PUT", "/v1/staff/businesses/acme/whatsapp", connection, ownerToken);
  assert.equal(connected.status, 200, JSON.stringify(connected.body));
  assert.equal(connected.body.connection.display_phone_number, "+254 700 123 456");
  assert.equal(connected.body.connection.has_token, true);
  assert.deepEqual(connected.body.warnings, []);
  assert.ok(platform.log("whatsapp").some((entry) => entry.kind === "subscribed" && entry.waba === ACME_WABA_ID), "the platform's app subscribed to Acme's account");

  // The token is a business secret: stored encrypted, never shown again.
  const secrets = await api("GET", "/v1/staff/businesses/acme/secrets", undefined, ownerToken);
  assert.deepEqual(secrets.body.secrets.map((secret: any) => secret.name), ["whatsapp_access_token"]);
  const stored = (await platform.db.query("select ciphertext from business_secrets where business_id = 'acme'")).rows[0];
  assert.ok(!stored.ciphertext.toString("utf8").includes(ACCESS_TOKEN));

  // Another business can't take the same number.
  const taken = await api("PUT", "/v1/staff/businesses/beta/whatsapp", connection, betaToken);
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, "number_in_use");
});

test("unsigned or wrongly signed deliveries are refused before anything is read", async () => {
  const customer = nextCustomer();
  const { payload } = text(customer, "Hello?");
  const unsigned = await fetch(`${platform.base}/v1/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(unsigned.status, 401);
  assert.equal((await webhook(payload, "someone-elses-secret")).status, 401);
  await sleep(600);
  assert.equal(await chatOf(customer), undefined, "no chat was opened");
  assert.equal(sentTo(customer).length, 0);
});

test("a WhatsApp customer's question gets Zaina's answer from Acme's knowledge, on WhatsApp", async () => {
  const customer = nextCustomer();
  const message = text(customer, "TEST:ask What time is check-in?", "Jane Wanjiru");
  assert.deepEqual(await webhook(message.payload), { status: 200, body: { ok: true } });
  const [reply] = await eventually(() => repliesTo(customer).length > 0 && repliesTo(customer), "Zaina replied on WhatsApp");
  assert.match(reply, /House rules/, "the answer names its source");
  assert.match(reply, /2 pm/);
  assert.ok(platform.log("whatsapp").some((entry) => entry.kind === "read" && entry.messageId === message.id && entry.typing), "blue ticks and typing");

  const chat = await chatOf(customer);
  assert.equal(chat.business_id, "acme");
  assert.equal(chat.channel, "whatsapp");
  assert.equal(chat.customer_name, "Jane Wanjiru");
  assert.equal(chat.display_currency, "KES", "a Kenyan number sees shillings");
  // The send is recorded just after Meta accepts it.
  const outbound = await eventually(async () => {
    const rows = (await platform.db.query("select * from whatsapp_outbound where session_id = $1", [chat.id])).rows;
    return rows.length > 0 && rows[0].status === "sent" && rows;
  }, "the reply was recorded as sent");
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].status, "sent");

  // Zaina knows it's WhatsApp, and the customer's number, without being told in the chat.
  const call = platform.log("model").find((entry) => /What time is check-in/.test(entry.customerText));
  assert.ok(call, "the model was called");

  // Meta retries a delivery it isn't sure arrived: no second answer.
  assert.equal((await webhook(message.payload)).status, 200);
  await sleep(1200);
  assert.equal(repliesTo(customer).length, 1);

  // Statuses move forward only: read, then a late "delivered", stays read.
  const wamid = outbound[0].message_id;
  await webhook(delivery({ statuses: [{ id: wamid, status: "read", timestamp: "1", recipient_id: customer }] }));
  await webhook(delivery({ statuses: [{ id: wamid, status: "delivered", timestamp: "1", recipient_id: customer }] }));
  assert.equal((await platform.db.query("select status from whatsapp_outbound where message_id = $1", [wamid])).rows[0].status, "read");
});

test("messages that arrive together are answered together", async () => {
  const customer = nextCustomer();
  const modelCallsBefore = platform.log("model").length;
  for (const line of ["Hi", "Do you have a pool?", "We are 4 people"]) {
    assert.equal((await webhook(text(customer, line).payload)).status, 200);
  }
  await eventually(() => repliesTo(customer).length > 0, "Zaina replied");
  await sleep(800);
  assert.equal(repliesTo(customer).length, 1, "one answer for the three messages");
  const calls = platform.log("model").slice(modelCallsBefore).filter((entry) => /Do you have a pool/.test(entry.customerText));
  assert.equal(calls.length, 1);
  assert.match(calls[0].customerText, /Hi\s+Do you have a pool\?\s+We are 4 people/);
});

test("a photo with no words gets a fixed reply without the model, and the team can open it", async () => {
  const customer = nextCustomer();
  const modelCallsBefore = platform.log("model").length;
  const mediaId = "1234567890123456";
  await webhook(customerMessage(customer, { type: "image", image: { id: mediaId, mime_type: "image/jpeg", sha256: "x" } }).payload);
  const [reply] = await eventually(() => repliesTo(customer).length > 0 && repliesTo(customer), "a reply to the photo");
  assert.match(reply, /Thanks for the photo/);
  assert.equal(platform.log("model").length, modelCallsBefore, "no model call for a photo");

  const chat = await chatOf(customer);
  const [event] = (await platform.db.query("select content, media from chat_events where session_id = $1 and actor = 'USER'", [chat.id])).rows;
  assert.equal(event.content, "[Photo]");
  assert.equal(event.media[0].id, mediaId);

  const photo = await fetch(`${platform.base}/v1/staff/businesses/acme/whatsapp/media/${mediaId}`, { headers: { authorization: `Bearer ${agentToken}` } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/jpeg");
  assert.match(photo.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.equal((await photo.arrayBuffer()).byteLength, 22);
  const otherBusiness = await fetch(`${platform.base}/v1/staff/businesses/beta/whatsapp/media/${mediaId}`, { headers: { authorization: `Bearer ${betaToken}` } });
  assert.equal(otherBusiness.status, 404, "only media sent to that business");
  const unknown = await fetch(`${platform.base}/v1/staff/businesses/acme/whatsapp/media/9999999999999999`, { headers: { authorization: `Bearer ${agentToken}` } });
  assert.equal(unknown.status, 404, "only media a customer actually sent");
});

test("a customer who asks for a person reaches the available agent first, and the team's reply goes out on WhatsApp", async () => {
  // Wanjiku is taking chats; both she and the owner have alerts on their phones.
  assert.equal((await api("POST", "/v1/staff/businesses/acme/presence", { available: true }, agentToken)).status, 200);
  assert.equal((await api("POST", "/v1/console/push-subscriptions", pushSubscription("wanjiku-phone"), agentToken)).status, 201);
  assert.equal((await api("POST", "/v1/console/push-subscriptions", pushSubscription("otieno-phone"), ownerToken)).status, 201);
  const pushesBefore = platform.log("push").length;
  const emailsBefore = platform.log("emails").length;

  const customer = nextCustomer();
  await webhook(text(customer, "TEST:escalate I'd like to talk to someone about a group booking").payload);
  await eventually(async () => (await chatOf(customer))?.managed_by === "HUMAN", "the chat was handed over");
  const chat = await chatOf(customer);
  const wanjiku = (await platform.db.query("select id from staff_users where email = 'wanjiku@example.com'")).rows[0].id;
  assert.equal(chat.routed_to, wanjiku, "offered to the available agent");

  const pushes = await eventually(() => {
    const sent = platform.log("push").slice(pushesBefore);
    return sent.length > 0 && sent;
  }, "an alert went to a phone");
  assert.deepEqual(pushes.map((push: any) => push.endpoint), ["https://push.example/wanjiku-phone"], "only Wanjiku hears first");
  assert.ok(pushes.every((push: any) => push.encrypted && push.vapid && push.urgency === "high"));
  const email = await eventually(() => platform.log("emails").slice(emailsBefore).find((entry) => /A customer is waiting/.test(entry.subject)), "an alert email");
  assert.equal(email.subject, "[Acme Guesthouse] A customer is waiting for you");
  assert.match(email.text, /console\/#\/b\/acme\/inbox\//);

  const mine = await api("GET", "/v1/staff/businesses/acme/sessions?filter=mine", undefined, agentToken);
  const listed = mine.body.sessions.find((row: any) => row.id === chat.id);
  assert.ok(listed, "in Wanjiku's own list");
  assert.equal(listed.channel, "whatsapp");
  assert.equal(listed.customer.label, "Jane Wanjiru");
  assert.equal(listed.customer.phone, `+${customer}`);
  assert.equal(listed.window.open, true);
  assert.equal(listed.routedToName, "Wanjiku Kamau");

  // She claims it and answers; the customer gets it on WhatsApp, signed with her first name.
  assert.equal((await api("POST", `/v1/staff/businesses/acme/sessions/${chat.id}/claim`, undefined, agentToken)).status, 200);
  const answered = await api("POST", `/v1/staff/businesses/acme/sessions/${chat.id}/messages`, { message: "Hi Jane, how many rooms do you need?" }, agentToken);
  assert.equal(answered.status, 201);
  assert.equal(answered.body.delivery, "delivered");
  assert.equal(repliesTo(customer).at(-1), "*Wanjiku*: Hi Jane, how many rooms do you need?");

  // The customer answers during the handoff: Zaina stays quiet, Wanjiku's phone buzzes.
  const pushesMid = platform.log("push").length;
  await webhook(text(customer, "Three rooms please").payload);
  await eventually(() => platform.log("push").slice(pushesMid).some((push) => push.endpoint === "https://push.example/wanjiku-phone"), "Wanjiku heard the customer replied");
  assert.equal(repliesTo(customer).length, 2, "Zaina didn't answer while the team has the chat");
  const detail = await api("GET", `/v1/staff/businesses/acme/sessions/${chat.id}`, undefined, agentToken);
  assert.equal(detail.body.transcript.at(-1).content, "Three rooms please");
  const staffReply = detail.body.transcript.find((event: any) => event.actor === "AGENT");
  assert.equal(staffReply.authorName, "Wanjiku Kamau");
  assert.equal(staffReply.delivery.status, "sent");

  // Handed back: Zaina answers again.
  assert.equal((await api("POST", `/v1/staff/businesses/acme/sessions/${chat.id}/release`, undefined, agentToken)).status, 200);
  await webhook(text(customer, "TEST:ask Is breakfast included?").payload);
  await eventually(() => /breakfast/i.test(repliesTo(customer).at(-1) ?? ""), "Zaina answered after the hand-back");
});

test("nobody claims a waiting chat: everyone is alerted, then Zaina takes it back and arranges a callback", async () => {
  const customer = nextCustomer();
  await webhook(text(customer, "TEST:escalate Please call me").payload);
  const chat = await eventually(async () => {
    const row = await chatOf(customer);
    return row?.managed_by === "HUMAN" && row;
  }, "handed over");
  const pushesBefore = platform.log("push").length;
  const emailsBefore = platform.log("emails").length;

  // Minutes pass without anyone claiming it.
  await platform.db.query("update chat_sessions set routed_at = now() - interval '5 minutes' where id = $1", [chat.id]);
  await eventually(() => platform.log("push").slice(pushesBefore).some((push) => push.endpoint === "https://push.example/otieno-phone"), "the owner was alerted too");
  assert.ok(await eventually(() => platform.log("emails").slice(emailsBefore).some((entry) => /still waiting/.test(entry.subject)), "an email to everyone"));

  await platform.db.query("update chat_sessions set handoff_at = now() - interval '30 minutes' where id = $1", [chat.id]);
  await eventually(async () => (await chatOf(customer)).managed_by === "AI", "back with Zaina");
  const reply = await eventually(() => repliesTo(customer).find((line) => /team is busy/.test(line)), "the customer was told on WhatsApp");
  assert.doesNotMatch(reply, /phone number or email/, "on WhatsApp the team already has their number");
  const callbacks = await api("GET", "/v1/staff/businesses/acme/sessions?filter=callbacks", undefined, agentToken);
  assert.ok(callbacks.body.sessions.some((row: any) => row.id === chat.id));
});

test("after 24 hours the team's reply waits behind the approved follow-up template", async () => {
  const set = await api("PUT", "/v1/staff/businesses/acme/whatsapp", {
    phone_number_id: ACME_NUMBER_ID, waba_id: ACME_WABA_ID, followup_template: "reply_waiting", followup_template_language: "en", followup_template_parameter: "business_name",
  }, ownerToken);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.connection.followup_template, "reply_waiting");

  const customer = nextCustomer();
  await webhook(text(customer, "Hello").payload);
  await eventually(() => repliesTo(customer).length > 0, "first reply");
  const chat = await chatOf(customer);
  await platform.db.query("update chat_sessions set customer_last_message_at = now() - interval '25 hours' where id = $1", [chat.id]);

  const answered = await api("POST", `/v1/staff/businesses/acme/sessions/${chat.id}/messages`, { message: "Sorry for the slow reply! Your room is ready." }, agentToken);
  assert.equal(answered.status, 201);
  assert.equal(answered.body.delivery, "window_closed");
  const template = sentTo(customer).find((entry) => entry.kind === "template");
  assert.deepEqual(template.template, { name: "reply_waiting", language: "en", parameters: ["Acme Guesthouse"] });
  assert.equal(repliesTo(customer).length, 1, "the reply itself waits");
  const detail = await api("GET", `/v1/staff/businesses/acme/sessions/${chat.id}`, undefined, agentToken);
  assert.equal(detail.body.session.window.open, false);
  assert.equal(detail.body.transcript.find((event: any) => event.actor === "AGENT").delivery.status, "waiting");
  assert.equal(detail.body.followups.length, 1);

  // Another reply doesn't send the template twice.
  await api("POST", `/v1/staff/businesses/acme/sessions/${chat.id}/messages`, { message: "We can also arrange airport pickup." }, agentToken);
  assert.equal(sentTo(customer).filter((entry) => entry.kind === "template").length, 1);

  // The customer answers the template: the waiting replies go out, in order.
  await webhook(text(customer, "Oh great, thanks").payload);
  await eventually(() => repliesTo(customer).includes("*Wanjiku*: We can also arrange airport pickup."), "the waiting replies were delivered");
  const lines = repliesTo(customer);
  assert.ok(lines.indexOf("*Wanjiku*: Sorry for the slow reply! Your room is ready.") < lines.indexOf("*Wanjiku*: We can also arrange airport pickup."));
});

test("Meta's window error puts the reply back behind the template; busy and broken numbers are handled in order", async () => {
  // Meta says the window has closed even though our clock says it's open.
  const closed = "254700000047";
  await webhook(text(closed, "Hi there").payload);
  const template = await eventually(() => sentTo(closed).find((entry) => entry.kind === "template"), "the follow-up template");
  assert.equal(template.template.name, "reply_waiting");
  assert.equal(repliesTo(closed).length, 0);
  const closedChat = await chatOf(closed);
  const detail = await api("GET", `/v1/staff/businesses/acme/sessions/${closedChat.id}`, undefined, agentToken);
  assert.equal(detail.body.session.window.open, false, "the console agrees with Meta");

  // Rate limited twice: the reply goes out on a later try, not lost.
  const throttled = "254700000429";
  await webhook(text(throttled, "Hello!").payload);
  await eventually(() => repliesTo(throttled).length > 0, "delivered after Meta stopped throttling", 12000);

  // Never deliverable: recorded as failed and skipped, the chat isn't stuck.
  const broken = "254700000026";
  await webhook(text(broken, "Hello!").payload);
  const failed = await eventually(async () => (await platform.db.query(
    "select o.status, o.error_code from whatsapp_outbound o join chat_sessions s on s.id = o.session_id where s.customer_address = $1",
    [broken],
  )).rows[0], "the failure was recorded");
  assert.deepEqual(failed, { status: "failed", error_code: 131026 });
  const brokenChat = await chatOf(broken);
  const lastZaina = (await platform.db.query("select max(id) as id from chat_events where session_id = $1 and actor = 'ZAINA_REASONING'", [brokenChat.id])).rows[0].id;
  assert.equal(String(brokenChat.delivered_event_id), String(lastZaina), "moved past it");
});

test("a number over the shared limits gets no more answers until the window passes", async () => {
  const customer = nextCustomer();
  await webhook(text(customer, "Message 1").payload);
  await eventually(() => repliesTo(customer).length === 1, "the first message was answered");
  const chat = await chatOf(customer);
  // This chat has used its six messages for this minute (and the next, so the test can't straddle a window).
  await platform.db.query(
    `insert into rate_limit_counters (key, window_start, count)
     select $1, to_timestamp(floor(extract(epoch from now()) / 60) * 60 + offset_seconds), 6 from unnest(array[0, 60]) as offset_seconds
     on conflict (key, window_start) do update set count = 6`,
    [`messages:session:${chat.id}`],
  );
  await webhook(text(customer, "Message 2").payload);
  await eventually(async () => (await platform.db.query("select 1 from whatsapp_inbound where session_id = $1 and status = 'ignored'", [chat.id])).rows.length === 1, "the message was refused");
  await sleep(800);
  assert.equal(repliesTo(customer).length, 1, "no answer beyond the limit");
  const metric = (await platform.db.query("select outcome from turn_metrics where session_id = $1 order by id desc limit 1", [chat.id])).rows[0];
  assert.equal(metric.outcome, "rate_limited", "the refusal is measured");
});

test("a customer's data is found and deleted by their WhatsApp number", async () => {
  const customer = nextCustomer();
  await webhook(text(customer, "Please delete my data after this").payload);
  await eventually(() => repliesTo(customer).length > 0, "a reply");
  const local = `0${customer.slice(3)}`;
  const erased = await api("POST", "/v1/staff/businesses/acme/erase", { phone: local }, ownerToken);
  assert.equal(erased.status, 200);
  assert.ok(erased.body.deleted_conversations >= 1);
  assert.equal(await chatOf(customer), undefined);
});

test("the console signs in with a cookie that page scripts can't read, and the cookie alone isn't enough", async () => {
  const signIn = await fetch(`${platform.base}/v1/console/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "wanjiku@example.com", password: PASSWORD }),
  });
  assert.equal(signIn.status, 200);
  const cookie = signIn.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^zaina_console=st1\./);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  const body = (await signIn.json()) as any;
  assert.equal(body.token, undefined, "the token isn't in the page's reach");
  const jar = cookie.split(";")[0];

  const withoutHeader = await fetch(`${platform.base}/v1/console/me`, { headers: { cookie: jar } });
  assert.equal(withoutHeader.status, 401, "a request another site could forge is refused");
  const me = await fetch(`${platform.base}/v1/console/me`, { headers: { cookie: jar, "x-zaina-console": "1" } });
  assert.equal(me.status, 200);
  const profile = (await me.json()) as any;
  assert.equal(profile.user.email, "wanjiku@example.com");
  assert.deepEqual(profile.businesses, [{ businessId: "acme", businessName: "Acme Guesthouse", role: "agent", businessType: "guesthouse", businessStatus: "active", pauseReason: null }]);
  assert.equal(profile.push.public_key, vapid.publicKey);
  assert.equal(profile.push.devices, 1);

  const inbox = await fetch(`${platform.base}/v1/staff/businesses/acme/sessions?filter=everything`, { headers: { cookie: jar, "x-zaina-console": "1" } });
  assert.equal(inbox.status, 200);
  const out = await fetch(`${platform.base}/v1/console/session`, { method: "DELETE", headers: { cookie: jar } });
  assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("the website widget's settings: look, greeting, and only the business's own websites", async () => {
  const updated = await api("PATCH", "/v1/staff/businesses/acme/settings", { widgetColor: "#1D4ED8", widgetPosition: "left", widgetGreeting: "Karibu Acme! Ask me anything about your stay." }, ownerToken);
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal((await api("PATCH", "/v1/staff/businesses/acme/settings", { widgetColor: "blue" }, ownerToken)).status, 400);
  const key = (await api("GET", "/v1/staff/businesses/acme/operations", undefined, ownerToken)).body.public_key;

  const config = await fetch(`${platform.base}/v1/widget/config?key=${key}`, { headers: { origin: ACME_ORIGIN } });
  assert.equal(config.status, 200);
  assert.deepEqual(await config.json(), {
    name: "Acme Guesthouse", assistant_name: "Zaina", color: "#1d4ed8", position: "left",
    greeting: "Karibu Acme! Ask me anything about your stay.", currency: "USD",
  });
  assert.equal((await fetch(`${platform.base}/v1/widget/config?key=${key}`, { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await fetch(`${platform.base}/v1/widget/config?key=pk_nobody_000000000000`, { headers: { origin: ACME_ORIGIN } })).status, 404);
});

test("hours, time zone and websites: managers run the hours, only an owner changes the websites", async () => {
  const hours = await api("PATCH", "/v1/staff/businesses/acme/operations", { staffed_hours: { days: [1, 2, 3, 4, 5, 6], open: "08:00", close: "20:00" }, unclaimed_timeout_minutes: 15 }, ownerToken);
  assert.equal(hours.status, 200, JSON.stringify(hours.body));
  assert.deepEqual(hours.body.staffed_hours, { days: [1, 2, 3, 4, 5, 6], open: "08:00", close: "20:00" });
  assert.equal(hours.body.unclaimed_timeout_minutes, 15);
  assert.equal((await api("PATCH", "/v1/staff/businesses/acme/operations", { staffed_hours: { days: [9], open: "8", close: "20:00" } }, ownerToken)).status, 400);
  assert.equal((await api("PATCH", "/v1/staff/businesses/acme/operations", { time_zone: "Mars/Olympus" }, ownerToken)).status, 400);
  assert.equal((await api("PATCH", "/v1/staff/businesses/acme/operations", { allowed_origins: ["http://acme.example"] }, ownerToken)).status, 400, "https only");
  assert.equal((await api("PATCH", "/v1/staff/businesses/acme/operations", { staffed_hours: null }, agentToken)).status, 403, "agents can't");

  // A manager changes hours but not websites.
  assert.equal((await api("POST", "/v1/staff/businesses/acme/members", { email: "manager@example.com", name: "Mary Manager", password: PASSWORD, role: "manager" }, ownerToken)).status, 201);
  const managerToken = await tokenFor("manager@example.com");
  assert.equal((await api("PATCH", "/v1/staff/businesses/acme/operations", { staffed_hours: null }, managerToken)).status, 200);
  const websites = await api("PATCH", "/v1/staff/businesses/acme/operations", { allowed_origins: [ACME_ORIGIN, "https://book.acme.example"] }, managerToken);
  assert.equal(websites.status, 403);
  const owner = await api("PATCH", "/v1/staff/businesses/acme/operations", { allowed_origins: [ACME_ORIGIN, "https://book.acme.example/"] }, ownerToken);
  assert.deepEqual(owner.body.allowed_origins, [ACME_ORIGIN, "https://book.acme.example"]);

  // Alert emails can be turned off per person.
  const off = await api("PATCH", "/v1/staff/businesses/acme/members/me", { alert_email: false }, agentToken);
  assert.deepEqual(off.body, { alert_email: false });
  await api("PATCH", "/v1/staff/businesses/acme/members/me", { alert_email: true }, agentToken);
});

test("the report shows chats by channel, handoffs and how fast they were picked up, and cost", async () => {
  assert.equal((await api("GET", "/v1/staff/businesses/acme/reports?days=7", undefined, agentToken)).status, 403, "reports are for managers");
  const report = await api("GET", "/v1/staff/businesses/acme/reports?days=7", undefined, ownerToken);
  assert.equal(report.status, 200, JSON.stringify(report.body));
  const body = report.body;
  assert.ok(body.chats.whatsapp >= 8, `WhatsApp chats counted (${body.chats.whatsapp})`);
  assert.equal(body.chats.web, 0);
  assert.equal(body.chats.total, body.chats.web + body.chats.whatsapp);
  assert.ok(body.handoffs.total >= 2);
  assert.ok(body.handoffs.claimed >= 1);
  assert.equal(body.handoffs.claimedWithin15Minutes, body.handoffs.claimed, "the claimed chat was picked up at once");
  assert.ok(body.handoffs.callbacks >= 1);
  assert.ok(body.resolvedWithoutStaff.chats >= 5);
  assert.ok(body.zaina.replies >= 5);
  assert.ok(body.cost.inputTokens > 0);
  assert.ok(body.cost.costUsd > 0);
  assert.equal(body.daily.length, 7);
  assert.ok(body.daily.at(-1).chats >= 8, "today's chats");
  assert.equal(body.timeZone, "Africa/Nairobi");
});

test("the platform overview shows every business's day, and only to platform admins", async () => {
  assert.equal((await api("GET", "/v1/platform/overview", undefined, ownerToken)).status, 403);
  const overview = await api("GET", "/v1/platform/overview", undefined, opsToken);
  assert.equal(overview.status, 200);
  const acme = overview.body.businesses.find((business: any) => business.id === "acme");
  assert.equal(acme.whatsapp, true);
  assert.ok(acme.tokens_today > 0);
  assert.equal(acme.daily_token_cap, 5_000_000);
  assert.ok(acme.chats_7d >= 8);
  assert.deepEqual(overview.body.platform, { whatsapp: true, web_push: true, alert_email: true, public_base_url: `http://127.0.0.1:${PORT}` });
  const beta = overview.body.businesses.find((business: any) => business.id === "beta");
  assert.equal(beta.whatsapp, false);
  assert.equal(beta.chats_7d, 0, "nothing of Acme's counted for Beta");
});

test("Acme's WhatsApp stays Acme's: another business's staff see none of it", async () => {
  const everything = await api("GET", "/v1/staff/businesses/beta/sessions?filter=everything", undefined, betaToken);
  assert.equal(everything.status, 200);
  assert.deepEqual(everything.body.sessions, []);
  assert.equal((await api("GET", "/v1/staff/businesses/acme/whatsapp", undefined, betaToken)).status, 404);
  const beta = await api("GET", "/v1/staff/businesses/beta/whatsapp", undefined, betaToken);
  assert.equal(beta.body.connection, null);
  // A disconnected number stops routing to the business.
  assert.equal((await api("DELETE", "/v1/staff/businesses/acme/whatsapp", undefined, ownerToken)).status, 200);
  const customer = nextCustomer();
  await webhook(text(customer, "Anyone there?").payload);
  await sleep(1000);
  assert.equal(await chatOf(customer), undefined, "no business answers a number nobody has connected");
});

test("the widget script loads on any website; the console is served with a strict content policy", async () => {
  const script = await fetch(`${platform.base}/widget.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);
  assert.equal(script.headers.get("access-control-allow-origin"), "*");
  assert.equal(script.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.match(await script.text(), /data-key/);

  const redirect = await fetch(`${platform.base}/console`, { redirect: "manual" });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "/console/");
  const page = await fetch(`${platform.base}/console/`);
  assert.equal(page.status, 200);
  const policy = page.headers.get("content-security-policy") ?? "";
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.match(await page.text(), /<div id="root">/);
  assert.equal((await fetch(`${platform.base}/console/sw.js`)).headers.get("service-worker-allowed"), "/console/");

  // A business's website may call the chat from the browser; another website may not.
  const allowed = await fetch(`${platform.base}/v1/chat`, {
    method: "OPTIONS",
    headers: { origin: ACME_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), ACME_ORIGIN);
  assert.doesNotMatch(allowed.headers.get("access-control-allow-headers") ?? "", /x-zaina-console/, "the console's header can't come from a website");
  const other = await fetch(`${platform.base}/v1/chat`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});
