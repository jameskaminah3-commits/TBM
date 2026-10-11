import assert from "node:assert/strict";
import test from "node:test";
import { toPartnerAvailability, toPublicAvailability } from "./availability-view.ts";

const summary = {
  availableFrom: "2026-11-25",
  blockedRanges: [
    { id: "8617c17b-aaaa-bbbb-cccc-000000000001", source: "booking", startDate: "2026-11-20", endDate: "2026-11-23", checkoutDate: "2026-11-24", status: "upcoming", guestName: "Jane Test", serviceMode: "car-self-drive" },
    { id: "99999999-aaaa-bbbb-cccc-000000000002", source: "booking", startDate: "2026-12-01", endDate: "2026-12-02", checkoutDate: "2026-12-03", status: "pending", guestName: "Someone Else" },
    { id: "block-1", source: "manual", startDate: "2026-12-10", endDate: "2026-12-11", checkoutDate: "2026-12-12", status: "blocked", guestName: "Manual block" },
  ],
};

test("a visitor sees which dates are taken, with no booking IDs or names", () => {
  const view = toPublicAvailability(summary);
  assert.equal(view.availableFrom, "2026-11-25");
  assert.deepEqual(view.blockedRanges.map((range) => [range.startDate, range.endDate]), [["2026-11-20", "2026-11-23"], ["2026-12-01", "2026-12-02"], ["2026-12-10", "2026-12-11"]]);
  const text = JSON.stringify(view);
  assert.doesNotMatch(text, /Jane|Someone|8617c17b|99999999|block-1|car-self-drive/);
});

test("a provider sees their own jobs by booking reference, other bookings as holds, and their own blocks", () => {
  const view = toPartnerAvailability(summary, new Set(["8617c17b-aaaa-bbbb-cccc-000000000001"]));
  assert.equal(view.blockedRanges[0].guestName, "Booking 8617C17B");
  assert.equal(view.blockedRanges[1].guestName, "Held for a guest");
  assert.equal(view.blockedRanges[1].id, "held-2");
  assert.equal(view.blockedRanges[2].id, "block-1", "manual blocks keep their ID so the provider can remove them");
  assert.doesNotMatch(JSON.stringify(view), /Jane|Someone|99999999/);
});
