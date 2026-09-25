// zaina-platform/src/gateway/origin.ts
//
// Which websites may call a business's chat from a browser. A browser always
// sends Origin on these requests; a page on another site is refused. Calls
// without an Origin (servers, curl) are not browsers and fall to the rate
// limits and session tokens instead.

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowedOrigins.some((allowed) => normalizeOrigin(allowed) === normalized);
}
