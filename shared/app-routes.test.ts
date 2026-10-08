import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appRoutePaths, isKnownAppPath } from "./app-routes.ts";
import { staticPageKey, staticPageMetadata } from "./page-metadata.ts";

test("the server's page list matches the site's routes", () => {
  const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  const routes = Array.from(new Set(Array.from(appSource.matchAll(/path="([^"]+)"/g), (match) => match[1]))).sort();
  assert.deepEqual([...appRoutePaths].sort(), routes);
});

test("pages are known, with their varying parts and a trailing slash", () => {
  assert.equal(isKnownAppPath("/"), true);
  assert.equal(isKnownAppPath("/verify"), true);
  assert.equal(isKnownAppPath("/Verify/"), true);
  assert.equal(isKnownAppPath("/accommodation/ux-villa-diani/beachfront-villa"), true);
  assert.equal(isKnownAppPath("/book/car/ux-car-prado"), true);
  assert.equal(isKnownAppPath("/admin/stays/abc/edit"), true);
});

test("anything else is not a page", () => {
  assert.equal(isKnownAppPath("/no-such-page"), false);
  assert.equal(isKnownAppPath("/accommodation"), false);
  assert.equal(isKnownAppPath("/accommodation/a/b/c"), false);
  assert.equal(isKnownAppPath("/wp-login.php"), false);
});

test("a fixed page's title is found however its address is written", () => {
  assert.equal(staticPageKey("/Accommodations/"), "/accommodations");
  assert.equal(staticPageKey("/services/drive/?mode=self"), "/services/drive");
  assert.equal(staticPageKey("/"), "/");
  assert.ok(staticPageMetadata[staticPageKey("/FAQ")]);
});
