import assert from "node:assert/strict";
import test from "node:test";
import { customerGaveContact } from "../../src/conversations/handoff.ts";
import { phoneKey } from "../../src/conversations/retention.ts";
import { describeOpening, isStaffedAt, nextStaffedAt, timeZoneLabel } from "../../src/conversations/staffed-hours.ts";

const DAILY = { days: [0, 1, 2, 3, 4, 5, 6], open: "07:00", close: "22:00" };
const NAIROBI = "Africa/Nairobi";
// Kenya is UTC+3: 07:00 in Nairobi is 04:00 UTC.
const at = (kenyaTime: string, day = "2026-09-25") => new Date(`${day}T${kenyaTime}:00+03:00`);

test("staffed hours are read on the business's own clock", () => {
  assert.equal(isStaffedAt(DAILY, NAIROBI, at("06:59")), false);
  assert.equal(isStaffedAt(DAILY, NAIROBI, at("07:00")), true);
  assert.equal(isStaffedAt(DAILY, NAIROBI, at("21:59")), true);
  assert.equal(isStaffedAt(DAILY, NAIROBI, at("22:00")), false);
  assert.equal(isStaffedAt(null, NAIROBI, at("03:00")), true);
});

test("weekdays and windows past midnight", () => {
  const weekdays = { days: [1, 2, 3, 4, 5], open: "08:00", close: "17:00" };
  // 2026-09-26 is a Saturday.
  assert.equal(isStaffedAt(weekdays, NAIROBI, at("10:00", "2026-09-26")), false);
  assert.equal(isStaffedAt(weekdays, NAIROBI, at("10:00", "2026-09-25")), true);
  const lateShift = { days: [5], open: "20:00", close: "02:00" };
  assert.equal(isStaffedAt(lateShift, NAIROBI, at("23:30", "2026-09-25")), true);
  // Saturday 01:00 belongs to Friday's shift; Saturday 23:30 doesn't.
  assert.equal(isStaffedAt(lateShift, NAIROBI, at("01:00", "2026-09-26")), true);
  assert.equal(isStaffedAt(lateShift, NAIROBI, at("23:30", "2026-09-26")), false);
});

test("when the team is next on, in words the customer understands", () => {
  const lateNight = at("23:10");
  const opening = nextStaffedAt(DAILY, NAIROBI, lateNight);
  assert.equal(opening?.toISOString(), at("07:00", "2026-09-26").toISOString());
  assert.equal(describeOpening(opening!, NAIROBI, lateNight), "tomorrow at 7:00 AM");
  const early = at("05:40");
  assert.equal(describeOpening(nextStaffedAt(DAILY, NAIROBI, early)!, NAIROBI, early), "at 7:00 AM");
  const friday = at("18:00");
  const weekdays = { days: [1, 2, 3, 4, 5], open: "08:00", close: "17:00" };
  assert.equal(describeOpening(nextStaffedAt(weekdays, NAIROBI, friday)!, NAIROBI, friday), "on Monday at 8:00 AM");
  assert.equal(nextStaffedAt(null, NAIROBI, early), null);
  assert.equal(timeZoneLabel(NAIROBI), "Kenya time");
  assert.equal(timeZoneLabel("Africa/Dar_es_Salaam"), "Dar es Salaam time");
});

test("a callback needs a way to reach the customer", () => {
  assert.equal(customerGaveContact(["Hi, I'm Amina", "amina@example.com"]), true);
  assert.equal(customerGaveContact(["call me on 0712 345 678"]), true);
  assert.equal(customerGaveContact(["I want a villa for 4", "budget 20000"]), false);
});

test("a phone number matches however it was written", () => {
  assert.equal(phoneKey("0712 345 678"), "712345678");
  assert.equal(phoneKey("+254 712 345 678"), "712345678");
  assert.equal(phoneKey("12"), null);
});
