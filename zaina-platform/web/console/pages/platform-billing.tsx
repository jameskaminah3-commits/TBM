// zaina-platform/web/console/pages/platform-billing.tsx
//
// The platform's billing, for its admins: the plans businesses choose from
// (prices are the team's decision: none is built in), invoices to mark paid
// by hand, waive or void, payments to look at (paid twice, or for another
// amount), and every business's plan.

import { useState } from "react";
import { api } from "../api.ts";
import { go } from "../app.tsx";
import { cents, date } from "../format.ts";
import type { Invoice, Plan, SubscriptionStatus } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, useAction, useLoad } from "../ui.tsx";

type PlatformBilling = {
  subscriptions: Array<{
    business_id: string;
    business_name: string;
    business_status: "onboarding" | "active" | "paused";
    pause_reason: "platform" | "billing" | null;
    plan_id: string;
    plan_name: string;
    status: SubscriptionStatus;
    trial_ends_at: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  }>;
  invoices: Array<Invoice & { business_id: string; business_name: string; pauses_at: string | null }>;
  attention: Array<{ reference: string; business_name: string; invoice_number: string; amount_minor: number; currency: "KES" | "USD"; status: string; note: string; created_at: string }>;
  collected_30d: Array<{ currency: "KES" | "USD"; amount_minor: number }>;
  pay_online: boolean;
  grace_days: number;
};

const STATUS: Record<SubscriptionStatus, string> = { incomplete: "First invoice unpaid", trialing: "Free trial", active: "Paid", past_due: "Overdue", cancelled: "Ended" };

export function PlatformBillingSection() {
  const plans = useLoad(() => api<{ plans: Plan[] }>("GET", "/v1/platform/plans").then((result) => result.plans), []);
  const billing = useLoad(() => api<PlatformBilling>("GET", "/v1/platform/billing"), []);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [paying, setPaying] = useState<PlatformBilling["invoices"][number] | null>(null);
  const action = useAction();
  const reload = async () => {
    await Promise.all([plans.reload(), billing.reload()]);
  };
  const data = billing.data;
  const open = data?.invoices.filter((invoice) => invoice.status === "open") ?? [];
  return (
    <section className="stack">
      <div className="page-head">
        <h2>Billing</h2>
        {data ? (
          <p className="muted">
            Collected in the last 30 days: {data.collected_30d.length ? data.collected_30d.map((row) => cents(row.amount_minor, row.currency)).join(" + ") : "nothing yet"}
            {" · "}Paying online {data.pay_online ? "on" : "off (PLATFORM_PAYSTACK_SECRET_KEY)"} · Grace period {data.grace_days} day{data.grace_days === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
      <ErrorLine error={plans.error ?? billing.error} />
      <Message message={action.message} />

      <div className="stack-tight">
        <div className="room-head">
          <h3>Plans</h3>
          <Button small kind="primary" onClick={() => setEditing("new")}><Icon name="plus" size={14} /> Add a plan</Button>
        </div>
        {plans.data?.length ? (
          <table className="table">
            <thead><tr><th>Plan</th><th>Price</th><th className="number">Free trial</th><th className="number">Conversations a month</th><th>Offered</th><th /></tr></thead>
            <tbody>
              {plans.data.map((plan) => (
                <tr key={plan.id}>
                  <td><strong>{plan.name}</strong><div className="small muted">{plan.id}</div></td>
                  <td>{plan.price_text}</td>
                  <td className="number">{plan.trial_days ? `${plan.trial_days} days` : "—"}</td>
                  <td className="number">{plan.conversations_per_month ?? "—"}</td>
                  <td>{plan.status === "active" ? <span className="chip ok">Offered</span> : <span className="chip">Hidden</span>}</td>
                  <td className="row-actions"><Button small onClick={() => setEditing(plan)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : plans.data ? <Empty title="No plans yet">Billing is off until you add one: businesses go live without choosing a plan.</Empty> : null}
      </div>

      <div className="stack-tight">
        <h3>Open invoices</h3>
        {open.length ? (
          <table className="table">
            <thead><tr><th>Business</th><th>Invoice</th><th className="number">Amount</th><th>Due</th><th /></tr></thead>
            <tbody>
              {open.map((invoice) => (
                <tr key={invoice.id}>
                  <td><button type="button" className="link" onClick={() => go({ businessId: invoice.business_id, page: "settings", id: "billing" })}><strong>{invoice.business_name}</strong></button></td>
                  <td>{invoice.number}<div className="small muted">{invoice.plan_name}, {date(invoice.period_start)} to {date(invoice.period_end)}</div></td>
                  <td className="number">{cents(invoice.amount_minor, invoice.currency)}</td>
                  <td>
                    {date(invoice.due_at)}
                    {invoice.overdue ? <span className="status critical"><Icon name="alert" size={13} />Overdue{invoice.pauses_at ? `, pauses ${date(invoice.pauses_at)}` : ""}</span> : null}
                  </td>
                  <td className="row-actions">
                    <Button small onClick={() => setPaying(invoice)}>Mark paid</Button>{" "}
                    <Button small kind="ghost" busy={action.busy} onClick={() => {
                      if (!window.confirm(`Waive ${invoice.number}? ${invoice.business_name} gets this period free.`)) return;
                      void action.run(async () => { await api("POST", `/v1/platform/invoices/${invoice.id}/mark-paid`, { waive: true }); await reload(); }, `${invoice.number} is waived.`);
                    }}>Waive</Button>{" "}
                    <Button small kind="ghost" busy={action.busy} onClick={() => {
                      if (!window.confirm(`Void ${invoice.number}? It isn't owed; a plan still running gets a new invoice at its current price.`)) return;
                      void action.run(async () => { await api("POST", `/v1/platform/invoices/${invoice.id}/void`); await reload(); }, `${invoice.number} is void.`);
                    }}>Void</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : data ? <p className="muted small">No invoice is waiting to be paid.</p> : null}
      </div>

      {data?.attention.length ? (
        <div className="stack-tight">
          <h3>Payments to look at</h3>
          <table className="table">
            <thead><tr><th>Business</th><th>Invoice</th><th className="number">Amount</th><th>What's wrong</th></tr></thead>
            <tbody>
              {data.attention.map((payment) => (
                <tr key={payment.reference}>
                  <td>{payment.business_name}<div className="small muted">{date(payment.created_at)}</div></td>
                  <td>{payment.invoice_number}<div className="small muted">{payment.reference}</div></td>
                  <td className="number">{cents(payment.amount_minor, payment.currency)}</td>
                  <td>{payment.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="stack-tight">
        <h3>Businesses on a plan</h3>
        {data?.subscriptions.length ? (
          <table className="table">
            <thead><tr><th>Business</th><th>Plan</th><th>Where it stands</th><th>Live</th></tr></thead>
            <tbody>
              {data.subscriptions.map((row) => (
                <tr key={row.business_id}>
                  <td><button type="button" className="link" onClick={() => go({ businessId: row.business_id, page: "settings", id: "billing" })}><strong>{row.business_name}</strong></button></td>
                  <td>{row.plan_name}</td>
                  <td>
                    {STATUS[row.status]}
                    {row.current_period_end && (row.status === "trialing" || row.status === "active") ? <span className="small muted"> {row.status === "trialing" ? "until" : "through"} {date(row.current_period_end)}</span> : null}
                    {row.cancel_at_period_end ? <span className="chip">Ending</span> : null}
                  </td>
                  <td>{row.business_status === "active" ? "Live" : row.business_status === "onboarding" ? "Setting up" : row.pause_reason === "billing" ? <span className="status critical"><Icon name="alert" size={13} />Paused: unpaid</span> : "Paused"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : data ? <p className="muted small">No business has chosen a plan yet.</p> : null}
      </div>

      {editing ? <PlanForm plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (text) => { setEditing(null); action.setMessage({ kind: "success", text }); await reload(); }} /> : null}
      {paying ? <MarkPaid invoice={paying} onClose={() => setPaying(null)} onSaved={async (text) => { setPaying(null); action.setMessage({ kind: "success", text }); await reload(); }} /> : null}
    </section>
  );
}

function PlanForm(props: { plan: Plan | null; onClose: () => void; onSaved: (message: string) => void }) {
  const plan = props.plan;
  const [form, setForm] = useState({
    id: plan?.id ?? "",
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    price: plan ? String(plan.price_minor / 100) : "",
    currency: plan?.currency ?? "KES",
    interval: plan?.billing_interval ?? "month",
    trial: String(plan?.trial_days ?? 14),
    conversations: plan?.conversations_per_month ? String(plan.conversations_per_month) : "",
    order: String(plan?.sort_order ?? 0),
    offered: plan ? plan.status === "active" : true,
  });
  const action = useAction();
  const set = (key: keyof typeof form, value: string | boolean) => setForm({ ...form, [key]: value });
  return (
    <Modal title={plan ? `Edit ${plan.name}` : "Add a plan"} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const price = Number(form.price.replace(/,/g, "").trim());
          if (!form.price.trim() || !Number.isFinite(price) || price < 0) {
            action.setMessage({ kind: "error", text: "The price is an amount like 2500 (0 for a free plan)." });
            return;
          }
          await action.run(async () => {
            const body = {
              ...(plan ? {} : { id: form.id.trim() }),
              name: form.name,
              description: form.description,
              price_minor: Math.round(price * 100),
              currency: form.currency,
              billing_interval: form.interval,
              trial_days: Number(form.trial) || 0,
              conversations_per_month: form.conversations.trim() ? Number(form.conversations) : null,
              sort_order: Number(form.order) || 0,
              status: form.offered ? "active" : "hidden",
            };
            await api(plan ? "PATCH" : "POST", plan ? `/v1/platform/plans/${encodeURIComponent(plan.id)}` : "/v1/platform/plans", body);
            props.onSaved(plan ? `${form.name} is saved. A new price applies from each business's next invoice.` : `${form.name} is offered to businesses now.`);
          });
        }}
      >
        <div className="form-row">
          <Field label="Name"><input required maxLength={80} value={form.name} onChange={(event) => set("name", event.target.value)} /></Field>
          {plan ? null : <Field label="Id" hint="Lowercase letters, digits and dashes; can't change."><input required pattern="[a-z][a-z0-9-]{1,39}" value={form.id} onChange={(event) => set("id", event.target.value.trim())} /></Field>}
        </div>
        <Field label="What it's for" hint="Shown to businesses choosing a plan."><textarea rows={2} maxLength={500} value={form.description} onChange={(event) => set("description", event.target.value)} /></Field>
        <div className="form-row">
          <Field label="Price" hint="0 for a free plan."><input required inputMode="decimal" value={form.price} onChange={(event) => set("price", event.target.value)} /></Field>
          <Field label="Currency">
            <select value={form.currency} onChange={(event) => set("currency", event.target.value)}><option value="KES">Kenya shillings</option><option value="USD">US dollars</option></select>
          </Field>
          <Field label="Every">
            <select value={form.interval} onChange={(event) => set("interval", event.target.value)}><option value="month">Month</option><option value="year">Year</option></select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Free trial (days)" hint="0 to 90; one trial per business."><input type="number" min={0} max={90} value={form.trial} onChange={(event) => set("trial", event.target.value)} /></Field>
          <Field label="Conversations a month" hint="Shown to businesses; not cut off."><input type="number" min={1} value={form.conversations} onChange={(event) => set("conversations", event.target.value)} /></Field>
          <Field label="Order" hint="Lower comes first."><input type="number" value={form.order} onChange={(event) => set("order", event.target.value)} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={form.offered} onChange={(event) => set("offered", event.target.checked)} /><span>Offered to businesses (hidden plans stay with those already on them)</span></label>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>{plan ? "Save" : "Add plan"}</Button></div>
      </form>
    </Modal>
  );
}

function MarkPaid(props: { invoice: PlatformBilling["invoices"][number]; onClose: () => void; onSaved: (message: string) => void }) {
  const [receipt, setReceipt] = useState("");
  const action = useAction();
  const invoice = props.invoice;
  return (
    <Modal title={`Mark ${invoice.number} paid`} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            await api("POST", `/v1/platform/invoices/${invoice.id}/mark-paid`, { receipt });
            props.onSaved(`${invoice.number} is paid. ${invoice.business_name}'s owners get a receipt.`);
          });
        }}
      >
        <p>{invoice.business_name} paid {cents(invoice.amount_minor, invoice.currency)} by hand. Check the money has arrived first.</p>
        <Field label="Receipt or reference" hint="The M-Pesa code or bank reference, as it shows in your statement."><input required maxLength={120} value={receipt} onChange={(event) => setReceipt(event.target.value)} /></Field>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Mark paid</Button></div>
      </form>
    </Modal>
  );
}
