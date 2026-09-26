// zaina-platform/web/console/pages/setup.tsx
//
// Setting up a business that signed up by itself: the checklist the platform
// reads from what the business has done (each step opens the page where
// it's done), a chat to try Zaina as a customer would, and going live once
// every required step is done.

import { useRef, useState } from "react";
import { api, businessPath } from "../api.ts";
import { go } from "../app.tsx";
import { atLeast, type Role } from "../types.ts";
import { Button, ErrorLine, Icon, Message, useAction, useLoad } from "../ui.tsx";

type Step = { id: string; title: string; detail: string; done: boolean; required: boolean; page: string; tab?: string };
type Onboarding = { status: "onboarding" | "active" | "paused"; went_live_at: string | null; steps: Step[]; done: number; ready: boolean };

export function SetupPage(props: { businessId: string; role: Role; onLive: () => void }) {
  const loaded = useLoad(() => api<Onboarding>("GET", businessPath(props.businessId, "/onboarding")), [props.businessId]);
  const action = useAction();
  const tryRef = useRef<HTMLElement>(null);
  const data = loaded.data;
  if (!data) return <div className="page"><ErrorLine error={loaded.error} /></div>;
  const owner = atLeast(props.role, "owner");
  const left = data.steps.filter((step) => step.required && !step.done);
  const open = (step: Step) => (step.id === "try" ? tryRef.current?.scrollIntoView({ behavior: "smooth" }) : go({ businessId: props.businessId, page: step.page, id: step.tab ?? null }));
  return (
    <div className="page stack">
      <div className="page-head"><h1>{data.status === "active" ? "You're live" : "Set up your business"}</h1></div>
      {data.status === "active" ? (
        <p className="message success">Zaina is answering your customers. Put the chat on your website from Settings → Website widget, and see every conversation in the Inbox.</p>
      ) : data.status === "paused" ? (
        <p className="message error">This business is paused by the Zaina team, so customers aren't answered. Please contact them.</p>
      ) : (
        <p className="muted">Do these steps in any order. Zaina doesn't answer your customers until you go live.</p>
      )}
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={data.steps.length} aria-valuenow={data.done} aria-label="Steps done">
        <span style={{ width: `${Math.round((data.done / data.steps.length) * 100)}%` }} />
      </div>
      <p className="small muted">{data.done} of {data.steps.length} done{left.length ? `; ${left.length} required ${left.length === 1 ? "step" : "steps"} left` : ""}.</p>
      <ol className="steps-list">
        {data.steps.map((step, index) => (
          <li key={step.id} className={`step${step.done ? " done" : ""}`}>
            <span className="step-mark" aria-hidden="true">{step.done ? <Icon name="check" size={16} /> : index + 1}</span>
            <div className="step-body">
              <strong>{step.title}</strong>{step.required ? null : <span className="chip">Recommended</span>}
              <span className="visually-hidden">{step.done ? " (done)" : " (to do)"}</span>
              <p className="small muted">{step.detail}</p>
            </div>
            <Button small kind={step.done ? "ghost" : "secondary"} onClick={() => open(step)}>{step.done ? "Change" : "Start"}</Button>
          </li>
        ))}
      </ol>
      <section ref={tryRef} className="card stack-tight">
        <h2>Try Zaina</h2>
        <p className="small muted">Chat as a customer would. Bookings you make here are real ones in your business: cancel them afterwards. These chats stay out of your reports.</p>
        <TryChat businessId={props.businessId} onFirstMessage={() => void loaded.reload()} />
      </section>
      {data.status === "onboarding" ? (
        <section className="card stack-tight">
          <h2>Go live</h2>
          {data.ready
            ? <p>Everything required is done. Going live lets Zaina answer customers on your website{" "}and WhatsApp.</p>
            : <p className="muted">Finish first: {left.map((step) => step.title).join("; ")}.</p>}
          {owner ? (
            <div className="actions start">
              <Button kind="primary" disabled={!data.ready} busy={action.busy} onClick={() => void action.run(async () => { await api("POST", businessPath(props.businessId, "/go-live")); await loaded.reload(); props.onLive(); }, "You're live.")}>Go live</Button>
            </div>
          ) : <p className="small muted">An owner of the business puts it live.</p>}
          <Message message={action.message} />
        </section>
      ) : null}
    </div>
  );
}

type Line = { from: "you" | "zaina" | "note"; text: string };

/** A test chat with Zaina, through the same service customers use. */
function TryChat(props: { businessId: string; onFirstMessage: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      let session = token;
      if (!session) {
        session = (await api<{ token: string }>("POST", businessPath(props.businessId, "/preview"))).token;
        setToken(session);
      }
      setLines((current) => [...current, { from: "you", text: message }]);
      setText("");
      const response = await fetch("/v1/chat", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session}` }, body: JSON.stringify({ message }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 409) throw new Error(body?.message ?? "Zaina couldn't answer just now.");
      setLines((current) => [...current, body?.reply ? { from: "zaina", text: body.reply } : { from: "note", text: "Your team is answering this chat now (it was handed over)." }]);
      if (lines.length === 0) props.onFirstMessage();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="try-chat">
      <div className="try-lines" aria-live="polite">
        {lines.length ? lines.map((line, index) => <p key={index} className={`bubble ${line.from}`}>{line.text}</p>) : <p className="muted small">Ask what a customer would ask: “Do you have a slot on Saturday?”, “How much is a haircut?”.</p>}
        {busy ? <p className="bubble zaina typing" aria-label="Zaina is typing">…</p> : null}
      </div>
      {problem ? <p className="message error">{problem}</p> : null}
      <form className="try-input" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <input aria-label="Your message" maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a message" />
        <Button kind="primary" type="submit" busy={busy}>Send</Button>
        {token ? <Button kind="ghost" onClick={() => { setToken(null); setLines([]); }}>New chat</Button> : null}
      </form>
    </div>
  );
}
