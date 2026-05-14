function normalizeHost(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\.$/, "") || null;
}

type CanonicalRedirectArgs = {
  canonicalBaseUrl: string;
  redirectHosts: Iterable<string>;
  requestHost: string | null | undefined;
  requestPath: string | null | undefined;
};

export function getCanonicalRedirectUrl(args: CanonicalRedirectArgs) {
  const normalizedRequestHost = normalizeHost(args.requestHost);
  if (!normalizedRequestHost) {
    return null;
  }

  let canonicalUrl: URL;
  try {
    canonicalUrl = new URL(args.canonicalBaseUrl);
  } catch {
    return null;
  }

  const normalizedCanonicalHost = normalizeHost(canonicalUrl.hostname);
  const normalizedRedirectHosts = new Set(
    Array.from(args.redirectHosts)
      .map((host) => normalizeHost(host))
      .filter((host): host is string => Boolean(host)),
  );

  if (
    !normalizedCanonicalHost
    || normalizedRequestHost === normalizedCanonicalHost
    || !normalizedRedirectHosts.has(normalizedRequestHost)
  ) {
    return null;
  }

  const requestPath = args.requestPath?.startsWith("/") ? args.requestPath : `/${args.requestPath || ""}`;
  return new URL(requestPath, canonicalUrl).toString();
}
