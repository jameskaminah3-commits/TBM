// Phase 3: channels and the console — the parts that need no database.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { windowClosesAt, windowOpen } from "../../src/channels/whatsapp/delivery.ts";
import { splitMessage, teamReply, toWhatsappText, WHATSAPP_TEXT_LIMIT } from "../../src/channels/whatsapp/format.ts";
import { describeFailure } from "../../src/channels/whatsapp/graph.ts";
import { readDelivery, validSignature, verificationChallenge } from "../../src/channels/whatsapp/webhook.ts";
import { appRolePassword } from "../../src/cli/release.ts";
import { loadConfig } from "../../src/config.ts";
import { validateSettingsPatch } from "../../src/businesses/settings.ts";
import { texts } from "../../src/engine/messages.ts";
import { turnContext } from "../../src/engine/turn-context.ts";
import { parseDisplayAmount } from "../../src/reports/business-report.ts";
import { validateOperationsPatch } from "../../src/staff/routes.ts";

// ── The WhatsApp webhook ──────────────────────────────────────────────

test("a webhook delivery is accepted only with Meta's signature over the exact bytes", () => {
  const secret = "app-secret";
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(validSignature(secret, body, signature), true);
  assert.equal(validSignature(secret, body, signature.toUpperCase().replace("SHA256=", "sha256=")), true, "hex case doesn't matter");
  assert.equal(validSignature(secret, Buffer.from('{"object":"whatsapp_business_account" }'), signature), false, "one changed byte");
  assert.equal(validSignature("other-secret", body, signature), false);
  assert.equal(validSignature(secret, body, undefined), false);
  assert.equal(validSignature(secret, body, "sha1=abc"), false);
});

test("the set-up handshake echoes the challenge only for the right token", () => {
  const query = { "hub.mode": "subscribe", "hub.verify_token": "right-token", "hub.challenge": "8812345" };
  assert.equal(verificationChallenge(query, "right-token"), "8812345");
  assert.equal(verificationChallenge({ ...query, "hub.verify_token": "wrong-token" }, "right-token"), null);
  assert.equal(verificationChallenge({ ...query, "hub.mode": "unsubscribe" }, "right-token"), null);
  assert.equal(verificationChallenge({ ...query, "hub.challenge": "<script>" }, "right-token"), null, "only a plain challenge is echoed");
});

test("a delivery is read per number: text, captions, buttons, locations and contact cards become text", () => {
  const delivery = readDelivery({
    object: "whatsapp_business_account",
    entry: [{
      id: "1",
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "100200300400" },
          contacts: [{ profile: { name: "Jane" }, wa_id: "254712345678" }],
          messages: [
            { from: "254712345678", id: "m1", timestamp: "1700000000", type: "text", text: { body: "Hello" } },
            { from: "254712345678", id: "m2", type: "image", image: { id: "555", mime_type: "image/jpeg", caption: "Is this the house?" } },
            { from: "254712345678", id: "m3", type: "audio", audio: { id: "556", mime_type: "audio/ogg" } },
            { from: "254712345678", id: "m4", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes please" } } },
            { from: "254712345678", id: "m5", type: "location", location: { latitude: -3.35, longitude: 40.01, name: "Watamu" } },
            { from: "254712345678", id: "m6", type: "contacts", contacts: [{ name: { formatted_name: "Agent Ali" }, phones: [{ phone: "+254 700 111 222" }] }] },
            { from: "254712345678", id: "m7", type: "reaction", reaction: { emoji: "👍" } },
            { from: "254712345678", id: "m8", type: "poll" },
            { from: "not-a-number", id: "m9", type: "text", text: { body: "ignored" } },
          ],
          statuses: [
            { id: "wamid.1", status: "read" },
            { id: "wamid.2", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] },
            { id: "wamid.3", status: "bogus" },
          ],
        },
      }, { field: "account_update", value: {} }],
    }],
  });
  assert.equal(delivery.length, 1);
  const [number] = delivery;
  assert.equal(number.phoneNumberId, "100200300400");
  assert.deepEqual(number.messages.map((message) => [message.messageId, message.kind, message.text]), [
    ["m1", "text", "Hello"],
    ["m2", "photo", "Is this the house?"],
    ["m3", "voice", null],
    ["m4", "text", "Yes please"],
    ["m5", "location", "My location: Watamu (-3.35000, 40.01000)"],
    ["m6", "contacts", "Contact card: Agent Ali +254 700 111 222"],
    ["m7", "reaction", null],
    ["m8", "other", null],
  ]);
  assert.equal(number.messages[0].profileName, "Jane");
  assert.equal(number.messages[0].sentAt?.toISOString(), "2023-11-14T22:13:20.000Z");
  assert.deepEqual(number.messages[1].media, { kind: "photo", id: "555", mimeType: "image/jpeg", caption: "Is this the house?", fileName: null });
  assert.deepEqual(number.statuses, [
    { messageId: "wamid.1", status: "read", errorCode: null, errorTitle: null },
    { messageId: "wamid.2", status: "failed", errorCode: 131047, errorTitle: "Re-engagement message" },
  ]);
  assert.deepEqual(readDelivery({ object: "page", entry: [] }), [], "only WhatsApp business accounts");
});

// ── Sending on WhatsApp ───────────────────────────────────────────────

test("replies are shaped for WhatsApp: links, headings and bold", () => {
  assert.equal(
    toWhatsappText("## Your stay\n**Total:** KSh 24,000\n[Pay here](https://pay.example/b-1) or [https://acme.example](https://acme.example)\n\n\n\nThanks"),
    "*Your stay*\n*Total:* KSh 24,000\nPay here: https://pay.example/b-1 or https://acme.example\n\nThanks",
  );
  assert.equal(teamReply("Wanjiku", "Hi Jane"), "*Wanjiku*: Hi Jane");
  assert.equal(teamReply("*Evil*_", "Hi"), "*Evil*: Hi", "a name can't break the formatting");
  assert.equal(teamReply(null, "Hi"), "Hi");
});

test("a long reply is split at paragraph, line or word breaks, never over WhatsApp's limit", () => {
  const paragraph = "Word ".repeat(700).trim();
  const parts = splitMessage(`${paragraph}\n\n${paragraph}`);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((part) => part.length <= WHATSAPP_TEXT_LIMIT));
  assert.equal(parts.join("\n\n"), `${paragraph}\n\n${paragraph}`);
  const words = splitMessage("x".repeat(9000));
  assert.ok(words.every((part) => part.length <= WHATSAPP_TEXT_LIMIT));
  assert.equal(words.join(""), "x".repeat(9000));
  assert.deepEqual(splitMessage("short"), ["short"]);
});

test("Meta's errors are sorted by what to do: retry, wait for the customer, fix the token, or skip", () => {
  const retry = describeFailure(400, { error: { code: 130429, message: "(#130429) Rate limit hit" } });
  assert.equal(retry.retryable, true);
  assert.equal(describeFailure(503, { error: { code: 2, message: "Service temporarily unavailable" } }).retryable, true);
  assert.equal(describeFailure(0, { error: { message: "fetch failed" } }).retryable, true);
  const window = describeFailure(400, { error: { code: 131047, message: "(#131047) Re-engagement message", error_data: { details: "More than 24 hours" } } });
  assert.deepEqual([window.windowClosed, window.retryable], [true, false]);
  assert.match(window.title, /24 hours/);
  const token = describeFailure(401, { error: { code: 190, message: "Invalid OAuth access token" } });
  assert.deepEqual([token.authProblem, token.retryable], [true, false]);
  const skip = describeFailure(400, { error: { code: 131026, message: "Message undeliverable" } });
  assert.deepEqual([skip.retryable, skip.windowClosed, skip.authProblem], [false, false, false]);
});

test("the 24-hour window closes a little early, so Meta's clock never refuses a reply", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  assert.equal(windowOpen(new Date("2026-09-24T12:05:00Z"), now), true);
  assert.equal(windowOpen(new Date("2026-09-24T12:01:00Z"), now), false, "within two minutes of closing counts as closed");
  assert.equal(windowOpen(null, now), false, "a customer who never wrote can't be written to");
  assert.equal(windowClosesAt(new Date("2026-09-24T12:05:00Z"))?.toISOString(), "2026-09-25T12:03:00.000Z");
});

test("on WhatsApp Zaina knows the customer's number and doesn't ask for it; on the website nothing changes", () => {
  const base = { timeZone: "Africa/Nairobi", now: new Date("2026-09-25T09:00:00Z"), currency: "KES", language: "en" as const };
  assert.match(turnContext({ ...base, whatsappNumber: "254712345678" }), /WhatsApp number is \+254712345678: use it when a tool needs their phone number[^\n]*Don't ask for it\./);
  assert.equal(turnContext(base), turnContext({ ...base, whatsappNumber: null }));
  assert.doesNotMatch(turnContext(base), /WhatsApp/);
});

test("media Zaina can't read gets a kind reply, in the customer's language", () => {
  assert.match(texts("en").mediaNotRead("voice"), /voice notes/);
  assert.match(texts("en").mediaNotRead("photo"), /photo/);
  assert.match(texts("sw").mediaNotRead("voice"), /sauti/);
  assert.match(texts("sw").mediaNotRead("other"), /maandishi/);
});

// ── Settings, operations, configuration ───────────────────────────────

test("the widget's settings are checked", () => {
  assert.deepEqual(validateSettingsPatch({ widgetColor: "#1D4ED8", widgetPosition: "left", widgetGreeting: "  Karibu!  " }), {
    ok: true,
    patch: { widgetColor: "#1d4ed8", widgetPosition: "left", widgetGreeting: "Karibu!" },
  });
  assert.deepEqual(validateSettingsPatch({ widgetGreeting: "" }), { ok: true, patch: { widgetGreeting: null } });
  assert.equal(validateSettingsPatch({ widgetColor: "red" }).ok, false);
  assert.equal(validateSettingsPatch({ widgetPosition: "top" }).ok, false);
  assert.equal(validateSettingsPatch({ widgetGreeting: "x".repeat(301) }).ok, false);
});

test("hours, time zones and websites are checked before they reach the directory", () => {
  assert.deepEqual(validateOperationsPatch({ staffed_hours: { days: [5, 1, 1, 3], open: "08:00", close: "20:00" }, unclaimed_timeout_minutes: 15 }), {
    ok: true,
    patch: { staffedHours: { days: [1, 3, 5], open: "08:00", close: "20:00" }, unclaimedTimeoutMinutes: 15 },
  });
  assert.deepEqual(validateOperationsPatch({ staffed_hours: null }), { ok: true, patch: { staffedHours: null } });
  assert.deepEqual(validateOperationsPatch({ allowed_origins: ["https://acme.example/", "HTTPS://ACME.example", "http://localhost:3000"] }), {
    ok: true,
    patch: { allowedOrigins: ["https://acme.example", "http://localhost:3000"] },
  });
  for (const bad of [
    { staffed_hours: { days: [7], open: "08:00", close: "20:00" } },
    { staffed_hours: { days: [1], open: "8:00", close: "20:00" } },
    { staffed_hours: { days: [1], open: "08:00", close: "08:00" } },
    { staffed_hours: { days: [], open: "08:00", close: "20:00" } },
    { unclaimed_timeout_minutes: 1 },
    { time_zone: "Mars/Olympus" },
    { allowed_origins: ["http://acme.example"] },
    { allowed_origins: ["not a website"] },
  ]) {
    assert.equal(validateOperationsPatch(bad).ok, false, JSON.stringify(bad));
  }
});

test("the release step takes the restricted role's password from its address, and nothing weaker", () => {
  assert.equal(appRolePassword("postgresql://zaina_app:s3cret-password-long@db.internal:5432/railway"), "s3cret-password-long");
  assert.equal(appRolePassword("postgresql://zaina_app:p%40ss%2Fword-long-enough@db:5432/x"), "p@ss/word-long-enough");
  assert.throws(() => appRolePassword("postgresql://postgres:s3cret-password-long@db:5432/x"), /must sign in as zaina_app/);
  assert.throws(() => appRolePassword("postgresql://zaina_app:short@db:5432/x"), /at least 16/);
  assert.throws(() => appRolePassword("not a url"), /valid/);
});

test("WhatsApp, phone alerts and alert emails are each on only when fully configured", () => {
  const base = { SESSION_TOKEN_SECRET: "x".repeat(40), PLATFORM_DATABASE_URL: "postgres://localhost/x", GEMINI_API_KEY: "key" };
  const off = loadConfig(base);
  assert.deepEqual([off.whatsapp, off.webPush, off.alertEmail, off.publicBaseUrl], [null, null, null, null]);
  const on = loadConfig({
    ...base,
    WHATSAPP_APP_SECRET: "secret",
    WHATSAPP_VERIFY_TOKEN: "a-long-verify-token",
    WEB_PUSH_PUBLIC_KEY: "public",
    WEB_PUSH_PRIVATE_KEY: "private",
    RESEND_API_KEY: "re_x",
    ALERT_FROM_EMAIL: "alerts@example.com",
    PUBLIC_BASE_URL: "https://zaina.example.com/",
  });
  assert.deepEqual(on.whatsapp, { appSecret: "secret", verifyToken: "a-long-verify-token", graphVersion: "v23.0", batchMs: 2000 });
  assert.equal(on.webPush?.subject, "mailto:alerts@example.com");
  assert.deepEqual(on.alertEmail, { resendApiKey: "re_x", from: "alerts@example.com" });
  assert.equal(on.publicBaseUrl, "https://zaina.example.com");
  assert.throws(() => loadConfig({ ...base, WHATSAPP_APP_SECRET: "secret" }), /both/);
  assert.throws(() => loadConfig({ ...base, WHATSAPP_APP_SECRET: "secret", WHATSAPP_VERIFY_TOKEN: "short" }), /16/);
  assert.throws(() => loadConfig({ ...base, PUBLIC_BASE_URL: "http://zaina.example.com" }), /https/);
  assert.throws(() => loadConfig({ ...base, WEB_PUSH_PUBLIC_KEY: "public" }), /both/);
});

test("amounts in tool results are read for reports, in the currency they were quoted in", () => {
  assert.deepEqual(parseDisplayAmount("KSh 24,000"), { currency: "KES", amount: 24000 });
  assert.deepEqual(parseDisplayAmount("KES 1,500.50"), { currency: "KES", amount: 1500.5 });
  assert.deepEqual(parseDisplayAmount("$186.50"), { currency: "USD", amount: 186.5 });
  assert.deepEqual(parseDisplayAmount("US$ 93"), { currency: "USD", amount: 93 });
  assert.equal(parseDisplayAmount("to be confirmed"), null);
  assert.equal(parseDisplayAmount(undefined), null);
});
