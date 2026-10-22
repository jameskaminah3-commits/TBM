import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isKnownPagePath, knownPagePatterns } from "./known-routes.ts";

const appRoutes = Array.from(
  readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8").matchAll(/path="([^"]+)"/g),
  (match) => match[1],
);

test("the server knows exactly the pages the app's router has", () => {
  assert.deepEqual([...new Set(appRoutes)].sort(), [...knownPagePatterns].sort());
});

test("real pages are known, with or without a trailing slash", () => {
  for (const path of ["/", "/accommodations", "/accommodation/abc", "/accommodation/abc/beach-villa", "/explore/diani/stays", "/blog/diani-or-watamu", "/p/wjgtnw8z/kassim", "/services/drive/"]) {
    assert.equal(isKnownPagePath(path), true, path);
  }
});

test("anything else is not a page", () => {
  for (const path of ["/no-such-page", "/transport", "/accommodation/abc/def/ghi", "/services/drive/extra", "/wp-login.php", "/favicon.ico"]) {
    assert.equal(isKnownPagePath(path), false, path);
  }
});
