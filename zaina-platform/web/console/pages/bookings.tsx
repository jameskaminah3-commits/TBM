// zaina-platform/web/console/pages/bookings.tsx
//
// A business's bookings: what's coming up, requests to answer, unpaid
// holds, anything that needs the team (an M-Pesa code to check, a payment
// whose rooms or time had gone), and a calendar: rooms free per night for a
// place to stay, or the day's schedule for a salon or restaurant. A booking
// opens in a panel with its price, payments and what the team can do next.

import { useEffect, useMemo, useState } from "react";
import { api, businessPath } from "../api.ts";
import { go } from "../app.tsx";
import { clock, day, timeAgo } from "../format.ts";
import { atLeast, type BookingDetail, type BookingRow, type BookingStatus, type CalendarData, type Offering, type Quote, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, Tabs, Toggle, useAction, useEvery, useLoad } from "../ui.tsx";
import { NewSlotBooking, ScheduleView } from "./schedule.tsx";

type Filter = "upcoming" | "requests" | "unpaid" | "attention" | "past" | "cancelled" | "all" | "calendar";

const STATUS: Record<BookingStatus, { label: string; tone: string }> = {
  held: { label: "Awaiting deposit", tone: "waiting" },
  requested: { label: "Request", tone: "waiting" },
  awaiting_payment: { label: "Awaiting deposit", tone: "waiting" },
  confirmed: { label: "Confirmed", tone: "ok" },
  conflict: { label: "Paid late: needs you", tone: "callback" },
  declined: { label: "Declined", tone: "" },
  cancelled: { label: "Cancelled", tone: "" },
  expired: { label: "Hold ended", tone: "" },
};

export function StatusChip(props: { status: BookingStatus }) {
  const status = STATUS[props.status];
  return <span className={`chip ${status.tone}`}>{status.label}</span>;
}

const stay = (row: Pick<BookingRow, "check_in" | "check_out" | "nights" | "starts_at" | "when">) =>
  row.starts_at ? row.when ?? day(row.check_in) : `${day(row.check_in)} → ${day(row.check_out)} · ${row.nights} night${row.nights === 1 ? "" : "s"}`;

const people = (row: Pick<BookingRow, "guests" | "starts_at">) => (row.starts_at ? `${row.guests} ${row.guests === 1 ? "person" : "people"}` : `${row.guests} guest${row.guests === 1 ? "" : "s"}`);

export function BookingsPage(props: { businessId: string; role: Role; bookingId: string | null; businessType: string | null }) {
  const slots = props.businessType === "salon" || props.businessType === "restaurant";
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [creating, setCreating] = useState(false);
  const list = useLoad(
    () => (filter === "calendar" ? Promise.resolve({ bookings: [] as BookingRow[] }) : api<{ bookings: BookingRow[] }>("GET", businessPath(props.businessId, `/bookings?filter=${filter}`))),
    [props.businessId, filter],
  );
  const counts = useLoad(async () => {
    const [requests, attention] = await Promise.all([
      api<{ bookings: BookingRow[] }>("GET", businessPath(props.businessId, "/bookings?filter=requests")),
      api<{ bookings: BookingRow[] }>("GET", businessPath(props.businessId, "/bookings?filter=attention")),
    ]);
    return { requests: requests.bookings.length, attention: attention.bookings.length };
  }, [props.businessId]);
  useEvery(() => {
    void counts.reload();
    if (filter !== "calendar") void list.reload();
  }, 30_000, [filter]);
  const refresh = () => {
    void list.reload();
    void counts.reload();
  };
  const open = (id: string | null) => go({ businessId: props.businessId, page: "bookings", id });

  return (
    <div className="page">
      <div className="page-head row">
        <h1>Bookings</h1>
        {atLeast(props.role, "agent") ? <Button kind="primary" onClick={() => setCreating(true)}><Icon name="plus" /> New booking</Button> : null}
      </div>
      <Tabs
        label="Bookings"
        active={filter}
        onChange={setFilter}
        tabs={[
          { id: "upcoming", label: "Upcoming" },
          { id: "requests", label: "Requests", count: counts.data?.requests },
          { id: "unpaid", label: "Awaiting deposit" },
          { id: "attention", label: "Needs you", count: counts.data?.attention },
          { id: "calendar", label: slots ? "Schedule" : "Calendar" },
          { id: "past", label: "Past" },
          { id: "cancelled", label: "Cancelled" },
          { id: "all", label: "All" },
        ]}
      />
      {filter === "calendar"
        ? slots ? <ScheduleView businessId={props.businessId} onOpen={open} /> : <CalendarView businessId={props.businessId} />
        : <BookingTable loaded={list} onOpen={open} filter={filter} slots={slots} />}
      {props.bookingId ? <BookingPanel businessId={props.businessId} role={props.role} bookingId={props.bookingId} onClose={() => open(null)} onChanged={refresh} /> : null}
      {creating
        ? slots
          ? <NewSlotBooking businessId={props.businessId} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); refresh(); open(id); }} />
          : <NewBooking businessId={props.businessId} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); refresh(); open(id); }} />
        : null}
    </div>
  );
}

const EMPTY_TEXT: Record<Exclude<Filter, "calendar">, string> = {
  upcoming: "No confirmed bookings coming up.",
  requests: "No requests waiting for an answer.",
  unpaid: "No bookings waiting for a deposit.",
  attention: "Nothing needs you: no M-Pesa codes to check, no late payments to sort out.",
  past: "No past bookings yet.",
  cancelled: "Nothing cancelled, declined or lapsed.",
  all: "No bookings yet. They appear here as Zaina and the team make them.",
};

function BookingTable(props: { loaded: ReturnType<typeof useLoad<{ bookings: BookingRow[] }>>; onOpen: (id: string) => void; filter: Exclude<Filter, "calendar">; slots: boolean }) {
  const rows = props.loaded.data?.bookings;
  if (!rows) return <ErrorLine error={props.loaded.error} />;
  if (!rows.length) return <Empty title={EMPTY_TEXT[props.filter]} />;
  return (
    <table className="table bookings-table">
      <thead>
        <tr><th>Booking</th><th>{props.slots ? "Customer" : "Guest"}</th><th>{props.slots ? "When" : "Stay"}</th><th>Status</th><th className="number">Paid / total</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <button type="button" className="link" onClick={() => props.onOpen(row.id)}>{row.reference}</button>
              <div className="muted small">{row.units > 1 ? `${row.units} × ` : ""}{row.room_type}{row.resource_name ? ` · ${row.resource_name}` : ""}</div>
            </td>
            <td>{row.customer.name}<div className="muted small">{people(row)} · {row.source === "chat" ? "via Zaina" : "by the team"}</div></td>
            <td>{stay(row)}</td>
            <td>
              <StatusChip status={row.status} />
              {row.code_to_check ? <span className="chip waiting">M-Pesa code to check</span> : null}
              {row.hold_expires_at && ["held", "awaiting_payment", "requested"].includes(row.status) ? <div className="muted small">held until {clock(row.hold_expires_at)}</div> : null}
            </td>
            <td className="number">{row.paid_display}<div className="muted small">of {row.total_display}</div></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BookingPanel(props: { businessId: string; role: Role; bookingId: string; onClose: () => void; onChanged: () => void }) {
  const loaded = useLoad(() => api<BookingDetail>("GET", businessPath(props.businessId, `/bookings/${props.bookingId}`)), [props.businessId, props.bookingId]);
  const action = useAction();
  const [mode, setMode] = useState<null | "accept" | "decline" | "cancel" | "confirm" | "payment" | "reject">(null);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [receipt, setReceipt] = useState("");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setMode(null);
    setText("");
    setAmount("");
  }, [props.bookingId]);
  const detail = loaded.data;
  if (!detail) return <Modal title="Booking" onClose={props.onClose}><ErrorLine error={loaded.error} /></Modal>;
  const { booking, payments } = detail;
  const agent = atLeast(props.role, "agent");
  const manager = atLeast(props.role, "manager");
  const post = (path: string, body: unknown, success: string) => action.run(async () => {
    const result = await api<BookingDetail>("POST", businessPath(props.businessId, path), body);
    loaded.reload();
    props.onChanged();
    setMode(null);
    setText("");
    setAmount("");
    setReceipt("");
    return result;
  }, success);

  const pendingCodes = payments.filter((payment) => payment.method === "mpesa_code" && payment.status === "pending");
  const waitingForMoney = ["held", "awaiting_payment", "expired"].includes(booking.status);
  return (
    <Modal title={`Booking ${booking.reference}`} onClose={props.onClose}>
      <div className="booking-head">
        <StatusChip status={booking.status} />
        {booking.hold_expires_at && ["held", "awaiting_payment", "requested"].includes(booking.status) ? <span className="muted small">{booking.starts_at ? "Held" : "Rooms held"} until {clock(booking.hold_expires_at)}</span> : null}
      </div>
      {booking.conflict ? <p className="message error">{booking.conflict}</p> : null}
      <dl className="facts">
        <div><dt>{booking.starts_at ? "Customer" : "Guest"}</dt><dd>{booking.customer.name}</dd></div>
        {booking.customer.phone ? <div><dt>Phone</dt><dd>{booking.customer.phone}</dd></div> : null}
        {booking.customer.email ? <div><dt>Email</dt><dd>{booking.customer.email}</dd></div> : null}
        <div><dt>{booking.starts_at ? "Booked" : "Room"}</dt><dd>{booking.units > 1 ? `${booking.units} × ` : ""}{booking.room_type}</dd></div>
        <div><dt>{booking.starts_at ? "When" : "Stay"}</dt><dd>{stay(booking)}{booking.time_range ? ` (${booking.time_range})` : ""}</dd></div>
        {booking.resource_name ? <div><dt>With</dt><dd>{booking.resource_name}</dd></div> : null}
        <div><dt>{booking.starts_at ? "People" : "Guests"}</dt><dd>{booking.guests}</dd></div>
        <div><dt>Made</dt><dd>{timeAgo(booking.created_at)}, {booking.source === "chat" ? "by Zaina" : "by the team"}</dd></div>
      </dl>
      {booking.notes ? <p><strong>Guest's notes:</strong> {booking.notes}</p> : null}
      {booking.session_id ? <p><a href={`#/b/${encodeURIComponent(props.businessId)}/inbox/${booking.session_id}`}>Open the chat</a></p> : null}

      <table className="lines">
        <tbody>
          {booking.quote.lines.map((line, index) => (
            <tr key={index} className={line.included ? "sub" : undefined}><th scope="row">{line.label}</th><td>{line.display}</td></tr>
          ))}
          <tr className="total"><th scope="row">Total</th><td>{booking.total_display}</td></tr>
          <tr className="sub"><th scope="row">Deposit</th><td>{booking.deposit_display}</td></tr>
          <tr className="sub"><th scope="row">Paid</th><td>{booking.paid_display}</td></tr>
          <tr className="sub"><th scope="row">Balance</th><td>{booking.balance_display}</td></tr>
        </tbody>
      </table>

      {payments.length ? (
        <div className="stack-tight">
          <h3>Payments</h3>
          <ul className="plain-list payments">
            {payments.map((payment) => (
              <li key={payment.id}>
                <span className={`chip ${payment.status === "succeeded" ? "ok" : payment.status === "pending" ? "waiting" : ""}`}>{payment.status}</span>
                <span>{payment.amount_display} · {METHODS[payment.method]}{payment.reference ? ` ${payment.reference}` : ""}{payment.receipt && payment.receipt !== payment.reference ? ` · receipt ${payment.receipt}` : ""}</span>
                <span className="muted small">{clock(payment.created_at)}</span>
                {payment.failure ? <span className="muted small">{payment.failure}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {agent && pendingCodes.length ? (
        <div className="card attention">
          {pendingCodes.map((payment) => (
            <div key={payment.id} className="stack-tight">
              <p><strong>M-Pesa code {payment.reference}</strong> for {payment.amount_display}. Check it in your M-Pesa statement.</p>
              {rejecting === payment.id ? (
                <div className="form-row">
                  <Field label="Why (the guest is told)"><input maxLength={200} value={text} onChange={(event) => setText(event.target.value)} placeholder="No payment with this code" /></Field>
                  <Button kind="danger" busy={action.busy} onClick={() => void post(`/payments/${payment.id}/reject`, { reason: text }, "The guest has been told.").then(() => setRejecting(null))}>Reject the code</Button>
                </div>
              ) : (
                <div className="actions start">
                  <Button kind="primary" busy={action.busy} onClick={() => void post(`/payments/${payment.id}/confirm`, {}, "Payment confirmed.")}><Icon name="check" /> It's in: confirm</Button>
                  <Button onClick={() => { setRejecting(payment.id); setText(""); }}>Not found</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="pay-link">
        <input readOnly value={booking.pay_link} aria-label="The guest's booking link" onFocus={(event) => event.currentTarget.select()} />
        <Button small onClick={() => void navigator.clipboard?.writeText(booking.pay_link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy link"}</Button>
      </div>

      {mode === "accept" ? (
        <div className="form card">
          <p>Accept at the quoted {booking.total_display}, or type the price you agreed with the guest.</p>
          <div className="form-row">
            <Field label={`Agreed total (${booking.currency === "KES" ? "KSh" : "$"})`} hint="Leave empty for the quoted price."><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
            <Field label="Note for the guest" hint="Shown next to the agreed price."><input maxLength={200} value={text} onChange={(event) => setText(event.target.value)} /></Field>
          </div>
          <div className="actions"><Button onClick={() => setMode(null)}>Back</Button><Button kind="primary" busy={action.busy} onClick={() => void post(`/bookings/${booking.id}/accept`, { total: amount || null, note: text || null }, "Accepted. The guest has the payment link.")}>Accept</Button></div>
        </div>
      ) : null}
      {mode === "decline" || mode === "cancel" ? (
        <div className="form card">
          <Field label={mode === "decline" ? "Reason (the guest is told)" : "Reason (the guest is told)"}><input maxLength={300} value={text} onChange={(event) => setText(event.target.value)} /></Field>
          {mode === "cancel" && booking.paid_minor > 0 ? <p className="message error">The guest has paid {booking.paid_display}. Refund them from your Paystack dashboard or M-Pesa.</p> : null}
          <div className="actions"><Button onClick={() => setMode(null)}>Back</Button><Button kind="danger" busy={action.busy} onClick={() => void post(`/bookings/${booking.id}/${mode}`, { reason: text || null }, mode === "decline" ? "Declined." : "Cancelled.")}>{mode === "decline" ? "Decline" : "Cancel the booking"}</Button></div>
        </div>
      ) : null}
      {mode === "confirm" ? (
        <div className="form card">
          <p>{booking.status === "conflict" ? "Confirm only once you've made room for this booking." : "Confirm without an online payment: they paid you directly, or pay when they arrive."}</p>
          <Field label="Note (for the team)"><input maxLength={300} value={text} onChange={(event) => setText(event.target.value)} /></Field>
          <div className="actions"><Button onClick={() => setMode(null)}>Back</Button><Button kind="primary" busy={action.busy} onClick={() => void post(`/bookings/${booking.id}/confirm`, { note: text || null, force: booking.status === "conflict" }, "Confirmed. The guest has been told.")}>Confirm</Button></div>
        </div>
      ) : null}
      {mode === "payment" ? (
        <div className="form card">
          <div className="form-row">
            <Field label="How"><select value={method} onChange={(event) => setMethod(event.target.value)}><option value="cash">Cash</option><option value="mpesa_code">M-Pesa</option><option value="bank">Bank transfer</option><option value="other">Other</option></select></Field>
            <Field label={`Amount (${booking.currency === "KES" ? "KSh" : "$"})`}><input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
            <Field label={method === "mpesa_code" ? "M-Pesa code" : "Receipt (optional)"}><input maxLength={40} value={receipt} onChange={(event) => setReceipt(event.target.value)} /></Field>
          </div>
          <div className="actions"><Button onClick={() => setMode(null)}>Back</Button><Button kind="primary" busy={action.busy} onClick={() => void post(`/bookings/${booking.id}/payments`, { method, amount, receipt: receipt || null }, "Payment recorded.")}>Record payment</Button></div>
        </div>
      ) : null}

      <Message message={action.message} />
      {mode === null ? (
        <div className="actions">
          {agent && booking.status === "requested" ? <><Button onClick={() => setMode("decline")}>Decline</Button><Button kind="primary" onClick={() => setMode("accept")}>Accept…</Button></> : null}
          {agent && (waitingForMoney || booking.status === "confirmed") && booking.due_minor > 0 ? <Button onClick={() => { setMode("payment"); setAmount(String(booking.due_minor / 100)); }}>Record a payment</Button> : null}
          {agent && (waitingForMoney || booking.status === "requested") ? <Button onClick={() => setMode("confirm")}>Confirm without payment</Button> : null}
          {manager && booking.status === "conflict" ? <Button kind="primary" onClick={() => setMode("confirm")}>Confirm (room made)</Button> : null}
          {manager && ["held", "requested", "awaiting_payment", "confirmed", "conflict"].includes(booking.status) ? <Button kind="danger" onClick={() => setMode("cancel")}>Cancel booking</Button> : null}
        </div>
      ) : null}
    </Modal>
  );
}

const METHODS: Record<string, string> = { paystack: "Paystack", mpesa_express: "M-Pesa prompt", mpesa_code: "M-Pesa code", cash: "cash", bank: "bank transfer", other: "other" };

function NewBooking(props: { businessId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const rooms = useLoad(() => api<{ offerings: Offering[] }>("GET", businessPath(props.businessId, "/offerings")), [props.businessId]);
  const action = useAction();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ offering_id: "", check_in: today, check_out: "", guests: "2", rooms: "1", customer_name: "", customer_phone: "", customer_email: "", notes: "", confirm_now: false });
  const [quote, setQuote] = useState<{ quote: Quote; rooms_free: number } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const active = useMemo(() => (rooms.data?.offerings ?? []).filter((room) => room.status === "active"), [rooms.data]);
  useEffect(() => {
    if (!form.offering_id && active[0]) setForm((current) => ({ ...current, offering_id: active[0].id }));
  }, [active, form.offering_id]);
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!form.offering_id || !form.check_in || !form.check_out || form.check_out <= form.check_in) return;
    const timer = setTimeout(() => {
      api<{ quote: Quote; rooms_free: number }>("POST", businessPath(props.businessId, "/quote"), { offering_id: form.offering_id, check_in: form.check_in, check_out: form.check_out, guests: Number(form.guests), rooms: Number(form.rooms) })
        .then(setQuote)
        .catch((error) => setQuoteError(error.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [props.businessId, form.offering_id, form.check_in, form.check_out, form.guests, form.rooms]);
  const set = (key: keyof typeof form, value: string | boolean) => setForm({ ...form, [key]: value });
  return (
    <Modal title="New booking" onClose={props.onClose}>
      {!active.length && rooms.data ? <p className="message error">Add a room type first (Rooms).</p> : null}
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            const result = await api<BookingDetail>("POST", businessPath(props.businessId, "/bookings"), {
              ...form, guests: Number(form.guests), rooms: Number(form.rooms),
              customer_phone: form.customer_phone || null, customer_email: form.customer_email || null, notes: form.notes || null,
            });
            props.onCreated(result.booking.id);
          });
        }}
      >
        <div className="form-row">
          <Field label="Room type"><select required value={form.offering_id} onChange={(event) => set("offering_id", event.target.value)}>{active.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></Field>
          <Field label="Rooms"><input type="number" min={1} max={50} required value={form.rooms} onChange={(event) => set("rooms", event.target.value)} /></Field>
          <Field label="Guests"><input type="number" min={1} max={500} required value={form.guests} onChange={(event) => set("guests", event.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Check-in"><input type="date" required value={form.check_in} onChange={(event) => set("check_in", event.target.value)} /></Field>
          <Field label="Check-out"><input type="date" required min={form.check_in} value={form.check_out} onChange={(event) => set("check_out", event.target.value)} /></Field>
        </div>
        {quote ? (
          <p className={quote.rooms_free >= Number(form.rooms) ? "message success" : "message error"}>
            {quote.quote.nights} night{quote.quote.nights === 1 ? "" : "s"}: {quote.quote.total_display} (deposit {quote.quote.deposit_display}). {quote.rooms_free >= Number(form.rooms) ? `${quote.rooms_free} free.` : "Not enough rooms free."}
          </p>
        ) : quoteError ? <p className="message error">{quoteError}</p> : null}
        <div className="form-row">
          <Field label="Guest's name"><input required maxLength={120} value={form.customer_name} onChange={(event) => set("customer_name", event.target.value)} /></Field>
          <Field label="Phone"><input type="tel" maxLength={40} value={form.customer_phone} onChange={(event) => set("customer_phone", event.target.value)} /></Field>
          <Field label="Email"><input type="email" maxLength={200} value={form.customer_email} onChange={(event) => set("customer_email", event.target.value)} /></Field>
        </div>
        <Field label="Notes" wide><textarea rows={2} maxLength={1000} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Field>
        <Toggle checked={form.confirm_now} onChange={(value) => set("confirm_now", value)} label="Confirmed now (paid in person, or paying at the property)" />
        <p className="muted small">{form.confirm_now ? "The booking is confirmed straight away." : "The guest gets a link to pay the deposit; the rooms are held for 24 hours."}</p>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy} disabled={!active.length}>Book</Button></div>
      </form>
    </Modal>
  );
}

function CalendarView(props: { businessId: string }) {
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const loaded = useLoad(() => api<CalendarData>("GET", businessPath(props.businessId, `/calendar?from=${from}&days=14`)), [props.businessId, from]);
  const shift = (days: number) => {
    const date = new Date(`${from}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    setFrom(date.toISOString().slice(0, 10));
  };
  const data = loaded.data;
  return (
    <div className="stack">
      <div className="toolbar">
        <Button small onClick={() => shift(-14)}><Icon name="back" /> Earlier</Button>
        <input type="date" aria-label="From" value={from} onChange={(event) => event.target.value && setFrom(event.target.value)} className="date-pick" />
        <Button small onClick={() => shift(14)}>Later</Button>
      </div>
      {!data ? <ErrorLine error={loaded.error} /> : !data.rooms.length ? <Empty title="No room types yet." /> : (
        <div className="calendar-scroll">
          <table className="calendar">
            <caption className="visually-hidden">Rooms free per night</caption>
            <thead>
              <tr>
                <th scope="col">Room type</th>
                {data.nights.map((night) => <th key={night} scope="col">{day(night)}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rooms.map((room) => (
                <tr key={room.offering_id}>
                  <th scope="row">{room.name}<span className="muted small"> · {room.units}</span></th>
                  {room.nights.map((night) => {
                    const tone = night.free === 0 ? "full" : night.free < room.units ? "some" : "open";
                    const detail = `${night.free} of ${room.units} free: ${night.booked} booked, ${night.held} held, ${night.blocked} closed`;
                    return <td key={night.night} className={`cell ${tone}`} title={detail}><span aria-label={detail}>{night.free}</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Rooms free per night. Hover or tap a night to see booked, held (awaiting a deposit or a decision) and closed rooms.</p>
    </div>
  );
}
