# Hotfix for review: partner guest data and public calendars

Branch: `hotfix/partner-guest-data`, based on `main` at `eb97639`.
Status: **prepared for review only. Not merged into `main`, not deployed.** Railway deploys every push to `main`, so merging this branch is the release. That needs the owner's explicit approval.

## Purpose

Contain two exposures found on 11 Oct 2026 in the code that `main` (and so, presumably, the live site) runs:

1. Public calendars return guests' full names and booking IDs to anyone, signed out.
2. Partner-facing endpoints return guests' contact details, payment details, totals, internal notes and full names.

The change is server-only:

- No screens change, and `main`'s screens read none of the removed fields.
- No database migration and no new environment variables.

The fuller model (separate TBM conversations, recorded contact sharing) stays on the dev branch for a normal release.

## Files

| File | Change |
|---|---|
| `server/routes.ts` | Partner and public responses pass through the views below. Older status routes act on the partner's own job. |
| `server/storage.ts` | New partner alerts and push texts: short guest name, no payment updates, no guest-typed contact details. Partner notifications are filtered the same way. |
| `server/provider-booking-view.ts` (new) | What a partner may see of a booking, job, alert and payout. Identical to the dev branch. |
| `server/availability-view.ts` (new) | What the public and a partner see of a calendar. Identical to the dev branch. |
| `shared/booking-thread.ts` (new) | Recognises payment-update messages, including older ones by their wording. Identical to the dev branch; only `canSeeThreadMessage` is used here. |
| `*.test.ts` for the three new modules | Unit tests, identical to the dev branch. |
| `docs/hotfix-partner-guest-data.md` | This note. |

No client files, no `shared/schema.ts`, no `migrations/`.

## Endpoints: before and after

| Endpoint | Who | Before | After |
|---|---|---|---|
| `GET /api/stays/:id/availability`, `/api/cars/:id/availability`, `/api/cooks/:id/availability` | Anyone, signed out | Booked ranges with the guest's full name and the booking ID | Taken dates only: `id: "taken-N"`, `guestName: "Booked"`, no booking ID |
| `GET /api/provider/booking-assignments` | Partner | Whole booking: guest email and phone, M-Pesa code, amounts paid, totals, admin notes, staff IDs, full name; the job's `grossAmount` | Booking reference, status, dates, times, guests, service details and a payment stage; guest as first name and surname initial; contact details removed from the guest's request text; no `grossAmount` |
| `GET /api/provider/{stay,car,cook,errand,experience}-bookings` | Partner | The same whole bookings, for every booking on their listings, including unpaid holds and bookings from before the listing was theirs | Only bookings they have a job on, in the partner view |
| `GET /api/bookings/:id` | Partner on the booking | Whole booking | Partner view |
| `GET /api/bookings/:id/messages` | Partner on the booking | Every message, including M-Pesa submissions and confirmations, and phone numbers or emails guests typed | Payment updates left out; contact details in guest-written messages removed; TBM's messages unchanged. Guests and TBM see everything as before. |
| `GET /api/inbox` | Partner | Alerts quoting payment updates and guest messages, with full names and typed contact details | No payment-update alerts; short guest names; guest-typed contact details removed. Covers alerts already stored. |
| `GET /api/provider/notifications`, `PATCH …/:id/read` | Partner | Full guest names | Short guest names |
| New alerts and push notifications | Partner | Full name, payment updates, typed contact details | Short name; no alert for payment updates; contact details removed |
| `GET /api/provider/payments` | Partner | Guest's price, TBM's fee amount, guest name, TBM's internal payout notes, marketing source, totals of gross and fee | Payout amounts and status, agreed rate, and the service value behind each payout. No fee amount, notes, guest name or marketing data. Admin view unchanged. |
| `GET /api/provider/{stays,cars,cooks}/:id/availability` | Partner managing the listing | Guest names for every booking | Their own jobs as "Booking ABCD1234"; anyone else's booking as "Held for a guest" with no ID; their manual blocks unchanged |
| `PATCH /api/provider/booking-assignments/:id/{status,response,custom-menu-proposal,experience-custom-offer}`, `PATCH /api/provider/cook-bookings/:id/proposal`, `PATCH /api/provider/experience-bookings/:id/custom-offer` | Partner | Responses carried whole bookings | Responses carry the partner view |
| `PATCH /api/provider/{bookings,car-bookings,cook-bookings}/:id/status` | Partner | Changed the whole booking's status for any partner on it (or the listing's current manager) and returned the whole booking | Moves only that partner's own job (409 if they hold several) and returns the partner view; admins unchanged. The screens don't use these routes. |
| `GET /api/bookings/:id/listing-verification` | Partner on the booking | Readable | 404 |

Unchanged:
- admin endpoints;
- guests' own bookings, receipts and payments;
- public listing endpoints (already trimmed by `eb97639`);
- every create and update path.

### What partners will notice

- Guest names appear as "Jane W.".
- Calendars show "Booking ABCD1234" instead of a name.
- Payment-update messages no longer appear in their booking chat.
- Phone numbers or emails a guest typed show as "[contact details removed – message TBM]".

## Not fixed by this hotfix (remaining risk)

- **The shared booking chat remains.** Partners and guests still message each other directly, and a partner can still type their own number to a guest. The dev branch replaces this with separate TBM conversations (migration 0018). That needs the normal release.
- **Push notifications already delivered** to partners' phones can't be recalled.
- **Vehicle documents and fleet-application files** are still in the public bucket, with permanent links. `/api/fleet-applications/upload` still accepts uploads without sign-in. See the storage plan.
- **Partner emails** for new jobs don't exist on `main`, so there is nothing to change there.

## Tests run (local copy, local test data only)

| Check | `main` (before) | This branch (after) |
|---|---|---|
| Hotfix API suite: public calendars, partner booking data, lists, payouts, calendars, chat and alerts, ID swaps, unchanged guest and public paths (45 checks) | 21 passed, **24 failed** | **45 passed** |
| Unit tests (`server`, `shared`) | — | 126 passed |
| Browser smoke on `main`'s unchanged screens: partner bookings tab and calendar, admin bookings, guest trips | — | 6 passed, no page errors, no guest phone or email on partner screens |
| `tsc --noEmit`, `vite build`, server bundle | — | Pass |

The 24 failures on `main` are the exposures above, so the suite catches them. ID swaps by a second partner were refused on both branches. **None of this was run against the live site.** The live site is blocked from the build environment, so live behaviour is unverified.

## Deploying (only after approval)

1. Merge `hotfix/partner-guest-data` into `main` (fast-forward or a merge commit). Railway builds and deploys it. The predeploy `drizzle-kit push` finds no schema change.
2. There are no environment changes and no data changes.

## Checks after deploy

Signed out:
- `GET https://tembeabilamatata.com/api/cars/<a car with bookings>/availability`: `blockedRanges` ids are `taken-1…`, every `guestName` is `"Booked"`, and there are no names or UUIDs.
- Do the same for `/api/stays/<id>/availability` and `/api/cooks/<id>/availability`.

Signed in as a test partner account:
- Partner Hub › Bookings shows jobs with "First I." names.
- Their browser's `/api/provider/booking-assignments` has no `guestPhone`, `guestEmail`, `paymentReference`, `totalPrice` or `adminLockNote`.
- `/api/provider/payments` has no `grossAmount`, `commissionAmount` or `notes`.

Signed in as admin:
- Admin › Bookings still shows full guest details.
- Admin › Payments still shows fees and notes.

Then watch the Railway logs for 500s on `/api/provider/*` and `/api/*/availability` for an hour.

## Rollback

There is no data or schema change, so rollback only touches code:

- **Fastest:** in Railway, redeploy the previous deployment (`eb97639`) from the service's Deployments list.
- **In git:** `git revert -m 1 <merge commit>` (or `git revert <commit>` for a fast-forward), then push to `main`. Railway redeploys the previous behaviour.

Nothing written while the hotfix was live needs undoing. Alerts created during that time hold short names, and that remains true after a rollback.

## Relation to the dev branch

The three new modules are byte-identical to the dev branch. When the dev branch is released, its `routes.ts` and `storage.ts` supersede these hunks. Any merge conflicts are resolved in favour of the dev branch, which includes everything here plus the TBM conversations and recorded contact sharing.
