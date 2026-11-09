import sharp from "sharp";

// libvips threads per resize; two resizes at a time keep a small server responsive.
sharp.concurrency(2);

/**
 * The photo once, upright and at most `width` wide, as a high-quality JPEG:
 * the smaller copies are all made from this rather than from the full upload,
 * which is decoded only once and can then be let go.
 */
export async function workingCopy(source: Buffer, width: number) {
  return sharp(source, { limitInputPixels: 80_000_000, failOn: "none" })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** A photo made smaller: turned upright, metadata dropped, WebP. */
export async function resizePhoto(source: Buffer, width: number) {
  return sharp(source, { limitInputPixels: 80_000_000, failOn: "none" })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 74, effort: 4 })
    .toBuffer();
}

/**
 * An uploaded photo as it is kept: upright, at most 2560 px on its long side,
 * with its metadata (camera, GPS position of the home) removed. A PNG with
 * transparency stays a PNG; everything else becomes a JPEG.
 */
export async function optimizeUploadedPhoto(source: Buffer, mimeType: string) {
  try {
    const image = sharp(source, { limitInputPixels: 80_000_000, failOn: "none" });
    const { hasAlpha } = await image.metadata();
    const upright = image.rotate().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true });
    if (mimeType === "image/png" && hasAlpha) {
      return { buffer: await upright.png({ compressionLevel: 9 }).toBuffer(), mimeType: "image/png" };
    }
    return { buffer: await upright.jpeg({ quality: 84, mozjpeg: true }).toBuffer(), mimeType: "image/jpeg" };
  } catch (error) {
    console.warn("[MEDIA] Photo kept as uploaded; it could not be optimised:", error instanceof Error ? error.message : error);
    return { buffer: source, mimeType };
  }
}
