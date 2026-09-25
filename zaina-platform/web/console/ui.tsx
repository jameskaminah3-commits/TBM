// zaina-platform/web/console/ui.tsx — the console's small building blocks.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "./api.ts";

// ── Data loading ────────────────────────────────────────────────────────

export type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void> };

/** Loads data when its inputs change; keeps the last data while reloading (no flashing). */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(load);
  latest.current = load;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await latest.current());
      setError(null);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setData(null);
    void reload();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload };
}

/** Calls fn every `ms` while the page is visible. */
export function useEvery(fn: () => void, ms: number, deps: unknown[]) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") latest.current();
    }, ms);
    return () => window.clearInterval(timer);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Runs an action with a busy flag and a message for the person. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success) setMessage({ kind: "success", text: success });
      return true;
    } catch (problem) {
      setMessage({ kind: "error", text: problem instanceof ApiError ? problem.message : "Something went wrong." });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, message, setMessage, run };
}

// ── Pieces ──────────────────────────────────────────────────────────────

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "danger" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  small?: boolean;
}) {
  return (
    <button
      type={props.type ?? "button"}
      className={`button ${props.kind ?? "secondary"}${props.small ? " small" : ""}`}
      onClick={props.onClick}
      disabled={props.disabled || props.busy}
      title={props.title}
      aria-busy={props.busy || undefined}
    >
      {props.busy ? <span className="spinner" aria-hidden="true" /> : null}
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${props.wide ? " wide" : ""}`}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint ? <span className="field-hint">{props.hint}</span> : null}
    </label>
  );
}

export function Message(props: { message: { kind: "error" | "success"; text: string } | null }) {
  if (!props.message) return null;
  return (
    <p className={`message ${props.message.kind}`} role={props.message.kind === "error" ? "alert" : "status"}>
      {props.message.text}
    </p>
  );
}

export function ErrorLine(props: { error: string | null }) {
  return props.error ? <p className="message error" role="alert">{props.error}</p> : null;
}

export function Empty(props: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{props.title}</p>
      {props.children ? <div className="empty-body">{props.children}</div> : null}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
      <span>{props.label}</span>
    </label>
  );
}

export function Tabs<T extends string>(props: { tabs: Array<{ id: T; label: string; count?: number }>; active: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={props.label}>
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === props.active}
          className={`tab${tab.id === props.active ? " active" : ""}`}
          onClick={() => props.onChange(tab.id)}
        >
          {tab.label}
          {tab.count ? <span className="count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={props.title} ref={dialog}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={props.onClose}><Icon name="close" /></button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

// ── Icons (inline, so the console loads nothing from elsewhere) ─────────

const PATHS: Record<string, string> = {
  inbox: "M4 13h4l2 3h4l2-3h4M4 13l2.5-7h11L20 13v6H4z",
  book: "M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM5 16a4 4 0 0 1 4-4h9",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
  whatsapp: "M3 21l1.7-5A9 9 0 1 1 8 19.3zM9 8.5c0 3 2.5 6.5 6.5 6.5l1-1.5-2-1-1 .8c-1-.4-2.4-1.8-2.8-2.8l.8-1-1-2z",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  close: "M6 6l12 12M18 6L6 18",
  back: "M15 18l-6-6 6-6",
  send: "M4 12l16-8-6 16-2-7z",
  photo: "M4 5h16v14H4zM4 15l4-4 5 5M14 13l2-2 4 4M15 8.5a1 1 0 1 0 0 .01",
  check: "M5 12l5 5L20 7",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  user: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
};

export function Icon(props: { name: keyof typeof PATHS | string; size?: number; label?: string }) {
  const size = props.size ?? 18;
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props.label ? undefined : true}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
    >
      <path d={PATHS[props.name] ?? ""} />
    </svg>
  );
}
