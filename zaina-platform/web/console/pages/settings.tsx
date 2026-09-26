// zaina-platform/web/console/pages/settings.tsx
//
// How the business shows up and works: its profile (what Zaina says about
// it, how customers reach it), the website widget and the websites it runs
// on, the WhatsApp connection, and the team's hours.

import { useEffect, useState } from "react";
import { api, businessPath } from "../api.ts";
import { WEEKDAYS } from "../format.ts";
import type { Me, Operations, Role, Settings, WhatsappState } from "../types.ts";
import { Button, ErrorLine, Field, Message, Tabs, Toggle, useAction, useLoad } from "../ui.tsx";
import { BookingSettings } from "./booking-settings.tsx";

type Tab = "profile" | "widget" | "whatsapp" | "hours" | "bookings";

export function SettingsPage(props: { businessId: string; role: Role; me: Me; businessType?: string | null }) {
  const [tab, setTab] = useState<Tab>("profile");
  const stays = ["guesthouse", "salon", "restaurant"].includes(props.businessType ?? "");
  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <Tabs
        label="Settings"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "profile", label: "Business" },
          ...(stays ? [{ id: "bookings" as const, label: "Bookings & payments" }] : []),
          { id: "widget", label: "Website widget" },
          { id: "whatsapp", label: "WhatsApp" },
          { id: "hours", label: "Hours" },
        ]}
      />
      {tab === "bookings" && stays ? <BookingSettings businessId={props.businessId} role={props.role} slots={props.businessType !== "guesthouse"} /> : null}
      {tab === "profile" ? <Profile businessId={props.businessId} /> : null}
      {tab === "widget" ? <Widget businessId={props.businessId} role={props.role} me={props.me} /> : null}
      {tab === "whatsapp" ? <Whatsapp businessId={props.businessId} role={props.role} /> : null}
      {tab === "hours" ? <Hours businessId={props.businessId} /> : null}
    </div>
  );
}

function useSettings(businessId: string) {
  return useLoad(() => api<{ settings: Settings }>("GET", businessPath(businessId, "/settings")).then((result) => result.settings), [businessId]);
}

function Profile(props: { businessId: string }) {
  const loaded = useSettings(props.businessId);
  const [form, setForm] = useState<Settings | null>(null);
  const action = useAction();
  useEffect(() => setForm(loaded.data), [loaded.data]);
  if (!form) return <ErrorLine error={loaded.error} />;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm({ ...form, [key]: value });
  return (
    <form
      className="form card"
      onSubmit={async (event) => {
        event.preventDefault();
        await action.run(async () => {
          const result = await api<{ settings: Settings }>("PATCH", businessPath(props.businessId, "/settings"), {
            displayName: form.displayName,
            assistantName: form.assistantName,
            about: form.about,
            contactPhone: form.contactPhone?.trim() || null,
            contactPhoneDisplay: form.contactPhoneDisplay?.trim() || null,
            websiteUrl: form.websiteUrl?.trim() || null,
            supportEmail: form.supportEmail?.trim() || null,
            defaultCurrency: form.defaultCurrency,
            allowedLinkHosts: form.allowedLinkHosts,
          });
          setForm(result.settings);
        }, "Saved. Zaina uses the new details from the next message.");
      }}
    >
      <div className="form-row">
        <Field label="Business name"><input required maxLength={200} value={form.displayName} onChange={(event) => set("displayName", event.target.value)} /></Field>
        <Field label="Assistant's name"><input required maxLength={200} value={form.assistantName} onChange={(event) => set("assistantName", event.target.value)} /></Field>
      </div>
      <Field label="About the business" hint="A short description Zaina always knows: what you offer, where you are. Details belong in Knowledge." wide>
        <textarea rows={5} maxLength={4000} value={form.about} onChange={(event) => set("about", event.target.value)} />
      </Field>
      <div className="form-row">
        <Field label="Phone for customers" hint="International form, e.g. +254718475264. The only number Zaina gives out.">
          <input value={form.contactPhone ?? ""} onChange={(event) => set("contactPhone", event.target.value)} />
        </Field>
        <Field label="Phone, as written" hint="How it's shown, e.g. +254 718 475 264">
          <input value={form.contactPhoneDisplay ?? ""} onChange={(event) => set("contactPhoneDisplay", event.target.value)} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Website"><input type="url" placeholder="https://" value={form.websiteUrl ?? ""} onChange={(event) => set("websiteUrl", event.target.value)} /></Field>
        <Field label="Support email"><input type="email" value={form.supportEmail ?? ""} onChange={(event) => set("supportEmail", event.target.value)} /></Field>
        <Field label="Prices shown in">
          <select value={form.defaultCurrency} onChange={(event) => set("defaultCurrency", event.target.value as "USD" | "KES")}>
            <option value="USD">US dollars</option>
            <option value="KES">Kenyan shillings</option>
          </select>
        </Field>
      </div>
      <Field label="Other websites Zaina may link to" hint="Host names, separated by commas (your own website is always allowed)." wide>
        <input
          value={form.allowedLinkHosts.join(", ")}
          onChange={(event) => set("allowedLinkHosts", event.target.value.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean))}
        />
      </Field>
      <Message message={action.message} />
      <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
    </form>
  );
}

function Widget(props: { businessId: string; role: Role; me: Me }) {
  const loaded = useSettings(props.businessId);
  const operations = useLoad(() => api<Operations>("GET", businessPath(props.businessId, "/operations")), [props.businessId]);
  const [look, setLook] = useState<{ color: string; position: "right" | "left"; greeting: string } | null>(null);
  const [origins, setOrigins] = useState<string>("");
  const lookAction = useAction();
  const originsAction = useAction();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (loaded.data) setLook({ color: loaded.data.widgetColor, position: loaded.data.widgetPosition, greeting: loaded.data.widgetGreeting ?? "" });
  }, [loaded.data]);
  useEffect(() => {
    if (operations.data) setOrigins(operations.data.allowed_origins.join("\n"));
  }, [operations.data]);
  if (!look || !operations.data) return <ErrorLine error={loaded.error ?? operations.error} />;
  const base = props.me.public_base_url ?? location.origin;
  const snippet = `<script src="${base}/widget.js" data-key="${operations.data.public_key}" async></script>`;
  return (
    <div className="stack">
      <section className="card">
        <h2>Add the chat to your website</h2>
        <p className="muted">Paste this just before <code>&lt;/body&gt;</code> on every page where the chat should appear. It only works on the websites listed below.</p>
        <pre className="snippet">{snippet}</pre>
        <Button small onClick={() => void navigator.clipboard.writeText(snippet).then(() => setCopied(true))}>{copied ? "Copied" : "Copy the code"}</Button>
        <p className="muted small">Optional: <code>data-currency="KES"</code> shows prices in shillings; <code>data-open="true"</code> opens the chat on load. If your site has a Content Security Policy, allow <code>{base}</code> in <code>script-src</code> and <code>connect-src</code>.</p>
      </section>
      <form
        className="form card"
        onSubmit={async (event) => {
          event.preventDefault();
          await lookAction.run(() => api("PATCH", businessPath(props.businessId, "/settings"), { widgetColor: look.color, widgetPosition: look.position, widgetGreeting: look.greeting.trim() || null }), "Saved. Visitors see the new look on their next page load.");
        }}
      >
        <h2>Look and greeting</h2>
        <div className="form-row">
          <Field label="Colour"><input type="color" value={look.color} onChange={(event) => setLook({ ...look, color: event.target.value })} /></Field>
          <Field label="Corner">
            <select value={look.position} onChange={(event) => setLook({ ...look, position: event.target.value as "right" | "left" })}>
              <option value="right">Bottom right</option>
              <option value="left">Bottom left</option>
            </select>
          </Field>
          <div className="widget-preview" aria-hidden="true"><span className="preview-launcher" ref={(node) => node?.style.setProperty("--preview", look.color)} /></div>
        </div>
        <Field label="First message" hint={`Shown when a visitor opens the chat. Leave empty for: "Hi! I'm ${loaded.data?.assistantName ?? "Zaina"}, ${loaded.data?.displayName ?? "your"}'s assistant. How can I help?"`} wide>
          <textarea rows={2} maxLength={300} value={look.greeting} onChange={(event) => setLook({ ...look, greeting: event.target.value })} />
        </Field>
        <Message message={lookAction.message} />
        <div className="actions"><Button kind="primary" type="submit" busy={lookAction.busy}>Save</Button></div>
      </form>
      <form
        className="form card"
        onSubmit={async (event) => {
          event.preventDefault();
          await originsAction.run(async () => {
            const list = origins.split(/[\s,]+/).map((origin) => origin.trim()).filter(Boolean);
            const result = await api<Operations>("PATCH", businessPath(props.businessId, "/operations"), { allowed_origins: list });
            setOrigins(result.allowed_origins.join("\n"));
          }, "Saved.");
        }}
      >
        <h2>Websites that may use the chat</h2>
        <Field label="One address per line" hint={props.role === "owner" ? "For example https://www.example.com. Other websites can't open your chat." : "Only an owner can change these."} wide>
          <textarea rows={3} value={origins} readOnly={props.role !== "owner"} onChange={(event) => setOrigins(event.target.value)} />
        </Field>
        <Message message={originsAction.message} />
        {props.role === "owner" ? <div className="actions"><Button kind="primary" type="submit" busy={originsAction.busy}>Save</Button></div> : null}
      </form>
    </div>
  );
}

function Whatsapp(props: { businessId: string; role: Role }) {
  const state = useLoad(() => api<WhatsappState>("GET", businessPath(props.businessId, "/whatsapp")), [props.businessId]);
  const [form, setForm] = useState({ phone_number_id: "", waba_id: "", access_token: "", followup_template: "", followup_template_language: "en", followup_template_parameter: "none" });
  const action = useAction();
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    const connection = state.data?.connection;
    if (connection) {
      setForm({
        phone_number_id: connection.phone_number_id,
        waba_id: connection.waba_id ?? "",
        access_token: "",
        followup_template: connection.followup_template ?? "",
        followup_template_language: connection.followup_template_language,
        followup_template_parameter: connection.followup_template_parameter,
      });
    }
  }, [state.data]);
  if (!state.data) return <ErrorLine error={state.error} />;
  const connection = state.data.connection;
  const owner = props.role === "owner";
  if (!state.data.available) {
    return (
      <section className="card">
        <h2>WhatsApp</h2>
        <p className="muted">WhatsApp isn't switched on for this platform yet. The platform team connects its Meta app first; then you can connect your number here.</p>
      </section>
    );
  }
  return (
    <div className="stack">
      <section className="card">
        <h2>{connection ? "Connected" : "Not connected"}</h2>
        {connection ? (
          <dl className="facts">
            <div><dt>Number</dt><dd>{connection.display_phone_number ?? connection.phone_number_id}</dd></div>
            <div><dt>Name customers see</dt><dd>{connection.verified_name ?? "—"}</dd></div>
            <div><dt>Replies after 24 hours</dt><dd>{connection.followup_template ? `Template "${connection.followup_template}" (${connection.followup_template_language})` : "No follow-up template: replies wait until the customer writes"}</dd></div>
            <div><dt>Access token</dt><dd>{connection.has_token ? "Stored (encrypted)" : "Missing"}</dd></div>
          </dl>
        ) : (
          <p className="muted">Customers who message your WhatsApp number get Zaina's answers there, and your team replies from this console. The number can't be used in the WhatsApp Business phone app at the same time.</p>
        )}
        {state.data.webhook_url ? <p className="muted small">The platform's webhook for Meta: <code>{state.data.webhook_url}</code></p> : null}
      </section>
      {owner ? (
        <form
          className="form card"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => {
              const result = await api<WhatsappState & { warnings: string[] }>("PUT", businessPath(props.businessId, "/whatsapp"), {
                ...form,
                waba_id: form.waba_id.trim() || null,
                access_token: form.access_token.trim() || undefined,
                followup_template: form.followup_template.trim() || null,
              });
              setWarnings(result.warnings ?? []);
              await state.reload();
            }, "Connected. WhatsApp accepted the number and token.");
          }}
        >
          <h2>{connection ? "Update the connection" : "Connect your number"}</h2>
          <p className="muted small">From Meta's WhatsApp Manager (API setup) and Business Settings (a system user's permanent token with WhatsApp messaging and management).</p>
          <div className="form-row">
            <Field label="Phone number ID"><input required inputMode="numeric" value={form.phone_number_id} onChange={(event) => setForm({ ...form, phone_number_id: event.target.value.trim() })} /></Field>
            <Field label="WhatsApp Business Account ID"><input inputMode="numeric" value={form.waba_id} onChange={(event) => setForm({ ...form, waba_id: event.target.value.trim() })} /></Field>
          </div>
          <Field label="Access token" hint={connection?.has_token ? "Leave empty to keep the stored token." : "Stored encrypted; never shown again."} wide>
            <input type="password" autoComplete="off" value={form.access_token} onChange={(event) => setForm({ ...form, access_token: event.target.value })} />
          </Field>
          <h3>When a reply comes after 24 hours</h3>
          <p className="muted small">WhatsApp only allows free replies within 24 hours of the customer's last message. After that, an approved template tells them a reply is waiting; the reply goes out when they answer.</p>
          <div className="form-row">
            <Field label="Template name"><input placeholder="reply_waiting" value={form.followup_template} onChange={(event) => setForm({ ...form, followup_template: event.target.value.trim() })} /></Field>
            <Field label="Language code"><input value={form.followup_template_language} onChange={(event) => setForm({ ...form, followup_template_language: event.target.value.trim() })} /></Field>
            <Field label="Its {{1}} is">
              <select value={form.followup_template_parameter} onChange={(event) => setForm({ ...form, followup_template_parameter: event.target.value })}>
                <option value="none">Nothing (no variable)</option>
                <option value="business_name">The business's name</option>
                <option value="customer_name">The customer's first name</option>
              </select>
            </Field>
          </div>
          <Message message={action.message} />
          {warnings.map((warning) => <p key={warning} className="message error">{warning}</p>)}
          <div className="actions">
            {connection ? (
              <Button kind="danger" onClick={() => {
                if (!window.confirm("Disconnect WhatsApp? Customers' messages stop reaching Zaina and the token is deleted.")) return;
                void action.run(async () => {
                  await api("DELETE", businessPath(props.businessId, "/whatsapp"));
                  await state.reload();
                }, "Disconnected.");
              }}>Disconnect</Button>
            ) : null}
            <Button kind="primary" type="submit" busy={action.busy}>{connection ? "Save" : "Connect"}</Button>
          </div>
        </form>
      ) : (
        <p className="muted">Only an owner can connect or change WhatsApp.</p>
      )}
    </div>
  );
}

const ZONES = ["Africa/Nairobi", "Africa/Dar_es_Salaam", "Africa/Kampala", "Africa/Kigali", "Africa/Addis_Ababa", "Africa/Lagos", "Africa/Johannesburg", "Europe/London", "UTC"];

function Hours(props: { businessId: string }) {
  const operations = useLoad(() => api<Operations>("GET", businessPath(props.businessId, "/operations")), [props.businessId]);
  const [form, setForm] = useState<{ zone: string; always: boolean; days: number[]; open: string; close: string; timeout: number } | null>(null);
  const action = useAction();
  useEffect(() => {
    const data = operations.data;
    if (data) {
      setForm({
        zone: data.time_zone,
        always: data.staffed_hours === null,
        days: data.staffed_hours?.days ?? [1, 2, 3, 4, 5, 6],
        open: data.staffed_hours?.open ?? "08:00",
        close: data.staffed_hours?.close ?? "20:00",
        timeout: data.unclaimed_timeout_minutes,
      });
    }
  }, [operations.data]);
  if (!form) return <ErrorLine error={operations.error} />;
  return (
    <form
      className="form card"
      onSubmit={async (event) => {
        event.preventDefault();
        await action.run(() => api("PATCH", businessPath(props.businessId, "/operations"), {
          time_zone: form.zone,
          staffed_hours: form.always ? null : { days: form.days, open: form.open, close: form.close },
          unclaimed_timeout_minutes: form.timeout,
        }), "Saved.");
      }}
    >
      <p className="muted">When someone asks for a person outside these hours, Zaina tells them when the team is back, asks the team to call them, and keeps helping.</p>
      <Field label="Time zone">
        <select value={form.zone} onChange={(event) => setForm({ ...form, zone: event.target.value })}>
          {[...new Set([form.zone, ...ZONES])].map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
        </select>
      </Field>
      <Toggle checked={form.always} onChange={(value) => setForm({ ...form, always: value })} label="Someone is always available" />
      {!form.always ? (
        <>
          <fieldset className="days">
            <legend>Days</legend>
            {WEEKDAYS.map((name, index) => (
              <label key={name} className="day">
                <input
                  type="checkbox"
                  checked={form.days.includes(index)}
                  onChange={(event) => setForm({ ...form, days: event.target.checked ? [...form.days, index].sort() : form.days.filter((value) => value !== index) })}
                />
                {name}
              </label>
            ))}
          </fieldset>
          <div className="form-row">
            <Field label="From"><input type="time" required value={form.open} onChange={(event) => setForm({ ...form, open: event.target.value })} /></Field>
            <Field label="Until" hint="Earlier than 'From' means past midnight."><input type="time" required value={form.close} onChange={(event) => setForm({ ...form, close: event.target.value })} /></Field>
          </div>
        </>
      ) : null}
      <Field label="Minutes before an unclaimed chat goes back to Zaina" hint="Zaina then tells the customer the team will get back to them, and asks the team for a callback.">
        <input type="number" min={2} max={240} required value={form.timeout} onChange={(event) => setForm({ ...form, timeout: Number(event.target.value) })} />
      </Field>
      <Message message={action.message} />
      <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
    </form>
  );
}
