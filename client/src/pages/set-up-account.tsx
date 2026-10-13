// Choosing a password from the link TBM emails on approval. The link's token
// travels in the address's # part, so it never reaches server logs or other
// sites, and it's taken out of the address bar once read.
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/lib/queryClient";
import { officialContactLine } from "@shared/provider-applications";

type LinkState = "checking" | "ok" | "expired" | "used" | "invalid";

export default function SetUpAccountPage() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState("");
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [who, setWho] = useState<{ firstName: string | null; email: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renewed, setRenewed] = useState<string | null>(null);

  useEffect(() => {
    const value = window.location.hash.replace(/^#/, "").trim();
    if (value) window.history.replaceState(null, "", window.location.pathname);
    setToken(value);
    if (!value) {
      setLinkState("invalid");
      return;
    }
    (async () => {
      const response = await fetch("/api/auth/account-setup/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: value }) });
      const body = await response.json().catch(() => ({}));
      setLinkState((["ok", "expired", "used"].includes(body.state) ? body.state : "invalid") as LinkState);
      if (body.email) setWho({ firstName: body.firstName ?? null, email: body.email });
    })().catch(() => setLinkState("invalid"));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/account-setup", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 410) setLinkState(/expired/i.test(body.message ?? "") ? "expired" : "used");
        throw new Error(body.message ?? "Couldn't set up your account.");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation(body.role === "provider" ? "/provider/dashboard" : "/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Couldn't set up your account.");
    } finally {
      setBusy(false);
    }
  };

  const renew = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/account-setup/renew", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const body = await response.json().catch(() => ({}));
      setRenewed(body.message ?? "If that link was yours, we've emailed you a new one.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[70vh] bg-[#fbf8f3] px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-md space-y-4">
        <div className="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-[0_40px_90px_-60px_rgba(15,61,58,0.6)] sm:p-8" data-testid="set-up-account">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-teal-700"><LockKeyhole className="h-4 w-4" />Provider Hub</div>
          {linkState === "checking" ? (
            <p className="mt-4 flex items-center gap-2 text-stone-600"><Loader2 className="h-4 w-4 animate-spin" />Checking your link…</p>
          ) : linkState === "ok" ? (
            <form className="mt-3 space-y-4" onSubmit={submit}>
              <h1 className="font-serif text-3xl font-semibold text-stone-950">{who?.firstName ? `Karibu, ${who.firstName}` : "Set up your account"}</h1>
              <p className="text-sm text-stone-600">Choose a password for {who?.email ?? "your account"}. It's yours alone: nobody at TBM knows it.</p>
              <div className="space-y-1.5">
                <Label htmlFor="setup-password">New password</Label>
                <Input id="setup-password" type="password" autoComplete="new-password" className="h-12" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setup-confirm">Type it again</Label>
                <Input id="setup-confirm" type="password" autoComplete="new-password" className="h-12" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              </div>
              {error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800" data-testid="text-setup-error">{error}</p> : null}
              <Button type="submit" className="h-12 w-full rounded-full" disabled={busy} data-testid="button-setup-account">{busy ? "Setting up…" : "Set password and open my Hub"}</Button>
              <p className="text-center text-xs text-stone-500">Or <Link href="/auth?next=%2Fprovider%2Fdashboard" className="underline">continue with Google</Link> if this is a Gmail address.</p>
            </form>
          ) : linkState === "expired" ? (
            <div className="mt-3 space-y-3">
              <h1 className="font-serif text-3xl font-semibold text-stone-950">This link has expired</h1>
              <p className="text-sm text-stone-600">Set-up links work for 72 hours. We can email a new one to the address on your account.</p>
              {renewed ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="text-setup-renewed">{renewed}</p> : (
                <Button className="rounded-full" disabled={busy} onClick={renew} data-testid="button-setup-renew">Email me a new link</Button>
              )}
            </div>
          ) : linkState === "used" ? (
            <div className="mt-3 space-y-3">
              <h1 className="font-serif text-3xl font-semibold text-stone-950">You're already set up</h1>
              <p className="text-sm text-stone-600">This link has been used. Sign in with your password, or with Google if this is a Gmail address.</p>
              <Button asChild className="rounded-full"><Link href="/auth?next=%2Fprovider%2Fdashboard">Sign in</Link></Button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <h1 className="font-serif text-3xl font-semibold text-stone-950">This link isn't valid</h1>
              <p className="text-sm text-stone-600">Open the link from your approval email again, or call or WhatsApp TBM for a new one.</p>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-stone-500">{officialContactLine}</p>
      </div>
    </div>
  );
}
