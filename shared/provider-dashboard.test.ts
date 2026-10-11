import assert from "node:assert/strict";
import test from "node:test";
import { awaitsProviderResponse, isAgreedOrder } from "./provider-dashboard.ts";

test("ordinary bookings are agreed, finished or not", () => {
  assert.equal(isAgreedOrder("car-chauffeur-day", {}), true);
  assert.equal(isAgreedOrder(null, {}), true);
});

test("custom menus and custom offers count once the guest accepts the quote", () => {
  assert.equal(isAgreedOrder("cook-custom-menu", { customMenuClientDecision: null }), false);
  assert.equal(isAgreedOrder("cook-custom-menu", { customMenuClientDecision: "accepted" }), true);
  assert.equal(isAgreedOrder("experience-custom-offer", { experienceCustomOfferClientDecision: "declined" }), false);
  assert.equal(isAgreedOrder("experience-custom-offer", { experienceCustomOfferClientDecision: "accepted" }), true);
});

test("upcoming work the provider hasn't answered needs a response", () => {
  assert.equal(awaitsProviderResponse({ status: "upcoming", providerResponse: "pending" }), true);
  assert.equal(awaitsProviderResponse({ status: "upcoming", providerResponse: null }), true);
  assert.equal(awaitsProviderResponse({ status: "upcoming", providerResponse: "accepted" }), false);
  assert.equal(awaitsProviderResponse({ status: "completed", providerResponse: "pending" }), false);
});
