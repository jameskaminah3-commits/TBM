// Pure helpers for the read-only storage inventory (scripts/storage-inventory.ts):
// turn stored links back into bucket paths, and sort every object in the media
// bucket into what it is, from the records that point at it.

export type FileReferenceSource =
  | "car-document"
  | "fleet-application-document"
  | "fleet-application-photo"
  | "guest-attachment"
  | "listing-photo"
  | "blog-image"
  | "other";

export type FileReference = { source: FileReferenceSource; table: string; recordId: string; label?: string | null };

export type StorageCategory =
  | "vehicle-document"
  | "fleet-application-document"
  | "fleet-application-photo"
  | "guest-attachment"
  | "listing-photo"
  | "blog-image"
  | "referenced-other"
  | "unreferenced-pdf"
  | "unreferenced-media";

// The more sensitive a source, the earlier it comes: an object referenced as a
// vehicle document and as a listing photo is treated as a document. A listing
// photo outranks an application photo: when an approved application's photo
// became the car's listing photo, it is meant to be public.
const sourcePriority: FileReferenceSource[] = [
  "car-document",
  "fleet-application-document",
  "guest-attachment",
  "listing-photo",
  "fleet-application-photo",
  "blog-image",
  "other",
];

const categoryBySource: Record<FileReferenceSource, StorageCategory> = {
  "car-document": "vehicle-document",
  "fleet-application-document": "fleet-application-document",
  "fleet-application-photo": "fleet-application-photo",
  "guest-attachment": "guest-attachment",
  "listing-photo": "listing-photo",
  "blog-image": "blog-image",
  other: "referenced-other",
};

export const privateCategories: ReadonlySet<StorageCategory> = new Set<StorageCategory>([
  "vehicle-document",
  "fleet-application-document",
  "fleet-application-photo",
  "guest-attachment",
  "unreferenced-pdf",
]);

type BucketConfig = { bucket: string; supabaseUrl?: string | null; publicBaseUrl?: string | null };

// A stored link → the object's path in the bucket, or null if it isn't ours.
// Handles Supabase public links, a custom public base URL, and old /uploads/
// links, which the server redirects to legacy/ in the bucket.
export function objectPathFromUrl(url: string | null | undefined, config: BucketConfig): string | null {
  const value = url?.trim();
  if (!value) {
    return null;
  }
  const candidates: string[] = [];
  if (config.publicBaseUrl) {
    candidates.push(`${config.publicBaseUrl.replace(/\/+$/, "")}/`);
  }
  if (config.supabaseUrl) {
    candidates.push(`${config.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${config.bucket}/`);
  }
  candidates.push(`/storage/v1/object/public/${config.bucket}/`);
  for (const prefix of candidates) {
    const index = value.indexOf(prefix);
    if (prefix.startsWith("/") ? index >= 0 : index === 0) {
      return decodeURIComponent(value.slice(index + prefix.length).split(/[?#]/)[0]) || null;
    }
  }
  const legacy = value.match(/^(?:https?:\/\/[^/]+)?\/uploads\/(.+)$/);
  if (legacy) {
    return `legacy/${decodeURIComponent(legacy[1].split(/[?#]/)[0])}`;
  }
  return null;
}

// Links a guest attached to a custom request are written into the request as
// "Attachment: <url>".
export function attachmentUrlsFromText(text: string | null | undefined): string[] {
  return Array.from((text ?? "").matchAll(/Attachment:\s*(\S+)/g), (match) => match[1]);
}

export function classifyObject(path: string, references: FileReference[], mimetype?: string | null): StorageCategory {
  for (const source of sourcePriority) {
    if (references.some((reference) => reference.source === source)) {
      return categoryBySource[source];
    }
  }
  const isPdf = mimetype === "application/pdf" || /\.pdf$/i.test(path);
  return isPdf ? "unreferenced-pdf" : "unreferenced-media";
}

export type InventoryObject = {
  path: string;
  size: number | null;
  mimetype: string | null;
  createdAt: string | null;
};

export type InventoryRow = InventoryObject & { category: StorageCategory; references: FileReference[] };

export function buildInventory(objects: InventoryObject[], references: Map<string, FileReference[]>) {
  const rows: InventoryRow[] = objects.map((object) => {
    const refs = references.get(object.path) ?? [];
    return { ...object, references: refs, category: classifyObject(object.path, refs, object.mimetype) };
  });
  const present = new Set(objects.map((object) => object.path));
  // Records pointing at files that aren't in the bucket (deleted or never uploaded).
  const missing = Array.from(references.entries())
    .filter(([path]) => !present.has(path))
    .map(([path, refs]) => ({ path, references: refs }));
  return { rows, missing };
}

export function summarizeInventory(rows: InventoryRow[]) {
  const byCategory: Record<string, { count: number; bytes: number; earliest: string | null; latest: string | null }> = {};
  for (const row of rows) {
    const entry = byCategory[row.category] ?? { count: 0, bytes: 0, earliest: null, latest: null };
    entry.count += 1;
    entry.bytes += row.size ?? 0;
    if (row.createdAt) {
      entry.earliest = !entry.earliest || row.createdAt < entry.earliest ? row.createdAt : entry.earliest;
      entry.latest = !entry.latest || row.createdAt > entry.latest ? row.createdAt : entry.latest;
    }
    byCategory[row.category] = entry;
  }
  const shouldBePrivate = rows.filter((row) => privateCategories.has(row.category)).length;
  return { total: rows.length, shouldBePrivate, byCategory };
}

export function toCsv(rows: InventoryRow[]) {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = ["path", "category", "should_be_private", "size_bytes", "mimetype", "created_at", "referenced_by"];
  const lines = rows.map((row) => [
    row.path,
    row.category,
    privateCategories.has(row.category) ? "yes" : "no",
    row.size,
    row.mimetype,
    row.createdAt,
    row.references.map((reference) => `${reference.table}:${reference.recordId}${reference.label ? ` (${reference.label})` : ""}`).join("; "),
  ].map(escape).join(","));
  return [header.join(","), ...lines].join("\n");
}
