# Phase 3: share attribution and "Your shares"

Status (11 Oct 2026): **built and tested on the dev branch only. Not released.** It is reporting only: no money is paid on attribution.

The rules are the ones proposed in the provider audit (R1 to R13), which the owner accepted. They are coded once, in `shared/share-attribution.ts`, and used by both the browser and the server.

## What a partner sees

- **Share sheet.** When the listing's own partner opens Share, the link carries their random code: `?ref=k7m2x9qa4p`, plus the existing `utm_` tags. Copy link, WhatsApp and the phone's share menu each record which channel was used. Anyone else who shares gets the plain link, as before.
- **Your shares** (Partner Hub › Listings, at the top). For each listing they shared:
  - links shared, by channel;
  - visits and Book taps;
  - bookings that are paid or deposit-paid, not yet paid, and cancelled;
  - bookings from older links (shared before codes existed), marked unverified;
  - how many other bookings their links helped with;
  - last activity.
  
  "Show links and bookings" lists each link with its own numbers and a **Stop this link** button, and each credited booking by reference and dates.
- **No guest data.** No guest names, contact details or amounts appear anywhere in Your shares.

TBM sees every partner's shares in Admin › Marketing › **Partner shares**.

## The rules as built

| # | Rule | Where it is enforced |
|---|---|---|
| R1 | Each share link gets a random 10-character code, naming no account or listing. Codes are only issued to the listing's own partner, and only for a public listing. Opening the sheet again within a day reuses an unsent code. Older links without a code are credited to the listing's partner, marked unverified. | `issueShareLink`, `decideShareCredit` |
| R2 | A visit is a page load of a public listing with a live code. It counts once per device, per link, per 24 hours. Without a device id (storage blocked), it counts once per address. Book taps are counted the same way. | `recordShareEvent` |
| R3 | Credit lasts 30 days from the latest share visit: on the device (stored sources older than 30 days are dropped) and on the server (a recorded visit from that device or address in the last 30 days is required). | `addTouch`, `decideShareCredit` |
| R4 | With several share links, the latest gets the credit. Earlier ones are stored with the booking as having helped. | `getShareClaim`, `decideBookingShareCredit` |
| R5 | A direct visit keeps the credit. A later tagged visit (an ad, a promo link, a TBM blog post or another partner's link) takes over: the latest tagged source wins. | `touchFromParams`, `currentTouch` |
| R6 | The code is kept on the device and also travels in the Book link, so it survives Book → sign in or sign up → back → booking, refreshes, and the sign-in redirect. That works even when the browser blocks storage. | listing pages, `withShareRef`, booking pages |
| R7 | No cross-device tracking: a device or address that never opened the link earns no credit. | `decideShareCredit` |
| R8 | No credit after 30 days, through a stopped link, or when the listing isn't public at booking time. | `decideShareCredit` |
| R9 | The booking must include the shared listing. Otherwise it counts as "helped" (assisted) for that link. The decision is made once, when the booking is created, and never replaced. | `POST /api/bookings`, `createBookingAttribution` |
| R10 | The partner who created the link gets the credit. Nobody earns credit for booking through their own link. Other partners can't get codes for listings that aren't theirs. | `issueShareLink`, `decideShareCredit` |
| R11 | Bookings count once paid or deposit-paid. Not yet paid and cancelled are shown separately. The state is read from the booking each time, so payment or cancellation updates the numbers but never adds credit. | `getShareBookingState` |
| R12 | Your shares shows counts, booking references and dates only. A partner sees only their own links; TBM admins see all. | `getPartnerShares`, `getAdminShareSummary` |
| R13 | Credit comes from the server's own records (the link, the recorded visit, the booking), never from counts the browser sends. The visit and tracking endpoints are rate-limited per address and per device. | `shareEventRateLimit`, `marketingTrackRateLimit` |

## Data (migration `0021_listing_share_links.sql`)

- `listing_share_links`: code, listing, the partner who created it, channel, created, shared and stopped times.
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
| `POST /api/provider/share-links` | the listing's partner | issue a code (403 for anyone else, or a listing that isn't public) |
| `POST /api/provider/share-links/:code/shared` | its partner | record the channel |
| `POST /api/provider/share-links/:code/stop` | its partner or TBM | stop the link |
| `GET /api/provider/shares` | a partner | their own Your shares |
| `GET /api/admin/marketing/shares` | TBM admin | every partner's shares |
| `POST /api/share-links/visit` | anyone, rate-limited | record a visit or Book tap; the same reply whether or not the code is real |
| `POST /api/bookings` | guest | now also takes `shareClaim`; a missing or malformed claim never blocks the booking |

## Also fixed

When a browser blocked site data, the site failed to load. The theme, currency, pending-booking and Zaina code read storage without a guard, and that throws in those browsers. They now use `client/src/lib/safe-storage.ts`, which falls back to memory.

The old merged tracking record in the browser (fields from different links mixed together, with no expiry) is replaced by one record per source, kept for 30 days.

## Limits

- **What gets credited.** Only bookings made through the site's booking pages. Bookings made in Zaina chat, custom requests and custom offers aren't credited yet.
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
- **Earlier suites still pass:** partner privacy 106, messaging 17, sharing 17, listing privacy 22, Phase 1 18.

## Release (needs approval)

- Ships with the other dev-branch phases. The predeploy schema push adds the tables and columns; migration 0021 does the same by hand.
- No new environment variables.
- After release, check:
  - a partner's Share shows a link with `ref=`;
  - a signed-out phone visit records one visit;
  - a booking through it appears in Your shares and in Admin › Marketing › Partner shares.
- Rollback: redeploy the previous release. The new tables and columns are left unused and harmless.
