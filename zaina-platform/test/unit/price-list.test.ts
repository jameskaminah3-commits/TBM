// The price list without a database: items checked, prices written out,
// pasted lists read, and the items Zaina finds for a question.

import assert from "node:assert/strict";
import test from "node:test";
import type { PriceItem } from "../../src/db/schema.ts";
import { parsePriceList, priceText, validatePriceItem } from "../../src/prices/price-list.ts";
import { matchPriceItems } from "../../src/prices/tool.ts";

test("items are checked; prices are typed in shillings (or dollars) and kept in cents", () => {
  const good = validatePriceItem({ name: " Airport transfer ", section: "Transfers", price: "3,500", unit: "per car" });
  assert.ok(good.ok);
  assert.deepEqual(good.value, { section: "Transfers", name: "Airport transfer", description: null, priceMinor: 350000, priceMaxMinor: null, currency: "KES", unit: "per car", status: "active", sortOrder: 0 });
  const range = validatePriceItem({ name: "Massage", price: 4000, price_max: "6,500", currency: "KES" });
  assert.ok(range.ok && range.value.priceMaxMinor === 650000);
  for (const [bad, pattern] of [
    [{ price: 100 }, /name/],
    [{ name: "x".repeat(121), price: 1 }, /name/],
    [{ name: "Tea" }, /price/],
    [{ name: "Tea", price: "about 100" }, /price/],
    [{ name: "Tea", price: 100, price_max: 50 }, /more than/],
    [{ name: "Tea", price: 100, currency: "EUR" }, /currency/],
    [{ name: "Tea", price: 100, status: "sold" }, /status/],
  ] as const) {
    const checked = validatePriceItem(bad as Record<string, unknown>);
    assert.ok(!checked.ok && pattern.test(checked.error), JSON.stringify(bad));
  }
  // A change keeps what it doesn't mention.
  const current = good.value;
  const changed = validatePriceItem({ price: 4000 }, current);
  assert.ok(changed.ok && changed.value.name === "Airport transfer" && changed.value.priceMinor === 400000 && changed.value.unit === "per car");
});

test("prices written out as customers read them", () => {
  const item = (priceMinor: number, priceMaxMinor: number | null, unit: string | null, currency: "KES" | "USD" = "KES") => ({ priceMinor, priceMaxMinor, unit, currency });
  assert.equal(priceText(item(350000, null, "per car")), "KSh 3,500 per car");
  assert.equal(priceText(item(100000, 150000, "per person")), "KSh 1,000–1,500 per person");
  assert.equal(priceText(item(4000, null, null, "USD")), "$40");
  assert.equal(priceText(item(0, null, null)), "Free");
  assert.equal(priceText(item(0, null, "under 5s")), "Free (under 5s)");
});

test("a pasted price list: items with their prices, headings as sections, and what couldn't be read", () => {
  const parsed = parsePriceList([
    "TRANSFERS",
    "Airport transfer (Moi Airport) — KSh 3,500 per car",
    "Ukunda airstrip pick-up: 2,000/= each",
    "",
    "Spa:",
    "• Swedish massage 60 min ....... 4,500",
    "Hot stone massage | Ksh 5,000 - 6,500",
    "Kids under 5: free",
    "Excursions",
    "Wasini island dhow trip $85 pp",
    "Snorkelling gear hire 500 /day",
    "We also arrange weddings and conferences on request.",
  ].join("\n"));
  assert.deepEqual(parsed.items, [
    { section: "TRANSFERS", name: "Airport transfer (Moi Airport)", price: "3500", price_max: null, currency: "KES", unit: "per car" },
    { section: "TRANSFERS", name: "Ukunda airstrip pick-up", price: "2000", price_max: null, currency: "KES", unit: "each" },
    { section: "Spa", name: "Swedish massage 60 min", price: "4500", price_max: null, currency: "KES", unit: null },
    { section: "Spa", name: "Hot stone massage", price: "5000", price_max: "6500", currency: "KES", unit: null },
    { section: "Spa", name: "Kids under 5", price: "0", price_max: null, currency: "KES", unit: null },
    { section: "Excursions", name: "Wasini island dhow trip", price: "85", price_max: null, currency: "USD", unit: "per person" },
    { section: "Excursions", name: "Snorkelling gear hire", price: "500", price_max: null, currency: "KES", unit: "per day" },
  ]);
  assert.deepEqual(parsed.problems, [{ line: 12, text: "We also arrange weddings and conferences on request.", reason: "No price found." }]);
  assert.equal(parsePriceList("Laundry 300", "USD").items[0].currency, "USD", "the business's currency when the line names none");
});

test("Zaina finds the items a question is about: the name counts most", () => {
  const item = (name: string, section: string | null, description: string | null = null) => ({ id: name, name, section, description, priceMinor: 100, priceMaxMinor: null, currency: "KES", unit: null, status: "active" }) as PriceItem;
  const items = [item("Airport transfer", "Transfers"), item("Laundry", "Services", "Washed and ironed"), item("Swedish massage", "Spa"), item("Hot stone massage", "Spa"), item("Dinner buffet", "Meals", "Served with fresh juices")];
  assert.deepEqual(matchPriceItems(items, "How much is a massage?").map((entry) => entry.name), ["Swedish massage", "Hot stone massage"]);
  assert.deepEqual(matchPriceItems(items, "airport transfers").map((entry) => entry.name), ["Airport transfer"]);
  assert.deepEqual(matchPriceItems(items, "juice").map((entry) => entry.name), ["Dinner buffet"]);
  assert.deepEqual(matchPriceItems(items, "how much"), []);
});
