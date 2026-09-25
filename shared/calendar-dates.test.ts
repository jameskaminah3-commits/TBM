import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  addCalendarDays,
  daysBetweenCalendarDates,
  formatCalendarDate,
  formatCalendarDateRange,
  formatKenyaClockTime,
  formatKenyaDateTime,
  isCalendarDate,
  kenyaClockMinutes,
  kenyaDateTimeToIso,
  parseCalendarDate,
  toCalendarDate,
  todayInKenya,
} from "./calendar-dates.ts";

test("a calendar date reads the same in every time zone", () => {
  // The same check run under several clocks, as browsers around the world would.
  const script = `
    import { formatCalendarDate, formatCalendarDateRange, parseCalendarDate, toCalendarDate } from "./shared/calendar-dates.ts";
    console.log(JSON.stringify([
      formatCalendarDate("2026-12-20"),
      formatCalendarDateRange("2026-12-20", "2026-12-27"),
      toCalendarDate(parseCalendarDate("2026-12-20")),
      parseCalendarDate("2026-12-20").getDate(),
    ]));
  `;
  const results = ["America/Los_Angeles", "America/New_York", "UTC", "Africa/Nairobi", "Asia/Tokyo", "Pacific/Kiritimati"].map((zone) => {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
      env: { ...process.env, TZ: zone },
      encoding: "utf8",
    });
    return run.stdout.trim();
  });
  for (const result of results) {
    assert.equal(result, JSON.stringify(["Dec 20, 2026", "Dec 20 – 27, 2026", "2026-12-20", 20]));
  }
});

test("date ranges read naturally", () => {
  assert.equal(formatCalendarDateRange("2026-12-20", "2026-12-20"), "Dec 20, 2026");
  assert.equal(formatCalendarDateRange("2026-11-28", "2026-12-02"), "Nov 28 – Dec 2, 2026");
  assert.equal(formatCalendarDateRange("2026-12-30", "2027-01-02"), "Dec 30, 2026 – Jan 2, 2027");
  assert.equal(formatCalendarDate("2026-12-20", { weekday: "short", month: "short", day: "numeric" }), "Sun, Dec 20");
});

test("calendar dates are validated and counted without clocks", () => {
  assert.equal(isCalendarDate("2026-12-20"), true);
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("2026-12-20T09:00:00Z"), false);
  assert.equal(parseCalendarDate("nonsense"), null);
  assert.equal(daysBetweenCalendarDates("2026-12-20", "2026-12-27"), 7);
  // Across a US daylight-saving change, a night is still a night.
  assert.equal(daysBetweenCalendarDates("2026-03-07", "2026-03-09"), 2);
  assert.equal(addCalendarDays("2026-12-27", -1), "2026-12-26");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.throws(() => addCalendarDays("2026-02-30", 1));
});

test("today is Kenya's today", () => {
  // 22:30 on 19 Dec in New York is already 20 Dec in Kenya.
  assert.equal(todayInKenya(new Date("2026-12-20T03:30:00Z")), "2026-12-20");
  assert.equal(todayInKenya(new Date("2026-12-19T20:59:00Z")), "2026-12-19");
  assert.equal(todayInKenya(new Date("2026-12-19T21:00:00Z")), "2026-12-20");
});

test("Kenya times stay Kenya times", () => {
  // A 09:00 departure in Kenya is 06:00 UTC.
  assert.equal(kenyaDateTimeToIso("2026-10-10", "09:00"), "2026-10-10T06:00:00.000Z");
  assert.throws(() => kenyaDateTimeToIso("2026-02-30", "09:00"));
  assert.equal(formatKenyaDateTime("2026-10-10T06:00:00.000Z"), "Sat, Oct 10, 9:00 AM");
  assert.equal(formatKenyaClockTime("06:30"), "6:30 AM");
  assert.equal(formatKenyaClockTime("19:30"), "7:30 PM");
  // 06:15 UTC is 09:15 on the coast; 22:30 UTC is 01:30 the next morning.
  assert.equal(kenyaClockMinutes(new Date("2026-10-10T06:15:00Z")), 9 * 60 + 15);
  assert.equal(kenyaClockMinutes(new Date("2026-10-10T22:30:00Z")), 90);
});
