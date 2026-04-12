import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type MediaStorageBackend = "local" | "supabase";

const uploadDir = path.resolve(process.cwd(), "uploads");
const megabyte = 1024 * 1024;
const maxUploadBytesByMimeType: Record<string, number> = {
  "image/jpeg": 8 * megabyte,
  "image/png": 8 * megabyte,
  "image/webp": 8 * megabyte,
  "video/mp4": 15 * megabyte,
  "video/webm": 15 * megabyte,
  "video/quicktime": 15 * megabyte,
};

let supabaseStorageClient: SupabaseClient | null = null;
let loggedSupabaseFallback = false;

function getConfiguredMediaStorageBackend(): MediaStorageBackend {
  const configuredBackend = process.env.MEDIA_STORAGE_BACKEND?.trim().toLowerCase();
  if (configuredBackend === "supabase") {
    if (!hasSupabaseMediaStorageConfig() && process.env.NODE_ENV !== "production") {
      if (!loggedSupabaseFallback) {
        console.warn(
          "[MEDIA] MEDIA_STORAGE_BACKEND is set to supabase, but Supabase media credentials are incomplete. Falling back to local uploads for this non-production environment.",
        );
        loggedSupabaseFallback = true;
      }
      return "local";
    }

    return "supabase";
  }

  if (configuredBackend === "local") {
    return "local";
  }

  return hasSupabaseMediaStorageConfig() ? "supabase" : "local";
}

function hasSupabaseMediaStorageConfig() {
  return Boolean(
    process.env.SUPABASE_URL?.trim()
    && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    && process.env.SUPABASE_MEDIA_BUCKET?.trim(),
  );
}

function getSupabaseMediaStorageConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim();

  if (!supabaseUrl || !serviceRoleKey || !bucket) {
    throw new Error(
      "Supabase media storage is not fully configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_MEDIA_BUCKET.",
    );
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    bucket,
    publicBaseUrl: process.env.SUPABASE_MEDIA_PUBLIC_BASE_URL?.trim() || null,
  };
}

function sanitizeObjectPath(objectPath: string) {
  return objectPath
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => Boolean(segment) && segment !== "." && segment !== "..")
    .join("/");
}

function getSupabaseStorageClient() {
  if (!supabaseStorageClient) {
    const { supabaseUrl, serviceRoleKey } = getSupabaseMediaStorageConfig();
    supabaseStorageClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabaseStorageClient;
}

export function usesLocalUploadStorage() {
  return getConfiguredMediaStorageBackend() === "local";
}

export function canUseSupabaseMediaStorage() {
  return getConfiguredMediaStorageBackend() === "supabase";
}

export function ensureMediaStorageReady() {
  const backend = getConfiguredMediaStorageBackend();
  if (backend === "supabase") {
    getSupabaseMediaStorageConfig();
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Local media storage is disabled in production. Configure Supabase media storage or set MEDIA_STORAGE_BACKEND explicitly for a non-production environment.",
    );
  }
}

export function ensureUploadDir() {
  if (!usesLocalUploadStorage()) {
    return;
  }

  fs.mkdirSync(uploadDir, { recursive: true });
}

export function getUploadDir() {
  ensureUploadDir();
  return uploadDir;
}

export function buildUploadFilename(extension: string) {
  return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
}

export function getFileExtension(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    default:
      return null;
  }
}

function hasPrefix(buffer: Buffer, prefix: number[]) {
  return prefix.every((value, index) => buffer[index] === value);
}

function isValidUploadSignature(buffer: Buffer, mimeType: string) {
  if (buffer.length === 0) {
    return false;
  }

  switch (mimeType) {
    case "image/jpeg":
      return hasPrefix(buffer, [0xff, 0xd8, 0xff]);
    case "image/png":
      return hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return buffer.length >= 12
        && buffer.toString("ascii", 0, 4) === "RIFF"
        && buffer.toString("ascii", 8, 12) === "WEBP";
    case "video/webm":
      return hasPrefix(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
    case "video/mp4":
      return buffer.length >= 12
        && buffer.toString("ascii", 4, 8) === "ftyp"
        && buffer.toString("ascii", 8, 12) !== "qt  ";
    case "video/quicktime":
      return buffer.length >= 12
        && buffer.toString("ascii", 4, 8) === "ftyp"
        && buffer.toString("ascii", 8, 12) === "qt  ";
    default:
      return false;
  }
}

async function saveLocalUpload(fileBuffer: Buffer, filename: string) {
  const filePath = path.join(getUploadDir(), filename);
  await fs.promises.writeFile(filePath, fileBuffer, { flag: "wx" });
  return `/uploads/${filename}`;
}

async function saveSupabaseUpload(fileBuffer: Buffer, mimeType: string, filename: string) {
  const { bucket } = getSupabaseMediaStorageConfig();
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${filename}`;
  const client = getSupabaseStorageClient();
  const { error } = await client.storage.from(bucket).upload(objectPath, fileBuffer, {
    contentType: mimeType,
    cacheControl: "3600",
    upsert: false,
  });

  if (error) {
    throw new Error(`Failed to upload media to Supabase Storage: ${error.message}`);
  }

  return buildSupabaseMediaUrl(objectPath);
}

export function buildSupabaseMediaUrl(objectPath: string) {
  const normalizedObjectPath = sanitizeObjectPath(objectPath);
  if (!normalizedObjectPath) {
    throw new Error("Supabase media object path is required.");
  }

  const { bucket, publicBaseUrl } = getSupabaseMediaStorageConfig();
  const client = getSupabaseStorageClient();

  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/+$/, "")}/${normalizedObjectPath}`;
  }

  const { data } = client.storage.from(bucket).getPublicUrl(normalizedObjectPath);
  if (!data.publicUrl) {
    throw new Error("Failed to resolve the uploaded media URL from Supabase Storage.");
  }

  return data.publicUrl;
}

export function buildLegacyUploadRedirectUrl(uploadPath: string) {
  const normalizedUploadPath = sanitizeObjectPath(uploadPath.replace(/\\/g, "/"));
  if (!normalizedUploadPath) {
    throw new Error("Upload path is required.");
  }

  return buildSupabaseMediaUrl(`legacy/${normalizedUploadPath}`);
}

export async function saveBase64Upload(dataUrl: string, mimeType: string) {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid upload payload");
  }

  const [, payloadMimeType, base64] = matches;
  if (payloadMimeType !== mimeType) {
    throw new Error("Upload mime type mismatch");
  }

  const extension = getFileExtension(mimeType);
  if (!extension) {
    throw new Error("Unsupported media type");
  }

  const maxBytes = maxUploadBytesByMimeType[mimeType];
  const decodedByteLength = Buffer.byteLength(base64, "base64");
  if (!Number.isFinite(decodedByteLength) || decodedByteLength <= 0) {
    throw new Error("Upload payload is empty");
  }

  if (decodedByteLength > maxBytes) {
    const allowedMb = Math.floor(maxBytes / megabyte);
    throw new Error(`File is too large. Maximum allowed size is ${allowedMb} MB.`);
  }

  const fileBuffer = Buffer.from(base64, "base64");
  if (!isValidUploadSignature(fileBuffer, mimeType)) {
    throw new Error("Uploaded file contents do not match the declared media type");
  }

  const filename = buildUploadFilename(extension);
  return usesLocalUploadStorage()
    ? saveLocalUpload(fileBuffer, filename)
    : saveSupabaseUpload(fileBuffer, mimeType, filename);
}
