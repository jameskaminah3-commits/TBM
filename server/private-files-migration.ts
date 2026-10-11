// Moving protected files that are already in the public media bucket into
// private storage. Three separate steps, each run on purpose:
//   1. apply: copy each file privately, point its records at the private link,
//      and log the move. The public copy stays.
//   2. remove-public: delete the public copies of moves that were checked.
//      Old public links stop working.
//   3. restore-references (before step 2 only): point records back at the
//      public copies, to undo step 1.
// Files nothing points at are moved to a private quarantine for TBM, not
// deleted, so they can be kept as evidence.
import type { PoolClient } from "pg";
import { pool } from "./db";
import {
  copyPublicObjectToPrivate,
  ensurePrivateFileTables,
  privateFileUrl,
  privateObjectExists,
  publicObjectUrl,
  recordPrivateFile,
  removePublicObjects,
} from "./private-files";
import { attachmentUrlsFromText, buildInventory, objectPathFromUrl, type FileReference, type StorageCategory } from "./storage-inventory";
import { collectReferences, getInventoryConfig, listObjects } from "./storage-inventory-source";
import type { PrivateFileKind } from "@shared/schema";

const kindByCategory: Partial<Record<StorageCategory, PrivateFileKind>> = {
  "vehicle-document": "vehicle-document",
  "fleet-application-document": "fleet-application",
  "fleet-application-photo": "fleet-application",
  "guest-attachment": "guest-attachment",
  "unreferenced-pdf": "quarantine",
};

export type PlannedMove = {
  path: string;
  category: StorageCategory;
  kind: PrivateFileKind;
  newKey: string;
  mimetype: string | null;
  size: number | null;
  references: FileReference[];
};

function newKeyFor(kind: PrivateFileKind, publicPath: string) {
  return `${kind}/migrated/${publicPath.replace(/[^A-Za-z0-9._\-/]/g, "-")}`;
}

export async function planPrivateFileMigration() {
  await ensurePrivateFileTables();
  const [references, listing, done] = await Promise.all([
    collectReferences(),
    listObjects(),
    pool.query<{ old_path: string }>("SELECT old_path FROM storage_migrations"),
  ]);
  const moved = new Set(done.rows.map((row) => row.old_path));
  const { rows } = buildInventory(listing.objects, references);
  const moves: PlannedMove[] = rows
    .filter((row) => kindByCategory[row.category] && !moved.has(row.path))
    .map((row) => {
      const kind = kindByCategory[row.category]!;
      return { path: row.path, category: row.category, kind, newKey: newKeyFor(kind, row.path), mimetype: row.mimetype, size: row.size, references: row.references };
    });
  return { moves, alreadyMoved: moved.size, listedVia: listing.via, totalObjects: rows.length };
}

const bucketConfig = () => {
  const config = getInventoryConfig();
  return { bucket: config.bucket, supabaseUrl: config.supabaseUrl, publicBaseUrl: config.publicBaseUrl };
};

type MediaItem = { url?: string; label?: string };

function repointItems(items: unknown, publicPath: string, newUrl: string) {
  let changed = 0;
  const next = (Array.isArray(items) ? items : []).map((item: MediaItem) => {
    if (objectPathFromUrl(item?.url, bucketConfig()) === publicPath) {
      changed += 1;
      return { ...item, url: newUrl };
    }
    return item;
  });
  return { next, changed };
}

function repointText(text: string | null, publicPath: string, newUrl: string) {
  let changed = 0;
  let next = text ?? "";
  for (const url of attachmentUrlsFromText(text)) {
    if (objectPathFromUrl(url, bucketConfig()) === publicPath) {
      next = next.split(url).join(newUrl);
      changed += 1;
    }
  }
  return { next, changed };
}

// Point every record that uses the public file at its private link.
async function repointReferences(client: PoolClient, move: PlannedMove, newUrl: string) {
  let updated = 0;
  for (const reference of move.references) {
    if (reference.table === "cars" && reference.source === "car-document") {
      const { rows } = await client.query("SELECT documents FROM cars WHERE id = $1 FOR UPDATE", [reference.recordId]);
      const result = repointItems(rows[0]?.documents, move.path, newUrl);
      if (result.changed) {
        await client.query("UPDATE cars SET documents = $2::jsonb WHERE id = $1", [reference.recordId, JSON.stringify(result.next)]);
        updated += result.changed;
      }
    } else if (reference.table === "fleet_applications") {
      const { rows } = await client.query("SELECT document_urls, photo_urls FROM fleet_applications WHERE id = $1 FOR UPDATE", [reference.recordId]);
      const documents = repointItems(rows[0]?.document_urls, move.path, newUrl);
      const photos = repointItems(rows[0]?.photo_urls, move.path, newUrl);
      if (documents.changed || photos.changed) {
        await client.query(
          "UPDATE fleet_applications SET document_urls = $2::jsonb, photo_urls = $3::jsonb WHERE id = $1",
          [reference.recordId, JSON.stringify(documents.next), JSON.stringify(photos.next)],
        );
        updated += documents.changed + photos.changed;
      }
    } else if (reference.table === "bookings") {
      const { rows } = await client.query("SELECT service_request_details, stay_service_selections FROM bookings WHERE id = $1 FOR UPDATE", [reference.recordId]);
      const details = repointText(rows[0]?.service_request_details ?? null, move.path, newUrl);
      let selectionsChanged = 0;
      const selections = (Array.isArray(rows[0]?.stay_service_selections) ? rows[0].stay_service_selections : []).map((selection: { serviceRequestDetails?: string | null }) => {
        const result = repointText(selection?.serviceRequestDetails ?? null, move.path, newUrl);
        selectionsChanged += result.changed;
        return result.changed ? { ...selection, serviceRequestDetails: result.next } : selection;
      });
      if (details.changed || selectionsChanged) {
        await client.query(
          "UPDATE bookings SET service_request_details = $2, stay_service_selections = $3::jsonb WHERE id = $1",
          [reference.recordId, details.changed ? details.next : rows[0]?.service_request_details, JSON.stringify(selections)],
        );
        updated += details.changed + selectionsChanged;
      }
    }
  }
  return updated;
}

export async function applyPrivateFileMigration(moves: PlannedMove[]) {
  const results: Array<{ path: string; newKey: string; referencesUpdated: number; verified: boolean; error?: string }> = [];
  for (const move of moves) {
    try {
      await copyPublicObjectToPrivate(move.path, move.newKey);
    } catch (error) {
      results.push({ path: move.path, newKey: move.newKey, referencesUpdated: 0, verified: false, error: (error as Error).message });
      continue;
    }
    const client = await pool.connect();
    let referencesUpdated = 0;
    try {
      await client.query("BEGIN");
      referencesUpdated = await repointReferences(client, move, privateFileUrl(move.newKey));
      await client.query(
        "INSERT INTO storage_migrations (old_path, new_key, category, references_updated, copied_at) VALUES ($1, $2, $3, $4, $5)",
        [move.path, move.newKey, move.category, referencesUpdated, new Date().toISOString()],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      results.push({ path: move.path, newKey: move.newKey, referencesUpdated: 0, verified: false, error: (error as Error).message });
      continue;
    } finally {
      client.release();
    }
    await recordPrivateFile({ key: move.newKey, kind: move.kind, ownerUserId: null, mimeType: move.mimetype, sizeBytes: move.size, sourcePath: move.path });
    const verified = await privateObjectExists(move.newKey);
    if (verified) {
      await pool.query("UPDATE storage_migrations SET verified_at = $2 WHERE old_path = $1", [move.path, new Date().toISOString()]);
    }
    results.push({ path: move.path, newKey: move.newKey, referencesUpdated, verified });
  }
  return results;
}

// Delete public copies of moves that were checked. Records already point at
// the private copies, so nothing on the site changes; old public links stop working.
export async function removeMigratedPublicCopies() {
  await ensurePrivateFileTables();
  const { rows } = await pool.query<{ old_path: string }>(
    "SELECT old_path FROM storage_migrations WHERE verified_at IS NOT NULL AND public_removed_at IS NULL ORDER BY copied_at",
  );
  const paths = rows.map((row) => row.old_path);
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100);
    await removePublicObjects(batch);
    await pool.query("UPDATE storage_migrations SET public_removed_at = $2 WHERE old_path = ANY($1)", [batch, new Date().toISOString()]);
  }
  return paths;
}

// Undo step 1 for moves whose public copy still exists: records point back at
// the public file. The private copy is kept.
export async function restoreMigratedReferences() {
  await ensurePrivateFileTables();
  const { rows } = await pool.query<{ old_path: string; new_key: string }>(
    "SELECT old_path, new_key FROM storage_migrations WHERE public_removed_at IS NULL",
  );
  for (const row of rows) {
    const from = privateFileUrl(row.new_key);
    const to = publicObjectUrl(row.old_path);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE cars SET documents = replace(documents::text, $1, $2)::jsonb WHERE position($1 in documents::text) > 0", [JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1)]);
      await client.query(
        `UPDATE fleet_applications SET document_urls = replace(document_urls::text, $1, $2)::jsonb, photo_urls = replace(photo_urls::text, $1, $2)::jsonb
         WHERE position($1 in document_urls::text) > 0 OR position($1 in photo_urls::text) > 0`,
        [JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1)],
      );
      await client.query(
        `UPDATE bookings SET service_request_details = replace(service_request_details, $1, $2),
                             stay_service_selections = replace(stay_service_selections::text, $3, $4)::jsonb
         WHERE position($1 in coalesce(service_request_details, '')) > 0 OR position($3 in coalesce(stay_service_selections::text, '')) > 0`,
        [from, to, JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1)],
      );
      await client.query("DELETE FROM storage_migrations WHERE old_path = $1", [row.old_path]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return rows.map((row) => row.old_path);
}
