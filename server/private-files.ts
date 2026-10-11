// Protected files: vehicle documents (logbooks, insurance, inspection,
// licences), fleet-application files, and photos guests attach to requests.
// They are compliance records, not listing content, so they never go in the
// public media bucket. They live in a private store and are opened only through
// GET /api/files/<key>, which checks who is asking and logs every attempt.
// Listing photos stay public in the media bucket as before.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { PrivateFileKind } from "@shared/schema";
import { pool } from "./db";
import {
  buildSupabaseMediaUrl,
  buildUploadFilename,
  decodeUploadPayload,
  getPublicMediaBucket,
  getSupabaseStorageClient,
  usesLocalUploadStorage,
} from "./media";
import { privateFileUrl } from "./private-file-key";

export { PRIVATE_FILE_ROUTE, isPrivateFileKey, privateFileKeyFromUrl, privateFileUrl } from "./private-file-key";

const signedUrlSeconds = 300;
const localPrivateDir = path.resolve(process.cwd(), "private-uploads");
const localPublicDir = path.resolve(process.cwd(), "uploads");

function privateBucketName() {
  return process.env.SUPABASE_PRIVATE_BUCKET?.trim() || "tbm-private-files";
}

let privateBucketReady: Promise<void> | null = null;

// The private bucket must exist and must not be public. It is created private
// if missing; a public one is refused rather than used.
export function ensurePrivateStorage(): Promise<void> {
  if (usesLocalUploadStorage()) {
    fs.mkdirSync(localPrivateDir, { recursive: true });
    return Promise.resolve();
  }
  privateBucketReady ??= (async () => {
    const name = privateBucketName();
    if (name === getPublicMediaBucket()) {
      throw new Error("SUPABASE_PRIVATE_BUCKET must not be the public media bucket.");
    }
    const client = getSupabaseStorageClient();
    const { data, error } = await client.storage.getBucket(name);
    if (error || !data) {
      const created = await client.storage.createBucket(name, { public: false });
      if (created.error) {
        throw new Error(`Couldn't create the private bucket "${name}": ${created.error.message}`);
      }
      return;
    }
    if (data.public) {
      throw new Error(`The bucket "${name}" is public. Make it private before it holds protected files.`);
    }
  })().catch((error) => {
    privateBucketReady = null;
    throw error;
  });
  return privateBucketReady;
}

let tablesReady: Promise<void> | null = null;

export function ensurePrivateFileTables(): Promise<void> {
  tablesReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS private_files (
      key varchar PRIMARY KEY,
      kind varchar NOT NULL,
      owner_user_id varchar,
      mime_type varchar,
      size_bytes integer,
      source_path text,
      created_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS private_file_access (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      file_key varchar NOT NULL,
      user_id varchar,
      role varchar,
      allowed boolean NOT NULL,
      reason varchar NOT NULL,
      created_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS private_file_access_file_idx ON private_file_access (file_key, created_at);
    CREATE TABLE IF NOT EXISTS storage_migrations (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      old_path text NOT NULL UNIQUE,
      new_key varchar NOT NULL,
      category varchar NOT NULL,
      references_updated integer NOT NULL DEFAULT 0,
      copied_at text NOT NULL,
      verified_at text,
      public_removed_at text
    );
  `).then(() => undefined).catch((error) => {
    tablesReady = null;
    throw error;
  });
  return tablesReady;
}

function localPrivatePath(key: string) {
  const resolved = path.resolve(localPrivateDir, key);
  if (!resolved.startsWith(`${localPrivateDir}${path.sep}`)) {
    throw new Error("Invalid file key");
  }
  return resolved;
}

async function putPrivateObject(key: string, body: Buffer, mimeType: string) {
  await ensurePrivateStorage();
  if (usesLocalUploadStorage()) {
    const filePath = localPrivatePath(key);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, body, { flag: "wx" });
    return;
  }
  const { error } = await getSupabaseStorageClient().storage.from(privateBucketName()).upload(key, body, {
    contentType: mimeType,
    cacheControl: "0",
    upsert: false,
  });
  if (error) {
    throw new Error(`Couldn't store the file privately: ${error.message}`);
  }
}

export type PrivateFileRecord = {
  key: string;
  kind: PrivateFileKind;
  ownerUserId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sourcePath: string | null;
};

export async function recordPrivateFile(record: PrivateFileRecord) {
  await ensurePrivateFileTables();
  await pool.query(
    `INSERT INTO private_files (key, kind, owner_user_id, mime_type, size_bytes, source_path, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (key) DO NOTHING`,
    [record.key, record.kind, record.ownerUserId, record.mimeType, record.sizeBytes, record.sourcePath, new Date().toISOString()],
  );
}

export async function getPrivateFile(key: string): Promise<PrivateFileRecord | null> {
  await ensurePrivateFileTables();
  const { rows } = await pool.query(
    `SELECT key, kind, owner_user_id AS "ownerUserId", mime_type AS "mimeType", size_bytes AS "sizeBytes", source_path AS "sourcePath"
     FROM private_files WHERE key = $1`,
    [key],
  );
  return rows[0] ?? null;
}

// Checked like any upload (type, size, real contents), then stored privately.
export async function savePrivateUpload(args: { dataUrl: string; mimeType: string; kind: PrivateFileKind; ownerUserId: string | null }) {
  const { fileBuffer, extension } = decodeUploadPayload(args.dataUrl, args.mimeType);
  const key = `${args.kind}/${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(16).toString("hex")}.${extension}`;
  await putPrivateObject(key, fileBuffer, args.mimeType);
  await recordPrivateFile({ key, kind: args.kind, ownerUserId: args.ownerUserId, mimeType: args.mimeType, sizeBytes: fileBuffer.length, sourcePath: null });
  return { key, url: privateFileUrl(key) };
}

// How the file route hands over a permitted file: the local file itself, or a
// short-lived signed link to the private bucket.
export async function openPrivateFile(key: string): Promise<{ type: "file"; filePath: string } | { type: "redirect"; url: string }> {
  if (usesLocalUploadStorage()) {
    return { type: "file", filePath: localPrivatePath(key) };
  }
  await ensurePrivateStorage();
  const { data, error } = await getSupabaseStorageClient().storage.from(privateBucketName()).createSignedUrl(key, signedUrlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Couldn't open the private file: ${error?.message ?? "no link"}`);
  }
  return { type: "redirect", url: data.signedUrl };
}

export async function privateObjectExists(key: string) {
  if (usesLocalUploadStorage()) {
    return fs.existsSync(localPrivatePath(key));
  }
  const folder = key.slice(0, key.lastIndexOf("/"));
  const name = key.slice(key.lastIndexOf("/") + 1);
  const { data, error } = await getSupabaseStorageClient().storage.from(privateBucketName()).list(folder, { limit: 100, search: name });
  return !error && (data ?? []).some((item) => item.name === name);
}

// Migration: copy a file already in the public bucket into private storage.
// The public copy stays until it is removed separately, after checks.
export async function copyPublicObjectToPrivate(publicPath: string, key: string) {
  await ensurePrivateStorage();
  if (usesLocalUploadStorage()) {
    const source = path.resolve(localPublicDir, publicPath.replace(/^legacy\//, ""));
    if (!source.startsWith(`${localPublicDir}${path.sep}`)) {
      throw new Error("Invalid public path");
    }
    const target = localPrivatePath(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    return;
  }
  const { error } = await getSupabaseStorageClient().storage
    .from(getPublicMediaBucket())
    .copy(publicPath, key, { destinationBucket: privateBucketName() });
  if (error) {
    throw new Error(`Couldn't copy ${publicPath} to private storage: ${error.message}`);
  }
}

export async function removePublicObjects(publicPaths: string[]) {
  if (!publicPaths.length) {
    return;
  }
  if (usesLocalUploadStorage()) {
    for (const publicPath of publicPaths) {
      const target = path.resolve(localPublicDir, publicPath.replace(/^legacy\//, ""));
      if (target.startsWith(`${localPublicDir}${path.sep}`)) {
        await fs.promises.rm(target, { force: true });
      }
    }
    return;
  }
  const { error } = await getSupabaseStorageClient().storage.from(getPublicMediaBucket()).remove(publicPaths);
  if (error) {
    throw new Error(`Couldn't remove public copies: ${error.message}`);
  }
}

export function publicObjectUrl(publicPath: string) {
  return usesLocalUploadStorage() ? `/uploads/${publicPath.replace(/^legacy\//, "")}` : buildSupabaseMediaUrl(publicPath);
}

// An approved application's vehicle photos become the car's public listing
// photos: copied from private storage into the public media bucket.
export async function publishPrivatePhoto(key: string) {
  const extension = path.extname(key).slice(1) || "jpg";
  const filename = buildUploadFilename(extension);
  if (usesLocalUploadStorage()) {
    await fs.promises.mkdir(localPublicDir, { recursive: true });
    await fs.promises.copyFile(localPrivatePath(key), path.join(localPublicDir, filename), fs.constants.COPYFILE_EXCL);
    return `/uploads/${filename}`;
  }
  const publicPath = `${new Date().toISOString().slice(0, 10)}/${filename}`;
  const { error } = await getSupabaseStorageClient().storage
    .from(privateBucketName())
    .copy(key, publicPath, { destinationBucket: getPublicMediaBucket() });
  if (error) {
    throw new Error(`Couldn't publish the photo: ${error.message}`);
  }
  return buildSupabaseMediaUrl(publicPath);
}

// Who else may open a file: the manager of a car whose documents list it, and
// the guest or a partner with a job on a booking whose request attaches it.
export async function getPrivateFileContext(key: string, userId: string) {
  const url = privateFileUrl(key);
  const [cars, bookings] = await Promise.all([
    pool.query("SELECT 1 FROM cars WHERE manager_user_id = $1 AND position($2 in documents::text) > 0 LIMIT 1", [userId, url]),
    pool.query(
      `SELECT b.user_id AS "userId",
              EXISTS (SELECT 1 FROM booking_service_assignments a WHERE a.booking_id = b.id AND a.provider_user_id = $1) AS "partnerOnBooking"
       FROM bookings b
       WHERE position($2 in coalesce(b.service_request_details, '')) > 0
          OR position($2 in coalesce(b.stay_service_selections::text, '')) > 0`,
      [userId, url],
    ),
  ]);
  const bookingAccess = bookings.rows.some((row) => row.userId === userId)
    ? "guest" as const
    : bookings.rows.some((row) => row.partnerOnBooking) ? "partner" as const : null;
  return { managesReferencingCar: cars.rowCount! > 0, bookingAccess };
}

export async function logPrivateFileAccess(entry: { key: string; userId: string | null; role: string | null; allowed: boolean; reason: string }) {
  await ensurePrivateFileTables();
  await pool.query(
    "INSERT INTO private_file_access (file_key, user_id, role, allowed, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [entry.key.slice(0, 300), entry.userId, entry.role, entry.allowed, entry.reason, new Date().toISOString()],
  );
}
