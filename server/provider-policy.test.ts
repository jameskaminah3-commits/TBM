import assert from "node:assert/strict";
import test from "node:test";
import { canRespondToAssignment } from "./provider-policy.ts";

test("a provider can accept or decline a new assignment", () => {
  const fresh = { status: "upcoming", providerResponse: "pending" };
  assert.deepEqual(canRespondToAssignment(fresh, "accepted"), { allowed: true });
  assert.deepEqual(canRespondToAssignment(fresh, "declined"), { allowed: true });
  assert.deepEqual(canRespondToAssignment({ status: "upcoming", providerResponse: null }, "declined"), { allowed: true });
});

test("after accepting, a provider can't decline; they message TBM instead", () => {
  const decision = canRespondToAssignment({ status: "upcoming", providerResponse: "accepted" }, "declined");
  assert.equal(decision.allowed, false);
  assert.match(!decision.allowed ? decision.reason : "", /Admin Channel/);
  assert.deepEqual(canRespondToAssignment({ status: "upcoming", providerResponse: "accepted" }, "accepted"), { allowed: true });
});

test("a declined, started, finished or cancelled job can't be answered again", () => {
  assert.equal(canRespondToAssignment({ status: "upcoming", providerResponse: "declined" }, "accepted").allowed, false);
  assert.equal(canRespondToAssignment({ status: "in-progress", providerResponse: "accepted" }, "declined").allowed, false);
  assert.equal(canRespondToAssignment({ status: "completed", providerResponse: "accepted" }, "declined").allowed, false);
  assert.equal(canRespondToAssignment({ status: "cancelled", providerResponse: "pending" }, "accepted").allowed, false);
});
