// zaina-platform/web/console/pages/schedule.tsx
//
// For a salon or restaurant: a day's schedule (each stylist, chair or table
// with its bookings and closures), and booking a time for a customer who
// calls or walks in: choose the service and day, then a free time.

import { useEffect, useMemo, useState } from "react";
import { api, businessPath } from "../api.ts";
import { day } from "../format.ts";
import type { BookingDetail, BookingRow, ScheduleView as Schedule, Service, SlotsView } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, Toggle, useAction, useLoad } from "../ui.tsx";
import { StatusChip } from "./bookings.tsx";

const todayIso = () => new Date().toLocaleDateString("en-CA");

function shiftDay(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function ScheduleView(props: { businessId: string; onOpen: (id: string) => void }) {
  const [date, setDate] = useState(todayIso);
  const loaded = useLoad(() => api<Schedule>("GET", businessPath(props.businessId, `/schedule?date=${date}`)), [props.businessId, date]);
  const data = loaded.data;
  const byResource = useMemo(() => {
    const map = new Map<string | null, BookingRow[]>();
    for (const booking of data?.bookings ?? []) map.set(booking.resource_id, [...(map.get(booking.resource_id) ?? []), booking]);
    return map;
  }, [data]);
  const closedAll = (data?.closures ?? []).filter((closure) => closure.resource_id === null);
  // 24-hour, like the bookings' times.
  const clock = (value: string) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return (
    <div className="stack">
      <div className="toolbar">
        <Button small onClick={() => setDate(shiftDay(date, -1))}><Icon name="back" /> Day before</Button>
        <input type="date" aria-label="Day" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} className="date-pick" />
        <Button small onClick={() => setDate(shiftDay(date, 1))}>Next day</Button>
        {date !== todayIso() ? <Button small kind="ghost" onClick={() => setDate(todayIso())}>Today</Button> : null}
      </div>
      <h2>{day(date)}</h2>
      {closedAll.map((closure) => (
        <p key={closure.id} className="message error">Closed {clock(closure.starts_at)}–{clock(closure.ends_at)}{closure.reason ? `: ${closure.reason}` : ""}{closure.source === "calendar" ? " (from your calendar)" : ""}</p>
      ))}
      {!data ? <ErrorLine error={loaded.error} /> : !data.resources.length ? <Empty title="Add your people, chairs or tables under Services first." /> : (
        <div className="schedule">
          {data.resources.filter((resource) => resource.status === "active" || byResource.has(resource.id)).map((resource) => {
            const bookings = byResource.get(resource.id) ?? [];
            const closures = data.closures.filter((closure) => closure.resource_id === resource.id);
            return (
              <section key={resource.id} className="card schedule-column">
                <h3>{resource.name}{resource.kind === "table" ? <span className="muted small"> · {resource.seats} seats</span> : null}</h3>
                {!bookings.length && !closures.length ? <p className="muted small">Nothing booked.</p> : null}
                <ul className="plain-list schedule-list">
                  {closures.map((closure) => (
                    <li key={closure.id} className="schedule-closed">{clock(closure.starts_at)}–{clock(closure.ends_at)} · {closure.reason || (closure.source === "calendar" ? "Busy (calendar)" : "Closed")}</li>
                  ))}
                  {bookings.map((booking) => (
                    <li key={booking.id}>
                      <button type="button" className="link" onClick={() => props.onOpen(booking.id)}>{booking.time_range}</button>
                      {" "}{booking.room_type} · {booking.customer.name}{booking.guests > 1 ? ` · ${booking.guests}` : ""}
                      <div><StatusChip status={booking.status} /></div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function NewSlotBooking(props: { businessId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const services = useLoad(() => api<{ offerings: Service[] }>("GET", businessPath(props.businessId, "/offerings")), [props.businessId]);
  const active = useMemo(() => (services.data?.offerings ?? []).filter((service) => service.status === "active" && (service.kind === "service" || service.kind === "table")), [services.data]);
  const action = useAction();
  const [form, setForm] = useState({ offering_id: "", date: todayIso(), party: "1", time: "", resource_id: "", customer_name: "", customer_phone: "", customer_email: "", notes: "", confirm_now: false });
  const [slots, setSlots] = useState<SlotsView | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  useEffect(() => {
    if (!form.offering_id && active[0]) setForm((current) => ({ ...current, offering_id: active[0].id, party: String(active[0].min_party) }));
  }, [active, form.offering_id]);
  useEffect(() => {
    setSlots(null);
    setSlotError(null);
    if (!form.offering_id || !form.date) return;
    const timer = setTimeout(() => {
      api<SlotsView>("GET", businessPath(props.businessId, `/slots?offering_id=${form.offering_id}&date=${form.date}&party=${Number(form.party) || 1}`))
        .then(setSlots)
        .catch((error) => setSlotError(error.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [props.businessId, form.offering_id, form.date, form.party]);
  const set = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const chosen = slots?.slots.find((slot) => slot.time === form.time) ?? null;
  const service = active.find((entry) => entry.id === form.offering_id);
  return (
    <Modal title="New booking" onClose={props.onClose}>
      {!active.length && services.data ? <p className="message error">Add a service first (Services).</p> : null}
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            const result = await api<BookingDetail>("POST", businessPath(props.businessId, "/bookings"), {
              offering_id: form.offering_id, date: form.date, time: form.time, party: Number(form.party), resource_id: form.resource_id || null,
              customer_name: form.customer_name, customer_phone: form.customer_phone || null, customer_email: form.customer_email || null, notes: form.notes || null, confirm_now: form.confirm_now,
            });
            props.onCreated(result.booking.id);
          });
        }}
      >
        <div className="form-row">
          <Field label={service?.kind === "table" ? "Booking" : "Service"}>
            <select required value={form.offering_id} onChange={(event) => { set("offering_id", event.target.value); set("time", ""); }}>
              {active.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </Field>
          <Field label="Day"><input type="date" required value={form.date} onChange={(event) => { set("date", event.target.value); set("time", ""); }} /></Field>
          <Field label="People"><input type="number" min={service?.min_party ?? 1} max={service?.max_party ?? 50} required value={form.party} onChange={(event) => { set("party", event.target.value); set("time", ""); }} /></Field>
        </div>
        {slotError ? <p className="message error">{slotError}</p> : null}
        {slots ? (
          slots.slots.length ? (
            <fieldset className="slot-picker">
              <legend>Time</legend>
              <div className="slot-grid">
                {slots.slots.map((slot) => (
                  <button key={slot.time} type="button" className={`slot${form.time === slot.time ? " chosen" : ""}`} aria-pressed={form.time === slot.time} onClick={() => { set("time", slot.time); set("resource_id", ""); }}>{slot.time}</button>
                ))}
              </div>
            </fieldset>
          ) : <p className="message error">No times free that day.</p>
        ) : null}
        {chosen && chosen.free.length > 1 ? (
          <Field label="With">
            <select value={form.resource_id} onChange={(event) => set("resource_id", event.target.value)}>
              <option value="">Anyone free ({chosen.free[0].name} first)</option>
              {chosen.free.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
            </select>
          </Field>
        ) : null}
        <div className="form-row">
          <Field label="Customer's name"><input required maxLength={120} value={form.customer_name} onChange={(event) => set("customer_name", event.target.value)} /></Field>
          <Field label="Phone"><input type="tel" maxLength={40} value={form.customer_phone} onChange={(event) => set("customer_phone", event.target.value)} /></Field>
          <Field label="Email"><input type="email" maxLength={200} value={form.customer_email} onChange={(event) => set("customer_email", event.target.value)} /></Field>
        </div>
        <Field label="Notes" wide><textarea rows={2} maxLength={1000} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Field>
        <Toggle checked={form.confirm_now} onChange={(value) => set("confirm_now", value)} label="Confirmed now (paid in person, or paying when they arrive)" />
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy} disabled={!form.time}>Book</Button></div>
      </form>
    </Modal>
  );
}
