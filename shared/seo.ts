export type PublicListingKind = "stay" | "car" | "cook" | "errand" | "experience";

const seoSiteName = "Tembea Bila Matata";
const seoTitleMaxLength = 75;
const seoDescriptionMaxLength = 160;

const mombasaNeighbourhoods = new Set([
  "bamburi",
  "kisauni",
  "likoni",
  "mombasa",
  "mtwapa",
  "nyali",
  "shanzu",
  "tudor",
]);

const coastDestinations = new Set([
  "diani",
  "kilifi",
  "malindi",
  "mambrui",
  "watamu",
]);

const publicListingPrefixes: Record<PublicListingKind, string> = {
  stay: "accommodation",
  car: "transport",
  cook: "chef",
  errand: "errand",
  experience: "experience",
};

export function slugifyForUrl(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function getPublicListingPath(kind: PublicListingKind, id: string, label: string) {
  const prefix = publicListingPrefixes[kind];
  const slug = slugifyForUrl(label);
  return `/${prefix}/${encodeURIComponent(id)}${slug ? `/${slug}` : ""}`;
}

function cleanSeoText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateSeoText(value: string, maxLength = seoDescriptionMaxLength) {
  const normalized = cleanSeoText(value);
  if (normalized.length <= maxLength) return normalized;

  const suffix = "...";
  const clipped = normalized.slice(0, Math.max(1, maxLength - suffix.length));
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > Math.floor(maxLength * 0.55) ? clipped.slice(0, lastSpace) : clipped).trimEnd()}${suffix}`;
}

function dedupeLocationParts(parts: string[]) {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = part.toLocaleLowerCase();
    if (!part || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Normalizes listing locations into crawlable local hierarchy, while keeping
 * the original location wording when it contains a more specific place.
 */
export function formatSeoLocation(value?: string | null) {
  const raw = cleanSeoText(value || "");
  if (!raw) return "Mombasa, Kenya";

  const normalized = raw
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+(Kenya|KE)$/i, ",$1");
  const parts = dedupeLocationParts(normalized.split(",").map((part) => part.trim()));
  const firstPart = parts[0]?.toLocaleLowerCase();

  if (parts.length === 1 && mombasaNeighbourhoods.has(firstPart)) {
    parts.push("Mombasa");
  } else if (parts.length === 1 && coastDestinations.has(firstPart)) {
    parts.push("Kenyan Coast");
  }

  if (!parts.some((part) => /^(kenya|ke)$/i.test(part))) {
    parts.push("Kenya");
  }

  return dedupeLocationParts(parts).join(", ");
}

export function getShortSeoLocation(value?: string | null) {
  const parts = formatSeoLocation(value).split(", ");
  return parts.filter((part) => !/^(kenya|ke)$/i.test(part)).slice(0, 2).join(", ") || "Mombasa";
}

function compactListingLabel(kind: PublicListingKind, label: string) {
  const normalized = cleanSeoText(label);
  if (kind === "stay") {
    const beforeDivider = normalized.split(/\s+[—|]\s+/)[0]?.trim();
    if (beforeDivider && beforeDivider.length >= 12) return beforeDivider;
  }
  return normalized;
}

export function getListingSeoTitle(
  kind: PublicListingKind,
  label: string,
  location?: string | null,
  brand = seoSiteName,
) {
  const kindLabel = kind === "car"
    ? "car hire"
    : kind === "cook"
      ? "private chef"
      : kind === "errand"
        ? "concierge service"
        : kind === "experience"
          ? "coastal experience"
          : "";
  const name = compactListingLabel(kind, label);
  const titlePrefix = `${name}${kindLabel && !name.toLocaleLowerCase().includes(kindLabel) ? ` ${kindLabel}` : ""} in ${getShortSeoLocation(location)}`;
  const suffix = ` | ${brand}`;
  return `${truncateSeoText(titlePrefix, Math.max(20, seoTitleMaxLength - suffix.length))}${suffix}`;
}

export function buildListingSeoDescription(parts: Array<string | null | undefined>) {
  return truncateSeoText(
    parts
      .map((part) => cleanSeoText(part || ""))
      .filter(Boolean)
      .join(". "),
    seoDescriptionMaxLength,
  );
}
