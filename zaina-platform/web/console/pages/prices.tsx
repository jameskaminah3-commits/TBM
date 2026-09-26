// zaina-platform/web/console/pages/prices.tsx
//
// The price list: what the business charges for things that aren't booked
// here (services, extras, products), by section. Zaina quotes these exactly
// and never takes a price from documents. Items can be added one at a time,
// or pasted as the business has them and checked before they're added.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, useAction, useLoad } from "../ui.tsx";

type PriceItem = {
  id: string; section: string | null; name: string; description: string | null; price: number; price_max: number | null;
  currency: "KES" | "USD"; unit: string | null; status: "active" | "hidden"; sort_order: number; price_display: string;
};
type Parsed = { items: Array<{ section: string | null; name: string; price: string; price_max: string | null; currency: "KES" | "USD"; unit: string | null }>; problems: Array<{ line: number; text: string; reason: string }> };

export function PricesPage(props: { businessId: string; role: Role; businessType: string | null }) {
  const list = useLoad(() => api<{ items: PriceItem[] }>("GET", businessPath(props.businessId, "/price-list")), [props.businessId]);
  const [editing, setEditing] = useState<PriceItem | "new" | null>(null);
  const [pasting, setPasting] = useState(false);
  const action = useAction();
  const manager = atLeast(props.role, "manager");
  const items = list.data?.items ?? [];
  const sections = [...new Set(items.map((item) => item.section ?? ""))];
  const booked = props.businessType === "guesthouse" ? "rooms" : props.businessType === "salon" || props.businessType === "restaurant" ? "services" : null;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Prices</h1>
        <p className="muted">
          What you charge for things {booked ? `that aren't ${booked} booked here: extras, transfers, meals, products` : "customers ask about: your services, packages and products"}.
          Zaina quotes these exactly, and never takes a price from your documents.
        </p>
      </div>
      {manager ? (
        <div className="toolbar">
          <Button kind="primary" onClick={() => setEditing("new")}><Icon name="plus" size={15} /> Add a price</Button>
          <Button onClick={() => setPasting(true)}>Paste your price list</Button>
        </div>
      ) : null}
      <ErrorLine error={list.error} />
      <Message message={action.message} />
      {list.data && items.length === 0 ? (
        <Empty title="No prices yet">
          <p>Add what customers ask the price of, or paste the list you already have (one item per line, with its price). Until then, Zaina says it isn't sure and offers the team.</p>
        </Empty>
      ) : null}
      {sections.map((section) => (
        <section key={section || "none"} className="stack-tight">
          {section ? <h2 className="section-title">{section}</h2> : null}
          <table className="table">
            <thead><tr><th>Item</th><th>Price</th>{manager ? <th><span className="visually-hidden">Actions</span></th> : null}</tr></thead>
            <tbody>
              {items.filter((item) => (item.section ?? "") === section).map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    {item.status === "hidden" ? <span className="chip closed">Hidden</span> : null}
                    {item.description ? <div className="muted small">{item.description}</div> : null}
                  </td>
                  <td className="nowrap">{item.price_display}</td>
                  {manager ? (
                    <td className="row-actions">
                      <Button small onClick={() => setEditing(item)}>Edit</Button>
                      <Button small kind="ghost" onClick={() => {
                        if (!window.confirm(`Delete "${item.name}"? Zaina stops quoting it at once.`)) return;
                        void action.run(async () => {
                          await api("DELETE", businessPath(props.businessId, `/price-list/${item.id}`));
                          await list.reload();
                        }, `Deleted "${item.name}".`);
                      }}>Delete</Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {editing ? (
        <ItemEditor
          businessId={props.businessId}
          item={editing === "new" ? null : editing}
          sections={sections.filter(Boolean)}
          onClose={() => setEditing(null)}
          onSaved={async (text) => {
            setEditing(null);
            action.setMessage({ kind: "success", text });
            await list.reload();
          }}
        />
      ) : null}
      {pasting ? (
        <PasteList
          businessId={props.businessId}
          hasItems={items.length > 0}
          onClose={() => setPasting(false)}
          onAdded={async (text) => {
            setPasting(false);
            action.setMessage({ kind: "success", text });
            await list.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ItemEditor(props: { businessId: string; item: PriceItem | null; sections: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState({
    section: props.item?.section ?? "",
    name: props.item?.name ?? "",
    description: props.item?.description ?? "",
    price: props.item ? String(props.item.price) : "",
    price_max: props.item?.price_max === null || props.item?.price_max === undefined ? "" : String(props.item.price_max),
    currency: props.item?.currency ?? "KES",
    unit: props.item?.unit ?? "",
    status: props.item?.status ?? "active",
  });
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  const action = useAction();
  return (
    <Modal title={props.item ? `Edit "${props.item.name}"` : "Add a price"} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const body = { ...form, section: form.section.trim() || null, description: form.description.trim() || null, unit: form.unit.trim() || null, price_max: form.price_max.trim() || null };
          await action.run(async () => {
            const saved = await api<{ item: PriceItem }>(props.item ? "PATCH" : "POST", businessPath(props.businessId, props.item ? `/price-list/${props.item.id}` : "/price-list"), body);
            props.onSaved(`Saved "${saved.item.name}": ${saved.item.price_display}.`);
          });
        }}
      >
        <div className="form-row">
          <Field label="Name"><input required maxLength={120} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Airport transfer" /></Field>
          <Field label="Section (optional)">
            <input maxLength={80} list="price-sections" value={form.section} onChange={(event) => set("section", event.target.value)} placeholder="Transfers" />
          </Field>
          <datalist id="price-sections">{props.sections.map((section) => <option key={section} value={section} />)}</datalist>
        </div>
        <div className="form-row">
          <Field label="Price" hint="0 for free."><input required inputMode="decimal" value={form.price} onChange={(event) => set("price", event.target.value)} placeholder="3,500" /></Field>
          <Field label="Up to (optional)" hint="For a range: the most it costs."><input inputMode="decimal" value={form.price_max} onChange={(event) => set("price_max", event.target.value)} /></Field>
          <Field label="Currency">
            <select value={form.currency} onChange={(event) => set("currency", event.target.value)}>
              <option value="KES">KSh</option>
              <option value="USD">US$</option>
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Per (optional)"><input maxLength={40} value={form.unit} onChange={(event) => set("unit", event.target.value)} placeholder="per car, per person, per hour" /></Field>
          <Field label="Status">
            <select value={form.status} onChange={(event) => set("status", event.target.value)}>
              <option value="active">Shown (Zaina quotes it)</option>
              <option value="hidden">Hidden</option>
            </select>
          </Field>
        </div>
        <Field label="What it includes (optional)" wide><textarea rows={2} maxLength={500} value={form.description} onChange={(event) => set("description", event.target.value)} /></Field>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

/** A pasted item's price as it will read: "KSh 5,500 per person", "Free". */
function previewPrice(item: Parsed["items"][number]): string {
  const amount = (value: string) => Number(value).toLocaleString("en-US");
  const text = Number(item.price) === 0 && !item.price_max
    ? "Free"
    : `${item.currency === "USD" ? "$" : "KSh "}${amount(item.price)}${item.price_max ? `–${amount(item.price_max)}` : ""}`;
  return item.unit ? `${text} ${item.unit}` : text;
}

function PasteList(props: { businessId: string; hasItems: boolean; onClose: () => void; onAdded: (message: string) => void }) {
  const [text, setText] = useState("");
  const [currency, setCurrency] = useState<"KES" | "USD">("KES");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [replace, setReplace] = useState(false);
  const action = useAction();
  return (
    <Modal title="Paste your price list" onClose={props.onClose}>
      {!parsed ? (
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => setParsed(await api<Parsed>("POST", businessPath(props.businessId, "/price-list/parse"), { text, currency })));
          }}
        >
          <p className="muted">One item per line with its price, as you have it: "Airport transfer — KSh 3,500 per car", "Laundry: 200 per item", "Massage 60 min ... 4,500", "Kids under 5: free". A line without a price starts a section.</p>
          <Field label="Your price list" wide><textarea required rows={12} value={text} onChange={(event) => setText(event.target.value)} /></Field>
          <Field label="Prices with no currency are in">
            <select value={currency} onChange={(event) => setCurrency(event.target.value as "KES" | "USD")}>
              <option value="KES">Kenya shillings (KSh)</option>
              <option value="USD">US dollars</option>
            </select>
          </Field>
          <Message message={action.message} />
          <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Read the list</Button></div>
        </form>
      ) : (
        <div className="stack-tight">
          <p>{parsed.items.length ? `Found ${parsed.items.length} item${parsed.items.length === 1 ? "" : "s"}. Check them, then add them.` : "No items with prices were found."}</p>
          {parsed.items.length ? (
            <table className="table">
              <thead><tr><th>Section</th><th>Item</th><th>Price</th></tr></thead>
              <tbody>
                {parsed.items.map((item, index) => (
                  <tr key={index}>
                    <td className="muted">{item.section ?? "—"}</td>
                    <td>{item.name}</td>
                    <td className="nowrap">{previewPrice(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {parsed.problems.length ? (
            <div className="message error">
              <p>These lines weren't read (add them by hand if they're prices):</p>
              <ul className="plain-list small">{parsed.problems.map((problem) => <li key={problem.line}>Line {problem.line}: "{problem.text}" ({problem.reason})</li>)}</ul>
            </div>
          ) : null}
          {props.hasItems && parsed.items.length ? (
            <label className="check">
              <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
              <span>Replace my whole price list with these (otherwise they're added, and items already listed get the new price)</span>
            </label>
          ) : null}
          <Message message={action.message} />
          <div className="actions">
            <Button onClick={() => setParsed(null)}>Back</Button>
            {parsed.items.length ? (
              <Button kind="primary" busy={action.busy} onClick={() => void action.run(async () => {
                const result = await api<{ added: number; updated: number; removed: number }>("POST", businessPath(props.businessId, "/price-list/import"), { items: parsed.items, replace });
                props.onAdded(`${result.added} added${result.updated ? `, ${result.updated} updated` : ""}${result.removed ? `, ${result.removed} removed` : ""}. Zaina quotes them now.`);
              })}>Add {parsed.items.length} item{parsed.items.length === 1 ? "" : "s"}</Button>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}
