// zaina-platform/web/console/pages/calendars.tsx
//
// Settings → Calendars: keeping bookings and the team's other calendars in step.
//   Google Calendar   an owner connects the business's Google account; its
//                     calendars can block times, and confirmed bookings are
//                     written to the one chosen
//   Busy times        calendars whose bookings close times here: a Google
//                     calendar, or an iCal link (Airbnb, Booking.com, a
//                     channel manager)
//   Calendar links    private links to the bookings, for any calendar app

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { timeAgo } from "../format.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Message, useAction, useLoad } from "../ui.tsx";

type CalendarsView = {
  google: { available: boolean; connected: boolean; account: string | null; status: "connected" | "error" | null; last_error: string | null; last_sync_at: string | null; write_calendar_id: string | null };
  sources: Array<{ id: string; kind: "google" | "ics"; calendar_id: string | null; label: string; offering_id: string | null; resource_id: string | null; status: "ok" | "error"; last_error: string | null; last_sync_at: string | null; busy_count: number }>;
  feeds: Array<{ id: string; resource_id: string | null; label: string; created_at: string; last_read_at: string | null }>;
};
type GoogleCalendar = { id: string; name: string; primary: boolean; canWrite: boolean };
type Target = { id: string; name: string };

const OUTCOMES: Record<string, { kind: "success" | "error"; text: string }> = {
  connected: { kind: "success", text: "Google Calendar is connected." },
  declined: { kind: "error", text: "Google Calendar wasn't connected: the permission was declined." },
  forbidden: { kind: "error", text: "Only an owner of this business can connect Google Calendar." },
  expired: { kind: "error", text: "That sign-in took too long. Please try again." },
  failed: { kind: "error", text: "Google didn't complete the sign-in. Please try again." },
};

export function Calendars(props: { businessId: string; role: Role; businessType: string | null; outcome: string | null }) {
  const loaded = useLoad(() => api<CalendarsView>("GET", businessPath(props.businessId, "/calendars")), [props.businessId]);
  const rooms = props.businessType === "guesthouse";
  const targets = useLoad(async (): Promise<Target[]> => rooms
    ? (await api<{ offerings: Target[] }>("GET", businessPath(props.businessId, "/offerings"))).offerings
    : (await api<{ resources: Target[] }>("GET", businessPath(props.businessId, "/resources"))).resources, [props.businessId, rooms]);
  const data = loaded.data;
  if (!data) return <ErrorLine error={loaded.error} />;
  // What the address says Google did, believed only when it matches what the platform knows.
  const said = props.outcome ? OUTCOMES[props.outcome] ?? null : null;
  const outcome = props.outcome === "connected" && !data.google.connected ? null : said;
  const reload = () => void loaded.reload();
  const nameOf = (id: string | null) => (id ? targets.data?.find((target) => target.id === id)?.name ?? "—" : rooms ? "—" : "Everyone");
  return (
    <div className="stack">
      {outcome ? <Message message={outcome} /> : null}
      <Google businessId={props.businessId} role={props.role} view={data} onChanged={reload} />
      <Sources businessId={props.businessId} role={props.role} view={data} rooms={rooms} targets={targets.data ?? []} nameOf={nameOf} onChanged={reload} />
      <Feeds businessId={props.businessId} role={props.role} view={data} rooms={rooms} targets={targets.data ?? []} nameOf={nameOf} onChanged={reload} />
    </div>
  );
}

function Google(props: { businessId: string; role: Role; view: CalendarsView; onChanged: () => void }) {
  const google = props.view.google;
  const owner = atLeast(props.role, "owner");
  const action = useAction();
  const [calendars, setCalendars] = useState<GoogleCalendar[] | null>(null);
  const loadCalendars = () => action.run(async () => setCalendars((await api<{ calendars: GoogleCalendar[] }>("GET", businessPath(props.businessId, "/calendars/google/calendars"))).calendars));
  return (
    <section className="card stack-tight">
      <h2>Google Calendar</h2>
      {!google.available ? <p className="muted">Google Calendar isn't available yet: the platform's Google sign-in hasn't been set up.</p> : !google.connected ? (
        <>
          <p>Connect your Google account to block times that are busy in your calendars, and to see confirmed bookings there.</p>
          {owner
            ? <div className="actions start"><Button kind="primary" busy={action.busy} onClick={() => void action.run(async () => { location.assign((await api<{ url: string }>("POST", businessPath(props.businessId, "/calendars/google/start"))).url); })}>Connect Google Calendar</Button></div>
            : <p className="muted small">Only an owner can connect it.</p>}
        </>
      ) : (
        <>
          <p>Connected as <strong>{google.account ?? "your Google account"}</strong>.{google.last_sync_at ? ` Last in step ${timeAgo(google.last_sync_at)}.` : ""}</p>
          {google.status === "error" || google.last_error ? <p className="message error">{google.last_error ?? "Something went wrong with Google."}</p> : null}
          <div className="form-row">
            <Field label="Write confirmed bookings to" hint="Each confirmed booking becomes an event there; cancelled ones are removed.">
              {calendars ? (
                <select
                  disabled={!owner}
                  value={google.write_calendar_id ?? ""}
                  onChange={(event) => void action.run(async () => {
                    await api("PATCH", businessPath(props.businessId, "/calendars/google"), { write_calendar_id: event.target.value || null });
                    props.onChanged();
                  }, "Saved.")}
                >
                  <option value="">Don't write bookings</option>
                  {calendars.filter((calendar) => calendar.canWrite).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}{calendar.primary ? " (main)" : ""}</option>)}
                </select>
              ) : (
                <Button onClick={() => void loadCalendars()} busy={action.busy}>{google.write_calendar_id ? `Writing to ${google.write_calendar_id}: change` : "Choose a calendar"}</Button>
              )}
            </Field>
          </div>
          <div className="actions start">
            <Button busy={action.busy} onClick={() => void action.run(async () => { await api("POST", businessPath(props.businessId, "/calendars/sync")); props.onChanged(); }, "In step.")}>Sync now</Button>
            {owner && google.status === "error" ? <Button kind="primary" busy={action.busy} onClick={() => void action.run(async () => { location.assign((await api<{ url: string }>("POST", businessPath(props.businessId, "/calendars/google/start"))).url); })}>Connect again</Button> : null}
            {owner ? <Button kind="danger" busy={action.busy} onClick={() => void action.run(async () => { await api("DELETE", businessPath(props.businessId, "/calendars/google")); props.onChanged(); }, "Disconnected.")}>Disconnect</Button> : null}
          </div>
        </>
      )}
      <Message message={action.message} />
    </section>
  );
}

function Sources(props: { businessId: string; role: Role; view: CalendarsView; rooms: boolean; targets: Target[]; nameOf: (id: string | null) => string; onChanged: () => void }) {
  const manager = atLeast(props.role, "manager");
  const action = useAction();
  const [form, setForm] = useState({ kind: "ics", url: "", calendar_id: "", label: "", target: "" });
  const [calendars, setCalendars] = useState<GoogleCalendar[] | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  return (
    <section className="card stack-tight">
      <h2>Busy times from other calendars</h2>
      <p className="muted small">Bookings in these calendars close {props.rooms ? "the room type's nights" : "those times"} here, so nobody is booked twice. They're read every few minutes.</p>
      {props.view.sources.length ? (
        <ul className="plain-list sources">
          {props.view.sources.map((source) => (
            <li key={source.id} className="row">
              <span>
                <strong>{source.label}</strong> <span className="muted small">({source.kind === "ics" ? "calendar link" : "Google"}) → {props.nameOf(props.rooms ? source.offering_id : source.resource_id)}</span>
                <br />
                {source.status === "error"
                  ? <span className="small danger-text">{source.last_error}</span>
                  : <span className="muted small">{source.busy_count} busy {source.busy_count === 1 ? "time" : "times"}{source.last_sync_at ? `, read ${timeAgo(source.last_sync_at)}` : ""}</span>}
              </span>
              {manager ? <Button small kind="ghost" busy={action.busy} onClick={() => void action.run(async () => { await api("DELETE", businessPath(props.businessId, `/calendars/sources/${source.id}`)); props.onChanged(); }, "Removed, with its busy times.")}>Remove</Button> : null}
            </li>
          ))}
        </ul>
      ) : <Empty title="No other calendars yet." />}
      {manager ? (
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => {
              await api("POST", businessPath(props.businessId, "/calendars/sources"), {
                kind: form.kind, label: form.label, ...(form.kind === "ics" ? { url: form.url } : { calendar_id: form.calendar_id }),
                ...(form.target ? (props.rooms ? { offering_id: form.target } : { resource_id: form.target }) : {}),
              });
              setForm({ kind: form.kind, url: "", calendar_id: "", label: "", target: "" });
              props.onChanged();
            }, "Added and read.");
          }}
        >
          <div className="form-row">
            <Field label="From">
              <select value={form.kind} onChange={(event) => { set("kind", event.target.value); if (event.target.value === "google" && !calendars) void api<{ calendars: GoogleCalendar[] }>("GET", businessPath(props.businessId, "/calendars/google/calendars")).then((result) => setCalendars(result.calendars)).catch(() => setCalendars([])); }}>
                <option value="ics">A calendar link (iCal)</option>
                {props.view.google.connected ? <option value="google">A Google calendar</option> : null}
              </select>
            </Field>
            {form.kind === "ics" ? (
              <Field label="Calendar link" hint="From Airbnb (Availability → Export calendar), Booking.com (Sync calendars → Export) or your channel manager. It starts with https:// or webcal://.">
                <input type="url" required value={form.url} onChange={(event) => set("url", event.target.value)} placeholder="https://…/calendar.ics" />
              </Field>
            ) : (
              <Field label="Google calendar">
                <select required value={form.calendar_id} onChange={(event) => set("calendar_id", event.target.value)}>
                  <option value="" disabled>Choose…</option>
                  {(calendars ?? []).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div className="form-row">
            <Field label={props.rooms ? "For room type" : "Blocks"}>
              <select required={props.rooms} value={form.target} onChange={(event) => set("target", event.target.value)}>
                {props.rooms ? <option value="" disabled>Choose…</option> : <option value="">Everyone (the whole business)</option>}
                {props.targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
              </select>
            </Field>
            <Field label="Name" hint="For your team, like “Airbnb: Garden cottage”."><input required maxLength={120} value={form.label} onChange={(event) => set("label", event.target.value)} /></Field>
          </div>
          <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Add calendar</Button></div>
        </form>
      ) : null}
      <Message message={action.message} />
    </section>
  );
}

function Feeds(props: { businessId: string; role: Role; view: CalendarsView; rooms: boolean; targets: Target[]; nameOf: (id: string | null) => string; onChanged: () => void }) {
  const manager = atLeast(props.role, "manager");
  const action = useAction();
  const [form, setForm] = useState({ label: "", resource_id: "" });
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <section className="card stack-tight">
      <h2>Calendar links</h2>
      <p className="muted small">A private link to your bookings for any calendar app. In Google Calendar: Other calendars → From URL. On an iPhone: Settings → Calendar → Accounts → Add subscribed calendar. Anyone with a link can see those bookings (names and times, not phone numbers); remove a link to stop it.</p>
      {link ? (
        <div className="card attention stack-tight">
          <p><strong>Copy this link now</strong>: it isn't shown again.</p>
          <div className="pay-link">
            <input readOnly value={link} aria-label="Calendar link" onFocus={(event) => event.currentTarget.select()} />
            <Button small onClick={() => void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy link"}</Button>
          </div>
          <div className="actions"><Button small kind="ghost" onClick={() => setLink(null)}>Done</Button></div>
        </div>
      ) : null}
      {props.view.feeds.length ? (
        <ul className="plain-list">
          {props.view.feeds.map((feed) => (
            <li key={feed.id} className="row">
              <span>{feed.label || "Bookings"} <span className="muted small">· {feed.resource_id ? props.nameOf(feed.resource_id) : "all bookings"} · made {timeAgo(feed.created_at)}{feed.last_read_at ? ` · read ${timeAgo(feed.last_read_at)}` : " · not read yet"}</span></span>
              {manager ? <Button small kind="ghost" busy={action.busy} onClick={() => void action.run(async () => { await api("DELETE", businessPath(props.businessId, `/calendars/feeds/${feed.id}`)); props.onChanged(); }, "The link no longer works.")}>Remove</Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {manager ? (
        <form
          className="form-row"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => {
              const made = await api<{ url: string }>("POST", businessPath(props.businessId, "/calendars/feeds"), { label: form.label, resource_id: form.resource_id || null });
              setLink(made.url);
              setForm({ label: "", resource_id: "" });
              props.onChanged();
            });
          }}
        >
          <Field label="Name"><input maxLength={80} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Front desk" /></Field>
          {!props.rooms && props.targets.length ? (
            <Field label="Bookings of">
              <select value={form.resource_id} onChange={(event) => setForm({ ...form, resource_id: event.target.value })}>
                <option value="">Everyone</option>
                {props.targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
              </select>
            </Field>
          ) : null}
          <Button kind="primary" type="submit" busy={action.busy}>New link</Button>
        </form>
      ) : null}
      <Message message={action.message} />
    </section>
  );
}
