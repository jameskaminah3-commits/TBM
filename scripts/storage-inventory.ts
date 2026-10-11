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
import { buildInventory, privateCategories, summarizeInventory, toCsv } from "../server/storage-inventory";
import { collectReferences, getInventoryConfig, listObjects } from "../server/storage-inventory-source";

const outIndex = process.argv.indexOf("--out");
const outDir = path.resolve(outIndex > 0 ? process.argv[outIndex + 1] : `storage-inventory-${new Date().toISOString().slice(0, 10)}`);
const { bucket, supabaseUrl, serviceRoleKey, anonKey, publicBaseUrl, localUploads } = getInventoryConfig();

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
