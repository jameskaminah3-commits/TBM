import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListingSeoDescription,
  formatSeoLocation,
  buildListingSeoTitle,
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

  assert.ok(title.length <= 60);
  assert.match(title, /Nyali/);
  assert.ok(description.length <= 160);
  assert.match(description, /118 USD per night/);
});

test("listing titles fit in 60 characters, say the place once and never end in ...", () => {
  assert.equal(buildListingSeoTitle("stay", "Bahari Beach Hotel – Nyali", "Nyali"), "Bahari Beach Hotel in Nyali | Tembea Bila Matata");
  assert.equal(buildListingSeoTitle("stay", "Garden Cottage near Turtle Bay – Watamu", "Watamu"), "Garden Cottage near Turtle Bay in Watamu | TBM");
  assert.equal(buildListingSeoTitle("car", "Toyota Noah – 7 Seater", "Mombasa"), "Toyota Noah – 7 Seater, car hire in Mombasa | TBM");
  assert.equal(buildListingSeoTitle("cook", "Chef Amina – Swahili Coastal Cuisine", "Diani"), "Chef Amina, private chef in Diani | Tembea Bila Matata");
  assert.equal(buildListingSeoTitle("stay", "Diani Beach Villa", "Diani"), "Diani Beach Villa | Tembea Bila Matata");
  const long = buildListingSeoTitle("experience", "A very long full-day guided tour of the old town, the fort and the spice market with lunch", "Mombasa");
  assert.ok(long.length <= 60, long);
  assert.doesNotMatch(long, /\.\.\.|…/);
});
