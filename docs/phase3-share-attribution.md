# Phase 3: share attribution and "Your shares"

Status (12 Oct 2026): on `main`, including the changes below marked **12 Oct** (released with the Provider Hub). It is reporting only: no money is paid on attribution, and it never changes a price, a promo, a payout or a provider's earnings.

Terms: a **provider** is the host or owner of a service (a stay, car, chef, errand or experience). **Partner** is kept for agents who refer guests, a role that isn't built yet.

The rules are the ones proposed in the provider audit (R1 to R13), which the owner accepted. They are coded once, in `shared/share-attribution.ts`, and used by both the browser and the server.

## What a provider sees

- **Share sheet.** When the listing's own provider opens Share, the link carries their random code: `?ref=k7m2x9qa4p`, plus the existing `utm_` tags. Copy link, WhatsApp, the phone's share menu and the printable QR card each record which channel was used. Anyone else who shares gets the plain link, as before.
- **Your shares** (Provider Hub › Share & grow). For each listing they shared:
  - links shared, by channel;
  - visits and Book taps;
  - bookings that are paid (see the paid-booking rule below), not yet paid, and cancelled;
  - bookings from older links (shared before codes existed), marked unverified;
  - how many other bookings their links helped with;
  - last activity.
  
  "Show links and bookings" lists each link with its own numbers and a **Stop this link** button, and each credited booking by reference and dates.
- **No guest data.** No guest names, contact details or amounts appear anywhere in Your shares.

TBM sees every provider's shares in Admin › Marketing › **Provider shares**.

## The rules as built

| # | Rule | Where it is enforced |
|---|---|---|
| R1 | Each share link gets a random 10-character code, naming no account or listing. Codes are only issued to the listing's own provider, and only for a public listing. Opening the sheet again within a day reuses an unsent code. Older links without a code are credited to the listing's provider, marked unverified. | `issueShareLink`, `decideShareCredit` |
| R2 | A visit is a page load of a public listing with a live code. It counts once per device, per link, per 24 hours. Without a device id (storage blocked), it counts once per address. Book taps are counted the same way. | `recordShareEvent` |
| R3 | Credit lasts 30 days from the latest share visit: on the device (stored sources older than 30 days are dropped) and on the server (a recorded visit from that device or address in the last 30 days is required). | `addTouch`, `decideShareCredit` |
| R4 | With several share links, the latest gets the credit. Earlier ones are stored with the booking as having helped. | `getShareClaim`, `decideBookingShareCredit` |
| R5 | A direct visit keeps the credit. A later tagged visit (an ad, a promo link, a TBM blog post or another provider's link) takes over: the latest tagged source wins. | `touchFromParams`, `currentTouch` |
| R6 | The code is kept on the device and also travels in the Book link, so it survives Book → sign in or sign up → back → booking, refreshes, and the sign-in redirect. That works even when the browser blocks storage. | listing pages, `withShareRef`, booking pages |
| R7 | No cross-device tracking: a device or address that never opened the link earns no credit. | `decideShareCredit` |
| R8 | No credit after 30 days, through a stopped link, or when the listing isn't public at booking time. | `decideShareCredit` |
| R9 | The booking must include the shared listing. Otherwise it counts as "helped" (assisted) for that link. The decision is made once, when the booking is created, and never replaced. | `POST /api/bookings`, `createBookingAttribution` |
| R9b | **Provider page links** (Phase 2 of the provider pages plan). A link to a provider's public page (`listing_kind = 'provider'`, `listing_id` = the page code, never the account ID) credits a booking that includes any listing that provider manages at booking time. A booking with none of their listings counts as "helped". R2 to R13 apply unchanged: the page must be live at booking time (R8: switched on, not switched off by TBM, provider not suspended, at least one public listing). | `decideShareCredit`, `getBookingManagerUserIds` |
| R2b | **"Ask TBM" taps** (`event_type = 'enquire'`): taps on "Ask TBM about this provider" or "WhatsApp TBM" from a share link, counted like visits (once per device, per link, per 24 hours). Reported only; they never earn credit. | `recordShareEvent` |
| R10 | The provider who created the link gets the credit. Nobody earns credit for booking through their own link. Other providers can't get codes for listings that aren't theirs. | `issueShareLink`, `decideShareCredit` |
| R11 | **The paid-booking rule** (final, 12 Oct). A credited booking counts as paid once TBM has received money for it, and that money is either the full amount or the deposit the booking requires. Bookings that take full payment only (custom menus, custom offers) need the full amount. A smaller part-payment, an unpaid booking and a booking with nothing to pay count as "not paid yet". Cancelled or refunded bookings count apart. The state is read from the booking each time, so payment or cancellation updates the numbers but never adds or moves credit. It uses the same payment helpers as the rest of the site (`shared/booking-payments.ts`). | `getShareBookingState` |
| R12 | Your shares shows counts, booking references and dates only. A provider sees only their own links; TBM admins see all. | `getProviderShares`, `getAdminShareSummary` |
| R13 | Credit comes from the server's own records (the link, the recorded visit, the booking), never from counts the browser sends. The visit and tracking endpoints are rate-limited per address and per device. | `shareEventRateLimit`, `marketingTrackRateLimit` |

## Data (migration `0021_listing_share_links.sql`)

- `listing_share_links`: code, listing, the provider who created it, channel, created, shared and stopped times.
- `listing_share_events`: visits and Book taps. The device id and address are stored only as keyed hashes (HMAC with `SESSION_SECRET`), never as-is.
- `booking_attributions` gains nullable columns:
  - `share_code`, `share_listing_kind`, `share_listing_id`;
  - `share_credit` (credited, assisted, unverified or none) and `share_credit_reason`;
  - `credited_user_id`;
  - `assisted_share_codes`.

All changes are additive. The server also creates them if missing.

## API

| Route | Who | What |
|---|---|---|
| `POST /api/provider/share-links` | the listing's provider | issue a code (403 for anyone else, or a listing that isn't public) |
| `POST /api/provider/share-links/:code/shared` | its provider | record the channel |
| `POST /api/provider/share-links/:code/stop` | its provider or TBM | stop the link |
| `GET /api/provider/shares` | a provider | their own Your shares |
| `GET /api/admin/marketing/shares` | TBM admin | every provider's shares |
| `POST /api/share-links/visit` | anyone, rate-limited | record a visit or Book tap; the same reply whether or not the code is real |
| `POST /api/bookings` | guest | now also takes `shareClaim`; a missing or malformed claim never blocks the booking |

## Also fixed

When a browser blocked site data, the site failed to load. The theme, currency, pending-booking and Zaina code read storage without a guard, and that throws in those browsers. They now use `client/src/lib/safe-storage.ts`, which falls back to memory.

The old merged tracking record in the browser (fields from different links mixed together, with no expiry) is replaced by one record per source, kept for 30 days.

## Limits

- **What gets credited.** Bookings made through the site's booking pages, custom requests and bookings Zaina makes in chat. Custom offers TBM creates by hand aren't credited.
- **Shared networks.** Without a stored device id, a visit is matched by network address. Two people on the same network (an office or hotel Wi-Fi) could share credit in that case.
- **R3 precision.** Visits are recorded once a day per device, so the server's 30 days can start up to a day before the latest visit.
- **Retention.** Share events aren't pruned yet. A 90-day retention job is a sensible follow-up.

## Tests (local data; not live)

- **Unit tests:** `shared/share-attribution.test.ts` (14, one or more per rule) and `shared/listing-share.test.ts`. 190 unit tests pass in total.
- **API checks: 44.**
  - Who gets codes.
  - Visit de-duplication.
  - Each crediting rule, including another device, own link, stopped link, other listing, older link, two links and a forged code.
  - Privacy of Your shares and TBM's view.
  - Rate limits.
- **Phone browser journeys: 27.**
  - The share sheet.
  - Shared link → Book → sign in → booking, refreshing at each step.
  - The same with sign-up and email verification.
  - Coming back after 3 days (credited) and after 31 days (not).
  - Two links.
  - An ad after a share.
  - Storage blocked.
  - Your shares and TBM's view.
- **Earlier suites still pass:** provider privacy 106, messaging 17, sharing 17, listing privacy 22, Phase 1 18.

## Release (needs approval)

- Ships with the other dev-branch phases. The predeploy schema push adds the tables and columns; migration 0021 does the same by hand.
- No new environment variables.
- After release, check:
  - a provider's Share shows a link with `ref=`;
  - a signed-out phone visit records one visit;
  - a booking through it appears in Your shares and in Admin › Marketing › Provider shares.
- Rollback: redeploy the previous release. The new tables and columns are left unused and harmless.

## Later additions

- **QR cards.** Share & grow makes a printable "scan to book" card for each public listing. Its link uses the `qr` channel and counts like any other share.
- **Bookings made outside the Book button.** Custom requests and bookings Zaina makes in chat are credited by the same rules. The custom-request page and Zaina's chat send the visitor's share claim. A custom request never includes the shared listing, so it counts as "helped" (assisted) rather than credited.
- **Zaina chat claims are stored (12 Oct).** Each chat's latest claim is kept in `zaina_share_claims` (migration `0023`) for the 30-day credit window, so a restart or a second server copy no longer loses it. Device and address are stored only as keyed hashes, as for share visits. Rows older than 30 days are deleted by the server.
- **The paid-booking rule made exact (12 Oct).** Before, any part-payment counted as "deposit paid". Now only the booking's required deposit, or the full amount, counts (R11).

## Reporting only: what attribution can't change

- **Payouts and earnings.** Payouts are worked out from the booking, its service assignment, the provider's agreed rate and any promo on the booking. No share field is read. A credited booking pays the provider exactly what an uncredited one would.
- **The booking's promo record.** When a booking already has a marketing record (for example a promo code), share credit is added with `setBookingShareCredit`, which writes the share columns only. Before 12 Oct, that path rewrote the whole record and could clear the promo's cost-sharing setting, which payouts read. That could have changed a payout, and it no longer can.
- **No referral payments.** Nothing pays, credits or discounts anyone because of a share. "Your shares" is information for the provider and TBM.
- **Agents.** Partner (agent) referral earnings are not built. If they ever are, they need their own rules and the owner's approval.
