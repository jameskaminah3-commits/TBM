// zaina-platform/web/console/pages/platform.tsx
//
// The platform's own view, for its admins: every business's day (model use
// against its budget, chats, waiting handoffs, failed turns, WhatsApp), what
// the platform has switched on, and adding a business.

import { useState } from "react";
import { api } from "../api.ts";
import { go } from "../app.tsx";
import { count, money, timeAgo } from "../format.ts";
import { Button, ErrorLine, Field, Icon, Message, Modal, useAction, useEvery, useLoad } from "../ui.tsx";

type Overview = {
  businesses: Array<{
    id: string;
    name: string;
    business_type: string;
    tokens_today: number;
    daily_token_cap: number | null;
    chats_7d: number;
    waiting: number;
    turns_24h: number;
    failed_24h: number;
    last_activity_at: string | null;
    whatsapp: boolean;
    stays: null | {
      live_since: string | null;
      live_days: number;
      bookings_30d: number;
      deposits_30d: Array<{ currency: "KES" | "USD"; amount: number }>;
      last_booking_at: string | null;
      pilot_ready: boolean;
    };
  }>;
  platform: { whatsapp: boolean; web_push: boolean; alert_email: boolean; public_base_url: string | null };
};

export function PlatformPage() {
  const overview = useLoad(() => api<Overview>("GET", "/v1/platform/overview"), []);
  useEvery(() => void overview.reload(), 30_000, []);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const data = overview.data;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Platform</h1>
        {data ? (
          <p className="muted">
            WhatsApp {data.platform.whatsapp ? "on" : "off"} · Phone alerts {data.platform.web_push ? "on" : "off"} · Alert emails {data.platform.alert_email ? "on" : "off"}
            {data.platform.public_base_url ? ` · ${data.platform.public_base_url}` : " · PUBLIC_BASE_URL not set"}
          </p>
        ) : null}
      </div>
      <div className="toolbar"><Button kind="primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add a business</Button></div>
      <Message message={message} />
      <ErrorLine error={overview.error} />
      {data ? (
        <table className="table">
          <thead>
            <tr>
              <th>Business</th>
              <th className="number">Model use today</th>
              <th className="number">Chats (7 days)</th>
              <th className="number">Waiting now</th>
              <th className="number">Failed turns (24 h)</th>
              <th>WhatsApp</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {data.businesses.map((business) => {
              const share = business.daily_token_cap ? business.tokens_today / business.daily_token_cap : null;
              return (
                <tr key={business.id}>
                  <td>
                    <button type="button" className="link" onClick={() => go({ businessId: business.id, page: "inbox" })}><strong>{business.name}</strong></button>
                    <div className="muted small">{business.id} · {business.business_type.replace(/_/g, " ")}</div>
                  </td>
                  <td className="number">
                    {count(business.tokens_today)}{business.daily_token_cap ? ` of ${count(business.daily_token_cap)}` : ""}
                    {share !== null && share >= 0.8 ? <span className={`status ${share >= 1 ? "critical" : "warning"}`}><Icon name="alert" size={13} />{share >= 1 ? "Budget used" : "Near budget"}</span> : null}
                  </td>
                  <td className="number">{count(business.chats_7d)}</td>
                  <td className="number">{business.waiting}</td>
                  <td className="number">
                    {business.failed_24h}
                    {business.turns_24h > 0 && business.failed_24h / business.turns_24h > 0.05 ? <span className="status warning"><Icon name="alert" size={13} />{Math.round((business.failed_24h / business.turns_24h) * 100)}%</span> : null}
                  </td>
                  <td>{business.whatsapp ? "Connected" : "—"}</td>
                  <td className="muted">{business.last_activity_at ? timeAgo(business.last_activity_at) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      {data ? <Pilot businesses={data.businesses} /> : null}
      {adding ? <AddBusiness onClose={() => setAdding(false)} onAdded={async (text) => { setAdding(false); setMessage({ kind: "success", text }); await overview.reload(); }} /> : null}
    </div>
  );
}

function AddBusiness(props: { onClose: () => void; onAdded: (message: string) => void }) {
  const [form, setForm] = useState({ id: "", name: "", origin: "", type: "general", ownerEmail: "", ownerName: "", ownerPassword: "" });
  const action = useAction();
  return (
    <Modal title="Add a business" onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            const created = await api<{ business: { id: string; public_key: string } }>("POST", "/v1/platform/businesses", {
              id: form.id,
              name: form.name,
              business_type: form.type,
              allowed_origins: form.origin.trim() ? [form.origin.trim()] : [],
              owner: { email: form.ownerEmail, name: form.ownerName, password: form.ownerPassword || undefined },
            });
            props.onAdded(`Added ${form.name}. Its owner can sign in now; its widget key is ${created.business.public_key}.`);
          });
        }}
      >
        <div className="form-row">
          <Field label="Name"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Id" hint="Lowercase letters, digits and dashes; can't change."><input required pattern="[a-z][a-z0-9-]{1,39}" value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value.trim() })} /></Field>
        </div>
        <div className="form-row">
          <Field label="Type">
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              <option value="general">General (answers from its knowledge, takes leads)</option>
              <option value="guesthouse">A place to stay (rooms, bookings, deposits)</option>
              <option value="salon">A salon, barber or spa (services, appointments)</option>
              <option value="restaurant">A restaurant (table bookings)</option>
            </select>
          </Field>
          <Field label="Website" hint="Where the chat widget will run."><input type="url" placeholder="https://" value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value })} /></Field>
        </div>
        <h3>First owner</h3>
        <div className="form-row">
          <Field label="Email"><input type="email" required value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} /></Field>
          <Field label="Name"><input value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} /></Field>
        </div>
        <Field label="Starting password" hint="Only for a new account; they change it after signing in."><input type="password" autoComplete="new-password" value={form.ownerPassword} onChange={(event) => setForm({ ...form, ownerPassword: event.target.value })} /></Field>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Add business</Button></div>
      </form>
    </Modal>
  );
}

/**
 * Phase 4's exit check: three places to stay live for 30 days, with bookings
 * and deposits in the last 30 days.
 */
function Pilot(props: { businesses: Overview["businesses"] }) {
  const stays = props.businesses.filter((business) => business.stays);
  if (!stays.length) return null;
  const ready = stays.filter((business) => business.stays!.pilot_ready).length;
  return (
    <section className="stack-tight">
      <h2>Hospitality pilot</h2>
      <p className="muted">The plan's check: three places to stay live for 30 days, with bookings and deposits flowing. {ready} of 3 so far.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Place to stay</th>
            <th className="number">Live for</th>
            <th className="number">Confirmed bookings (30 days)</th>
            <th className="number">Deposits collected (30 days)</th>
            <th>Last booking</th>
            <th>Check</th>
          </tr>
        </thead>
        <tbody>
          {stays.map((business) => {
            const pilot = business.stays!;
            return (
              <tr key={business.id}>
                <td><button type="button" className="link" onClick={() => go({ businessId: business.id, page: "bookings" })}><strong>{business.name}</strong></button></td>
                <td className="number">{pilot.live_since ? `${pilot.live_days} day${pilot.live_days === 1 ? "" : "s"}` : "Not live"}</td>
                <td className="number">{pilot.bookings_30d}</td>
                <td className="number">{pilot.deposits_30d.length ? pilot.deposits_30d.map((entry) => money(entry)).join(" + ") : "—"}</td>
                <td className="muted">{pilot.last_booking_at ? timeAgo(pilot.last_booking_at) : "—"}</td>
                <td>{pilot.pilot_ready ? <span className="chip ok">Met</span> : <span className="chip">Not yet</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
