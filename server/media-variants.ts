import {
  buildSupabaseMediaUrl,
  canUseSupabaseMediaStorage,
  getPublicMediaBucket,
  getSupabaseStorageClient,
} from "./media";
import { isPhotoVariantWidth, parseVariantSourcePath, variantObjectPath } from "@shared/photo-variants";
import { resizePhoto } from "./photo-processing";

// Photos are uploaded at full camera size (up to 8 MB). Each one also gets
// smaller WebP copies, made the first time a size is asked for and stored
// beside it in the bucket (variants/w800/<path>.webp), so a phone downloads a
// copy its own size from then on. Supabase's own resizing needs a paid plan.

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 20_000;
const MAX_PARALLEL_RESIZES = 2;
const MEMORY_CACHE_BYTES = 32 * 1024 * 1024;
const YEAR_SECONDS = 31_536_000;

// Recently sent copies, kept in memory (oldest dropped first), so most photos
// are answered without a trip to the bucket.
const memoryCache = new Map<string, Buffer>();
let memoryCacheBytes = 0;
const inflight = new Map<string, Promise<Buffer | null>>();
let running = 0;
const waiting: Array<() => void> = [];

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

async function withResizeSlot<T>(work: () => Promise<T>) {
  if (running >= MAX_PARALLEL_RESIZES) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function fetchStoredVariant(variantPath: string) {
  try {
    const res = await fetch(buildSupabaseMediaUrl(variantPath), { signal: AbortSignal.timeout(8_000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
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

async function makeVariant(objectPath: string, width: number, variantPath: string) {
  return withResizeSlot(async () => {
    const source = await fetchSource(objectPath);
    if (!source) return null;
    const resized = await resizePhoto(source, width);
    const { error } = await getSupabaseStorageClient()
      .storage.from(getPublicMediaBucket())
      .upload(variantPath, resized, { contentType: "image/webp", cacheControl: String(YEAR_SECONDS), upsert: true });
    if (error) {
      console.warn("[MEDIA] Could not store photo copy:", variantPath, error.message);
    }
    remember(variantPath, resized);
    return resized;
  });
}

/** Makes the copy if it isn't stored yet; one attempt at a time per copy. */
function ensureVariant(objectPath: string, width: number) {
  const variantPath = variantObjectPath(objectPath, width);
  const pending = inflight.get(variantPath);
  if (pending) return pending;
  const job = makeVariant(objectPath, width, variantPath)
    .catch((error) => {
      console.warn("[MEDIA] Could not resize photo:", objectPath, error instanceof Error ? error.message : error);
      return null;
    })
    .finally(() => inflight.delete(variantPath));
  inflight.set(variantPath, job);
  return job;
}

/** After an upload: make the sizes cards and pages ask for most, in the background. */
export function warmPhotoVariants(publicUrl: string) {
  const objectPath = objectPathFromPublicUrl(publicUrl);
  if (!objectPath) return;
  void (async () => {
    for (const width of [480, 800, 1200]) {
      await ensureVariant(objectPath, width);
    }
  })();
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
      let body = recall(variantPath);
      if (!body) {
        body = await fetchStoredVariant(variantPath);
        if (body) remember(variantPath, body);
      }
      body ??= await ensureVariant(objectPath, width);
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

