import assert from "node:assert/strict";
import test from "node:test";
import {
  applicationDeclineReasonLabels,
  applicationDeclineReasons,
  applicationDetailFields,
  applicationServiceTypes,
  applicationStage,
  applicationStatuses,
  earningsExamples,
  estimateMonthlyGross,
  isApplicationReference,
  makeApplicationReference,
  officialContactLine,
  providerApplicationSchema,
  verificationDocuments,
  verificationDocumentsWhy,
  workingDaysWaiting,
} from "./provider-applications.ts";

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

test("vehicles apply with the same short form, without a registration number or documents", () => {
  const car = providerApplicationSchema.safeParse({
    serviceType: "cars",
    fullName: "Kassim Mwinyi",
    phone: "0712 345 678",
    email: "kassim@example.com",
    town: "Nyali",
    details: { vehicle: "Toyota Prado", seats: 7, transmission: "Automatic", driver: "With a driver", area: "Nyali, Mombasa", dayPriceKes: 12000, relationship: "I own it" },
    photos: [],
    consent: true,
  });
  assert.equal(car.success, true);
  const keys = applicationDetailFields.cars.map((field) => field.key);
  assert.ok(!keys.some((key) => /registration|logbook|insurance|document/i.test(key)), "no documents or registration at the application stage");
  const missing = providerApplicationSchema.safeParse({ serviceType: "cars", fullName: "K M", phone: "0712345678", email: "k@example.com", town: "Nyali", details: {}, photos: [], consent: true });
  assert.equal(missing.success, false);
});

test("every service says which documents come later, and why", () => {
  for (const service of applicationServiceTypes) {
    assert.ok(verificationDocuments[service].length > 10, service);
    assert.ok(verificationDocumentsWhy[service].startsWith("so ") || verificationDocumentsWhy[service].startsWith("because "), service);
  }
  assert.match(verificationDocuments.cars, /logbook and insurance/);
});

test("references are random, readable and never reveal a count", () => {
  const reference = makeApplicationReference(new Uint8Array([0, 1, 2, 3, 4, 5]));
  assert.equal(reference, "TBM-P-ABCDEF");
  assert.ok(isApplicationReference(reference));
  assert.ok(!isApplicationReference("TBM-P-0O1I23"), "no look-alike characters");
  assert.ok(!isApplicationReference("TBM-P-12"));
  const many = new Set(Array.from({ length: 200 }, (_, i) => makeApplicationReference(new Uint8Array([i, i * 7, i * 13, i * 17, i * 19, i * 23].map((n) => n % 256)))));
  assert.ok(many.size > 150);
});

test("an applicant sees a stage and a next step for every status", () => {
  for (const status of applicationStatuses) {
    const stage = applicationStage(status);
    assert.equal(stage.status, status);
    assert.ok(stage.label && stage.next);
  }
  assert.equal(applicationStage("something-else").status, "new");
  assert.equal(applicationStage("needs-info").label, "More information needed");
  for (const reason of applicationDeclineReasons) assert.ok(applicationDeclineReasonLabels[reason].endsWith("."));
  assert.match(officialContactLine, /\+254 718 475 264/);
  assert.match(officialContactLine, /never asks for a joining fee, your password or a sign-in code/);
});
