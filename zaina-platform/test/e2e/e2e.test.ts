// End-to-end: the platform server with the TBM connector, the scripted model
// (scripted-model.mjs) and two local test databases:
//   PLATFORM_TEST_DATABASE_URL  wiped and migrated (name must end in _test)
//   TBM_TEST_DATABASE_URL       a copy of TBM's schema; tbm-seed.sql replaces
//                               its listings and bookings (name must end in _test)
// Both must be on this machine. Run: npm run test:e2e (from zaina-platform/).

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const PLATFORM_DB = process.env.PLATFORM_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/zaina_platform_test";
const TBM_DB = process.env.TBM_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tbm_test";
for (const url of [PLATFORM_DB, TBM_DB]) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test")) {
    throw new Error(`Refusing to run against ${parsed.hostname}${parsed.pathname}: test databases must be local and end in _test`);
  }
}

const PORT = 5072;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "e2e-admin-token-long-enough-123";
const ORIGIN = "https://tembeabilamatata.com";
const TURN_BUDGET_MS = 6000;
const work = mkdtempSync(path.join(tmpdir(), "zaina-e2e-"));
const EMAIL_LOG = path.join(work, "emails.log");

let server: ChildProcess;
let serverOutput = "";
const platform = new pg.Pool({ connectionString: PLATFORM_DB, max: 2 });
const tbm = new pg.Pool({ connectionString: TBM_DB, max: 2 });
const one = async (pool: pg.Pool, sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

type Chat = { token: string; sessionId: string; ip: string };
let ipCounter = 10;
const nextIp = () => `10.0.0.${ipCounter++}`;

async function openChat(ip = nextIp(), currency = "KES"): Promise<Chat> {
  const response = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": ip },
    body: JSON.stringify({ business_key: "pk_tbm_live", display_currency: currency }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const body = (await response.json()) as any;
  return { token: body.token, sessionId: body.session_id, ip };
}

async function send(chat: Chat, message: string): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(`${BASE}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${chat.token}`, origin: ORIGIN, "x-forwarded-for": chat.ip },
    body: JSON.stringify({ message }),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function say(chat: Chat, message: string): Promise<string> {
  const { status, body } = await send(chat, message);
  assert.equal(status, 200, JSON.stringify(body));
  return body.reply;
}

async function staff(method: string, route: string, body?: unknown, token = ADMIN): Promise<{ status: number; body: any }> {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "x-agent-id": "agent-amina", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

const emails = () => readFileSync(EMAIL_LOG, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const session = (id: string) => one(platform, "select * from chat_sessions where id = $1", [id]);
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  await platform.query("drop schema public cascade; create schema public;");
  await tbm.query(readFileSync(path.join(HERE, "tbm-seed.sql"), "utf8"));
  writeFileSync(EMAIL_LOG, "");
  server = spawn(process.execPath, ["--import", path.join(HERE, "scripted-model.mjs"), "--import", "tsx", "zaina-platform/src/server.ts"], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      PLATFORM_DATABASE_URL: PLATFORM_DB,
      TBM_DATABASE_URL: TBM_DB,
      SESSION_TOKEN_SECRET: "e2e-session-secret-long-enough-1234567890",
      PLATFORM_ADMIN_TOKEN: ADMIN,
      GEMINI_API_KEY: "scripted",
      MIGRATE_ON_START: "true",
      TURN_BUDGET_MS: String(TURN_BUDGET_MS),
      HANDOFF_SWEEP_INTERVAL_MS: "500",
      BUSINESS_CACHE_MS: "100",
      LIMIT_SESSION_MESSAGES_PER_MINUTE: "6",
      LIMIT_VISITOR_SESSIONS_PER_HOUR: "4",
      MODEL_PRICE_INPUT_USD_PER_MTOK: "0.1",
      MODEL_PRICE_OUTPUT_USD_PER_MTOK: "0.4",
      APP_BASE_URL: "https://tembeabilamatata.com",
      NOTIFICATION_EMAILS: "ops@example.com",
      RESEND_API_KEY: "re_scripted",
      RESEND_FROM_EMAIL: "zaina@example.com",
      FAKE_EMAIL_LOG: EMAIL_LOG,
      FAKE_USD_TO_KES: "129.24",
      SCRIPTED_SLOW_MS: "15000",
      SCRIPTED_SLOW_REPLY_MS: "1500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr?.on("data", (chunk) => { serverOutput += chunk; });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/v1/health`)).ok) return;
    } catch {}
    await settle(250);
  }
  throw new Error(`The platform didn't start:\n${serverOutput}`);
});

after(async () => {
  server?.kill("SIGTERM");
  await platform.end();
  await tbm.end();
});

test("health says nothing about the model", async () => {
  const body = (await (await fetch(`${BASE}/v1/health`)).json()) as any;
  assert.equal(body.ok, true);
  assert.doesNotMatch(JSON.stringify(body), /gemini|model/i);
});

test("opening a chat: the business's key and websites only, a few per visitor", async () => {
  const open = (key: string, origin?: string, ip = "10.9.9.9") => fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(origin ? { origin } : {}) },
    body: JSON.stringify({ business_key: key }),
  });
  assert.equal((await open("pk_unknown", ORIGIN)).status, 404);
  assert.equal((await open("pk_tbm_live", "https://evil.example")).status, 403);
  const ok = await open("pk_tbm_live", ORIGIN);
  assert.equal(ok.status, 201);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  const statuses = [];
  for (let i = 0; i < 4; i += 1) statuses.push((await open("pk_tbm_live", ORIGIN)).status);
  assert.deepEqual(statuses, [201, 201, 201, 429], "four chats an hour per visitor in this test setup");
});

test("a message needs the chat's signed token", async () => {
  const chat = await openChat();
  const noToken = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
  assert.equal(noToken.status, 401);
  const forged = await send({ ...chat, token: `${chat.token.slice(0, -2)}xx` }, "hi");
  assert.equal(forged.status, 401);
  const sessionIdOnly = await send({ ...chat, token: chat.sessionId }, "hi");
  assert.equal(sessionIdOnly.status, 401);
});

test("a greeting is answered, measured, and the team hears about the new chat", async () => {
  const chat = await openChat();
  assert.equal(await say(chat, "Hi"), "Karibu! How can I help you plan your Coast trip?");
  const metrics = await one(platform, "select * from turn_metrics where session_id = $1", [chat.sessionId]);
  assert.equal(metrics.outcome, "answered");
  assert.equal(metrics.model_calls, 1);
  assert.ok(metrics.input_tokens > 1000, `input tokens ${metrics.input_tokens}`);
  await settle();
  assert.ok(emails().some((email) => /New conversation/.test(email.subject) && email.text.includes(chat.sessionId)));
});

test("search results come from TBM's listings, priced at the live rate, with unsafe text removed", async () => {
  const chat = await openChat();
  const reply = await say(chat, "TEST:search");
  assert.match(reply, /Studio Apartment – Sunset Complex, Diani/);
  assert.match(reply, /KSh 4,523\/night/, "35 USD at 129.24");
  assert.match(reply, /https:\/\/tembeabilamatata\.com\/accommodation\/stay-diani-studio/);
  assert.doesNotMatch(reply, /evil\.example|0799111222|javascript:/);
});

let bookedChat: Chat;
let bookingId: string;

test("a booking uses only the contact details the customer typed", async () => {
  bookedChat = await openChat();
  const asked = await say(bookedChat, "TEST:book_stay");
  assert.equal(asked, "May I have your full name and email address for the booking? The confirmation and payment link go there.");
  assert.equal((await one(tbm, "select count(*)::int as n from bookings where guest_email = 'jane@example.com'")).n, 0);

  await say(bookedChat, "I'm Jane Wanjiru, jane@example.com, 0712345678");
  const booked = await say(bookedChat, "TEST:book_stay");
  assert.match(booked, /Total: KSh/);
  const link = /https:\/\/tembeabilamatata\.com\/bookings\?bookingId=([0-9a-f-]{36})/.exec(booked);
  assert.ok(link, booked);
  bookingId = link![1];
  const booking = await one(tbm, "select * from bookings where id = $1", [bookingId]);
  assert.equal(booking.guest_email, "jane@example.com");
  assert.equal(booking.guest_phone, "0712345678");
  assert.equal(booking.accommodation_id, "stay-nyali-2br");

  // Asking again replays the same booking.
  const again = await say(bookedChat, "TEST:book_stay");
  assert.match(again, new RegExp(bookingId));
  assert.equal((await one(tbm, "select count(*)::int as n from bookings where guest_email = 'jane@example.com'")).n, 1);
});

test("an M-Pesa code sent in the chat is recorded against the booking and holds its dates", async () => {
  const reply = await say(bookedChat, "Card didn't work so I sent it via M-Pesa, code QGH7X8Y9Z1");
  assert.match(reply, /passed M-Pesa code QGH7X8Y9Z1 to our team to match with booking [0-9A-F]{8} \(KSh [\d,]+\)/);
  assert.match(reply, /Your dates are held while they check/);
  const booking = await one(tbm, "select * from bookings where id = $1", [bookingId]);
  assert.equal(booking.payment_status, "processing");
  assert.equal(booking.payment_provider, "mpesa-manual");
  assert.equal(booking.payment_reference, "QGH7X8Y9Z1");
  assert.ok(new Date(booking.payment_hold_expires_at).getTime() > Date.now() + 23 * 3600_000, "held for the team's review");
  const message = await one(tbm, "select message from booking_messages where booking_id = $1", [bookingId]);
  assert.match(message.message, /M-Pesa code: QGH7X8Y9Z1/);
  const claim = await one(platform, "select * from payment_claims where code = 'QGH7X8Y9Z1'");
  assert.equal(claim.session_id, bookedChat.sessionId);
  const metrics = await one(platform, "select outcome, model_calls from turn_metrics where session_id = $1 order by id desc limit 1", [bookedChat.sessionId]);
  assert.deepEqual(metrics, { outcome: "mpesa_recorded", model_calls: 0 });

  assert.match(await say(bookedChat, "Sent the mpesa: QGH7X8Y9Z1"), /I already have M-Pesa code QGH7X8Y9Z1/);
});

test("held dates can't be booked by another chat, and a reused code isn't recorded twice", async () => {
  const other = await openChat();
  await say(other, "Jane Wanjiru here, jane@example.com, 0712345678");
  const refused = await say(other, "TEST:book_stay");
  assert.doesNotMatch(refused, /bookingId=/, "the stay's dates are held for the M-Pesa review");

  const carChat = await openChat();
  await say(carChat, "It's Jane Wanjiru, jane@example.com, 0712345678");
  assert.match(await say(carChat, "TEST:book_car"), /bookingId=/);
  const reused = await say(carChat, "Paid by M-Pesa, code QGH7X8Y9Z1");
  assert.match(reused, /already been used for another booking/);
  const car = await one(tbm, "select payment_status from bookings where selected_services @> array['car-noah'] and guest_email = 'jane@example.com'");
  assert.notEqual(car.payment_status, "processing");
});

test("a phone number or an email is not mistaken for a payment code", async () => {
  const chat = await openChat();
  await say(chat, "Jane Wanjiru, jane@example.com, 0712345678");
  await say(chat, "TEST:book_car");
  const reply = await say(chat, "I sent the details, my number is 0712345678 and email john123456@example.com");
  assert.doesNotMatch(reply, /M-Pesa code/);
});

test("two messages at once: the second is told Zaina is still working (I3)", async () => {
  const chat = await openChat();
  const slow = send(chat, "TEST:slow_reply");
  await settle(300);
  const second = await send(chat, "and also, is there parking?");
  assert.equal(second.status, 409);
  assert.equal(second.body.status, "busy");
  assert.match(second.body.reply, /still working on your last message/);
  const first = await slow;
  assert.equal(first.status, 200);
  assert.match(first.body.reply, /a little slowly/);
});

test("a slow model can't hold a turn past its budget (I4)", async () => {
  const chat = await openChat();
  const started = Date.now();
  const reply = await say(chat, "TEST:slow");
  const took = Date.now() - started;
  assert.equal(reply, "Sorry, that took longer than it should. Could you send your message again?");
  assert.ok(took < TURN_BUDGET_MS + 2000, `took ${took} ms`);
  const row = await session(chat.sessionId);
  assert.equal(row.managed_by, "AI");
  assert.equal(row.consecutive_failures, 1);
  assert.equal((await one(platform, "select outcome from turn_metrics where session_id = $1", [chat.sessionId])).outcome, "timeout");
});

test("one model error asks for a retry; three in a row hand over (C4b)", async () => {
  const chat = await openChat();
  const retry = "Sorry, I couldn't answer that just now. Could you send your message again?";
  assert.equal(await say(chat, "TEST:model_error"), retry);
  assert.equal((await session(chat.sessionId)).managed_by, "AI");
  assert.equal(await say(chat, "TEST:model_error"), retry);
  const third = await send(chat, "TEST:model_error");
  assert.equal(third.body.escalated, true);
  assert.match(third.body.reply, /asked someone from our team to take over/);
  assert.equal((await session(chat.sessionId)).managed_by, "HUMAN");
  await settle();
  assert.ok(emails().some((email) => /system error/i.test(email.subject) && email.text.includes(chat.sessionId)));
});

test("a working turn resets the failure count", async () => {
  const chat = await openChat();
  await say(chat, "TEST:model_error");
  await say(chat, "Hi");
  assert.equal((await session(chat.sessionId)).consecutive_failures, 0);
});

test("a booking made just before the model fails still reaches the customer", async () => {
  const chat = await openChat();
  await say(chat, "Jane Wanjiru, jane@example.com, 0712345678");
  const reply = await say(chat, "TEST:book_crash");
  assert.match(reply, /Your request was saved/);
  assert.match(reply, /bookingId=[0-9a-f-]{36}/);
});

test("handoff while staffed: staff claim, reply, and hand back to Zaina (C4c)", async () => {
  const chat = await openChat();
  await say(chat, "Hi");
  const handedOver = await send(chat, "TEST:escalate");
  assert.equal(handedOver.body.escalated, true);
  assert.equal((await session(chat.sessionId)).managed_by, "HUMAN");
  await settle();
  assert.ok(emails().some((email) => /Handoff requested/.test(email.subject)));

  const waiting = await staff("GET", "/v1/staff/businesses/tbm/sessions?filter=waiting");
  assert.ok(waiting.body.sessions.some((row: any) => row.id === chat.sessionId));
  assert.equal((await send(chat, "Hello? Anyone there?")).body.status, "human_managed");

  assert.equal((await staff("POST", `/v1/staff/sessions/${chat.sessionId}/claim`)).status, 200);
  assert.equal((await staff("POST", `/v1/staff/sessions/${chat.sessionId}/messages`, { message: "Hi, Amina here from TBM. How can I help?" })).status, 201);
  const messages = (await (await fetch(`${BASE}/v1/chat/messages`, { headers: { authorization: `Bearer ${chat.token}` } })).json()) as any;
  assert.deepEqual(messages.messages.at(-1), { ...messages.messages.at(-1), from: "team", text: "Hi, Amina here from TBM. How can I help?" });
  assert.equal(messages.messages.some((message: any) => /Customer asked|internal/.test(message.text)), false, "no internal notes");

  assert.equal((await staff("POST", `/v1/staff/sessions/${chat.sessionId}/release`)).status, 200);
  assert.equal(await say(chat, "Thanks! Back to planning"), "Karibu! How can I help you plan your Coast trip?");
});

test("outside staffed hours the customer gets a time, not a wait (C4c)", async () => {
  const now = new Date();
  const kenyaHour = Number(now.toLocaleString("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", hourCycle: "h23" }));
  const openAt = `${String((kenyaHour + 2) % 24).padStart(2, "0")}:00`;
  const closeAt = `${String((kenyaHour + 3) % 24).padStart(2, "0")}:00`;
  await platform.query("update businesses set staffed_hours = $1 where id = 'tbm'", [JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], open: openAt, close: closeAt })]);
  await settle(300); // business settings are cached briefly
  try {
    const chat = await openChat();
    await say(chat, "Hi, I'm Amina, amina@example.com");
    const reply = await say(chat, "TEST:escalate");
    assert.match(reply, /Our team is offline right now — they're back at \d{1,2}:00 [AP]M \(Kenya time\)/);
    assert.doesNotMatch(reply, /phone number or email/, "she already gave her email");
    const row = await session(chat.sessionId);
    assert.equal(row.managed_by, "AI");
    assert.ok(row.callback_requested_at);
    await settle();
    assert.ok(emails().some((email) => /Call the customer back — team offline/.test(email.subject)));
  } finally {
    await platform.query("update businesses set staffed_hours = $1 where id = 'tbm'", [JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], open: "00:00", close: "23:59" })]);
    await settle(300);
  }
});

test("a handoff nobody claims goes back to Zaina with a callback (C4c)", async () => {
  const chat = await openChat();
  await say(chat, "Hi");
  await send(chat, "TEST:escalate");
  await platform.query("update chat_sessions set handoff_at = now() - interval '11 minutes' where id = $1", [chat.sessionId]);
  await settle(1500);
  assert.equal((await session(chat.sessionId)).managed_by, "AI");
  const messages = (await (await fetch(`${BASE}/v1/chat/messages`, { headers: { authorization: `Bearer ${chat.token}` } })).json()) as any;
  assert.match(messages.messages.at(-1).text, /Sorry for the wait/);
  assert.match(messages.messages.at(-1).text, /phone number or email/);
  const callbacks = await staff("GET", "/v1/staff/businesses/tbm/sessions?filter=callbacks");
  assert.ok(callbacks.body.sessions.some((row: any) => row.id === chat.sessionId));
});

test("a business over its daily model budget gets its contact line, and one alert (C6)", async () => {
  await platform.query("update businesses set daily_token_cap = 1 where id = 'tbm'");
  await settle(300);
  try {
    const chat = await openChat();
    const reply = await say(chat, "Hi");
    assert.match(reply, /can't reply to messages here right now, but our team can help: WhatsApp or call/);
    await say(chat, "Hello?");
    const metrics = await platform.query("select outcome, model_calls from turn_metrics where session_id = $1", [chat.sessionId]);
    assert.deepEqual(metrics.rows.map((row) => [row.outcome, row.model_calls]), [["spend_capped", 0], ["spend_capped", 0]]);
    await settle();
    assert.equal(emails().filter((email) => /today's model budget/.test(email.subject)).length, 1);
  } finally {
    await platform.query("update businesses set daily_token_cap = 30000000 where id = 'tbm'");
    await settle(300);
  }
});

test("too many messages in a minute are refused before any model call (C6)", async () => {
  const chat = await openChat();
  const statuses = [];
  for (let i = 0; i < 7; i += 1) statuses.push((await send(chat, "Hi")).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429]);
  const refused = await send(chat, "Hi");
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  const turns = await one(platform, "select count(*) filter (where model_calls > 0)::int as answered from turn_metrics where session_id = $1", [chat.sessionId]);
  assert.equal(turns.answered, 6);
});

test("staff and admin routes need the admin token", async () => {
  assert.equal((await staff("GET", "/v1/staff/businesses/tbm/sessions", undefined, "wrong-token")).status, 401);
  assert.equal((await staff("GET", "/v1/admin/businesses/tbm/metrics", undefined, "")).status, 401);
});

test("the report gives cost per conversation and how turns ended (I15)", async () => {
  const report = (await staff("GET", "/v1/admin/businesses/tbm/metrics?days=1")).body;
  for (const outcome of ["answered", "tool_reply", "busy", "timeout", "model_error", "handoff", "callback", "mpesa_recorded", "spend_capped", "rate_limited", "human_managed"]) {
    assert.ok(report.outcomes[outcome] > 0, `no "${outcome}" turns in ${JSON.stringify(report.outcomes)}`);
  }
  assert.ok(report.perTurn.inputTokens > 1000);
  assert.ok(report.perConversation.costUsd > 0);
  assert.ok(report.latencyMs.p95 >= report.latencyMs.p50);
});

test("a customer's conversations are deleted on request (I17)", async () => {
  const before = await one(platform, "select count(*)::int as n from chat_sessions where business_id = 'tbm'");
  const erased = (await staff("POST", "/v1/admin/businesses/tbm/erase", { email: "jane@example.com" })).body;
  assert.ok(erased.deleted_conversations >= 5);
  const after = await one(platform, "select count(*)::int as n from chat_sessions where business_id = 'tbm'");
  assert.equal(after.n, before.n - erased.deleted_conversations);
  const left = await one(platform, "select count(*)::int as n from chat_events where actor = 'USER' and content ilike '%jane@example.com%'");
  assert.equal(left.n, 0);
});
