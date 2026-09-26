// zaina-platform/web/console/pages/password.tsx
//
// Choosing a password by email:
//   ForgotPassword    "Forgot your password?": asks for the email; a link
//                     arrives if it has an account (the answer is the same
//                     either way)
//   ChoosePassword    the emailed link opens #/reset/<token>, or
//                     #/welcome/<token> for someone just added to a team;
//                     the token leaves the address as soon as it is read

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Button, Field, Message, useAction, useLoad } from "../ui.tsx";

export function ForgotPassword(props: { email: string; onBack: () => void }) {
  const [email, setEmail] = useState(props.email);
  const [sent, setSent] = useState<string | null>(null);
  const action = useAction();
  return (
    <main className="signin">
      <form
        className="signin-card"
        onSubmit={async (event) => {
          event.preventDefault();
          let reply = "";
          if (await action.run(async () => { reply = (await api<{ message: string }>("POST", "/v1/staff/password/forgot", { email })).message; })) setSent(reply);
        }}
      >
        <div className="brand-mark" aria-hidden="true">Z</div>
        <h1>Forgot your password?</h1>
        {sent ? (
          <>
            <p>{sent}</p>
            <p className="muted small">Nothing there after a few minutes? Check your spam folder, or ask again.</p>
          </>
        ) : (
          <>
            <p className="muted">We'll email you a link to choose a new one.</p>
            <Field label="Email">
              <input type="email" autoComplete="username" required maxLength={200} value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
            <Message message={action.message} />
            <Button kind="primary" type="submit" busy={action.busy}>Email me a link</Button>
          </>
        )}
        <p className="muted small"><button type="button" className="link" onClick={props.onBack}>Back to sign in</button></p>
      </form>
    </main>
  );
}

type LinkAccount = { email: string; name: string; purpose: "reset" | "invite" };

export function ChoosePassword(props: { token: string; welcome: boolean; onDone: (email: string | null, message: string | null) => void }) {
  const [token] = useState(props.token);
  // The link's token isn't left in the address bar or the browser's history.
  useEffect(() => {
    history.replaceState(null, "", `${location.pathname}#/${props.welcome ? "welcome" : "reset"}`);
  }, [props.welcome]);
  const account = useLoad(() => api<LinkAccount>("POST", "/v1/staff/password/check", { token }), [token]);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const action = useAction();
  const welcome = account.data ? account.data.purpose === "invite" : props.welcome;
  return (
    <main className="signin">
      <form
        className="signin-card"
        onSubmit={async (event) => {
          event.preventDefault();
          if (password !== again) {
            action.setMessage({ kind: "error", text: "The two passwords aren't the same." });
            return;
          }
          const done = { email: "", message: "" };
          if (await action.run(async () => Object.assign(done, await api<typeof done>("POST", "/v1/staff/password/reset", { token, password })))) props.onDone(done.email, done.message);
        }}
      >
        <div className="brand-mark" aria-hidden="true">Z</div>
        <h1>{welcome ? "Welcome to Zaina" : "Choose a new password"}</h1>
        {account.data ? (
          <>
            <p className="muted">{welcome ? `Choose a password for ${account.data.email} to sign in.` : `For ${account.data.email}. Every device signed in with the old password is signed out.`}</p>
            <Field label="New password" hint="At least 10 characters, letters with numbers or symbols.">
              <input type="password" autoComplete="new-password" required minLength={10} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <Field label="The same again">
              <input type="password" autoComplete="new-password" required minLength={10} maxLength={200} value={again} onChange={(event) => setAgain(event.target.value)} />
            </Field>
            <Message message={action.message} />
            <Button kind="primary" type="submit" busy={action.busy}>{welcome ? "Set my password" : "Change my password"}</Button>
          </>
        ) : account.error ? (
          <Message message={{ kind: "error", text: account.error }} />
        ) : (
          <p className="muted" aria-busy="true">Checking the link…</p>
        )}
        <p className="muted small"><button type="button" className="link" onClick={() => props.onDone(null, null)}>Back to sign in</button></p>
      </form>
    </main>
  );
}
