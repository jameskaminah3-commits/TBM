import assert from "node:assert/strict";
import test from "node:test";
import { diffListingFields } from "./listing-edits.ts";

test("records only the fields that changed", () => {
  const before = { id: "s1", title: "Villa", price: 320, galleryUrls: ["a.jpg"], updatedAt: "2026-10-01" };
  const after = { id: "s1", title: "Villa", price: 340, galleryUrls: ["a.jpg", "b.jpg"], updatedAt: "2026-10-11" };
  assert.deepEqual(diffListingFields(before, after), {
    price: { before: 320, after: 340 },
    galleryUrls: { before: ["a.jpg"], after: ["a.jpg", "b.jpg"] },
  });
});

test("a save that changes nothing records nothing", () => {
  const listing = { id: "c1", model: "Prado", availabilityStatus: "available", updatedAt: "x" };
  assert.deepEqual(diffListingFields(listing, { ...listing, updatedAt: "y" }), {});
});

test("empty and missing values count as the same", () => {
  assert.deepEqual(diffListingFields({ note: null }, { note: undefined }), {});
});
