// Browser storage that never throws. Some browsers block site data (private
// modes, "block all cookies"), and then even reading window.localStorage
// throws. In that case values are kept in memory for this page instead.
type StorageKind = "local" | "session";

const memory: Record<StorageKind, Map<string, string>> = { local: new Map(), session: new Map() };

function getStorage(kind: StorageKind): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function makeStore(kind: StorageKind) {
  return {
    getItem(key: string): string | null {
      try {
        const storage = getStorage(kind);
        if (storage) return storage.getItem(key);
      } catch {
        // Blocked: fall back to memory.
      }
      return memory[kind].get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memory[kind].set(key, value);
      try {
        getStorage(kind)?.setItem(key, value);
      } catch {
        // Blocked or full: the in-memory copy stands in.
      }
    },
    removeItem(key: string) {
      memory[kind].delete(key);
      try {
        getStorage(kind)?.removeItem(key);
      } catch {
        // Blocked.
      }
    },
    // Whether values survive a reload on this browser.
    isPersistent() {
      try {
        const storage = getStorage(kind);
        if (!storage) return false;
        const probe = "tembea-storage-probe";
        storage.setItem(probe, "1");
        storage.removeItem(probe);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export const safeLocalStorage = makeStore("local");
export const safeSessionStorage = makeStore("session");
