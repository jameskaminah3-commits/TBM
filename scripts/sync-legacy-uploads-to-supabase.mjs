import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const uploadsRoot = path.resolve(projectRoot, "uploads");

async function loadEnvFile() {
  const envPath = path.resolve(projectRoot, ".env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmedLine.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      let value = trimmedLine.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\""))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

await loadEnvFile();

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim();
const publicBaseUrl = process.env.SUPABASE_MEDIA_PUBLIC_BASE_URL?.trim() || null;

if (!supabaseUrl || !serviceRoleKey || !bucket) {
  throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_MEDIA_BUCKET before syncing media.");
}

function getMimeType(filename) {
  const extension = path.extname(filename).toLowerCase();
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

function buildPublicUrl(objectPath) {
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/+$/, "")}/${objectPath}`;
  }

  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${objectPath}`;
}

function buildAuthorizationHeaderValue(apiKey) {
  if (apiKey.startsWith("sb_")) {
    return apiKey;
  }

  return `Bearer ${apiKey}`;
}

async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

let uploadsDirectoryExists = true;
try {
  await fs.access(uploadsRoot);
} catch {
  uploadsDirectoryExists = false;
}

if (!uploadsDirectoryExists) {
  console.log("No local uploads directory found. Nothing to sync.");
  process.exit(0);
}

const files = await collectFiles(uploadsRoot);
if (files.length === 0) {
  console.log("Uploads directory is empty. Nothing to sync.");
  process.exit(0);
}

console.log(`Syncing ${files.length} local upload file(s) to Supabase bucket '${bucket}'...`);

let uploadedCount = 0;
let skippedCount = 0;

for (const filePath of files) {
  const relativePath = path.relative(uploadsRoot, filePath).replace(/\\/g, "/");
  const objectPath = `legacy/${relativePath}`;
  const fileBuffer = await fs.readFile(filePath);
  const mimeType = getMimeType(filePath);
  const uploadUrl = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${objectPath}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: buildAuthorizationHeaderValue(serviceRoleKey),
      "Content-Type": mimeType,
      "Cache-Control": "max-age=3600",
      "x-upsert": "false",
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const responseText = await response.text();
    const lowered = responseText.toLowerCase();
    if (response.status === 400 && (lowered.includes("duplicate") || lowered.includes("already exists"))) {
      skippedCount += 1;
      console.log(`Skipped existing: ${relativePath}`);
      continue;
    }

    throw new Error(`Failed to upload ${relativePath}: ${response.status} ${response.statusText} ${responseText}`.trim());
  }

  uploadedCount += 1;
  console.log(`Uploaded: ${relativePath} -> ${buildPublicUrl(objectPath)}`);
}

console.log("");
console.log(`Done. Uploaded ${uploadedCount} file(s), skipped ${skippedCount} existing file(s).`);
console.log("Legacy /uploads/... URLs can now be redirected to Supabase from the app.");
