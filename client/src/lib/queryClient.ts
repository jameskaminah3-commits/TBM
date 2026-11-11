import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function getResponseErrorMessage(res: Response) {
  const text = (await res.text()).trim();
  if (!text) {
    return res.statusText || "Request failed";
  }

  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Fall back to the raw response body when the server did not return JSON.
  }

  return text;
}

/** A failed request, with its HTTP status (0 when it never reached the server). */
export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Only the server saying "not found" means a page is gone. A request that
 * failed for any other reason (no connection, a server error, a crawler that
 * isn't allowed to fetch it) says nothing about the page, so it must never
 * mark the page as missing or keep search engines away from it.
 */
export function isNotFoundError(error: unknown) {
  return error instanceof HttpError && (error.status === 404 || error.status === 410);
}

/** For a page's main data: try twice more, unless the server said it doesn't exist. */
export function retryUnlessNotFound(failureCount: number, error: unknown) {
  return !isNotFoundError(error) && failureCount < 2;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const message = await getResponseErrorMessage(res);
    throw new HttpError(message, res.status);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 60_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
