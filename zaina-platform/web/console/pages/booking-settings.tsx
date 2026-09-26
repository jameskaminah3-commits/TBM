// zaina-platform/web/console/pages/booking-settings.tsx
//
// Settings → Bookings & payments: the business's own deposit, ways to pay,
// holds and limits (Zaina follows them; the platform only keeps each within
// safe bounds), its booking policy (currency, check-in and check-out, tax,
// cancellation) and the payment accounts deposits go into: the business's
// own Paystack account (or its subaccount of the platform's), M-Pesa Express
// on its own paybill or till, or a paybill or till the guest pays by hand.
// Payment accounts are connected by an owner; keys are checked with
// Paystack or Safaricom, then kept encrypted and never shown again.

import { useEffect, useState } from "react";
import { api, businessPath } from "../api.ts";
import { atLeast, type BookingSettingsView, type DepositType, type PaymentWay, type Role } from "../types.ts";
import { Button, ErrorLine, Field, Message, Toggle, useAction, useLoad } from "../ui.tsx";

export function BookingSettings(props: { businessId: string; role: Role }) {
  const loaded = useLoad(() => api<BookingSettingsView>("GET", businessPath(props.businessId, "/booking-settings")), [props.businessId]);
  const [settings, setSettings] = useState<BookingSettingsView | null>(null);
  useEffect(() => setSettings(loaded.data), [loaded.data]);
  if (!settings) return <ErrorLine error={loaded.error} />;
  const owner = atLeast(props.role, "owner");
  return (
    <div className="stack">
      <Deposit key={`deposit-${settings.deposit_type}`} businessId={props.businessId} settings={settings} onSaved={setSettings} />
      <Policy businessId={props.businessId} settings={settings} onSaved={setSettings} />
      <h2>Where deposits are paid</h2>
      {!settings.payments.takes_deposits ? (
        <p className="message error">No payment account is connected, so bookings with a deposit become requests the team handles. Connect at least one below.</p>
      ) : null}
      {!owner ? <p className="muted">Only an owner can connect or change payment accounts.</p> : null}
      <Paystack businessId={props.businessId} settings={settings} owner={owner} onSaved={setSettings} />
      <MpesaExpress businessId={props.businessId} settings={settings} owner={owner} onSaved={setSettings} />
      <MpesaManual businessId={props.businessId} settings={settings} owner={owner} onSaved={setSettings} />
      <WaysToPay businessId={props.businessId} settings={settings} onSaved={setSettings} />
      <Limits businessId={props.businessId} settings={settings} onSaved={setSettings} />
    </div>
  );
}

// Forms hold major units (KSh 2,000); the API holds minor units (200000).
const major = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : String(minor / 100));
const minor = (value: string) => Math.round(Number(value.replace(/,/g, "")) * 100);

const WAY_LABELS: Record<PaymentWay, string> = {
  paystack: "Card and M-Pesa through Paystack",
  mpesa_express: "M-Pesa prompt on the phone",
  mpesa_manual: "M-Pesa paid by hand (code checked)",
  pay_at_venue: "Pay at the venue",
};

type LimitField = keyof BookingSettingsView["bounds"];

const LIMITS: Array<{ field: LimitField; label: string; hint: string }> = [
  { field: "hold_minutes", label: "Held for the deposit (minutes)", hint: "An unpaid booking keeps its place this long." },
  { field: "payment_hold_minutes", label: "Held while paying (minutes)", hint: "Starting to pay keeps the place at least this long." },
  { field: "request_hold_hours", label: "Requests held (hours)", hint: "While the team decides. 0: they aren't." },
  { field: "accepted_hold_hours", label: "Accepted requests held (hours)", hint: "For the customer to pay the deposit." },
  { field: "code_check_hours", label: "Time to check an M-Pesa code (hours)", hint: "The place stays held while the team checks." },
  { field: "min_notice_hours", label: "Notice for online bookings (hours)", hint: "0: customers can book for today." },
  { field: "booking_horizon_days", label: "Book up to (days ahead)", hint: "How far ahead customers can book." },
  { field: "max_nights", label: "Longest stay (nights)", hint: "Unless a room type says otherwise." },
  { field: "pay_attempts_limit", label: "Payment tries per booking (per 10 minutes)", hint: "Stops a link being misused." },
  { field: "mpesa_prompts_limit", label: "M-Pesa prompts per booking (per 10 minutes)", hint: "So a phone isn't flooded with prompts." },
];

function Policy(props: { businessId: string; settings: BookingSettingsView; onSaved: (settings: BookingSettingsView) => void }) {
  const initial = props.settings;
  const [form, setForm] = useState({
    currency: initial.currency,
    check_in_time: initial.check_in_time,
    check_out_time: initial.check_out_time,
    cancellation_policy: initial.cancellation_policy ?? "",
    tax_name: initial.tax_name ?? "",
    tax_percent: initial.tax_percent === null ? "" : String(initial.tax_percent),
    tax_included: initial.tax_included,
    pay_at_venue: initial.pay_at_venue,
  });
  const action = useAction();
  const set = (key: keyof typeof form, value: string | boolean) => setForm({ ...form, [key]: value });
  return (
    <form
      className="form card"
      onSubmit={async (event) => {
        event.preventDefault();
        await action.run(async () => {
          props.onSaved(await api<BookingSettingsView>("PATCH", businessPath(props.businessId, "/booking-settings"), {
            currency: form.currency,
            check_in_time: form.check_in_time,
            check_out_time: form.check_out_time,
            cancellation_policy: form.cancellation_policy.trim() || null,
            tax_name: form.tax_name.trim() || null,
            tax_percent: form.tax_name.trim() && form.tax_percent ? Number(form.tax_percent) : null,
            tax_included: form.tax_included,
            pay_at_venue: form.pay_at_venue,
          }));
        }, "Saved. New quotes use it straight away.");
      }}
    >
      <h2>Booking policy</h2>
      <div className="form-row">
        <Field label="Prices in"><select value={form.currency} onChange={(event) => set("currency", event.target.value)}><option value="KES">Kenyan shillings</option><option value="USD">US dollars</option></select></Field>
        <Field label="Check-in from"><input type="time" required value={form.check_in_time} onChange={(event) => set("check_in_time", event.target.value)} /></Field>
        <Field label="Check-out by"><input type="time" required value={form.check_out_time} onChange={(event) => set("check_out_time", event.target.value)} /></Field>
      </div>
      <div className="form-row">
        <Field label="Tax name" hint="Like VAT. Empty: no tax shown."><input maxLength={40} value={form.tax_name} onChange={(event) => set("tax_name", event.target.value)} /></Field>
        <Field label="Tax (%)"><input type="number" min={0} max={50} step="0.01" value={form.tax_percent} onChange={(event) => set("tax_percent", event.target.value)} /></Field>
      </div>
      <Toggle checked={form.tax_included} onChange={(value) => set("tax_included", value)} label="Prices already include the tax" />
      <Toggle checked={form.pay_at_venue} onChange={(value) => set("pay_at_venue", value)} label="Customers may pay the balance at the venue" />
      <Field label="Cancellation policy" hint="Zaina and the payment page tell customers this, word for word." wide>
        <textarea rows={3} maxLength={2000} value={form.cancellation_policy} onChange={(event) => set("cancellation_policy", event.target.value)} />
      </Field>
      <Message message={action.message} />
      <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
    </form>
  );
}

/** The business's deposit: its own choice, which Zaina only follows. */
function Deposit(props: { businessId: string; settings: BookingSettingsView; onSaved: (settings: BookingSettingsView) => void }) {
  const initial = props.settings;
  const [type, setType] = useState<Exclude<DepositType, "not_set"> | "">(initial.deposit_type === "not_set" ? "" : initial.deposit_type);
  const [percent, setPercent] = useState(initial.deposit_type === "percent" ? String(initial.deposit_percent) : "");
  const [fixed, setFixed] = useState(major(initial.deposit_fixed_minor));
  const action = useAction();
  const currency = initial.currency === "KES" ? "KSh" : "US$";
  return (
    <form
      className="form card"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!type) return;
        await action.run(async () => {
          props.onSaved(await api<BookingSettingsView>("PATCH", businessPath(props.businessId, "/booking-settings"), {
            deposit_type: type,
            ...(type === "percent" ? { deposit_percent: Number(percent) } : {}),
            ...(type === "fixed" ? { deposit_fixed_minor: minor(fixed) } : {}),
          }));
        }, "Saved. New bookings use it straight away.");
      }}
    >
      <h2>Deposit</h2>
      {initial.deposit_type === "not_set" ? (
        <p className="message error">You haven't chosen a deposit yet, so nothing is charged online: bookings from the chat come in as requests for your team. Choose how you take deposits below.</p>
      ) : (
        <p className="muted">Now: {initial.deposit_text}. Zaina and the payment page follow this; a room type or service can have its own.</p>
      )}
      <div className="form-row">
        <Field label="How you take deposits">
          <select required value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            <option value="" disabled>Choose…</option>
            <option value="none">No deposit: paid at the venue</option>
            <option value="percent">A percentage of the total</option>
            <option value="fixed">A fixed amount per booking</option>
            <option value="full">The whole amount up front</option>
          </select>
        </Field>
        {type === "percent" ? <Field label="Deposit (%)" hint="1 to 99."><input type="number" min={1} max={99} required value={percent} onChange={(event) => setPercent(event.target.value)} /></Field> : null}
        {type === "fixed" ? <Field label={`Deposit (${currency})`} hint="Never more than the booking's total."><input inputMode="decimal" required value={fixed} onChange={(event) => setFixed(event.target.value)} /></Field> : null}
      </div>
      <Message message={action.message} />
      <div className="actions"><Button kind="primary" type="submit" busy={action.busy} disabled={!type}>Save deposit</Button></div>
    </form>
  );
}

/** The ways to pay the business offers, in its order, and its limit on each. */
function WaysToPay(props: { businessId: string; settings: BookingSettingsView; onSaved: (settings: BookingSettingsView) => void }) {
  const initial = props.settings;
  const [order, setOrder] = useState<PaymentWay[]>(initial.payment_order);
  const [limits, setLimits] = useState<Record<string, string>>(Object.fromEntries(Object.entries(initial.method_max_minor).map(([way, value]) => [way, major(value)])));
  const action = useAction();
  const connected: Record<PaymentWay, boolean> = {
    paystack: initial.payments.paystack.mode !== "off",
    mpesa_express: initial.payments.mpesa_express.on,
    mpesa_manual: initial.payments.mpesa_manual !== null,
    pay_at_venue: initial.pay_at_venue,
  };
  const move = (index: number, by: number) => {
    const next = [...order];
    const [way] = next.splice(index, 1);
    next.splice(index + by, 0, way);
    setOrder(next);
  };
  const currency = initial.currency === "KES" ? "KSh" : "US$";
  return (
    <form
      className="form card"
      onSubmit={async (event) => {
        event.preventDefault();
        await action.run(async () => {
          props.onSaved(await api<BookingSettingsView>("PATCH", businessPath(props.businessId, "/booking-settings"), {
            payment_order: order,
            method_max_minor: Object.fromEntries(Object.entries(limits).filter(([, value]) => value.trim()).map(([way, value]) => [way, minor(value)])),
          }));
        }, "Saved.");
      }}
    >
      <h2>Ways to pay</h2>
      <p className="muted">The payment page offers them in this order. A limit hides that way for bigger amounts (M-Pesa's own limits still apply).</p>
      <ol className="ways">
        {order.map((way, index) => (
          <li key={way} className="way">
            <span className="way-name">{WAY_LABELS[way]}{connected[way] ? "" : <span className="muted"> (not set up)</span>}</span>
            {way !== "pay_at_venue" ? (
              <input aria-label={`Most for one payment by ${WAY_LABELS[way]} (${currency})`} placeholder={`No limit (${currency})`} inputMode="decimal" value={limits[way] ?? ""} onChange={(event) => setLimits({ ...limits, [way]: event.target.value })} />
            ) : <span />}
            <span className="way-move">
              <Button kind="ghost" disabled={index === 0} onClick={() => move(index, -1)}>Up</Button>
              <Button kind="ghost" disabled={index === order.length - 1} onClick={() => move(index, 1)}>Down</Button>
            </span>
          </li>
        ))}
      </ol>
      <Message message={action.message} />
      <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
    </form>
  );
}

/** Holds and limits: the business's own, within the platform's safe bounds. */
function Limits(props: { businessId: string; settings: BookingSettingsView; onSaved: (settings: BookingSettingsView) => void }) {
  const initial = props.settings;
  const [form, setForm] = useState<Record<LimitField, string>>(Object.fromEntries(LIMITS.map(({ field }) => [field, String(initial[field])])) as Record<LimitField, string>);
  const action = useAction();
  return (
    <form
      className="form card"
      onSubmit={async (event) => {
        event.preventDefault();
        await action.run(async () => {
          props.onSaved(await api<BookingSettingsView>("PATCH", businessPath(props.businessId, "/booking-settings"), Object.fromEntries(LIMITS.map(({ field }) => [field, Number(form[field])]))));
        }, "Saved.");
      }}
    >
      <h2>Holds and limits</h2>
      <p className="muted">Your choice; the values here to start with are only suggestions.</p>
      <div className="form-grid">
        {LIMITS.map(({ field, label, hint }) => {
          const [min, max] = initial.bounds[field];
          return (
            <Field key={field} label={label} hint={`${hint} ${min} to ${max}.`}>
              <input type="number" min={min} max={max} required value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />
            </Field>
          );
        })}
      </div>
      <Message message={action.message} />
      <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
    </form>
  );
}

function Paystack(props: { businessId: string; settings: BookingSettingsView; owner: boolean; onSaved: (settings: BookingSettingsView) => void }) {
  const paystack = props.settings.payments.paystack;
  const [mode, setMode] = useState<"own_keys" | "subaccount">(paystack.mode === "subaccount" ? "subaccount" : "own_keys");
  const [key, setKey] = useState("");
  const [subaccount, setSubaccount] = useState(paystack.subaccount ?? "");
  const action = useAction();
  const connected = paystack.mode !== "off";
  return (
    <section className="card">
      <h3>Card and M-Pesa through Paystack</h3>
      <p>
        {paystack.mode === "own_keys" ? "Connected to your own Paystack account." : paystack.mode === "subaccount" ? `Connected as subaccount ${paystack.subaccount} of the platform's Paystack account.` : "Not connected."}
        {" "}Guests pay on Paystack's secure page, by card or M-Pesa; the money goes to your Paystack account.
      </p>
      {paystack.mode === "own_keys" ? (
        <p className="small">In your Paystack dashboard (Settings → API Keys &amp; Webhooks), set the webhook URL to <code>{props.settings.webhooks.paystack}</code>, so payments confirm bookings the moment they arrive.</p>
      ) : null}
      {props.owner ? (
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => {
              props.onSaved(await api<BookingSettingsView>("PUT", businessPath(props.businessId, "/payments/paystack"), mode === "own_keys" ? { mode, secret_key: key.trim() } : { mode, subaccount: subaccount.trim() }));
              setKey("");
            }, "Connected. Paystack accepted it.");
          }}
        >
          {props.settings.platform_paystack ? (
            <div className="form-row">
              <Field label="Account"><select value={mode} onChange={(event) => setMode(event.target.value as "own_keys" | "subaccount")}><option value="own_keys">Your own Paystack account</option><option value="subaccount">A subaccount of the platform's account</option></select></Field>
            </div>
          ) : null}
          {mode === "own_keys" ? (
            <Field label="Secret key" hint="From Paystack: Settings → API Keys & Webhooks. It starts with sk_live_ (or sk_test_ for trying out)."><input type="password" autoComplete="off" required value={key} onChange={(event) => setKey(event.target.value)} placeholder={paystack.key_saved ? "Saved: type a new one to replace it" : "sk_live_…"} /></Field>
          ) : (
            <Field label="Subaccount code" hint="Given by the platform team, like ACCT_xxxxxxxx."><input required value={subaccount} onChange={(event) => setSubaccount(event.target.value)} /></Field>
          )}
          <Message message={action.message} />
          <div className="actions">
            {connected ? <Button kind="ghost" busy={action.busy} onClick={() => void action.run(async () => props.onSaved(await api<BookingSettingsView>("DELETE", businessPath(props.businessId, "/payments/paystack"))), "Disconnected.")}>Disconnect</Button> : null}
            <Button kind="primary" type="submit" busy={action.busy}>{connected ? "Update" : "Connect"}</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function MpesaExpress(props: { businessId: string; settings: BookingSettingsView; owner: boolean; onSaved: (settings: BookingSettingsView) => void }) {
  const mpesa = props.settings.payments.mpesa_express;
  const [form, setForm] = useState({
    environment: mpesa.environment,
    type: mpesa.type ?? "paybill",
    shortcode: mpesa.shortcode ?? "",
    till: mpesa.till ?? "",
    consumer_key: "",
    consumer_secret: "",
    passkey: "",
  });
  const action = useAction();
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  return (
    <section className="card">
      <h3>M-Pesa Express (a payment prompt on the guest's phone)</h3>
      <p>
        {mpesa.on ? `Connected: ${mpesa.type === "till" ? `till ${mpesa.till} (store ${mpesa.shortcode})` : `paybill ${mpesa.shortcode}`}${mpesa.environment === "sandbox" ? ", in Safaricom's sandbox" : ""}.` : "Not connected."}
        {" "}The guest enters their M-Pesa PIN; the money goes straight to your paybill or till, and the booking confirms by itself.
      </p>
      {props.owner ? (
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => {
              props.onSaved(await api<BookingSettingsView>("PUT", businessPath(props.businessId, "/payments/mpesa-express"), form));
              setForm({ ...form, consumer_key: "", consumer_secret: "", passkey: "" });
            }, "Connected. Safaricom accepted the keys.");
          }}
        >
          <p className="muted small">From Safaricom's Daraja portal (developer.safaricom.co.ke), for your own paybill or till: the app's consumer key and secret, and the Lipa na M-Pesa Online passkey.</p>
          <div className="form-row">
            <Field label="Environment"><select value={form.environment} onChange={(event) => set("environment", event.target.value)}><option value="production">Live</option><option value="sandbox">Sandbox (testing)</option></select></Field>
            <Field label="Type"><select value={form.type} onChange={(event) => set("type", event.target.value)}><option value="paybill">Paybill</option><option value="till">Till (Buy Goods)</option></select></Field>
            <Field label={form.type === "till" ? "Store number" : "Paybill number"}><input required inputMode="numeric" value={form.shortcode} onChange={(event) => set("shortcode", event.target.value)} /></Field>
            {form.type === "till" ? <Field label="Till number"><input required inputMode="numeric" value={form.till} onChange={(event) => set("till", event.target.value)} /></Field> : null}
          </div>
          <div className="form-row">
            <Field label="Consumer key"><input type="password" autoComplete="off" required value={form.consumer_key} onChange={(event) => set("consumer_key", event.target.value)} placeholder={mpesa.keys_saved ? "Saved: type again to replace" : ""} /></Field>
            <Field label="Consumer secret"><input type="password" autoComplete="off" required value={form.consumer_secret} onChange={(event) => set("consumer_secret", event.target.value)} /></Field>
            <Field label="Passkey"><input type="password" autoComplete="off" required value={form.passkey} onChange={(event) => set("passkey", event.target.value)} /></Field>
          </div>
          <Message message={action.message} />
          <div className="actions">
            {mpesa.on ? <Button kind="ghost" busy={action.busy} onClick={() => void action.run(async () => props.onSaved(await api<BookingSettingsView>("DELETE", businessPath(props.businessId, "/payments/mpesa-express"))), "Disconnected.")}>Disconnect</Button> : null}
            <Button kind="primary" type="submit" busy={action.busy}>{mpesa.on ? "Update" : "Connect"}</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function MpesaManual(props: { businessId: string; settings: BookingSettingsView; owner: boolean; onSaved: (settings: BookingSettingsView) => void }) {
  const manual = props.settings.payments.mpesa_manual;
  const [form, setForm] = useState({ type: manual?.type ?? "paybill", number: manual?.number ?? "", account: manual?.account ?? "" });
  const action = useAction();
  return (
    <section className="card">
      <h3>M-Pesa paid by hand (the team checks the code)</h3>
      <p>
        {manual ? `Guests pay ${manual.type === "paybill" ? `paybill ${manual.number}, account ${manual.account ?? "the booking reference"}` : `till ${manual.number}`}.` : "Not set up."}
        {" "}The guest sends the M-Pesa code in the chat or on the payment page; you check it in your M-Pesa statement and confirm it under Bookings → Needs you.
      </p>
      {props.owner ? (
        <form
          className="form-row"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => props.onSaved(await api<BookingSettingsView>("PUT", businessPath(props.businessId, "/payments/mpesa-manual"), { ...form, account: form.account.trim() || null })), "Saved.");
          }}
        >
          <Field label="Type"><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as "paybill" | "till" })}><option value="paybill">Paybill</option><option value="till">Till (Buy Goods)</option></select></Field>
          <Field label="Number"><input required inputMode="numeric" value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} /></Field>
          {form.type === "paybill" ? <Field label="Account number" hint="Empty: the booking's reference."><input maxLength={40} value={form.account} onChange={(event) => setForm({ ...form, account: event.target.value })} /></Field> : null}
          {manual ? <Button kind="ghost" busy={action.busy} onClick={() => void action.run(async () => props.onSaved(await api<BookingSettingsView>("DELETE", businessPath(props.businessId, "/payments/mpesa-manual"))), "Removed.")}>Remove</Button> : null}
          <Button kind="primary" type="submit" busy={action.busy}>Save</Button>
        </form>
      ) : null}
      <Message message={action.message} />
    </section>
  );
}
