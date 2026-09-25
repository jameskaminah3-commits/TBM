import assert from "node:assert/strict";
import test from "node:test";
import { bookingDepositPercent } from "../../shared/booking-payments.ts";
import { INVENTORY_CATALOG } from "./catalog.ts";

const catalogText = JSON.stringify(INVENTORY_CATALOG);

test("catalog deposit facts come from the shared booking payment rules", () => {
  assert.equal(INVENTORY_CATALOG.payment_methods.deposit_policy.percent, bookingDepositPercent);
  assert.equal(INVENTORY_CATALOG.booking_rules.deposit_percent, bookingDepositPercent);
});

test("catalog carries no hard-coded fees, discounts, or exchange rates", () => {
  assert.doesNotMatch(catalogText, /fee_usd|kes_fallback_rate|stay_plus_chef|bundle_discount/);
  assert.doesNotMatch(catalogText, /\b12%|\$\d/);
});

test("catalog never promises free cancellation and points to the published policy", () => {
  assert.doesNotMatch(catalogText, /free cancellation up to/i);
  assert.match(INVENTORY_CATALOG.cancellation_policy.policy_url, /\/refund-cancellation$/);
});

test("external listing checks route to the dedicated verification request", () => {
  assert.equal(INVENTORY_CATALOG.property_verification.request_tool, "create_listing_verification_request");
  const tierIds = INVENTORY_CATALOG.custom_offer_policy.tiers.map((tier) => tier.id);
  assert.deepEqual(tierIds, ["intake", "proposal"]);
  for (const entry of INVENTORY_CATALOG.custom_offer_policy.decision_tree) {
    assert.notEqual(entry.tier, "verification");
  }
});

test("a budget nothing listed fits leads to a custom offer with the budget attached", () => {
  const policy = INVENTORY_CATALOG.custom_offer_policy;
  assert.match(policy.when_to_use, /budget/);
  const budgetEntries = policy.decision_tree.filter((entry) => /budget/.test(entry.scenario));
  assert.deepEqual(budgetEntries.map((entry) => entry.tier).sort(), ["intake", "proposal"]);
  for (const entry of budgetEntries) {
    assert.match(entry.reason, /budget_amount and budget_currency/);
  }
});
