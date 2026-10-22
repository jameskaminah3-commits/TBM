export type PublicListingKind = "stay" | "car" | "cook" | "errand" | "experience";

const seoSiteName = "Tembea Bila Matata";
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

// What Google shows of a title before cutting it off.
const listingTitleLimit = 60;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A listing's automatic title: its name, what it is and where, in the 60
 * characters Google shows. "Bahari Beach Hotel – Nyali" in Nyali becomes
 * "Bahari Beach Hotel in Nyali | Tembea Bila Matata"; a long name loses its
 * subtitle, then the brand shortens to TBM. Never cut off mid-word with "...".
 */
export function buildListingSeoTitle(kind: PublicListingKind, label: string, place: string) {
  const kindLabel = kind === "car" ? "car hire" : kind === "cook" ? "private chef" : kind === "errand" ? "home help" : "";
  const full = cleanSeoText(label) || "Listing";
  const placeName = cleanSeoText(place) || "Mombasa";
  const placeKey = placeName.split(",")[0].trim();
  // The place at the end of a name is said once, after "in".
  const withoutPlace = (value: string) => value
    .replace(new RegExp(`(?:\\s*[—–|,-]\\s*|\\s+in\\s+)${escapeRegExp(placeKey)}$`, "i"), "")
    .trim() || value;
  const head = full.split(/\s+[—–|-]\s+/)[0]?.trim() ?? full;
  const names = [withoutPlace(full), withoutPlace(head.length >= 8 ? head : full)];
  const describe = (name: string) => {
    const withKind = kindLabel && !name.toLowerCase().includes(kindLabel) ? `${name}, ${kindLabel}` : name;
    return new RegExp(`(^|[^a-z])${escapeRegExp(placeKey.toLowerCase())}([^a-z]|$)`).test(name.toLowerCase())
      ? withKind
      : `${withKind} in ${placeName}`;
  };
  const candidates = [
    `${describe(names[0])} | ${seoSiteName}`,
    `${describe(names[0])} | TBM`,
    `${describe(names[1])} | ${seoSiteName}`,
    `${describe(names[1])} | TBM`,
  ];
  const fits = candidates.find((candidate) => candidate.length <= listingTitleLimit);
  if (fits) return fits;
  // Still too long: whole words only, then the short brand.
  const words = describe(names[1]).split(" ");
  while (words.length > 1 && `${words.join(" ")} | TBM`.length > listingTitleLimit) words.pop();
  return `${words.join(" ").replace(/[,–—|-]+$/, "").trim()} | TBM`;
}

export function getListingSeoTitle(
  kind: PublicListingKind,
  label: string,
  location?: string | null,
) {
  return buildListingSeoTitle(kind, label, getShortSeoLocation(location));
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
