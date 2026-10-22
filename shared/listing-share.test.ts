import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListingShareMessage,
  buildListingShareUrl,
  buildWhatsAppShareHref,
  getCarDisplayName,
  formatSharePriceLine,
  getListingSharePrice,
  shortShareDescription,
} from "./listing-share.ts";

const villa = { kind: "stay" as const, id: "4f1c2d9e-0b7a-4c55-9d1e-3a6b8c0d2e11", name: "Beachfront Villa – Diani" };

test("a provider's share link carries their random code, and nothing else about them", () => {
  const url = new URL(buildListingShareUrl("https://tembeabilamatata.com", villa, { source: "provider", channel: "whatsapp", code: "k7m2x9qa4p" }));
  assert.equal(url.searchParams.get("ref"), "k7m2x9qa4p");
  assert.equal(url.searchParams.get("utm_source"), "provider");
  assert.equal(url.searchParams.get("utm_medium"), "whatsapp");
  const plain = new URL(buildListingShareUrl("https://tembeabilamatata.com", villa, { source: "visitor", channel: "copy" }));
  assert.equal(plain.searchParams.has("ref"), false);
});

test("a provider's share link is the public listing page, tagged without naming the account", () => {
  const url = new URL(buildListingShareUrl("https://tembeabilamatata.com", villa, { source: "provider", channel: "whatsapp" }));
  assert.equal(url.pathname, "/accommodation/4f1c2d9e-0b7a-4c55-9d1e-3a6b8c0d2e11/beachfront-villa-diani");
  assert.equal(url.searchParams.get("utm_source"), "provider");
  assert.equal(url.searchParams.get("utm_medium"), "whatsapp");
  assert.equal(url.searchParams.get("utm_campaign"), "listing_share");
  assert.equal([...url.searchParams.keys()].length, 3, "no account or provider ID in the link");
});

test("anyone else's share is tagged as a visitor share", () => {
  const url = new URL(buildListingShareUrl("https://tembeabilamatata.com", { kind: "car", id: "c1", name: "Land Cruiser Prado" }, { source: "visitor", channel: "copy" }));
  assert.equal(url.pathname, "/transport/c1/land-cruiser-prado");
  assert.equal(url.searchParams.get("utm_source"), "share");
});

test("the message uses the listing's own name, a short description and the link, with no price by default", () => {
  const message = buildListingShareMessage({
    kind: "stay",
    name: villa.name,
    description: "A whitewashed villa right on Galu Beach with a private pool. All four bedrooms are en-suite.",
    url: "https://tembeabilamatata.com/accommodation/x",
  });
  assert.equal(message, [
    "Beachfront Villa – Diani, a stay on Tembea Bila Matata",
    "A whitewashed villa right on Galu Beach with a private pool.",
    "Photos, prices and booking: https://tembeabilamatata.com/accommodation/x",
  ].join("\n"));
  assert.doesNotMatch(message, /KSh|\$/);
});

test("a chosen price carries its conditions", () => {
  const line = formatSharePriceLine(41600, "a night");
  assert.equal(line, "From KSh 41,600 a night, subject to availability and TBM's terms.");
  const message = buildListingShareMessage({ kind: "cook", name: "Chef Amina", url: "https://t.co/x", priceLine: line });
  assert.match(message, /^Chef Amina, a chef on Tembea Bila Matata\nFrom KSh 41,600 a night, subject to availability and TBM's terms\.\nPhotos, prices and booking: https:\/\/t\.co\/x$/);
});

test("long descriptions are cut at a word", () => {
  const long = "Sail past Fort Jesus and the Old Town at sunset on a traditional dhow with snacks, soft drinks, live taarab music and hotel pickup anywhere in Mombasa included";
  const short = shortShareDescription(long);
  assert.ok(short.length <= 140, short);
  assert.ok(short.endsWith("…"));
  assert.equal(shortShareDescription(""), "");
});

test("the WhatsApp link carries the whole message", () => {
  const href = buildWhatsAppShareHref("Hi\nView details: https://tembeabilamatata.com/a?b=1&c=2");
  assert.equal(decodeURIComponent(href.replace("https://wa.me/?text=", "")), "Hi\nView details: https://tembeabilamatata.com/a?b=1&c=2");
});

test("each kind of listing offers its own starting price", () => {
  assert.deepEqual(getListingSharePrice("stay", { price: 320 }), { priceUsd: 320, priceUnit: "a night" });
  assert.deepEqual(getListingSharePrice("stay", { price: 90, propertyType: "hotel" }), { priceUsd: 90, priceUnit: "a room a night" });
  assert.deepEqual(getListingSharePrice("car", { pricePerDay: 0, priceWithDriver: 140 }), { priceUsd: 140, priceUnit: "a day with a driver" });
  assert.deepEqual(getListingSharePrice("experience", { privatePricePerPerson: 0, sharedPricePerPerson: 45 }), { priceUsd: 45, priceUnit: "a person" });
  assert.equal(getListingSharePrice("errand", { basePrice: 0 }), null);
});

test("a car is named by make and model, as on its public page", () => {
  assert.equal(getCarDisplayName({ make: "Toyota", model: "Noah" }), "Toyota Noah");
  assert.equal(getCarDisplayName({ make: "Toyota", model: "Toyota Noah" }), "Toyota Noah");
  assert.equal(getCarDisplayName({ make: null, model: "Noah – 7 Seater" }), "Noah – 7 Seater");
  assert.equal(getCarDisplayName({ make: "Nissan", model: "" }), "Nissan");
});
