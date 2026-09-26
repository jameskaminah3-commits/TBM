// zaina-platform/web/console/pages/signup.tsx
//
// Signing up a business (when the platform has opened sign-up): the owner's
// name, email and password, the business's name, kind and website. The
// owner then confirms their email by the link sent to it, and signs in.

import { useState } from "react";
import { api } from "../api.ts";
import { Button, Field, Message, useAction } from "../ui.tsx";

export type SignupConfig = { open: boolean; business_types: Array<{ type: string; label: string }>; terms_url?: string | null; privacy_url?: string | null };

export function SignUp(props: { config: SignupConfig; onBack: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", business_name: "", business_type: "", website: "", accept_terms: false });
  const [sent, setSent] = useState<string | null>(null);
  const action = useAction();
  const set = (key: keyof typeof form, value: string | boolean) => setForm({ ...form, [key]: value });
  if (sent) {
    return (
      <main className="signin">
        <div className="signin-card">
          <div className="brand-mark" aria-hidden="true">Z</div>
          <h1>Check your email</h1>
          <p>{sent}</p>
          <p className="muted small">Open the link in the email we sent to <strong>{form.email}</strong>, then sign in. Nothing there? Check your spam folder.</p>
          <ResendLink email={form.email} />
          <Button onClick={props.onBack}>Back to sign in</Button>
        </div>
      </main>
    );
  }
  return (
    <main className="signin">
      <form
        className="signin-card wide"
        onSubmit={async (event) => {
          event.preventDefault();
          let reply = "";
          const done = await action.run(async () => {
            reply = (await api<{ message: string }>("POST", "/v1/signup", {
              ...form,
              time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Nairobi",
              website: form.website.trim() || null,
            })).message;
          });
          if (done) setSent(reply);
        }}
      >
        <div className="brand-mark" aria-hidden="true">Z</div>
        <h1>Put Zaina to work for your business</h1>
        <p className="muted">Zaina answers your customers on your website and WhatsApp, and takes bookings. Set it up yourself, then go live when you're ready.</p>
        <Field label="Your name"><input autoComplete="name" required maxLength={120} value={form.name} onChange={(event) => set("name", event.target.value)} /></Field>
        <Field label="Your email" hint="We'll send a link to confirm it."><input type="email" autoComplete="email" required maxLength={200} value={form.email} onChange={(event) => set("email", event.target.value)} /></Field>
        <Field label="Password" hint="At least 10 characters, letters with numbers or symbols."><input type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={(event) => set("password", event.target.value)} /></Field>
        <Field label="Your business's name"><input autoComplete="organization" required maxLength={120} value={form.business_name} onChange={(event) => set("business_name", event.target.value)} /></Field>
        <Field label="What kind of business?">
          <select required value={form.business_type} onChange={(event) => set("business_type", event.target.value)}>
            <option value="" disabled>Choose…</option>
            {props.config.business_types.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
          </select>
        </Field>
        <Field label="Your website (optional)" hint="Where the chat will go. You can add it later."><input inputMode="url" maxLength={200} value={form.website} onChange={(event) => set("website", event.target.value)} placeholder="www.example.com" /></Field>
        <label className="check">
          <input type="checkbox" required checked={form.accept_terms} onChange={(event) => set("accept_terms", event.target.checked)} />
          <span>I accept the {props.config.terms_url ? <a href={props.config.terms_url} target="_blank" rel="noopener noreferrer">terms of service</a> : "terms of service"} and {props.config.privacy_url ? <a href={props.config.privacy_url} target="_blank" rel="noopener noreferrer">privacy policy</a> : "privacy policy"}.</span>
        </label>
        <Message message={action.message} />
        <Button kind="primary" type="submit" busy={action.busy}>Sign up</Button>
        <button type="button" className="link" onClick={props.onBack}>I already have an account</button>
      </form>
    </main>
  );
}

/** Asks for a new confirmation link. */
export function ResendLink(props: { email: string }) {
  const action = useAction();
  return (
    <div className="stack-tight">
      <Button small busy={action.busy} onClick={() => void action.run(() => api("POST", "/v1/signup/resend", { email: props.email }), "A new link is on its way, if that email is waiting to be confirmed.")}>Send a new link</Button>
      <Message message={action.message} />
    </div>
  );
}
