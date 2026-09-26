// Calendar syncs in the database (Phase 5 fix): one business syncs in one
// place at a time, even with two copies of the service running (a deploy's
// overlap), and a calendar's busy times are replaced whole, never added twice
// when two reads of it land together. Needs the same local *_test database as
// platform.test.ts (it is wiped).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import pg from "pg";
import { createOffering, validateOffering } from "../../src/booking/offerings.ts";
import { addDays, isoDate, parseDate } from "../../src/booking/pricing.ts";
import { clearBusinessCache } from "../../src/businesses/registry.ts";
import { loadSecretKeys, setSecretKeys } from "../../src/businesses/secrets.ts";
import { createBusinessSettings } from "../../src/businesses/settings.ts";
import { syncBusiness, writeBusy, type Busy } from "../../src/calendars/sync.ts";
import { closePlatformDb, initPlatformDb, ownerPool } from "../../src/db/platform-db.ts";
import { migrate } from "../../src/db/migrate.ts";
import { calendarSources, type Business, type CalendarSource, type Offering } from "../../src/db/schema.ts";
import { inBusiness } from "../../src/db/tenant.ts";
import { businessDay } from "../../src/gateway/spend-cap.ts";

const TEST_DB = process.env.PLATFORM_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/zaina_platform_test";
if (!new URL(TEST_DB).pathname.endsWith("_test")) throw new Error("PLATFORM_TEST_DATABASE_URL must name a database ending in _test: it is wiped");

const ZONE = "Africa/Nairobi";
const coral = { id: "coral", name: "Coral Cove", timeZone: ZONE, businessType: "guesthouse" } as Business;
const studio = { id: "studio", name: "Studio Nywele", timeZone: ZONE, businessType: "salon" } as Business;

let cottage: Offering;
/** Another copy of the service: a connection of its own. */
let other: pg.Pool;

const day = (offset: number) => isoDate(addDays(parseDate(businessDay(ZONE))!, offset));
/** `count` one-night stays from a channel's calendar, a week apart. */
const stays = (count: number, tag: string): Busy[] => Array.from({ length: count }, (_, index) => {
  const from = day(7 + index * 7);
  const to = day(8 + index * 7);
  return { uid: `${tag}-${index}@channel.example`, days: { from, to }, start: new Date(`${from}T00:00:00Z`), end: new Date(`${to}T00:00:00Z`) };
});

async function source(businessId: string, fields: Partial<CalendarSource>): Promise<CalendarSource> {
  const [row] = await inBusiness((db) => db.insert(calendarSources).values({ businessId, kind: "ics", label: "Airbnb", ...fields }).returning(), businessId);
  return row;
}
const eqId = (id: string) => eq(calendarSources.id, id);
const count = async (table: "offering_blocks" | "resource_blocks", sourceId: string) =>
  Number((await ownerPool().query<{ n: string }>(`select count(*) as n from ${table} where calendar_source_id = $1`, [sourceId])).rows[0].n);

before(async () => {
  const admin = new pg.Pool({ connectionString: TEST_DB, max: 1 });
  await admin.query("drop schema public cascade; create schema public;");
  await admin.end();
  initPlatformDb(TEST_DB, { max: 8 });
  await migrate(ownerPool());
  setSecretKeys(loadSecretKeys({ PLATFORM_SECRETS_KEY: randomBytes(32).toString("base64") }));
  for (const business of [coral, studio]) {
    await ownerPool().query(
      `insert into businesses (id, name, public_key, allowed_origins, business_type, time_zone) values ($1, $2, $3, '{}', $4, $5)`,
      [business.id, business.name, `pk_${business.id}`, business.businessType, ZONE],
    );
    await createBusinessSettings(business.id, business.name);
  }
  clearBusinessCache();
  const checked = validateOffering({ name: "Garden cottage", units: 1, max_guests: 4, pricing: { nightly: 1_200_000 } });
  assert.ok(checked.ok, !checked.ok ? checked.error : "");
  const created = await createOffering("coral", checked.value, null);
  assert.ok(typeof created === "object");
  cottage = created;
  other = new pg.Pool({ connectionString: TEST_DB, max: 2 });
});

after(async () => {
  await other?.end();
  await closePlatformDb();
});

test("two reads of one calendar landing together leave its busy times once, not twice", async () => {
  const airbnb = await source("coral", { offeringId: cottage.id });
  // Five reads at once, each with a different version of the calendar: the last one written wins, whole.
  const results = await Promise.all([10, 20, 30, 40, 50].map((size) => writeBusy(coral, airbnb, stays(size, `v${size}`), new Date())));
  const kept = await count("offering_blocks", airbnb.id);
  assert.ok([10, 20, 30, 40, 50].includes(kept), `one read's closures, not a mix (${kept})`);
  const [saved] = await inBusiness((db) => db.select().from(calendarSources), "coral");
  assert.equal(saved.busyCount, kept, "the count shown matches the closures kept");
  assert.deepEqual(results.sort((a, b) => a - b), [10, 20, 30, 40, 50]);

  // A calendar for a person's (or the whole business's) times works the same way.
  const whole = await source("studio", {});
  await Promise.all([3, 6, 9].map((size) => writeBusy(studio, whole, stays(size, `s${size}`), new Date())));
  assert.ok([3, 6, 9].includes(await count("resource_blocks", whole.id)));
});

test("while another copy of the service syncs a business, a sync here does nothing and says so", async () => {
  // A calendar whose link is missing: a sync that runs marks it with the problem.
  const broken = await source("studio", { label: "Old channel" });
  const key = "calendars:studio";
  const held = await other.connect();
  try {
    assert.equal((await held.query("select pg_try_advisory_lock(hashtextextended($1, 0)) as locked", [key])).rows[0].locked, true);
    const skipped = await syncBusiness(studio);
    assert.equal(skipped.busy, true);
    assert.deepEqual(skipped.sources, []);
    const [untouched] = await inBusiness((db) => db.select().from(calendarSources).where(eqId(broken.id)), "studio");
    assert.equal(untouched.lastSyncAt, null, "nothing was read");
    await held.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]);
  } finally {
    held.release();
  }

  const synced = await syncBusiness(studio);
  assert.equal(synced.busy, undefined);
  assert.equal(synced.sources.find((entry) => entry.sourceId === broken.id)?.ok, false);
  const [marked] = await inBusiness((db) => db.select().from(calendarSources).where(eqId(broken.id)), "studio");
  assert.equal(marked.status, "error");
  assert.match(marked.lastError ?? "", /link is missing/);

  // The lock was let go: the other copy can take it now.
  const after = await other.connect();
  try {
    assert.equal((await after.query("select pg_try_advisory_lock(hashtextextended($1, 0)) as locked", [key])).rows[0].locked, true);
    await after.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]);
  } finally {
    after.release();
  }
});

test("two syncs of one business asked for together: one runs, the other says it was busy", async () => {
  const [first, second] = await Promise.all([syncBusiness(studio), syncBusiness(studio)]);
  assert.deepEqual([first.busy, second.busy].sort(), [true, undefined].sort());
});

test("syncs of many businesses at once all finish, a few at a time, without taking every connection", async () => {
  // Ten shops, more than the pool's eight connections: each sync holds one for its lock.
  const shops: Business[] = [];
  for (let index = 1; index <= 10; index += 1) {
    const shop = { id: `shop${index}`, name: `Shop ${index}`, timeZone: ZONE, businessType: "salon" } as Business;
    await ownerPool().query(
      `insert into businesses (id, name, public_key, allowed_origins, business_type, time_zone) values ($1, $2, $3, '{}', 'salon', $4)`,
      [shop.id, shop.name, `pk_${shop.id}`, ZONE],
    );
    await createBusinessSettings(shop.id, shop.name);
    await source(shop.id, { label: "Old channel" });
    shops.push(shop);
  }
  const started = Date.now();
  const summaries = await Promise.all(shops.map((shop) => syncBusiness(shop)));
  assert.ok(Date.now() - started < 10_000, "no sync waited for a connection");
  for (const summary of summaries) {
    assert.equal(summary.busy, undefined);
    assert.equal(summary.sources.length, 1);
    assert.match(summary.sources[0].error ?? "", /link is missing/);
  }
});
