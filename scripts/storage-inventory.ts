// Read-only inventory of the media bucket: every stored file, what it is (from
// the records that point at it), whether it should be private, and whether the
// public can list or open the bucket. It never downloads, changes or deletes a
// file and only runs SELECT queries.
//
// Run with production credentials by someone authorised to see them:
//   npx tsx scripts/storage-inventory.ts --out ./storage-inventory-private
// Needs DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
// SUPABASE_MEDIA_BUCKET; SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) adds the
// "can the public list the bucket" check. The output holds record IDs and file
// paths (no names or contact details) — keep it private and out of git.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { pool } from "../server/db";
import {
  attachmentUrlsFromText,
  buildInventory,
  objectPathFromUrl,
  privateCategories,
  summarizeInventory,
  toCsv,
  type FileReference,
  type FileReferenceSource,
  type InventoryObject,
} from "../server/storage-inventory";

const outIndex = process.argv.indexOf("--out");
const outDir = path.resolve(outIndex > 0 ? process.argv[outIndex + 1] : `storage-inventory-${new Date().toISOString().slice(0, 10)}`);
const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim() ?? "";
const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
const publicBaseUrl = process.env.SUPABASE_MEDIA_PUBLIC_BASE_URL?.trim() || null;
const localUploads = !bucket || !supabaseUrl || !serviceRoleKey;
const bucketConfig = { bucket, supabaseUrl, publicBaseUrl };

async function columnsOf(table: string) {
  const result = await pool.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    [table],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

// Every record that points at a file, keyed by the file's bucket path.
async function collectReferences() {
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
async function listObjects(): Promise<{ objects: InventoryObject[]; via: string }> {
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

// Can the public see the bucket? Lists with the public (anon) key, and sends a
// HEAD request — headers only, no file contents — for a few files that should
// be private.
async function publicAccessChecks(samplePaths: string[]) {
  if (localUploads) {
    return { bucketPublic: null, anonCanList: null, sampleHeadStatuses: [] as Array<{ path: string; status: number }> };
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: bucketInfo } = await admin.storage.getBucket(bucket);
  let anonCanList: boolean | null = null;
  if (anonKey) {
    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.storage.from(bucket).list("", { limit: 5 });
    anonCanList = !error && Array.isArray(data) && data.length > 0;
  }
  const sampleHeadStatuses: Array<{ path: string; status: number }> = [];
  for (const samplePath of samplePaths.slice(0, 3)) {
    const url = publicBaseUrl
      ? `${publicBaseUrl.replace(/\/+$/, "")}/${samplePath}`
      : `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${samplePath}`;
    const response = await fetch(url, { method: "HEAD" });
    sampleHeadStatuses.push({ path: samplePath, status: response.status });
  }
  return { bucketPublic: bucketInfo?.public ?? null, anonCanList, sampleHeadStatuses };
}

async function main() {
  const [references, listing] = await Promise.all([collectReferences(), listObjects()]);
  const { rows, missing } = buildInventory(listing.objects, references);
  const summary = summarizeInventory(rows);
  const access = await publicAccessChecks(rows.filter((row) => privateCategories.has(row.category)).map((row) => row.path));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "objects.csv"), toCsv(rows));
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    bucket: bucket || "(local uploads)",
    listedVia: listing.via,
    ...summary,
    recordsPointingAtMissingFiles: missing.length,
    publicAccess: access,
  }, null, 2));
  fs.writeFileSync(path.join(outDir, "missing-files.csv"), ["path,referenced_by", ...missing.map((entry) => `${entry.path},"${entry.references.map((ref) => `${ref.table}:${ref.recordId}`).join("; ")}"`)].join("\n"));

  console.log(`Objects: ${summary.total} (should be private: ${summary.shouldBePrivate}), listed via ${listing.via}`);
  for (const [category, entry] of Object.entries(summary.byCategory)) {
    console.log(`  ${category.padEnd(28)} ${String(entry.count).padStart(6)}  ${(entry.bytes / 1048576).toFixed(1)} MB  ${entry.earliest?.slice(0, 10) ?? "-"} → ${entry.latest?.slice(0, 10) ?? "-"}`);
  }
  console.log(`Records pointing at missing files: ${missing.length}`);
  console.log(`Bucket public: ${access.bucketPublic ?? "n/a"} · public key can list: ${access.anonCanList ?? "not checked"} · HEAD on private-category samples: ${access.sampleHeadStatuses.map((sample) => sample.status).join(", ") || "n/a"}`);
  console.log(`Written to ${outDir} — keep it private.`);
  await pool.end();
}

main().catch(async (error) => {
  console.error("[inventory] failed:", error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
