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

test("a home's exact pin stays out of its public listing; a hotel's, or one its owner shows, goes out", () => {
  const pin = "https://maps.app.goo.gl/AbC123xyz";
  const home = toPublicListing({ id: "s1", title: "Villa", propertyType: "entire_place", mapUrl: pin, showExactLocation: null });
  assert.equal(home.mapUrl, null);
  const shown = toPublicListing({ id: "s2", title: "Villa", propertyType: "entire_place", mapUrl: pin, showExactLocation: true });
  assert.equal(shown.mapUrl, pin);
  const hotel = toPublicListing({ id: "s3", title: "Hotel", propertyType: "hotel", mapUrl: pin, showExactLocation: null });
  assert.equal(hotel.mapUrl, pin);
  const hidden = toPublicListing({ id: "s4", title: "Hotel", propertyType: "hotel", mapUrl: pin, showExactLocation: false });
  assert.equal(hidden.mapUrl, null);
  // Listings without a place on the map are left as they are.
  assert.equal("mapUrl" in toPublicListing({ id: "c1", model: "Prado" }), false);
});
