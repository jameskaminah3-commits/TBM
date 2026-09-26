// zaina-platform/web/console/app.tsx
//
// The console's frame: sign-in, the business being worked on, navigation by
// role, and the things that run in the background while it's open (the
// waiting count in the tab title, "I'm here" for chat routing).
//
// Pages are chosen by the address's hash: #/b/<business>/<page>/<id>, or
// #/platform for the platform's own admins.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, businessPath } from "./api.ts";
import { BookingsPage } from "./pages/bookings.tsx";
import { InboxPage } from "./pages/inbox.tsx";
import { KnowledgePage } from "./pages/knowledge.tsx";
import { PlatformPage } from "./pages/platform.tsx";
import { ReportsPage } from "./pages/reports.tsx";
import { RoomsPage } from "./pages/rooms.tsx";
import { SettingsPage } from "./pages/settings.tsx";
import { TeamPage } from "./pages/team.tsx";
import { alertsSupported, currentSubscription, turnAlertsOff, turnAlertsOn } from "./push.ts";
import { atLeast, type Me, type Role } from "./types.ts";
import { Button, Field, Icon, Message, Modal, Toggle, useAction, useEvery, useLoad } from "./ui.tsx";

type Route = { businessId: string | null; page: string; id: string | null };

function readRoute(): Route {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "platform") return { businessId: null, page: "platform", id: null };
  if (parts[0] === "b" && parts[1]) return { businessId: parts[1], page: parts[2] ?? "inbox", id: parts[3] ?? null };
  return { businessId: null, page: "inbox", id: null };
}

export function go(route: Partial<Route> & { businessId: string | null }) {
  location.hash = route.businessId
    ? `#/b/${encodeURIComponent(route.businessId)}/${route.page ?? "inbox"}${route.id ? `/${encodeURIComponent(route.id)}` : ""}`
    : "#/platform";
}

function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const route = useRoute();

  const loadMe = useCallback(async () => {
    try {
      setMe(await api<Me>("GET", "/v1/console/me"));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    const signedOut = () => setMe(null);
    window.addEventListener("zaina:signed-out", signedOut);
    return () => window.removeEventListener("zaina:signed-out", signedOut);
  }, [loadMe]);

  if (me === undefined) return <div className="splash" aria-busy="true">Loading…</div>;
  if (me === null) return <SignIn onSignedIn={loadMe} />;
  return <Console me={me} route={route} reloadMe={loadMe} />;
}

function SignIn(props: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const action = useAction();
  return (
    <main className="signin">
      <form
        className="signin-card"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await action.run(() => api("POST", "/v1/console/session", { email, password }))) props.onSignedIn();
        }}
      >
        <div className="brand-mark" aria-hidden="true">Z</div>
        <h1>Sign in to Zaina</h1>
        <p className="muted">Your business's chats, knowledge and reports.</p>
        <Field label="Email">
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Message message={action.message} />
        <Button kind="primary" type="submit" busy={action.busy}>Sign in</Button>
      </form>
    </main>
  );
}

const PAGES: Array<{ id: string; label: string; icon: string; minimum: Role; only?: string }> = [
  { id: "inbox", label: "Inbox", icon: "inbox", minimum: "viewer" },
  // A place to stay's rooms and bookings (Phase 4).
  { id: "bookings", label: "Bookings", icon: "calendar", minimum: "viewer", only: "guesthouse" },
  { id: "rooms", label: "Rooms", icon: "bed", minimum: "manager", only: "guesthouse" },
  { id: "knowledge", label: "Knowledge", icon: "book", minimum: "viewer" },
  { id: "reports", label: "Reports", icon: "chart", minimum: "manager" },
  { id: "settings", label: "Settings", icon: "settings", minimum: "manager" },
  { id: "team", label: "Team", icon: "team", minimum: "manager" },
];

function Console(props: { me: Me; route: Route; reloadMe: () => Promise<void> }) {
  const { me, route } = props;
  const admin = me.user.is_platform_admin;
  const [counts, setCounts] = useState({ pending: 0, mine: 0, callbacks: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"password" | "alerts" | null>(null);

  // Which business: the one in the address, or the first the person works for.
  const businessId = route.businessId ?? me.businesses[0]?.businessId ?? null;
  const membership = me.businesses.find((business) => business.businessId === businessId);
  const role: Role | null = membership?.role ?? (admin && businessId ? "owner" : null);
  const page = route.page === "platform" ? "platform" : route.page;
  // The business's type decides some pages; a platform admin without a membership asks for it.
  const typeInfo = useLoad(
    () => (membership?.businessType || !businessId || !role ? Promise.resolve(null) : api<{ business_type: string }>("GET", businessPath(businessId, "/operations"))),
    [businessId, membership?.businessType, role],
  );
  const businessType = membership?.businessType ?? typeInfo.data?.business_type ?? null;

  useEffect(() => {
    if (!route.businessId && businessId && route.page !== "platform") go({ businessId, page: "inbox" });
    if (!businessId && admin && route.page !== "platform") go({ businessId: null });
  }, [route.businessId, route.page, businessId, admin]);

  const refreshCounts = useCallback(async () => {
    if (!businessId || !role) return;
    try {
      setCounts(await api("GET", businessPath(businessId, "/pending-count")));
    } catch {}
  }, [businessId, role]);
  useEffect(() => void refreshCounts(), [refreshCounts]);
  useEvery(refreshCounts, 10_000, [refreshCounts]);

  useEffect(() => {
    document.title = counts.pending > 0 ? `(${counts.pending}) Zaina console` : "Zaina console";
  }, [counts.pending]);

  // "I'm here": keeps this person routable while the console is open.
  const answersChats = role !== null && atLeast(role, "agent") && Boolean(membership);
  useEvery(() => {
    if (answersChats && businessId) void api("POST", businessPath(businessId, "/presence"), {}).catch(() => {});
  }, 60_000, [answersChats, businessId]);

  const businesses = useMemo(() => {
    const list = [...me.businesses];
    if (businessId && !membership && admin) list.push({ businessId, businessName: businessId, role: "owner" });
    return list;
  }, [me.businesses, businessId, membership, admin]);

  if (!businessId && !admin) {
    return (
      <main className="signin">
        <div className="signin-card">
          <h1>No business yet</h1>
          <p className="muted">Your account isn't part of any business. Ask the business's owner to add you.</p>
          <Button onClick={() => api("DELETE", "/v1/console/session").finally(() => location.reload())}>Sign out</Button>
        </div>
      </main>
    );
  }

  const visiblePages = role ? PAGES.filter((item) => atLeast(role, item.minimum) && (!item.only || item.only === businessType)) : [];
  let content: JSX.Element;
  if (page === "platform" && admin) content = <PlatformPage />;
  else if (!businessId || !role) content = <div className="page"><p className="message error">You don't work for this business.</p></div>;
  else if (page === "bookings" && businessType === "guesthouse") content = <BookingsPage businessId={businessId} role={role} bookingId={route.id} />;
  else if (page === "rooms" && businessType === "guesthouse" && atLeast(role, "manager")) content = <RoomsPage businessId={businessId} role={role} />;
  else if (page === "knowledge") content = <KnowledgePage businessId={businessId} role={role} />;
  else if (page === "reports" && atLeast(role, "manager")) content = <ReportsPage businessId={businessId} />;
  else if (page === "settings" && atLeast(role, "manager")) content = <SettingsPage businessId={businessId} role={role} me={me} businessType={businessType} />;
  else if (page === "team" && atLeast(role, "manager")) content = <TeamPage businessId={businessId} role={role} me={me} />;
  else content = <InboxPage businessId={businessId} role={role} me={me} chatId={route.page === "inbox" ? route.id : null} counts={counts} onChanged={refreshCounts} />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark small" aria-hidden="true">Z</span><span>Zaina</span></div>
        {businesses.length > 0 ? (
          <label className="business-switch">
            <span className="visually-hidden">Business</span>
            <select value={businessId ?? ""} onChange={(event) => go({ businessId: event.target.value, page: "inbox" })}>
              {businesses.map((business) => <option key={business.businessId} value={business.businessId}>{business.businessName}</option>)}
            </select>
          </label>
        ) : null}
        <div className="topbar-spacer" />
        {answersChats && businessId ? <Availability businessId={businessId} /> : null}
        <button type="button" className="icon-button" aria-label="Alerts on this device" title="Alerts on this device" onClick={() => setDialog("alerts")}>
          <Icon name="bell" />
        </button>
        <div className="menu">
          <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            {me.user.name.slice(0, 1).toUpperCase()}
          </button>
          {menuOpen ? (
            <div className="menu-list" role="menu" onMouseLeave={() => setMenuOpen(false)}>
              <p className="menu-who">{me.user.name}<br /><span className="muted">{me.user.email}</span></p>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDialog("password"); }}>Change password</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDialog("alerts"); }}>Alerts</button>
              <button type="button" role="menuitem" onClick={() => api("DELETE", "/v1/console/session").finally(() => location.reload())}>Sign out</button>
            </div>
          ) : null}
        </div>
      </header>
      <nav className="sidenav" aria-label="Sections">
        {visiblePages.map((item) => (
          <a key={item.id} href={`#/b/${encodeURIComponent(businessId ?? "")}/${item.id}`} className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.id === "inbox" && counts.pending > 0 ? <span className="count" aria-label={`${counts.pending} waiting`}>{counts.pending}</span> : null}
          </a>
        ))}
        {admin ? (
          <a href="#/platform" className={page === "platform" ? "active" : ""} aria-current={page === "platform" ? "page" : undefined}>
            <Icon name="shield" />
            <span>Platform</span>
          </a>
        ) : null}
      </nav>
      <main className="main">{content}</main>
      {dialog === "password" ? <PasswordDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "alerts" ? <AlertsDialog me={me} businessId={membership ? businessId : null} onClose={() => { setDialog(null); void props.reloadMe(); }} /> : null}
    </div>
  );
}

function Availability(props: { businessId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api<{ available: boolean }>("POST", businessPath(props.businessId, "/presence"), {})
      .then((result) => live && setAvailable(result.available))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, [props.businessId]);
  if (available === null) return null;
  return (
    <div className="availability" title="Waiting chats are offered to people who are taking chats">
      <Toggle
        checked={available}
        label={available ? "Taking chats" : "Not taking chats"}
        onChange={async (value) => {
          setAvailable(value);
          try {
            setAvailable((await api<{ available: boolean }>("POST", businessPath(props.businessId, "/presence"), { available: value })).available);
          } catch {
            setAvailable(!value);
          }
        }}
      />
    </div>
  );
}

function PasswordDialog(props: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const action = useAction();
  return (
    <Modal title="Change password" onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(() => api("POST", "/v1/staff/me/password", { current, next }), "Password changed. Other devices are signed out.");
          setCurrent("");
          setNext("");
        }}
      >
        <Field label="Current password"><input type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} /></Field>
        <Field label="New password" hint="At least 10 characters, letters with numbers or symbols."><input type="password" autoComplete="new-password" required value={next} onChange={(event) => setNext(event.target.value)} /></Field>
        <Message message={action.message} />
        <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Change password</Button></div>
      </form>
    </Modal>
  );
}

function AlertsDialog(props: { me: Me; businessId: string | null; onClose: () => void }) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [emailOn, setEmailOn] = useState<boolean | null>(null);
  const action = useAction();
  const supported = alertsSupported() && Boolean(props.me.push.public_key);
  useEffect(() => {
    if (supported) void currentSubscription().then((subscription) => setSubscribed(Boolean(subscription))).catch(() => setSubscribed(false));
    if (props.businessId) {
      void api<{ alert_email: boolean }>("GET", businessPath(props.businessId, "/members/me")).then((result) => setEmailOn(result.alert_email)).catch(() => {});
    }
  }, [supported, props.businessId]);
  return (
    <Modal title="Alerts" onClose={props.onClose}>
      <div className="form">
        <section>
          <h3>On this phone or computer</h3>
          {!props.me.push.public_key ? (
            <p className="muted">Alerts on phones aren't switched on for this platform yet.</p>
          ) : !alertsSupported() ? (
            <p className="muted">This browser can't show alerts. On an iPhone, add the console to your home screen first (Share → Add to Home Screen), then open it from there.</p>
          ) : (
            <>
              <p className="muted">A notification when a customer is waiting for you, when a customer you're helping replies, and when a callback is needed.</p>
              {typeof Notification !== "undefined" && Notification.permission === "denied" ? (
                <p className="message error">Notifications are blocked for this site in your browser settings.</p>
              ) : null}
              <Toggle
                checked={Boolean(subscribed)}
                disabled={subscribed === null || action.busy}
                label={subscribed ? "Alerts are on for this device" : "Alerts are off for this device"}
                onChange={(value) => void action.run(async () => {
                  if (value) await turnAlertsOn(props.me.push.public_key!);
                  else await turnAlertsOff();
                  setSubscribed(value);
                })}
              />
            </>
          )}
        </section>
        {props.businessId ? (
          <section>
            <h3>By email</h3>
            <Toggle
              checked={Boolean(emailOn)}
              disabled={emailOn === null}
              label="Email me about waiting chats and callbacks for this business"
              onChange={(value) => void action.run(async () => {
                const result = await api<{ alert_email: boolean }>("PATCH", businessPath(props.businessId!, "/members/me"), { alert_email: value });
                setEmailOn(result.alert_email);
              })}
            />
          </section>
        ) : null}
        <Message message={action.message} />
      </div>
    </Modal>
  );
}

export function errorText(problem: unknown): string {
  return problem instanceof ApiError ? problem.message : "Something went wrong.";
}
