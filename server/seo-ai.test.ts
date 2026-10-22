import test from "node:test";
import assert from "node:assert/strict";
import { toSeoListingInput } from "../shared/listing-seo.ts";
import { cleanAiSeo } from "./seo-ai.ts";

const villa = toSeoListingInput("stay", {
  id: "s1",
  title: "Galu Sands Villa",
  location: "Diani",
  description: "Four bedroom villa with a pool near Galu Beach.",
  features: [],
  bedrooms: 4,
  maxOccupancy: 8,
  price: 200,
});

test("AI ideas are kept only when they fit Google and make no claims the listing doesn't", () => {
  const result = cleanAiSeo({
    titles: [
      "Villa in Diani with pool | Galu Sands Villa",
      "Better than Airbnb: Galu Sands Villa in Diani",
      "The best villa in Diani with pool and garden, steps from Galu",
      "Luxury villa in Diani | Galu Sands Villa",
      "Short",
    ],
    description: "Villa in Diani with pool near Galu Beach: 4 bedrooms, sleeps 8. Prices in KSh. Book on TBM and pay by M-Pesa or card.",
    keywords: [
      { phrase: "Villa near Galu Beach", competition: "Lower", why: "Named beach" },
      { phrase: "airbnb diani", competition: "High" },
      "4 bedroom villa diani",
      { phrase: "villa" },
    ],
    tips: ["Say how many minutes' walk it is to Galu Beach."],
  }, villa);

  assert.deepEqual(result.titles, ["Villa in Diani with pool | Galu Sands Villa"]);
  assert.match(result.description ?? "", /M-Pesa/);
  assert.deepEqual(result.keywords.map((keyword) => keyword.phrase), ["villa near galu beach", "4 bedroom villa diani"]);
  assert.equal(result.keywords[0].competition, "Lower");
  assert.equal(result.keywords[1].competition, "Medium");
  assert.equal(result.tips.length, 1);
});

test("an unreadable or empty AI answer gives nothing, never an error page", () => {
  assert.deepEqual(cleanAiSeo(null, villa), { titles: [], description: null, keywords: [], tips: [] });
  assert.deepEqual(cleanAiSeo({ titles: "x", description: 5 }, villa), { titles: [], description: null, keywords: [], tips: [] });
});
