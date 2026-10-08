import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HELP_MAMA_AGE_BANDS,
  HELP_MAMA_TIME_RATE_IDS,
  calculateHelpMamaPackagePrice,
  getHelpMamaRateOptions,
} from "./errand-pricing.ts";

const legacyPricing = { enabled: true, ageBands: [], hourlyDaytimePrice: 8, hourlyEveningPrice: 10, overnightPrice: 45, fullDayPrice: 60 };

test("a nanny priced before age bands existed keeps her rates for every age", () => {
  const options = getHelpMamaRateOptions(legacyPricing, "help-mama-infant");
  assert.deepEqual(options.map((option) => option.price), [8, 10, 45, 60]);
  const errand = { basePrice: 99, helpMamaPricing: legacyPricing };
  assert.equal(calculateHelpMamaPackagePrice(errand, ["help-mama-toddler", HELP_MAMA_TIME_RATE_IDS.fullDay]), 60);
});

test("bands saved at zero, with no band priced, still take the listing's rates", () => {
  const pricing = { ...legacyPricing, ageBands: DEFAULT_HELP_MAMA_AGE_BANDS.map((band) => ({ ...band })) };
  assert.equal(getHelpMamaRateOptions(pricing, "help-mama-child").length, 4);
});

test("once bands are priced, a band left at zero is an age the carer doesn't take", () => {
  const pricing = {
    ...legacyPricing,
    ageBands: [
      { id: "help-mama-infant", label: "Infant", price: 0, hourlyDaytimePrice: 0, hourlyEveningPrice: 0, overnightPrice: 0, fullDayPrice: 0 },
      { id: "help-mama-child", label: "Child", price: 0, hourlyDaytimePrice: 12, hourlyEveningPrice: 14, overnightPrice: 0, fullDayPrice: 70 },
    ],
  };
  assert.equal(getHelpMamaRateOptions(pricing, "help-mama-infant").length, 0);
  assert.deepEqual(getHelpMamaRateOptions(pricing, "help-mama-child").map((option) => option.price), [12, 14, 70]);
});
