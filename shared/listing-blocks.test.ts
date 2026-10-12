import assert from "node:assert/strict";
import test from "node:test";
import { expandBlockDates, getServiceBookingDates, listingBlockInputSchema } from "./listing-blocks.ts";

test("a block needs real dates, and the last day can't be before the first", () => {
  assert.ok(listingBlockInputSchema.parse({ startDate: "2026-11-20", endDate: "2026-11-22" }));
  assert.ok(listingBlockInputSchema.parse({ startDate: "2026-11-20", endDate: "2026-11-20", reason: "Family wedding" }));
  assert.throws(() => listingBlockInputSchema.parse({ startDate: "2026-11-22", endDate: "2026-11-20" }));
  assert.throws(() => listingBlockInputSchema.parse({ startDate: "20/11/2026", endDate: "2026-11-22" }));
  assert.throws(() => listingBlockInputSchema.parse({ startDate: "2026-11-20", endDate: "2026-11-22", reason: "x".repeat(121) }));
});

test("block dates include both ends and cross months", () => {
  assert.deepEqual(expandBlockDates("2026-11-29", "2026-12-02"), ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
  assert.equal(expandBlockDates("2026-01-01", "2030-01-01").length, 400);
});

test("a service booking takes up its visits, or every day it runs", () => {
  assert.deepEqual(getServiceBookingDates({ checkIn: "2026-11-20", checkOut: "2026-11-25", serviceScheduleSlots: [{ date: "2026-11-23" }, { date: "2026-11-21" }, { date: "2026-11-21" }] }), ["2026-11-21", "2026-11-23"]);
  assert.deepEqual(getServiceBookingDates({ checkIn: "2026-11-20", checkOut: "2026-11-22" }), ["2026-11-20", "2026-11-21", "2026-11-22"]);
  assert.deepEqual(getServiceBookingDates({ checkIn: "2026-11-20", checkOut: null }), ["2026-11-20"]);
});
