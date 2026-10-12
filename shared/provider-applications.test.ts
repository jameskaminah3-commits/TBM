import assert from "node:assert/strict";
import test from "node:test";
import { applicationDetailFields, earningsExamples, estimateMonthlyGross, providerApplicationSchema, workingDaysWaiting } from "./provider-applications.ts";

const base = {
  serviceType: "stays",
  fullName: "Wanjiru Kamau",
  phone: "0712 345 678",
  email: "Wanjiru.Host@Example.com",
  town: "Diani",
  details: { propertyName: "Pembe Villa", propertyKind: "Villa", area: "Galu Beach", bedrooms: 3, maxGuests: 6, nightlyPriceKes: 18000, relationship: "I own it" },
  photos: [],
  consent: true,
};

test("a complete stay application passes, with phone and email tidied", () => {
  const parsed = providerApplicationSchema.parse(base);
  assert.equal(parsed.phone, "254712345678");
  assert.equal(parsed.email, "wanjiru.host@example.com");
});

test("each service's required answers are checked", () => {
  const missing = { ...base, details: { ...base.details, nightlyPriceKes: "" } };
  assert.throws(() => providerApplicationSchema.parse(missing), /price a night/);
  assert.throws(() => providerApplicationSchema.parse({ ...base, serviceType: "cooks" }), /what you cook/);
  assert.ok(providerApplicationSchema.parse({
    ...base,
    serviceType: "errands",
    details: { services: ["House cleaning", "Laundry"], experienceYears: 6, visitPriceKes: 2500 },
  }));
  assert.throws(() => providerApplicationSchema.parse({ ...base, serviceType: "errands", details: { services: [], experienceYears: 6, visitPriceKes: 2500 } }), /what you do/);
});

test("numbers must be numbers within sense", () => {
  assert.throws(() => providerApplicationSchema.parse({ ...base, details: { ...base.details, bedrooms: 5000 } }), /bedrooms/);
  assert.throws(() => providerApplicationSchema.parse({ ...base, details: { ...base.details, bedrooms: "three" } }), /bedrooms/);
});

test("consent is required, and vehicles aren't taken by this form", () => {
  assert.throws(() => providerApplicationSchema.parse({ ...base, consent: false }));
  assert.throws(() => providerApplicationSchema.parse({ ...base, serviceType: "cars" }));
  assert.throws(() => providerApplicationSchema.parse({ ...base, phone: "12" }), /phone number/);
});

test("every service has questions and an earnings example", () => {
  for (const key of ["stays", "cooks", "errands", "experiences"] as const) {
    assert.ok(applicationDetailFields[key].some((field) => field.required));
  }
  for (const key of ["stays", "cars", "cooks", "errands", "experiences"] as const) {
    assert.ok(earningsExamples[key].defaultPrice > 0 && earningsExamples[key].defaultUnits <= earningsExamples[key].maxUnits);
  }
});

test("the example earnings are price times bookings, never negative", () => {
  assert.equal(estimateMonthlyGross(9000, 10), 90000);
  assert.equal(estimateMonthlyGross(0, 10), 0);
  assert.equal(estimateMonthlyGross(-5, 10), 0);
  assert.equal(estimateMonthlyGross(Number.NaN, 10), 0);
});

test("working days waiting skip weekends", () => {
  // Friday 9 Oct 2026 to Monday 12 Oct 2026: one working day (Monday).
  assert.equal(workingDaysWaiting("2026-10-09", "2026-10-12"), 1);
  assert.equal(workingDaysWaiting("2026-10-12", "2026-10-12"), 0);
  // Monday to the next Monday: five working days.
  assert.equal(workingDaysWaiting("2026-10-05", "2026-10-12"), 5);
});
