// client/src/pages/admin/zaina.tsx
//
// Agent console for Zaina sessions.
//
// Layout:
//   Left column  → session list (waiting / active / all filters)
//   Right column → conversation + reply box
//
// Polling:
//   - Session list refreshes every 5s.
//   - Conversation refreshes every 3s when a session is open.

import { useEffect, useRef, useState } from "react";

type Session = {
  id: string;
  managedBy: string;
  assignedAgentId: string | null;
  handoffReason: string | null;
  handoffTimestamp: string | null;
  displayCurrency: string;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string | null;
  lastActor?: string | null;
  lastMessageAt?: string | null;
};

type LogRow = {
  id: number;
  sessionId: string;
  timestamp: string;
  actor: string;
  messageContent: string | null;
  toolName: string | null;
};

type Filter = "waiting" | "active" | "all";

export default function AdminZainaPage() {
  const [filter, setFilter] = useState<Filter>("waiting");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [transcript, setTranscript] = useState<LogRow[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // ─── Fetch session list ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchList() {
      try {
        const res = await fetch(`/api/admin/zaina/sessions?filter=${filter}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setSessions(data.sessions ?? []);
      } catch {
        // ignore
      }
    }

    fetchList();
    const interval = setInterval(fetchList, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [filter]);

  // ─── Fetch active session + transcript ──────────────────────────
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    async function fetchActive() {
      try {
        const res = await fetch(`/api/admin/zaina/sessions/${activeId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setSession(data.session ?? null);
          setTranscript(data.transcript ?? []);
        }
      } catch {
        // ignore
      }
    }

    fetchActive();
    const interval = setInterval(fetchActive, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeId]);

  // ─── Autoscroll ─────────────────────────────────────────────────
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  // ─── Actions ────────────────────────────────────────────────────
  async function sendReply() {
    if (!activeId || !reply.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/zaina/sessions/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply }),
      });
      if (res.ok) {
        setReply("");
        // Refresh the transcript immediately so the agent sees their own message
        const r = await fetch(`/api/admin/zaina/sessions/${activeId}`);
        const d = await r.json();
        setSession(d.session ?? null);
        setTranscript(d.transcript ?? []);
      }
    } finally {
      setBusy(false);
    }
  }

  async function closeSession() {
    if (!activeId) return;
    if (!confirm("Close this session? The customer will see it as resolved.")) return;
    await fetch(`/api/admin/zaina/sessions/${activeId}/close`, { method: "POST" });
    setActiveId(null);
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* LEFT: session list */}
      <aside className="flex w-80 flex-col border-r bg-white">
        <div className="border-b p-4">
          <h1 className="text-lg font-semibold">Zaina Sessions</h1>
          <div className="mt-3 flex gap-2 text-xs">
            {(["waiting", "active", "all"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "rounded-full px-3 py-1 capitalize " +
                  (filter === f ? "bg-emerald-700 text-white" : "bg-gray-100 text-gray-700")
                }
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 && (
            <div className="p-4 text-sm text-gray-500">No sessions in this view.</div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={
                "block w-full border-b px-4 py-3 text-left text-sm hover:bg-gray-50 " +
                (activeId === s.id ? "bg-emerald-50" : "")
              }
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-gray-500">
                  {s.id.slice(0, 8)}
                </span>
                <span className="text-[10px] uppercase text-gray-500">
                  {s.managedBy}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-gray-800">
                {s.lastMessage ?? <em className="text-gray-400">(no messages yet)</em>}
              </div>
              <div className="mt-1 text-[10px] text-gray-400">
                {s.lastMessageAt ? new Date(s.lastMessageAt).toLocaleString() : "—"}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* RIGHT: conversation */}
      <main className="flex flex-1 flex-col">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center text-gray-500">
            Select a session to view the conversation.
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b bg-white px-6 py-3">
              <div>
                <div className="font-mono text-xs text-gray-500">{activeId}</div>
                <div className="text-sm text-gray-700">
                  {session?.handoffReason ?? "Handoff"}
                  {session?.assignedAgentId ? " · claimed" : " · unclaimed"}
                </div>
              </div>
              <button
                onClick={closeSession}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Close session
              </button>
            </header>

            <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-6 text-sm">
              {transcript
                .filter((row) => row.messageContent) // skip tool rows in this view
                .map((row) => {
                  const isCustomer = row.actor === "USER";
                  const isAgent = row.actor === "AGENT";
                  const isAI = row.actor === "ZAINA_REASONING";
                  const align = isCustomer ? "justify-start" : "justify-end";
                  const bubble = isCustomer
                    ? "bg-white text-gray-800"
                    : isAgent
                      ? "bg-emerald-700 text-white"
                      : "bg-emerald-100 text-emerald-900";
                  const label = isCustomer
                    ? "Customer"
                    : isAgent
                      ? "Agent (you)"
                      : "Zaina";
                  return (
                    <div key={row.id} className={`flex ${align}`}>
                      <div className="max-w-[70%]">
                        <div className="mb-1 text-[10px] text-gray-500">{label}</div>
                        <div className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 ${bubble}`}>
                          {row.messageContent}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="border-t bg-white p-3">
              <div className="flex items-center gap-2">
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                  placeholder="Reply as the team…"
                  disabled={busy}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <button
                  onClick={sendReply}
                  disabled={busy || !reply.trim()}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
