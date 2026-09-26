// End-to-end: a business's knowledge from its website. A guesthouse gives
// its address; Zaina reads the home page and the pages it links to on the
// same site (robots.txt respected, files and other websites left alone),
// saves a source per page, and answers from them. Prices on the pages are
// hidden from Zaina: they come from the rooms and the price list. Addresses
// that lead into a private network are refused, even through a redirect.
//
// The websites are the stand-ins of scripted-model.mjs.

import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { after, before, test } from "node:test";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5087;
const SITE = "coralcove.example";

let platform: Platform;
let api: Api;
const tokens: Record<string, string> = {};
const staff = (method: string, route: string, body?: unknown, who = "owner") => api(method, `/v1/staff/businesses/coral${route}`, body, tokens[who]);
const page = (title: string, body: string, extra = "") => `<!doctype html><html><head><title>${title}</title>${extra}</head><body><nav><a href="/">Home</a></nav><main>${body}</main><footer>© Coral Cove</footer></body></html>`;

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

before(async () => {
  platform = await startPlatform({ port: PORT });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = await login("ops@example.com");
  const created = await api("POST", "/v1/platform/businesses", { id: "coral", name: "Coral Cove", business_type: "guesthouse", allowed_origins: [`https://${SITE}`], owner: { email: "amani@example.com", name: "Amani Otieno", password: PASSWORD } }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  tokens.owner = await login("amani@example.com");
  assert.equal((await staff("POST", "/members", { email: "brian@example.com", name: "Brian", role: "agent", password: PASSWORD })).status, 201);
  tokens.agent = await login("brian@example.com");

  platform.publishPage(SITE, "robots.txt", "User-agent: *\nDisallow: /private\n");
  platform.publishPage(SITE, "index.html", page("Coral Cove Guesthouse | Diani", `
    <h1>Karibu to Coral Cove</h1><p>A quiet guesthouse by the sea in Diani, ten minutes' walk from the beach. Breakfast is served on the terrace every morning.</p>
    <a href="/rooms">Rooms</a> <a href="/menu">Menu</a> <a href="/faq">FAQ</a> <a href="/policies">Policies</a> <a href="/contact">Contact</a>
    <a href="/private/staff">Staff</a> <a href="/brochure.pdf">Brochure</a> <a href="/empty">Gallery</a> <a href="/old-page">Our story</a>
    <a href="https://www.booking.com/hotel/ke/coral-cove">Booking.com</a> <a href="/wp-admin/">Admin</a> <a href="/rooms?utm_source=newsletter">Rooms</a>`,
  '<meta name="description" content="A quiet guesthouse by the sea in Diani, Kenya, with breakfast on the terrace.">'));
  platform.publishPage(SITE, "rooms.html", page("Rooms | Coral Cove", "<h1>Rooms</h1><h2>Garden cottage</h2><p>Sleeps four, with a kitchenette and a garden view. From KSh 12,000 a night.</p><h2>Sea room</h2><p>A double room facing the sea, with a balcony. KSh 9,500 per night including breakfast.</p>"));
  platform.publishPage(SITE, "menu.html.gz", gzipSync(page("Menu", "<h1>Menu</h1><ul><li>Swahili fish curry with coconut rice</li><li>Grilled prawns with chips and kachumbari</li><li>Fresh mango juice every morning</li></ul>")));
  platform.publishPage(SITE, "faq.html", page("FAQ", "<h2>What time is check-in?</h2><p>Check-in is from 2 pm and check-out is by 10 am. Early check-in depends on the room being ready.</p><h2>Is there parking?</h2><p>Yes, free parking inside the gate for guests.</p>"));
  platform.publishPage(SITE, "policies.html", page("Policies", "<h1>Cancellation policy</h1><p>Cancel up to 7 days before arrival for a full refund of the deposit. Later cancellations keep the deposit.</p>"));
  platform.publishPage(SITE, "contact.html", page("Coral Cove Guesthouse | Diani", "<h1>Contact</h1><p>Call or WhatsApp us on +254 700 123 456, or email stay@coralcove.example. We answer every day from 7 am to 9 pm.</p>"));
  platform.publishPage(SITE, "about.html", page("About Coral Cove", "<h1>Our story</h1><p>Coral Cove was built in 1998 by the Otieno family, who still run it today with a team of twelve from Diani and Ukunda.</p>"));
  platform.publishPage(SITE, "private/staff.html", page("Staff only", "<p>Rotas and the staff Wi-Fi password, which must never be read by a robot.</p>"));
  platform.publishPage(SITE, "empty.html", '<!doctype html><html><head><title>Gallery</title></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
  platform.publishPage(SITE, "_redirects.json", JSON.stringify({ "/old-page": "/about" }));
  // A website whose home page sends the reader into a private network.
  platform.publishPage("sneaky.example", "_redirects.json", JSON.stringify({ "/": "https://private.example/admin" }));
});

after(async () => {
  await platform?.stop();
});

test("a guesthouse's website becomes its knowledge: a source per page, most useful first", async () => {
  // A source the team wrote itself is never replaced by a page with the same title.
  assert.equal((await staff("POST", "/knowledge", { title: "FAQ", kind: "faq", content: "## Do you have Wi-Fi?\n\nYes, in every room." })).status, 200);
  assert.equal((await staff("POST", "/knowledge/import-website", { url: SITE }, "agent")).status, 403, "an agent can't");

  const imported = await staff("POST", "/knowledge/import-website", { url: SITE });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.site, SITE);
  const pages = new Map<string, any>(imported.body.pages.map((entry: any) => [new URL(entry.url).pathname, entry]));
  assert.deepEqual([...pages.keys()].sort(), ["/", "/about", "/contact", "/faq", "/menu", "/policies", "/rooms"]);
  assert.equal(pages.get("/")!.source.title, "Coral Cove Guesthouse | Diani (home)");
  assert.equal(pages.get("/contact")!.source.title, "Coral Cove Guesthouse | Diani (/contact)");
  assert.equal(pages.get("/faq")!.source.title, "FAQ (website)", "the team's own FAQ stays");
  assert.deepEqual([pages.get("/menu")!.source.kind, pages.get("/faq")!.source.kind, pages.get("/policies")!.source.kind, pages.get("/rooms")!.source.kind], ["menu", "faq", "policy", "page"]);
  assert.ok(pages.get("/rooms")!.hidden_amounts >= 2, "prices on the page are hidden from Zaina");
  assert.equal(imported.body.description, "A quiet guesthouse by the sea in Diani, Kenya, with breakfast on the terrace.");

  const skipped = new Map<string, string>(imported.body.skipped.map((entry: any) => [new URL(entry.url).pathname, entry.reason]));
  assert.match(skipped.get("/private/staff") ?? "", /robots\.txt/);
  assert.match(skipped.get("/empty") ?? "", /no text/);
  const read = platform.log("website").map((entry) => new URL(entry.url));
  assert.ok(read.every((url) => url.hostname === SITE), "no other website was read");
  assert.ok(!read.some((url) => /brochure|wp-admin|private/.test(url.pathname)), "files, admin pages and robots' no-go pages were never fetched");
  assert.equal(read.filter((url) => url.pathname === "/rooms").length, 1, "each page once");

  const own = (await staff("GET", "/knowledge")).body.sources.find((source: any) => source.title === "FAQ");
  assert.equal(own.url, null);
  const found = await staff("POST", "/knowledge/search", { query: "What time is check-in?" });
  assert.match(found.body.passages[0].text, /Check-in is from 2 pm/);
  const menu = await staff("POST", "/knowledge/search", { query: "fish curry" });
  assert.match(menu.body.passages[0].text, /Swahili fish curry/, "a compressed page is read too");
});

test("reading it again changes nothing that didn't change; a limit and drafts on request", async () => {
  const again = await staff("POST", "/knowledge/import-website", { url: `https://${SITE}/` });
  assert.equal(again.status, 200);
  assert.ok(again.body.pages.every((entry: any) => entry.unchanged), "the same pages, unchanged");
  assert.equal(again.body.pages.find((entry: any) => new URL(entry.url).pathname === "/faq").source.title, "FAQ (website)");

  platform.publishPage("newsite.example", "index.html", page("New Site", "<p>A small website with a home page and one more page, each with enough text to read.</p><a href='/more'>More</a>"));
  platform.publishPage("newsite.example", "more.html", page("More", "<p>The second page of the small website, with enough text to be worth reading into knowledge.</p>"));
  const limited = await staff("POST", "/knowledge/import-website", { url: "newsite.example", max_pages: 1, status: "draft" });
  assert.equal(limited.status, 200);
  assert.equal(limited.body.pages.length, 1);
  assert.equal(limited.body.pages[0].source.status, "draft");
});

test("addresses into a private network are refused, even through a redirect", async () => {
  for (const [url, pattern] of [
    ["https://private.example/", /isn't on the public internet/],
    ["https://10.0.0.5/", /isn't on the public internet/],
    ["http://localhost:5087/", /isn't on the public internet|standard https port/],
    ["sneaky.example", /isn't on the public internet/],
    ["https://nothing-here.example/", /answered 404/],
  ] as const) {
    const refused = await staff("POST", "/knowledge/import-website", { url });
    assert.equal(refused.status, 400, `${url}: ${JSON.stringify(refused.body)}`);
    assert.equal(refused.body.error, "website_unreadable");
    assert.match(refused.body.message, pattern, url);
  }
  assert.equal((await staff("POST", "/knowledge/import-website", {})).status, 400);
});

test("a business reads its website ten times an hour at most", async () => {
  // Every ask counts, read or refused: this file has asked eight times so far.
  const statuses = [];
  for (let attempt = 0; attempt < 3; attempt += 1) statuses.push((await staff("POST", "/knowledge/import-website", { url: SITE })).status);
  assert.deepEqual(statuses, [200, 200, 429]);
});
