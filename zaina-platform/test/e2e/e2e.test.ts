// End-to-end: the platform server with the TBM connector, the scripted model
// (scripted-model.mjs) and two local test databases:
//   PLATFORM_TEST_DATABASE_URL  wiped and migrated (name must end in _test)
//   TBM_TEST_DATABASE_URL       a copy of TBM's schema; tbm-seed.sql replaces
//                               its listings and bookings (name must end in _test)
// Both must be on this machine. Run: npm run test:e2e (from zaina-platform/).
//
// TBM runs as in Phase 0; a second business (Acme Guesthouse) is added
// through the platform's API and must stay apart from TBM throughout.

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { issueSessionToken } from "../../src/gateway/session-token.ts";

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
const SESSION_SECRET = "e2e-session-secret-long-enough-1234567890";
// Local test accounts only.
const PASSWORD = "LocalTest#2026";
const ORIGIN = "https://tembeabilamatata.com";
const ACME_ORIGIN = "https://acme.example";
const TURN_BUDGET_MS = 6000;
const work = mkdtempSync(path.join(tmpdir(), "zaina-e2e-"));
const EMAIL_LOG = path.join(work, "emails.log");
const MODEL_LOG = path.join(work, "model-calls.log");

let server: ChildProcess;
let serverOutput = "";
const platform = new pg.Pool({ connectionString: PLATFORM_DB, max: 2 });
const tbm = new pg.Pool({ connectionString: TBM_DB, max: 2 });
const one = async (pool: pg.Pool, sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

type Chat = { token: string; sessionId: string; ip: string; origin: string };
let ipCounter = 10;
const nextIp = () => `10.0.0.${ipCounter++}`;

function openSession(key: string, origin: string | undefined, ip: string, currency = "KES") {
  return fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(origin ? { origin } : {}) },
    body: JSON.stringify({ business_key: key, display_currency: currency }),
  });
}

async function openChat(ip = nextIp(), currency = "KES", key = "pk_tbm_live", origin = ORIGIN): Promise<Chat> {
  const response = await openSession(key, origin, ip, currency);
  assert.equal(response.status, 201, await response.clone().text());
  const body = (await response.json()) as any;
  return { token: body.token, sessionId: body.session_id, ip, origin };
}

async function send(chat: Chat, message: string): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(`${BASE}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${chat.token}`, origin: chat.origin, "x-forwarded-for": chat.ip },
    body: JSON.stringify({ message }),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function say(chat: Chat, message: string): Promise<string> {
  const { status, body } = await send(chat, message);
  assert.equal(status, 200, JSON.stringify(body));
  return body.reply;
}

async function chatMessages(chat: Chat): Promise<any[]> {
  const response = await fetch(`${BASE}/v1/chat/messages`, { headers: { authorization: `Bearer ${chat.token}` } });
  return ((await response.json()) as any).messages;
}

// Staff: Ops runs the platform; Amina answers TBM's chats; Otieno owns Acme.
let opsToken = "";
let agentToken = "";
let acmeOwnerToken = "";
let acmeKey = "";

async function staff(method: string, route: string, body?: unknown, token = agentToken): Promise<{ status: number; body: any }> {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

function signIn(email: string, password = PASSWORD, ip = "10.8.0.1") {
  return fetch(`${BASE}/v1/staff/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  });
}

async function tokenFor(email: string, password = PASSWORD): Promise<string> {
  const response = await signIn(email, password);
  assert.equal(response.status, 200, await response.clone().text());
  return ((await response.json()) as any).token;
}

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const emails = () => readFileSync(EMAIL_LOG, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const modelCalls = () => readFileSync(MODEL_LOG, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const session = (id: string) => one(platform, "select * from chat_sessions where id = $1", [id]);
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  await platform.query("drop schema public cascade; create schema public;");
  await tbm.query(readFileSync(path.join(HERE, "tbm-seed.sql"), "utf8"));
  writeFileSync(EMAIL_LOG, "");
  writeFileSync(MODEL_LOG, "");
  server = spawn(process.execPath, ["--import", path.join(HERE, "scripted-model.mjs"), "--import", "tsx", "zaina-platform/src/server.ts"], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      PLATFORM_DATABASE_URL: PLATFORM_DB,
      TBM_DATABASE_URL: TBM_DB,
      SESSION_TOKEN_SECRET: SESSION_SECRET,
      PLATFORM_SECRETS_KEY: randomBytes(32).toString("base64"),
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
      FAKE_GEMINI_LOG: MODEL_LOG,
      FAKE_USD_TO_KES: "129.24",
      SCRIPTED_SLOW_MS: "15000",
      SCRIPTED_SLOW_REPLY_MS: "1500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr?.on("data", (chunk) => { serverOutput += chunk; });
  let started = false;
  for (let attempt = 0; attempt < 80 && !started; attempt += 1) {
    try {
      started = (await fetch(`${BASE}/v1/health`)).ok;
    } catch {}
    if (!started) await settle(250);
  }
  if (!started) throw new Error(`The platform didn't start:\n${serverOutput}`);
  // TBM is staffed 07:00–22:00 Kenya time: staffed all day here, so the run
  // doesn't depend on the clock. The test for off hours sets its own.
  await platform.query("update businesses set staffed_hours = $1 where id = 'tbm'", [JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], open: "00:00", close: "23:59" })]);

  // The first platform admin is made on the command line, as in production…
  const created = spawnSync(
    process.execPath,
    ["--import", "tsx", "zaina-platform/src/cli/create-staff.ts", "--email", "ops@example.com", "--name", "Ops", "--platform-admin"],
    { cwd: REPO, env: { ...process.env, PLATFORM_DATABASE_URL: PLATFORM_DB, STAFF_PASSWORD: PASSWORD }, encoding: "utf8" },
  );
  assert.equal(created.status, 0, created.stderr + created.stdout);
  opsToken = await tokenFor("ops@example.com");
  // …who adds TBM's first agent.
  const added = await staff("POST", "/v1/staff/businesses/tbm/members", { email: "amina@example.com", name: "Amina", password: PASSWORD, role: "agent" }, opsToken);
  assert.equal(added.status, 201, JSON.stringify(added.body));
  agentToken = await tokenFor("amina@example.com");

  // TBM's knowledge, imported as at every release.
  const imported = spawnSync(
    process.execPath,
    ["--import", "tsx", "zaina-platform/src/cli/import-knowledge.ts", "--business", "tbm", "--dir", "zaina-platform/knowledge/tbm"],
    { cwd: REPO, env: { ...process.env, PLATFORM_DATABASE_URL: PLATFORM_DB }, encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr + imported.stdout);
});

after(async () => {
  // E2E_SERVER_LOG=<file> keeps the server's output for a look afterwards.
  if (process.env.E2E_SERVER_LOG) writeFileSync(process.env.E2E_SERVER_LOG, serverOutput);
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

  const claimed = await staff("POST", `/v1/staff/businesses/tbm/sessions/${chat.sessionId}/claim`);
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.session.assignedAgentId, "Amina <amina@example.com>", "the chat records who took it");
  assert.equal((await staff("POST", `/v1/staff/businesses/tbm/sessions/${chat.sessionId}/messages`, { message: "Hi, Amina here from TBM. How can I help?" })).status, 201);
  const messages = await chatMessages(chat);
  assert.deepEqual(messages.at(-1), { ...messages.at(-1), from: "team", text: "Hi, Amina here from TBM. How can I help?" });
  assert.equal(messages.some((message: any) => /Customer asked|internal/.test(message.text)), false, "no internal notes");

  assert.equal((await staff("POST", `/v1/staff/businesses/tbm/sessions/${chat.sessionId}/release`)).status, 200);
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
    assert.match(reply, /Our team is offline right now — they're back (tomorrow )?at \d{1,2}:00 [AP]M \(Kenya time\)/);
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
  const messages = await chatMessages(chat);
  assert.match(messages.at(-1).text, /Sorry for the wait/);
  assert.match(messages.at(-1).text, /phone number or email/);
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

// ── Phase 1: staff accounts, a second business, and separation ─────────

test("staff sign in with their own password; wrong ones are refused, then slowed", async () => {
  const wrong = await signIn("amina@example.com", "not-her-password-1");
  const unknown = await signIn("nobody@example.com", "any-password-123");
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json(), "the same answer whether or not the account exists");

  const me = await staff("GET", "/v1/staff/me");
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.user, { ...me.body.user, email: "amina@example.com", name: "Amina", is_platform_admin: false });
  assert.doesNotMatch(JSON.stringify(me.body), /scrypt|password/i);
  assert.deepEqual(me.body.businesses, [{ businessId: "tbm", businessName: "Tembea Bila Matata", role: "agent", businessType: "travel_concierge", businessStatus: "active", pauseReason: null }]);

  // Ten tries per account every 15 minutes, whichever addresses they come from.
  const statuses = [];
  for (let attempt = 0; attempt < 11; attempt += 1) statuses.push((await signIn("guess@example.com", `Guess-${attempt}-password`, `10.7.0.${attempt}`)).status);
  assert.deepEqual(statuses, [...Array(10).fill(401), 429]);
});

test("staff routes need a staff sign-in and a role in that business", async () => {
  assert.equal((await staff("GET", "/v1/staff/businesses/tbm/sessions", undefined, "wrong-token")).status, 401);
  assert.equal((await staff("GET", "/v1/staff/businesses/tbm/sessions", undefined, "")).status, 401);
  const chat = await openChat();
  assert.equal((await staff("GET", "/v1/staff/businesses/tbm/sessions", undefined, chat.token)).status, 401, "a chat token isn't a staff token");
  // Amina answers chats; reports, deletion requests and the platform need more.
  assert.equal((await staff("GET", "/v1/staff/businesses/tbm/sessions?filter=all")).status, 200);
  assert.equal((await staff("GET", "/v1/staff/businesses/tbm/metrics")).status, 403);
  assert.equal((await staff("POST", "/v1/staff/businesses/tbm/erase", { email: "x@example.com" })).status, 403);
  assert.equal((await staff("GET", "/v1/platform/businesses")).status, 403);
  // The Phase 0 shared admin token and its routes are gone.
  assert.equal((await staff("GET", "/v1/admin/businesses/tbm/metrics", undefined, "e2e-admin-token-long-enough-123")).status, 404);
});

test("the platform adds a second business, with its first owner, in one step", async () => {
  const request = {
    id: "acme",
    name: "Acme Guesthouse",
    allowed_origins: [ACME_ORIGIN],
    owner: { email: "otieno@example.com", name: "Otieno", password: PASSWORD },
  };
  assert.equal((await staff("POST", "/v1/platform/businesses", request)).status, 403, "only platform admins");
  const created = await staff("POST", "/v1/platform/businesses", request, opsToken);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  acmeKey = created.body.business.public_key;
  assert.match(acmeKey, /^pk_acme_[0-9a-f]{12}$/);
  assert.equal(created.body.business.daily_token_cap, 5_000_000, "a new business starts with a model budget");
  assert.equal(created.body.business.business_type, "general");
  const concierge = await staff("POST", "/v1/platform/businesses", { ...request, id: "coast-trips", business_type: "travel_concierge" }, opsToken);
  assert.equal(concierge.status, 400, "a travel concierge needs its own connector first");
  assert.equal(concierge.body.error, "connector_required");
  assert.equal(created.body.business.retention_days, 90);
  assert.equal((await staff("POST", "/v1/platform/businesses", request, opsToken)).status, 409);
  const listed = await staff("GET", "/v1/platform/businesses", undefined, opsToken);
  assert.deepEqual(listed.body.businesses.map((business: any) => business.id).sort(), ["acme", "tbm"]);

  acmeOwnerToken = await tokenFor("otieno@example.com");
  const me = await staff("GET", "/v1/staff/me", undefined, acmeOwnerToken);
  assert.deepEqual(me.body.businesses, [{ businessId: "acme", businessName: "Acme Guesthouse", role: "owner", businessType: "general", businessStatus: "active", pauseReason: null }]);
  const settings = await staff("PATCH", "/v1/staff/businesses/acme/settings", {
    about: "Acme Guesthouse: six rooms in Watamu, breakfast included.",
    contactPhone: "+254700111222",
    contactPhoneDisplay: "+254 700 111 222",
    websiteUrl: "https://acme.example",
  }, acmeOwnerToken);
  assert.equal(settings.status, 200, JSON.stringify(settings.body));
  assert.equal(settings.body.settings.contactPhone, "+254700111222");
});

test("Acme's chat runs on Acme's instructions and tools, and keeps Acme's leads", async () => {
  const chat = await openChat(nextIp(), "KES", acmeKey, ACME_ORIGIN);
  assert.equal(
    await say(chat, "TEST:whoami"),
    "You are Zaina, the assistant for Acme Guesthouse, answering customers in a chat on its website. Tools: create_lead, search_knowledge, escalate_to_human.",
  );
  assert.doesNotMatch(await say(await openChat(), "TEST:whoami"), /Acme/, "TBM's chats are TBM's");

  await say(chat, "I'm Jane Wanjiru, jane@example.com");
  assert.equal(await say(chat, "TEST:lead"), "Tool said: ok");
  const leads = await staff("GET", "/v1/staff/businesses/acme/leads", undefined, acmeOwnerToken);
  assert.deepEqual(
    leads.body.leads.map((lead: any) => [lead.name, lead.email, lead.interest, lead.sessionId]),
    [["Jane Wanjiru", "jane@example.com", "December family trip to Diani", chat.sessionId]],
  );
  // Settings changes reach the next reply.
  await staff("PATCH", "/v1/staff/businesses/acme/settings", { assistantName: "Amani" }, acmeOwnerToken);
  assert.match(await say(chat, "TEST:whoami"), /^You are Amani, the assistant for Acme Guesthouse/);
});

test("each business's own links and numbers are the ones Zaina may pass on", async () => {
  const text = "Call +254 700 111 222 or +254 718 475 264. See https://acme.example/rooms or https://tembeabilamatata.com/stays.";
  const acmeChat = await openChat(nextIp(), "KES", acmeKey, ACME_ORIGIN);
  assert.equal(
    await say(acmeChat, `TEST:say64 ${base64(text)}`),
    "Call +254 700 111 222 or (number removed). See https://acme.example/rooms or (link removed).",
  );
  const tbmChat = await openChat();
  assert.equal(
    await say(tbmChat, `TEST:say64 ${base64(text)}`),
    "Call (number removed) or +254 718 475 264. See (link removed) or https://tembeabilamatata.com/stays.",
  );
});

test("one business's staff can't reach another's chats, and chat keys stay with their websites", async () => {
  const tbmChat = await openChat();
  await say(tbmChat, "Hi");
  const acmeChat = await openChat(nextIp(), "KES", acmeKey, ACME_ORIGIN);
  await say(acmeChat, "Hi");

  // To Acme's owner, TBM doesn't exist…
  for (const route of ["sessions?filter=all", "pending-count", "settings", "leads", "members", `sessions/${tbmChat.sessionId}`]) {
    assert.equal((await staff("GET", `/v1/staff/businesses/tbm/${route}`, undefined, acmeOwnerToken)).status, 404, route);
  }
  // …and TBM's chats aren't found through Acme's routes either.
  const acmeRoute = `/v1/staff/businesses/acme/sessions/${tbmChat.sessionId}`;
  assert.equal((await staff("GET", acmeRoute, undefined, acmeOwnerToken)).status, 404);
  assert.equal((await staff("POST", `${acmeRoute}/claim`, undefined, acmeOwnerToken)).status, 404);
  assert.equal((await staff("POST", `${acmeRoute}/messages`, { message: "Hello from another business" }, acmeOwnerToken)).status, 404);
  assert.equal((await staff("POST", `${acmeRoute}/close`, undefined, acmeOwnerToken)).status, 404);
  assert.equal((await staff("DELETE", acmeRoute, undefined, acmeOwnerToken)).status, 404);
  const acmeList = await staff("GET", "/v1/staff/businesses/acme/sessions?filter=all", undefined, acmeOwnerToken);
  assert.equal(acmeList.status, 200);
  assert.ok(acmeList.body.sessions.every((row: any) => row.businessId === "acme"));
  // TBM's agent can't see Acme's.
  assert.equal((await staff("GET", "/v1/staff/businesses/acme/sessions?filter=all")).status, 404);
  assert.equal((await session(tbmChat.sessionId)).managed_by, "AI", "TBM's chat untouched");
  assert.equal((await chatMessages(tbmChat)).length, 2);

  // Each widget key works only from its own business's website.
  assert.equal((await openSession(acmeKey, ORIGIN, nextIp())).status, 403);
  assert.equal((await openSession("pk_tbm_live", ACME_ORIGIN, nextIp())).status, 403);
  // Even a validly signed chat token naming Acme can't reach a TBM chat: the database hides it.
  const crossed = { ...acmeChat, token: issueSessionToken(SESSION_SECRET, { sessionId: tbmChat.sessionId, businessId: "acme" }) };
  assert.equal((await send(crossed, "Hi")).status, 404);
  assert.deepEqual(await chatMessages(crossed), []);
  assert.equal((await chatMessages(tbmChat)).length, 2);
});

test("roles decide who changes settings, people and secrets", async () => {
  const acme = (method: string, route: string, body?: unknown, token = acmeOwnerToken) => staff(method, `/v1/staff/businesses/acme/${route}`, body, token);
  assert.equal((await acme("POST", "members", { email: "wanjiku@example.com", name: "Wanjiku", password: PASSWORD, role: "agent" })).status, 201);
  assert.equal((await acme("POST", "members", { email: "baraka@example.com", name: "Baraka", password: PASSWORD, role: "manager" })).status, 201);
  const agent = await tokenFor("wanjiku@example.com");
  const manager = await tokenFor("baraka@example.com");

  // An agent answers chats, but can't change settings or see which secrets exist.
  assert.equal((await acme("GET", "sessions", undefined, agent)).status, 200);
  assert.equal((await acme("GET", "settings", undefined, agent)).status, 200);
  assert.equal((await acme("PATCH", "settings", { about: "changed" }, agent)).status, 403);
  assert.equal((await acme("GET", "secrets", undefined, agent)).status, 403);
  // A manager changes settings and adds agents, but not managers or owners.
  assert.equal((await acme("PATCH", "settings", { contactPhone: "0712345678" }, manager)).status, 400, "numbers are checked");
  assert.equal((await acme("PATCH", "settings", { about: "Six rooms in Watamu." }, manager)).status, 200);
  assert.equal((await acme("POST", "members", { email: "juma@example.com", name: "Juma", password: PASSWORD, role: "owner" }, manager)).status, 403);
  assert.equal((await acme("POST", "members", { email: "juma@example.com", name: "Juma", password: PASSWORD, role: "viewer" }, manager)).status, 201);
  assert.equal((await acme("POST", "members", { email: "short@example.com", name: "Short", password: "short", role: "viewer" }, manager)).status, 400);

  // Secrets: only an owner sets them, and nobody reads them back.
  assert.equal((await acme("PUT", "secrets/whatsapp_token", { value: "wa-secret-value-123" }, manager)).status, 403);
  assert.equal((await acme("PUT", "secrets/whatsapp_token", { value: "wa-secret-value-123" })).status, 200);
  const secrets = await acme("GET", "secrets", undefined, manager);
  assert.deepEqual(secrets.body.secrets.map((secret: any) => secret.name), ["whatsapp_token"]);
  assert.doesNotMatch(JSON.stringify(secrets.body), /wa-secret-value/);
  const stored = await one(platform, "select ciphertext from business_secrets where business_id = 'acme' and name = 'whatsapp_token'");
  assert.equal(stored.ciphertext.toString("utf8").includes("wa-secret-value"), false, "encrypted at rest");
  assert.equal((await staff("GET", "/v1/staff/businesses/tbm/secrets", undefined, opsToken)).body.secrets.length, 0, "TBM has none of Acme's");

  // A business always keeps an owner; removing someone takes effect at once.
  const members = (await acme("GET", "members", undefined, manager)).body.members;
  const id = (email: string) => members.find((member: any) => member.email === email).userId;
  assert.equal((await acme("DELETE", `members/${id("otieno@example.com")}`)).status, 409);
  assert.equal((await acme("DELETE", `members/${id("otieno@example.com")}`, undefined, manager)).status, 403);
  assert.equal((await acme("DELETE", `members/${id("wanjiku@example.com")}`, undefined, manager)).status, 200);
  assert.equal((await acme("GET", "sessions", undefined, agent)).status, 404);
  // Staff lists show only the business's own people.
  assert.deepEqual(
    (await acme("GET", "members", undefined, manager)).body.members.map((member: any) => member.email).sort(),
    ["baraka@example.com", "juma@example.com", "otieno@example.com"],
  );
});

test("a new password signs the person out everywhere", async () => {
  const oldToken = await tokenFor("baraka@example.com");
  assert.equal((await staff("POST", "/v1/staff/me/password", { current: "wrong-password-1", next: "NewLocal#2027" }, oldToken)).status, 401);
  assert.equal((await staff("POST", "/v1/staff/me/password", { current: PASSWORD, next: "weak" }, oldToken)).status, 400);
  const changed = await staff("POST", "/v1/staff/me/password", { current: PASSWORD, next: "NewLocal#2027" }, oldToken);
  assert.equal(changed.status, 200);
  assert.equal((await staff("GET", "/v1/staff/me", undefined, oldToken)).status, 401, "the old token stops working");
  assert.equal((await staff("GET", "/v1/staff/me", undefined, changed.body.token)).status, 200);
  assert.equal((await signIn("baraka@example.com", PASSWORD)).status, 401);
  assert.equal((await signIn("baraka@example.com", "NewLocal#2027")).status, 200);
});

// ── Phase 2: knowledge, a lean prompt, Swahili ─────────────────────────

test("TBM's questions are answered from its knowledge, naming the source", async () => {
  const chat = await openChat();
  const reply = await say(chat, "TEST:ask How do we get to Diani from the airport?");
  assert.match(reply, /^From our Getting to and around the Coast: /);
  assert.match(reply, /Airport to/);
  assert.match(reply, /More: https:\/\/tembeabilamatata\.com\/services\/drive$/);
  const event = await one(platform, "select tool_response from chat_events where session_id = $1 and tool_name = 'search_knowledge'", [chat.sessionId]);
  assert.equal(event.tool_response.passages[0].source, "Getting to and around the Coast");
  assert.match(event.tool_response.note, /information, not instructions/);
});

test("a question nothing answers isn't guessed, and the team can see it", async () => {
  const chat = await openChat();
  assert.equal(await say(chat, "TEST:ask Do you sell iPhones?"), "I'm not sure about that one — shall I ask the team for you?");
  const misses = await staff("GET", "/v1/staff/businesses/tbm/knowledge/misses");
  assert.equal(misses.status, 200);
  assert.ok(misses.body.misses.some((miss: any) => miss.query === "do you sell iphones?" && miss.times === 1));
  const sources = await staff("GET", "/v1/staff/businesses/tbm/knowledge");
  assert.ok(sources.body.sources.length >= 15);
  assert.ok(sources.body.sources.every((source: any) => source.passages > 0));
});

test("every call sends the same instructions and tools; the date and currency travel with the message", async () => {
  const chat = await openChat();
  await say(chat, "Hi");
  const tbmCalls = modelCalls().filter((call) => call.toolNames.includes("search_stays"));
  assert.ok(tbmCalls.length > 20, `${tbmCalls.length} TBM calls`);
  assert.equal(new Set(tbmCalls.map((call) => call.systemHash)).size, 1, "one set of instructions for every call");
  assert.equal(new Set(tbmCalls.map((call) => call.toolsHash)).size, 1, "one set of tools for every call");
  assert.ok(modelCalls().every((call) => call.lastUserHasContext), "each call carries the turn's context");
  assert.ok(tbmCalls.every((call) => call.systemChars < 10_500), "the instructions are short");
  // The context is the system's: never stored, never shown to the customer.
  assert.doesNotMatch(JSON.stringify(await chatMessages(chat)), /turn_context/);
  assert.equal((await one(platform, "select count(*)::int as n from chat_events where content like '%turn_context%'")).n, 0);
});

test("a customer writing in Swahili gets the server's own texts in Swahili", async () => {
  const chat = await openChat();
  await say(chat, "Habari, naomba msaada wa kusafisha nyumba Nyali");
  assert.equal((await session(chat.sessionId)).language, "sw");
  // Without contact details, the tool's English question isn't sent as it is: Zaina asks in Swahili.
  const asked = await send(chat, "TEST:clean");
  assert.notEqual(asked.body.reply, "May I have your full name and email address for the booking? The confirmation and payment link go there.");
  const turn = await one(platform, "select model_calls from turn_metrics where session_id = $1 order by id desc limit 1", [chat.sessionId]);
  assert.equal(turn.model_calls, 2, "the tool's question went back to Zaina");

  await say(chat, "Mimi ni Jane Wanjiru, jane@example.com, 0712345678");
  const booked = await say(chat, "TEST:clean");
  assert.match(booked, /bookingId=[0-9a-f-]{36}/);
  assert.match(booked, /Kinachofuata:/);
  assert.doesNotMatch(booked, /What happens next/);
  const recorded = await say(chat, "Nimetuma malipo kwa M-Pesa, nambari QKL8M9N0P1");
  assert.match(recorded, /^Asante! Nimepeleka nambari ya M-Pesa QKL8M9N0P1 kwa timu yetu/);

  const other = await openChat();
  await say(other, "Habari yako, tunataka kuweka nafasi");
  const slow = send(other, "TEST:slow_reply");
  await settle(300);
  const second = await send(other, "na pia, kuna maegesho?");
  assert.equal(second.status, 409);
  assert.equal(second.body.reply, "Bado ninashughulikia ujumbe wako uliopita — tafadhali tuma huu tena baada ya muda mfupi.");
  await slow;
});

test("Acme's own knowledge answers Acme's customers, and only them", async () => {
  const faq = {
    title: "Guest FAQ",
    url: "https://acme.example/faq",
    faqs: [
      { question: "Can I bring my dog?", answer: "Small dogs are welcome in two of our rooms; tell us in advance." },
      { question: "Is breakfast included?", answer: "Yes, breakfast is included, served 7 to 10 am. Dinner costs KSh 1,500 per person." },
    ],
  };
  const viewer = await tokenFor("juma@example.com");
  assert.equal((await staff("POST", "/v1/staff/businesses/acme/knowledge", faq, viewer)).status, 403, "viewers can't change knowledge");
  const saved = await staff("POST", "/v1/staff/businesses/acme/knowledge", faq, acmeOwnerToken);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual([saved.body.passages, saved.body.hidden_amounts], [2, 1]);
  const checked = await staff("POST", "/v1/staff/businesses/acme/knowledge/search", { query: "dog" }, viewer);
  assert.equal(checked.body.passages[0].title, "Guest FAQ");
  assert.equal((await staff("GET", "/v1/staff/businesses/acme/knowledge")).status, 404, "TBM's staff can't see it");
  assert.equal((await staff("POST", "/v1/staff/businesses/acme/knowledge", { title: "x" }, acmeOwnerToken)).status, 400);

  const chat = await openChat(nextIp(), "KES", acmeKey, ACME_ORIGIN);
  assert.match(await say(chat, "TEST:ask Can I bring my dog?"), /^From our Guest FAQ: Small dogs are welcome in two of our rooms/);
  const breakfast = await say(chat, "TEST:ask Is breakfast included? How much is dinner?");
  assert.match(breakfast, /breakfast is included/);
  assert.doesNotMatch(breakfast, /1,500/, "prices never come from documents");
  assert.match(await say(await openChat(), "TEST:ask Can I bring my dog?"), /not sure/, "TBM doesn't know Acme's answers");
});

test("a deletion request at Acme deletes only Acme's copy of the customer", async () => {
  const tbmBefore = await one(platform, "select count(*)::int as n from chat_sessions where business_id = 'tbm'");
  const erased = await staff("POST", "/v1/staff/businesses/acme/erase", { email: "jane@example.com" }, acmeOwnerToken);
  assert.deepEqual(erased.body, { deleted_conversations: 1, deleted_leads: 1, anonymized_bookings: 0 });
  const tbmAfter = await one(platform, "select count(*)::int as n from chat_sessions where business_id = 'tbm'");
  assert.equal(tbmAfter.n, tbmBefore.n, "Jane's TBM chats are TBM's to delete");
});

test("the report gives cost per conversation and how turns ended (I15)", async () => {
  const report = (await staff("GET", "/v1/staff/businesses/tbm/metrics?days=1", undefined, opsToken)).body;
  for (const outcome of ["answered", "tool_reply", "busy", "timeout", "model_error", "handoff", "callback", "mpesa_recorded", "spend_capped", "rate_limited", "human_managed"]) {
    assert.ok(report.outcomes[outcome] > 0, `no "${outcome}" turns in ${JSON.stringify(report.outcomes)}`);
  }
  assert.ok(report.perTurn.inputTokens > 1000);
  assert.ok(report.perConversation.costUsd > 0);
  assert.ok(report.latencyMs.p95 >= report.latencyMs.p50);
});

test("a customer's conversations are deleted on request (I17)", async () => {
  const before = await one(platform, "select count(*)::int as n from chat_sessions where business_id = 'tbm'");
  const erased = (await staff("POST", "/v1/staff/businesses/tbm/erase", { email: "jane@example.com" }, opsToken)).body;
  assert.ok(erased.deleted_conversations >= 5);
  const after = await one(platform, "select count(*)::int as n from chat_sessions where business_id = 'tbm'");
  assert.equal(after.n, before.n - erased.deleted_conversations);
  const left = await one(platform, "select count(*)::int as n from chat_events where actor = 'USER' and content ilike '%jane@example.com%'");
  assert.equal(left.n, 0);
});
