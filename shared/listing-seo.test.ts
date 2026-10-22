import test from "node:test";
import assert from "node:assert/strict";
import {
  areaPagePath,
  containsPhrase,
  defaultAreaPageCopy,
  detectSeoArea,
  getSeoArea,
  scoreListingSeo,
  seoTitleLimit,
  suggestListingSeo,
  toPublicListingSeo,
  toSeoListingInput,
  withSeoBrand,
} from "./listing-seo.ts";

const galuVilla = toSeoListingInput("stay", {
  id: "stay-1",
  title: "Galu Sands Villa",
  location: "Galu Beach, Diani",
  description: "A four bedroom beachfront villa with a private pool, 30 metres from Galu Beach. A cook comes in for breakfast.",
  features: ["Pool", "Wi-Fi"],
  imageUrl: "/a.jpg",
  galleryUrls: ["/b.jpg", "/c.jpg"],
  price: 250,
  bedrooms: 4,
  maxOccupancy: 8,
  propertyType: "entire_place",
  reviewCount: 1,
  isPublic: true,
});

test("places a listing in the most specific Coast area", () => {
  assert.equal(detectSeoArea("Nyali, Mombasa")?.key, "nyali");
  assert.equal(detectSeoArea("Lamu Old Town")?.key, "lamu");
  assert.equal(detectSeoArea("Ukunda")?.key, "diani");
  assert.equal(detectSeoArea("Nairobi"), null);
  assert.equal(detectSeoArea(null, "", "Mtwapa creek house")?.key, "mtwapa");
});

test("suggests phrases the listing's own text backs, main phrase first", () => {
  const seo = suggestListingSeo(galuVilla);
  const phrases = seo.keywords.map((keyword) => keyword.phrase);
  assert.equal(seo.area?.key, "diani");
  assert.equal(seo.focusKeyword, "villa in Diani with pool");
  assert.ok(phrases.includes("beachfront villa in Diani"));
  assert.ok(phrases.includes("4 bedroom villa in Diani"));
  assert.ok(phrases.includes("villa in Diani with chef"));
  assert.ok(phrases.includes("villa near Galu Beach"));
  // Landmarks the text doesn't mention are never promised.
  assert.ok(!phrases.some((phrase) => /Colobus|Shimba/.test(phrase)));
  // Crowded head terms come last.
  assert.equal(seo.keywords.at(-1)?.competition, "High");
  assert.ok(seo.keywords.findIndex((k) => k.competition === "High") > seo.keywords.findIndex((k) => k.competition === "Lower"));
});

test("titles fit what Google shows and descriptions carry the phrase and a reason to book", () => {
  const seo = suggestListingSeo(galuVilla);
  assert.ok(seo.titles.length >= 1);
  for (const title of seo.titles) assert.ok(title.length <= seoTitleLimit, title);
  assert.ok(seo.titles[0].startsWith("Villa in Diani with pool"));
  assert.ok(seo.description.length <= 155, seo.description);
  assert.ok(containsPhrase(seo.description, seo.focusKeyword));
  assert.match(seo.description, /M-Pesa/);
  assert.deepEqual(Object.keys(seo.photoAlts), ["/a.jpg", "/b.jpg", "/c.jpg"]);
  assert.equal(seo.photoAlts["/a.jpg"], "Galu Sands Villa, villa in Diani");
});

test("names the real competitors and never suggests their brand in a title", () => {
  const seo = suggestListingSeo(galuVilla);
  assert.ok(seo.competitors.some((competitor) => competitor.name === "Airbnb"));
  assert.ok(seo.howToWin.some((tip) => tip.includes("Airbnb in Diani")));
  for (const title of seo.titles) assert.doesNotMatch(title, /airbnb|booking\.com/i);
  for (const keyword of seo.keywords) assert.doesNotMatch(keyword.phrase, /airbnb|booking\.com|tripadvisor/i);
});

test("experiences: activity and named places from the listing", () => {
  const dhow = toSeoListingInput("experience", {
    id: "exp-1",
    title: "Sunset dhow to Wasini Island",
    location: "Diani",
    experienceLocation: "Wasini Island",
    experienceType: "Dhow trip",
    description: "Sail a traditional dhow to Wasini Island and snorkel in Kisite Marine Park.",
    features: [],
    durationHours: 8,
    privateEnabled: true,
    sharedEnabled: true,
    privatePricePerPerson: 60,
  });
  const seo = suggestListingSeo(dhow);
  const phrases = seo.keywords.map((keyword) => keyword.phrase);
  assert.equal(seo.area?.key, "shimoni");
  assert.ok(phrases.includes("dhow cruise Shimoni"));
  assert.ok(phrases.includes("Wasini Island tour"));
  assert.ok(phrases.includes("Kisite Marine Park tour"));
  assert.ok(phrases.includes("things to do in Shimoni"));
  assert.ok(seo.competitors.some((competitor) => competitor.name === "GetYourGuide and Viator"));
});

test("cars: routes from the airport and the SGR outside Mombasa", () => {
  const car = toSeoListingInput("car", { id: "car-1", make: "Toyota", model: "Noah", location: "Watamu", description: "Airport pick-ups with a driver.", features: [], seats: 7, priceWithDriver: 80, suitableServices: ["airport_transfers"] });
  const phrases = suggestListingSeo(car).keywords.map((keyword) => keyword.phrase);
  assert.ok(phrases.includes("Mombasa airport to Watamu transfer"));
  assert.ok(phrases.includes("SGR to Watamu transfer"));
  assert.ok(phrases.includes("Malindi Airport transfer"));
  assert.ok(phrases.includes("7 seater van hire Watamu"));
});

test("home help photo text never names a person", () => {
  const help = toSeoListingInput("errand", { id: "e-1", serviceName: "Holiday nanny", location: "Diani", description: "", features: [], imageUrl: "/n.jpg", helpMamaPricing: { enabled: true } });
  const seo = suggestListingSeo(help);
  assert.equal(seo.photoAlts["/n.jpg"], "Holiday nanny, home help in Diani");
  assert.ok(seo.keywords.some((keyword) => keyword.phrase === "holiday nanny in Diani"));
});

test("the checklist scores what Google reads", () => {
  const weak = scoreListingSeo(galuVilla, { title: "Villa", description: "Nice.", focusKeyword: null, imageAlts: {}, duplicateTitle: true });
  assert.ok(weak.score < 40, String(weak.score));
  assert.equal(weak.grade, "Poor");
  assert.ok(weak.checks.find((check) => check.id === "unique-title")?.status === "fail");

  const seo = suggestListingSeo(galuVilla);
  const strong = scoreListingSeo(galuVilla, { title: seo.titles[0], description: seo.description, focusKeyword: seo.focusKeyword, imageAlts: seo.photoAlts, duplicateTitle: false });
  assert.ok(strong.score >= 70, String(strong.score));
  assert.equal(strong.checks.find((check) => check.id === "title-focus")?.status, "pass");
  assert.equal(strong.checks.find((check) => check.id === "title-area")?.status, "pass");
  assert.equal(strong.checks.find((check) => check.id === "photo-text")?.status, "pass");
  // Thin listing text and few photos still cost points, with a fix.
  const body = strong.checks.find((check) => check.id === "body-length");
  assert.equal(body?.status, "fail");
  assert.match(body?.fix ?? "", /words/);
  assert.equal(strong.checks.reduce((sum, check) => sum + check.max, 0), 100);
});

test("only TBM's title, description and text for the listing's own photos go public", () => {
  assert.equal(toPublicListingSeo(null, []), null);
  assert.equal(toPublicListingSeo({ seoTitle: " ", seoDescription: null, focusKeyword: "x", keywords: ["y"], imageAlts: {} }, []), null);
  const result = toPublicListingSeo({ seoTitle: "Title", seoDescription: "Desc", focusKeyword: "secret", keywords: ["k"], imageAlts: { "/a.jpg": "Pool", "/other.jpg": "Not this listing's" } }, ["/a.jpg"]);
  assert.deepEqual(result, { title: "Title", description: "Desc", imageAlts: { "/a.jpg": "Pool" } });
});

test("area pages: path, copy and brand that fit", () => {
  const diani = getSeoArea("diani")!;
  assert.equal(areaPagePath("diani", "experiences"), "/explore/diani/experiences");
  const copy = defaultAreaPageCopy(diani, "stays");
  assert.equal(copy.heading, "Places to stay in Diani");
  assert.ok(copy.title.length <= seoTitleLimit + 5, copy.title);
  assert.ok(copy.description.length <= 155);
  assert.match(copy.intro, /Diani Beach/);
  assert.equal(withSeoBrand("Short title"), "Short title | Tembea Bila Matata");
});
