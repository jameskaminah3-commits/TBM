// zaina-platform/web/console/pages/setup.tsx
//
// Setting up a business that signed up by itself: a start from its website
// (Zaina reads it into knowledge, and the site's own description can become
// the business's), the checklist the platform reads from what the business
// has done (each step opens the page where it's done), a chat to try Zaina as
// a customer would, and going live once every required step is done.

import { useRef, useState } from "react";
import { api, businessPath } from "../api.ts";
import { go } from "../app.tsx";
import { atLeast, type Role } from "../types.ts";
import { Button, ErrorLine, Field, Icon, Message, useAction, useLoad } from "../ui.tsx";

type Step = { id: string; title: string; detail: string; done: boolean; required: boolean; page: string; tab?: string };
type WebsiteRead = { site: string; pages: Array<{ url: string; source: { title: string } }>; skipped: Array<{ url: string; reason: string }>; description: string | null };
type Onboarding = { status: "onboarding" | "active" | "paused"; pause_reason: "platform" | "billing" | null; went_live_at: string | null; steps: Step[]; done: number; ready: boolean };

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
        <p className="message error">
          {data.pause_reason === "billing"
            ? "Zaina is paused for an unpaid invoice, so customers aren't answered. Pay it in Settings → Plan & billing and Zaina answers again straight away."
            : "This business is paused by the Zaina team, so customers aren't answered. Please contact them."}
        </p>
      ) : (
        <p className="muted">Do these steps in any order. Zaina doesn't answer your customers until you go live.</p>
      )}
      {data.status === "onboarding" && atLeast(props.role, "manager") ? <StartFromWebsite businessId={props.businessId} onChanged={() => void loaded.reload()} /> : null}
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

/**
 * The quickest start: Zaina reads the business's website (its rooms, menu,
 * services, FAQs, policies) into knowledge, and the site's own description
 * can become what Zaina says about the business.
 */
function StartFromWebsite(props: { businessId: string; onChanged: () => void }) {
  const settings = useLoad(() => api<{ settings: { websiteUrl: string | null; about: string } }>("GET", businessPath(props.businessId, "/settings")), [props.businessId]);
  const [address, setAddress] = useState<string | null>(null);
  const [result, setResult] = useState<WebsiteRead | null>(null);
  const [aboutSaved, setAboutSaved] = useState(false);
  const action = useAction();
  const value = address ?? settings.data?.settings.websiteUrl ?? "";
  const about = settings.data?.settings.about?.trim() ?? "";
  const suggestion = result?.description && result.description.length >= 40 && about.length < 40 && !aboutSaved ? result.description : null;
  return (
    <section className="card stack-tight">
      <h2>Start from your website</h2>
      <p className="muted">Zaina reads your website (your rooms or services, menu, FAQs, policies and contact details) and answers customers from it. Prices on it are left out: Zaina quotes them only from your rooms, services and price list.</p>
      <form
        className="form-row"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            setResult(await api<WebsiteRead>("POST", businessPath(props.businessId, "/knowledge/import-website"), { url: value.trim(), max_pages: 15 }));
            props.onChanged();
          });
        }}
      >
        <Field label="Your website"><input required placeholder="https://www.example.co.ke" value={value} onChange={(event) => setAddress(event.target.value)} /></Field>
        <div className="actions start"><Button kind="primary" type="submit" busy={action.busy}>{result ? "Read it again" : "Read my website"}</Button></div>
      </form>
      {action.busy ? <p className="muted small" aria-live="polite">Reading your website: this can take up to a minute…</p> : null}
      <Message message={action.message} />
      {result ? (
        <p className="message success">
          Read {result.pages.length} page{result.pages.length === 1 ? "" : "s"} from {result.site}: Zaina answers from them now.
          {result.skipped.length ? ` ${result.skipped.length} couldn't be read (see Knowledge → Read your website).` : ""} Check them under Knowledge.
        </p>
      ) : null}
      {suggestion ? (
        <div className="stack-tight">
          <p className="small">Your website describes you as: <em>“{suggestion}”</em></p>
          <div className="actions start">
            <Button onClick={() => void action.run(async () => {
              await api("PATCH", businessPath(props.businessId, "/settings"), { about: suggestion });
              setAboutSaved(true);
              props.onChanged();
            }, "Saved as what Zaina says about your business. Change it any time in Settings → Business.")}>Use it as your description</Button>
          </div>
        </div>
      ) : null}
    </section>
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
