import test from "node:test";
import assert from "node:assert/strict";
import { stayCarAddonPrice, stayCarDailyRate } from "./stay-car-pricing.ts";

const noah = { pricePerDay: 50, priceWithDriver: 69, priceWithDriverHourly: 15 };

test("a car with a driver is charged the with-driver rate, not the self-drive rate", () => {
  assert.equal(stayCarDailyRate(noah, "car-chauffeur-day"), 69);
  assert.deepEqual(stayCarAddonPrice(noah, { serviceMode: "car-chauffeur-day" }, 4), { total: 276, units: 4, hours: null });
  // No mode yet: the default is a car with a driver.
  assert.equal(stayCarAddonPrice(noah, {}, 4).total, 276);
});

test("self-drive uses the self-drive rate only when the car offers it", () => {
  assert.equal(stayCarAddonPrice(noah, { serviceMode: "car-self-drive-day", units: 2 }, 4).total, 100);
  assert.equal(stayCarAddonPrice({ priceWithDriver: 80 }, { serviceMode: "car-self-drive-day" }, 2).total, 160);
});

test("by the hour, at least three hours", () => {
  assert.deepEqual(stayCarAddonPrice(noah, { serviceMode: "car-chauffeur-hourly", serviceHours: 2 }, 4), { total: 45, units: 3, hours: 3 });
  assert.equal(stayCarAddonPrice(noah, { serviceMode: "car-chauffeur-hourly", serviceHours: 5 }, 4).total, 75);
});
