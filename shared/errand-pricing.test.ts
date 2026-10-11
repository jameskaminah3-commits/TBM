import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HELP_MAMA_AGE_BANDS, normalizeHelpMamaPricing } from "./errand-pricing.ts";

const legacyPricing = { enabled: true, ageBands: [], hourlyDaytimePrice: 8, hourlyEveningPrice: 10, overnightPrice: 45, fullDayPrice: 60 };

test("the editor opens an older nanny listing with her rates in every age band, not zeros", () => {
  const { ageBands } = normalizeHelpMamaPricing(legacyPricing);
  assert.equal(ageBands.length, DEFAULT_HELP_MAMA_AGE_BANDS.length);
  for (const band of ageBands) {
    assert.deepEqual(
      [band.hourlyDaytimePrice, band.hourlyEveningPrice, band.overnightPrice, band.fullDayPrice],
      [8, 10, 45, 60],
      band.label,
    );
  }
});

test("a new nanny listing still opens with empty age bands", () => {
  const { ageBands } = normalizeHelpMamaPricing({ enabled: false, ageBands: [] });
  assert.ok(ageBands.every((band) => band.hourlyDaytimePrice === 0 && band.fullDayPrice === 0));
});
