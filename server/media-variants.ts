import {
  buildSupabaseMediaUrl,
  canUseSupabaseMediaStorage,
  getPublicMediaBucket,
  getSupabaseStorageClient,
} from "./media";
import {
  PHOTO_VARIANT_WIDTHS,
  isPhotoVariantWidth,
  parseVariantSourcePath,
  variantObjectPath,
  type PhotoVariantWidth,
} from "@shared/photo-variants";
import { resizePhoto, workingCopy } from "./photo-processing";

// Photos are uploaded at full camera size (up to 8 MB). Each one also gets
// smaller WebP copies, stored beside it in the bucket (variants/w800/<path>.webp),
// so a phone downloads a copy its own size. Supabase's own resizing needs a paid
// plan. All of a photo's sizes are made from one download, the size a guest is
// waiting for first, and every listing photo is prepared in the background after
// the server starts, so guests rarely wait for a copy to be made.

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 20_000;
const MAX_PARALLEL_DOWNLOADS = 4;
const MAX_PARALLEL_RESIZES = 2;
const MAX_PARALLEL_STORES = 4;
const MEMORY_CACHE_BYTES = 32 * 1024 * 1024;
const YEAR_SECONDS = 31_536_000;
const LARGEST_WIDTH = Math.max(...PHOTO_VARIANT_WIDTHS);

// Recently sent copies, kept in memory (oldest dropped first), so most photos
// are answered without a trip to the bucket.
const memoryCache = new Map<string, Buffer>();
let memoryCacheBytes = 0;

function remember(variantPath: string, body: Buffer) {
  if (body.length > MEMORY_CACHE_BYTES / 8) return;
  const previous = memoryCache.get(variantPath);
  if (previous) {
    memoryCacheBytes -= previous.length;
    memoryCache.delete(variantPath);
  }
  memoryCache.set(variantPath, body);
  memoryCacheBytes += body.length;
  while (memoryCacheBytes > MEMORY_CACHE_BYTES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCacheBytes -= memoryCache.get(oldest)?.length ?? 0;
    memoryCache.delete(oldest);
  }
}

function recall(variantPath: string) {
  const body = memoryCache.get(variantPath);
  if (body) {
    // Most recently used goes to the back of the queue.
    memoryCache.delete(variantPath);
    memoryCache.set(variantPath, body);
  }
  return body ?? null;
}

/**
 * A fixed number of jobs at a time. Work a guest is waiting for ("now") goes
 * ahead of background work ("later") whenever a place frees up.
 */
function createLimiter(size: number) {
  let running = 0;
  const now: Array<() => void> = [];
  const later: Array<() => void> = [];
  return async function run<T>(work: () => Promise<T>, priority: "now" | "later" = "now") {
    if (running >= size) {
      await new Promise<void>((resolve) => (priority === "now" ? now : later).push(resolve));
    }
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
      (now.shift() ?? later.shift())?.();
    }
  };
}

const downloads = createLimiter(MAX_PARALLEL_DOWNLOADS);
const resizes = createLimiter(MAX_PARALLEL_RESIZES);
const stores = createLimiter(MAX_PARALLEL_STORES);

async function fetchStoredVariant(variantPath: string) {
  try {
    const res = await fetch(buildSupabaseMediaUrl(variantPath), { signal: AbortSignal.timeout(8_000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function isVariantStored(variantPath: string) {
  try {
    const res = await fetch(buildSupabaseMediaUrl(variantPath), { method: "HEAD", signal: AbortSignal.timeout(8_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchSource(objectPath: string) {
  const res = await fetch(buildSupabaseMediaUrl(objectPath), { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_SOURCE_BYTES) return null;
  const body = Buffer.from(await res.arrayBuffer());
  return body.length > MAX_SOURCE_BYTES ? null : body;
}

function storeVariant(variantPath: string, body: Buffer) {
  void stores(async () => {
    const { error } = await getSupabaseStorageClient()
      .storage.from(getPublicMediaBucket())
      .upload(variantPath, body, { contentType: "image/webp", cacheControl: String(YEAR_SECONDS), upsert: true });
    if (error) console.warn("[MEDIA] Could not store photo copy:", variantPath, error.message);
  }, "later").catch((error) => {
    console.warn("[MEDIA] Could not store photo copy:", variantPath, error instanceof Error ? error.message : error);
  });
}

type PhotoJob = { sizes: Map<PhotoVariantWidth, Promise<Buffer | null>>; done: Promise<void> };
const photoJobs = new Map<string, PhotoJob>();

/**
 * Makes the photo's sizes from one download: `first` (the size someone is
 * waiting for, or null for none) before the rest. One job per photo at a time;
 * asking for any of its sizes meanwhile waits for that size.
 */
function startPhotoJob(objectPath: string, first: PhotoVariantWidth | null, widths: readonly PhotoVariantWidth[]) {
  const resolvers = new Map<PhotoVariantWidth, (body: Buffer | null) => void>();
  const sizes = new Map<PhotoVariantWidth, Promise<Buffer | null>>();
  for (const width of widths) {
    sizes.set(width, new Promise((resolve) => resolvers.set(width, resolve)));
  }
  const order = first ? [first, ...widths.filter((width) => width !== first)] : [...widths];
  const priority = first ? "now" : "later";
  const job: PhotoJob = { sizes, done: Promise.resolve() };

  job.done = (async () => {
    try {
      let source = await downloads(() => fetchSource(objectPath), priority);
      if (!source) return;
      // The full upload is decoded once; every size comes from this smaller copy.
      const upload = source;
      const working = await resizes(() => workingCopy(upload, LARGEST_WIDTH), priority);
      source = null;
      for (let index = 0; index < order.length; index += 1) {
        const width = order[index];
        const resized = await resizes(() => resizePhoto(working, width), index === 0 ? priority : "later");
        const variantPath = variantObjectPath(objectPath, width);
        remember(variantPath, resized);
        storeVariant(variantPath, resized);
        resolvers.get(width)?.(resized);
      }
    } catch (error) {
      console.warn("[MEDIA] Could not resize photo:", objectPath, error instanceof Error ? error.message : error);
    } finally {
      resolvers.forEach((resolve) => resolve(null));
      if (photoJobs.get(objectPath) === job) photoJobs.delete(objectPath);
    }
  })();

  photoJobs.set(objectPath, job);
  return job;
}

/** The copy at this width, made now (with the photo's other sizes) if needed. */
function makeVariantNow(objectPath: string, width: PhotoVariantWidth) {
  const running = photoJobs.get(objectPath)?.sizes.get(width);
  if (running) return running;
  return startPhotoJob(objectPath, width, PHOTO_VARIANT_WIDTHS).sizes.get(width) ?? Promise.resolve(null);
}

/** Makes whichever of the photo's sizes aren't stored yet, in the background. */
async function preparePhoto(objectPath: string) {
  if (photoJobs.has(objectPath)) return;
  const stored = await Promise.all(PHOTO_VARIANT_WIDTHS.map((width) => isVariantStored(variantObjectPath(objectPath, width))));
  const missing = PHOTO_VARIANT_WIDTHS.filter((_, index) => !stored[index]);
  if (missing.length === 0 || photoJobs.has(objectPath)) return;
  await startPhotoJob(objectPath, null, missing).done;
}

/** After an upload: its sizes are made in the background. */
export function warmPhotoVariants(publicUrl: string) {
  const objectPath = objectPathFromPublicUrl(publicUrl);
  if (objectPath) void preparePhoto(objectPath);
}

/**
 * After the server starts: every listing photo gets its sizes, one photo at a
 * time behind anything a guest is waiting for. Photos already done are only
 * checked, so this is quick after the first time.
 */
export async function prepareListingPhotos(photoUrls: string[]) {
  const objectPaths = Array.from(new Set(photoUrls.map(objectPathFromPublicUrl).filter((path): path is string => Boolean(path))));
  for (const objectPath of objectPaths) {
    await preparePhoto(objectPath).catch(() => undefined);
  }
  console.log(`[MEDIA] Listing photos ready: ${objectPaths.length} checked.`);
}

function objectPathFromPublicUrl(publicUrl: string) {
  try {
    const marker = `/storage/v1/object/public/${getPublicMediaBucket()}/`;
    const index = publicUrl.indexOf(marker);
    return index === -1 ? null : parseVariantSourcePath(publicUrl.slice(index + marker.length));
  } catch {
    return null;
  }
}

/**
 * GET /media/w/:width/:bucket/<path>: the photo at that width, sent from our own
 * address so a phone reuses the connection it already has. From memory, else
 * from the bucket, else made now. Anything that goes wrong falls back to the
 * original photo, never a broken image.
 */
export function registerPhotoVariantRoute(app: import("express").Express) {
  app.get("/media/w/:width/:bucket/*", async (req, res) => {
    if (!canUseSupabaseMediaStorage()) {
      return res.status(404).end();
    }
    const width = Number(req.params.width);
    const objectPath = parseVariantSourcePath((req.params as { 0?: string })[0] ?? "");
    if (!isPhotoVariantWidth(width) || !objectPath || req.params.bucket !== getPublicMediaBucket()) {
      return res.status(404).end();
    }

    const variantPath = variantObjectPath(objectPath, width);
    try {
      let body = recall(variantPath) ?? await photoJobs.get(objectPath)?.sizes.get(width) ?? null;
      if (!body) {
        body = await fetchStoredVariant(variantPath);
        if (body) remember(variantPath, body);
      }
      body ??= await makeVariantNow(objectPath, width);
      if (body) {
        res.set({ "Content-Type": "image/webp", "Cache-Control": `public, max-age=${YEAR_SECONDS}, immutable` });
        return res.send(body);
      }
    } catch (error) {
      console.warn("[MEDIA] Photo copy failed:", variantPath, error instanceof Error ? error.message : error);
    }
    res.set("Cache-Control", "public, max-age=300");
    return res.redirect(302, buildSupabaseMediaUrl(objectPath));
  });
}
