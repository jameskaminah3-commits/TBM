// zaina-platform/web/console/pages/knowledge.tsx
//
// What Zaina knows about the business: its documents (pages, FAQs,
// policies…), a way to check what Zaina would find for a question, and the
// questions customers asked that nothing answered.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { timeAgo } from "../format.ts";
import { atLeast, type KnowledgeSourceRow, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, Tabs, useAction, useLoad } from "../ui.tsx";

type Passage = { sourceId: string; title: string; url: string | null; kind: string; section: string | null; text: string; relevance: number };
type Source = { id: string; title: string; kind: string; url: string | null; language: "en" | "sw"; content: string; status: "published" | "draft" };

const KINDS = ["page", "faq", "policy", "guide", "menu", "document"];

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
  const [editing, setEditing] = useState<Source | "new" | null>(null);
  const action = useAction();
  return (
    <section>
      {props.canEdit ? (
        <div className="toolbar">
          <Button kind="primary" onClick={() => setEditing("new")}><Icon name="plus" size={15} /> Add a document</Button>
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
      {editing ? (
        <SourceEditor
          businessId={props.businessId}
          source={editing === "new" ? null : editing}
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

function SourceEditor(props: { businessId: string; source: Source | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [title, setTitle] = useState(props.source?.title ?? "");
  const [kind, setKind] = useState(props.source?.kind ?? "page");
  const [url, setUrl] = useState(props.source?.url ?? "");
  const [language, setLanguage] = useState<"en" | "sw">(props.source?.language ?? "en");
  const [content, setContent] = useState(props.source?.content ?? "");
  const [status, setStatus] = useState<"published" | "draft">(props.source?.status ?? "published");
  const action = useAction();
  return (
    <Modal title={props.source ? `Edit "${props.source.title}"` : "Add a document"} onClose={props.onClose}>
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
