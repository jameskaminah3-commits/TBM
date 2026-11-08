import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPhotoVariantWidth,
  parseVariantSourcePath,
  photoSrcSet,
  photoVariantPath,
  variantObjectPath,
} from "./photo-variants.ts";

const upload = "https://abc.supabase.co/storage/v1/object/public/media/2026-11-01/1730000000000-a1b2c3.jpg";

test("a stored photo gets addresses for its smaller copies", () => {
  assert.equal(photoVariantPath(upload, 800), "/media/w/800/media/2026-11-01/1730000000000-a1b2c3.jpg");
  assert.equal(
    photoSrcSet(upload),
    [240, 480, 800, 1200, 1600].map((width) => `/media/w/${width}/media/2026-11-01/1730000000000-a1b2c3.jpg ${width}w`).join(", "),
  );
});

test("photos from anywhere else are shown as they are", () => {
  assert.equal(photoVariantPath("/images/home-hero-768.webp", 480), null);
  assert.equal(photoVariantPath("https://example.com/photo.jpg", 480), null);
  assert.equal(photoVariantPath("https://abc.supabase.co/storage/v1/object/public/media/tour.mp4", 480), null);
  assert.equal(photoVariantPath("https://abc.supabase.co/storage/v1/object/public/media/variants/w480/a.jpg.webp", 480), null);
  assert.equal(photoVariantPath(null, 480), null);
  assert.equal(photoSrcSet("/uploads/legacy.jpg"), undefined);
});

test("only the fixed widths are made", () => {
  assert.equal(isPhotoVariantWidth(800), true);
  assert.equal(isPhotoVariantWidth(801), false);
  assert.equal(isPhotoVariantWidth(5000), false);
});

test("the server only resizes plain photo paths in the bucket", () => {
  assert.equal(parseVariantSourcePath("2026-11-01/a.jpg"), "2026-11-01/a.jpg");
  assert.equal(parseVariantSourcePath("/2026-11-01/a.PNG"), "2026-11-01/a.PNG");
  assert.equal(parseVariantSourcePath("../secrets/a.jpg"), null);
  assert.equal(parseVariantSourcePath("2026-11-01/../a.jpg"), null);
  assert.equal(parseVariantSourcePath("variants/w480/a.jpg.webp"), null);
  assert.equal(parseVariantSourcePath("2026-11-01/a.pdf"), null);
  assert.equal(parseVariantSourcePath("2026-11-01/a b.jpg"), null);
  assert.equal(parseVariantSourcePath(""), null);
});

test("each copy is kept under its width, beside the others", () => {
  assert.equal(variantObjectPath("2026-11-01/a.jpg", 480), "variants/w480/2026-11-01/a.jpg.webp");
});
