export type PublicListingKind = "stay" | "car" | "cook" | "errand" | "experience";

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
