import assert from "node:assert/strict";
import test from "node:test";
import { deriveIdempotencyKey, withServerIdempotencyKey } from "./idempotency.ts";

const verification = {
  listing_url: "https://www.facebook.com/marketplace/item/111/",
  verification_scope: "Check the property exists",
  customer_name: "Jane Wanjiru",
  customer_email: "jane@example.com",
};

test("the model's own key is ignored and replaced by a server key", () => {
  const args = withServerIdempotencyKey("create_listing_verification_request", { ...verification, idempotency_key: "***masked***" }, "session-a");
  assert.match(args.idempotency_key, /^zaina_[0-9a-f]{40}$/);
  assert.notEqual(args.idempotency_key, "***masked***");
});

test("an identical retry in the same conversation gets the same key", () => {
  const first = deriveIdempotencyKey("session-a", "create_listing_verification_request", verification);
  const retry = deriveIdempotencyKey("session-a", "create_listing_verification_request", {
    ...verification,
    idempotency_key: "anything-else",
    customer_name: "  jane   WANJIRU ",
  });
  assert.equal(first, retry);
});

test("different conversations or different requests never share a key", () => {
  const a = deriveIdempotencyKey("session-a", "create_listing_verification_request", verification);
  assert.notEqual(a, deriveIdempotencyKey("session-b", "create_listing_verification_request", verification));
  assert.notEqual(a, deriveIdempotencyKey("session-a", "create_listing_verification_request", { ...verification, listing_url: "https://jiji.co.ke/x" }));
  assert.notEqual(a, deriveIdempotencyKey("session-a", "create_custom_offer", verification));
});

test("read-only tools are left untouched", () => {
  assert.deepEqual(withServerIdempotencyKey("search_stays", { region: "Diani" }, "session-a"), { region: "Diani" });
});
