import assert from "node:assert/strict";
import test from "node:test";
import { describeListingSource, normalizeListingLink } from "./listing-verification.ts";

test("full links are kept exactly as pasted", () => {
  assert.equal(
    normalizeListingLink("https://www.facebook.com/marketplace/item/111/"),
    "https://www.facebook.com/marketplace/item/111/",
  );
});

test("links pasted without https:// are completed", () => {
  assert.equal(
    normalizeListingLink("jiji.co.ke/diani/houses-apartments-for-rent/2br-abc123.html"),
    "https://jiji.co.ke/diani/houses-apartments-for-rent/2br-abc123.html",
  );
  assert.equal(normalizeListingLink("www.airbnb.com/rooms/123."), "https://www.airbnb.com/rooms/123");
});

test("the link is picked out of surrounding words", () => {
  assert.equal(normalizeListingLink("here it is https://jiji.co.ke/x please check"), "https://jiji.co.ke/x");
});

test("descriptions without a link are not mistaken for links", () => {
  assert.equal(normalizeListingLink(""), null);
  assert.equal(normalizeListingLink("Agent Mary sent photos on WhatsApp, 0712345678"), null);
  assert.equal(normalizeListingLink(undefined), null);
});

test("linked listings are described by platform and location", () => {
  assert.deepEqual(
    describeListingSource("https://jiji.co.ke/diani/villa-222.html", ""),
    { sourcePlatform: "Jiji", location: "Diani" },
  );
  assert.deepEqual(
    describeListingSource("https://www.facebook.com/marketplace/item/111/", "", "Nyali"),
    { sourcePlatform: "Facebook", location: "Nyali" },
  );
});

test("listings without a link are described from the customer's details", () => {
  assert.deepEqual(
    describeListingSource(null, "An agent sent me a 2-bedroom in Mtwapa on WhatsApp, KSh 6,000 a night"),
    { sourcePlatform: "WhatsApp (no link)", location: "Mtwapa" },
  );
  assert.deepEqual(
    describeListingSource(null, "A friend recommended a villa called Palm Breeze"),
    { sourcePlatform: "Agent or private listing (no link)", location: null },
  );
});
