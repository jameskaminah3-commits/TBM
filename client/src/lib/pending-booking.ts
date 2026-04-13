const PENDING_BOOKING_STORAGE_KEY = "tembea-pending-booking";

export type PendingBookingDraft = {
  kind: "stay" | "service";
  path: string;
  payload: Record<string, unknown>;
  updatedAt?: number;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getCurrentBookingPath() {
  if (typeof window === "undefined") {
    return "/";
  }

  return `${window.location.pathname}${window.location.search}`;
}

function normalizeBookingPath(path: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "/";
  }

  const [pathnamePart, searchPart = ""] = trimmedPath.split("?");
  const normalizedPathname = pathnamePart || "/";
  const params = new URLSearchParams(searchPart);
  const sortedParams = new URLSearchParams();

  Array.from(params.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }

      return leftKey.localeCompare(rightKey);
    })
    .forEach(([key, value]) => {
      sortedParams.append(key, value);
    });

  const normalizedSearch = sortedParams.toString();
  return `${normalizedPathname}${normalizedSearch ? `?${normalizedSearch}` : ""}`;
}

export function isPendingBookingPathMatch(savedPath: string, currentPath: string) {
  return normalizeBookingPath(savedPath) === normalizeBookingPath(currentPath);
}

export function savePendingBookingDraft(draft: PendingBookingDraft) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PENDING_BOOKING_STORAGE_KEY, JSON.stringify({
    ...draft,
    updatedAt: Date.now(),
  }));
}

export function loadPendingBookingDraft(): PendingBookingDraft | null {
  if (!canUseStorage()) return null;

  const raw = window.localStorage.getItem(PENDING_BOOKING_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PendingBookingDraft;
  } catch {
    window.localStorage.removeItem(PENDING_BOOKING_STORAGE_KEY);
    return null;
  }
}

export function clearPendingBookingDraft() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(PENDING_BOOKING_STORAGE_KEY);
}
