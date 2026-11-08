// The widths a listing photo is kept at besides its original (server/media-variants.ts).
// A fixed list, so nobody can fill the bucket by asking for every width.
export const PHOTO_VARIANT_WIDTHS = [240, 480, 800, 1200, 1600] as const;

export type PhotoVariantWidth = (typeof PHOTO_VARIANT_WIDTHS)[number];

export function isPhotoVariantWidth(width: number): width is PhotoVariantWidth {
  return (PHOTO_VARIANT_WIDTHS as readonly number[]).includes(width);
}

const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";

/** Server side: the photo's path in the bucket, or null for anything we won't resize. */
export function parseVariantSourcePath(rawPath: string) {
  const path = rawPath.replace(/^\/+/, "");
  if (!path || path.length > 512) return null;
  if (!/^[A-Za-z0-9._\-/]+$/.test(path)) return null;
  if (path.split("/").some((segment) => !segment || segment === "." || segment === "..")) return null;
  if (path.startsWith("variants/")) return null;
  if (!/\.(jpe?g|png|webp)$/i.test(path)) return null;
  return path;
}

export function variantObjectPath(objectPath: string, width: number) {
  return `variants/w${width}/${objectPath}.webp`;
}

/**
 * The address of a smaller copy of a photo in Supabase's public storage
 * ("/media/w/800/<bucket>/<path>"), or null for any other photo, which is
 * then shown as it is.
 */
export function photoVariantPath(src: string | null | undefined, width: PhotoVariantWidth) {
  if (!src) return null;
  const index = src.indexOf(PUBLIC_OBJECT_PATH);
  if (index === -1) return null;
  const bucketAndPath = src.slice(index + PUBLIC_OBJECT_PATH.length).split(/[?#]/)[0];
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._\-/]+\.(jpe?g|png|webp)$/i.test(bucketAndPath)) return null;
  if (bucketAndPath.split("/")[1] === "variants") return null;
  return `/media/w/${width}/${bucketAndPath}`;
}

/** A srcset of the photo's copies, for the browser to pick the right size. */
export function photoSrcSet(src: string | null | undefined, widths: readonly PhotoVariantWidth[] = PHOTO_VARIANT_WIDTHS) {
  if (!photoVariantPath(src, 240)) return undefined;
  return widths.map((width) => `${photoVariantPath(src, width)} ${width}w`).join(", ");
}
