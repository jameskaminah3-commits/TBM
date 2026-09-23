import assert from "node:assert/strict";
import test from "node:test";
import { getPublicListingPath, slugifyForUrl } from "./seo.ts";

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
