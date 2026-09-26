# Zaina Platform

Zaina as a product: the engine behind Tembea Bila Matata's concierge, run as
its own service so it can serve other businesses. It is a copy of the Zaina
inside the TBM app, built up phase by phase from the Productisation Plan.

**The live Zaina is not affected.** Nothing in the TBM app imports this
folder, TBM's build and deploy never include it, and it uses its own
database. TBM's website keeps talking to the Zaina inside the TBM app until
TBM is moved onto this service.

## How it fits together

```
website widget ──┐
(one script tag) ├──▶ gateway ──▶ engine ─────────▶ connector ──▶ the business's own system
WhatsApp ────────┘   (tokens,     (one turn: static  (TBM or       (TBM: listings, prices,
(Meta's signed        limits,      prompt, context,   basic)         bookings; others: leads)
 webhook)             websites)    history, tools,
     ▲                             knowledge search)
     │                                  │
     └──── delivery ◀───────────────────┘
           (in order, within WhatsApp's 24-hour rule)

staff console ──▶ staff API ──▶ platform database: businesses, conversations (web and WhatsApp),
(inbox, knowledge,  (cookie or     telemetry, usage, limits, staff, presence, settings, encrypted
 reports, settings,  token;        secrets, leads, knowledge, WhatsApp numbers and messages.
 team, platform)     roles)        Every business's rows are kept apart by Postgres.
     ▲
     └── alerts: web push to staff phones and browsers, and email
```

- `src/gateway/` — the public chat API: signed session tokens, shared rate
  limits, allowed websites, daily model budget, and the widget's settings.
- `src/channels/whatsapp/` — WhatsApp: the signed webhook, messages in
  (stored once, answered together), replies out (in order, within the
  24-hour window, with the follow-up template), statuses, the number's
  connection and the team's view of customers' photos.
- `src/engine/` — one chat turn (`agent.ts`, ported from the TBM app's
  `router.ts`) and the rules it runs on: reply policy, idempotency, contact
  checks, turn budget, session lock, failure policy, telemetry; the turn's
  context (`turn-context.ts`), a short history (`history.ts`), tools by
  business type (`tool-sets.ts`), the customer's language (`language.ts`) and
  the server's own texts in English and Swahili (`messages.ts`).
- `src/knowledge/` — each business's knowledge: sources and passages,
  ranked search that names its source, amounts hidden, the questions nothing
  answered, staff routes.
- `src/conversations/` — conversations in the platform database, the
  handoff lifecycle and its routing (who hears first), the team's alerts
  (web push and email), the inbox routes, retention and deletion requests.
- `src/console/` — serves the console and the widget script; the console's
  sign-in (an HttpOnly cookie) and phone alerts.
- `src/reports/` — each business's report.
- `src/booking/` — a place to stay's rooms and bookings (Phase 4): room
  types and their pricing rules (`pricing.ts`, the one pricing module),
  rooms free per night and holds (`availability.ts`), bookings from the first
  ask to a confirmed stay (`bookings.ts`), booking settings, what the guest
  and the team are told (`notices.ts`), and the staff routes.
- `src/payments/` — deposits into each business's own account: Paystack
  (`paystack.ts`), M-Pesa Express (`mpesa.ts`), M-Pesa codes the team checks,
  the booking's payment page, and the providers' webhooks and callbacks.
- `src/connectors/` — what a business plugs in. `tbm/` is TBM: its prompt and
  tools, its team alerts and chat M-Pesa recording; `tbm/tbm-app.ts` is the
  only file that reaches into the TBM app's code. `basic/` serves any other
  business: it answers from the business's own knowledge, takes leads and
  hands over to a person. `hospitality/` serves a place to stay: its rooms,
  prices and bookings.
- `knowledge/tbm/` — TBM's knowledge (areas, travel, services, booking and
  payment, policies), imported at every release.
- `src/businesses/` — the business directory, each business's settings, and
  its encrypted secrets.
- `src/staff/` — staff accounts, sign-in, roles, and the business console
  routes (settings, people, secrets, leads, reports, deletion requests).
- `src/platform/` — the platform's own routes: adding businesses, and every business's day.
- `src/db/` — the two database connections and business scope (`tenant.ts`).
- `src/cli/` — creating the first staff accounts; importing knowledge; the
  release step run before each deploy.
- `web/widget/` — the website widget (plain TypeScript, in a shadow root).
- `web/console/` — the business console (React), its service worker and styles.
- `migrations/` — reviewed SQL, applied in order and never edited once run.
- `test/eval/` — the evaluation suite: 110 conversations, graded.

## Phase status

**Phase 0 — hardening: done.** Every item from the Productisation Plan's
Phase 0, and every item the Technical Audit listed as dangerous, is closed in
this service:

| Item | What changed |
|---|---|
| C6 | Signed session tokens; rate limits per chat, per visitor and per business, shared in Postgres; a daily model budget per business; only the business's websites may call it |
| I3 | One turn at a time per conversation; a second message gets "still working" |
| I4 | A 25-second budget per turn; a slow model gets a polite retry request, and anything already booked still reaches the customer |
| C4b | One model error asks the customer to try again; three in a row hand over |
| C4c | Staffed hours; outside them the customer is told when the team is back and a callback is requested; an unclaimed handoff returns to Zaina after 10 minutes; staff can hand a chat back |
| C5 | An M-Pesa code typed in chat is recorded against that chat's booking, its dates held for review, and the team told; a code reused for another booking is refused |
| I15 | Telemetry for every turn: time, model calls, tokens, tools, outcome; cost per conversation report |
| I17 | Conversations deleted 90 days after the last message (per business); card numbers removed before storing; a customer's conversations deleted on request |
| I18 | Reviewed SQL migrations with indexes, instead of schema push |
| Contact details | Booking tools take a name, email and phone only as the customer typed them |

**Phase 1 — business separation: done.** One service now serves several
businesses, and each one's data is kept apart by the database, not by the
application remembering to filter:

| Part | What it does |
|---|---|
| Row-level security | Business queries run as the restricted `zaina_app` role, one short transaction per query, scoped to one business. A query that forgets its filter still sees only that business's rows; with no business in scope it sees nothing; writing a row for another business is refused. Bulk queries also name the business, so each guard works on its own |
| Linked rows stay inside a business | Messages, metrics, payments and leads can only point at a conversation of their own business (composite foreign keys) |
| Directory and passwords | The service can read the business directory but not change it (a business can't lift its own model budget); it never reads password hashes, and sees only the staff of the business in scope |
| Settings | Each business's name, assistant name, description, contact details and the links and numbers Zaina may pass on. TBM's are today's values. Checked before saving |
| Secrets | Payment keys, messaging tokens and a business's own model key, encrypted with AES-256-GCM under a key kept outside the database; each secret is bound to its business and name; keys can be rotated; values are never shown again |
| Staff accounts | Email and password (scrypt); at most 10 sign-in tries per account every 15 minutes; 12-hour tokens; a new password signs out everywhere |
| Roles | Per business: viewer (reads chats), agent (answers them), manager (settings, people, reports, deletion requests), owner (secrets, managers and owners). A business always keeps an owner. Platform admins act as owner anywhere, for support |
| New businesses | A platform admin adds a business, its settings and its first owner in one step. It starts with a daily model budget (5 million tokens) and 90-day retention |

Exit check:

- **Separation.** A second business, Acme Guesthouse, runs on the same
  service. Its staff get "not found" for everything of TBM's, and TBM's staff
  for everything of Acme's. It chats on its own instructions, tools and
  rules for links and numbers. A deletion request at Acme leaves TBM's copy
  of the same customer alone. Even a validly signed chat token that pairs
  Acme with a TBM chat finds nothing.
- **The tests can fail.** The database tests were run against migrations
  with the chats table's security removed, and eight of them failed.
- **TBM unchanged.** The same 13 scripted conversations still produce
  word-for-word the same replies here as in the live Zaina.

Decisions to confirm:

- TBM's starting settings (migration `0002`) are proposals: staffed
  07:00–22:00 Kenya time, callbacks after 10 unclaimed minutes, 30 million
  model tokens a day, transcripts kept 90 days.
- The defaults for new businesses: 5 million tokens a day and 90 days.
- Who gets the first platform admin account (made on the command line).

**Phase 2 — knowledge and a lean prompt: built; the live evaluation needs a
model key.** Each business's knowledge is searched per question instead of
pasted into every prompt, and the prompt never changes between calls:

| Part | What it does |
|---|---|
| Knowledge | Each business's own sources (web pages, FAQs, policies, guides, menus) cut into short passages. Zaina searches them for questions about the business and answers only from what comes back, naming the source and its link. Amounts in documents are hidden from Zaina: prices come from the booking tools or the team. Questions nothing answered are kept for the business to fill. Kept apart per business by row-level security, like everything else |
| TBM's knowledge | The catalog that was pasted into every call is now 15 short documents (`knowledge/tbm/`): Coast areas, getting here, travel tips, how booking and payment work, cancellation, each service, listing verification, custom requests, trip planning |
| A static prompt | TBM's rules, condensed from the TBM app's prompt, with nothing that changes from call to call; the time, currency and language travel with each customer message (`<turn_context>`). The same instructions and tools on every call can be cached by the model provider |
| Tools by business type | Every business gets knowledge search and a handoff; a travel concierge (TBM) also gets its search, pricing and booking tools; a general business its lead tool. Tool descriptions no longer repeat the prompt |
| Short history | The last 12 events as they were; older tool results cut to ids, names, prices, links and errors; nothing beyond 40 events except a note of anything payable made earlier |
| Swahili | A customer writing in Swahili gets replies in Swahili, and the server's own texts (payment steps, busy, retry, handoff, M-Pesa confirmations) in Swahili too. Those are drafts until a fluent speaker has checked them |
| Evaluation | 110 conversations for TBM and a second business, in English and Swahili, 18 of them injection attempts, 50 critical (money, safety, privacy, injection). Graded from the replies and the tools called; every reply is also checked for invented prices, internals, foreign numbers and links |

Exit check:

- **Input tokens per call: 27% of before.** The same conversations, counted
  with the Gemini tokenizer: 20,067 input tokens per model call before, 5,446
  after (target: a third, 6,689). Per customer message, 28,242 before and
  8,472 after. The prompt went from about 16,000 tokens to 2,050 and the
  tools from 3,900 to 3,050. The live evaluation re-measures this from the
  model's own usage figures.
- **Knowledge search.** Every answerable question in the suite (31) finds
  its source in the top three; questions nothing answers mostly get
  passages that don't answer them, and Zaina must still say it doesn't know.
- **TBM unchanged where it matters.** The same 13 scripted conversations
  still produce word-for-word the same replies here as in the live Zaina:
  the tools, the reply policy and the payment steps are unchanged.
- **Evaluation pass rate: to agree and run.** Proposed bar: 90% of all cases
  and every critical case. The suite and its grading are tested; running it
  needs the real model (`GEMINI_API_KEY`).

Decisions to confirm:

- The evaluation bar above.
- The Swahili texts (`src/engine/messages.ts` and the payment steps in
  `src/engine/reply-policy.ts`), checked by a fluent speaker.
- TBM's published support hours are Monday to Saturday, 8 AM to 8 PM; the
  staffed hours proposed in Phase 0 are every day, 07:00 to 22:00. Which
  should handoffs follow?

**Phase 3 — channels and console: built; a real WhatsApp number needs the
platform's Meta app.** Customers reach a business on its website and on
WhatsApp, and its team works from a console:

| Part | What it does |
|---|---|
| Website widget | One script tag per business (its public key). Only the business's own websites can use it. It has the business's name, colour, corner and greeting. The chat resumes on the next visit, and the team's replies appear while they have the chat. Shadow DOM, keyboard and screen-reader friendly, full screen on phones, 12 KB |
| WhatsApp | The WhatsApp Cloud API through one webhook for the platform, checked against Meta's signature. Messages are stored once (Meta retries) and answered together when they arrive together. Replies go out in order: free-form within 24 hours of the customer's last message; after that, the business's approved follow-up template and the reply waits for the customer. Delivery statuses, retries when Meta is busy, and a failed message skipped rather than blocking the chat. Photos, voice notes and documents are kept for the team, and Zaina says she reads text only. The customer's number counts as a contact they gave. Blue ticks and "typing…" |
| Connecting a number | An owner enters the phone number ID, account ID and a permanent token. Meta checks the token before anything is saved; the token is stored encrypted and never shown again. A number can belong to one business only |
| Handoff routing | A waiting chat goes first to one person who is taking chats (the one with the fewest in hand), then to everyone after 3 minutes. The unclaimed timeout, callbacks and "hand back to Zaina" work as before. People show they're taking chats in the console |
| Alerts | Web push to staff phones and browsers (the console can be installed on the home screen) and email: a waiting chat, still waiting, a callback, a reply from the customer they're helping, and trouble for managers. Each person can turn emails off |
| Console | Sign-in with an HttpOnly cookie and a strict content policy. Inbox (waiting, mine, with the team, callbacks, all) with claim, reply, hand back and close, WhatsApp ticks and the 24-hour window, and customers' photos. Knowledge (documents, "what would Zaina find?", unanswered questions). Reports. Settings (business, widget and embed code, WhatsApp, hours). Team and secrets. A platform view for its admins. Works on phones, light and dark |
| Reports | Chats by channel, handled by Zaina alone, handoffs picked up within 15 minutes (the plan's 90% target), time to claim and to first reply, Zaina's reply times and failures, bookings and deposits asked in chat, unanswered questions, cost; chats per day. The platform view shows every business's model use against its budget |
| Deploying | Its own Railway service (`railway.json`) and its own Supabase project for the database. The release step runs migrations, sets the restricted role's password, creates the first admin and imports TBM's knowledge. See DEPLOY.md |

Exit check (the plan's: "a pilot business answers its WhatsApp customers
end to end"):

- **End to end on WhatsApp, as a pilot would use it.** Acme Guesthouse
  connects its number (Meta checks the token). Meta's signed webhook reaches
  Zaina, who answers from Acme's knowledge on WhatsApp, citing it. Asking for
  a person reaches the available agent's phone first. She claims the chat in
  the console and her reply goes out on WhatsApp under her name. The
  customer's answer buzzes her phone. After 24 hours her reply waits behind
  Acme's approved template and goes out when the customer writes. The
  inbound and outbound Graph API run on a stand-in with Meta's formats
  (`test/e2e/channels.test.ts`, 19 tests); a real number needs the platform's
  Meta app (DEPLOY.md, section 4).
- **In a browser.** The widget and console, driven in Chromium on desktop
  and phone widths, light and dark: no content-policy violations, no page
  errors, no sideways scrolling.
- **TBM unchanged where it matters.** The same 13 scripted conversations
  still produce word-for-word the same replies here as in the live Zaina,
  and web chats cost the same tokens per call as in Phase 2.

Decisions to confirm:

- The platform's Meta app: who owns it, and the first pilot number.
- The follow-up template's wording (a utility template, approved by Meta).
- Routing: first to one available person for 3 minutes, then everyone.
- Where the platform lives: `zaina.tembeabilamatata.com` or another domain.

**The database: Supabase.** The platform's database is a Supabase project of
its own, separate from TBM's (DEPLOY.md). The service connects through
Supabase's session pooler: the owner as `postgres.<project-ref>`, and
business queries as `zaina_app.<project-ref>`. TLS follows `sslmode` the way
psql reads it. With the project's CA certificate in `PLATFORM_DATABASE_CA`,
the server's certificate is checked. Without it, the connection is encrypted
but unchecked, and the service logs a warning. The service refuses setups
that can't work: the transaction pooler (port 6543), a pooler user without
its project, a restricted role on another database, or no encryption to a
remote database. Migration 0006 takes Supabase's Data API roles off every
platform table, sequence and function, including those later migrations
add. Functions are callable only by the roles given them. The database
tests run in a database set up like Supabase (its API roles and their
default grants). Before release, the whole service was run against a
Postgres 16 set up the way Supabase is:
- `postgres` is not a superuser, but can create roles and bypasses
  row-level security;
- the API roles have their default grants;
- TLS runs with its own CA.

On it, the release step, sign-in as `zaina_app`, a chat and the team's
inbox all work. Wrong certificates, passwords and host names fail with
what to check.

**Phase 4 — hospitality pilot: built; the pilot itself needs three real
businesses.** A guesthouse, lodge or small hotel sells its rooms through Zaina,
on its website and on WhatsApp, and takes deposits into its own account:

| Part | What it does |
|---|---|
| Room types (I11) | Each business's own room types: how many identical rooms, how many guests each sleeps, a description, and how it's booked. Ten identical studios are one room type with ten rooms. Added in the console one by one or from a spreadsheet (CSV). A room type with bookings is hidden, never deleted |
| One pricing module (I1) | Each room type's rules: a nightly price, Friday and Saturday nights, seasons (which may cross the new year, with their own minimum stay), extra guests per night, fees (per booking, room, room night, guest or guest night: conservancy fees and levies), a deposit, and tax included or added. The same function prices Zaina's quotes, the payment page, the console and the charge, so they can't disagree. Amounts are whole cents; deposits are rounded to whole shillings |
| Rooms free, and holds | A room is taken on a night by a confirmed booking, by an unpaid booking or a request while its hold lasts, or by closed dates. Booking locks the room type for one short transaction, so two guests can't both get the last room. An unpaid hold ends on its own (30 minutes by default), and the rooms are free again |
| Ways to book | Online: the guest books and pays the deposit, and paying confirms it. On request: the team accepts, at the quoted price or one they agree, or declines. By enquiry: Zaina takes the guest's details for the team. With no deposit, a booking is confirmed at once and paid at the property. The team can also book for a guest who calls |
| The business's own payment account | Paystack, with the business's own secret key (card and M-Pesa on Paystack's page, confirmed by Paystack's signed webhook or by asking Paystack) or as a subaccount of the platform's account. M-Pesa Express on the business's own paybill or till: a payment prompt on the guest's phone, confirmed by Safaricom's callback and then by asking Safaricom (callbacks aren't signed). A paybill or till the guest pays by hand, sending the M-Pesa code in the chat or on the payment page, which the team checks. Keys are checked with Paystack or Safaricom, then kept encrypted |
| C1 at payment | Starting to pay re-checks the booking's rooms: a lapsed hold is renewed if they're still free, and refused if they're gone. Money that arrives after the rooms went marks the booking "paid, needs a room" and alerts managers, to move the guest or refund |
| The payment page | Each booking's link: its price line by line, where it stands, and the ways to pay. No scripts, and a strict content policy. It reloads itself while a phone prompt waits. Payment attempts are limited per booking and per visitor, so a link can't be used to flood a phone with prompts |
| Zaina's tools | `list_rooms`, `check_availability` (prices only from the pricing module), `create_booking` (with the name and phone or email the guest typed; on WhatsApp their number counts), `get_booking`, and leads. After a booking, the server writes the payment link and "what happens next", in English or Swahili. An M-Pesa code sent in the chat is recorded against the chat's booking (C5) |
| Telling people | The guest hears in their chat (delivered on WhatsApp too) and by email: confirmed, accepted with the payment link, declined, cancelled, a code not found. The team gets web push and email: a request to answer, a code to check, a new booking, a paid booking without rooms |
| Console | Bookings (upcoming, requests, awaiting deposit, needs you, past, cancelled) with each booking's price, payments and actions; a calendar of rooms free per night; Rooms with the pricing editor and "try a quote"; closed dates; Settings → Bookings & payments |
| Reports | Stays: bookings made and where they stand, nights sold, value booked, deposits collected by how they were paid, and chats that led to a booking. The platform view tracks the pilot's exit check for each place to stay |
| Deletion requests | A guest's bookings stay, as the business's records of money and nights, without their name, email, phone and notes |
| The business decides (migration 0008) | Deposits, the ways to pay and the limits are each business's own settings, not Zaina's. The deposit is none, a percentage, a fixed amount per booking or the whole price (a room type can have its own). Until a business chooses, nothing is charged online: bookings from the chat come in as requests for its team. It also sets the order the payment page offers the ways to pay, the most one payment can be by each, how long bookings are held (for the deposit, while paying, while a request is decided, after it's accepted, while an M-Pesa code is checked), the notice it needs, how far ahead and how long guests can book, and how many payment tries and M-Pesa prompts a booking gets. The platform only keeps each within safe bounds (the database checks them too); the per-visitor limit across all businesses stays the platform's guard against abuse |

Exit check (the plan's: "three pilot businesses live for 30 days, with
bookings and deposits flowing"). A real pilot needs three businesses; the
capability is proven with a simulated one (`test/e2e/bookings.test.ts`, 15
tests):
- **Coral Cove Guesthouse** takes a website booking: the exact price, a
  held room, a Paystack deposit into its own account (webhook, and the guest's
  return), and a confirmation in the chat and by email.
- **Lakeview Lodge** imports its rooms from a spreadsheet and takes a
  WhatsApp booking with a conservancy fee per guest per night. The deposit
  is paid by an M-Pesa prompt on its own till. The tests also cover a prompt
  the guest cancels, one whose callback never arrives (found by asking), and
  the limit on prompts.
- **Old Town House** takes a request. The team accepts it at an agreed
  price, and the guest pays the till by hand and sends the code in the chat.
  The team confirms it, and the rest is paid at the house.

The platform's overview then shows all three with bookings and deposits. It
shows "3 of 3" once their first chats are moved 31 days back.

Also checked:
- **The rules hold under pressure.** Three guests racing for the last room
  get one booking. A late payment for rooms that went meanwhile becomes a
  conflict for the team. Each business sees only its own rooms, bookings and
  payments (`test/db/bookings.test.ts`).
- **In a browser.** Bookings, calendar, rooms, settings, reports, the
  platform page and the payment page, in Chromium at desktop and phone
  widths, light and dark: no content-policy violations, no page errors, no
  sideways scrolling.
- **TBM unchanged.** The 13 scripted conversations still give word-for-word
  the same replies as the live Zaina. The evaluation gives the same results
  and tokens per call as in Phase 3.

Decisions to confirm:

- The three pilot businesses, and which way each takes deposits.
- Deposits, ways to pay and limits: decided by each business (see "The
  business decides" above). The starting values for holds and limits are
  only suggestions it changes; the deposit has none.
- Whether the platform needs a Paystack account of its own (for businesses
  paid through its subaccounts) or every business brings its own.
- Refunds are made in Paystack's dashboard or M-Pesa, not from the console.

### Phase 5: second business type, self-serve (in progress)

Salons and restaurants book time, not nights. They use the same bookings,
payments, payment page, deposits and notices as a place to stay; what
changes is what is booked and how "free" is worked out (migration 0009).

| Part | What it does |
|---|---|
| Business types | `salon` (a salon, barber or spa: services with a stylist or chair) and `restaurant` (tables for a party). Each gets the appointments connector and the Services (or Tables) page |
| Opening hours | The business's week, a list of spans per day (a closing time before the opening one runs past midnight: a Friday 18:00–01:00), and how often a booking can start (every 5 to 120 minutes) |
| People, chairs and tables | What a booking takes. Each can keep its own working hours inside the business's; a table has its seats and the smallest party it's given to, so a table for ten isn't used for two |
| Services and table bookings | A length, the time after each before the next (clean-up, resetting a table), party sizes, a price per booking and/or per person (a table is usually free), how it's booked (online, on request, by enquiry), and who can do it (none listed: anyone that fits) |
| Free times | Every interval from opening while the booking ends by closing, after the business's notice, within how far ahead it takes bookings, with someone free: not booked (confirmed, or held while the hold lasts, plus the buffer) and not closed. Booking locks the business's slots for one short transaction, so the last table at 8 pm goes to one customer. Tables go to the smallest that fits |
| Closures | Time off or a private event, for one person or table or the whole place |
| Holds and late payments | As for rooms: an unpaid slot is held for the deposit, a lapsed hold is renewed at payment if the time is still free, and a late payment moves to another free person or table at the same time if its own was taken; otherwise the team sorts it out |
| Zaina's tools | `list_services` (what can be booked, hours, the business's rules), `check_times` (times free on a day, and the next days with times if it's full), `create_appointment` (with the customer's own details), `get_booking`, and leads. The server writes the payment block ("This time is held until…", "The rest is paid when you arrive") |
| Console | Services (or Tables): opening hours, services, people and tables, closures. Bookings: the same lists, with each booking's time and who it's with; a day's schedule per person or table; booking a time for a customer who calls. Settings → Bookings & payments without check-in times and nights |

## Running it locally

It runs from the repository root, using the root `node_modules`. It needs
Postgres 15 or newer.

```
PLATFORM_DATABASE_URL   the platform's own Postgres database (its owner: migrations and platform work)
SESSION_TOKEN_SECRET    at least 32 characters; signs chat and staff tokens
PLATFORM_SECRETS_KEY    32 random bytes, base64 or hex (openssl rand -base64 32); encrypts business secrets
GEMINI_API_KEY          the model key (a business's own gemini_api_key secret overrides it)
TBM_DATABASE_URL        TBM's database, for the TBM connector; without it TBM's chats are refused
```

Phase 3, each optional: `PUBLIC_BASE_URL` (the service's address: the widget
snippet, the webhook, links in alerts), `WHATSAPP_APP_SECRET` and
`WHATSAPP_VERIFY_TOKEN` (the platform's Meta app; both, or WhatsApp is off),
`WHATSAPP_GRAPH_VERSION` (`v23.0`), `WEB_PUSH_PUBLIC_KEY`,
`WEB_PUSH_PRIVATE_KEY` and `WEB_PUSH_SUBJECT` (alerts on phones),
`RESEND_API_KEY` and `ALERT_FROM_EMAIL` (alert emails), `ROUTE_ESCALATE_MINUTES`
(3) and `AVAILABILITY_HOURS` (2).

Phase 4, optional: `PLATFORM_PAYSTACK_SECRET_KEY` (the platform's own
Paystack account, for businesses paid through its subaccounts). Payment links
and M-Pesa callbacks need `PUBLIC_BASE_URL`. Tests only:
`BOOKING_SWEEP_INTERVAL_MS` (60000) and `PAYMENT_CHECK_AFTER_MS` (20000 for
the payment page, 45000 for the sweep: when a pending payment's provider is
asked).

Optional: `PLATFORM_APP_DATABASE_URL` (see below), `PLATFORM_DATABASE_CA`
(the CA certificate that signs the database server's, so it is checked),
`PLATFORM_DB_POOL_MAX` (10: connections for business queries), `PLATFORM_SECRETS_KEY_ID`
(`k1`) and `PLATFORM_SECRETS_OLD_KEYS` (`id:key,…`, to rotate the secrets
key), `PORT` (5070), `TURN_BUDGET_MS` (25000), `TRUST_PROXY` (1), `LIMIT_*`
rate limits (see `src/config.ts`), `MODEL_PRICE_INPUT_USD_PER_MTOK` and
`MODEL_PRICE_OUTPUT_USD_PER_MTOK` (cost in reports), `EXTRA_ALLOWED_ORIGINS`
(local and staging only), and TBM's own email and push settings
(`RESEND_API_KEY`, `NOTIFICATION_EMAILS`, …) for team alerts.

```
cd zaina-platform
npm run migrate     # apply migrations (a release step in production)
npm run knowledge:import -- --business tbm --dir zaina-platform/knowledge/tbm   # TBM's knowledge (also a release step)
STAFF_PASSWORD='…' npm run staff:create -- --email you@example.com --name "You" --platform-admin
npm run build:web   # the widget and console, into dist/public (the server serves them)
npm run dev         # start with tsx: the console is at http://localhost:5070/console/
npm run build       # bundle the service, the release step and the web assets to dist/
npm run release     # the release step (after build): migrations, the zaina_app password, first admin, TBM's knowledge
npm start
```

`staff:create` also adds someone to a business: `--business tbm --role owner`.
The password comes from `STAFF_PASSWORD`, never the command line. Everyone
else is added through the API.

**The restricted role.** The migrations create `zaina_app`. By default the
service signs in as the database owner and switches to `zaina_app` for every
business query, which protects against any query that forgets its business.
For production, let the service sign in as `zaina_app` itself, so even
injected SQL couldn't switch back:

```
PLATFORM_APP_DATABASE_URL=postgres://zaina_app:…@host/db     # on Supabase's pooler: zaina_app.<project-ref>
```

The release step (`npm run release`) gives `zaina_app` that password when it
can't sign in with it yet. By hand: `alter role zaina_app login password '…'`,
as the owner. The service refuses to start if business queries would run
unrestricted, or if the two addresses aren't the same database.

## API

Public (the widget): `POST /v1/sessions` with `{ business_key, display_currency }`
returns a `token`; send it as `Authorization: Bearer …` to `POST /v1/chat`
(`{ message }`), `GET /v1/session` and `GET /v1/chat/messages?after=<id>`.

Staff sign in with `POST /v1/staff/login` (`{ email, password }`) and send the
token as `Authorization: Bearer …`. `GET /v1/staff/me` lists their businesses
and roles; `POST /v1/staff/me/password` (`{ current, next }`) changes the
password.

Per business, under `/v1/staff/businesses/:businessId/` (least role needed):

| Route | Role |
|---|---|
| `GET sessions?filter=waiting\|active\|callbacks\|all`, `GET pending-count`, `GET sessions/:id` | viewer |
| `POST sessions/:id/claim`, `…/messages`, `…/release`, `…/close`, `…/callback-done` | agent |
| `GET leads` | agent |
| `GET settings` | viewer |
| `PATCH settings`, `GET members`, `POST members`, `DELETE members/:userId` | manager (managers and owners are added or removed by an owner) |
| `GET metrics?days=7`, `POST erase` (`{ email?, phone? }`), `DELETE sessions/:id` | manager |
| `GET secrets` (names only) | manager |
| `PUT secrets/:name` (`{ value }`), `DELETE secrets/:name` | owner |
| `GET knowledge`, `GET knowledge/:sourceId`, `POST knowledge/search` (`{ query }`: what Zaina would find) | viewer |
| `GET knowledge/misses?days=30` (questions nothing answered) | agent |
| `POST knowledge` (`{ title, kind?, url?, language?, content \| faqs, status? }`, replaces a source with the same title), `PUT knowledge/:sourceId`, `DELETE knowledge/:sourceId` | manager |

A business someone doesn't work for answers "not found", as if it didn't
exist. A knowledge save answers with the passages it made and how many
amounts it hides from Zaina.

**Knowledge formats.** Markdown or text, with an optional header
(`title`, `kind`: page, faq, policy, guide, menu or document, `url`,
`language`: en or sw), or an FAQ list (`[{ question, answer }]`). The import
command also reads a folder of such files or fetches a web page
(`--url https://…`); PDFs are converted to text first (for example with
`pdftotext`).

Platform admins: `GET /v1/platform/businesses`, and `POST /v1/platform/businesses`
with `{ id, name, allowed_origins, business_type?, time_zone?, daily_token_cap?,
retention_days?, owner: { email, name, password } }`, which returns the
business's widget key. `business_type` is `general` (the default) or
`guesthouse`; a `travel_concierge` needs its own connector first, as TBM has.

Phase 3:

| Route | Who |
|---|---|
| `GET /widget.js` | any website (it only works on the business's own) |
| `GET /v1/widget/config?key=<public key>` | the business's websites: name, colour, corner, greeting |
| `GET`, `POST /v1/whatsapp/webhook` | Meta: the handshake, then signed deliveries |
| `POST`, `DELETE /v1/console/session`, `GET /v1/console/me` | the console: sign in and out (cookie), who is signed in |
| `POST`, `DELETE /v1/console/push-subscriptions` | anyone signed in: alerts on this phone or browser |
| `GET`, `POST presence` (`{ available? }`) | viewer (only people who answer chats can take them) |
| `GET members/me`, `PATCH members/me` (`{ alert_email }`) | viewer: my role and alert emails |
| `GET operations`, `PATCH operations` (`{ time_zone?, staffed_hours?, unclaimed_timeout_minutes?, allowed_origins? }`) | viewer / manager (websites: owner) |
| `GET reports?days=30` | manager |
| `GET whatsapp` / `PUT`, `DELETE whatsapp` | manager / owner |
| `GET whatsapp/media/:mediaId` | viewer: a photo or document a customer sent to this business |
| `GET /v1/platform/overview` | platform admins |

The sessions list also takes `filter=mine` and `filter=everything`, and
answers with each chat's channel, customer and WhatsApp window. A team reply
to a WhatsApp chat answers with its delivery (`delivered`, `window_closed`, …).

Phase 4, a place to stay (least role needed):

| Route | Who |
|---|---|
| `GET booking-settings` / `PATCH booking-settings` (`{ currency?, deposit_type? (none, percent, fixed, full), deposit_percent?, deposit_fixed_minor?, payment_order?, method_max_minor?, pay_at_venue?, hold_minutes?, request_hold_hours?, accepted_hold_hours?, payment_hold_minutes?, code_check_hours?, booking_horizon_days?, max_nights?, min_notice_hours?, pay_attempts_limit?, mpesa_prompts_limit?, check_in_time?, check_out_time?, cancellation_policy?, tax_name?, tax_percent?, tax_included? }`; the reply includes each limit's `bounds`) | viewer / manager |
| `PUT payments/paystack` (`{ mode: "own_keys", secret_key }` or `{ mode: "subaccount", subaccount }`), `PUT payments/mpesa-express` (`{ environment, type, shortcode, till?, consumer_key, consumer_secret, passkey }`), `PUT payments/mpesa-manual` (`{ type, number, account? }`), `DELETE payments/:method` | owner |
| `GET offerings` / `POST offerings`, `PUT offerings/:id`, `DELETE offerings/:id`, `POST offerings/import` (`{ csv }`) | viewer / manager |
| Time slots (salons, restaurants): `PATCH booking-settings` also takes `{ opening_hours, slot_interval_minutes }`; offerings are services or table bookings (`{ name, duration_minutes, buffer_minutes?, min_party?, max_party?, pricing: { price?, per_person?, fees?, deposit_percent? or deposit_fixed? }, booking_mode?, resource_ids? }`) | viewer / manager |
| `GET resources` / `POST resources`, `PUT resources/:id`, `DELETE resources/:id` (`{ name, kind: staff, chair, table, room or other, seats?, min_party?, hours? }`) | viewer / manager |
| `GET slots?offering_id=&date=&party=&resource_id=`: the times free that day, and who's free for each | viewer |
| `GET schedule?date=`: each person or table's bookings and closures that day | viewer |
| `GET closures?from=&days=` / `POST closures` (`{ resource_id?, starts_at, ends_at, reason? }`), `DELETE closures/:id` | viewer / manager |
| `POST bookings` for a time slot: `{ offering_id, date, time, party?, resource_id?, customer_name, customer_phone or customer_email, notes?, confirm_now? }` | agent |
| `POST quote` (`{ offering_id, check_in, check_out, guests, rooms? }`), `GET calendar?from=&days=`, `GET blocks` | viewer |
| `POST blocks` (`{ offering_id, starts_on, ends_on, units?, reason? }`), `DELETE blocks/:id` | manager |
| `GET bookings?filter=upcoming\|requests\|unpaid\|attention\|past\|cancelled\|all`, `GET bookings/:id` | viewer |
| `POST bookings`, `POST bookings/:id/accept` (`{ total?, note? }`), `…/decline`, `…/confirm` (`{ note?, force? }`; force: manager), `…/payments` (`{ method, amount, receipt? }`), `POST payments/:id/confirm`, `POST payments/:id/reject` | agent |
| `POST bookings/:id/cancel` (`{ reason?, tell_customer? }`) | manager |

Public: `GET /pay/:token` (the booking's payment page), `POST /pay/:token/paystack`,
`GET /pay/:token/done`, `POST /pay/:token/mpesa`, `POST /pay/:token/mpesa-code`,
`GET /pay/:token/status`. Providers: `POST /v1/payments/paystack/:businessId`
(a business's own Paystack account), `POST /v1/payments/paystack` (the
platform's), `POST /v1/payments/mpesa/:token` (Safaricom's callback).

## Tests

```
npm test            # unit tests (no database): 164
npm run test:db     # database checks, including separation between businesses: 53
                    # PLATFORM_TEST_DATABASE_URL, a local database ending in _test (wiped)
npm run test:e2e    # the whole service with a scripted model, TBM and a second business,
                    # the Phase 3 channels (WhatsApp, alerts, console, widget), and the
                    # Phase 4 pilot (three places to stay, their payments), and a
                    # salon and a restaurant booking time (Phase 5): 73
                    # also TBM_TEST_DATABASE_URL, a local copy of TBM's schema ending in _test
npm run check       # type check (the service, and the widget and console)

npm run eval -- --offline         # knowledge search for every question in the evaluation (no model, no database)
GEMINI_API_KEY=… npm run eval     # the evaluation with the real model, graded; same local *_test databases
npm run eval -- --scripted        # the evaluation harness itself, with the scripted model
```

The end-to-end run uses `test/e2e/scripted-model.mjs` in place of the model,
email, exchange-rate, WhatsApp (Graph API), web push, Paystack and M-Pesa
(Daraja) services, and
refuses to run against any database that isn't local and named `*_test`.
`E2E_SERVER_LOG=<file>` keeps the server's output.

The evaluation (`test/eval/`) runs 110 conversations through the whole
service: TBM on a richer test seed (`tbm-eval-seed.sql`) and Acme Guesthouse
with its own knowledge (`fixtures/acme/`, one document with a planted
injection). It writes `eval-report.json` (pass rate by category, every
failure with its replies, input tokens per call and how many were cached)
and fails below the bar: `--min 0.9` of all cases and every critical case.
`--only <id prefix>` runs some; `--model <name>` picks the model.
