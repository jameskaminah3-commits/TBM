import test from "node:test";
import assert from "node:assert/strict";
import { cleanInternalHref } from "./internal-links.ts";

const live = new Set(["/explore/nyali/stays", "/explore/diani/stays"]);

test("tracking tags come off internal links", () => {
  assert.equal(
    cleanInternalHref("/accommodation/abc/villa?sourceType=blog&sourceId=8dc8&sourceSlug=x&utm_source=blog&utm_medium=content&utm_campaign=x"),
    "/accommodation/abc/villa",
  );
  assert.equal(cleanInternalHref("/verify?utm_source=blog#how"), "/verify#how");
  assert.equal(cleanInternalHref("https://tembeabilamatata.com/blog/diani?fbclid=1"), "/blog/diani");
});

test("a filtered stays list becomes its live area page", () => {
  assert.equal(
    cleanInternalHref("/accommodations?destination=Nyali&sort=capacity&sourceType=blog&sourceId=8dc8", live),
    "/explore/nyali/stays",
  );
  assert.equal(cleanInternalHref("/accommodations?destination=Galu%20Beach", live), "/explore/diani/stays");
});

test("a filter stays when there is no live area page, or the search is specific", () => {
  assert.equal(cleanInternalHref("/accommodations?destination=Watamu", live), "/accommodations?destination=Watamu");
  assert.equal(
    cleanInternalHref("/accommodations?destination=Nyali&checkIn=2026-12-20&checkOut=2026-12-27", live),
    "/accommodations?destination=Nyali&checkIn=2026-12-20&checkOut=2026-12-27",
  );
});

test("working parameters and other sites are left alone", () => {
  assert.equal(cleanInternalHref("/book/car/abc?promoCode=KARIBU10&utm_source=x"), "/book/car/abc?promoCode=KARIBU10");
  assert.equal(cleanInternalHref("https://www.kws.go.ke/parks?utm_source=tbm"), "https://www.kws.go.ke/parks?utm_source=tbm");
  assert.equal(cleanInternalHref("#faq"), "#faq");
  assert.equal(cleanInternalHref("mailto:hello@example.com"), "mailto:hello@example.com");
});
