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
website widget ──▶ gateway ──▶ engine ──────────▶ connector ──▶ the business's own system
                   (tokens,     (one turn: a        (TBM: TBM's listings, prices,
                    limits,      static prompt,      bookings, alerts;
                    websites)    the turn's context, others: leads for their team)
                                 short history,
                                 tools by business type,
                                 knowledge search, replies)
                       │            │
staff console ─────────┤            │
(sign-in, roles,       ▼            ▼
 knowledge)    platform database: businesses, conversations, telemetry, usage,
               rate limits, M-Pesa claims, staff, settings, encrypted secrets,
               leads, knowledge. Every business's rows are kept apart by Postgres.
```

- `src/gateway/` — the public chat API: signed session tokens, shared rate
  limits, allowed websites, daily model budget.
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
  handoff lifecycle, the team's inbox routes, retention and deletion requests.
- `src/connectors/` — what a business plugs in. `tbm/` is TBM: its prompt and
  tools, its team alerts and chat M-Pesa recording; `tbm/tbm-app.ts` is the
  only file that reaches into the TBM app's code. `basic/` serves any other
  business: it answers from the business's own knowledge, takes leads and
  hands over to a person.
- `knowledge/tbm/` — TBM's knowledge (areas, travel, services, booking and
  payment, policies), imported at every release.
- `src/businesses/` — the business directory, each business's settings, and
  its encrypted secrets.
- `src/staff/` — staff accounts, sign-in, roles, and the business console
  routes (settings, people, secrets, leads, reports, deletion requests).
- `src/platform/` — the platform's own console: adding businesses.
- `src/db/` — the two database connections and business scope (`tenant.ts`).
- `src/cli/` — creating the first staff accounts; importing knowledge.
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

**Next: Phase 3 — channels and console.** The embeddable widget, WhatsApp,
the business inbox and basic reports.

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

Optional: `PLATFORM_APP_DATABASE_URL` (see below), `PLATFORM_SECRETS_KEY_ID`
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
npm run dev         # start with tsx
npm run build       # bundle to dist/, then npm start
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
alter role zaina_app login password '…';   -- once, as the owner
PLATFORM_APP_DATABASE_URL=postgres://zaina_app:…@host/db
```

The service refuses to start if business queries would run unrestricted.

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

## Tests

```
npm test            # unit tests (no database)
npm run test:db     # database checks, including separation between businesses:
                    # PLATFORM_TEST_DATABASE_URL, a local database ending in _test (wiped)
npm run test:e2e    # the whole service with a scripted model, TBM and a second business:
                    # also TBM_TEST_DATABASE_URL, a local copy of TBM's schema ending in _test
npm run check       # type check

npm run eval -- --offline         # knowledge search for every question in the evaluation (no model, no database)
GEMINI_API_KEY=… npm run eval     # the evaluation with the real model, graded; same local *_test databases
npm run eval -- --scripted        # the evaluation harness itself, with the scripted model
```

The end-to-end run uses `test/e2e/scripted-model.mjs` in place of the model,
email and exchange-rate services, and refuses to run against any database
that isn't local and named `*_test`. `E2E_SERVER_LOG=<file>` keeps the
server's output.

The evaluation (`test/eval/`) runs 110 conversations through the whole
service: TBM on a richer test seed (`tbm-eval-seed.sql`) and Acme Guesthouse
with its own knowledge (`fixtures/acme/`, one document with a planted
injection). It writes `eval-report.json` (pass rate by category, every
failure with its replies, input tokens per call and how many were cached)
and fails below the bar: `--min 0.9` of all cases and every critical case.
`--only <id prefix>` runs some; `--model <name>` picks the model.
