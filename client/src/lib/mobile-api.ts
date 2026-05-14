const DEFAULT_MOBILE_API_BASE_URL = "https://tembeabilamatata.com";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getConfiguredApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  if (typeof window !== "undefined" && window.location.protocol === "capacitor:") {
    return DEFAULT_MOBILE_API_BASE_URL;
  }

  return "";
}

export function resolveApiUrl(url: string) {
  const apiBaseUrl = getConfiguredApiBaseUrl();
  if (!apiBaseUrl || !url.startsWith("/api")) {
    return url;
  }

  return `${apiBaseUrl}${url}`;
}

export function configureMobileApiFetch() {
  const apiBaseUrl = getConfiguredApiBaseUrl();
  if (!apiBaseUrl || typeof window === "undefined") {
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string") {
      return nativeFetch(resolveApiUrl(input), init);
    }

    if (input instanceof URL && input.pathname.startsWith("/api")) {
      return nativeFetch(new URL(input.pathname + input.search + input.hash, apiBaseUrl), init);
    }

    return nativeFetch(input, init);
  };
}
