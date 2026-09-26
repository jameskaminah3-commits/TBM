// zaina-platform/web/console/pages/billing.tsx
//
// Settings → Plan & billing: the business's plan (a free trial, paid
// through, ending, overdue), the invoice to pay (card or M-Pesa through
// Paystack, or by hand), the plans the platform offers, and past invoices.
// An owner chooses and pays; the rest of the team can look.

import { api, businessPath } from "../api.ts";
import { cents, count, date, period } from "../format.ts";
import type { Billing, Invoice, Plan } from "../types.ts";
import { Button, Empty, ErrorLine, Message, useAction, useEvery, useLoad } from "../ui.tsx";

type Note = { kind: "success" | "error"; text: string };

/** What Paystack's way back said (the address), shown only when it matches what the platform knows. */
function outcomeNote(outcome: string | null, data: Billing): Note | null {
  if (outcome === "paid" && !data.open_invoice) return { kind: "success", text: "Thank you: your payment went through. The receipt is on its way by email." };
  if (outcome === "paid" || outcome === "pending") return { kind: "success", text: "Your payment is being confirmed. This page shows it as paid as soon as Paystack confirms it, usually within a minute." };
  if (outcome === "failed") return { kind: "error", text: "The payment didn't go through. You can try again, or pay another way." };
  return null;
}

export function BillingSettings(props: { businessId: string; outcome: string | null; onChanged?: () => void }) {
  const loaded = useLoad(() => api<Billing>("GET", businessPath(props.businessId, "/billing")), [props.businessId]);
  const action = useAction();
  const data = loaded.data;
  // Back from Paystack before its confirmation: look again until it's in.
  useEvery(() => {
    if ((props.outcome === "pending" || props.outcome === "paid") && data?.open_invoice) void loaded.reload();
  }, 4000, [props.outcome, data?.open_invoice?.id]);
  if (!data) return <ErrorLine error={loaded.error} />;
  const change = (work: () => Promise<unknown>, success: string) => void action.run(async () => {
    await work();
    await loaded.reload();
    props.onChanged?.();
  }, success);

  if (data.billed_by_team) {
    return (
      <section className="card">
        <h2>Plan & billing</h2>
        <p>The Zaina team bills this business directly: there's nothing to do here.</p>
      </section>
    );
  }
  if (!data.enabled && !data.subscription) {
    return (
      <section className="card">
        <h2>Plan & billing</h2>
        <p className="muted">There are no plans to choose from yet: Zaina is free to use for now.</p>
      </section>
    );
  }
  return (
    <div className="stack">
      <Message message={outcomeNote(props.outcome, data)} />
      <CurrentPlan data={data} busy={action.busy} onCancel={() => change(() => api("POST", businessPath(props.businessId, "/billing/cancel")), "Your plan is cancelled.")} onKeep={() => change(() => api("POST", businessPath(props.businessId, "/billing/keep")), "Your plan carries on.")} />
      {data.open_invoice ? <PayInvoice businessId={props.businessId} data={data} invoice={data.open_invoice} /> : null}
      <Message message={action.message} />
      <Plans data={data} busy={action.busy} onChoose={(plan) => change(() => api("POST", businessPath(props.businessId, "/billing/plan"), { plan_id: plan.id }), `You're on the ${plan.name} plan.`)} />
      <Invoices invoices={data.invoices} />
    </div>
  );
}

function CurrentPlan(props: { data: Billing; busy: boolean; onCancel: () => void; onKeep: () => void }) {
  const { data } = props;
  const subscription = data.subscription;
  if (!subscription) {
    return (
      <section className="card">
        <h2>Your plan</h2>
        <p>{data.business.status === "onboarding" ? "Choose a plan below to go live." : "You're not on a plan yet: choose one below."}</p>
      </section>
    );
  }
  const plan = subscription.plan;
  const end = date(subscription.current_period_end);
  const open = data.open_invoice;
  const paused = data.business.status === "paused" && data.business.pause_reason === "billing";
  let line: string;
  switch (subscription.status) {
    case "trialing":
      line = subscription.cancel_at_period_end
        ? `Free trial until ${end}. It ends then, as you asked.`
        : open ? `Free trial until ${end}. Pay the invoice below to carry on after it.` : `Free trial until ${end}. The first invoice comes a few days before.`;
      break;
    case "active":
      line = subscription.cancel_at_period_end ? `Paid through ${end}. It ends then, as you asked.` : `Paid through ${end}.`;
      break;
    case "past_due":
      line = `Invoice ${open?.number ?? ""} is overdue.${data.pauses_at ? ` Zaina keeps answering your customers until ${date(data.pauses_at)}, then pauses until it's paid.` : paused ? " Zaina is paused until it's paid." : ""}`;
      break;
    case "incomplete":
      line = open ? `Pay invoice ${open.number} to start.` : "Choose a plan below to start.";
      break;
    default:
      line = `Your plan has ended.${paused ? " Zaina isn't answering customers: choose a plan to start again." : ""}`;
  }
  const running = subscription.status === "trialing" || subscription.status === "active";
  return (
    <section className={`card${subscription.status === "past_due" || paused ? " attention" : ""}`}>
      <h2>Your plan{plan ? `: ${plan.name}` : ""}</h2>
      {plan ? <p className="small muted">{plan.price_text}</p> : null}
      <p>{line}</p>
      <p className="small muted">
        {count(data.conversations_this_month)} conversation{data.conversations_this_month === 1 ? "" : "s"} this month
        {plan?.conversations_per_month ? `, of the ${count(plan.conversations_per_month)} your plan is for` : ""}.
      </p>
      {data.can_manage && subscription.status !== "cancelled" ? (
        <div className="actions start">
          {subscription.cancel_at_period_end ? (
            <Button busy={props.busy} onClick={props.onKeep}>Keep my plan</Button>
          ) : (
            <Button
              kind="ghost"
              busy={props.busy}
              onClick={() => {
                const message = running
                  ? `Cancel your plan? Zaina keeps answering your customers until ${end}, then stops.`
                  : "Stop now? Nothing is paid for, so Zaina stops answering your customers at once.";
                if (window.confirm(message)) props.onCancel();
              }}
            >
              Cancel plan
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function PayInvoice(props: { businessId: string; data: Billing; invoice: Invoice }) {
  const { data, invoice } = props;
  const action = useAction();
  return (
    <section className={`card${invoice.overdue ? " attention" : ""}`}>
      <h2>Invoice {invoice.number}</h2>
      <dl className="facts">
        <div><dt>{invoice.plan_name} ({invoice.billing_interval === "year" ? "yearly" : "monthly"})</dt><dd>{cents(invoice.amount_minor, invoice.currency)}</dd></div>
        <div><dt>Period</dt><dd>{period(invoice.period_start, invoice.period_end)}</dd></div>
        <div><dt>{invoice.overdue ? "Was due" : "Due"}</dt><dd>{date(invoice.due_at)}</dd></div>
      </dl>
      {data.can_manage && data.pay_online ? (
        <div className="actions start">
          <Button
            kind="primary"
            busy={action.busy}
            onClick={() => void action.run(async () => {
              const started = await api<{ authorization_url: string }>("POST", businessPath(props.businessId, `/billing/invoices/${invoice.id}/pay`));
              location.assign(started.authorization_url);
            })}
          >
            Pay {cents(invoice.amount_minor, invoice.currency)} by card or M-Pesa
          </Button>
        </div>
      ) : null}
      <Message message={action.message} />
      {data.payment_instructions ? (
        <p className="small">{data.pay_online ? "Or pay by hand: " : "Pay by hand: "}{data.payment_instructions} Use <strong>{invoice.number}</strong> as the reference. The Zaina team marks it paid once it arrives.</p>
      ) : !data.pay_online ? <p className="small muted">Ask the Zaina team how to pay this invoice.</p> : null}
      {!data.can_manage ? <p className="small muted">An owner of the business pays invoices.</p> : null}
    </section>
  );
}

function Plans(props: { data: Billing; busy: boolean; onChoose: (plan: Plan) => void }) {
  const { data } = props;
  const subscription = data.subscription;
  const running = subscription && subscription.status !== "cancelled";
  if (!data.plans.length) return null;
  return (
    <section className="stack-tight">
      <h2>{running ? "Change plan" : "Choose a plan"}</h2>
      <div className="plans-grid">
        {data.plans.map((plan) => {
          const current = running && subscription?.plan?.id === plan.id;
          const trial = plan.trial_days > 0 && data.trial_available && plan.price_minor > 0;
          const starting = !subscription || subscription.status === "cancelled" || subscription.status === "incomplete";
          const label = current ? null : trial && starting ? `Start ${plan.trial_days}-day free trial` : starting ? "Choose" : "Switch to this plan";
          return (
            <article key={plan.id} className={`card plan${current ? " current" : ""}`}>
              <div className="room-head"><h3>{plan.name}</h3>{current ? <span className="chip ok">Your plan</span> : null}</div>
              <p className="plan-price">{plan.price_text}</p>
              {plan.description ? <p className="small">{plan.description}</p> : null}
              <ul className="plain-list small muted">
                {plan.conversations_per_month ? <li>For up to {count(plan.conversations_per_month)} conversations a month</li> : null}
                {trial ? <li>{plan.trial_days}-day free trial</li> : null}
              </ul>
              {label && data.can_manage ? (
                <Button
                  kind={starting ? "primary" : "secondary"}
                  busy={props.busy}
                  onClick={() => {
                    if (!starting && !window.confirm(`Switch to ${plan.name}? What you've paid for stays as it is; your next invoice is ${plan.price_text.toLowerCase()}.`)) return;
                    props.onChoose(plan);
                  }}
                >
                  {label}
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>
      {!data.can_manage ? <p className="small muted">An owner of the business chooses the plan.</p> : null}
    </section>
  );
}

const HOW: Record<string, string> = { paystack: "card or M-Pesa", manual: "by hand", waived: "waived" };

function Invoices(props: { invoices: Invoice[] }) {
  return (
    <section className="stack-tight">
      <h2>Invoices</h2>
      {props.invoices.length ? (
        <table className="table">
          <thead><tr><th>Invoice</th><th>Period</th><th className="number">Amount</th><th>Status</th></tr></thead>
          <tbody>
            {props.invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td><strong className="nowrap">{invoice.number}</strong><div className="small muted">{invoice.plan_name}</div></td>
                <td>{period(invoice.period_start, invoice.period_end)}</td>
                <td className="number">{cents(invoice.amount_minor, invoice.currency)}</td>
                <td>
                  {invoice.status === "paid" ? <><span className="chip ok">{invoice.method === "waived" ? "Waived" : "Paid"}</span> <span className="small muted">{date(invoice.paid_at)}{invoice.method && invoice.method !== "waived" ? `, ${HOW[invoice.method]}` : ""}</span></>
                    : invoice.status === "void" ? <span className="chip">Void</span>
                    : <><span className={`chip${invoice.overdue ? " callback" : " waiting"}`}>{invoice.overdue ? "Overdue" : "Open"}</span> <span className="small muted">due {date(invoice.due_at)}</span></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty title="No invoices yet" />}
    </section>
  );
}
