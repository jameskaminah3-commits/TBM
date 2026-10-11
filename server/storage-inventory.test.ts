import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentUrlsFromText,
  buildInventory,
  classifyObject,
  objectPathFromUrl,
  summarizeInventory,
  toCsv,
  type FileReference,
} from "./storage-inventory.ts";

const config = { bucket: "media", supabaseUrl: "https://abc.supabase.co", publicBaseUrl: null };

test("stored links map back to bucket paths", () => {
  assert.equal(objectPathFromUrl("https://abc.supabase.co/storage/v1/object/public/media/2026-03-04/1709-ab12.pdf", config), "2026-03-04/1709-ab12.pdf");
  assert.equal(objectPathFromUrl("https://abc.supabase.co/storage/v1/object/public/media/2026-03-04/a%20b.jpg?width=400", config), "2026-03-04/a b.jpg");
  assert.equal(objectPathFromUrl("https://cdn.example.com/m/2026-03-04/x.png", { ...config, publicBaseUrl: "https://cdn.example.com/m/" }), "2026-03-04/x.png");
  assert.equal(objectPathFromUrl("/uploads/1700-ff.jpg", config), "legacy/1700-ff.jpg");
  assert.equal(objectPathFromUrl("https://tembeabilamatata.com/uploads/1700-ff.pdf", config), "legacy/1700-ff.pdf");
  assert.equal(objectPathFromUrl("https://images.unsplash.com/photo-1", config), null, "outside links aren't ours");
  assert.equal(objectPathFromUrl("https://abc.supabase.co/storage/v1/object/public/other-bucket/x.jpg", config), null);
  assert.equal(objectPathFromUrl("", config), null);
});

test("custom request attachments are found in the request text", () => {
  assert.deepEqual(attachmentUrlsFromText("Clean the flat.\nAttachment: https://abc.supabase.co/storage/v1/object/public/media/d/1.jpg\nThanks"), ["https://abc.supabase.co/storage/v1/object/public/media/d/1.jpg"]);
  assert.deepEqual(attachmentUrlsFromText(null), []);
});

test("an object is classed by the most sensitive record pointing at it", () => {
  const doc: FileReference = { source: "car-document", table: "cars", recordId: "c1", label: "Registration Logbook" };
  const photo: FileReference = { source: "listing-photo", table: "cars", recordId: "c1" };
  assert.equal(classifyObject("d/1.pdf", [photo, doc], "application/pdf"), "vehicle-document");
  assert.equal(classifyObject("d/2.jpg", [photo], "image/jpeg"), "listing-photo");
  assert.equal(classifyObject("d/3.pdf", [], "application/pdf"), "unreferenced-pdf", "a PDF nobody points at may be an abandoned application's document");
  assert.equal(classifyObject("d/4.jpg", [], "image/jpeg"), "unreferenced-media");
  const applicationPhoto: FileReference = { source: "fleet-application-photo", table: "fleet_applications", recordId: "f1" };
  assert.equal(classifyObject("d/5.jpg", [applicationPhoto], "image/jpeg"), "fleet-application-photo", "an application photo stays private");
  assert.equal(classifyObject("d/5.jpg", [applicationPhoto, photo], "image/jpeg"), "listing-photo", "once it is the car's listing photo, it is public");
});

test("the inventory lists every object, missing files, and what should be private", () => {
  const references = new Map<string, FileReference[]>([
    ["d/1.pdf", [{ source: "fleet-application-document", table: "fleet_applications", recordId: "f1", label: "Insurance Certificate" }]],
    ["d/2.jpg", [{ source: "listing-photo", table: "stays", recordId: "s1" }]],
    ["d/gone.pdf", [{ source: "car-document", table: "cars", recordId: "c9" }]],
  ]);
  const { rows, missing } = buildInventory([
    { path: "d/1.pdf", size: 1000, mimetype: "application/pdf", createdAt: "2026-03-01T10:00:00Z" },
    { path: "d/2.jpg", size: 500, mimetype: "image/jpeg", createdAt: "2026-02-01T10:00:00Z" },
    { path: "d/3.pdf", size: 200, mimetype: "application/pdf", createdAt: "2026-04-01T10:00:00Z" },
  ], references);
  assert.deepEqual(rows.map((row) => row.category), ["fleet-application-document", "listing-photo", "unreferenced-pdf"]);
  assert.deepEqual(missing.map((entry) => entry.path), ["d/gone.pdf"]);
  const summary = summarizeInventory(rows);
  assert.equal(summary.total, 3);
  assert.equal(summary.shouldBePrivate, 2);
  assert.equal(summary.byCategory["unreferenced-pdf"].earliest, "2026-04-01T10:00:00Z");
  const csv = toCsv(rows);
  assert.match(csv.split("\n")[1], /^d\/1\.pdf,fleet-application-document,yes,1000,application\/pdf,2026-03-01T10:00:00Z,fleet_applications:f1 \(Insurance Certificate\)$/);
});
