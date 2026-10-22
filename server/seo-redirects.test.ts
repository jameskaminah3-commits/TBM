import test from "node:test";
import assert from "node:assert/strict";
import { getSeoRedirect } from "./seo-redirects.ts";

test("one address per page", () => {
  assert.equal(getSeoRedirect("/accommodations/"), "/accommodations");
  assert.equal(getSeoRedirect("/accommodations/", "?destination=Diani"), "/accommodations?destination=Diani");
  assert.equal(getSeoRedirect("/index.html"), "/");
  assert.equal(getSeoRedirect("/articles"), "/blog");
  assert.equal(getSeoRedirect("/articles/diani-or-watamu/"), "/blog/diani-or-watamu");
  assert.equal(getSeoRedirect("/transport"), "/services/drive");
  assert.equal(getSeoRedirect("/chef/"), "/services/dine");
});

test("pages already at their address stay put", () => {
  for (const path of ["/", "/accommodations", "/transport/ux-car-noah/toyota-noah", "/blog/diani-or-watamu", "/explore/diani/stays"]) {
    assert.equal(getSeoRedirect(path, "?x=1"), null, path);
  }
});
