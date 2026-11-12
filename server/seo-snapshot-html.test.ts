import test from "node:test";
import assert from "node:assert/strict";
import {
  listingFacts,
  listingSnapshot,
  renderArticleMarkdown,
  snapshotFrame,
  withoutLeadingTitle,
  type ListingSnapshotInput,
} from "./seo-snapshot-html.ts";
import { getSeoArea, toSeoListingInput } from "../shared/listing-seo.ts";

const photo = "https://abc.supabase.co/storage/v1/object/public/media/stays/villa-1.jpg";
const stay = toSeoListingInput("stay", {
  id: "c0e22a45-d8f7-4028-9c8c-4db6b26b7352",
  title: "Coral Garden Cottage",
  location: "Nyali, Mombasa",
  description: "A quiet cottage five minutes from Nyali Beach.\n\nPool, garden and <script>alert(1)</script> fast Wi-Fi.",
  features: ["Pool", "Wi-Fi"],
  imageUrl: photo,
  galleryUrls: ["https://abc.supabase.co/storage/v1/object/public/media/stays/tour.mp4"],
  price: 120,
  bedrooms: 2,
  maxOccupancy: 4,
  isPublic: true,
});
const nyali = getSeoArea("nyali");

function snapshot(overrides: Partial<ListingSnapshotInput> = {}) {
  return listingSnapshot({
    input: stay,
    crumb: { label: "Places to stay in Nyali", path: "/explore/nyali/stays" },
    categoryPath: "/accommodations",
    categoryLabel: "Places to stay",
    imageAlts: {},
    rating: 4.7,
    reviewCount: 3,
    reviews: [{ rating: 5, comment: "Lovely & calm", createdAt: "2026-11-01", guestName: "Amina W.", reply: null }],
    area: nyali,
    sameArea: [{ name: "Baobab House", path: "/accommodation/b1/baobab-house", location: "Nyali", rating: null, reviewCount: 0 }],
    areaPage: { path: "/explore/nyali/stays", heading: "Places to stay in Nyali", count: 2 },
    otherServicesInArea: [{ path: "/explore/nyali/cars", heading: "Car hire and drivers in Nyali", count: 1 }],
    ...overrides,
  });
}

test("a listing's content: heading, facts, photos, reviews, escaped text", () => {
  const html = snapshot();
  assert.match(html, /<h1>Coral Garden Cottage<\/h1>/);
  assert.match(html, /2 bedrooms · Sleeps 4/);
  assert.match(html, /Rated 4\.7 from 3 guest reviews/);
  // Our own resized copy, lazy, with alt text; the video is left out.
  assert.match(html, /<img src="\/media\/w\/1200\/media\/stays\/villa-1\.jpg" alt="Coral Garden Cottage, Nyali, Mombasa" loading="lazy"/);
  assert.doesNotMatch(html, /tour\.mp4/);
  assert.match(html, /Lovely &amp; calm/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("a listing links to its area page, its neighbours and the area's other services", () => {
  const html = snapshot();
  assert.match(html, /<nav aria-label="Breadcrumb"><a href="\/">Home<\/a> › <a href="\/accommodations">Places to stay<\/a> › <a href="\/explore\/nyali\/stays">Places to stay in Nyali<\/a> › <span>Coral Garden Cottage<\/span><\/nav>/);
  assert.match(html, /<h2>More places to stay in Nyali<\/h2>/);
  assert.match(html, /<a href="\/accommodation\/b1\/baobab-house">Baobab House<\/a>/);
  assert.match(html, /<a href="\/explore\/nyali\/cars">Car hire and drivers in Nyali<\/a>/);
});

test("no rating line below three reviews", () => {
  assert.doesNotMatch(snapshot({ rating: null, reviewCount: 2 }), /Rated/);
});

test("facts read naturally for each kind of listing", () => {
  const car = toSeoListingInput("car", { id: "1", make: "Toyota", model: "Prado", seats: 7, pricePerDay: 90, suitableServices: ["Airport transfers"] });
  assert.deepEqual(listingFacts(car), ["7 seats", "Self-drive or with a driver", "Airport transfers"]);
  const trip = toSeoListingInput("experience", { id: "2", title: "Sunset dhow", experienceType: "Boat trip", durationHours: 3, privateEnabled: true, meetingPoint: "Mtwapa Creek" });
  assert.deepEqual(listingFacts(trip), ["Boat trip", "3 hours", "Private group", "Meets at Mtwapa Creek"]);
});

test("an article's links point at each page's one address", () => {
  const html = renderArticleMarkdown(
    "See [stays in Nyali](/accommodations?destination=Nyali&sourceType=blog) or [Fort Jesus](https://www.museums.or.ke/fort-jesus?utm_source=tbm).\n\n<b>raw</b>",
    new Set(["/explore/nyali/stays"]),
  );
  assert.match(html, /<a href="\/explore\/nyali\/stays">stays in Nyali<\/a>/);
  assert.match(html, /href="https:\/\/www\.museums\.or\.ke\/fort-jesus\?utm_source=tbm"/);
  assert.doesNotMatch(html, /<b>raw<\/b>/);
});

test("the title heading isn't repeated in the article text", () => {
  assert.equal(withoutLeadingTitle("# Nyali nightlife\n\nWhere to go."), "Where to go.");
  assert.equal(withoutLeadingTitle("Where to go.\n\n# Later"), "Where to go.\n\n# Later");
});

test("every page links to the site's sections and the live area pages", () => {
  const html = snapshotFrame("<h1>x</h1>", [{ path: "/explore/diani/stays", heading: "Places to stay in Diani", count: 4 }]);
  assert.match(html, /<a href="\/services\/drive">Car hire and drivers<\/a>/);
  assert.match(html, /<a href="\/explore\/diani\/stays">Places to stay in Diani<\/a> \(4\)/);
  assert.match(html, /^<div class="seo-snapshot"/);
});
