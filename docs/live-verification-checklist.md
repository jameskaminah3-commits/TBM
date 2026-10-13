# Live verification checklist (production)

**Status: not verified.** None of this has been checked on the live site. This session's network blocks tembeabilamatata.com, so every check below must be run by the owner, or by someone the owner authorises.

The three production security issues stay **open** until every line in sections 1 to 5 has been checked on production and recorded in section 7:
- public calendars showing guests;
- guest data in provider booking endpoints;
- public vehicle and fleet-application documents.

A pass on the dev branch or a local copy does not count.

## What should be live

- **Code.** The fixes for all three issues are on `main` (last release `9427b7e`):
  - `server/availability-view.ts` (calendars);
  - `server/provider-booking-view.ts` (provider data);
  - `server/private-files.ts` and `server/listing-privacy.ts` (documents).

  Whether Railway is running that commit is not confirmed.
- **Existing files.** New uploads go to private storage. **Files uploaded before the release are still in the public bucket and still open from their old links**, until the one-off move in section 3 is run. Treat existing logbooks, insurance papers and application files as publicly reachable until section 3 passes.
- **The Provider Hub release** goes out on top of that. It doesn't change these fixes, and the script's section A reports whether it's live. Its own clean-up steps (agreed rates, emails, a test provider) are in `docs/production-cleanup-runbook.md`.

## Before you start

- **Use a test provider account**, never a real provider's. Give it one public test listing and one **paid** test booking (an M-Pesa payment you refund, or a booking TBM marks paid). Without a paid booking, the provider has no jobs to check.
- **Keep the output private.** The script prints status codes, field names and storage paths, never names, emails or phone numbers. Storage paths are still internal, so keep the output out of chats and out of git.
- **What the script sends.** GET and HEAD requests only, plus one sign-in when you give it the test account. It changes nothing.

## 1. Confirm the release

| Check | Where | Safe result |
|---|---|---|
| Deployed commit | Railway › the TBM service › Deployments | `9427b7e` or later, status Active |
| Predeploy ran | Railway deploy log | `drizzle-kit push` finished; tables `private_files`, `private_file_access`, `storage_migrations`, `listing_share_links`, `listing_share_events` exist |
| Private bucket | Supabase › Storage | Bucket `tbm-private-files` (or `SUPABASE_PRIVATE_BUCKET`) exists with **Public off** |
| Server log | Railway logs | No `[private-files]` errors after start-up |

## 2. Run the read-only script

From a computer that can reach the site, in a checkout of `main`:

```
node scripts/verify-live-privacy.mjs
VERIFY_PROVIDER_EMAIL=<test provider email> VERIFY_PROVIDER_PASSWORD=<its password> node scripts/verify-live-privacy.mjs
```

Set the test account's details in your own terminal only. Don't paste them into a chat.

What it checks, and the safe response for each:

| # | Endpoint or path | As | Safe response |
|---|---|---|---|
| A1 | `GET /api/files/<made-up key>` | signed out | **401** JSON. (The web page instead means the private-files code isn't deployed.) |
| B1 | `GET /api/stays`, `/api/cars`, `/api/cooks`, `/api/errands`, `/api/experiences` | signed out | 200. No `managerUserId`, `documents`, `registrationNumber`, `ownershipType`, `mileage`, `availabilityPreference`, `chauffeurArrangement` or `firstPublishedAt` field. No `/api/files/` link. No email address or phone number other than TBM's own. |
| B2 | `GET /api/<kind>/:id` for up to 8 listings of each kind | signed out | As B1 |
| C1 | `GET /api/stays/:id/availability`, `/api/cars/:id/availability`, `/api/cooks/:id/availability` | signed out | 200. Every taken range has `id` `taken-N` and `guestName` `"Booked"`. No booking IDs, names, emails or phone numbers. |
| C2 | `GET /api/experiences/:id/shared-departures` | signed out | No guest email, phone or contact fields |
| R1 | `GET /api/reviews/:kind/:id` for listings that have reviews | signed out | 200. Each review has only `rating`, `comment`, `createdAt` and `guestName`, plus `reply` (`text`, `createdAt`) once that release is live; a reply appears only after TBM approves it. `guestName` is "Amina W." (first name and surname initial) or "Verified guest". No `id`, `userId`, `bookingId`, `targetId`, full names or contact details. |
| P1 | `GET /api/public/providers/by-listing/:kind/:id` for the sampled listings, and `GET /api/public/providers/:code` for each page found | signed out | Only the fields in `shared/provider-public.ts`. No account, review or booking IDs (listing addresses aside), no email or phone number other than TBM's, no payout fields, no `/api/files/` link. An unknown code is a 404. SKIP until provider pages are released and a provider has switched one on. |
| D1 | `/api/provider/booking-assignments`, `/api/provider/{stay,car,cook,errand,experience}-bookings`, `/api/provider/notifications`, `/api/provider/payments`, `/api/provider/contact-releases`, `/api/provider/shares` | signed out | **401** (or 403/404). Never 200 with data. |
| D2 | `/api/inbox`, `/api/bookings`, `/api/bookings/:id/carers` and its photo link | signed out | 401 |
| D3 | `/api/admin/bookings`, `/api/admin/media`, `/api/admin/fleet-applications`, `/api/admin/payments`, `/api/admin/marketing/shares`, `/api/admin/provider-photos`, `/api/admin/ratings/check` | signed out | 401 or 403 |
| S1 | `GET /sitemap.xml` | signed out | Provider pages appear as `/p/<code>/<name>` only, never with an account ID, and only while live. No contact details. |
| E1 | `HEAD /uploads/<made-up file>.pdf` | signed out | 4xx, never a file |
| G1 | `GET /api/provider/booking-assignments` | test provider | 200. No `guestPhone`, `guestEmail`, `userId`, payment fields, `totalPrice`, `adminLockNote` or `marketingAttribution`. Guests shown as first name and initial ("Jane W."). |
| G2 | The provider's booking lists, notifications, `/api/inbox` and `/api/provider/payments` | test provider | No guest phone number or email address anywhere. TBM's own number is allowed. |
| G3 | `GET /api/admin/media` | test provider | Only that provider's own listing photos. No `/api/files/` links, no PDFs. |
| G4 | `/api/admin/bookings`, `/api/admin/payments`, `/api/admin/fleet-applications` | test provider | 401, 403 or 404 |
| G5 | `GET /api/files/<made-up key>` | test provider | **404**, which doesn't confirm whether a file exists |

The script exits with code 1 if anything fails. **SKIP is not a pass.**

## 3. Existing documents (the old public links)

This is the step that protects files uploaded before the release. Each step needs the owner's approval. It is run by someone authorised to hold production credentials (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MEDIA_BUCKET`). The full runbook is in `docs/storage-private-files-plan.md`.

1. **Evidence first.** Export Supabase's storage logs for as far back as they go, before anything changes.
2. **Inventory (read-only).**
   ```
   npx tsx scripts/storage-inventory.ts --out ./storage-inventory-private
   ```
   Note the count of files in protected categories (`vehicle-document`, `fleet-application-document`, `fleet-application-photo`, `guest-attachment`, `unreferenced-pdf`).
3. **Baseline the old links.** This should FAIL now, which shows the files are still public:
   ```
   node scripts/verify-live-privacy.mjs --inventory ./storage-inventory-private/objects.csv \
     --public-base https://<project>.supabase.co/storage/v1/object/public/<media bucket>
   ```
   If `SUPABASE_MEDIA_PUBLIC_BASE_URL` is set (a CDN), use that as `--public-base`.
4. **Move the files.**
   - Dry run: `npx tsx scripts/migrate-private-files.ts`. Check the counts match step 2.
   - `--apply`. Expect `failed: 0` and `verified` equal to `moved`.
   - In the app, check that a car's documents open for its provider and an application's files open for an admin.
5. **Remove the public copies.** Run `--remove-public`. Wait **at least one hour** for cached copies to expire, and purge the CDN if there is one.
6. **Re-run step 3.** Safe result: **every protected file refuses its old link (4xx)**, directly and through `/uploads/…`. Listing photos aren't checked and stay public.
7. **Re-run the inventory.** Safe result: zero files in protected categories left in the public bucket.
8. **Bucket listing.** Run query A2 in `docs/storage-and-exposure-queries.sql`. Safe result: the public (anon) key can't list the media bucket.

What this can't undo: copies already downloaded, forwarded by email or chat, or kept in a browser cache.

## 4. Smoke tests that need an upload

Use the test provider and an admin account. These write test data, so they're done by hand.

| Check | Safe result |
|---|---|
| Upload a vehicle document as the test provider, then open it from their documents page | Opens. The address starts `/api/files/vehicle-document/`. The response has `Cache-Control: private, no-store`. |
| Open that same `/api/files/…` link signed out | 401 |
| Open it as a different provider | 404 |
| Submit a fleet application with test files. In Admin, open the application | Its files are `/api/files/fleet-application/…` links, and they open for the admin only |
| Approve that test application | The new car starts hidden. Its documents stay private and its photos become public. |
| Supabase › Storage › media bucket | No new document lands in the public bucket |

## 5. Guest contact under TBM-managed messaging

With the test provider's paid test booking:

| Check | Safe result |
|---|---|
| Provider Hub › Bookings and Job requests | Guest shown as first name and initial. No phone, email or full name. |
| The new-job email and alert | First name and initial, dates and a reference. No guest contact. |
| Messages on that booking | The provider writes to TBM. TBM relays to the guest, and the guest's details are never shown. |
| A guest who typed their number into a request (test it) | Shown to the provider as `[contact details removed – message TBM]` |
| Admin › the booking › share guest contact (only if you use it) | Shared only for the reason and time TBM sets, recorded, and gone after it expires |

## 6. Not in scope of this checklist

- **Data already exposed before the fixes.** For example: who opened a public document link, or saw a guest name on a calendar. Only Supabase's storage logs and Railway's request logs for that period can show this. See the incident fact sheet.
- **Legal steps.** Whether to notify the Data Protection Commissioner or affected people is for TBM and its legal adviser.

## 7. Record of results

Fill in one row per check. Keep the script output (status codes and paths only) privately with the incident file.

| Date and time (EAT) | Who | Section and check | Result | Notes |
|---|---|---|---|---|
| | | 1 Release | | |
| | | 2 Script A–E (signed out) | | |
| | | 2 Script G (test provider) | | |
| | | 3 Existing documents, after `--remove-public` | | |
| | | 4 Upload smoke tests | | |
| | | 5 Guest contact | | |
| | | 2 Script R (public reviews) | | |
| | | 2 Script P (provider pages) | | |

Mark an issue resolved only when its rows all pass:
- **Calendars:** C1.
- **Provider booking data:** D1, G1, G2 and section 5.
- **Documents:** A1, B1, B2, G3, G5 and sections 3 and 4.
- **Public reviews** (found 13 October 2026): R1. Also open one listing with reviews in a browser and check each reviewer shows as "Amina W.".
- **Provider pages** (once released): P1. Also open one live page on a phone and check it shows no personal phone number or email, and that a home-help provider's page shows no face.
