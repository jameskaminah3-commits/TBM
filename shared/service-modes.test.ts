import assert from "node:assert/strict";
import test from "node:test";
import { getReservationStatusLabel, getServiceModeLabel } from "./service-modes.ts";

test("booking codes read as words providers use", () => {
  assert.equal(getServiceModeLabel("cook-service-fee"), "Chef's service, guest buys the food");
  assert.equal(getServiceModeLabel("car-self-drive-day"), "Self-drive");
  assert.equal(getServiceModeLabel("errand-childcare"), "Help Mama (family care)");
  assert.equal(getServiceModeLabel("something-new"), null);
  assert.equal(getServiceModeLabel(null), null);
});

test("reservation statuses read as words", () => {
  assert.equal(getReservationStatusLabel("confirmed"), "Booked");
  assert.equal(getReservationStatusLabel("pending"), "Being booked");
  assert.equal(getReservationStatusLabel("on-hold"), "On hold");
});
