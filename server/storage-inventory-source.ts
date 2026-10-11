// Where the storage inventory and the private-files migration get their facts:
// every object in the media bucket, and every record that points at a file.
// Read-only: SELECT queries and storage listings only.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { pool } from "./db";
import {
  attachmentUrlsFromText,
  objectPathFromUrl,
  type FileReference,
  type FileReferenceSource,
  type InventoryObject,
} from "./storage-inventory";

export function getInventoryConfig() {
  const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim() ?? "";
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  return {
    bucket,
    supabaseUrl,
    serviceRoleKey,
    anonKey: (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "").trim(),
    publicBaseUrl: process.env.SUPABASE_MEDIA_PUBLIC_BASE_URL?.trim() || null,
    localUploads: !bucket || !supabaseUrl || !serviceRoleKey || process.env.MEDIA_STORAGE_BACKEND?.trim().toLowerCase() === "local",
  };
}

const config = getInventoryConfig();
const { bucket, supabaseUrl, serviceRoleKey, localUploads } = config;
const bucketConfig = { bucket, supabaseUrl, publicBaseUrl: config.publicBaseUrl };

async function columnsOf(table: string) {
  const result = await pool.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    [table],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

// Every record that points at a file, keyed by the file's bucket path.
export async function collectReferences() {
  const references = new Map<string, FileReference[]>();
  const add = (url: unknown, source: FileReferenceSource, table: string, recordId: string, label?: string | null) => {
    const objectPath = typeof url === "string" ? objectPathFromUrl(url, bucketConfig) : null;
    if (objectPath) {
      references.set(objectPath, [...(references.get(objectPath) ?? []), { source, table, recordId, label: label ?? null }]);
    }
  };
  const mediaItems = (value: unknown) => (Array.isArray(value) ? value : []) as Array<{ url?: string; label?: string }>;

  const listingTables = ["stays", "cars", "cooks", "errands", "experiences", "accommodations", "services", "providers", "stay_room_types"];
  for (const table of listingTables) {
    const columns = await columnsOf(table);
    if (!columns.size) continue;
    const select = ["id", columns.has("image_url") ? "image_url" : null, columns.has("gallery_urls") ? "gallery_urls" : null, table === "cars" && columns.has("documents") ? "documents" : null].filter(Boolean);
    const { rows } = await pool.query(`SELECT ${select.join(", ")} FROM ${table}`);
    for (const row of rows) {
      add(row.image_url, "listing-photo", table, row.id);
      for (const url of row.gallery_urls ?? []) add(url, "listing-photo", table, row.id);
      for (const item of mediaItems(row.documents)) add(item.url, "car-document", table, row.id, item.label);
    }
  }

  if ((await columnsOf("fleet_applications")).size) {
    const { rows } = await pool.query("SELECT id, photo_urls, document_urls FROM fleet_applications");
    for (const row of rows) {
      for (const item of mediaItems(row.document_urls)) add(item.url, "fleet-application-document", "fleet_applications", row.id, item.label);
      for (const item of mediaItems(row.photo_urls)) add(item.url, "fleet-application-photo", "fleet_applications", row.id, item.label);
    }
  }

  if ((await columnsOf("blog_posts")).has("featured_image")) {
    const { rows } = await pool.query("SELECT id, featured_image FROM blog_posts");
    for (const row of rows) add(row.featured_image, "blog-image", "blog_posts", row.id);
  }

  const bookingColumns = await columnsOf("bookings");
  if (bookingColumns.has("service_request_details")) {
    const select = ["id", "service_request_details", bookingColumns.has("stay_service_selections") ? "stay_service_selections" : null].filter(Boolean);
    const { rows } = await pool.query(`SELECT ${select.join(", ")} FROM bookings WHERE service_request_details LIKE '%Attachment:%' OR ${bookingColumns.has("stay_service_selections") ? "stay_service_selections::text LIKE '%Attachment:%'" : "false"}`);
    for (const row of rows) {
      for (const url of attachmentUrlsFromText(row.service_request_details)) add(url, "guest-attachment", "bookings", row.id);
      for (const selection of Array.isArray(row.stay_service_selections) ? row.stay_service_selections : []) {
        for (const url of attachmentUrlsFromText(selection?.serviceRequestDetails)) add(url, "guest-attachment", "bookings", row.id);
      }
    }
  }
  return references;
}

// Every object in the bucket: from Postgres's storage.objects if the database
// role can read it, otherwise through the Storage API.
export async function listObjects(): Promise<{ objects: InventoryObject[]; via: string }> {
  if (localUploads) {
    const dir = path.resolve("uploads");
    const names = fs.existsSync(dir)
      ? (fs.readdirSync(dir, { recursive: true }) as string[]).filter((name) => fs.statSync(path.join(dir, name)).isFile())
      : [];
    return {
      via: "local uploads/ folder (Supabase not configured)",
      objects: names.map((name) => {
        const stat = fs.statSync(path.join(dir, name));
        return { path: `legacy/${name.split(path.sep).join("/")}`, size: stat.size, mimetype: name.endsWith(".pdf") ? "application/pdf" : null, createdAt: stat.mtime.toISOString() };
      }),
    };
  }
  try {
    const { rows } = await pool.query(
      "SELECT name, created_at, metadata->>'size' AS size, metadata->>'mimetype' AS mimetype FROM storage.objects WHERE bucket_id = $1 ORDER BY created_at",
      [bucket],
    );
    return {
      via: "storage.objects (SQL)",
      objects: rows.map((row) => ({ path: row.name, size: row.size ? Number(row.size) : null, mimetype: row.mimetype ?? null, createdAt: new Date(row.created_at).toISOString() })),
    };
  } catch (error) {
    console.warn(`[inventory] storage.objects isn't readable with this database role (${(error as Error).message}); using the Storage API.`);
  }
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const objects: InventoryObject[] = [];
  const walk = async (prefix: string) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset });
      if (error) throw new Error(`Storage list failed at "${prefix}": ${error.message}`);
      for (const item of data ?? []) {
        const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null) {
          await walk(itemPath);
        } else {
          const metadata = (item.metadata ?? {}) as { size?: number; mimetype?: string };
          objects.push({ path: itemPath, size: metadata.size ?? null, mimetype: metadata.mimetype ?? null, createdAt: item.created_at ?? null });
        }
      }
      if (!data || data.length < 1000) break;
    }
  };
  await walk("");
  return { objects, via: "Storage API list" };
}

