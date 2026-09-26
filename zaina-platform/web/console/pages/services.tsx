// zaina-platform/web/console/pages/services.tsx
//
// For a salon or restaurant: what can be booked and who takes it.
//   Opening hours   the business's week, and how often a booking can start
//   Services        (a restaurant's table bookings): length, the time after
//                   each before the next, party sizes, price, how it's
//                   booked, and who can do it
//   People / tables stylists, chairs or tables (with seats), each with its
//                   own working hours if it keeps different ones
//   Closures        time off, a private event: one person or the whole place
// Prices are in the business's currency; the API holds minor units.

import { useEffect, useState } from "react";
import { api, businessPath } from "../api.ts";
import type { BookingMode, BookingSettingsView, Closure, ResourceKind, ResourceRow, Role, Service, WeekHours } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, Toggle, useAction, useLoad } from "../ui.tsx";

const major = (minor: number | undefined) => (minor === undefined ? "" : String(minor / 100));
const minor = (value: string) => Math.round(Number(value.replace(/,/g, "")) * 100);
const DAYS: Array<{ key: keyof WeekHours; label: string }> = [
  { key: "1", label: "Monday" }, { key: "2", label: "Tuesday" }, { key: "3", label: "Wednesday" }, { key: "4", label: "Thursday" },
  { key: "5", label: "Friday" }, { key: "6", label: "Saturday" }, { key: "0", label: "Sunday" },
];
const MODES: Record<BookingMode, string> = {
  instant: "Online: booked straight away (with the deposit, if you take one)",
  request: "On request: your team confirms",
  enquiry: "By enquiry: Zaina takes their details",
};
const KINDS: Record<ResourceKind, string> = { staff: "Person", chair: "Chair or station", table: "Table", room: "Room", other: "Other" };

export function ServicesPage(props: { businessId: string; role: Role; businessType: string | null }) {
  const restaurant = props.businessType === "restaurant";
  const settings = useLoad(() => api<BookingSettingsView>("GET", businessPath(props.businessId, "/booking-settings")), [props.businessId]);
  const services = useLoad(() => api<{ currency: "KES" | "USD"; offerings: Service[] }>("GET", businessPath(props.businessId, "/offerings")), [props.businessId]);
  const resources = useLoad(() => api<{ resources: ResourceRow[] }>("GET", businessPath(props.businessId, "/resources")), [props.businessId]);
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const [editingResource, setEditingResource] = useState<ResourceRow | "new" | null>(null);
  const currency = services.data?.currency ?? "KES";
  const people = resources.data?.resources ?? [];
  return (
    <div className="page stack">
      <div className="page-head"><h1>{restaurant ? "Tables" : "Services"}</h1></div>
      {settings.data ? <OpeningHours businessId={props.businessId} settings={settings.data} onSaved={() => void settings.reload()} /> : <ErrorLine error={settings.error} />}

      <section className="card stack-tight">
        <div className="row"><h2>{restaurant ? "Table bookings" : "Services"}</h2><Button kind="primary" small onClick={() => setEditing("new")}><Icon name="plus" /> Add</Button></div>
        {!services.data ? <ErrorLine error={services.error} /> : !services.data.offerings.length ? (
          <Empty title={restaurant ? "No table bookings yet. Add one, like \"Dinner\" (90 minutes, parties of 1 to 8)." : "No services yet. Add one, like \"Haircut\" (45 minutes)."} />
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Length</th><th>{restaurant ? "Parties" : "With"}</th><th>Price</th><th>Booked</th></tr></thead>
            <tbody>
              {services.data.offerings.map((service) => (
                <tr key={service.id}>
                  <td><button type="button" className="link" onClick={() => setEditing(service)}>{service.name}</button>{service.status === "hidden" ? <span className="chip">hidden</span> : null}</td>
                  <td>{service.duration_minutes} min{service.buffer_minutes ? <span className="muted small"> + {service.buffer_minutes}</span> : null}</td>
                  <td>{restaurant ? `${service.min_party}–${service.max_party}` : service.resource_ids.length ? people.filter((person) => service.resource_ids.includes(person.id)).map((person) => person.name).join(", ") : "Anyone"}</td>
                  <td>{service.price_display}</td>
                  <td>{service.booking_mode === "instant" ? "Online" : service.booking_mode === "request" ? "On request" : "Enquiry"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card stack-tight">
        <div className="row"><h2>{restaurant ? "Tables" : "People and chairs"}</h2><Button kind="primary" small onClick={() => setEditingResource("new")}><Icon name="plus" /> Add</Button></div>
        {!resources.data ? <ErrorLine error={resources.error} /> : !people.length ? (
          <Empty title={restaurant ? "No tables yet. Add each table with its seats." : "No one yet. Add each stylist (or chair) who takes bookings."} />
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Kind</th>{restaurant ? <th>Seats</th> : null}<th>Hours</th></tr></thead>
            <tbody>
              {people.map((resource) => (
                <tr key={resource.id}>
                  <td><button type="button" className="link" onClick={() => setEditingResource(resource)}>{resource.name}</button>{resource.status === "hidden" ? <span className="chip">hidden</span> : null}</td>
                  <td>{KINDS[resource.kind]}</td>
                  {restaurant ? <td>{resource.seats}{resource.min_party > 1 ? <span className="muted small"> (parties of {resource.min_party}+)</span> : null}</td> : null}
                  <td>{resource.hours_text ?? <span className="muted">Opening hours</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Closures businessId={props.businessId} resources={people} />

      {editing ? <ServiceForm businessId={props.businessId} restaurant={restaurant} currency={currency} service={editing === "new" ? null : editing} people={people} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void services.reload(); }} /> : null}
      {editingResource ? <ResourceForm businessId={props.businessId} restaurant={restaurant} resource={editingResource === "new" ? null : editingResource} onClose={() => setEditingResource(null)} onSaved={() => { setEditingResource(null); void resources.reload(); void services.reload(); }} /> : null}
    </div>
  );
}

/** A week of hours: each day open or closed, from and to (a closing time before the opening runs past midnight). */
function WeekEditor(props: { value: WeekHours; onChange: (value: WeekHours) => void }) {
  return (
    <div className="week">
      {DAYS.map(({ key, label }) => {
        const span = props.value[key]?.[0];
        const extra = props.value[key]?.slice(1) ?? [];
        const setSpan = (next: [string, string] | null) => props.onChange({ ...props.value, [key]: next ? [next, ...extra] : [] });
        return (
          <div key={key} className="week-day">
            <Toggle checked={!!span} onChange={(open) => setSpan(open ? ["09:00", "17:00"] : null)} label={label} />
            {span ? (
              <span className="week-times">
                <input type="time" aria-label={`${label} opens`} value={span[0]} onChange={(event) => setSpan([event.target.value, span[1]])} />
                <span aria-hidden="true">–</span>
                <input type="time" aria-label={`${label} closes`} value={span[1]} onChange={(event) => setSpan([span[0], event.target.value])} />
                {extra.length ? <span className="muted small">+{extra.length} more</span> : null}
              </span>
            ) : <span className="muted small">Closed</span>}
          </div>
        );
      })}
    </div>
  );
}

const cleanWeek = (week: WeekHours): WeekHours => Object.fromEntries(Object.entries(week).filter(([, spans]) => spans && spans.length)) as WeekHours;

function OpeningHours(props: { businessId: string; settings: BookingSettingsView; onSaved: () => void }) {
  const [week, setWeek] = useState<WeekHours>(props.settings.opening_hours);
  const [interval, setInterval] = useState(String(props.settings.slot_interval_minutes));
  const action = useAction();
  useEffect(() => setWeek(props.settings.opening_hours), [props.settings.opening_hours]);
  const none = !Object.values(props.settings.opening_hours).some((spans) => spans?.length);
  return (
    <form
      className="card form"
      onSubmit={async (event) => {
        event.preventDefault();
        await action.run(async () => {
          await api("PATCH", businessPath(props.businessId, "/booking-settings"), { opening_hours: cleanWeek(week), slot_interval_minutes: Number(interval) });
          props.onSaved();
        }, "Saved. Zaina offers times within these hours.");
      }}
    >
      <h2>Opening hours</h2>
      {none ? <p className="message error">Set your opening hours: until then, no times can be booked.</p> : <p className="muted">{props.settings.opening_hours_text}</p>}
      <WeekEditor value={week} onChange={setWeek} />
      <div className="form-row">
        <Field label="Bookings can start every" hint="Times offered to customers, from opening.">
          <select value={interval} onChange={(event) => setInterval(event.target.value)}>
            {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select>
        </Field>
      </div>
      <Message message={action.message} />
      <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Save hours</Button></div>
    </form>
  );
}

function ServiceForm(props: { businessId: string; restaurant: boolean; currency: "KES" | "USD"; service: Service | null; people: ResourceRow[]; onClose: () => void; onSaved: () => void }) {
  const service = props.service;
  const [form, setForm] = useState({
    name: service?.name ?? "",
    description: service?.description ?? "",
    duration_minutes: String(service?.duration_minutes ?? (props.restaurant ? 90 : 45)),
    buffer_minutes: String(service?.buffer_minutes ?? (props.restaurant ? 15 : 0)),
    min_party: String(service?.min_party ?? 1),
    max_party: String(service?.max_party ?? (props.restaurant ? 8 : 1)),
    price: major(service?.pricing.price),
    per_person: major(service?.pricing.per_person),
    booking_mode: service?.booking_mode ?? "instant",
    status: service?.status ?? "active",
  });
  const [who, setWho] = useState<string[]>(service?.resource_ids ?? []);
  const action = useAction();
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  const money = props.currency === "KES" ? "KSh" : "US$";
  const candidates = props.people.filter((person) => (props.restaurant ? person.kind === "table" : person.kind !== "table") && person.status === "active");
  return (
    <Modal title={service ? service.name : props.restaurant ? "New table booking" : "New service"} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const pricing: Record<string, unknown> = { ...(service?.pricing ?? {}) };
          delete pricing.price;
          delete pricing.per_person;
          if (form.price.trim()) pricing.price = minor(form.price);
          if (form.per_person.trim()) pricing.per_person = minor(form.per_person);
          const body = {
            name: form.name, description: form.description, duration_minutes: Number(form.duration_minutes), buffer_minutes: Number(form.buffer_minutes),
            min_party: Number(form.min_party), max_party: Number(form.max_party), booking_mode: form.booking_mode, status: form.status, pricing, resource_ids: who,
          };
          await action.run(async () => {
            await api(service ? "PUT" : "POST", businessPath(props.businessId, service ? `/offerings/${service.id}` : "/offerings"), body);
            props.onSaved();
          });
        }}
      >
        <div className="form-row">
          <Field label="Name"><input required maxLength={120} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder={props.restaurant ? "Dinner" : "Haircut"} /></Field>
          <Field label="Length (minutes)"><input type="number" min={5} max={720} required value={form.duration_minutes} onChange={(event) => set("duration_minutes", event.target.value)} /></Field>
          <Field label="Then free after (minutes)" hint={props.restaurant ? "To clear and reset the table." : "To clean up before the next."}><input type="number" min={0} max={240} required value={form.buffer_minutes} onChange={(event) => set("buffer_minutes", event.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Smallest party"><input type="number" min={1} max={50} required value={form.min_party} onChange={(event) => set("min_party", event.target.value)} /></Field>
          <Field label="Largest party"><input type="number" min={1} max={50} required value={form.max_party} onChange={(event) => set("max_party", event.target.value)} /></Field>
          <Field label={`Price (${money})`} hint="Per booking. Empty: free."><input inputMode="decimal" value={form.price} onChange={(event) => set("price", event.target.value)} /></Field>
          <Field label={`Per person (${money})`} hint="Optional, like a set menu."><input inputMode="decimal" value={form.per_person} onChange={(event) => set("per_person", event.target.value)} /></Field>
        </div>
        <Field label="How it's booked"><select value={form.booking_mode} onChange={(event) => set("booking_mode", event.target.value)}>{(Object.keys(MODES) as BookingMode[]).map((mode) => <option key={mode} value={mode}>{MODES[mode]}</option>)}</select></Field>
        <Field label="Description" hint="Zaina uses it to describe this to customers." wide><textarea rows={2} maxLength={2000} value={form.description} onChange={(event) => set("description", event.target.value)} /></Field>
        {candidates.length ? (
          <fieldset className="checks">
            <legend>{props.restaurant ? "Tables it can use" : "Who can do it"} <span className="muted small">(none ticked: any that fits)</span></legend>
            {candidates.map((person) => (
              <label key={person.id} className="toggle">
                <input type="checkbox" checked={who.includes(person.id)} onChange={(event) => setWho(event.target.checked ? [...who, person.id] : who.filter((id) => id !== person.id))} />
                {person.name}
              </label>
            ))}
          </fieldset>
        ) : null}
        {service ? <Toggle checked={form.status === "hidden"} onChange={(hidden) => set("status", hidden ? "hidden" : "active")} label="Hidden (not offered to customers)" /> : null}
        <Message message={action.message} />
        <div className="actions">
          {service ? <Button kind="danger" busy={action.busy} onClick={() => void action.run(async () => { await api("DELETE", businessPath(props.businessId, `/offerings/${service.id}`)); props.onSaved(); })}>Remove</Button> : null}
          <Button onClick={props.onClose}>Cancel</Button>
          <Button kind="primary" type="submit" busy={action.busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function ResourceForm(props: { businessId: string; restaurant: boolean; resource: ResourceRow | null; onClose: () => void; onSaved: () => void }) {
  const resource = props.resource;
  const [form, setForm] = useState({
    name: resource?.name ?? "",
    kind: resource?.kind ?? (props.restaurant ? "table" : "staff"),
    seats: String(resource?.seats ?? (props.restaurant ? 4 : 1)),
    min_party: String(resource?.min_party ?? 1),
    status: resource?.status ?? "active",
  });
  const [ownHours, setOwnHours] = useState(!!resource?.hours);
  const [hours, setHours] = useState<WeekHours>(resource?.hours ?? {});
  const action = useAction();
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  return (
    <Modal title={resource ? resource.name : props.restaurant ? "New table" : "New person or chair"} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const body = { name: form.name, kind: form.kind, seats: Number(form.seats), min_party: Number(form.min_party), status: form.status, hours: ownHours ? cleanWeek(hours) : null };
          await action.run(async () => {
            await api(resource ? "PUT" : "POST", businessPath(props.businessId, resource ? `/resources/${resource.id}` : "/resources"), body);
            props.onSaved();
          });
        }}
      >
        <div className="form-row">
          <Field label="Name"><input required maxLength={80} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder={props.restaurant ? "Table 4" : "Amina"} /></Field>
          <Field label="Kind"><select value={form.kind} onChange={(event) => set("kind", event.target.value)}>{(Object.keys(KINDS) as ResourceKind[]).map((kind) => <option key={kind} value={kind}>{KINDS[kind]}</option>)}</select></Field>
          {form.kind === "table" ? <Field label="Seats"><input type="number" min={1} max={100} required value={form.seats} onChange={(event) => set("seats", event.target.value)} /></Field> : null}
          {form.kind === "table" ? <Field label="Smallest party" hint="Keep big tables for big groups."><input type="number" min={1} max={Number(form.seats) || 1} required value={form.min_party} onChange={(event) => set("min_party", event.target.value)} /></Field> : null}
        </div>
        <Toggle checked={ownHours} onChange={setOwnHours} label={form.kind === "staff" ? "Works different hours from opening hours" : "Available different hours from opening hours"} />
        {ownHours ? <WeekEditor value={hours} onChange={setHours} /> : null}
        {resource ? <Toggle checked={form.status === "hidden"} onChange={(hidden) => set("status", hidden ? "hidden" : "active")} label="Hidden (takes no new bookings)" /> : null}
        <Message message={action.message} />
        <div className="actions">
          {resource ? <Button kind="danger" busy={action.busy} onClick={() => void action.run(async () => { await api("DELETE", businessPath(props.businessId, `/resources/${resource.id}`)); props.onSaved(); })}>Remove</Button> : null}
          <Button onClick={props.onClose}>Cancel</Button>
          <Button kind="primary" type="submit" busy={action.busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function Closures(props: { businessId: string; resources: ResourceRow[] }) {
  const loaded = useLoad(() => api<{ closures: Closure[] }>("GET", businessPath(props.businessId, "/closures?days=60")), [props.businessId]);
  const [form, setForm] = useState({ resource_id: "", starts_at: "", ends_at: "", reason: "" });
  const action = useAction();
  const name = (id: string | null) => (id ? props.resources.find((resource) => resource.id === id)?.name ?? "—" : "Everyone");
  const when = (value: string) => new Date(value).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <section className="card stack-tight">
      <h2>Closures</h2>
      <p className="muted small">Time off, a holiday or a private event: no bookings are offered then.</p>
      {!loaded.data ? <ErrorLine error={loaded.error} /> : loaded.data.closures.length ? (
        <ul className="plain-list">
          {loaded.data.closures.map((closure) => (
            <li key={closure.id} className="row">
              <span>{name(closure.resource_id)}: {when(closure.starts_at)} – {when(closure.ends_at)}{closure.reason ? ` · ${closure.reason}` : ""}{closure.source === "calendar" ? " (from your calendar)" : ""}</span>
              {closure.source === "staff" ? <Button small kind="ghost" onClick={() => void action.run(async () => { await api("DELETE", businessPath(props.businessId, `/closures/${closure.id}`)); await loaded.reload(); }, "Removed.")}>Remove</Button> : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted">No closures in the next two months.</p>}
      <form
        className="form-row"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            await api("POST", businessPath(props.businessId, "/closures"), {
              resource_id: form.resource_id || null, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString(), reason: form.reason,
            });
            setForm({ resource_id: "", starts_at: "", ends_at: "", reason: "" });
            await loaded.reload();
          }, "Added.");
        }}
      >
        <Field label="Who"><select value={form.resource_id} onChange={(event) => setForm({ ...form, resource_id: event.target.value })}><option value="">Everyone (closed)</option>{props.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></Field>
        <Field label="From"><input type="datetime-local" required value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></Field>
        <Field label="Until"><input type="datetime-local" required value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} /></Field>
        <Field label="Why (for the team)"><input maxLength={200} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field>
        <Button kind="primary" type="submit" busy={action.busy}>Add closure</Button>
      </form>
      <Message message={action.message} />
    </section>
  );
}
