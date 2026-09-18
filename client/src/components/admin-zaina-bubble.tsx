// client/src/components/admin-zaina-bubble.tsx
//
// Floating bubble shown on all admin pages.
// Polls /api/admin/zaina/pending-count every 15 seconds.
// When the count rises: chime + browser notification + badge bump.
// Clicking opens a compact panel with a link to the full agent console.

import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

const POLL_INTERVAL_MS = 15000;
const SOUND_UNLOCK_KEY = "zaina_sound_unlocked";

// Two-tone chime synthesized via Web Audio — no asset file required.
function playChime() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    const playTone = (freq: number, startAt: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + duration);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + duration);
    };

    playTone(880, 0, 0.18);
    playTone(1320, 0.12, 0.24);

    setTimeout(() => ctx.close(), 800);
  } catch (err) {
    console.warn("[zaina-bubble] chime failed:", err);
  }
}

export function AdminZainaBubble() {
  const [pending, setPending] = useState<number>(0);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const lastCountRef = useRef<number>(-1);

  // ─── Poll for pending count ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch("/api/admin/zaina/pending-count");
        if (!res.ok) return;
        const data = await res.json();
        const count = Number(data.pending ?? 0);
        if (cancelled) return;

        // Detect rise
        if (lastCountRef.current >= 0 && count > lastCountRef.current) {
          playChime();

          // Browser notification (desktop; and Android WebView when permitted)
          try {
            if (
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              new Notification("Zaina — customer waiting", {
                body: `You have ${count} session${count === 1 ? "" : "s"} awaiting response.`,
                icon: "/favicon.ico",
                tag: "zaina-handoff",
              });
            }
          } catch {
            // Some Android WebViews block the constructor — ignore
          }
        }

        lastCountRef.current = count;
        setPending(count);
        setVisible(true);
      } catch {
        // ignore transient network issues
      }
    }

    // Check first immediately, then on interval
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // ─── Unlock audio + request notification permission on first click ─
  useEffect(() => {
    function unlock() {
      try {
        sessionStorage.setItem(SOUND_UNLOCK_KEY, "1");
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "default"
        ) {
          Notification.requestPermission().catch(() => undefined);
        }
      } catch {
        // ignore
      }
      window.removeEventListener("click", unlock);
    }

    window.addEventListener("click", unlock, { once: true });
    return () => window.removeEventListener("click", unlock);
  }, []);

  if (!visible) return null;

  const hasPending = pending > 0;

  return (
    <>
      {/* Floating bubble — bottom-right, above nothing else on admin pages */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={hasPending ? `${pending} pending Zaina sessions` : "Zaina sessions"}
        className={
          "fixed bottom-6 right-6 z-[9990] flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-transform hover:scale-105 " +
          (hasPending ? "bg-amber-500" : "bg-emerald-700")
        }
      >
        <span className="text-2xl">
          {open ? "✕" : "💬"}
        </span>
        {hasPending && !open && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
            {pending > 99 ? "99+" : pending}
          </span>
        )}
      </button>

      {/* Compact panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-[9989] w-80 overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="bg-emerald-700 px-4 py-3 text-white">
            <div className="text-sm font-semibold">Zaina Sessions</div>
            <div className="text-xs opacity-90">
              {hasPending
                ? `${pending} session${pending === 1 ? "" : "s"} awaiting reply`
                : "No customers waiting"}
            </div>
          </div>

          <div className="p-4 text-sm text-gray-700">
            {hasPending ? (
              <>
                <p className="mb-3">
                  Someone is waiting to hear back. Open the agent console to
                  respond.
                </p>
                <Link href="/admin/zaina">
                  <a
                    onClick={() => setOpen(false)}
                    className="block w-full rounded-lg bg-emerald-700 px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-emerald-800"
                  >
                    Open agent console →
                  </a>
                </Link>
              </>
            ) : (
              <p className="text-gray-500">
                Zaina is handling all conversations. You'll get a ping here
                when someone needs a human.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
