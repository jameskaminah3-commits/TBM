// Time slots in the database (Phase 5): a salon's stylists and a
// restaurant's tables, opening hours, buffers, the last slot going to one
// customer, closures, holds that run out, the business's deposit rules, and
// a late payment moved to another free table. Needs the same local *_test
// database as platform.test.ts (it is wiped).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import { daySchedule, nextFreeDays, slotInstant, slotsOn } from "../../src/booking/appointments.ts";
import { createSlotBooking, expireHolds, holdForPayment, type CreateSlotBookingInput } from "../../src/booking/bookings.ts";
import { createOffering, setOfferingResources, validateOffering } from "../../src/booking/offerings.ts";
import { addDays, isoDate, parseDate } from "../../src/booking/pricing.ts";
import { createResource, createResourceBlock, validateResource } from "../../src/booking/resources.ts";
import { saveBookingSettings } from "../../src/booking/settings.ts";
import { clearBusinessCache } from "../../src/businesses/registry.ts";
import { loadSecretKeys, setSecretKeys } from "../../src/businesses/secrets.ts";
import { createBusinessSettings } from "../../src/businesses/settings.ts";
import { closePlatformDb, initPlatformDb, ownerPool } from "../../src/db/platform-db.ts";
import { migrate } from "../../src/db/migrate.ts";
import type { Business, Offering, Resource } from "../../src/db/schema.ts";
import { inBusiness } from "../../src/db/tenant.ts";
import { businessDay } from "../../src/gateway/spend-cap.ts";

const TEST_DB = process.env.PLATFORM_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/zaina_platform_test";
if (!new URL(TEST_DB).pathname.endsWith("_test")) throw new Error("PLATFORM_TEST_DATABASE_URL must name a database ending in _test: it is wiped");

const ZONE = "Africa/Nairobi";
const KSH = (major: number) => major * 100;
const salon = { id: "studio", timeZone: ZONE } as Business;
const resto = { id: "bistro", timeZone: ZONE } as Business;

/** The Monday at least `weeks` weeks from today, in Kenya. */
function monday(weeks: number): string {
  const today = parseDate(businessDay(ZONE))!;
  const toMonday = (8 - today.getUTCDay()) % 7 || 7;
  return isoDate(addDays(today, toMonday + 7 * (weeks - 1)));
}
const friday = (weeks: number) => isoDate(addDays(parseDate(monday(weeks))!, 4));

let haircut: Offering;
let colour: Offering;
let dinner: Offering;
let amina: Resource;
let brian: Resource;
let tables: Record<"t2" | "t4" | "t6", Resource>;

const jane = { name: "Jane Wanjiru", email: "jane@example.com", phone: "0712345678" };
const slot = (fields: Partial<CreateSlotBookingInput> & { date: string; time: string }): CreateSlotBookingInput => ({
  businessId: "studio",
  timeZone: ZONE,
  offeringId: haircut.id,
  party: 1,
  customer: jane,
  notes: null,
  source: "chat",
  sessionId: null,
  idempotencyKey: null,
  ...fields,
  startsAt: slotInstant(fields.date, fields.time, ZONE),
});

async function resource(businessId: string, input: Record<string, unknown>): Promise<Resource> {
  const checked = validateResource(input);
  assert.ok(checked.ok, !checked.ok ? checked.error : "");
  const created = await createResource(businessId, checked.value);
  assert.ok(typeof created === "object");
  return created;
}

async function offering(businessId: string, input: Record<string, unknown>, kind: "service" | "table"): Promise<Offering> {
  const checked = validateOffering(input, undefined, kind);
  assert.ok(checked.ok, !checked.ok ? checked.error : "");
  const created = await createOffering(businessId, checked.value, null);
  assert.ok(typeof created === "object");
  return created;
}

const times = async (business: Business, service: Offering, date: string, party = 1, resourceId: string | null = null) => {
  const day = await slotsOn(business, service, date, party, { resourceId });
  assert.ok(day.ok, !day.ok ? day.message : "");
  return day.slots.map((entry) => entry.time);
};

before(async () => {
  const admin = new pg.Pool({ connectionString: TEST_DB, max: 1 });
  await admin.query("drop schema public cascade; create schema public;");
  await admin.end();
  initPlatformDb(TEST_DB, { max: 8 });
  await migrate(ownerPool());
  setSecretKeys(loadSecretKeys({ PLATFORM_SECRETS_KEY: randomBytes(32).toString("base64") }));
  for (const [id, name, type] of [["studio", "Studio Nywele", "salon"], ["bistro", "Bistro Kaa", "restaurant"]]) {
    await ownerPool().query(
      `insert into businesses (id, name, public_key, allowed_origins, business_type, time_zone) values ($1, $2, $3, '{}', $4, $5)`,
      [id, name, `pk_${id}`, type, ZONE],
    );
    await createBusinessSettings(id, name);
  }
  clearBusinessCache();
  const weekdays = Object.fromEntries(["1", "2", "3", "4", "5", "6"].map((day) => [day, [["09:00", "18:00"]]]));
  // The salon takes a 50% deposit by M-Pesa (a paybill the team checks).
  await saveBookingSettings("studio", { openingHours: weekdays, slotIntervalMinutes: 30, depositType: "percent", depositPercent: 50, mpesaManualType: "paybill", mpesaManualNumber: "123456" }, null);
  amina = await resource("studio", { name: "Amina", kind: "staff" });
  brian = await resource("studio", { name: "Brian", kind: "staff", hours: { 1: [["12:00", "18:00"]], 2: [["12:00", "18:00"]], 3: [["12:00", "18:00"]], 4: [["12:00", "18:00"]], 5: [["12:00", "18:00"]] } });
  haircut = await offering("studio", { name: "Haircut", duration_minutes: 60, buffer_minutes: 15, pricing: { price: KSH(1500) } }, "service");
  colour = await offering("studio", { name: "Colour", duration_minutes: 120, pricing: { price: KSH(6000) } }, "service");
  await setOfferingResources("studio", colour.id, [amina.id]);

  // The bistro: dinner from 18:00 to 01:00 on Fridays, free to book (no deposit).
  await saveBookingSettings("bistro", { openingHours: { 5: [["18:00", "01:00"]], 6: [["18:00", "23:00"]] }, slotIntervalMinutes: 30, depositType: "none" }, null);
  tables = {
    t2: await resource("bistro", { name: "Table 2", kind: "table", seats: 2 }),
    t4: await resource("bistro", { name: "Table 4", kind: "table", seats: 4 }),
    t6: await resource("bistro", { name: "Table 6", kind: "table", seats: 6, min_party: 5 }),
  };
  dinner = await offering("bistro", { name: "Dinner", duration_minutes: 90, buffer_minutes: 15, min_party: 1, max_party: 6 }, "table");
});

after(async () => {
  await closePlatformDb();
});

test("the times free follow opening hours, each person's own hours and the service's length", async () => {
  const day = monday(2);
  const all = await times(salon, haircut, day);
  assert.equal(all[0], "09:00");
  assert.equal(all.at(-1), "17:00", "a 60-minute haircut ends by 18:00");
  assert.equal(all.length, 17);
  const byBrian = await times(salon, haircut, day, 1, brian.id);
  assert.equal(byBrian[0], "12:00", "Brian works from noon");
  const colours = await times(salon, colour, day);
  assert.equal(colours.at(-1), "16:00", "two hours, by Amina only");
  const sunday = await slotsOn(salon, haircut, isoDate(addDays(parseDate(day)!, 6)), 1);
  assert.ok(sunday.ok && sunday.slots.length === 0, "closed on Sundays");
});

test("a booking takes its person until it ends plus the buffer; the last slot goes to one customer", async () => {
  const day = monday(3);
  const first = await createSlotBooking(slot({ date: day, time: "10:00" }));
  assert.ok(first.ok);
  assert.equal(first.booking.status, "held", "50% deposit, payable by M-Pesa");
  assert.equal(first.booking.depositMinor, KSH(750));
  assert.equal(first.booking.resourceId, amina.id, "before noon only Amina works");
  assert.equal(first.booking.checkIn, day);
  assert.equal((first.booking.busyUntil!.getTime() - first.booking.startsAt!.getTime()) / 60_000, 75);
  const left = await times(salon, haircut, day);
  assert.ok(!left.includes("10:00") && !left.includes("10:30") && !left.includes("11:00"), "Amina is busy until 11:15");
  assert.ok(left.includes("11:30"));

  // 12:00: Amina and Brian both free. Three customers try for it at once; two get it.
  const racers = await Promise.all([1, 2, 3].map((n) => createSlotBooking(slot({ date: day, time: "12:00", customer: { ...jane, name: `Racer ${n}` } }))));
  assert.equal(racers.filter((result) => result.ok).length, 2, "two people, two bookings");
  const refused = racers.find((result) => !result.ok);
  assert.ok(refused && !refused.ok && refused.error === "unavailable");
  assert.ok(!(await times(salon, haircut, day)).includes("12:00"));

  const asked = await createSlotBooking(slot({ date: day, time: "14:00", resourceId: brian.id }));
  assert.ok(asked.ok && asked.booking.resourceId === brian.id, "the stylist the customer asked for");
  const taken = await createSlotBooking(slot({ date: day, time: "14:30", resourceId: brian.id }));
  assert.ok(!taken.ok && taken.error === "resource_unavailable" && /Amina is/.test(taken.message));
  const closed = await createSlotBooking(slot({ date: day, time: "17:30" }));
  assert.ok(!closed.ok && closed.error === "closed", "it would end after closing");
});

test("closures: the whole business, or one person", async () => {
  const day = monday(4);
  await createResourceBlock("studio", { resourceId: null, startsAt: slotInstant(day, "09:00", ZONE), endsAt: slotInstant(day, "13:00", ZONE), reason: "Training", createdBy: null });
  await createResourceBlock("studio", { resourceId: brian.id, startsAt: slotInstant(day, "15:00", ZONE), endsAt: slotInstant(day, "18:00", ZONE), reason: "Time off", createdBy: null });
  const left = await times(salon, haircut, day);
  assert.equal(left[0], "13:00");
  const byBrian = await times(salon, haircut, day, 1, brian.id);
  assert.equal(byBrian.at(-1), "14:00", "Brian is off from 15:00");
  const schedule = await daySchedule(salon, day);
  assert.equal(schedule.resources.length, 2);
});

test("tables seat the party: the smallest that fits, big tables kept for big parties", async () => {
  const day = friday(2);
  const party = (size: number, time = "20:00") => createSlotBooking({ ...slot({ date: day, time, businessId: "bistro", offeringId: dinner.id }), party: size });
  const couple = await party(2);
  assert.ok(couple.ok && couple.booking.resourceId === tables.t2.id && couple.booking.status === "confirmed", "free to book, no deposit");
  const second = await party(2);
  assert.ok(second.ok && second.booking.resourceId === tables.t4.id);
  const third = await party(2);
  assert.ok(!third.ok && third.error === "unavailable", "the six-seat table is for five or more");
  const five = await party(5);
  assert.ok(five.ok && five.booking.resourceId === tables.t6.id);
  const seven = await party(7);
  assert.ok(!seven.ok && seven.error === "too_many_guests");
  const late = await times(resto, dinner, day, 2);
  assert.equal(late.at(-1), "23:30", "open past midnight: 23:30 ends at 01:00");
  const next = await nextFreeDays(resto, dinner, day, 4);
  assert.equal(next[0]?.date, day);
});

test("an unpaid hold that ran out frees its person; paying later moves to another if one is free", async () => {
  const day = monday(5);
  const held = await createSlotBooking(slot({ date: day, time: "15:00", resourceId: brian.id }));
  assert.ok(held.ok && held.booking.status === "held");
  await ownerPool().query("update bookings set hold_expires_at = now() - interval '1 minute' where id = $1", [held.booking.id]);
  const other = await createSlotBooking(slot({ date: day, time: "15:00", resourceId: brian.id, customer: { ...jane, name: "Otieno" } }));
  assert.ok(other.ok, "Brian is free again");
  const expired = await expireHolds();
  assert.ok(expired.some((entry) => entry.booking.id === held.booking.id));
  const renewed = await holdForPayment("studio", held.booking.id);
  assert.ok(renewed.ok && renewed.booking.status === "held");
  const moved = await inBusiness(async (_db, client) => (await client.query("select resource_id from bookings where id = $1", [held.booking.id])).rows[0].resource_id, "studio");
  assert.equal(moved, amina.id, "Amina was free at 15:00");
  const third = await createSlotBooking(slot({ date: day, time: "15:00", customer: { ...jane, name: "Wafula" } }));
  assert.ok(!third.ok && third.error === "unavailable", "both taken now");
});

test("the business decides: until it chooses a deposit, chat bookings are requests", async () => {
  await saveBookingSettings("studio", { depositType: "not_set" }, null);
  const request = await createSlotBooking(slot({ date: monday(6), time: "09:00" }));
  assert.ok(request.ok && request.booking.status === "requested" && request.booking.depositMinor === 0);
  await saveBookingSettings("studio", { depositType: "full", minNoticeHours: 720 }, null);
  const soon = await createSlotBooking(slot({ date: monday(2), time: "10:00" }));
  assert.ok(!soon.ok && soon.error === "too_soon", "the business's notice (30 days)");
  const byTeam = await createSlotBooking(slot({ date: monday(2), time: "10:00", source: "staff" }));
  assert.ok(byTeam.ok && byTeam.booking.status === "awaiting_payment" && byTeam.booking.depositMinor === KSH(1500), "paid in full, the team isn't held to the notice");
  await saveBookingSettings("studio", { depositType: "percent", depositPercent: 50, minNoticeHours: 0 }, null);
});

test("each business sees only its own people, tables and slots", async () => {
  const seen = await inBusiness(async (_db, client) => (await client.query("select count(*)::int as n from resources")).rows[0].n, "studio");
  assert.equal(seen, 2);
  await assert.rejects(() => inBusiness((_db, client) => client.query("insert into resource_blocks (business_id, starts_at, ends_at) values ('bistro', now(), now() + interval '1 hour')"), "studio"));
  const wrong = await createSlotBooking({ ...slot({ date: monday(7), time: "10:00" }), businessId: "bistro" });
  assert.ok(!wrong.ok && wrong.error === "not_found", "the salon's service isn't the bistro's");
});
