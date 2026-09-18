// client/src/components/ZainaWidget.tsx
//
// Zaina — TBM's concierge widget.
//
// Chip strategy:
//   • 2 pinned chips — the TBM signatures (verification, MamaCare).
//   • 2 rotating chips — drawn from a larger pool each session.
//   • Total 4 visible → fits desktop and mobile cleanly.
//
// Session lifecycle:
//   • Session ID + messages persist in localStorage.
//   • 24-hour TTL — beyond that, a fresh session begins.
//   • On mount, the cached session is verified against the server; if it
//     no longer exists, the local cache is discarded and we start fresh.
//
// Currency:
//   • x-zaina-currency travels with every chat message, so the session
//     stays in sync if the customer toggles USD/KES mid-chat.

import { useEffect, useRef, useState } from "react";
import { ZainaAvatar } from "./ZainaAvatar";
import { WHATSAPP_URL } from "@/lib/contact-info";

type Msg = { role: "user" | "assistant"; content: string };
type Chip = { emoji: string; label: string };

// ─── Storage keys ─────────────────────────────────────────────────────
const SESSION_KEY = "zaina_session_id";
const SESSION_CREATED_KEY = "zaina_session_created_at";
const SESSION_MSGS_KEY = "zaina_session_msgs";
const TOOLTIP_SEEN_KEY = "zaina_tooltip_seen";
// Bump the _vN suffix whenever PINNED_CHIPS or CHIP_POOL changes materially.
const CHIP_SELECTION_KEY = "zaina_chip_selection_v2";

// Conversations older than this are abandoned and a fresh session begins.
// Sessions expire after 8 hours of inactivity. This is a sliding window —
// every message refreshes the clock. A customer planning a trip across
// one day keeps their conversation; a customer who comes back tomorrow
// gets a fresh greeting.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_RESTORED_MESSAGES = 40;

// ─── Copy ─────────────────────────────────────────────────────────────
const GREETING =
  "Jambo 👋🏽 Karibu! I'm Zaina, your Tembea Bila Matata concierge. What are we planning — a stay, a getaway, transport, or a little bit of everything?";

// Always shown. These two define TBM.
const PINNED_CHIPS: Chip[] = [
  { emoji: "🛡️", label: "Verify a listing I found" },
  { emoji: "👶", label: "Childcare & family care" },
];

// Rotating pool. Two are picked per session.
const CHIP_POOL: Chip[] = [
  { emoji: "🌴", label: "Plan my Coast getaway" },
  { emoji: "🏡", label: "Find me a stay" },
  { emoji: "🍽️", label: "Book a private chef" },
  { emoji: "🚗", label: "Arrange transport" },
  { emoji: "💰", label: "I have KSh 50K — what can we do?" },
  { emoji: "📅", label: "Coming by SGR — need pickup" },
  { emoji: "🌊", label: "What's there to do in Diani?" },
  { emoji: "🎉", label: "Something special — surprise me" },
];

const PLACEHOLDER = "Or just tell me what you have in mind…";
const TOOLTIP_COPY = "Need a hand planning your Coast trip?";
const HANDOFF_COPY =
  "I've brought in someone from the team to help with this one — they'll take it from here and get back to you shortly. 😊 If you need a quicker response, you can also reach us on WhatsApp.";

// ─── Chip selection ───────────────────────────────────────────────────
//
// Pinned chips always show. Two more are drawn from the pool. The
// selection is stored in sessionStorage so re-opening the panel doesn't
// reshuffle mid-visit.

function selectChips(): Chip[] {
  const cached = sessionStorage.getItem(CHIP_SELECTION_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as Chip[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through and reselect
    }
  }

  const shuffled = [...CHIP_POOL].sort(() => Math.random() - 0.5);
  const selection = [...PINNED_CHIPS, ...shuffled.slice(0, 2)];

  try {
    sessionStorage.setItem(CHIP_SELECTION_KEY, JSON.stringify(selection));
  } catch {
    // sessionStorage may be unavailable in some private-browsing modes
  }

  return selection;
}
function buildWhatsAppHandoffUrl(msgs: Msg[]): string {
  const userMessages = msgs
    .filter((m) => m.role === "user")
    .slice(-4)
    .map((m) => `• ${m.content}`)
    .join("\n");

  const summary = [
    "Hi, I was chatting with Zaina on tembeabilamatata.com and would like to continue here.",
    "",
    "What we discussed:",
    userMessages || "• (no previous messages)",
  ].join("\n");

  const separator = WHATSAPP_URL.includes("?") ? "&" : "?";
  return `${WHATSAPP_URL}${separator}text=${encodeURIComponent(summary)}`;
}

type WidgetState = "loading" | "ready" | "disabled" | "handed_off";
type AvatarState = "idle" | "thinking" | "speaking";

export function ZainaWidget() {
  const [widgetState, setWidgetState] = useState<WidgetState>("loading");
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      const raw = localStorage.getItem(SESSION_MSGS_KEY);
      const createdRaw = localStorage.getItem(SESSION_CREATED_KEY);
      if (!raw || !createdRaw) return [{ role: "assistant", content: GREETING }];

      const createdAt = Number(createdRaw);
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > SESSION_TTL_MS) {
        return [{ role: "assistant", content: GREETING }];
      }

      const parsed = JSON.parse(raw) as Msg[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return [{ role: "assistant", content: GREETING }];
      }
      return parsed.slice(-MAX_RESTORED_MESSAGES);
    } catch {
      return [{ role: "assistant", content: GREETING }];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [speakingPulse, setSpeakingPulse] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const [hasUserMessaged, setHasUserMessaged] = useState(false);
  const [chips, setChips] = useState<Chip[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Feature flag ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/zaina/health");
        if (!res.ok) {
          if (!cancelled) setWidgetState("disabled");
          return;
        }
        const data = await res.json();
        if (!cancelled) setWidgetState(data.enabled ? "ready" : "disabled");
      } catch {
        if (!cancelled) setWidgetState("disabled");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Chip selection on first ready ────────────────────────────
  useEffect(() => {
    if (widgetState === "ready") {
      setChips(selectChips());
    }
  }, [widgetState]);

  // ─── Floating tooltip: once per session, 5s delay ────────────
  useEffect(() => {
    if (widgetState !== "ready") return;
    if (sessionStorage.getItem(TOOLTIP_SEEN_KEY)) return;

    const showTimer = setTimeout(() => {
      setShowTooltip(true);
      sessionStorage.setItem(TOOLTIP_SEEN_KEY, "1");
    }, 5000);

    const hideTimer = setTimeout(() => setShowTooltip(false), 15000);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [widgetState]);

  // ─── Autoscroll ───────────────────────────────────────────────
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open]);

   // ─── Persist conversation to localStorage ─────────────────────
  // Trimmed to the last N messages so we don't grow unbounded.
  // Also refreshes the activity timestamp — this makes the TTL a
  // sliding window (8h since last message) rather than a fixed
  // window from session creation.
  useEffect(() => {
    try {
      const trimmed = msgs.slice(-MAX_RESTORED_MESSAGES);
      localStorage.setItem(SESSION_MSGS_KEY, JSON.stringify(trimmed));
      if (msgs.length > 1) {
        localStorage.setItem(SESSION_CREATED_KEY, String(Date.now()));
      }
    } catch {
      // localStorage can be unavailable in some private-browsing modes
    }
  }, [msgs]);

  // ─── Focus input on open ─────────────────────────────────────
  useEffect(() => {
    if (open && widgetState === "ready") {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open, widgetState]);
  // ─── Poll for agent messages when session is handed off ──────
  useEffect(() => {
    if (widgetState !== "handed_off" || !open) return;

    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) return;

    let cancelled = false;

    async function fetchNewMessages() {
      try {
        const res = await fetch(`/api/admin/zaina/sessions/${sessionId}`);
        // This is an admin endpoint — the widget can't call it.
        // Instead we use the public /messages endpoint below.
      } catch {
        // ignore
      }
    }

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/zaina/session/${sessionId}/messages`);
        if (res.ok) {
          const data = await res.json();
          const incoming: Msg[] = (data.messages ?? [])
            .filter((m: any) => m.actor === "AGENT")
            .map((m: any) => ({ role: "assistant" as const, content: m.messageContent }));

          if (incoming.length > 0) {
            setMsgs((current) => {
              // Only append agent messages we don't already have
              const existing = new Set(current.map((m) => m.content));
              const toAdd = incoming.filter((m) => !existing.has(m.content));
              if (toAdd.length === 0) return current;
              setSpeakingPulse((n) => n + 1);
              return [...current, ...toAdd];
            });
          }
        }
      } catch {
        // transient network issue — next tick will retry
      }
    }

    const interval = setInterval(tick, 4000);
    tick(); // fire immediately

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [widgetState, open]);

  // ─── Avatar state driver ─────────────────────────────────────
  // ─── Avatar state driver ─────────────────────────────────────
  useEffect(() => {
    if (busy) {
      setAvatarState("thinking");
    } else if (speakingPulse > 0) {
      setAvatarState("speaking");
      const t = setTimeout(() => setAvatarState("idle"), 900);
      return () => clearTimeout(t);
    } else {
      setAvatarState("idle");
    }
  }, [busy, speakingPulse]);

  // ─── Session ─────────────────────────────────────────────────
  function currentCurrency(): "USD" | "KES" {
    const v =
      localStorage.getItem("currency") ??
      localStorage.getItem("display_currency") ??
      "USD";
    return v.toUpperCase() === "KES" ? "KES" : "USD";
  }

  function clearLocalSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_CREATED_KEY);
      localStorage.removeItem(SESSION_MSGS_KEY);
    } catch {
      // ignore
    }
  }

  async function getSession(): Promise<string | null> {
    const cached = localStorage.getItem(SESSION_KEY);
    const createdRaw = localStorage.getItem(SESSION_CREATED_KEY);

    if (cached && createdRaw) {
      const createdAt = Number(createdRaw);
      const isExpired =
        !Number.isFinite(createdAt) || Date.now() - createdAt > SESSION_TTL_MS;

      if (!isExpired) {
        // Verify the session still exists on the server. If the customer
        // was handed off to a human and the session was deleted, or the
        // row is gone for any reason, drop the cached id.
        try {
          const check = await fetch(`/api/zaina/session/${cached}`);
          if (check.ok) return cached;
        } catch {
          // network issue — keep using cached id and let the next chat
          // request handle it. Avoids forcing a new session on flaky wifi.
          return cached;
        }
        // Session not found server-side → fall through and create new.
        clearLocalSession();
        setMsgs([{ role: "assistant", content: GREETING }]);
      } else {
        // Expired locally — start clean.
        clearLocalSession();
        setMsgs([{ role: "assistant", content: GREETING }]);
      }
    }

    try {
      const res = await fetch("/api/zaina/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_currency: currentCurrency() }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.sessionId) return null;
      localStorage.setItem(SESSION_KEY, data.sessionId);
      localStorage.setItem(SESSION_CREATED_KEY, String(Date.now()));
      return data.sessionId;
    } catch {
      return null;
    }
  }

  // ─── Send ────────────────────────────────────────────────────
  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || widgetState !== "ready") return;

    setHasUserMessaged(true);
    setShowTooltip(false);
    setBusy(true);
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: trimmed }]);

    try {
      const sessionId = await getSession();
      if (!sessionId) {
        setMsgs((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "I'm having trouble starting a session. Please try again, or reach us on WhatsApp.",
          },
        ]);
        setBusy(false);
        return;
      }

      const res = await fetch("/api/zaina/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-zaina-session": sessionId,
          // Currency travels with every message so the session stays in
          // sync if the customer toggles USD/KES on the site mid-chat.
          "x-zaina-currency": currentCurrency(),
        },
        body: JSON.stringify({ message: trimmed }),
      });

      if (res.status === 429) {
        setMsgs((m) => [
          ...m,
          {
            role: "assistant",
            content: "You're sending messages a bit too quickly — give me a moment to catch up.",
          },
        ]);
        setBusy(false);
        return;
      }

      const data = await res.json();

      // Session is already in human mode (subsequent messages after handoff).
      if (data.status === "human_managed") {
        // Session is in HUMAN mode. The user's message was already logged
        // by the backend (router.ts logs it before the state gate), so the
        // agent will see it. Don't add another handoff message — that
        // would be noisy every time the customer sends something.
        setWidgetState("handed_off");
        setBusy(false);
        return;
      }

      const reply =
        data.reply ??
        data.message ??
        "Sorry, I hit a snag. Please try again or reach us on WhatsApp.";

      setMsgs((m) => [...m, { role: "assistant", content: reply }]);
      setSpeakingPulse((n) => n + 1);

      // Zaina just escalated during this turn — lock the widget into
      // handed-off mode right away so the customer sees the WhatsApp
      // handoff option without needing to send another message.
      if (data.escalated) {
        setWidgetState("handed_off");
      }
    } catch {
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: "Connection issue. Please try again in a moment." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function handleSend() {
    sendMessage(input);
  }

  function handleSuggestion(label: string) {
    sendMessage(label);
  }

  if (widgetState === "loading" || widgetState === "disabled") {
    return null;
  }

  const unreadReplies = msgs.length > 1 && !open && !busy;
  const buttonAvatarState: AvatarState = busy ? "thinking" : unreadReplies ? "speaking" : "idle";

  return (
    <>
      <style>{`
        @keyframes zaina-breathe {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-1.5px) scale(1.015); }
        }
        @keyframes zaina-tilt {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes zaina-bounce {
          0% { transform: scale(1) translateY(0); }
          30% { transform: scale(1.12) translateY(-3px); }
          60% { transform: scale(0.97) translateY(0); }
          100% { transform: scale(1) translateY(0); }
        }
        @keyframes zaina-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
        @keyframes zaina-sparkle-spin {
          0% { transform: rotate(0deg); opacity: 0.4; }
          50% { opacity: 1; }
          100% { transform: rotate(360deg); opacity: 0.4; }
        }
        @keyframes zaina-panel-in {
          0% { opacity: 0; transform: translateY(12px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes zaina-msg-in {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes zaina-tooltip-in {
          0% { opacity: 0; transform: translateY(6px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes zaina-chip-in {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes zaina-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }

        .zaina-avatar { transform-origin: 50% 80%; }
        .zaina-avatar-idle { animation: zaina-breathe 4s ease-in-out infinite; }
        .zaina-avatar-thinking { animation: zaina-tilt 1.6s ease-in-out infinite; }
        .zaina-avatar-speaking { animation: zaina-bounce 0.7s ease-out; }
        .zaina-avatar .zaina-eye {
          transform-origin: center;
          animation: zaina-blink 5s ease-in-out infinite;
        }
        .zaina-sparkle {
          transform-origin: 82px 22px;
          animation: zaina-sparkle-spin 1.8s linear infinite;
        }
        .zaina-panel-enter { animation: zaina-panel-in 0.28s cubic-bezier(0.34, 1.4, 0.64, 1); }
        .zaina-msg-enter { animation: zaina-msg-in 0.22s ease-out; }
        .zaina-tooltip-enter { animation: zaina-tooltip-in 0.25s cubic-bezier(0.34, 1.4, 0.64, 1); }
        .zaina-chip-enter { animation: zaina-chip-in 0.22s ease-out backwards; }
        .zaina-unread-dot { animation: zaina-dot-pulse 1.8s ease-in-out infinite; }
      `}</style>

      {/* Floating tooltip — once per session */}
      {showTooltip && !open && (
 <div
          className="zaina-tooltip-enter fixed bottom-60 right-4 sm:bottom-44 sm:right-6 z-[9999] max-w-[240px]
                     rounded-2xl rounded-br-sm bg-white px-4 py-3 text-sm text-gray-800 shadow-xl"
        >
          {TOOLTIP_COPY}
          <button
            onClick={() => setShowTooltip(false)}
            aria-label="Dismiss"
            className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs text-gray-600 hover:bg-gray-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* Floating toggle button */}
      <button
        onClick={() => {
          setOpen((v) => !v);
          setShowTooltip(false);
        }}
        aria-label={open ? "Close Zaina" : "Open Zaina"}
        className="fixed bottom-40 right-4 sm:bottom-24 sm:right-6 z-[9999] flex h-16 w-16 items-center justify-center rounded-full bg-emerald-700 shadow-xl transition-transform hover:scale-105"
      >
        {open ? (
          <span className="text-2xl font-light text-white">✕</span>
        ) : (
          <ZainaAvatar size={56} state={buttonAvatarState} />
        )}
        {!open && unreadReplies && (
          <span className="zaina-unread-dot absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-amber-500" />
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="zaina-panel-enter fixed z-[9998] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl
                     bottom-[10.5rem] right-6 h-[580px] w-[380px] max-w-[calc(100vw-2rem)]
                     max-sm:bottom-0 max-sm:right-0 max-sm:left-0 max-sm:h-[88vh] max-sm:w-full max-sm:rounded-t-2xl max-sm:rounded-b-none"
        >
          {/* Header with avatar breaking the baseline */}
          <div className="relative bg-emerald-700 px-4 pb-5 pt-4 text-white">
            <div className="flex items-start gap-3">
              <div className="-mb-7 flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-600 ring-4 ring-emerald-700">
                <ZainaAvatar size={56} state={avatarState} />
              </div>
              <div className="flex-1 leading-tight pt-1">
                <div className="text-lg font-semibold">Zaina</div>
                <div className="flex items-center gap-1.5 text-xs opacity-90">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  {busy ? "Checking what's available…" : "Your Coast concierge · Ready to help"}
                </div>
              </div>
              <button
                onClick={() => {
                  clearLocalSession();
                  try {
                    sessionStorage.removeItem(CHIP_SELECTION_KEY);
                  } catch {
                    // ignore
                  }
                  setMsgs([{ role: "assistant", content: GREETING }]);
                  setHasUserMessaged(false);
                  setWidgetState("ready");
                  setChips(selectChips());
                }}
                aria-label="Start a new chat"
                title="Start a new chat"
                className="rounded p-1 text-lg leading-none opacity-70 hover:bg-emerald-800 hover:opacity-100"
              >
                ↻
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="rounded p-1 text-xl leading-none opacity-80 hover:bg-emerald-800 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Message log */}
          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4 pt-6 text-sm">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={"zaina-msg-enter " + (m.role === "user" ? "text-right" : "text-left")}
              >
                <span
                  className={
                    "inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 " +
                    (m.role === "user"
                      ? "rounded-br-sm bg-emerald-700 text-white"
                      : "rounded-bl-sm bg-white text-gray-800 shadow-sm")
                  }
                >
                  {m.content}
                </span>
              </div>
            ))}

            {/* Suggested conversation starters */}
            {!hasUserMessaged && msgs.length === 1 && chips.length > 0 && (
              <div className="pt-3">
                <div className="mb-2 pl-1 text-xs text-gray-500">
                  Planning something?
                </div>
                <div className="flex flex-wrap gap-2">
                  {chips.map((chip, i) => (
                    <button
                      key={chip.label}
                      onClick={() => handleSuggestion(chip.label)}
                      disabled={busy}
                      className="zaina-chip-enter inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:border-emerald-400 hover:bg-emerald-50 disabled:opacity-50"
                      style={{ animationDelay: `${i * 40}ms` }}
                    >
                      <span>{chip.emoji}</span>
                      <span>{chip.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {busy && (
              <div className="text-left pt-2">
                <span className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-xs text-gray-500 shadow-sm">
                  <span className="inline-flex items-center gap-0.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                      style={{ animation: "zaina-dot-pulse 1s ease-in-out infinite" }}
                    />
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                      style={{ animation: "zaina-dot-pulse 1s ease-in-out 0.15s infinite" }}
                    />
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                      style={{ animation: "zaina-dot-pulse 1s ease-in-out 0.3s infinite" }}
                    />
                  </span>
                  Zaina is checking…
                </span>
              </div>
            )}
          </div>

          {/* Input or handed-off notice */}
          {widgetState === "handed_off" ? (
            <div className="border-t border-gray-200 bg-white">
              <div className="flex items-center gap-2 px-4 pt-2 text-[11px] text-emerald-700">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Team member is replying here
              </div>
              <div className="flex items-center gap-2 p-3 pt-1">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Reply to the team…"
                  disabled={busy}
                  className="flex-1 border-none px-2 py-2 text-sm outline-none disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={busy || !input.trim()}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
              <div className="border-t border-gray-100 px-4 py-2">
                <a
                  href={buildWhatsAppHandoffUrl(msgs)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-emerald-700 underline hover:text-emerald-800"
                >
                  Prefer WhatsApp? Continue there →
                </a>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-t border-gray-200 bg-white p-3">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={PLACEHOLDER}
                disabled={busy}
                className="flex-1 border-none px-2 py-2 text-sm outline-none disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={busy || !input.trim()}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
