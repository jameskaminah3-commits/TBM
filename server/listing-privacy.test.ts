import assert from "node:assert/strict";
import test from "node:test";
import { privateListingFields, toPublicListing, withoutProviderProtectedFields } from "./listing-privacy.ts";

test("public listings carry no owner account or vehicle papers", () => {
  const car = {
    id: "car-1",
    model: "Land Cruiser Prado",
    pricePerDay: 95,
    isPublic: true,
    managerUserId: "provider-1",
    documents: [{ kind: "logbook", url: "/uploads/logbook.jpg" }],
    registrationNumber: "KDA 123A",
    ownershipType: "individual",
    mileage: 84000,
    availabilityPreference: "weekends",
    chauffeurArrangement: "owner-drives",
  };

  const publicCar = toPublicListing(car);
  for (const field of privateListingFields) {
    assert.equal(field in publicCar, false, `${field} should be removed`);
  }
  assert.deepEqual(publicCar, { id: "car-1", model: "Land Cruiser Prado", pricePerDay: 95, isPublic: true });
  assert.equal(car.managerUserId, "provider-1", "the stored listing is not changed");
});

test("listings without private fields pass through unchanged", () => {
  const stay = { id: "stay-1", title: "Villa", price: 320, rating: 5, reviewCount: 21 };
  assert.deepEqual(toPublicListing(stay), stay);
});

test("providers can't set owner, visibility, rating or review count", () => {
  const body = { title: "Dhow cruise", managerUserId: "someone-else", isPublic: true, rating: 5, reviewCount: 4321 };
  assert.deepEqual(withoutProviderProtectedFields(body, false), { title: "Dhow cruise" });
});

test("the admin keeps full control", () => {
  const body = { title: "Dhow cruise", managerUserId: "provider-2", rating: 4, reviewCount: 12 };
  assert.deepEqual(withoutProviderProtectedFields(body, true), body);
});

test("non-object bodies are left for validation to reject", () => {
  assert.equal(withoutProviderProtectedFields(null, false), null);
  assert.equal(withoutProviderProtectedFields("text", false), "text");
});
