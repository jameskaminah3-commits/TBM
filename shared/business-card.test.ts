import assert from "node:assert/strict";
import test from "node:test";
import { PRINT_PIXELS, PRINT_POINTS, buildProviderVCard, businessCardContent, cardFileName } from "./business-card.ts";

const source = { displayName: "Mwinyi Coast Stays", serviceTypes: ["Stays", "Car hire"], serviceAreas: ["Diani", "Mombasa", "Kilifi"], verified: true, photoUrl: "/uploads/logo.png", photoKind: "logo" };

test("the card says who, what and where, with no rating and no phone number", () => {
  const card = businessCardContent(source);
  assert.deepEqual(card, {
    name: "Mwinyi Coast Stays",
    line: "Stays · Car hire in Diani & Mombasa",
    verified: true,
    photoUrl: "/uploads/logo.png",
    photoIsLogo: true,
    callToAction: "Scan to explore and book",
    coordinatedBy: "Bookings and guest support coordinated by Tembea Bila Matata",
  });
  assert.ok(!("rating" in card));
  assert.doesNotMatch(JSON.stringify(card), /\d{9}|\+254|07\d\d/);
  assert.equal(businessCardContent({ ...source, verified: false }).verified, false);
});

test("print size: 85 × 55 mm with 3 mm bleed at 300 dpi", () => {
  assert.deepEqual([PRINT_PIXELS.width, PRINT_PIXELS.height, PRINT_PIXELS.bleed], [1075, 720, 35]);
  assert.equal(PRINT_POINTS.width.toFixed(2), "257.95");
  assert.equal(PRINT_POINTS.height.toFixed(2), "172.91");
  assert.equal(PRINT_POINTS.trimWidth.toFixed(2), "240.94");
  assert.equal(PRINT_POINTS.trimHeight.toFixed(2), "155.91");
});

test("the contact file has TBM's number only, and the provider's page", () => {
  const vcard = buildProviderVCard({ name: "Mwinyi, Coast; Stays", pageUrl: "https://tembeabilamatata.com/p/k7m2q9xw" });
  assert.match(vcard, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  assert.ok(vcard.includes("FN:Mwinyi\\, Coast\\; Stays (book via TBM)\r\n"), "the name is escaped");
  assert.match(vcard, /ORG:Tembea Bila Matata/);
  assert.match(vcard, /URL:https:\/\/tembeabilamatata\.com\/p\/k7m2q9xw/);
  const numbers = vcard.match(/\+?\d[\d ]{8,}\d/g) ?? [];
  assert.ok(numbers.length > 0 && numbers.every((value) => value.replace(/\D/g, "").endsWith("718475264")), numbers.join());
  assert.equal((vcard.match(/^TEL/gm) ?? []).length, 1);
  assert.doesNotMatch(vcard, /EMAIL|ADR|PHOTO/);
});

test("file names are tidy", () => {
  assert.equal(cardFileName("Mwinyi Coast Stays!", "card.pdf"), "mwinyi-coast-stays-tbm-card.pdf");
  assert.equal(cardFileName("***", "status.png"), "provider-tbm-status.png");
});
