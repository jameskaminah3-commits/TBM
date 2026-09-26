// zaina-platform/web/console/pages/booking-settings.tsx
//
// Settings → Bookings & payments, for a place to stay: the booking policy
// (currency, deposit, how long rooms are held, check-in and check-out, tax,
// cancellation) and the payment accounts deposits go into: the business's
// own Paystack account (or its subaccount of the platform's), M-Pesa Express
// on its own paybill or till, or a paybill or till the guest pays by hand.
// Payment accounts are connected by an owner; keys are checked with
// Paystack or Safaricom, then kept encrypted and never shown again.

import { useEffect, useState } from "react";
import { api, businessPath } from "../api.ts";
import { atLeast, type BookingSettingsView, type Role } from "../types.ts";
import { Button, ErrorLine, Field, Message, Toggle, useAction, useLoad } from "../ui.tsx";

export function BookingSettings(props: { businessId: string; role: Role }) {
  const loaded = useLoad(() => api<BookingSettingsView>("GET", businessPath(props.businessId, "/booking-settings")), [props.businessId]);
  const [settings, setSettings] = useState<BookingSettingsView | null>(null);
  useEffect(() => setSettings(loaded.data), [loaded.data]);
  if (!settings) return <ErrorLine error={loaded.error} />;
  const owner = atLeast(props.role, "owner");
  return (
    <div className="stack">
      <Policy businessId={props.businessId} settings={settings} onSaved={setSettings} />
      <h2>Where deposits are paid</h2>
      {!settings.payments.takes_deposits ? (
        <p className="message error">No payment account is connected, so bookings with a deposit become requests the team handles. Connect at least one below.</p>
      ) : null}
      {!owner ? <p className="muted">Only an owner can connect or change payment accounts.</p> : null}
      <Paystack businessId={props.businessId} settings={settings} owner={owner} onSaved={setSettings} />
      <MpesaExpress businessId={props.businessId} settings={settings} owner={owner} onSaved={setSettings} />
      <MpesaManual businessId={props.businessId} settings={settings} owner={owner} onSaved={setSettings} />
    </div>
  );
}

function Policy(props: { businessId: string; settings: BookingSettingsView; onSaved: (settings: BookingSettingsView) => void }) {
  const initial = props.settings;
  const [form, setForm] = useState({
    currency: initial.currency,
    deposit_percent: String(initial.deposit_percent),
    hold_minutes: String(initial.hold_minutes),
    request_hold_hours: String(initial.request_hold_hours),
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
            deposit_percent: Number(form.deposit_percent),
            hold_minutes: Number(form.hold_minutes),
            request_hold_hours: Number(form.request_hold_hours),
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
        <Field label="Deposit (%)" hint="0: nothing to pay until the guest arrives."><input type="number" min={0} max={100} required value={form.deposit_percent} onChange={(event) => set("deposit_percent", event.target.value)} /></Field>
        <Field label="Rooms held for the deposit (minutes)" hint="After this, unpaid rooms are free again."><input type="number" min={10} max={1440} required value={form.hold_minutes} onChange={(event) => set("hold_minutes", event.target.value)} /></Field>
        <Field label="Requests hold rooms for (hours)" hint="While the team decides. 0: they don't."><input type="number" min={0} max={168} required value={form.request_hold_hours} onChange={(event) => set("request_hold_hours", event.target.value)} /></Field>
      </div>
      <div className="form-row">
        <Field label="Check-in from"><input type="time" required value={form.check_in_time} onChange={(event) => set("check_in_time", event.target.value)} /></Field>
        <Field label="Check-out by"><input type="time" required value={form.check_out_time} onChange={(event) => set("check_out_time", event.target.value)} /></Field>
        <Field label="Tax name" hint="Like VAT. Empty: no tax shown."><input maxLength={40} value={form.tax_name} onChange={(event) => set("tax_name", event.target.value)} /></Field>
        <Field label="Tax (%)"><input type="number" min={0} max={50} step="0.01" value={form.tax_percent} onChange={(event) => set("tax_percent", event.target.value)} /></Field>
      </div>
      <Toggle checked={form.tax_included} onChange={(value) => set("tax_included", value)} label="Prices already include the tax" />
      <Toggle checked={form.pay_at_venue} onChange={(value) => set("pay_at_venue", value)} label="Guests may pay the balance at the property" />
      <Field label="Cancellation policy" hint="Zaina and the payment page tell guests this, word for word." wide>
        <textarea rows={3} maxLength={2000} value={form.cancellation_policy} onChange={(event) => set("cancellation_policy", event.target.value)} />
      </Field>
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
