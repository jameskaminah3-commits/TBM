// zaina-platform/web/console/pages/rooms.tsx
//
// A place to stay's room types (how many of each, what they sleep, how
// they're booked) and their prices: nightly, weekends, seasons, extra
// guests, fees and the deposit. The same rules price every booking, in the
// chat and here. Rooms can be added from a spreadsheet, and dates closed.

import { useEffect, useState } from "react";
import { api, businessPath } from "../api.ts";
import { day } from "../format.ts";
import { atLeast, type Block, type BookingMode, type Fee, type FeeBasis, type Offering, type Pricing, type Quote, type Role, type Season } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, useAction, useLoad } from "../ui.tsx";

const MODES: Record<BookingMode, string> = {
  instant: "Online: confirmed when the deposit is paid",
  request: "On request: the team accepts or declines",
  enquiry: "By enquiry: the team gets back to the guest",
};

const FEE_BASES: Record<FeeBasis, string> = {
  booking: "per booking",
  room: "per room",
  room_night: "per room, per night",
  guest: "per guest",
  guest_night: "per guest, per night",
};

// Forms hold major units (KSh 8,000); the API holds minor units (800000).
const major = (minor: number | undefined) => (minor === undefined ? "" : String(minor / 100));
const minor = (value: string) => Math.round(Number(value.replace(/,/g, "")) * 100);
const optionalMinor = (value: string) => (value.trim() === "" ? undefined : minor(value));
const optionalWhole = (value: string) => (value.trim() === "" ? undefined : Number(value));

export function RoomsPage(props: { businessId: string; role: Role }) {
  const loaded = useLoad(() => api<{ currency: "KES" | "USD"; offerings: Offering[] }>("GET", businessPath(props.businessId, "/offerings")), [props.businessId]);
  const [editing, setEditing] = useState<Offering | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const manager = atLeast(props.role, "manager");
  const data = loaded.data;
  const unit = data?.currency === "USD" ? "$" : "KSh";
  return (
    <div className="page">
      <div className="page-head row">
        <h1>Rooms</h1>
        {manager ? (
          <div className="toolbar">
            <Button onClick={() => setImporting(true)}>Import a spreadsheet</Button>
            <Button kind="primary" onClick={() => setEditing("new")}><Icon name="plus" /> Add a room type</Button>
          </div>
        ) : null}
      </div>
      <p className="muted">Each room type is priced by its own rules, and Zaina and this console quote from them alike.</p>
      {!data ? <ErrorLine error={loaded.error} /> : !data.offerings.length ? (
        <Empty title="No room types yet.">Add them one by one, or import a spreadsheet.</Empty>
      ) : (
        <div className="rooms-grid">
          {data.offerings.map((room) => (
            <article key={room.id} className={`card room${room.status === "hidden" ? " hidden-room" : ""}`}>
              <div className="room-head">
                <h2>{room.name}</h2>
                {room.status === "hidden" ? <span className="chip">Hidden</span> : null}
              </div>
              <dl className="facts">
                <div><dt>Rooms</dt><dd>{room.units}</dd></div>
                <div><dt>Sleeps</dt><dd>{room.max_guests}</dd></div>
                <div><dt>From</dt><dd>{room.from_nightly_display} a night</dd></div>
                <div><dt>Minimum stay</dt><dd>{room.pricing.min_nights ?? 1} night{(room.pricing.min_nights ?? 1) === 1 ? "" : "s"}</dd></div>
              </dl>
              <p className="muted small">{MODES[room.booking_mode]}{room.pricing.seasons?.length ? ` · ${room.pricing.seasons.length} season${room.pricing.seasons.length === 1 ? "" : "s"}` : ""}{room.pricing.fees?.length ? ` · ${room.pricing.fees.length} fee${room.pricing.fees.length === 1 ? "" : "s"}` : ""}</p>
              {manager ? <Button small onClick={() => setEditing(room)}>Edit</Button> : null}
            </article>
          ))}
        </div>
      )}
      <ClosedDates businessId={props.businessId} rooms={data?.offerings ?? []} manager={manager} />
      {editing ? <RoomEditor businessId={props.businessId} room={editing === "new" ? null : editing} unit={unit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void loaded.reload(); }} /> : null}
      {importing ? <ImportRooms businessId={props.businessId} onClose={() => setImporting(false)} onDone={() => { setImporting(false); void loaded.reload(); }} /> : null}
    </div>
  );
}

type SeasonForm = { name: string; from: string; to: string; nightly: string; extra: string; min: string };
type FeeForm = { name: string; amount: string; per: FeeBasis };

function RoomEditor(props: { businessId: string; room: Offering | null; unit: string; onClose: () => void; onSaved: () => void }) {
  const room = props.room;
  const pricing: Pricing = room?.pricing ?? { nightly: 0 };
  const [form, setForm] = useState({
    name: room?.name ?? "",
    description: room?.description ?? "",
    units: String(room?.units ?? 1),
    max_guests: String(room?.max_guests ?? 2),
    booking_mode: room?.booking_mode ?? ("instant" as BookingMode),
    status: room?.status ?? ("active" as const),
    nightly: major(pricing.nightly || undefined),
    weekend: major(pricing.weekend_nightly),
    included: pricing.included_guests === undefined ? "" : String(pricing.included_guests),
    extra: major(pricing.extra_guest_nightly),
    min: pricing.min_nights === undefined ? "" : String(pricing.min_nights),
    max: pricing.max_nights === undefined ? "" : String(pricing.max_nights),
    deposit: pricing.deposit_percent === undefined ? "" : String(pricing.deposit_percent),
    depositFixed: major(pricing.deposit_fixed),
  });
  const [seasons, setSeasons] = useState<SeasonForm[]>((pricing.seasons ?? []).map((season) => ({
    name: season.name, from: season.from, to: season.to, nightly: major(season.nightly), extra: major(season.extra_guest_nightly), min: season.min_nights === undefined ? "" : String(season.min_nights),
  })));
  const [fees, setFees] = useState<FeeForm[]>((pricing.fees ?? []).map((fee) => ({ name: fee.name, amount: major(fee.amount), per: fee.per })));
  const action = useAction();
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });

  const body = () => {
    const rules: Pricing = { nightly: minor(form.nightly) };
    const weekend = optionalMinor(form.weekend);
    if (weekend !== undefined) rules.weekend_nightly = weekend;
    const included = optionalWhole(form.included);
    if (included !== undefined) rules.included_guests = included;
    const extra = optionalMinor(form.extra);
    if (extra !== undefined) rules.extra_guest_nightly = extra;
    const min = optionalWhole(form.min);
    if (min !== undefined) rules.min_nights = min;
    const max = optionalWhole(form.max);
    if (max !== undefined) rules.max_nights = max;
    const deposit = optionalWhole(form.deposit);
    if (deposit !== undefined) rules.deposit_percent = deposit;
    const depositFixed = optionalMinor(form.depositFixed);
    if (depositFixed !== undefined) rules.deposit_fixed = depositFixed;
    if (seasons.length) {
      rules.seasons = seasons.map((season): Season => ({
        name: season.name, from: season.from, to: season.to, nightly: minor(season.nightly),
        ...(season.extra.trim() ? { extra_guest_nightly: minor(season.extra) } : {}),
        ...(season.min.trim() ? { min_nights: Number(season.min) } : {}),
      }));
    }
    if (fees.length) rules.fees = fees.map((fee): Fee => ({ name: fee.name, amount: minor(fee.amount), per: fee.per }));
    return {
      name: form.name, description: form.description, units: Number(form.units), max_guests: Number(form.max_guests),
      booking_mode: form.booking_mode, status: form.status, pricing: rules,
    };
  };

  return (
    <Modal title={room ? `Edit ${room.name}` : "Add a room type"} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            await api(room ? "PUT" : "POST", businessPath(props.businessId, room ? `/offerings/${room.id}` : "/offerings"), body());
            props.onSaved();
          });
        }}
      >
        <div className="form-row">
          <Field label="Name"><input required maxLength={120} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Deluxe double" /></Field>
          <Field label="How many rooms of this type"><input type="number" min={1} max={500} required value={form.units} onChange={(event) => set("units", event.target.value)} /></Field>
          <Field label="Guests one room sleeps"><input type="number" min={1} max={50} required value={form.max_guests} onChange={(event) => set("max_guests", event.target.value)} /></Field>
        </div>
        <Field label="Description" hint="What Zaina tells guests about this room: beds, view, bathroom." wide>
          <textarea rows={3} maxLength={2000} value={form.description} onChange={(event) => set("description", event.target.value)} />
        </Field>
        <div className="form-row">
          <Field label="Booked"><select value={form.booking_mode} onChange={(event) => set("booking_mode", event.target.value)}>{Object.entries(MODES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Shown to guests"><select value={form.status} onChange={(event) => set("status", event.target.value)}><option value="active">Yes</option><option value="hidden">No, hidden</option></select></Field>
        </div>
        <h3>Price</h3>
        <div className="form-row">
          <Field label={`A night (${props.unit})`}><input inputMode="decimal" required value={form.nightly} onChange={(event) => set("nightly", event.target.value)} placeholder="8000" /></Field>
          <Field label={`Friday and Saturday nights (${props.unit})`} hint="Leave empty for the same price."><input inputMode="decimal" value={form.weekend} onChange={(event) => set("weekend", event.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Guests the price includes" hint="Per room. Empty: everyone it sleeps."><input type="number" min={1} value={form.included} onChange={(event) => set("included", event.target.value)} /></Field>
          <Field label={`Each extra guest, a night (${props.unit})`}><input inputMode="decimal" value={form.extra} onChange={(event) => set("extra", event.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Minimum nights"><input type="number" min={1} max={60} value={form.min} onChange={(event) => set("min", event.target.value)} placeholder="1" /></Field>
          <Field label="Maximum nights"><input type="number" min={1} max={90} value={form.max} onChange={(event) => set("max", event.target.value)} placeholder="30" /></Field>
          <Field label="Deposit (%)" hint="Empty: your usual deposit."><input type="number" min={0} max={100} value={form.deposit} disabled={form.depositFixed.trim() !== ""} onChange={(event) => set("deposit", event.target.value)} /></Field>
          <Field label="Or a fixed deposit" hint="Per booking, instead of a percentage."><input inputMode="decimal" value={form.depositFixed} disabled={form.deposit.trim() !== ""} onChange={(event) => set("depositFixed", event.target.value)} /></Field>
        </div>

        <h3>Seasons</h3>
        <p className="muted small">Dates as month-day, like 12-15 to 01-05 (it may cross the new year). The first season listed that covers a night prices it.</p>
        {seasons.map((season, index) => (
          <div key={index} className="form-row repeat">
            <Field label="Name"><input required maxLength={40} value={season.name} onChange={(event) => setSeasons(seasons.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)))} placeholder="High season" /></Field>
            <Field label="From"><input required pattern="\d{2}-\d{2}" value={season.from} onChange={(event) => setSeasons(seasons.map((entry, i) => (i === index ? { ...entry, from: event.target.value } : entry)))} placeholder="12-15" /></Field>
            <Field label="To"><input required pattern="\d{2}-\d{2}" value={season.to} onChange={(event) => setSeasons(seasons.map((entry, i) => (i === index ? { ...entry, to: event.target.value } : entry)))} placeholder="01-05" /></Field>
            <Field label={`A night (${props.unit})`}><input required inputMode="decimal" value={season.nightly} onChange={(event) => setSeasons(seasons.map((entry, i) => (i === index ? { ...entry, nightly: event.target.value } : entry)))} /></Field>
            <Field label="Min. nights"><input type="number" min={1} value={season.min} onChange={(event) => setSeasons(seasons.map((entry, i) => (i === index ? { ...entry, min: event.target.value } : entry)))} /></Field>
            <Button small kind="ghost" onClick={() => setSeasons(seasons.filter((_, i) => i !== index))}>Remove</Button>
          </div>
        ))}
        <Button small onClick={() => setSeasons([...seasons, { name: "", from: "", to: "", nightly: "", extra: "", min: "" }])}><Icon name="plus" /> Add a season</Button>

        <h3>Fees</h3>
        {fees.map((fee, index) => (
          <div key={index} className="form-row repeat">
            <Field label="Name"><input required maxLength={60} value={fee.name} onChange={(event) => setFees(fees.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)))} placeholder="Conservancy fee" /></Field>
            <Field label={`Amount (${props.unit})`}><input required inputMode="decimal" value={fee.amount} onChange={(event) => setFees(fees.map((entry, i) => (i === index ? { ...entry, amount: event.target.value } : entry)))} /></Field>
            <Field label="Charged"><select value={fee.per} onChange={(event) => setFees(fees.map((entry, i) => (i === index ? { ...entry, per: event.target.value as FeeBasis } : entry)))}>{Object.entries(FEE_BASES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Button small kind="ghost" onClick={() => setFees(fees.filter((_, i) => i !== index))}>Remove</Button>
          </div>
        ))}
        <Button small onClick={() => setFees([...fees, { name: "", amount: "", per: "booking" }])}><Icon name="plus" /> Add a fee</Button>

        {room ? <TryQuote businessId={props.businessId} room={room} /> : <p className="muted small">Save the room type to try a quote.</p>}
        <Message message={action.message} />
        <div className="actions">
          {room ? <RemoveRoom businessId={props.businessId} room={room} onDone={props.onSaved} /> : null}
          <Button onClick={props.onClose}>Cancel</Button>
          <Button kind="primary" type="submit" busy={action.busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveRoom(props: { businessId: string; room: Offering; onDone: () => void }) {
  const action = useAction();
  const [sure, setSure] = useState(false);
  return sure ? (
    <Button kind="danger" busy={action.busy} onClick={() => void action.run(async () => {
      await api("DELETE", businessPath(props.businessId, `/offerings/${props.room.id}`));
      props.onDone();
    })}>Yes, remove it</Button>
  ) : <Button kind="ghost" onClick={() => setSure(true)}>Remove…</Button>;
}

function TryQuote(props: { businessId: string; room: Offering }) {
  const [stay, setStay] = useState({ check_in: "", check_out: "", guests: String(Math.min(2, props.room.max_guests)) });
  const [result, setResult] = useState<{ quote: Quote; rooms_free: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setResult(null);
    setError(null);
    if (!stay.check_in || !stay.check_out || stay.check_out <= stay.check_in) return;
    const timer = setTimeout(() => {
      api<{ quote: Quote; rooms_free: number }>("POST", businessPath(props.businessId, "/quote"), { offering_id: props.room.id, ...stay, guests: Number(stay.guests), rooms: 1 })
        .then(setResult)
        .catch((problem) => setError(problem.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [props.businessId, props.room.id, stay.check_in, stay.check_out, stay.guests]);
  return (
    <div className="card quote-try">
      <h3>Try a quote (saved prices)</h3>
      <div className="form-row">
        <Field label="Check-in"><input type="date" value={stay.check_in} onChange={(event) => setStay({ ...stay, check_in: event.target.value })} /></Field>
        <Field label="Check-out"><input type="date" value={stay.check_out} min={stay.check_in} onChange={(event) => setStay({ ...stay, check_out: event.target.value })} /></Field>
        <Field label="Guests"><input type="number" min={1} value={stay.guests} onChange={(event) => setStay({ ...stay, guests: event.target.value })} /></Field>
      </div>
      {error ? <p className="message error">{error}</p> : null}
      {result ? (
        <table className="lines">
          <tbody>
            {result.quote.lines.map((line, index) => <tr key={index} className={line.included ? "sub" : undefined}><th scope="row">{line.label}</th><td>{line.display}</td></tr>)}
            <tr className="total"><th scope="row">Total</th><td>{result.quote.total_display}</td></tr>
            <tr className="sub"><th scope="row">Deposit{typeof result.quote.deposit_percent === "number" && result.quote.deposit_rule !== "fixed" ? ` (${result.quote.deposit_percent}%)` : ""}</th><td>{result.quote.deposit_display}</td></tr>
            <tr className="sub"><th scope="row">Rooms free</th><td>{result.rooms_free}</td></tr>
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

const CSV_EXAMPLE = `name,units,max_guests,nightly,weekend_nightly,min_nights,booking_mode,description
Garden double,4,2,6500,7500,2,instant,"Queen bed, garden view"
Family cottage,1,5,15000,,,request,Two bedrooms and a kitchen`;

function ImportRooms(props: { businessId: string; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const action = useAction();
  return (
    <Modal title="Import room types" onClose={props.onClose}>
      <p>Paste a spreadsheet saved as CSV: one room type per row. Amounts are in shillings (or dollars). A row with the name of an existing room type updates it.</p>
      <pre className="snippet">{CSV_EXAMPLE}</pre>
      <p className="muted small">Columns: name, units, max_guests and nightly are required; weekend_nightly, included_guests, extra_guest_nightly, min_nights, booking_mode (instant, request or enquiry) and description are optional.</p>
      <Field label="Your CSV" wide><textarea rows={8} value={csv} onChange={(event) => setCsv(event.target.value)} spellCheck={false} /></Field>
      <Message message={action.message} />
      <div className="actions">
        <Button onClick={props.onClose}>Cancel</Button>
        <Button kind="primary" busy={action.busy} disabled={!csv.trim()} onClick={() => void action.run(async () => {
          await api("POST", businessPath(props.businessId, "/offerings/import"), { csv });
          props.onDone();
        })}>Import</Button>
      </div>
    </Modal>
  );
}

function ClosedDates(props: { businessId: string; rooms: Offering[]; manager: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const loaded = useLoad(() => api<{ blocks: Block[] }>("GET", businessPath(props.businessId, `/blocks?from=${today}&days=62`)), [props.businessId]);
  const [form, setForm] = useState({ offering_id: "", starts_on: today, ends_on: "", units: "", reason: "" });
  const action = useAction();
  useEffect(() => {
    if (!form.offering_id && props.rooms[0]) setForm((current) => ({ ...current, offering_id: props.rooms[0].id }));
  }, [props.rooms, form.offering_id]);
  const name = (id: string) => props.rooms.find((room) => room.id === id)?.name ?? "Room";
  return (
    <section className="card">
      <h2>Closed dates</h2>
      <p className="muted small">Rooms closed for repairs, or sold somewhere else. Closed rooms can't be booked here.</p>
      {loaded.data?.blocks.length ? (
        <ul className="plain-list">
          {loaded.data.blocks.map((block) => (
            <li key={block.id}>
              <span><strong>{name(block.offering_id)}</strong> · {block.units} room{block.units === 1 ? "" : "s"} · {day(block.starts_on)} to {day(block.ends_on)} (open again){block.reason ? ` · ${block.reason}` : ""}</span>
              {props.manager ? <Button small kind="ghost" onClick={() => void action.run(async () => {
                await api("DELETE", businessPath(props.businessId, `/blocks/${block.id}`));
                await loaded.reload();
              })}>Reopen</Button> : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted">No closed dates in the next two months.</p>}
      {props.manager && props.rooms.length ? (
        <form
          className="form-row"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => {
              await api("POST", businessPath(props.businessId, "/blocks"), { ...form, units: form.units ? Number(form.units) : undefined, reason: form.reason || undefined });
              setForm({ ...form, ends_on: "", reason: "" });
              await loaded.reload();
            }, "Closed.");
          }}
        >
          <Field label="Room type"><select value={form.offering_id} onChange={(event) => setForm({ ...form, offering_id: event.target.value })}>{props.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></Field>
          <Field label="First night closed"><input type="date" required value={form.starts_on} onChange={(event) => setForm({ ...form, starts_on: event.target.value })} /></Field>
          <Field label="Open again on"><input type="date" required min={form.starts_on} value={form.ends_on} onChange={(event) => setForm({ ...form, ends_on: event.target.value })} /></Field>
          <Field label="Rooms" hint="Empty: all of them."><input type="number" min={1} value={form.units} onChange={(event) => setForm({ ...form, units: event.target.value })} /></Field>
          <Field label="Why"><input maxLength={200} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Painting" /></Field>
          <Button type="submit" busy={action.busy}>Close dates</Button>
        </form>
      ) : null}
      <Message message={action.message} />
    </section>
  );
}
