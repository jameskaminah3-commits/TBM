// zaina-platform/web/console/pages/team.tsx
//
// The business's people and their roles, who is taking chats, and (for
// owners) the business's secrets: names only, values are never shown again.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { timeAgo } from "../format.ts";
import type { Me, Member, Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Message, Modal, useAction, useLoad } from "../ui.tsx";

const ROLE_TEXT: Record<Role, string> = {
  viewer: "Viewer: reads chats and knowledge",
  agent: "Agent: answers chats",
  manager: "Manager: settings, knowledge, people, reports",
  owner: "Owner: everything, including WhatsApp and secrets",
};

export function TeamPage(props: { businessId: string; role: Role; me: Me }) {
  const members = useLoad(() => api<{ members: Member[] }>("GET", businessPath(props.businessId, "/members")), [props.businessId]);
  const presence = useLoad(() => api<{ people: Array<{ userId: string; available: boolean; lastSeenAt: string }> }>("GET", businessPath(props.businessId, "/presence")), [props.businessId]);
  const [adding, setAdding] = useState(false);
  const action = useAction();
  const owner = props.role === "owner";
  const availability = new Map((presence.data?.people ?? []).map((person) => [person.userId, person]));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Team</h1>
        <p className="muted">Waiting chats go first to someone who is taking chats, then to everyone after a few minutes.</p>
      </div>
      <div className="toolbar"><Button kind="primary" onClick={() => setAdding(true)}>Add a person</Button></div>
      <ErrorLine error={members.error} />
      <Message message={action.message} />
      {members.data ? (
        <table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>Taking chats</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {members.data.members.map((member) => {
              const seen = availability.get(member.userId);
              const canChange = owner || (member.role !== "manager" && member.role !== "owner");
              return (
                <tr key={member.userId}>
                  <td><strong>{member.name}</strong><div className="muted small">{member.email}</div></td>
                  <td>
                    {canChange && member.userId !== props.me.user.id ? (
                      <select
                        aria-label={`${member.name}'s role`}
                        value={member.role}
                        onChange={(event) => void action.run(async () => {
                          await api("POST", businessPath(props.businessId, "/members"), { email: member.email, role: event.target.value });
                          await members.reload();
                        }, `${member.name} is now ${event.target.value}.`)}
                      >
                        {(owner ? ["viewer", "agent", "manager", "owner"] : ["viewer", "agent"]).map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                    ) : member.role}
                  </td>
                  <td>{seen ? (seen.available ? "Yes" : `No · seen ${timeAgo(seen.lastSeenAt)}`) : "—"}</td>
                  <td className="row-actions">
                    {canChange && member.userId !== props.me.user.id ? (
                      <Button small kind="ghost" onClick={() => {
                        if (!window.confirm(`Remove ${member.name} from this business?`)) return;
                        void action.run(async () => {
                          await api("DELETE", businessPath(props.businessId, `/members/${member.userId}`));
                          await members.reload();
                        }, `${member.name} was removed.`);
                      }}>Remove</Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      {owner ? <Secrets businessId={props.businessId} /> : null}
      {adding ? <AddPerson businessId={props.businessId} owner={owner} onClose={() => setAdding(false)} onAdded={async (text) => { setAdding(false); action.setMessage({ kind: "success", text }); await members.reload(); }} /> : null}
    </div>
  );
}

function AddPerson(props: { businessId: string; owner: boolean; onClose: () => void; onAdded: (message: string) => void }) {
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "agent" as Role });
  const action = useAction();
  return (
    <Modal title="Add a person" onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            await api("POST", businessPath(props.businessId, "/members"), form);
            props.onAdded(`${form.name || form.email} was added as ${form.role}. If they're new, give them the starting password to change after signing in.`);
          });
        }}
      >
        <Field label="Email"><input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        <Field label="Name" hint="Only needed for someone who doesn't have a Zaina account yet."><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="Starting password" hint="Only for a new account: 10+ characters, letters with numbers or symbols. They change it after signing in.">
          <input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        </Field>
        <Field label="Role">
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
            {(props.owner ? (["viewer", "agent", "manager", "owner"] as Role[]) : (["viewer", "agent"] as Role[])).map((role) => <option key={role} value={role}>{ROLE_TEXT[role]}</option>)}
          </select>
        </Field>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Add</Button></div>
      </form>
    </Modal>
  );
}

function Secrets(props: { businessId: string }) {
  const secrets = useLoad(() => api<{ secrets: Array<{ name: string; updatedAt: string }> }>("GET", businessPath(props.businessId, "/secrets")), [props.businessId]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const action = useAction();
  return (
    <section className="card">
      <h2>Secrets</h2>
      <p className="muted">Keys for systems Zaina uses for this business (for example its own model key, <code>gemini_api_key</code>). Stored encrypted; nobody can read them back. The WhatsApp token is managed in Settings → WhatsApp.</p>
      <ErrorLine error={secrets.error} />
      {secrets.data && secrets.data.secrets.length === 0 ? <Empty title="No secrets stored" /> : null}
      {secrets.data && secrets.data.secrets.length > 0 ? (
        <ul className="plain-list">
          {secrets.data.secrets.map((secret) => (
            <li key={secret.name}>
              <code>{secret.name}</code> <span className="muted small">set {timeAgo(secret.updatedAt)}</span>
              <Button small kind="ghost" onClick={() => {
                if (!window.confirm(`Delete the secret ${secret.name}?`)) return;
                void action.run(async () => {
                  await api("DELETE", businessPath(props.businessId, `/secrets/${encodeURIComponent(secret.name)}`));
                  await secrets.reload();
                }, `Deleted ${secret.name}.`);
              }}>Delete</Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="form-row"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            await api("PUT", businessPath(props.businessId, `/secrets/${encodeURIComponent(name)}`), { value });
            setValue("");
            await secrets.reload();
          }, `Saved ${name}.`);
        }}
      >
        <Field label="Name"><input required pattern="[a-z][a-z0-9_]{1,62}" placeholder="gemini_api_key" value={name} onChange={(event) => setName(event.target.value.trim())} /></Field>
        <Field label="Value"><input required type="password" autoComplete="off" value={value} onChange={(event) => setValue(event.target.value)} /></Field>
        <div className="actions"><Button type="submit" busy={action.busy}>Save secret</Button></div>
      </form>
      <Message message={action.message} />
    </section>
  );
}
