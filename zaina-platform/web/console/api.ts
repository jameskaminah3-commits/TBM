// zaina-platform/web/console/api.ts
//
// The console talks to the platform's staff API with its sign-in cookie
// (HttpOnly: this code never sees it) and the X-Zaina-Console header the
// server requires with that cookie.

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) {
    super(message);
  }
}

const fallbackMessages: Record<number, string> = {
  400: "That didn't look right. Please check and try again.",
  403: "You don't have permission to do that.",
  404: "That wasn't found. It may have been deleted.",
  409: "That clashes with something that already exists.",
  413: "That's too long.",
  429: "Too many attempts. Please wait a moment.",
};

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "x-zaina-console": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401 && !path.startsWith("/v1/console/session")) {
    window.dispatchEvent(new CustomEvent("zaina:signed-out"));
  }
  return response;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await send(method, path, body);
  } catch {
    throw new ApiError(0, "network", "Can't reach Zaina. Check your connection.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? null, data?.message ?? fallbackMessages[response.status] ?? "Something went wrong. Please try again.");
  }
  return data as T;
}

/** A file (a customer's photo) as a local object URL. */
export async function apiFile(path: string): Promise<{ url: string; type: string }> {
  const response = await send("GET", path);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error ?? null, data?.message ?? "The file isn't available.");
  }
  const blob = await response.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

export const businessPath = (businessId: string, rest = "") => `/v1/staff/businesses/${encodeURIComponent(businessId)}${rest}`;
