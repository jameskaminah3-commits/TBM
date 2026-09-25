// Database checks for the platform's own tables. They need an empty Postgres
// database whose name ends in "_test" (PLATFORM_TEST_DATABASE_URL); it is
// wiped and migrated from scratch.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";
import { registerConnector } from "../../src/connectors/registry.ts";
import type { BusinessConnector, TeamEvent } from "../../src/connectors/types.ts";
import { clearBusinessCache } from "../../src/businesses/registry.ts";
import {
  claimSession,
  closeSession,
  releaseSession,
  requestHandoff,
  sweepUnclaimedHandoffs,
} from "../../src/conversations/handoff.ts";
import { deleteExpiredConversations, eraseCustomer } from "../../src/conversations/retention.ts";
import {
  appendEvent,
  createSession,
  customerMessages,
  customerVisibleEvents,
  getSession,
  toolErrorResponses,
  toolSuccesses,
} from "../../src/conversations/store.ts";
import { closePlatformDb, initPlatformDb, platformPool } from "../../src/db/platform-db.ts";
import type { Business } from "../../src/db/schema.ts";
import { migrate, pendingMigrations, readMigrations } from "../../src/db/migrate.ts";
import { CARD_NUMBER_PLACEHOLDER } from "../../src/engine/redaction.ts";
import { recordTurn, summarizeTurns, TurnRecorder } from "../../src/engine/telemetry.ts";
import { acquireTurnLock, releaseTurnLock } from "../../src/engine/turn-lock.ts";
import { consumeLimits } from "../../src/gateway/rate-limit.ts";
import { claimCapAlert, isOverCap, recordUsage, usageOn } from "../../src/gateway/spend-cap.ts";

const TEST_DB = process.env.PLATFORM_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/zaina_platform_test";
if (!new URL(TEST_DB).pathname.endsWith("_test")) {
  throw new Error("PLATFORM_TEST_DATABASE_URL must name a database ending in _test: it is wiped");
}

const events: TeamEvent[] = [];
const testConnector: BusinessConnector = {
  systemPrompt: () => "test",
  toolDeclarations: () => [],
  readOnlyTools: new Set(),
  executeTool: async () => ({ ok: true }),
  notifyTeam: async (_business, event) => { events.push(event); },
  contactLine: () => "WhatsApp +254 700 000 000",
};

let business: Business;
const ALWAYS = { days: [0, 1, 2, 3, 4, 5, 6], open: "00:00", close: "23:59" };

async function setBusiness(fields: Record<string, unknown>) {
  const sets = Object.keys(fields).map((key, index) => `${key} = $${index + 2}`).join(", ");
  const { rows } = await platformPool().query(`update businesses set ${sets} where id = $1 returning *`, ["acme", ...Object.values(fields)]);
  clearBusinessCache();
  const row = rows[0];
  business = {
    ...business,
    staffedHours: row.staffed_hours,
    unclaimedTimeoutMinutes: row.unclaimed_timeout_minutes,
    retentionDays: row.retention_days,
    dailyTokenCap: row.daily_token_cap === null ? null : Number(row.daily_token_cap),
  };
}

before(async () => {
  const admin = new pg.Pool({ connectionString: TEST_DB, max: 1 });
  await admin.query("drop schema public cascade; create schema public;");
  await admin.end();
  initPlatformDb(TEST_DB, { max: 5 });
  const applied = await migrate(platformPool());
  assert.deepEqual(applied, readMigrations().map((migration) => migration.version));
  await platformPool().query(
    `insert into businesses (id, name, public_key, allowed_origins, staffed_hours, unclaimed_timeout_minutes, daily_token_cap, retention_days)
     values ('acme', 'Acme Guesthouse', 'pk_acme', '{https://acme.example}', $1, 10, 1000, 90)`,
    [JSON.stringify(ALWAYS)],
  );
  const { rows } = await platformPool().query("select * from businesses where id = 'acme'");
  business = {
    id: "acme", name: "Acme Guesthouse", status: "active", publicKey: "pk_acme", allowedOrigins: ["https://acme.example"],
    timeZone: "Africa/Nairobi", staffedHours: ALWAYS, unclaimedTimeoutMinutes: 10, dailyTokenCap: 1000, retentionDays: 90,
    createdAt: rows[0].created_at, updatedAt: rows[0].updated_at,
  };
  registerConnector("acme", testConnector);
});

beforeEach(() => {
  events.length = 0;
});

after(async () => {
  await closePlatformDb();
});

test("migrations run once, in order, and a changed one is refused", async () => {
  assert.deepEqual(await pendingMigrations(platformPool()), []);
  assert.deepEqual(await migrate(platformPool()), []);
  const tampered = readMigrations().map((migration, index) => (index === 0 ? { ...migration, checksum: "changed" } : migration));
  await assert.rejects(() => pendingMigrations(platformPool(), tampered), /changed after it ran/);
  const { rows } = await platformPool().query("select id, name from businesses where id = 'tbm'");
  assert.equal(rows[0]?.name, "Tembea Bila Matata");
});

test("rate limits are shared: every instance sees the same counters", async () => {
  const other = new pg.Pool({ connectionString: TEST_DB, max: 1 });
  const rule = { key: "messages:session:shared-test", limit: 3, windowSeconds: 60 };
  const now = new Date("2026-09-25T10:00:10Z");
  assert.equal((await consumeLimits(platformPool(), [rule], now)).allowed, true);
  assert.equal((await consumeLimits(other, [rule], now)).allowed, true);
  assert.equal((await consumeLimits(platformPool(), [rule], now)).allowed, true);
  const refused = await consumeLimits(other, [rule], now);
  assert.equal(refused.allowed, false);
  assert.equal(!refused.allowed && refused.retryAfterSeconds, 50);
  // The next window starts fresh.
  assert.equal((await consumeLimits(platformPool(), [rule], new Date("2026-09-25T10:01:01Z"))).allowed, true);
  await other.end();
});

test("the tightest of several limits decides", async () => {
  const now = new Date("2026-09-25T11:00:00Z");
  const rules = [
    { key: "messages:session:s1", limit: 20, windowSeconds: 60 },
    { key: "messages:visitor:v1", limit: 2, windowSeconds: 600 },
  ];
  assert.equal((await consumeLimits(platformPool(), rules, now)).allowed, true);
  assert.equal((await consumeLimits(platformPool(), rules, now)).allowed, true);
  const refused = await consumeLimits(platformPool(), [{ ...rules[0], key: "messages:session:s2" }, rules[1]], now);
  assert.equal(refused.allowed, false);
  assert.equal(!refused.allowed && refused.rule.key, "messages:visitor:v1");
});

test("one turn at a time per conversation; a dead turn's lease runs out", async () => {
  const session = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  const first = await acquireTurnLock(platformPool(), session.id, 30_000);
  assert.ok(first);
  assert.equal(await acquireTurnLock(platformPool(), session.id, 30_000), null);
  await releaseTurnLock(platformPool(), session.id, randomUUID());
  assert.equal(await acquireTurnLock(platformPool(), session.id, 30_000), null);
  await releaseTurnLock(platformPool(), session.id, first!);
  const second = await acquireTurnLock(platformPool(), session.id, 1);
  assert.ok(second);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(await acquireTurnLock(platformPool(), session.id, 30_000), "an expired lease can be taken");
});

test("daily model budget: usage adds up and the team is alerted once", async () => {
  const day = "2026-09-25";
  await recordUsage(platformPool(), "acme", day, { inputTokens: 600, outputTokens: 100 });
  await recordUsage(platformPool(), "acme", day, { inputTokens: 250, outputTokens: 50 });
  const usage = await usageOn(platformPool(), "acme", day);
  assert.deepEqual(usage, { inputTokens: 850, outputTokens: 150, turns: 2 });
  assert.equal(isOverCap(usage, 1000), true);
  assert.equal(await claimCapAlert(platformPool(), "acme", day), true);
  assert.equal(await claimCapAlert(platformPool(), "acme", day), false);
});

test("messages are stored without card numbers, and the customer sees only the chat", async () => {
  const session = await createSession("acme", { displayCurrency: "KES", visitorKey: "v" });
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "USER", content: "card 4111 1111 1111 1111 please" });
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "SYSTEM_TOOL", toolName: "create_custom_offer", toolResponse: { ok: false, error: "request_details_missing", missing_details: ["dates"] } });
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "SYSTEM_TOOL", toolName: "create_custom_offer", toolResponse: { ok: true, booking_id: "b-1" } });
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "SYSTEM", content: "internal note" });
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "ZAINA_REASONING", content: "Karibu" });
  assert.deepEqual(await customerMessages(session.id), [`card ${CARD_NUMBER_PLACEHOLDER} please`]);
  assert.equal((await toolErrorResponses(session.id, "create_custom_offer", "request_details_missing")).length, 1);
  assert.equal((await toolSuccesses(session.id, ["create_custom_offer"]))[0]?.response.booking_id, "b-1");
  const visible = await customerVisibleEvents(session.id, 0);
  assert.deepEqual(visible.map((event) => event.actor), ["USER", "ZAINA_REASONING"]);
  assert.deepEqual((await customerVisibleEvents(session.id, visible[0].id)).map((event) => event.content), ["Karibu"]);
});

test("a handoff while staff are on waits for a person; claim, reply, hand back, close", async () => {
  const session = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  const result = await requestHandoff(business, session.id, "Customer asked for a person");
  assert.equal(result.status, "escalated");
  assert.equal((await getSession(session.id))?.managedBy, "HUMAN");
  assert.equal((await requestHandoff(business, session.id, "again")).status, "already_escalated");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.map((event) => event.kind), ["handoff"]);

  assert.equal((await claimSession(session.id, "agent-1"))?.assignedAgentId, "agent-1");
  const released = await releaseSession(session.id, "agent-1");
  assert.equal(released?.managedBy, "AI");
  assert.equal(released?.assignedAgentId, null);
  assert.equal(await releaseSession(session.id, "agent-1"), undefined, "only a chat with staff can be handed back");
  assert.equal((await closeSession(session.id))?.managedBy, "CLOSED");
});

test("outside staffed hours the customer isn't left waiting", async () => {
  await setBusiness({ staffed_hours: JSON.stringify({ days: [1, 2, 3, 4, 5], open: "08:00", close: "17:00" }) });
  const session = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  // Saturday 26 Sept, 10:00 in Nairobi.
  const saturday = new Date("2026-09-26T10:00:00+03:00");
  const result = await requestHandoff(business, session.id, "Wants a discount", saturday);
  assert.equal(result.status, "callback");
  assert.match(result.status === "callback" ? result.tellCustomer : "", /back on Monday at 8:00 AM \(Kenya time\).*phone number or email/);
  const after = await getSession(session.id);
  assert.equal(after?.managedBy, "AI");
  assert.ok(after?.callbackRequestedAt);
  await new Promise((resolve) => setImmediate(resolve));
  const callback = events.find((event) => event.kind === "callback");
  assert.equal(callback?.kind === "callback" && callback.why, "offline");

  // Having typed an email, the customer isn't asked for one.
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "USER", content: "It's amina@example.com" });
  const again = await requestHandoff(business, session.id, "Wants a discount", saturday);
  assert.doesNotMatch(again.status === "callback" ? again.tellCustomer : "", /phone number or email/);
  await setBusiness({ staffed_hours: JSON.stringify(ALWAYS) });
});

test("a handoff nobody claims goes back to Zaina with a callback", async () => {
  const waiting = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  const claimed = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  const fresh = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  for (const session of [waiting, claimed, fresh]) await requestHandoff(business, session.id, "Needs help");
  await claimSession(claimed.id, "agent-2");
  await platformPool().query("update chat_sessions set handoff_at = now() - interval '11 minutes' where id = any($1::uuid[])", [[waiting.id, claimed.id]]);

  const handedBack = await sweepUnclaimedHandoffs();
  assert.deepEqual(handedBack, [waiting.id]);
  assert.equal((await getSession(waiting.id))?.managedBy, "AI");
  assert.equal((await getSession(claimed.id))?.managedBy, "HUMAN");
  assert.equal((await getSession(fresh.id))?.managedBy, "HUMAN");
  const visible = await customerVisibleEvents(waiting.id, 0);
  assert.match(visible.at(-1)?.content ?? "", /Sorry for the wait/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.filter((event) => event.kind === "callback" && event.why === "unclaimed").length, 1);
});

test("old conversations are deleted; telemetry stays without them", async () => {
  const old = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  const recent = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  await appendEvent({ businessId: "acme", sessionId: old.id, actor: "USER", content: "hello from long ago" });
  await recordTurn(platformPool(), "acme", old.id, new TurnRecorder().finish("answered"));
  await platformPool().query("update chat_sessions set last_activity_at = now() - interval '91 days' where id = $1", [old.id]);

  assert.ok((await deleteExpiredConversations()) >= 1);
  assert.equal(await getSession(old.id), undefined);
  assert.ok(await getSession(recent.id));
  const { rows } = await platformPool().query("select count(*)::int as n from turn_metrics where session_id is null and business_id = 'acme'");
  assert.ok(rows[0].n >= 1);
});

test("a customer's conversations are deleted on request, by email or phone", async () => {
  const byEmail = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  const byPhone = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  const someoneElse = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  await appendEvent({ businessId: "acme", sessionId: byEmail.id, actor: "USER", content: "I'm Brian, Brian.M@Example.com" });
  await appendEvent({ businessId: "acme", sessionId: byPhone.id, actor: "USER", content: "call +254 722 555 111" });
  await appendEvent({ businessId: "acme", sessionId: someoneElse.id, actor: "USER", content: "I'm Chege, chege@example.com, 0733 000 111" });

  assert.equal(await eraseCustomer("acme", { email: "brian.m@example.com", phone: "0722555111" }), 2);
  assert.equal(await getSession(byEmail.id), undefined);
  assert.equal(await getSession(byPhone.id), undefined);
  assert.ok(await getSession(someoneElse.id));
  assert.equal(await eraseCustomer("tbm", { email: "chege@example.com" }), 0, "another business's customers are untouched");
});

test("the telemetry summary gives cost per conversation", async () => {
  const session = await createSession("acme", { displayCurrency: "USD", visitorKey: null });
  const turn = new TurnRecorder();
  turn.addModelCall(900, { inputTokens: 18_000, outputTokens: 200, cachedTokens: 0 });
  turn.addModelCall(700, { inputTokens: 19_000, outputTokens: 100, cachedTokens: 0 });
  await recordTurn(platformPool(), "acme", session.id, turn.finish("answered"));
  await recordTurn(platformPool(), "acme", session.id, new TurnRecorder().finish("busy"));
  const summary = await summarizeTurns(
    platformPool(),
    "acme",
    { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) },
    { input: 0.1, output: 0.4 },
  );
  assert.equal(summary.outcomes.answered >= 1, true);
  assert.equal(summary.outcomes.busy >= 1, true);
  assert.ok(summary.perConversation.costUsd !== null && summary.perConversation.costUsd > 0);
});
