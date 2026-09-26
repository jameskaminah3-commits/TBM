// zaina-platform/web/console/pages/leads.tsx
//
// People who want the team to get back to them: the details Zaina took in
// a chat (only what the customer typed), what they want, and how the team is
// following each up (new, contacted, won, lost), with a note of its own.
// The team is alerted as each one comes in.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { timeAgo } from "../format.ts";
import type { Role } from "../types.ts";
import { Button, Empty, ErrorLine, Message, Tabs, useAction, useLoad } from "../ui.tsx";

type LeadStatus = "new" | "contacted" | "won" | "lost";
type Lead = {
  id: number; sessionId: string | null; name: string; email: string | null; phone: string | null; interest: string | null; notes: string | null;
  createdAt: string; status: LeadStatus; teamNote: string | null; updatedAt: string | null; channel: "web" | "whatsapp" | null;
};
type Filter = "open" | LeadStatus | "all";

const STATUS_TEXT: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", won: "Became a customer", lost: "Not going ahead" };

/** A phone number as WhatsApp's link wants it: digits, Kenyan numbers with 254. */
function whatsappDigits(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const full = /^0[17]\d{8}$/.test(digits) ? `254${digits.slice(1)}` : /^[17]\d{8}$/.test(digits) ? `254${digits}` : digits;
  return full.length >= 10 && full.length <= 15 ? full : null;
}

export function LeadsPage(props: { businessId: string; role: Role; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>("open");
  const leads = useLoad(() => api<{ leads: Lead[]; counts: Record<LeadStatus, number> }>("GET", businessPath(props.businessId, `/leads?status=${filter}`)), [props.businessId, filter]);
  const counts = leads.data?.counts;
  const action = useAction();
  const update = (lead: Lead, patch: { status?: LeadStatus; team_note?: string | null }, done: string) => void action.run(async () => {
    await api("PATCH", businessPath(props.businessId, `/leads/${lead.id}`), patch);
    await leads.reload();
    props.onChanged();
  }, done);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Leads</h1>
        <p className="muted">Customers who want you to get back to them. Zaina takes their details in the chat (only what they typed) and you're alerted as each one comes in.</p>
      </div>
      <Tabs
        label="Leads"
        active={filter}
        onChange={setFilter}
        tabs={[
          { id: "open", label: "To follow up", count: counts ? counts.new + counts.contacted : undefined },
          { id: "new", label: "New", count: counts?.new },
          { id: "won", label: "Became customers" },
          { id: "lost", label: "Not going ahead" },
          { id: "all", label: "All" },
        ]}
      />
      <ErrorLine error={leads.error} />
      <Message message={action.message} />
      {leads.data && leads.data.leads.length === 0 ? (
        <Empty title={filter === "open" || filter === "new" ? "Nobody to follow up" : "No leads here"}>
          <p>When a customer wants you to get back to them, Zaina asks for their name and a phone number or email, and they appear here.</p>
        </Empty>
      ) : null}
      <div className="lead-list">
        {leads.data?.leads.map((lead) => <LeadCard key={lead.id} lead={lead} businessId={props.businessId} busy={action.busy} onUpdate={update} />)}
      </div>
    </div>
  );
}

function LeadCard(props: { lead: Lead; businessId: string; busy: boolean; onUpdate: (lead: Lead, patch: { status?: LeadStatus; team_note?: string | null }, done: string) => void }) {
  const { lead } = props;
  const [note, setNote] = useState<string | null>(null);
  const whatsapp = lead.phone ? whatsappDigits(lead.phone) : null;
  return (
    <article className={`card lead ${lead.status}`}>
      <div className="lead-head">
        <div>
          <h2>{lead.name}</h2>
          <p className="muted small">
            {timeAgo(lead.createdAt)}{lead.channel ? ` · ${lead.channel === "whatsapp" ? "WhatsApp" : "website chat"}` : ""}
            {lead.updatedAt && lead.status !== "new" ? ` · ${STATUS_TEXT[lead.status].toLowerCase()} ${timeAgo(lead.updatedAt)}` : ""}
          </p>
        </div>
        <label>
          <span className="visually-hidden">Status of {lead.name}</span>
          <select value={lead.status} disabled={props.busy} onChange={(event) => props.onUpdate(lead, { status: event.target.value as LeadStatus }, `${lead.name}: ${STATUS_TEXT[event.target.value as LeadStatus].toLowerCase()}.`)}>
            {(Object.keys(STATUS_TEXT) as LeadStatus[]).map((status) => <option key={status} value={status}>{STATUS_TEXT[status]}</option>)}
          </select>
        </label>
      </div>
      {lead.interest ? <p><strong>Wants:</strong> {lead.interest}</p> : null}
      {lead.notes ? <p className="muted">{lead.notes}</p> : null}
      <div className="lead-contact">
        {lead.phone ? <a className="button secondary small" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>Call {lead.phone}</a> : null}
        {whatsapp ? <a className="button secondary small" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
        {lead.email ? <a className="button secondary small" href={`mailto:${lead.email}`}>Email {lead.email}</a> : null}
        {lead.sessionId ? <a className="button ghost small" href={`#/b/${encodeURIComponent(props.businessId)}/inbox/${lead.sessionId}`}>Open the chat</a> : null}
      </div>
      {note === null ? (
        <p className="small">
          {lead.teamNote ? <><strong>Note:</strong> {lead.teamNote} </> : null}
          <button type="button" className="link" onClick={() => setNote(lead.teamNote ?? "")}>{lead.teamNote ? "Change the note" : "Add a note"}</button>
        </p>
      ) : (
        <form
          className="stack-tight"
          onSubmit={(event) => {
            event.preventDefault();
            props.onUpdate(lead, { team_note: note.trim() || null }, "Note saved.");
            setNote(null);
          }}
        >
          <label className="visually-hidden" htmlFor={`note-${lead.id}`}>Note about {lead.name}</label>
          <textarea id={`note-${lead.id}`} rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Called on Tuesday; sending a quote." />
          <div className="actions start"><Button small onClick={() => setNote(null)}>Cancel</Button><Button small kind="primary" type="submit">Save note</Button></div>
        </form>
      )}
    </article>
  );
}
