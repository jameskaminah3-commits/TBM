// End-to-end: a business's price list. The team adds prices one by one or
// pastes the list it has; Zaina quotes them exactly (get_prices), never from
// documents, and says so when something isn't listed (the question joins the
// business's unanswered questions). Each business sees only its own list.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5090;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = "https://dhowtours.example";

let platform: Platform;
let api: Api;
const tokens: Record<string, string> = {};
const staff = (method: string, route: string, body?: unknown, who = "owner", business = "dhow") => api(method, `/v1/staff/businesses/${business}${route}`, body, tokens[who]);
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

async function openChat(business: string, origin: string) {
  const response = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ business, display_currency: "KES" }) });
  assert.equal(response.status, 201);
  return ((await response.json()) as any).token as string;
}

async function say(token: string, origin: string, message: string) {
  const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin }, body: JSON.stringify({ message }) });
  const body = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.reply as string;
}

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = await login("ops@example.com");
  for (const [id, name, type, origin, email] of [
    ["dhow", "Diani Dhow Tours", "general", SITE, "baraka@example.com"],
    ["coral", "Coral Cove", "guesthouse", "https://coralcove.example", "amani@example.com"],
  ]) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, business_type: type, allowed_origins: [origin], owner: { email, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  tokens.owner = await login("baraka@example.com");
  tokens.coral = await login("amani@example.com");
  assert.equal((await staff("POST", "/members", { email: "wanjiru@example.com", name: "Wanjiru", role: "agent", password: PASSWORD })).status, 201);
  tokens.agent = await login("wanjiru@example.com");
});

after(async () => {
  await platform?.stop();
});

test("the team keeps a price list: one item at a time, checked", async () => {
  const added = await staff("POST", "/price-list", { section: "Trips", name: "Sunset dhow cruise", price: "4,500", unit: "per person", description: "Two hours on the water with snacks." });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.item.price_display, "KSh 4,500 per person");
  assert.equal((await staff("POST", "/price-list", { section: "trips", name: "sunset dhow cruise ", price: 1 })).status, 409, "the same name in the same section");
  assert.equal((await staff("POST", "/price-list", { name: "Snorkelling", price: "a lot" })).status, 400);
  assert.equal((await staff("POST", "/price-list", { name: "Snorkelling", price: 1000 }, "agent")).status, 403, "an agent can't change prices");
  assert.equal((await staff("GET", "/price-list", undefined, "agent")).status, 200, "but can read them");

  const changed = await staff("PATCH", `/price-list/${added.body.item.id}`, { price: 5000, price_max: 6000 });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.item.price_display, "KSh 5,000–6,000 per person");
  assert.equal(changed.body.item.description, "Two hours on the water with snacks.", "what the change doesn't mention stays");

  // Another business can't see or change it.
  assert.deepEqual((await staff("GET", "/price-list", undefined, "coral", "coral")).body.items, []);
  assert.equal((await staff("PATCH", `/price-list/${added.body.item.id}`, { price: 1 }, "coral", "coral")).status, 404);
  assert.equal((await staff("DELETE", `/price-list/${added.body.item.id}`, undefined, "coral", "coral")).status, 404);
});

test("the team pastes the list it has: checked first, then added; pasting again updates prices", async () => {
  const text = [
    "Trips",
    "Sunset dhow cruise — KSh 5,500 per person",
    "Wasini island full day: 9,500 pp",
    "Kisite snorkelling (half day) KES 6,000 - 7,500",
    "Extras",
    "Hotel pick-up in Diani: free",
    "Underwater camera hire 1,500/= each",
    "Call us for private charters.",
  ].join("\n");
  const parsed = await staff("POST", "/price-list/parse", { text });
  assert.equal(parsed.status, 200);
  assert.equal(parsed.body.items.length, 5);
  assert.deepEqual(parsed.body.problems.map((problem: any) => problem.line), [8]);

  const imported = await staff("POST", "/price-list/import", { items: parsed.body.items });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.deepEqual([imported.body.added, imported.body.updated, imported.body.removed], [4, 1, 0], "the cruise was already listed: its price changes");
  const cruise = imported.body.items.find((item: any) => item.name === "Sunset dhow cruise");
  assert.equal(cruise.price_display, "KSh 5,500 per person");
  assert.equal(cruise.description, "Two hours on the water with snacks.", "a pasted line keeps the item's description");
  assert.equal(imported.body.items.find((item: any) => item.name === "Hotel pick-up in Diani").price_display, "Free");

  assert.equal((await staff("POST", "/price-list/import", { items: [{ name: "Twice", price: 1 }, { name: "twice", price: 2 }] })).status, 400);
  assert.equal((await staff("POST", "/price-list/import", { items: [{ name: "Bad", price: "x" }] })).status, 400);
});

test("Zaina quotes the list exactly, never a hidden item, and says when something isn't listed", async () => {
  const chat = await openChat("dhow", SITE);
  assert.match(await say(chat, SITE, "TEST:whoami"), /Tools: create_lead, search_knowledge, escalate_to_human, get_prices\./);
  const snorkel = await say(chat, SITE, raw64("get_prices", { query: "snorkelling trip" }));
  assert.match(snorkel, /Kisite snorkelling \(half day\): KSh 6,000–7,500/);

  const camera = (await staff("GET", "/price-list")).body.items.find((item: any) => item.name === "Underwater camera hire");
  assert.equal((await staff("PATCH", `/price-list/${camera.id}`, { status: "hidden" })).status, 200);
  const all = await say(chat, SITE, raw64("get_prices", {}));
  assert.match(all, /Sunset dhow cruise: KSh 5,500 per person/);
  assert.doesNotMatch(all, /camera/i, "a hidden item isn't quoted");

  const helicopter = await say(chat, SITE, raw64("get_prices", { query: "helicopter flight" }));
  assert.match(helicopter, /Sunset dhow cruise/, "a short list comes whole when nothing matches");
  const misses = await staff("GET", "/knowledge/misses?days=30");
  assert.ok(misses.body.misses.some((miss: any) => miss.query === "price: helicopter flight"), "listed with the unanswered questions");

  // A place to stay has a price list too (its extras), next to its rooms.
  const stay = await openChat("coral", "https://coralcove.example");
  assert.match(await say(stay, "https://coralcove.example", "TEST:whoami"), /get_prices/);
  assert.match(await say(stay, "https://coralcove.example", raw64("get_prices", { query: "airport transfer" })), /not sure of that price/, "an empty list says so");
});

test("removing an item, and replacing the whole list", async () => {
  const items = (await staff("GET", "/price-list")).body.items;
  assert.equal((await staff("DELETE", `/price-list/${items[0].id}`)).status, 200);
  assert.equal((await staff("DELETE", `/price-list/${items[0].id}`)).status, 404);
  const replaced = await staff("POST", "/price-list/import", { items: [{ section: "Trips", name: "Sunset dhow cruise", price: 6000, unit: "per person" }], replace: true });
  assert.equal(replaced.status, 200);
  assert.deepEqual(replaced.body.items.map((item: any) => item.name), ["Sunset dhow cruise"]);
  assert.equal(replaced.body.items[0].description, null, "a replaced list starts afresh");
});
