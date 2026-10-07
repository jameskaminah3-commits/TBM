import { test } from "node:test";
import assert from "node:assert/strict";
import { stayRefundIfCancelledToday } from "./cancellation-policy.ts";

test("a stay more than 30 days away gets 80% back until 31 days before arrival", () => {
  assert.deepEqual(stayRefundIfCancelledToday("2026-11-06", "2026-10-01"), { refundPercent: 80, lastDay: "2026-10-06" });
  // 31 days before is the last day of the 80% tier.
  assert.deepEqual(stayRefundIfCancelledToday("2026-11-06", "2026-10-06"), { refundPercent: 80, lastDay: "2026-10-06" });
});

test("each tier ends the day before the next one starts", () => {
  assert.deepEqual(stayRefundIfCancelledToday("2026-11-06", "2026-10-07"), { refundPercent: 70, lastDay: "2026-10-16" });
  assert.deepEqual(stayRefundIfCancelledToday("2026-11-06", "2026-10-17"), { refundPercent: 60, lastDay: "2026-10-23" });
  assert.deepEqual(stayRefundIfCancelledToday("2026-11-06", "2026-10-24"), { refundPercent: 50, lastDay: "2026-10-30" });
  assert.deepEqual(stayRefundIfCancelledToday("2026-11-06", "2026-10-31"), { refundPercent: 30, lastDay: "2026-11-04" });
});

test("within 48 hours of arrival there is no refund", () => {
  assert.deepEqual(stayRefundIfCancelledToday("2026-11-06", "2026-11-05"), { refundPercent: 0, lastDay: null });
  assert.deepEqual(stayRefundIfCancelledToday("2026-11-06", "2026-11-06"), { refundPercent: 0, lastDay: null });
});
