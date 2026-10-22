import test from "node:test";
import assert from "node:assert/strict";
import { buildListingStructuredData } from "./listing-structured-data.ts";
import { staticPageSeo } from "./static-page-seo.ts";

const origin = "https://tembeabilamatata.com";
const nodes = (data: { "@graph": Array<Record<string, unknown>> }) => data["@graph"];

test("a stay: a lodging business with a price range, and its breadcrumb on its own", () => {
  const data = buildListingStructuredData({
    kind: "stay",
    listing: { id: "v1", title: "Beach Villa – Diani", location: "Galu Beach, Diani", description: "A villa on the beach.", price: 320, bedrooms: 4, maxOccupancy: 8, features: ["Private pool", "Wi-Fi"], imageUrl: "/uploads/v1.jpg" },
    name: "Beach Villa – Diani",
    url: `${origin}/accommodation/v1/beach-villa-diani`,
    origin,
    rating: { average: 4.8, count: 5 },
  });
  const [stay, crumbs] = nodes(data);
  assert.equal(stay["@type"], "LodgingBusiness");
  assert.equal(stay.priceRange, "From 320 USD a night");
  assert.equal(stay.offers, undefined);
  assert.equal(stay.breadcrumb, undefined);
  assert.equal(stay.image, `${origin}/uploads/v1.jpg`);
  assert.deepEqual(stay.address, { "@type": "PostalAddress", addressLocality: "Diani", addressCountry: "KE" });
  assert.deepEqual(stay.aggregateRating, { "@type": "AggregateRating", ratingValue: 4.8, reviewCount: 5 });
  assert.equal(crumbs["@type"], "BreadcrumbList");
  assert.equal((crumbs.itemListElement as Array<{ item: string }>)[1].item, `${origin}/explore/diani/stays`);
});

test("no zero or empty values, and no rating below the threshold", () => {
  const [hotel] = nodes(buildListingStructuredData({
    kind: "stay",
    listing: { id: "h1", title: "Reef Hotel", location: "Nyali", description: "", price: 0, bedrooms: 0, propertyType: "hotel" },
    name: "Reef Hotel", url: `${origin}/accommodation/h1/reef-hotel`, origin, rating: null,
  }));
  assert.equal(hotel["@type"], "Hotel");
  for (const key of ["numberOfRooms", "priceRange", "aggregateRating", "image", "starRating"]) assert.equal(key in hotel, false, key);
});

test("a car and an experience are sold with an offer; an experience is a trip", () => {
  const [car] = nodes(buildListingStructuredData({
    kind: "car",
    listing: { id: "c1", make: "Toyota", model: "Noah", location: "Mombasa", description: "A minivan.", pricePerDay: 54, priceWithDriver: 112, seats: 7, transmission: "automatic" },
    name: "Toyota Noah", url: `${origin}/transport/c1/toyota-noah`, origin, rating: null,
  }));
  assert.equal(car["@type"], "Car");
  assert.equal((car.offers as { price: number }).price, 54);
  assert.equal("address" in car, false);
  const [trip] = nodes(buildListingStructuredData({
    kind: "experience",
    listing: { id: "x1", title: "Sunset Dhow Cruise", location: "Mombasa", experienceLocation: "Tudor Creek, Mombasa", description: "A dhow at sunset.", sharedPricePerPerson: 65 },
    name: "Sunset Dhow Cruise", url: `${origin}/experience/x1/sunset-dhow-cruise`, origin, rating: { average: 5, count: 3 },
  }));
  assert.equal(trip["@type"], "TouristTrip");
  assert.equal((trip.offers as { price: number }).price, 65);
  assert.equal("aggregateRating" in trip, false);
});

test("fixed pages: titles near what Google shows, descriptions under 160", () => {
  for (const [path, page] of Object.entries(staticPageSeo)) {
    assert.ok(page.title.length <= 65, `${path}: ${page.title.length}`);
    assert.ok(page.description.length <= 160, `${path}: ${page.description.length}`);
  }
});
