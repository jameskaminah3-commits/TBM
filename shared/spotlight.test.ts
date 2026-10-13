import test from "node:test";
import assert from "node:assert/strict";
import { buildSpotlightMessage, spotlightLine, spotlightProof, type SpotlightSubject } from "./spotlight.ts";
import { buildSpotlightShareUrl } from "./listing-share.ts";

const kassim: SpotlightSubject = {
  kind: "provider",
  name: "Kassim Coast Stays",
  serviceTypes: ["Stays", "Car hire"],
  serviceAreas: ["Diani", "Mombasa", "Kilifi"],
  verified: true,
  rating: { average: 4.75, count: 12 },
  foundingProvider: true,
};

test("the provider is the hero: their name first, 'book with them', TBM as support", () => {
  const message = buildSpotlightMessage(kassim, "https://tembeabilamatata.com/p/k7m2q9xw/kassim-coast-stays?ref=ab12cd34ef");
  const lines = message.split("\n");
  assert.equal(lines[0], "TBM Spotlight: Kassim Coast Stays");
  assert.equal(lines[1], "Stays and car hire in Diani and Mombasa");
  assert.match(message, /book with them through TBM/);
  assert.match(message, /pay safely in your My Bookings checkout/);
  assert.doesNotMatch(message, /book with us|instead|cheaper|only \d|left|hurry|today only/i);
  assert.ok(lines.at(-1)!.startsWith("https://"));
});

test("only checked facts: verified, a rating from 3 eligible reviews, the Founding badge", () => {
  assert.deepEqual(spotlightProof(kassim), ["Verified by TBM", "4.8★ from 12 guest reviews", "One of TBM's Founding Providers"]);
  assert.deepEqual(spotlightProof({ ...kassim, verified: false, rating: null, foundingProvider: false }), []);
  assert.deepEqual(spotlightProof({ ...kassim, rating: { average: 5, count: 2 } }).filter((fact) => fact.includes("★")), []);
  const plain = buildSpotlightMessage({ ...kassim, verified: false, rating: null, foundingProvider: false }, "https://x.example/p/a");
  assert.doesNotMatch(plain, /Verified|★|Founding/);
});

test("a partner gets the same treatment, worded as a partner", () => {
  const message = buildSpotlightMessage({ ...kassim, kind: "partner", foundingProvider: true }, "https://x.example/p/a");
  assert.match(message, /^Meet our partner: Kassim Coast Stays/);
  assert.match(message, /proud to partner with/);
  assert.doesNotMatch(message, /Founding/);
});

test("the line reads naturally with one service and no area", () => {
  assert.equal(spotlightLine({ ...kassim, serviceTypes: ["Home help"], serviceAreas: [] }), "Home help");
  assert.equal(spotlightLine({ ...kassim, serviceTypes: [], serviceAreas: [] }), "On Tembea Bila Matata");
});

test("TBM's Spotlight links are tagged as TBM's, with the share code", () => {
  const url = new URL(buildSpotlightShareUrl("https://tembeabilamatata.com", "/p/k7m2q9xw/kassim-coast-stays", { channel: "whatsapp", code: "ab12cd34ef" }));
  assert.equal(url.searchParams.get("ref"), "ab12cd34ef");
  assert.equal(url.searchParams.get("utm_source"), "tbm");
  assert.equal(url.searchParams.get("utm_campaign"), "spotlight");
  assert.equal(url.searchParams.get("utm_medium"), "whatsapp");
});
