const CANONICAL_ORIGIN = "https://tembeabilamatata.com";

export function buildCanonicalUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${CANONICAL_ORIGIN}${normalizedPath}`;
}
