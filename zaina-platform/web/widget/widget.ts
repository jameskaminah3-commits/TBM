// zaina-platform/web/widget/widget.ts
//
// The website widget: one script tag per business.
//
//   <script src="https://<platform>/widget.js" data-key="pk_…" async></script>
//
// Optional attributes: data-currency="KES" (prices in shillings), and
// data-open="true" (open on load). The page can also call
// window.Zaina.open(), .close() and .setCurrency("USD" | "KES").
//
// Everything lives in a shadow root, so the site's styles and the widget's
// never touch. Messages are shown as text (links made clickable), never as
// HTML. The chat resumes on the next visit (the chat's token is kept in this
// browser for 30 days), and while the team has the chat, their replies appear
// as they come.

type Config = { name: string; assistant_name: string; color: string; position: "right" | "left"; greeting: string | null; currency: "USD" | "KES" };
type Message = { id: number; from: "customer" | "zaina" | "team"; text: string; author?: string };
type Stored = { token: string; sessionId: string };

declare global {
  interface Window {
    Zaina?: { open(): void; close(): void; setCurrency(currency: "USD" | "KES"): void };
    __zainaWidgetLoaded?: boolean;
  }
}

const POLL_WITH_TEAM_MS = 4_000;
const POLL_OPEN_MS = 30_000;

(function start() {
  if (window.__zainaWidgetLoaded) return;
  const script = (document.currentScript as HTMLScriptElement | null)
    ?? document.querySelector<HTMLScriptElement>('script[src*="widget.js"][data-key]');
  const key = script?.dataset.key?.trim();
  if (!script || !key) {
    console.warn("[zaina] The widget script needs data-key=\"<your public key>\".");
    return;
  }
  window.__zainaWidgetLoaded = true;
  const api = new URL(script.src, location.href).origin;
  const storageKey = `zaina:${key}`;

  let config: Config;
  let currency: "USD" | "KES" | null = script.dataset.currency === "KES" || script.dataset.currency === "USD" ? script.dataset.currency : null;
  let stored: Stored | null = readStored();
  let lastId = 0;
  let open = false;
  let sending = false;
  let withTeam = false;
  let loadedHistory = false;
  let pollTimer: number | undefined;
  const shown = new Set<number>();

  function readStored(): Stored | null {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      return value && typeof value.token === "string" && typeof value.sessionId === "string" ? value : null;
    } catch {
      return null;
    }
  }

  function writeStored(value: Stored | null) {
    stored = value;
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch {
      // Private browsing: the chat still works, it just won't resume.
    }
  }

  async function call(path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {};
    if (init.json !== undefined) headers["content-type"] = "application/json";
    if (stored) headers.authorization = `Bearer ${stored.token}`;
    if (currency) headers["x-zaina-currency"] = currency;
    const response = await fetch(`${api}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      credentials: "omit",
    });
    let body: any = null;
    try {
      body = await response.json();
    } catch {}
    return { status: response.status, body };
  }

  // ── Look ──────────────────────────────────────────────────────────────
  function readableOn(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.45 ? "#111827" : "#ffffff";
  }

  const css = (brand: string, side: "right" | "left") => `
:host { all: initial; }
* { box-sizing: border-box; }
.root { --brand: ${brand}; --on-brand: ${readableOn(brand)}; --surface: #ffffff; --text: #111827; --muted: #6b7280; --line: #e5e7eb;
  --bubble: #f3f4f6; --team: #fef3c7; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text);
  position: fixed; ${side}: 20px; bottom: 20px; z-index: 2147483000; }
@media (prefers-color-scheme: dark) {
  .root { --surface: #111827; --text: #f9fafb; --muted: #9ca3af; --line: #374151; --bubble: #1f2937; --team: #3f3212; }
}
.launcher { width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer; background: var(--brand); color: var(--on-brand);
  box-shadow: 0 6px 20px rgba(0,0,0,.25); display: grid; place-items: center; position: relative; }
.launcher:focus-visible, button:focus-visible, textarea:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
.launcher svg { width: 28px; height: 28px; }
.dot { position: absolute; top: 4px; right: 4px; width: 14px; height: 14px; border-radius: 50%; background: #dc2626; border: 2px solid #fff; display: none; }
.dot.on { display: block; }
.panel { position: absolute; bottom: 76px; ${side}: 0; width: 380px; height: min(620px, calc(100vh - 110px)); background: var(--surface);
  border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.28); display: none; flex-direction: column; overflow: hidden; border: 1px solid var(--line); }
.panel.open { display: flex; }
.header { background: var(--brand); color: var(--on-brand); padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
.header .who { flex: 1; min-width: 0; }
.header .name { font-weight: 650; font-size: 16px; }
.header .sub { font-size: 12.5px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.close { background: transparent; border: none; color: inherit; cursor: pointer; width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; }
.close:hover { background: rgba(255,255,255,.15); }
.log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; overscroll-behavior: contain; }
.row { display: flex; flex-direction: column; max-width: 85%; }
.row.customer { align-self: flex-end; align-items: flex-end; }
.label { font-size: 12px; color: var(--muted); margin: 0 4px 2px; }
.bubble { padding: 9px 12px; border-radius: 14px; background: var(--bubble); white-space: pre-wrap; overflow-wrap: anywhere; }
.customer .bubble { background: var(--brand); color: var(--on-brand); border-bottom-right-radius: 4px; }
.zaina .bubble { border-bottom-left-radius: 4px; }
.team .bubble { background: var(--team); border-bottom-left-radius: 4px; }
.bubble a { color: inherit; text-decoration: underline; }
.pending .bubble { opacity: .6; }
.notice { align-self: center; font-size: 13px; color: var(--muted); text-align: center; padding: 2px 8px; }
.notice.error { color: #b91c1c; }
.typing { align-self: flex-start; display: none; gap: 4px; padding: 12px 14px; background: var(--bubble); border-radius: 14px; }
.typing.on { display: flex; }
.typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: .2s; } .typing span:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
.composer { border-top: 1px solid var(--line); padding: 10px; display: flex; gap: 8px; align-items: flex-end; }
textarea { flex: 1; resize: none; border: 1px solid var(--line); border-radius: 12px; padding: 9px 12px; font: inherit; color: var(--text);
  background: var(--surface); max-height: 120px; min-height: 42px; }
.send { background: var(--brand); color: var(--on-brand); border: none; border-radius: 12px; width: 44px; height: 42px; cursor: pointer; display: grid; place-items: center; }
.send:disabled { opacity: .5; cursor: default; }
.footer { text-align: center; font-size: 11px; color: var(--muted); padding: 0 0 8px; }
@media (max-width: 480px) {
  .root { ${side}: 12px; bottom: 12px; }
  .panel.open { position: fixed; inset: 0; width: auto; height: auto; border-radius: 0; border: none; }
  .panel.open + .launcher { display: none; }
}
@media (prefers-reduced-motion: reduce) { .typing span { animation: none; opacity: .6; } }
`;

  const icons = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7-8-1z"/></svg>',
  };

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Text with its web addresses made into links; everything else stays text. */
  function linkified(text: string): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const pattern = /https?:\/\/[^\s<>"')\]]+/g;
    let index = 0;
    for (const match of text.matchAll(pattern)) {
      const url = match[0].replace(/[.,;:!?]+$/, "");
      fragment.append(text.slice(index, match.index));
      const link = element("a", undefined, url);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow";
      fragment.append(link);
      index = (match.index ?? 0) + url.length;
    }
    fragment.append(text.slice(index));
    return fragment;
  }

  // ── Build ─────────────────────────────────────────────────────────────
  let log!: HTMLDivElement;
  let typing!: HTMLDivElement;
  let textarea!: HTMLTextAreaElement;
  let sendButton!: HTMLButtonElement;
  let panel!: HTMLDivElement;
  let launcher!: HTMLButtonElement;
  let dot!: HTMLSpanElement;

  function build(root: ShadowRoot) {
    const sheet = css(config.color, config.position);
    if ("adoptedStyleSheets" in Document.prototype && "replaceSync" in CSSStyleSheet.prototype) {
      const constructed = new CSSStyleSheet();
      constructed.replaceSync(sheet);
      root.adoptedStyleSheets = [constructed];
    } else {
      root.append(element("style", undefined, sheet));
    }
    const container = element("div", "root");
    panel = element("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `Chat with ${config.assistant_name}`);

    const header = element("div", "header");
    const who = element("div", "who");
    who.append(element("div", "name", config.assistant_name), element("div", "sub", config.name));
    const closeButton = element("button", "close");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close chat");
    closeButton.innerHTML = icons.close;
    closeButton.addEventListener("click", () => setOpen(false));
    header.append(who, closeButton);

    log = element("div", "log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    typing = element("div", "typing");
    typing.setAttribute("aria-label", `${config.assistant_name} is typing`);
    typing.append(element("span"), element("span"), element("span"));

    const composer = element("form", "composer");
    textarea = element("textarea");
    textarea.rows = 1;
    textarea.maxLength = 2000;
    textarea.placeholder = "Type your message…";
    textarea.setAttribute("aria-label", "Your message");
    sendButton = element("button", "send");
    sendButton.type = "submit";
    sendButton.setAttribute("aria-label", "Send");
    sendButton.innerHTML = icons.send;
    composer.append(textarea, sendButton);
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      void send();
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void send();
      }
    });
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    });

    const footer = element("div", "footer", "Powered by Zaina");
    panel.append(header, log, composer, footer);
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });

    launcher = element("button", "launcher");
    launcher.type = "button";
    launcher.setAttribute("aria-label", `Chat with ${config.assistant_name}`);
    launcher.setAttribute("aria-expanded", "false");
    launcher.innerHTML = icons.chat;
    dot = element("span", "dot");
    launcher.append(dot);
    launcher.addEventListener("click", () => setOpen(!open));

    container.append(panel, launcher);
    root.append(container);
  }

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  function addRow(from: Message["from"], text: string, options: { author?: string; pending?: boolean } = {}): HTMLDivElement {
    const row = element("div", `row ${from}${options.pending ? " pending" : ""}`);
    if (from === "team") row.append(element("div", "label", `${options.author ?? "Team"} · ${config.name}`));
    const bubble = element("div", "bubble");
    bubble.append(linkified(text));
    row.append(bubble);
    log.insertBefore(row, typing.isConnected ? typing : null);
    scrollDown();
    return row;
  }

  function notice(text: string, error = false) {
    const line = element("div", `notice${error ? " error" : ""}`, text);
    log.insertBefore(line, typing.isConnected ? typing : null);
    scrollDown();
  }

  function greet() {
    if (log.querySelector(".row")) return;
    addRow("zaina", config.greeting ?? `Hi! I'm ${config.assistant_name}, ${config.name}'s assistant. How can I help?`);
  }

  /** Adds messages not shown yet; quiet for history loaded on a new visit (no unread dot). */
  function show(messages: Message[], quiet = false) {
    let fresh = false;
    for (const message of messages) {
      lastId = Math.max(lastId, message.id);
      if (shown.has(message.id)) continue;
      shown.add(message.id);
      addRow(message.from, message.text, { author: message.author });
      if (message.from !== "customer") fresh = true;
    }
    if (fresh && !open && !quiet) dot.classList.add("on");
  }

  async function sync(quiet = false): Promise<boolean> {
    if (!stored) return false;
    const result = await call(`/v1/chat/messages?after=${lastId}`);
    if (result.status === 401 || result.status === 404) {
      writeStored(null);
      return false;
    }
    if (result.status === 200) show(result.body.messages as Message[], quiet);
    const state = await call("/v1/session");
    if (state.status === 200) withTeam = state.body.managed_by === "HUMAN";
    return true;
  }

  function schedulePoll() {
    window.clearTimeout(pollTimer);
    if (!stored) return;
    const every = withTeam ? POLL_WITH_TEAM_MS : open ? POLL_OPEN_MS : 0;
    if (!every) return;
    pollTimer = window.setTimeout(async () => {
      if (document.visibilityState === "visible") await sync().catch(() => {});
      schedulePoll();
    }, every);
  }

  async function openSession(): Promise<boolean> {
    const result = await call("/v1/sessions", { method: "POST", json: { business_key: key, display_currency: currency ?? config.currency } });
    if (result.status !== 201) {
      notice(result.body?.message ?? "The chat isn't available right now. Please try again later.", true);
      return false;
    }
    writeStored({ token: result.body.token, sessionId: result.body.session_id });
    lastId = 0;
    shown.clear();
    return true;
  }

  async function send() {
    const text = textarea.value.trim();
    if (!text || sending) return;
    sending = true;
    sendButton.disabled = true;
    textarea.value = "";
    textarea.style.height = "auto";
    const pending = addRow("customer", text, { pending: true });
    typing.classList.add("on");
    log.append(typing);
    scrollDown();
    try {
      if (!stored && !(await openSession())) throw new Error("no session");
      let result = await call("/v1/chat", { method: "POST", json: { message: text } });
      if (result.status === 401) {
        // The chat expired: start a new one and send again.
        writeStored(null);
        if (!(await openSession())) throw new Error("no session");
        result = await call("/v1/chat", { method: "POST", json: { message: text } });
      }
      if (result.status === 200 || result.status === 409) {
        pending.remove();
        const synced = await sync().catch(() => false);
        if (!synced || result.status === 409) {
          if (result.body?.reply) addRow("zaina", result.body.reply);
        }
        if (result.body?.status === "human_managed" || result.body?.escalated) withTeam = true;
      } else {
        pending.classList.remove("pending");
        notice(result.body?.message ?? "Sorry, that didn't go through. Please try again.", true);
      }
    } catch {
      pending.classList.remove("pending");
      notice("Couldn't reach the chat. Check your connection and try again.", true);
    } finally {
      typing.classList.remove("on");
      sending = false;
      sendButton.disabled = false;
      schedulePoll();
      if (open) textarea.focus();
    }
  }

  async function setOpen(value: boolean) {
    open = value;
    panel.classList.toggle("open", value);
    launcher.setAttribute("aria-expanded", String(value));
    if (value) {
      dot.classList.remove("on");
      if (!loadedHistory) {
        loadedHistory = true;
        await sync().catch(() => {});
        greet();
      }
      textarea.focus();
    } else {
      launcher.focus();
    }
    schedulePoll();
  }

  async function boot() {
    let result: { status: number; body: any };
    try {
      const response = await fetch(`${api}/v1/widget/config?key=${encodeURIComponent(key!)}`, { credentials: "omit" });
      result = { status: response.status, body: await response.json().catch(() => null) };
    } catch {
      console.warn("[zaina] The chat couldn't load.");
      return;
    }
    if (result.status !== 200) {
      console.warn(`[zaina] The chat isn't available on this website (${result.body?.error ?? result.status}).`);
      return;
    }
    config = result.body as Config;
    const host = document.createElement("div");
    host.id = "zaina-widget";
    document.body.append(host);
    build(host.attachShadow({ mode: "open" }));
    window.Zaina = {
      open: () => void setOpen(true),
      close: () => void setOpen(false),
      setCurrency: (value) => {
        if (value === "USD" || value === "KES") currency = value;
      },
    };
    if (stored) {
      // A chat from an earlier visit: pick up where it left off.
      await sync(true).catch(() => {});
      schedulePoll();
    }
    if (script!.dataset.open === "true") void setOpen(true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  else void boot();
})();

export {};
