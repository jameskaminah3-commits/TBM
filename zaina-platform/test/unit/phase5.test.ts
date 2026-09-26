// Phase 5 without a database: opening hours, free times, time-slot prices,
// the payment block for a slot, and local times.

import assert from "node:assert/strict";
import test from "node:test";
import { localParts, zonedInstant } from "../../src/booking/local-time.ts";
import { quoteSlot, validateSlotPricing } from "../../src/booking/pricing.ts";
import { describeWeek, eligibleResources, freeSlots, intersectSpans, openSpans, resourceBusy, resourceWorks, validateWeekHours } from "../../src/booking/slots.ts";
import type { Resource } from "../../src/db/schema.ts";
import { composeCustomerReply, paymentDetailsFromToolResult } from "../../src/engine/reply-policy.ts";
import { phoneNumbersWritten, sharesPhoneNumber } from "../../src/engine/tool-args.ts";

const ZONE = "Africa/Nairobi";
const person = (id: string, fields: Partial<Resource> = {}) => ({ id, businessId: "b", name: id, kind: "staff", seats: 1, minParty: 1, hours: null, status: "active", sortOrder: 0, createdAt: new Date(), updatedAt: new Date(), ...fields }) as Resource;

test("local times: a business's clock both ways", () => {
  const at = zonedInstant("2026-10-26", "14:30", ZONE);
  assert.equal(at.toISOString(), "2026-10-26T11:30:00.000Z");
  assert.deepEqual(localParts(ZONE, at), { date: "2026-10-26", time: "14:30", minutes: 870, weekday: 1 });
  // A zone with daylight saving: London in summer is UTC+1, in winter UTC+0.
  assert.equal(zonedInstant("2026-07-01", "09:00", "Europe/London").toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(zonedInstant("2026-12-01", "09:00", "Europe/London").toISOString(), "2026-12-01T09:00:00.000Z");
});

test("opening hours are checked, described, and may run past midnight", () => {
  const good = validateWeekHours({ 1: [["09:00", "13:00"], ["14:00", "18:00"]], 5: [["18:00", "01:00"]] });
  assert.ok(good.ok);
  assert.deepEqual(openSpans(good.hours, 5), [[1080, 1500]], "Friday 18:00 to 01:00");
  assert.equal(describeWeek(good.hours), "Mon 09:00–13:00, 14:00–18:00; Tue–Thu closed; Fri 18:00–01:00; Sat–Sun closed");
  for (const [bad, pattern] of [
    [{ 7: [["09:00", "10:00"]] }, /isn't a weekday/],
    [{ 1: [["09:00", "12:00"], ["11:00", "13:00"]] }, /overlap/],
    [{ 1: [["9am", "5pm"]] }, /each span is \[opens, closes\]/],
    [{ 1: [["09:00", "09:00"]] }, /each span/],
    [[], /object of weekdays/],
  ] as const) {
    const checked = validateWeekHours(bad);
    assert.ok(!checked.ok && pattern.test(checked.error), JSON.stringify(bad));
  }
  assert.deepEqual(intersectSpans([[540, 1080]], [[720, 1200]]), [[720, 1080]]);
});

test("free times: every interval from opening, ending by closing, after the notice, with someone free", () => {
  const policy = { openingHours: { 1: [["09:00", "12:00"]] } as const, slotIntervalMinutes: 30, minNoticeHours: 0, bookingHorizonDays: 365 };
  const amina = person("amina");
  const brian = person("brian", { hours: { 1: [["10:00", "12:00"]] } });
  const now = new Date("2026-10-20T00:00:00Z");
  const busy = {
    bookings: [{ id: "x", resourceId: "amina", start: zonedInstant("2026-10-26", "09:00", ZONE), end: zonedInstant("2026-10-26", "10:15", ZONE) }],
    blocks: [],
  };
  const slots = freeSlots({ date: "2026-10-26", timeZone: ZONE, policy: policy as never, offering: { durationMinutes: 60, bufferMinutes: 0 }, resources: [amina, brian], busy, now });
  assert.deepEqual(slots.map((slot) => [slot.time, slot.resourceIds]), [
    ["10:00", ["brian"]],
    ["10:30", ["amina", "brian"]],
    ["11:00", ["amina", "brian"]],
  ], "09:00 and 09:30: Amina is booked and Brian starts at 10:00; 11:30 would end after closing");
  const soon = freeSlots({ date: "2026-10-26", timeZone: ZONE, policy: { ...policy, minNoticeHours: 1 } as never, offering: { durationMinutes: 60, bufferMinutes: 0 }, resources: [amina], busy: { bookings: [], blocks: [] }, now: zonedInstant("2026-10-26", "09:40", ZONE) });
  assert.deepEqual(soon.map((slot) => slot.time), ["11:00"], "an hour's notice from 09:40");
  const closed = { bookings: [], blocks: [{ resourceId: null, start: zonedInstant("2026-10-26", "09:00", ZONE), end: zonedInstant("2026-10-26", "12:00", ZONE) }] };
  assert.equal(resourceBusy("amina", zonedInstant("2026-10-26", "10:00", ZONE), zonedInstant("2026-10-26", "11:00", ZONE), zonedInstant("2026-10-26", "11:00", ZONE), closed), true, "the whole business closed");
});

test("a resource's hours past midnight count on the next day", () => {
  const table = person("t1", { kind: "table", seats: 4 });
  const friday = { 5: [["18:00", "01:00"]] } as never;
  assert.equal(resourceWorks(table, friday, zonedInstant("2026-10-30", "23:30", ZONE), zonedInstant("2026-10-31", "01:00", ZONE), ZONE), true);
  assert.equal(resourceWorks(table, friday, zonedInstant("2026-10-31", "00:30", ZONE), zonedInstant("2026-10-31", "01:30", ZONE), ZONE), false, "ends after closing");
});

test("tables: the smallest that seats the party, never a big table held for big groups", () => {
  const tables = [person("t6", { kind: "table", seats: 6, minParty: 5 }), person("t4", { kind: "table", seats: 4 }), person("t2", { kind: "table", seats: 2 })];
  const dinner = { id: "d", kind: "table" as const };
  assert.deepEqual(eligibleResources(dinner, tables, [], 2).map((table) => table.id), ["t2", "t4"]);
  assert.deepEqual(eligibleResources(dinner, tables, [], 5).map((table) => table.id), ["t6"]);
  assert.deepEqual(eligibleResources({ id: "cut", kind: "service" }, [...tables, person("amina")], [], 1).map((entry) => entry.id), ["amina"], "services don't take tables");
  assert.deepEqual(eligibleResources({ id: "cut", kind: "service" }, [person("amina"), person("brian")], [{ offeringId: "cut", resourceId: "brian" }], 1).map((entry) => entry.id), ["brian"], "only who's listed");
});

test("a slot's price: per booking, per person, fees, tax and the business's deposit", () => {
  const quote = quoteSlot({
    rules: { price: 150_000, per_person: 50_000, fees: [{ name: "Towel", amount: 10_000, per: "guest" }] },
    service: "Spa day", startsAt: new Date(), durationMinutes: 120, party: 2, currency: "KES",
    tax: { name: "VAT", percent: 16, included: true }, deposit: { type: "percent", percent: 50 },
  });
  assert.deepEqual(quote.lines.map((line) => `${line.label}: ${line.display}`), ["Spa day: KSh 1,500", "2 people × KSh 500: KSh 1,000", "Towel (2 people): KSh 200", "Includes VAT 16%: KSh 372.41"]);
  assert.equal(quote.total, 270_000);
  assert.equal(quote.deposit, 135_000);
  const free = quoteSlot({ rules: {}, service: "Dinner", startsAt: new Date(), durationMinutes: 90, party: 4, currency: "KES", tax: null, deposit: { type: "fixed", fixedMinor: 100_000 } });
  assert.equal(free.total, 0);
  assert.equal(free.deposit, 0, "nothing to pay on a free table");
  assert.ok(!validateSlotPricing({ price: 100, nightly: 5 }).ok);
  assert.ok(!validateSlotPricing({ deposit_percent: 20, deposit_fixed: 100 }).ok);
});

test("a slot's payment block says the time is held and the rest is paid on arrival", () => {
  const result = {
    ok: true, booking_id: "b", reference: "K7Q2MPXA", status: "held_for_deposit", slot: true, payment_link: "https://zaina.example/pay/abcdefghijklmnopqrstuvwx",
    deposit_display: "KSh 750", deposit_percent: 50, total_display: "KSh 1,500", hold_until: "2:30 PM on Mon 26 Oct (Kenya time)", pay_by: "M-Pesa",
  };
  const details = paymentDetailsFromToolResult("create_appointment", result);
  assert.ok(details?.slot);
  const reply = composeCustomerReply("Booked!", [details!]);
  assert.match(reply, /Pay the 50% deposit of KSh 750/);
  assert.match(reply, /This time is held until 2:30 PM on Mon 26 Oct \(Kenya time\); after that it may go to someone else\./);
  assert.match(reply, /The rest is paid when you arrive\./);
  const full = composeCustomerReply("Booked!", [paymentDetailsFromToolResult("create_appointment", { ...result, deposit_percent: undefined, pays_in_full: true })!]);
  assert.match(full, /Pay the full amount of KSh 750/);
  assert.doesNotMatch(full, /The rest is paid/);
});

test("a phone number ends at the end of a sentence", () => {
  assert.deepEqual(phoneNumbersWritten("I'm Jane, 0712345678. 2pm please"), ["0712345678"]);
  assert.deepEqual(phoneNumbersWritten("Call +254 712 345 678 or 0722-333-444."), ["+254 712 345 678", "0722-333-444"]);
  assert.equal(sharesPhoneNumber("0712345678", "jane, 0712345678. 2pm with brian"), true);
  assert.equal(sharesPhoneNumber("0712 345 678", "call me on 0712.345.678"), true);
});
