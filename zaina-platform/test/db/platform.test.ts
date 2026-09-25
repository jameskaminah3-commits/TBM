// Database checks for the platform's own tables, and for the separation
// between businesses. They need an empty Postgres database whose name ends
// in "_test" (PLATFORM_TEST_DATABASE_URL); it is wiped and migrated from
// scratch. Two businesses take part: TBM (seeded by the migrations) and
// Acme Guesthouse (created here).

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { businessById, clearBusinessCache } from "../../src/businesses/registry.ts";
import { deleteSecret, getSecret, listSecrets, loadSecretKeys, putSecret, setSecretKeys } from "../../src/businesses/secrets.ts";
import { createBusinessSettings, getBusinessSettings, updateBusinessSettings } from "../../src/businesses/settings.ts";
import { registerConnector } from "../../src/connectors/registry.ts";
import type { BusinessConnector, TeamEvent } from "../../src/connectors/types.ts";
import {
  claimSession,
  closeSession,
  releaseSession,
  requestHandoff,
  sweepUnclaimedHandoffs,
} from "../../src/conversations/handoff.ts";
import { deleteConversation, deleteExpiredConversations, eraseCustomer } from "../../src/conversations/retention.ts";
import {
  appendEvent,
  createSession,
  customerMessages,
  customerVisibleEvents,
  getSession,
  toolErrorResponses,
  toolSuccesses,
} from "../../src/conversations/store.ts";
import { appPool, assertAppRole, closePlatformDb, initPlatformDb, ownerPool } from "../../src/db/platform-db.ts";
import { createStaffUser, membershipsOf } from "../../src/db/platform-scope.ts";
import { businessSettings, chatSessions, leads, staffMemberships, type Business } from "../../src/db/schema.ts";
import { currentBusinessId, inBusiness, runForBusiness } from "../../src/db/tenant.ts";
import { migrate, pendingMigrations, readMigrations } from "../../src/db/migrate.ts";
import { CARD_NUMBER_PLACEHOLDER } from "../../src/engine/redaction.ts";
import { recordTurn, summarizeTurns, TurnRecorder } from "../../src/engine/telemetry.ts";
import { acquireTurnLock, releaseTurnLock } from "../../src/engine/turn-lock.ts";
import { consumeLimits } from "../../src/gateway/rate-limit.ts";
import { claimCapAlert, isOverCap, recordUsage, usageOn } from "../../src/gateway/spend-cap.ts";
import { roleIn } from "../../src/staff/auth.ts";

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
const acme = <T>(fn: () => Promise<T>) => runForBusiness("acme", fn);
const tbm = <T>(fn: () => Promise<T>) => runForBusiness("tbm", fn);
const newChat = (businessId = "acme") => createSession(businessId, { displayCurrency: "USD", visitorKey: null });

async function setBusiness(fields: Record<string, unknown>) {
  const sets = Object.keys(fields).map((key, index) => `${key} = $${index + 2}`).join(", ");
  await ownerPool().query(`update businesses set ${sets} where id = $1`, ["acme", ...Object.values(fields)]);
  clearBusinessCache();
  business = (await businessById("acme"))!;
}

/** Runs raw SQL as the service, in one business's scope. */
const asBusiness = (businessId: string, text: string, params: unknown[] = []) =>
  inBusiness((_db, client) => client.query(text, params), businessId);

before(async () => {
  const admin = new pg.Pool({ connectionString: TEST_DB, max: 1 });
  await admin.query("drop schema public cascade; create schema public;");
  await admin.end();
  initPlatformDb(TEST_DB, { max: 5 });
  const applied = await migrate(ownerPool());
  assert.deepEqual(applied, readMigrations().map((migration) => migration.version));
  await assertAppRole();
  setSecretKeys(loadSecretKeys({ PLATFORM_SECRETS_KEY: randomBytes(32).toString("base64") }));
  await ownerPool().query(
    `insert into businesses (id, name, public_key, allowed_origins, staffed_hours, unclaimed_timeout_minutes, daily_token_cap, retention_days)
     values ('acme', 'Acme Guesthouse', 'pk_acme', '{https://acme.example}', $1, 10, 1000, 90)`,
    [JSON.stringify(ALWAYS)],
  );
  await createBusinessSettings("acme", "Acme Guesthouse");
  clearBusinessCache();
  business = (await businessById("acme"))!;
  registerConnector("acme", testConnector);
});

beforeEach(() => {
  events.length = 0;
});

after(async () => {
  await closePlatformDb();
});

test("migrations run once, in order, and a changed one is refused", async () => {
  assert.deepEqual(await pendingMigrations(ownerPool()), []);
  assert.deepEqual(await migrate(ownerPool()), []);
  const tampered = readMigrations().map((migration, index) => (index === 0 ? { ...migration, checksum: "changed" } : migration));
  await assert.rejects(() => pendingMigrations(ownerPool(), tampered), /changed after it ran/);
  const { rows } = await ownerPool().query("select id, name from businesses where id = 'tbm'");
  assert.equal(rows[0]?.name, "Tembea Bila Matata");
});

// ── Separation between businesses ─────────────────────────────────────

test("each business sees only its own conversations, even through a query that forgets to filter", async () => {
  const acmeChat = await newChat("acme");
  const tbmChat = await newChat("tbm");
  await appendEvent({ businessId: "acme", sessionId: acmeChat.id, actor: "USER", content: "Acme question" });
  await appendEvent({ businessId: "tbm", sessionId: tbmChat.id, actor: "USER", content: "TBM question" });

  // No where clause at all: Postgres still returns one business's rows.
  for (const [scope, own, other] of [["acme", acmeChat.id, tbmChat.id], ["tbm", tbmChat.id, acmeChat.id]] as const) {
    const sessions = await asBusiness(scope, "select id, business_id from chat_sessions");
    assert.ok(sessions.rows.length > 0);
    assert.ok(sessions.rows.every((row) => row.business_id === scope), `only ${scope}'s chats`);
    assert.ok(sessions.rows.some((row) => row.id === own));
    assert.ok(!sessions.rows.some((row) => row.id === other));
    const messages = await asBusiness(scope, "select business_id, content from chat_events");
    assert.ok(messages.rows.every((row) => row.business_id === scope));
  }

  // Through the app's own functions, another business's chat doesn't exist.
  assert.equal(await acme(() => getSession(tbmChat.id)), undefined);
  assert.deepEqual(await acme(() => customerMessages(tbmChat.id)), []);
  assert.deepEqual(await acme(() => customerVisibleEvents(tbmChat.id, 0)), []);
  assert.equal((await tbm(() => getSession(tbmChat.id)))?.id, tbmChat.id);
});

test("no business in scope, no rows: a forgotten scope fails closed", async () => {
  await newChat("acme");
  assert.throws(() => currentBusinessId(), /No business in scope/);
  await assert.rejects(() => getSession(randomUUID()), /No business in scope/);
  // The service's role outside any business sees no conversations, settings or staff.
  for (const table of ["chat_sessions", "chat_events", "turn_metrics", "usage_daily", "business_settings", "business_secrets", "staff_memberships", "leads"]) {
    const { rows } = await appPool().query(`select count(*)::int as n from ${table}`);
    assert.equal(rows[0].n, 0, `${table} is empty without a business`);
  }
  // …while the platform itself (the owner) sees them.
  const { rows } = await ownerPool().query("select count(*)::int as n from chat_sessions");
  assert.ok(rows[0].n > 0);
});

test("a business can't write into, change or delete another business's rows", async () => {
  const tbmChat = await newChat("tbm");
  await appendEvent({ businessId: "tbm", sessionId: tbmChat.id, actor: "USER", content: "keep me" });

  // Inserting a row labelled with another business is refused.
  await assert.rejects(
    () => asBusiness("acme", "insert into chat_sessions (business_id) values ('tbm')"),
    /row-level security/,
  );
  await assert.rejects(
    () => asBusiness("acme", "insert into usage_daily (business_id, day) values ('tbm', '2026-09-25')"),
    /row-level security/,
  );
  // Changing or deleting another business's rows touches nothing.
  assert.equal((await asBusiness("acme", "update chat_sessions set managed_by = 'CLOSED' where id = $1", [tbmChat.id])).rowCount, 0);
  assert.equal((await asBusiness("acme", "delete from chat_events where session_id = $1", [tbmChat.id])).rowCount, 0);
  assert.equal(await acme(() => deleteConversation(tbmChat.id)), false);
  assert.equal((await acme(() => closeSession(tbmChat.id))), undefined);
  // Moving a row to another business is refused.
  await assert.rejects(
    () => asBusiness("acme", "update chat_sessions set business_id = 'tbm'"),
    /row-level security/,
  );
  const kept = await tbm(() => getSession(tbmChat.id));
  assert.equal(kept?.managedBy, "AI");
  assert.deepEqual(await tbm(() => customerMessages(tbmChat.id)), ["keep me"]);
});

test("a row can only point at its own business's conversation", async () => {
  const tbmChat = await newChat("tbm");
  // Labelled as Acme's (so row-level security allows it) but pointing at TBM's chat.
  await assert.rejects(
    () => appendEvent({ businessId: "acme", sessionId: tbmChat.id, actor: "USER", content: "sneaky" }),
    /foreign key/,
  );
  await assert.rejects(
    () => asBusiness("acme", "insert into turn_metrics (business_id, session_id, started_at, duration_ms, outcome) values ('acme', $1, now(), 1, 'answered')", [tbmChat.id]),
    /foreign key/,
  );
  await assert.rejects(
    () => asBusiness("acme", "insert into payment_claims (business_id, session_id, booking_ref, code) values ('acme', $1, 'b', 'QWE1234RTY')", [tbmChat.id]),
    /foreign key/,
  );
  await assert.rejects(
    () => asBusiness("acme", "insert into leads (business_id, session_id, name) values ('acme', $1, 'X')", [tbmChat.id]),
    /foreign key/,
  );
});

test("the service can't change the business directory or read password hashes", async () => {
  const user = await createStaffUser({ email: "wanjiru@example.com", name: "Wanjiru", passwordHash: "scrypt$x" });
  await ownerPool().query("insert into staff_memberships (business_id, user_id, role) values ('acme', $1, 'owner')", [user.id]);

  // The directory is readable (a widget's key is looked up before any business is known)…
  const { rows } = await appPool().query("select id from businesses order by id");
  assert.deepEqual(rows.map((row) => row.id), ["acme", "tbm"]);
  // …but only the platform creates, changes or removes businesses: a business can't lift its own budget.
  await assert.rejects(() => asBusiness("acme", "update businesses set daily_token_cap = null where id = 'acme'"), /permission denied/);
  await assert.rejects(() => appPool().query("insert into businesses (id, name, public_key) values ('evil', 'Evil', 'pk_evil')"), /permission denied/);
  await assert.rejects(() => asBusiness("acme", "delete from businesses where id = 'acme'"), /permission denied/);
  // Staff accounts: never the password hash, and only the business's own people.
  await assert.rejects(() => asBusiness("acme", "select password_hash from staff_users"), /permission denied/);
  await assert.rejects(() => asBusiness("acme", "select * from staff_users"), /permission denied/);
  await assert.rejects(() => asBusiness("acme", "update staff_users set is_platform_admin = true"), /permission denied/);
  assert.deepEqual((await asBusiness("acme", "select email from staff_users")).rows.map((row) => row.email), ["wanjiru@example.com"]);
  assert.deepEqual((await asBusiness("tbm", "select email from staff_users")).rows, []);
  // Nor the migrations' own records.
  await assert.rejects(() => appPool().query("select * from schema_migrations"), /permission denied/);
});

test("signed in as zaina_app itself, the service can't switch to a stronger role", async () => {
  const url = new URL(TEST_DB);
  url.username = "zaina_app";
  url.password = "local-test-only";
  await ownerPool().query("alter role zaina_app login password 'local-test-only'");
  const direct = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await direct.query("reset role");
    assert.equal((await direct.query("select current_user as role")).rows[0].role, "zaina_app");
    await assert.rejects(() => direct.query("set role postgres"), /permission denied/);
    const client = await direct.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('role', 'zaina_app', true), set_config('app.business_id', 'acme', true)");
      const { rows } = await client.query("select distinct business_id from chat_sessions");
      assert.deepEqual(rows.map((row) => row.business_id), ["acme"]);
      await client.query("commit");
    } finally {
      client.release();
    }
  } finally {
    await direct.end();
    await ownerPool().query("alter role zaina_app nologin password null");
  }
});

test("secrets are encrypted, belong to one business and are never listed with their values", async () => {
  await putSecret("acme", "paystack_secret_key", "sk_test_acme_value", null);
  const stored = await ownerPool().query("select ciphertext, key_id from business_secrets where business_id = 'acme'");
  assert.equal(stored.rows[0].ciphertext.toString("utf8").includes("sk_test"), false);
  assert.equal(await getSecret("acme", "paystack_secret_key"), "sk_test_acme_value");
  assert.equal(await getSecret("tbm", "paystack_secret_key"), null, "TBM can't read Acme's secret");
  assert.deepEqual((await listSecrets("acme")).map((secret) => [secret.name, secret.keyId]), [["paystack_secret_key", "k1"]]);
  assert.deepEqual(await listSecrets("tbm"), []);
  assert.equal("value" in (await listSecrets("acme"))[0], false);

  // Copied into TBM's rows by someone with database access, it still can't be read.
  await ownerPool().query(
    `insert into business_secrets (business_id, name, ciphertext, iv, auth_tag, key_id)
     select 'tbm', name, ciphertext, iv, auth_tag, key_id from business_secrets where business_id = 'acme'`,
  );
  await assert.rejects(() => getSecret("tbm", "paystack_secret_key"));
  await ownerPool().query("delete from business_secrets where business_id = 'tbm'");

  await putSecret("acme", "paystack_secret_key", "sk_test_rotated", null);
  assert.equal(await getSecret("acme", "paystack_secret_key"), "sk_test_rotated");
  assert.equal(await deleteSecret("tbm", "paystack_secret_key"), false);
  assert.equal(await deleteSecret("acme", "paystack_secret_key"), true);
  assert.equal(await getSecret("acme", "paystack_secret_key"), null);
});

test("each business has its own settings; TBM's are today's values", async () => {
  const tbmSettings = await getBusinessSettings("tbm");
  assert.equal(tbmSettings?.displayName, "Tembea Bila Matata");
  assert.equal(tbmSettings?.contactPhone, "+254718475264");
  assert.deepEqual(tbmSettings?.allowedLinkHosts, ["tembeabilamatata.com", "wa.me", "whatsapp.com", "api.whatsapp.com"]);
  assert.deepEqual(tbmSettings?.allowedLinkHostSuffixes, [".go.ke"]);

  const updated = await updateBusinessSettings("acme", { about: "Six rooms in Diani, breakfast included.", contactPhone: "+254700111222" }, null);
  assert.equal(updated.about, "Six rooms in Diani, breakfast included.");
  assert.equal((await getBusinessSettings("acme"))?.contactPhone, "+254700111222");
  // From TBM's scope, Acme's settings can't be changed.
  const changed = await inBusiness((db) => db.update(businessSettings).set({ displayName: "Hijacked" }).where(eq(businessSettings.businessId, "acme")).returning(), "tbm");
  assert.deepEqual(changed, []);
  assert.equal((await getBusinessSettings("acme"))?.displayName, "Acme Guesthouse");
});

test("staff roles are per business; platform admins act as owners", async () => {
  const amina = await createStaffUser({ email: "amina@example.com", name: "Amina", passwordHash: "scrypt$x" });
  const otieno = await createStaffUser({ email: "Otieno@Example.com", name: "Otieno", passwordHash: "scrypt$x" });
  const admin = await createStaffUser({ email: "ops@example.com", name: "Ops", passwordHash: "scrypt$x", isPlatformAdmin: true });
  assert.equal(otieno.email, "otieno@example.com");
  await inBusiness((db) => db.insert(staffMemberships).values({ businessId: "acme", userId: amina.id, role: "manager" }), "acme");
  await inBusiness((db) => db.insert(staffMemberships).values({ businessId: "tbm", userId: otieno.id, role: "agent" }), "tbm");
  // A business can't add people to another business.
  await assert.rejects(
    () => inBusiness((db) => db.insert(staffMemberships).values({ businessId: "tbm", userId: amina.id, role: "owner" }), "acme"),
    /row-level security/,
  );

  assert.equal(await roleIn("acme", amina), "manager");
  assert.equal(await roleIn("tbm", amina), null);
  assert.equal(await roleIn("tbm", otieno), "agent");
  assert.equal(await roleIn("acme", otieno), null);
  assert.equal(await roleIn("tbm", admin), "owner");
  assert.deepEqual(await membershipsOf(amina.id), [{ businessId: "acme", businessName: "Acme Guesthouse", role: "manager" }]);
  const acmeMembers = await inBusiness((db) => db.select().from(staffMemberships), "acme");
  assert.ok(acmeMembers.every((member) => member.businessId === "acme"));
});

// ── The platform's own tables (Phase 0 checks, now inside a business) ──

test("rate limits are shared: the counters live in Postgres", async () => {
  const rule = { key: "messages:session:shared-test", limit: 3, windowSeconds: 60 };
  const now = new Date("2026-09-25T10:00:10Z");
  for (let hit = 0; hit < 3; hit += 1) assert.equal((await consumeLimits([rule], now)).allowed, true);
  // Another server instance reads the same counter.
  const other = new pg.Pool({ connectionString: TEST_DB, max: 1 });
  const { rows } = await other.query("select count from rate_limit_counters where key = $1", [rule.key]);
  await other.end();
  assert.equal(rows[0].count, 3);
  const refused = await consumeLimits([rule], now);
  assert.equal(refused.allowed, false);
  assert.equal(!refused.allowed && refused.retryAfterSeconds, 50);
  // The next window starts fresh.
  assert.equal((await consumeLimits([rule], new Date("2026-09-25T10:01:01Z"))).allowed, true);
});

test("the tightest of several limits decides", async () => {
  const now = new Date("2026-09-25T11:00:00Z");
  const rules = [
    { key: "messages:session:s1", limit: 20, windowSeconds: 60 },
    { key: "messages:visitor:v1", limit: 2, windowSeconds: 600 },
  ];
  assert.equal((await consumeLimits(rules, now)).allowed, true);
  assert.equal((await consumeLimits(rules, now)).allowed, true);
  const refused = await consumeLimits([{ ...rules[0], key: "messages:session:s2" }, rules[1]], now);
  assert.equal(refused.allowed, false);
  assert.equal(!refused.allowed && refused.rule.key, "messages:visitor:v1");
});

test("one turn at a time per conversation; a dead turn's lease runs out", async () => {
  const session = await newChat();
  await acme(async () => {
    const first = await acquireTurnLock(session.id, 30_000);
    assert.ok(first);
    assert.equal(await acquireTurnLock(session.id, 30_000), null);
    await releaseTurnLock(session.id, randomUUID());
    assert.equal(await acquireTurnLock(session.id, 30_000), null);
    await releaseTurnLock(session.id, first!);
    const second = await acquireTurnLock(session.id, 1);
    assert.ok(second);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const third = await acquireTurnLock(session.id, 30_000);
    assert.ok(third, "an expired lease can be taken");
    await releaseTurnLock(session.id, third!);
  });
  // Free, but not from another business.
  assert.equal(await tbm(() => acquireTurnLock(session.id, 30_000)), null);
  assert.ok(await acme(() => acquireTurnLock(session.id, 30_000)));
});

test("daily model budget: usage adds up per business and the team is alerted once", async () => {
  const day = "2026-09-25";
  await recordUsage("acme", day, { inputTokens: 600, outputTokens: 100 });
  await recordUsage("acme", day, { inputTokens: 250, outputTokens: 50 });
  await recordUsage("tbm", day, { inputTokens: 5, outputTokens: 5 });
  const usage = await usageOn("acme", day);
  assert.deepEqual(usage, { inputTokens: 850, outputTokens: 150, turns: 2 });
  assert.deepEqual(await usageOn("tbm", day), { inputTokens: 5, outputTokens: 5, turns: 1 });
  assert.equal(isOverCap(usage, 1000), true);
  assert.equal(await claimCapAlert("acme", day), true);
  assert.equal(await claimCapAlert("acme", day), false);
  assert.equal(await claimCapAlert("tbm", day), true, "each business has its own alert");
});

test("messages are stored without card numbers, and the customer sees only the chat", async () => {
  const session = await createSession("acme", { displayCurrency: "KES", visitorKey: "v" });
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "USER", content: "card 4111 1111 1111 1111 please" });
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "SYSTEM_TOOL", toolName: "create_custom_offer", toolResponse: { ok: false, error: "request_details_missing", missing_details: ["dates"] } });
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "SYSTEM_TOOL", toolName: "create_custom_offer", toolResponse: { ok: true, booking_id: "b-1" } });
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "SYSTEM", content: "internal note" });
  await appendEvent({ businessId: "acme", sessionId: session.id, actor: "ZAINA_REASONING", content: "Karibu" });
  await acme(async () => {
    assert.deepEqual(await customerMessages(session.id), [`card ${CARD_NUMBER_PLACEHOLDER} please`]);
    assert.equal((await toolErrorResponses(session.id, "create_custom_offer", "request_details_missing")).length, 1);
    assert.equal((await toolSuccesses(session.id, ["create_custom_offer"]))[0]?.response.booking_id, "b-1");
    const visible = await customerVisibleEvents(session.id, 0);
    assert.deepEqual(visible.map((event) => event.actor), ["USER", "ZAINA_REASONING"]);
    assert.deepEqual((await customerVisibleEvents(session.id, visible[0].id)).map((event) => event.content), ["Karibu"]);
  });
});

test("a handoff while staff are on waits for a person; claim, reply, hand back, close", async () => {
  const session = await newChat();
  await acme(async () => {
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
  // Another business's staff can't claim it.
  assert.equal(await tbm(() => claimSession(session.id, "agent-x")), undefined);
});

test("outside staffed hours the customer isn't left waiting", async () => {
  await setBusiness({ staffed_hours: JSON.stringify({ days: [1, 2, 3, 4, 5], open: "08:00", close: "17:00" }) });
  const session = await newChat();
  // Saturday 26 Sept, 10:00 in Nairobi.
  const saturday = new Date("2026-09-26T10:00:00+03:00");
  await acme(async () => {
    const result = await requestHandoff(business, session.id, "Wants a discount", saturday);
    assert.equal(result.status, "callback");
    assert.match(result.status === "callback" ? result.tellCustomer : "", /back on Monday at 8:00 AM \(Kenya time\).*phone number or email/);
    const later = await getSession(session.id);
    assert.equal(later?.managedBy, "AI");
    assert.ok(later?.callbackRequestedAt);
    await new Promise((resolve) => setImmediate(resolve));
    const callback = events.find((event) => event.kind === "callback");
    assert.equal(callback?.kind === "callback" && callback.why, "offline");

    // Having typed an email, the customer isn't asked for one.
    await appendEvent({ businessId: "acme", sessionId: session.id, actor: "USER", content: "It's amina@example.com" });
    const again = await requestHandoff(business, session.id, "Wants a discount", saturday);
    assert.doesNotMatch(again.status === "callback" ? again.tellCustomer : "", /phone number or email/);
  });
  await setBusiness({ staffed_hours: JSON.stringify(ALWAYS) });
});

test("a handoff nobody claims goes back to Zaina with a callback", async () => {
  const waiting = await newChat();
  const claimed = await newChat();
  const fresh = await newChat();
  await acme(async () => {
    for (const session of [waiting, claimed, fresh]) await requestHandoff(business, session.id, "Needs help");
    await claimSession(claimed.id, "agent-2");
  });
  await ownerPool().query("update chat_sessions set handoff_at = now() - interval '11 minutes' where id = any($1::uuid[])", [[waiting.id, claimed.id]]);

  const handedBack = await sweepUnclaimedHandoffs();
  assert.deepEqual(handedBack, [waiting.id]);
  await acme(async () => {
    assert.equal((await getSession(waiting.id))?.managedBy, "AI");
    assert.equal((await getSession(claimed.id))?.managedBy, "HUMAN");
    assert.equal((await getSession(fresh.id))?.managedBy, "HUMAN");
    const visible = await customerVisibleEvents(waiting.id, 0);
    assert.match(visible.at(-1)?.content ?? "", /Sorry for the wait/);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.filter((event) => event.kind === "callback" && event.why === "unclaimed").length, 1);
});

test("old conversations are deleted by each business's own retention; telemetry stays without them", async () => {
  await setBusiness({ retention_days: 30 });
  const old = await newChat("acme");
  const recent = await newChat("acme");
  const tbmOld = await newChat("tbm");
  await appendEvent({ businessId: "acme", sessionId: old.id, actor: "USER", content: "hello from long ago" });
  await recordTurn("acme", old.id, new TurnRecorder().finish("answered"));
  // 45 days: past Acme's 30, within TBM's 90.
  await ownerPool().query("update chat_sessions set last_activity_at = now() - interval '45 days' where id = any($1::uuid[])", [[old.id, tbmOld.id]]);

  assert.ok((await deleteExpiredConversations()) >= 1);
  assert.equal(await acme(() => getSession(old.id)), undefined);
  assert.ok(await acme(() => getSession(recent.id)));
  assert.ok(await tbm(() => getSession(tbmOld.id)), "TBM keeps its conversations for 90 days");
  const { rows } = await ownerPool().query("select count(*)::int as n from turn_metrics where session_id is null and business_id = 'acme'");
  assert.ok(rows[0].n >= 1);
  await setBusiness({ retention_days: 90 });
});

test("a customer's conversations and leads are deleted on request, by email or phone, in one business only", async () => {
  const byEmail = await newChat("acme");
  const byPhone = await newChat("acme");
  const someoneElse = await newChat("acme");
  const atTbm = await newChat("tbm");
  await appendEvent({ businessId: "acme", sessionId: byEmail.id, actor: "USER", content: "I'm Brian, Brian.M@Example.com" });
  await appendEvent({ businessId: "acme", sessionId: byPhone.id, actor: "USER", content: "call +254 722 555 111" });
  await appendEvent({ businessId: "acme", sessionId: someoneElse.id, actor: "USER", content: "I'm Chege, chege@example.com, 0733 000 111" });
  await appendEvent({ businessId: "tbm", sessionId: atTbm.id, actor: "USER", content: "Brian here: brian.m@example.com" });
  await inBusiness((db) => db.insert(leads).values({ businessId: "acme", sessionId: byEmail.id, name: "Brian", email: "brian.m@example.com" }), "acme");

  assert.deepEqual(await acme(() => eraseCustomer({ email: "brian.m@example.com", phone: "0722555111" })), { conversations: 2, leads: 1 });
  await acme(async () => {
    assert.equal(await getSession(byEmail.id), undefined);
    assert.equal(await getSession(byPhone.id), undefined);
    assert.ok(await getSession(someoneElse.id));
  });
  assert.ok(await tbm(() => getSession(atTbm.id)), "the same customer at another business is untouched");
});

test("the telemetry summary gives cost per conversation, per business", async () => {
  const session = await newChat();
  const turn = new TurnRecorder();
  turn.addModelCall(900, { inputTokens: 18_000, outputTokens: 200, cachedTokens: 0 });
  turn.addModelCall(700, { inputTokens: 19_000, outputTokens: 100, cachedTokens: 0 });
  await recordTurn("acme", session.id, turn.finish("answered"));
  await recordTurn("acme", session.id, new TurnRecorder().finish("busy"));
  const range = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
  const summary = await summarizeTurns("acme", range, { input: 0.1, output: 0.4 });
  assert.equal(summary.outcomes.answered >= 1, true);
  assert.equal(summary.outcomes.busy >= 1, true);
  assert.ok(summary.perConversation.costUsd !== null && summary.perConversation.costUsd > 0);
  const tbmSummary = await summarizeTurns("tbm", range, { input: 0.1, output: 0.4 });
  assert.equal(tbmSummary.outcomes.busy, undefined, "Acme's turns aren't in TBM's report");
});

test("updating a chat in scope uses the business's row only", async () => {
  // Guard for drizzle-built updates: a where clause matching every row still touches one business.
  const acmeChat = await newChat("acme");
  const tbmChat = await newChat("tbm");
  const touched = await inBusiness((db) => db.update(chatSessions).set({ displayCurrency: "KES" }).where(sql`true`).returning({ id: chatSessions.id }), "acme");
  assert.ok(touched.some((row) => row.id === acmeChat.id));
  assert.ok(!touched.some((row) => row.id === tbmChat.id));
  assert.equal((await tbm(() => getSession(tbmChat.id)))?.displayCurrency, "USD");
});
