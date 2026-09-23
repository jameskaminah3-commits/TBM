import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListingSeoDescription,
  formatSeoLocation,
  getListingSeoTitle,
  getPublicListingPath,
  slugifyForUrl,
} from "./seo.ts";

test("slugifies listing names without changing the stable identifier", () => {
  assert.equal(slugifyForUrl("Chef Amina's Nyali Seafood Menu"), "chef-amina-s-nyali-seafood-menu");
  assert.equal(
    getPublicListingPath("car", "vehicle-123", "Mazda Axela — Nyali"),
    "/transport/vehicle-123/mazda-axela-nyali",
  );
});

test("supports public paths for every indexable listing category", () => {
  assert.equal(getPublicListingPath("stay", "stay-1", "Three Bedroom Apartment"), "/accommodation/stay-1/three-bedroom-apartment");
  assert.equal(getPublicListingPath("cook", "cook-1", "Private Chef"), "/chef/cook-1/private-chef");
  assert.equal(getPublicListingPath("errand", "errand-1", "Holiday Shopping"), "/errand/errand-1/holiday-shopping");
  assert.equal(getPublicListingPath("experience", "experience-1", "Old Town Food Walk"), "/experience/experience-1/old-town-food-walk");
});

test("normalizes local listing locations into a crawlable hierarchy", () => {
  assert.equal(formatSeoLocation("Nyali, Mombasa Kenya"), "Nyali, Mombasa, Kenya");
  assert.equal(formatSeoLocation("Diani"), "Diani, Kenyan Coast, Kenya");
});

test("keeps generated listing metadata concise while preserving search context", () => {
  const title = getListingSeoTitle("stay", "3 Bedroom Beachfront Apartment — Nyali (C2)", "Nyali, Mombasa Kenya");
  const description = buildListingSeoDescription([
    "3-bedroom accommodation in Nyali, Mombasa, Kenya with 3 bathrooms for up to 6 guests from 118 USD per night.",
    "Set within a premium beachfront property with ocean views, pool, WiFi and parking.",
  ]);

  assert.ok(title.length <= 75);
  assert.match(title, /Nyali, Mombasa/);
  assert.ok(description.length <= 160);
  assert.match(description, /118 USD per night/);
});
