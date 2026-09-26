// zaina-platform/web/console/pages/knowledge.tsx
//
// What Zaina knows about the business: its documents (pages, FAQs,
// policies…), a way to check what Zaina would find for a question, and the
// questions customers asked that nothing answered. Documents come from
// typing, from the business's website (read by the platform), or from a PDF
// or text file (read here, in the browser: the file itself is never sent).

import { useRef, useState } from "react";
import { api, ApiError, businessPath } from "../api.ts";
import { timeAgo } from "../format.ts";
import { atLeast, type KnowledgeSourceRow, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, Tabs, useAction, useLoad } from "../ui.tsx";

type Passage = { sourceId: string; title: string; url: string | null; kind: string; section: string | null; text: string; relevance: number };
type Source = { id: string; title: string; kind: string; url: string | null; language: "en" | "sw"; content: string; status: "published" | "draft" };
/** A new document to review before saving: from a PDF or a text file. */
type Draft = { draft: Pick<Source, "title" | "kind" | "content">; note: string | null };
type WebsiteImport = {
  site: string;
  pages: Array<{ url: string; source: { title: string; kind: string; status: string }; passages: number; hidden_amounts: number; unchanged: boolean }>;
  skipped: Array<{ url: string; reason: string }>;
  description: string | null;
};

const KINDS = ["page", "faq", "policy", "guide", "menu", "document"];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The kind a file probably is, from its name. */
function kindOfFile(name: string): string {
  const words = name.toLowerCase();
  if (/menu|food|drink|wine/.test(words)) return "menu";
  if (/faq|question/.test(words)) return "faq";
  if (/polic|terms|rules|condition|cancel/.test(words)) return "policy";
  return "document";
}

/** A PDF's or text file's text, read in this browser. */
async function readFile(file: File): Promise<{ text: string; note: string | null }> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is over 20 MB. Split it, or copy the text in.");
  if (/\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith("text/")) return { text: (await file.text()).trim(), note: null };
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") throw new Error("Choose a PDF, or a .txt or .md file.");
  // pdf.js is only loaded now, from its own file beside the console.
  const reader = await import(/* @vite-ignore */ new URL("./pdf-reader.js", import.meta.url).href) as { readPdf(data: ArrayBuffer): Promise<{ pages: number; read: number; text: string }> };
  const result = await reader.readPdf(await file.arrayBuffer());
  const note = result.read < result.pages ? `Only the first ${result.read} of ${result.pages} pages were read.` : null;
  return { text: result.text, note };
}

export function KnowledgePage(props: { businessId: string; role: Role }) {
  const [tab, setTab] = useState<"sources" | "check" | "missed">("sources");
  const canEdit = atLeast(props.role, "manager");
  return (
    <div className="page">
      <div className="page-head">
        <h1>Knowledge</h1>
        <p className="muted">What Zaina answers from. Prices and availability come from your booking system and the team, never from these documents: amounts written here are hidden from Zaina.</p>
      </div>
      <Tabs
        label="Knowledge"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "sources", label: "Documents" },
          { id: "check", label: "Check a question" },
          ...(atLeast(props.role, "agent") ? [{ id: "missed" as const, label: "Unanswered questions" }] : []),
        ]}
      />
      {tab === "sources" ? <Sources businessId={props.businessId} canEdit={canEdit} /> : null}
      {tab === "check" ? <Check businessId={props.businessId} /> : null}
      {tab === "missed" ? <Missed businessId={props.businessId} /> : null}
    </div>
  );
}

function Sources(props: { businessId: string; canEdit: boolean }) {
  const sources = useLoad(() => api<{ sources: KnowledgeSourceRow[] }>("GET", businessPath(props.businessId, "/knowledge")), [props.businessId]);
  const [editing, setEditing] = useState<Source | "new" | Draft | null>(null);
  const [website, setWebsite] = useState(false);
  const action = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    void action.run(async () => {
      let read: { text: string; note: string | null };
      try {
        read = await readFile(file);
      } catch (problem) {
        throw new ApiError(400, "unreadable", problem instanceof Error && problem.message && !/pdf|worker|fetch/i.test(problem.message) ? problem.message : "That file couldn't be read. If it's a PDF, try saving it again from its app, or copy the text in.");
      }
      if (!read.text) throw new ApiError(400, "no_text", "No text was found in that file: it's probably a scanned picture. Type or paste its text instead.");
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 200) || "Document";
      setEditing({ draft: { title, kind: kindOfFile(file.name), content: read.text.slice(0, 200_000) }, note: read.note });
    });
  };
  return (
    <section>
      {props.canEdit ? (
        <div className="toolbar">
          <Button kind="primary" onClick={() => setEditing("new")}><Icon name="plus" size={15} /> Add a document</Button>
          <Button onClick={() => setWebsite(true)}>Read your website</Button>
          <Button busy={action.busy} onClick={() => fileInput.current?.click()}>Add from a PDF</Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf,.txt,.md,text/plain,text/markdown"
            className="visually-hidden"
            aria-label="A PDF or text file"
            onChange={(event) => {
              chooseFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      ) : null}
      <ErrorLine error={sources.error} />
      <Message message={action.message} />
      {sources.data && sources.data.sources.length === 0 ? (
        <Empty title="No documents yet">
          <p>Add your FAQ, house rules, directions or menu. Zaina searches them for every question about the business and says where the answer comes from.</p>
        </Empty>
      ) : null}
      {sources.data && sources.data.sources.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>Document</th><th>Kind</th><th className="number">Passages</th><th>Updated</th>{props.canEdit ? <th><span className="visually-hidden">Actions</span></th> : null}</tr>
          </thead>
          <tbody>
            {sources.data.sources.map((source) => (
              <tr key={source.id}>
                <td>
                  <strong>{source.title}</strong>
                  {source.status === "draft" ? <span className="chip closed">Draft</span> : null}
                  {source.language === "sw" ? <span className="chip">Swahili</span> : null}
                  {source.url ? <div className="muted small ellipsis">{source.url}</div> : null}
                </td>
                <td>{source.kind}</td>
                <td className="number">{source.passages}</td>
                <td className="muted">{timeAgo(source.updatedAt)}</td>
                {props.canEdit ? (
                  <td className="row-actions">
                    <Button small onClick={() => void action.run(async () => setEditing((await api<{ source: Source }>("GET", businessPath(props.businessId, `/knowledge/${source.id}`))).source))}>Edit</Button>
                    <Button small kind="ghost" onClick={() => {
                      if (!window.confirm(`Delete "${source.title}"? Zaina stops answering from it at once.`)) return;
                      void action.run(async () => {
                        await api("DELETE", businessPath(props.businessId, `/knowledge/${source.id}`));
                        await sources.reload();
                      }, `Deleted "${source.title}".`);
                    }}>Delete</Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {website ? (
        <ReadWebsite
          businessId={props.businessId}
          onClose={() => setWebsite(false)}
          onRead={async () => { await sources.reload(); }}
        />
      ) : null}
      {editing ? (
        <SourceEditor
          businessId={props.businessId}
          source={editing === "new" || "draft" in editing ? null : editing}
          draft={editing !== "new" && "draft" in editing ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={async (text) => {
            setEditing(null);
            action.setMessage({ kind: "success", text });
            await sources.reload();
          }}
        />
      ) : null}
    </section>
  );
}

function SourceEditor(props: { businessId: string; source: Source | null; draft: Draft | null; onClose: () => void; onSaved: (message: string) => void }) {
  const start = props.source ?? props.draft?.draft ?? null;
  const [title, setTitle] = useState(start?.title ?? "");
  const [kind, setKind] = useState(start?.kind ?? "page");
  const [url, setUrl] = useState(props.source?.url ?? "");
  const [language, setLanguage] = useState<"en" | "sw">(props.source?.language ?? "en");
  const [content, setContent] = useState(start?.content ?? "");
  const [status, setStatus] = useState<"published" | "draft">(props.source?.status ?? "published");
  const action = useAction();
  return (
    <Modal title={props.source ? `Edit "${props.source.title}"` : props.draft ? "Check the text, then save" : "Add a document"} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const body = { title, kind, url: url.trim() || null, language, content, status };
          await action.run(async () => {
            const result = await api<{ passages: number; hidden_amounts: number; unchanged: boolean }>(
              props.source ? "PUT" : "POST",
              businessPath(props.businessId, props.source ? `/knowledge/${props.source.id}` : "/knowledge"),
              body,
            );
            const hidden = result.hidden_amounts ? ` ${result.hidden_amounts} amount(s) are hidden from Zaina: prices come from your booking system or the team.` : "";
            props.onSaved(result.unchanged ? `"${title}" is unchanged.` : `Saved "${title}": ${result.passages} passage(s) for Zaina to search.${hidden}`);
          });
        }}
      >
        {props.draft ? <p className="muted small">This is the text found in the file{props.draft.note ? ` (${props.draft.note})` : ""}. Tidy anything that came out jumbled, such as tables. Prices are hidden from Zaina: keep them in your rooms, services or price list.</p> : null}
        <Field label="Title"><input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <div className="form-row">
          <Field label="Kind">
            <select value={kind} onChange={(event) => setKind(event.target.value)}>{KINDS.map((option) => <option key={option}>{option}</option>)}</select>
          </Field>
          <Field label="Language">
            <select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "sw")}>
              <option value="en">English</option>
              <option value="sw">Swahili</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(event) => setStatus(event.target.value as "published" | "draft")}>
              <option value="published">Published (Zaina uses it)</option>
              <option value="draft">Draft (hidden from Zaina)</option>
            </select>
          </Field>
        </div>
        <Field label="Link customers can open (optional)" hint="Zaina gives this link with answers from the document.">
          <input type="url" placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
        </Field>
        <Field label="Text" hint="Plain text or Markdown. Headings (## …) and questions become their own passages." wide>
          <textarea required rows={14} value={content} onChange={(event) => setContent(event.target.value)} />
        </Field>
        <Message message={action.message} />
        <div className="actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button kind="primary" type="submit" busy={action.busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReadWebsite(props: { businessId: string; onClose: () => void; onRead: () => Promise<void> }) {
  const settings = useLoad(() => api<{ settings: { websiteUrl: string | null } }>("GET", businessPath(props.businessId, "/settings")), [props.businessId]);
  const [address, setAddress] = useState<string | null>(null);
  const [pages, setPages] = useState("10");
  const [status, setStatus] = useState<"published" | "draft">("published");
  const [result, setResult] = useState<WebsiteImport | null>(null);
  const action = useAction();
  const value = address ?? settings.data?.settings.websiteUrl ?? "";
  return (
    <Modal title="Read your website" onClose={props.onClose}>
      {result ? (
        <div className="stack-tight">
          <p>Read <strong>{result.site}</strong>: {result.pages.length} page{result.pages.length === 1 ? "" : "s"} saved{status === "draft" ? " as drafts" : ", and Zaina answers from them now"}.</p>
          <ul className="plain-list">
            {result.pages.map((page) => (
              <li key={page.url}>
                <strong>{page.source.title}</strong> <span className="muted small">({page.source.kind}{page.unchanged ? ", unchanged" : `, ${page.passages} passage${page.passages === 1 ? "" : "s"}`}{page.hidden_amounts ? `, ${page.hidden_amounts} price${page.hidden_amounts === 1 ? "" : "s"} hidden from Zaina` : ""})</span>
              </li>
            ))}
          </ul>
          {result.skipped.length ? (
            <details>
              <summary className="muted small">{result.skipped.length} page{result.skipped.length === 1 ? "" : "s"} not read</summary>
              <ul className="plain-list small">{result.skipped.map((entry) => <li key={entry.url}><span className="ellipsis">{entry.url}</span>: {entry.reason}</li>)}</ul>
            </details>
          ) : null}
          <p className="muted small">Check the pages under Documents: edit or delete anything out of date. Read the website again after you change it.</p>
          <div className="actions"><Button kind="primary" onClick={props.onClose}>Done</Button></div>
        </div>
      ) : (
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => {
              setResult(await api<WebsiteImport>("POST", businessPath(props.businessId, "/knowledge/import-website"), { url: value.trim(), max_pages: Number(pages), status }));
              await props.onRead();
            });
          }}
        >
          <p className="muted">Zaina reads your home page and the pages it links to (rooms, menu, services, FAQs, policies, contact), and keeps each as a document. Prices on the pages are hidden from Zaina: they come from your rooms, services and price list.</p>
          <Field label="Your website"><input required placeholder="https://www.example.co.ke" value={value} onChange={(event) => setAddress(event.target.value)} /></Field>
          <div className="form-row">
            <Field label="Pages to read">
              <select value={pages} onChange={(event) => setPages(event.target.value)}>
                <option value="5">Up to 5</option>
                <option value="10">Up to 10</option>
                <option value="25">Up to 25</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(event) => setStatus(event.target.value as "published" | "draft")}>
                <option value="published">Published (Zaina uses them now)</option>
                <option value="draft">Drafts (I'll check them first)</option>
              </select>
            </Field>
          </div>
          {action.busy ? <p className="muted small" aria-live="polite">Reading your website: this can take up to a minute…</p> : null}
          <Message message={action.message} />
          <div className="actions">
            <Button onClick={props.onClose}>Cancel</Button>
            <Button kind="primary" type="submit" busy={action.busy}>Read my website</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Check(props: { businessId: string }) {
  const [question, setQuestion] = useState("");
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const action = useAction();
  return (
    <section>
      <form
        className="search-form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => setPassages((await api<{ passages: Passage[] }>("POST", businessPath(props.businessId, "/knowledge/search"), { query: question })).passages));
        }}
      >
        <label className="visually-hidden" htmlFor="check-question">A customer's question</label>
        <input id="check-question" placeholder="Type a question the way a customer would…" value={question} onChange={(event) => setQuestion(event.target.value)} />
        <Button kind="primary" type="submit" busy={action.busy} disabled={!question.trim()}><Icon name="search" size={15} /> What would Zaina find?</Button>
      </form>
      <Message message={action.message} />
      {passages && passages.length === 0 ? (
        <Empty title="Nothing answers that yet">
          <p>Zaina would say she isn't sure and offer to pass it to the team. Add a document that answers it.</p>
        </Empty>
      ) : null}
      {passages?.map((passage) => (
        <article key={`${passage.sourceId}-${passage.section}-${passage.text.slice(0, 20)}`} className="passage">
          <h3>{passage.title}{passage.section ? <span className="muted"> · {passage.section}</span> : null}</h3>
          <p>{passage.text}</p>
          {passage.url ? <p className="muted small">{passage.url}</p> : null}
        </article>
      ))}
    </section>
  );
}

function Missed(props: { businessId: string }) {
  const misses = useLoad(() => api<{ misses: Array<{ query: string; times: number; lastAsked: string }> }>("GET", businessPath(props.businessId, "/knowledge/misses?days=30")), [props.businessId]);
  return (
    <section>
      <p className="muted">Questions from the last 30 days that no document answered. Each one is a document worth adding.</p>
      <ErrorLine error={misses.error} />
      {misses.data && misses.data.misses.length === 0 ? <Empty title="Every question found an answer" /> : null}
      {misses.data && misses.data.misses.length > 0 ? (
        <table className="table">
          <thead><tr><th>Question</th><th className="number">Times asked</th><th>Last asked</th></tr></thead>
          <tbody>
            {misses.data.misses.map((miss) => (
              <tr key={miss.query}><td>{miss.query}</td><td className="number">{miss.times}</td><td className="muted">{timeAgo(miss.lastAsked)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
