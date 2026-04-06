const PENDING_BOOKING_STORAGE_KEY = "tembea-pending-booking";

export type PendingBookingDraft = {
  kind: "stay" | "service";
  path: string;
  payload: Record<string, unknown>;
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

export function savePendingBookingDraft(draft: PendingBookingDraft) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PENDING_BOOKING_STORAGE_KEY, JSON.stringify(draft));
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
