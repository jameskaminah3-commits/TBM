#!/usr/bin/env node
// Read-only privacy checks against the live site. It sends GET and HEAD
// requests only (plus one sign-in, if you give it a test provider account),
// and prints status codes and field names, never names, emails, phone numbers
// or file contents.
//
//   node scripts/verify-live-privacy.mjs
//   node scripts/verify-live-privacy.mjs --base https://tembeabilamatata.com
//
// Existing document links (after running the storage inventory with
// production credentials; keep its output private and out of git):
//   node scripts/verify-live-privacy.mjs --inventory ./storage-inventory-private/objects.csv \
//     --public-base https://<project>.supabase.co/storage/v1/object/public/<media bucket>
//
// Signed-in provider checks, with a TEST provider account that has a test
// booking (never a real provider's account), from your own terminal:
//   VERIFY_PROVIDER_EMAIL=... VERIFY_PROVIDER_PASSWORD=... node scripts/verify-live-privacy.mjs
//
// Exit code 1 if any check fails. "SKIP" means the check needs something the
// run didn't have; it is not a pass.
import fs from "node:fs";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const BASE = (arg("base", "https://tembeabilamatata.com")).replace(/\/+$/, "");
const MAX_LISTINGS = Number(arg("max-listings", "8"));
const INVENTORY = arg("inventory");
const PUBLIC_BASE = arg("public-base")?.replace(/\/+$/, "") ?? null;

// TBM's own contact details are allowed anywhere.
const TBM_PHONE_DIGITS = "718475264";
const TBM_EMAIL_DOMAIN = /@(?:[a-z0-9-]+\.)*tembeabilamatata\.com$/i;
const privateListingFields = ["managerUserId", "documents", "registrationNumber", "ownershipType", "mileage", "availabilityPreference", "chauffeurArrangement"];
const hiddenBookingFields = ["guestPhone", "guestEmail", "userId", "paymentStatus", "paymentProvider", "paymentReference", "paymentAmount", "paymentAmountPaid", "paymentDepositAmount", "totalPrice", "adminLockNote", "marketingAttribution"];

const results = { pass: 0, fail: 0, skip: 0 };
function report(status, label, detail = "") {
  results[status.toLowerCase()] += 1;
  console.log(`${status.padEnd(4)} ${label}${detail ? ` — ${detail}` : ""}`);
}
const check = (ok, label, detail) => report(ok ? "PASS" : "FAIL", label, detail);
const section = (title) => console.log(`\n# ${title}`);

async function get(path, { cookie, method = "GET", absolute = false, redirect = "follow" } = {}) {
  const url = absolute ? path : `${BASE}${path}`;
  try {
    const response = await fetch(url, { method, redirect, headers: { accept: "application/json", ...(cookie ? { cookie } : {}) } });
    const text = method === "HEAD" ? "" : await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const html = /^\s*<!doctype html/i.test(text);
    return { status: response.status, json, text, html, headers: response.headers };
  } catch (error) {
    return { status: 0, json: null, text: "", html: false, error: error.message, headers: new Headers() };
  }
}

// Some releases answer unknown addresses with the website's own page (HTML,
// status 200) rather than a 404. That page is not a file, so it isn't a leak.
const isAppPage = (response) => response.status === 200 && /text\/html/i.test(response.headers.get("content-type") ?? "");

// Contact details in a response, other than TBM's own. Returns counts only.
function contactFindings(text) {
  const emails = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).filter((email) => !TBM_EMAIL_DOMAIN.test(email));
  const phones = (text.match(/(?:\+?254|\b0)[\s-]?[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g) ?? [])
    .filter((phone) => !phone.replace(/\D/g, "").endsWith(TBM_PHONE_DIGITS));
  return { emails: emails.length, phones: phones.length };
}
const describeContacts = ({ emails, phones }) => `${emails} email address(es), ${phones} phone number(s)`;

function keysDeep(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, found));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) { found.add(key); keysDeep(child, found); }
  }
  return found;
}
const listOf = (json) => (Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : []);

console.log(`Checking ${BASE} (read-only) on ${new Date().toISOString()}`);
const home = await get("/");
if (home.status !== 200) {
  console.log(`FAIL can't reach ${BASE} (status ${home.status}${home.error ? `, ${home.error}` : ""}). Nothing was checked.`);
  process.exit(1);
}

// ── A. Which code is live ────────────────────────────────────────────────
section("A. Which release is live");
const probeKey = `vehicle-document/2026-01/${crypto.randomBytes(16).toString("hex")}.pdf`;
const fileProbe = await get(`/api/files/${probeKey}`);
check(fileProbe.status === 401 && !fileProbe.html, "the protected-file route is live and refuses signed-out visitors (401)",
  fileProbe.html ? "got the web page instead: this code isn't deployed" : `status ${fileProbe.status}`);
const hubProbe = await get("/api/provider-program/stats");
report("PASS", "for information: Provider Hub redesign (dev branch) is " + (hubProbe.json && "show" in hubProbe.json ? "live" : "not live"), `status ${hubProbe.status}`);

// ── B. Public listings ───────────────────────────────────────────────────
section("B. Public listings carry no private fields, document links or contact details");
const kinds = [
  ["stays", "/api/stays"], ["cars", "/api/cars"], ["cooks", "/api/cooks"], ["errands", "/api/errands"], ["experiences", "/api/experiences"],
];
const sampleIds = {};
for (const [kind, path] of kinds) {
  const list = await get(path);
  if (list.status !== 200 || !list.json) { check(false, `${path} answers`, `status ${list.status}`); continue; }
  const items = listOf(list.json);
  sampleIds[kind] = items.slice(0, MAX_LISTINGS).map((item) => item.id).filter(Boolean);
  const leaked = privateListingFields.filter((field) => keysDeep(list.json).has(field));
  check(leaked.length === 0, `${path}: no private listing fields`, leaked.length ? leaked.join(", ") : `${items.length} listings`);
  check(!list.text.includes("/api/files/"), `${path}: no protected file links`);
  const contacts = contactFindings(list.text);
  check(contacts.emails + contacts.phones === 0, `${path}: no contact details`, describeContacts(contacts));
  for (const id of sampleIds[kind]) {
    const detail = await get(`${path}/${encodeURIComponent(id)}`);
    if (detail.status !== 200) { report("SKIP", `${path}/:id answers`, `status ${detail.status}`); continue; }
    const leakedDetail = privateListingFields.filter((field) => keysDeep(detail.json).has(field));
    const detailContacts = contactFindings(detail.text);
    check(leakedDetail.length === 0 && !detail.text.includes("/api/files/") && detailContacts.emails + detailContacts.phones === 0,
      `${path}/${id.slice(0, 12)}…: no private fields, file links or contact details`,
      [leakedDetail.join(", "), detailContacts.emails + detailContacts.phones ? describeContacts(detailContacts) : ""].filter(Boolean).join("; "));
  }
}

// ── C. Public calendars ─────────────────────────────────────────────────
section("C. Public calendars show dates only");
for (const [kind, prefix] of [["stays", "/api/stays"], ["cars", "/api/cars"], ["cooks", "/api/cooks"]]) {
  for (const id of (sampleIds[kind] ?? []).slice(0, 4)) {
    const calendar = await get(`${prefix}/${encodeURIComponent(id)}/availability`);
    if (calendar.status !== 200 || !calendar.json) { report("SKIP", `${prefix}/:id/availability answers`, `status ${calendar.status}`); continue; }
    const ranges = calendar.json.blockedRanges ?? [];
    const bad = ranges.filter((range) => !/^taken-\d+$/.test(String(range.id)) || range.guestName !== "Booked");
    const uuids = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(calendar.text);
    const contacts = contactFindings(calendar.text);
    check(bad.length === 0 && !uuids && contacts.emails + contacts.phones === 0,
      `${prefix}/${id.slice(0, 12)}…/availability: no names, booking IDs or contact details`,
      `${ranges.length} taken ranges${bad.length ? `, ${bad.length} with a name or booking ID` : ""}${uuids ? ", booking IDs present" : ""}`);
  }
}
for (const id of (sampleIds.experiences ?? []).slice(0, 3)) {
  const departures = await get(`/api/experiences/${encodeURIComponent(id)}/shared-departures`);
  if (departures.status !== 200) continue;
  const contacts = contactFindings(departures.text);
  check(contacts.emails + contacts.phones === 0 && !keysDeep(departures.json).has("guestEmail") && !keysDeep(departures.json).has("guestPhone"),
    `/api/experiences/${id.slice(0, 12)}…/shared-departures: no guest contact`, describeContacts(contacts));
}

// ── D. Private endpoints refuse signed-out visitors ──────────────────────
section("D. Provider, guest and admin data refuse signed-out visitors");
const privatePaths = [
  "/api/provider/booking-assignments", "/api/provider/stay-bookings", "/api/provider/car-bookings", "/api/provider/cook-bookings",
  "/api/provider/errand-bookings", "/api/provider/experience-bookings", "/api/provider/notifications", "/api/provider/payments",
  "/api/provider/contact-releases", "/api/provider/shares", "/api/inbox", "/api/bookings", "/api/admin/bookings", "/api/admin/media",
  "/api/admin/fleet-applications", "/api/admin/provider-applications", "/api/admin/payments", "/api/admin/marketing/shares",
];
for (const path of privatePaths) {
  const response = await get(path);
  const ok = response.status === 401 || response.status === 403 || response.status === 404 || response.html;
  check(ok && !(response.status === 200 && !response.html), `${path} signed out`, response.html ? "no such API on this release" : `status ${response.status}`);
}

// ── E. Old upload links ─────────────────────────────────────────────────
section("E. Old /uploads links don't serve files");
const uploadProbe = await get(`/uploads/${crypto.randomBytes(8).toString("hex")}-logbook.pdf`, { method: "HEAD" });
check(uploadProbe.status >= 400 || isAppPage(uploadProbe), "a made-up /uploads document link is not served",
  isAppPage(uploadProbe) ? `the site's own page (${uploadProbe.status}), not a file` : `status ${uploadProbe.status}`);

// ── F. Existing document links (from the storage inventory) ─────────────
section("F. Existing compliance documents are no longer public");
if (!INVENTORY || !PUBLIC_BASE) {
  report("SKIP", "existing document links", "run again with --inventory <objects.csv> --public-base <public bucket URL>");
} else {
  const lines = fs.readFileSync(INVENTORY, "utf8").split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(",");
  const pathIndex = header.indexOf("path");
  const privateIndex = header.indexOf("should_be_private");
  const categoryIndex = header.indexOf("category");
  const parse = (line) => {
    const cells = []; let cell = ""; let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) { if (char === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (char === '"') quoted = false; else cell += char; }
      else if (char === '"') quoted = true; else if (char === ",") { cells.push(cell); cell = ""; } else cell += char;
    }
    cells.push(cell);
    return cells;
  };
  const rows = lines.map(parse).filter((cells) => cells[privateIndex] === "yes");
  const stillOpen = [];
  const byCategory = {};
  for (let start = 0; start < rows.length; start += 6) {
    await Promise.all(rows.slice(start, start + 6).map(async (cells) => {
      const filePath = cells[pathIndex];
      const category = cells[categoryIndex];
      byCategory[category] = (byCategory[category] ?? 0) + 1;
      const direct = await get(`${PUBLIC_BASE}/${filePath.split("/").map(encodeURIComponent).join("/")}`, { method: "HEAD", absolute: true });
      let viaUploads = null;
      if (filePath.startsWith("legacy/")) {
        viaUploads = await get(`/uploads/${filePath.slice("legacy/".length)}`, { method: "HEAD" });
      }
      const open = (response) => response && response.status > 0 && response.status < 400 && !isAppPage(response);
      if (open(direct) || open(viaUploads)) {
        stillOpen.push(`${category}: ${filePath} (direct ${direct.status}${viaUploads ? `, /uploads ${viaUploads.status}` : ""})`);
      }
    }));
  }
  console.log(`     checked ${rows.length} protected files: ${Object.entries(byCategory).map(([key, count]) => `${key} ${count}`).join(", ") || "none"}`);
  check(stillOpen.length === 0, "no compliance document, application file or guest photo opens from a public link",
    stillOpen.length ? `${stillOpen.length} still open (paths only; keep this output private)` : "all refused");
  stillOpen.slice(0, 25).forEach((line) => console.log(`       ${line}`));
}

// ── G. A signed-in test provider ─────────────────────────────────────────
section("G. A provider sees guests through TBM only (test provider account)");
const email = process.env.VERIFY_PROVIDER_EMAIL;
const password = process.env.VERIFY_PROVIDER_PASSWORD;
if (!email || !password) {
  report("SKIP", "signed-in provider checks", "set VERIFY_PROVIDER_EMAIL and VERIFY_PROVIDER_PASSWORD for a test provider account");
} else {
  const signIn = await fetch(`${BASE}/api/auth/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: email, password }) })
    .catch(() => ({ status: 0, headers: new Headers() }));
  const cookie = signIn.headers.getSetCookie?.().map((value) => value.split(";")[0]).join("; ") ?? "";
  if (signIn.status !== 200 || !cookie) {
    report("FAIL", "the test provider can sign in", `status ${signIn.status}`);
  } else {
    const ownEmail = email.toLowerCase();
    const strip = (text) => text.split(ownEmail).join("");
    const jobs = await get("/api/provider/booking-assignments", { cookie });
    const entries = Array.isArray(jobs.json) ? jobs.json : [];
    const fieldLeaks = new Set(entries.flatMap((entry) => hiddenBookingFields.filter((field) => field in (entry.booking ?? {}))));
    check(jobs.status === 200 && fieldLeaks.size === 0, "job list has no guest contact, payment or internal fields", fieldLeaks.size ? [...fieldLeaks].join(", ") : `${entries.length} jobs`);
    const names = entries.map((entry) => entry.booking?.guestName).filter(Boolean);
    check(names.every((name) => /^\S+( [A-Z]\.)?$/.test(name)), "guests appear by first name and initial only", `${names.length} names checked`);
    if (!entries.length) report("SKIP", "job list content", "the test provider has no jobs: add a paid test booking to check this fully");
    for (const path of ["/api/provider/booking-assignments", "/api/provider/stay-bookings", "/api/provider/car-bookings", "/api/provider/cook-bookings",
      "/api/provider/errand-bookings", "/api/provider/experience-bookings", "/api/provider/notifications", "/api/inbox", "/api/provider/payments"]) {
      const response = await get(path, { cookie });
      if (response.status !== 200) { report("SKIP", `${path} as the provider`, `status ${response.status}`); continue; }
      const contacts = contactFindings(strip(response.text));
      check(contacts.emails + contacts.phones === 0, `${path}: no guest phone numbers or email addresses`, describeContacts(contacts));
    }
    const media = await get("/api/admin/media", { cookie });
    const mediaItems = listOf(media.json);
    check(media.status === 200 && mediaItems.every((item) => !String(item.url).includes("/api/files/") && !/\.pdf($|\?)/i.test(String(item.url))),
      "media library holds only the provider's own listing photos", `status ${media.status}, ${mediaItems.length} items`);
    for (const path of ["/api/admin/bookings", "/api/admin/payments", "/api/admin/fleet-applications"]) {
      const response = await get(path, { cookie });
      check(response.status === 401 || response.status === 403 || response.status === 404 || response.html, `${path} is refused to a provider`, `status ${response.status}`);
    }
    const otherFile = await get(`/api/files/${probeKey}`, { cookie });
    check(otherFile.status === 404, "a protected file that isn't theirs is refused without confirming it exists (404)", `status ${otherFile.status}`);
  }
}

console.log(`\n${results.pass} passed, ${results.fail} failed, ${results.skip} skipped`);
if (results.skip) console.log("Skipped checks are not verified. See docs/live-verification-checklist.md for what still needs doing.");
process.exit(results.fail ? 1 : 0);
