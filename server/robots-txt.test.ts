import test from "node:test";
import assert from "node:assert/strict";
import { buildRobotsTxt, isDisallowedByRobots } from "./robots-txt.ts";

const robots = buildRobotsTxt("https://tembeabilamatata.com/");

test("Google may load the data public pages are built from", () => {
  // Listing, article, area and provider pages load these while Google renders them.
  for (const path of [
    "/api/stays/c0e22a45-d8f7-4028-9c8c-4db6b26b7352",
    "/api/cars/1",
    "/api/cooks/1",
    "/api/errands/1",
    "/api/experiences/1",
    "/api/reviews/stay/1",
    "/api/blog/diani-or-watamu",
    "/api/seo/areas/diani/stays",
    "/api/public/providers/ab3k7mnp",
    "/api/currency/rates",
  ]) {
    assert.equal(isDisallowedByRobots(robots, path), false, path);
  }
});

test("public pages are open to search engines", () => {
  for (const path of ["/", "/accommodations", "/accommodation/abc/villa-diani", "/blog/diani-or-watamu", "/explore/diani/stays", "/p/ab3k7mnp/jane-diani", "/partner", "/verify"]) {
    assert.equal(isDisallowedByRobots(robots, path), false, path);
  }
});

test("private pages stay closed", () => {
  for (const path of ["/auth", "/auth?next=/accommodation/abc", "/admin/dashboard", "/provider/dashboard", "/book/abc", "/bookings", "/b/s/1a2b3c4d", "/inbox"]) {
    assert.equal(isDisallowedByRobots(robots, path), true, path);
  }
});

test("the sitemap is named once, at the site's own address", () => {
  assert.match(robots, /\nSitemap: https:\/\/tembeabilamatata\.com\/sitemap\.xml\n/);
  assert.equal(robots.match(/Sitemap:/g)?.length, 1);
});
