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
website widget ──▶ gateway ──▶ engine ──▶ connector ──▶ the business's own system
                   (tokens,     (one turn:   (TBM: TBM's
                    limits,      model,       listings, prices,
                    websites)    tools,       bookings, alerts)
                                 replies)
                       │            │
                       └── platform database: businesses, conversations,
                           telemetry, usage, rate limits, M-Pesa claims
```

- `src/gateway/` — the public chat API: signed session tokens, shared rate
  limits, allowed websites, daily model budget.
- `src/engine/` — one chat turn (`agent.ts`, ported from the TBM app's
  `router.ts`) and the rules it runs on: reply policy, idempotency, contact
  checks, turn budget, session lock, failure policy, telemetry.
- `src/conversations/` — conversations in the platform database, the
  handoff lifecycle, staff routes, retention.
- `src/connectors/` — what a business plugs in. `tbm/` is TBM: its prompt and
  tools (copied from the TBM app), its team alerts and chat M-Pesa recording.
  `tbm/tbm-app.ts` is the only file that reaches into the TBM app's code.
- `src/admin/` — usage report and deleting a customer's conversations.
- `migrations/` — reviewed SQL, applied in order and never edited once run.

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

Exit check: the same 13 scripted conversations produce word-for-word the same
replies here as in the live Zaina (bookings, custom requests, verifications,
trip packages, errands, leads). Cost per conversation is measured by the
report; with real traffic once TBM moves over.

TBM's starting settings (migration `0002`) are proposals to confirm: staffed
07:00–22:00 Kenya time, callbacks after 10 unclaimed minutes, 30 million model
tokens a day, transcripts kept 90 days.

**Next: Phase 1 — business separation.** Row-level security on every table,
business settings and encrypted secrets, staff accounts with roles, and a
second test business that provably can't see TBM's data.

## Running it locally

It runs from the repository root, using the root `node_modules`.

```
PLATFORM_DATABASE_URL   the platform's own Postgres database
TBM_DATABASE_URL        TBM's database (the TBM connector reads and writes it)
SESSION_TOKEN_SECRET    at least 32 characters; signs chat tokens
PLATFORM_ADMIN_TOKEN    at least 24 characters; staff and admin routes (until Phase 1)
GEMINI_API_KEY          the model key
```

Optional: `PORT` (5070), `TURN_BUDGET_MS` (25000), `TRUST_PROXY` (1),
`LIMIT_*` rate limits (see `src/config.ts`), `MODEL_PRICE_INPUT_USD_PER_MTOK`
and `MODEL_PRICE_OUTPUT_USD_PER_MTOK` (cost in reports), `EXTRA_ALLOWED_ORIGINS`
(local and staging only), and TBM's own email and push settings
(`RESEND_API_KEY`, `NOTIFICATION_EMAILS`, …) for team alerts.

```
cd zaina-platform
npm run migrate     # apply migrations (a release step in production)
npm run dev         # start with tsx
npm run build       # bundle to dist/, then npm start
```

## API

Public (the widget): `POST /v1/sessions` with `{ business_key, display_currency }`
returns a `token`; send it as `Authorization: Bearer …` to `POST /v1/chat`
(`{ message }`), `GET /v1/session` and `GET /v1/chat/messages?after=<id>`.

Staff (admin token and `x-agent-id`): `GET /v1/staff/businesses/:id/sessions?filter=waiting|active|callbacks|all`,
`GET /v1/staff/sessions/:id`, and `POST …/claim`, `…/messages`, `…/release`,
`…/close`, `…/callback-done`.

Admin (admin token): `GET /v1/admin/businesses/:id/metrics?days=7`,
`DELETE /v1/admin/businesses/:id/sessions/:sid`, `POST /v1/admin/businesses/:id/erase`.

## Tests

```
npm test            # unit tests (no database)
npm run test:db     # platform database checks: PLATFORM_TEST_DATABASE_URL, name ending in _test (wiped)
npm run test:e2e    # the whole service with a scripted model: also TBM_TEST_DATABASE_URL,
                    # a local copy of TBM's schema ending in _test (its listings are replaced)
npm run check       # type check
```

The end-to-end run uses `test/e2e/scripted-model.mjs` in place of the model,
email and exchange-rate services, and refuses to run against any database
that isn't local and named `*_test`.
