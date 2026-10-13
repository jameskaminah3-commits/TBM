# Provider pages, smart cards and onboarding: plan for review

**Status (13 October 2026): plan only.** None of the work in sections 2 to 11 has been built. It stays on the dev branch until reviewed, and each phase is released only with the owner's approval.

The narrow public-reviews fix (Phase 0) is separate. It's done, and it's on `main`, but it hasn't been verified on the live site.

## 0. Phase 0: public reviews fix (done, separate)

**The defect.** `GET /api/reviews/:kind/:id` returned each review row as stored, plus the full guest name from the booking:
- the review ID;
- the account ID;
- the booking ID;
- the listing ID;
- `updatedAt`.

The full review list on stay pages also showed the full name.

**The fix.** Shipped as commit `428220c` on dev and `96cd989` on `main`.

| Part | What |
|---|---|
| `shared/public-review.ts` | The public allowlist: `rating`, `comment`, `createdAt`, `guestName`. Also the name formatter: "Amina Wanjiru" becomes "Amina W.", and a missing name becomes "Verified guest". |
| `server/public-reviews.ts` | The endpoint builds every review through the allowlist. |
| `client/src/components/public-review-preview.tsx` | Every review view formats names with the same helper. A full name is never shown, even if the server sends one. |
| `server/public-reviews.test.ts` | Six regression tests. Stored rows carry IDs, full names, and guest email and phone; they come out with only the allowlisted keys. |
| `scripts/verify-live-privacy.mjs`, check R1 | A read-only live check, also added to `docs/live-verification-checklist.md`. |

**Tests run, and their results:**
- **Unit tests:** dev 228 of 228 pass; `main` 206 of 206 pass. The type-check and the production build pass.
- **Check R1 against local servers:**
  - On `main`'s code before the fix, it **FAILS**. It finds the fields `id`, `bookingId`, `userId`, `targetType`, `targetId` and `updatedAt`.
  - After the fix, it **PASSES** on both dev and `main`.
- **Browser check:** the page was given a response with full names ("Amina Wanjiru", "John Kamau Otieno") and showed "Amina W." and "John O.". `main`'s old code showed the full name.

**Not verified:**
- Whether Railway is running `96cd989`.
- The live endpoint itself. This session can't reach tembeabilamatata.com.

Until check R1 passes against the live site, the issue isn't resolved in production.

**Also not covered by Phase 0:**
- Review comments are shown as written. A guest who typed a phone number into a comment would have it shown. Section 3 handles this.
- Copies of the old responses that someone already saved can't be recalled.

## 1. What already exists, and how it's reused

| Need | Existing piece | How it's reused |
|---|---|---|
| Provider profile | `provider_profiles`: business name, bio, photo, languages, service areas, verification status and date. Hub › Profile (`client/src/pages/provider/profile.tsx`) and `/api/provider/profile`. | It stays the source of the public page. New columns hold the public code, the switch and photo approval (section 10). |
| Verification | `provider_profiles.verification_status` and `verified_at`, the admin verify action, and `emailProviderVerified`. | The badge shows only while the status is `verified`, and is read on every request. |
| Suspension | `users.is_suspended`, set on Admin › Providers. Today it blocks sign-in only. | The page and the listing block become unavailable when it's set. New bookings are stopped as well (decision 1). |
| Who owns a listing | `manager_user_id` on stays, cars, cooks, errands and experiences. | Used to pick the provider's listings, for the self-review check, and for provider-link credit. |
| Public listing data | `toPublicListing` (`server/listing-privacy.ts`). The existing listing routes: `/accommodation/:id/:slug`, `/transport/…`, `/chef/…`, `/errand/…`, `/experience/…`. `getPublicListingPath` (`shared/seo.ts`), `ListingCard`, `ListingUnavailable`. | Provider pages link to the existing listing pages. They don't copy them. Listing cards use the existing component, fed from a card allowlist. |
| Share previews and search | `server/share-metadata.ts`: page titles, preview images, canonical addresses, robots rules and short links. | New entries for `/p/…`, so a shared provider page shows a proper preview. |
| Sharing | `listing_share_links` and `listing_share_events` (migration 0021), `issueShareLink`, `recordShareEvent`, `ListingShareSheet`, `buildListingShareUrl`, the WhatsApp message builder. | Provider-page links use the **same table** with `listing_kind = 'provider'`. No second sharing or tracking system. |
| QR cards | `QrShareCard` (`client/src/components/provider-hub/qr-share-card.tsx`) and the `qrcode` package. | Its canvas composer becomes the business-card composer. The per-listing card stays. |
| Attribution | `shared/share-attribution.ts` (rules R1 to R13), browser touches in `client/src/lib/marketing-attribution.ts`, credit decided on the server when a booking is created (`server/share-credit.ts`), `zaina_share_claims`, Your shares. | Unchanged, plus one rule for provider links (R9b, section 6) and one event type (`enquire`). |
| Reviews | The `reviews` table. `POST /api/bookings/:id/reviews` accepts only the guest's own completed booking, once per item. Phase 0's public allowlist. | One shared eligibility module for the API and the pages. New columns for moderation and replies. |
| Contact removal | `removeContactDetails` (`server/provider-booking-view.ts`), which takes phone numbers and emails out of free text. | Applied to public bios, review comments and provider replies. |
| Applications | `provider_applications`, `apply-service.tsx` (four steps, draft kept for the browser tab), Admin › Provider applications, and the receipt and approval emails (`server/provider-hub-routes.ts`). | Cars move into this flow. Reference, status page and status emails are added. |
| Passwords | `password_reset_otps`, `/api/auth/forgot-password` and `/reset-password`. Google sign-in matches accounts by email. | Reused for the account-setup link, with a new `purpose` column (section 10). |
| Private documents | Private files, and Hub › Documents for vehicles. | Documents are asked for at the verification stage. Photos waiting for approval are kept private too. |
| Commission | `shared/payout-rate.ts`: no default rate; "Not set yet" until a rate is agreed. | No change. |

**Not reused:** the old `providers` table and the `GET /api/providers` endpoints. It's an old catalogue: `verified` defaults to true, and its ratings aren't tied to reviews. No page uses it, and it has no rows locally. Provider pages won't touch it. Removing the endpoints later is decision 6.

## 2. The public provider page

### Address

`/p/<code>/<slug>`, for example `/p/k7m2q9xw/mwinyi-coast-stays`.

- **Code:** 8 random characters. It is never the account ID.
- **Slug:** made from the display name. If the name changes, the old address redirects, because the code is the key.
- **Short form:** `/p/<code>`. QR codes and cards use it.

### When a page is shown

All of these must be true:
1. The account is a provider and isn't suspended.
2. The provider manages at least one public listing.
3. The provider has switched the page on in the Hub, after seeing a preview (decision 2). TBM can switch any page off.

Otherwise the address shows the unavailable state below.

### Structure, top to bottom

| # | Section | What's in it | Where it comes from |
|---|---|---|---|
| 1 | Header | The approved photo or logo, or a service icon. The display name (business name, or first name and service). Main services, areas served and languages. | `provider_profiles`, through the allowlist |
| 2 | Badges | "Verified by TBM", only while verified. "Founding Provider", if granted and active. "On TBM since Mar 2026". | Live status |
| 3 | Trust line | "4.6 · 12 reviews" from 3 eligible reviews, otherwise "New on TBM". | Section 4 rules |
| 4 | About | The bio, with any phone numbers and emails removed. | `bio` and `removeContactDetails` |
| 5 | Services | Cards for their public listings. Each opens the existing listing page, and the share code carries over. | Listing card allowlist |
| 6 | Reviews | Eligible reviews from all their listings: "Amina W.", month, listing name, stars, comment, and the provider's approved reply. | Section 4 rules |
| 7 | How to book | "Book online or ask TBM. You pay TBM by M-Pesa or card, and TBM coordinates your booking and supports you throughout." Two buttons: **See services**, and **Ask TBM about this provider** (the existing Zaina chat or custom request, with the provider named). TBM's official WhatsApp number. | Fixed copy, plus the existing chat and request pages |
| 8 | Safety and meaning | "Pay only through TBM. TBM never asks you to send money to a personal number." Then what the badge means: "TBM checked this provider's ID and that the service is theirs to offer. It isn't a guarantee of quality. Reviews come from guests who booked through TBM." | Fixed copy |

### Unavailable state

This applies to a page that's suspended, switched off, removed, or has no public listings:
- It says: "This provider isn't taking bookings on TBM right now." It links to similar services.
- It isn't indexed by search engines.
- Share links to it stop earning credit (the existing rule R8).
- A QR code that's already printed still lands somewhere useful.

### Home help and childcare

- **Publicly:** the business name or first name, with a logo, a photo of their work, or a service icon. **Never a face by default.** In the Hub, the photo field for these services says "Logo or a photo of your work, not your face".
- **After booking:** the confirmed customer sees the carer's first name and approved photo in My Bookings once the booking is confirmed. That's shared privately, through the booking.
  - **As built:** "Who's coming" in My Bookings, from `GET /api/bookings/:id/carers`. Only the guest who made the booking gets it (everyone else, TBM's admins included, gets "not found"), and only while the booking is upcoming or in progress, paid or with its deposit in, and after the carer has accepted the home-help job.
  - It carries the first name, the services, whether TBM checked their ID, and a link to the photo. Nothing else: no surname, email, phone or account ID.
  - The photo is shown only if TBM approved it as a face. It's streamed from private storage through `GET /api/bookings/:id/carers/:n/photo`, signed in and never cached. TBM keeps the approved photo's private copy for this (`photo_private_key`).
  - The note under it asks the guest to keep it private. It mentions TBM's ID check only when there was one, and says that isn't a guarantee.

### "Your host" block on listing pages

It's the same allowlisted summary: name, photo or logo, the Verified badge, languages, the rating line, and a link to the provider page. It's served by its own endpoint, `GET /api/public/providers/by-listing/:kind/:id`, so the listing responses don't change. It's hidden when the provider page would be unavailable.

## 3. Privacy and access controls

1. **One allowlist builder, on the server.** `toPublicProviderProfile()` builds every public provider response from exactly these keys:
   - `code`, `slug`, `displayName`, `serviceTypes`, `serviceAreas`, `languages`, `about`;
   - `photoUrl` (approved photos only) and `photoKind`;
   - `verified`, `verifiedSince` (month), `memberSince` (month), `foundingProvider`;
   - `rating` (`{ average, count }` or null);
   - `listings[]`, each with `kind`, `path`, `name`, `area`, `priceFrom`, `priceUnit` and `imageUrl`;
   - `reviews[]`, each a public review plus `listingName` and `reply`.

   Nothing is hidden in the browser; fields that aren't listed are never sent. A unit test checks the exact set of keys at every level.
2. **Never sent, and checked by tests:**
   - account, user, review and booking IDs, and `managerUserId`;
   - email addresses and phone numbers;
   - payout fields;
   - verification notes;
   - documents;
   - addresses more precise than an area name;
   - any UUID-shaped string.
3. **Free text is cleaned.** Bios, review comments and provider replies go through `removeContactDetails` before they leave the server. Applying this to public review comments is a small follow-up to Phase 0.
4. **Photos wait for approval:**
   - A new or changed photo is "pending" and isn't public.
   - Pending photos are kept in private storage, through the existing private-files setup. Only an approved photo is copied to the public bucket.
   - TBM's checklist: it's the right person or business; no phone numbers, QR codes, links or ID documents; no children's faces; nothing inappropriate.
   - A rejection comes with a short note to the provider.
5. **Status is live.** The page, the listing block, the badge and the card read suspension, the page switch and the verification status on every request. Nothing is cached in a way that outlives a suspension by more than 5 minutes.
6. **Suspended providers stop taking bookings** (decision 1). Today, suspension only blocks sign-in, and the provider's listings stay bookable. Proposed:
   - Booking creation refuses a listing whose provider is suspended, unless TBM has reassigned the listing.
   - Those listings drop out of public lists.
7. **Rate limits and caching:**
   - Public provider endpoints use the existing rate limiter and are cached for 5 minutes.
   - Unavailable pages send `noindex`.
   - The code is random, and the slug alone never finds a page.
8. **The live check script gains check P1.** It scans public provider pages and the "Your host" endpoint for fields outside the allowlist, IDs, and contact details.

## 4. Ratings and reviews

One module, `shared/review-eligibility.ts`, is used by the API, the listing pages, the provider page and the search-engine rating data.

**A review is eligible when all of these are true:**
- The booking is completed, and isn't cancelled or refunded.
- The reviewer is the booking's own account. That's already checked.
- The reviewer isn't the listing's provider. This is the new self-review check.
- The reviewer isn't a TBM admin account.
- It's the only review for that booking and listing. That's already checked in code, and a database unique index (section 10) will enforce it too.
- TBM hasn't hidden it.

**How ratings are shown:**
- A number appears only from **3 eligible reviews**. Before that, "New on TBM".
- The average has **one decimal place** (4.6, never rounded to 5.0), with the count beside it.
- It's always calculated from eligible reviews, never from the stored `rating` and `review_count` columns on listings.
- **Integrity finding:** locally, several listings have a review count but no review rows (seed data). The search-engine rating data uses those stored columns today. If the live database is the same, those ratings aren't from real reviews. Section 11 has a read-only query to check this.

**Replies and moderation:**
- The provider can reply once to each review, from the Hub. Contact details are removed, and TBM approves the reply before it's public. The provider can edit it until it's approved.
- TBM can hide a review only for abuse, personal details, or the wrong booking. The reason is recorded. A review is never hidden for being negative.

**What stays private:** response time, how often the provider accepts, and cancellations. These are for the provider and TBM only, unless you approve a public policy later.

**The business card doesn't show a rating.**

## 5. Smart business card

**What's on it:**
- the business or provider name;
- the main service, or a short line about what they offer;
- the approved photo or logo (never a face for home help and childcare);
- "Verified by TBM", only while verified;
- a QR code to the live provider page;
- "Scan to explore and book";
- "Bookings and guest support coordinated by Tembea Bila Matata".

It has no rating and no personal phone number.

**Formats:**

| Format | How |
|---|---|
| WhatsApp Status image | A 1080 × 1920 PNG from the existing canvas composer. |
| Shareable digital card | The provider page link, which shows a preview image when shared (section 1, share previews). |
| Print PDF | 85 × 55 mm, front and back, with a 3 mm bleed, at 300 dpi. No PDF tool is installed, so this needs one small library (`pdf-lib`), loaded only when someone downloads the PDF (decision 7). |
| Contact file (.vcf) | Name "Mwinyi Coast Stays (book via TBM)", organisation Tembea Bila Matata, TBM's official number, and the provider page link. No personal details. Only if you approve (decision 4). |

**When it's available:**
- The card is offered only while the provider page is live.
- If the page later becomes unavailable, the QR code opens the unavailable state.
- The existing per-listing QR card stays as it is.

## 6. Attribution and reporting

**Provider links:**
- They use `listing_share_links` with `listing_kind = 'provider'` and `listing_id` set to the page code.
- Visits and book taps are recorded by the existing `recordShareEvent`, with the same once-per-device-per-24-hours rule.

**New rule R9b:**
- A provider link credits a booking that includes any listing that provider manages at the time of booking.
- Any other booking counts as "helped".
- Rules R2 to R13 apply unchanged: 30 days, a visit recorded on the server, no credit for your own link, stopped links earn nothing, and the listing must be public.

**New event:** `enquire`, for taps on "Ask TBM about this provider". It's deduplicated the same way as visits.

**How attribution survives** (as built today, and unchanged):
- The share code is kept in the browser's `localStorage`, so it survives refreshes and moving from the provider page to a listing and on to checkout.
- Signing in or signing up partway through carries the claim across.
- The server keeps its own visit record, with the device and address hashed.
- Credit is decided once, when the booking is created, and stored on the booking.
- Chat bookings use `zaina_share_claims`.
- If the browser blocks storage, attribution falls back to the address seen at visit time.

**What Your shares reports, per link and per listing:**

| Line | Exact meaning |
|---|---|
| Visits | Devices that opened the link. One per device per 24 hours. |
| Book taps | Taps on Book or Check dates from the link. |
| Enquiries (new) | Taps on "Ask TBM" from the link. |
| Bookings: Paid | Credited bookings where TBM has received money that is the full amount or the required deposit. Bookings that take full payment only need the full amount. The booking isn't cancelled or refunded. (`getShareBookingState` = `confirmed`, rule R11.) |
| Bookings: Not paid yet | Credited bookings with no payment, a payment below the required deposit, or nothing to pay. (`pending`) |
| Bookings: Cancelled or refunded | The booking status is `cancelled`, or the payment status is `cancelled` or `refunded`. (`cancelled`) |
| Helped | The guest opened the link but booked something the link didn't cover. (`assisted`) |

**What it never shows:**
- No guest names or contact details. Only counts, short booking references and dates, and only to that provider and to TBM.
- No public analytics.

**What doesn't change:** there are no referral payments, and commission is unchanged.

### TBM's Spotlight: promoting TBM through providers, never against them

TBM also shares providers' pages on its own channels (WhatsApp, social media, newsletters), and will do the same for partners' pages once they have them. The aim is to grow TBM by showing the people on it, without TBM ever looking like a competitor to them.

**How it's built** (`shared/spotlight.ts`, Admin › Providers › a provider's account):
- TBM makes a Spotlight link from the provider's account panel. It's an ordinary row in `listing_share_links` (`listing_kind = 'provider'`, made by a TBM admin): no separate sharing or tracking system.
- Only while the page is live, and only if the provider hasn't said no. Providers choose in Share & grow ("Let TBM feature my page in its Spotlight", on by default, `spotlight_opt_out_at`, migration 0028). Saying no stops new links; it never removes what earlier links brought.
- TBM gets the message, a Copy button, WhatsApp, and a 1080 × 1920 "TBM SPOTLIGHT" image with a QR code. Links carry `utm_source=tbm`, `utm_campaign=spotlight`.
- The first share in any week tells the provider: "TBM is featuring your page… Bookings from it are yours, and your commission doesn't change."
- The provider's Your shares shows what the Spotlight brought them: times shared, visits, Book taps, and bookings paid or not paid yet. Counts only.
- TBM's share report labels these links "TBM Spotlight".

**Why it reads as promotion, not competition:**
- **The provider is the hero.** The message opens with their name ("TBM Spotlight: Kassim Coast Stays"), says what and where, and invites guests to "book with them through TBM". TBM appears as the stage and the support ("pay safely in your My Bookings checkout, with our team supporting you throughout"), never as the seller.
- **The link goes to their page, and only their services are on it.** The live provider page never shows other providers or TBM alternatives. (The unavailable state suggests similar services, because then there's nothing of theirs to book.)
- **Bookings stay theirs.** Credit for a Spotlight link is reporting only, like every share credit: the booking is the provider's job, their payout is unchanged, and there's no referral payment either way.
- **Only checked facts.** "Verified by TBM" only while verified; a rating only from 3 eligible reviews, to one decimal place; the Founding badge only once granted. No urgency, scarcity or invented numbers.
- **Reciprocity and consent.** The provider can say no, hears when they're featured, and sees the guests it sent them. That makes them likely to share TBM's post themselves, which reaches their own audience.
- **Partners later.** `buildSpotlightMessage` already words a partner's Spotlight as "Meet our partner: …", "We're proud to partner with …". It needs partner pages before it can be offered.

## 7. Founding Provider badge (proposal)

**Who's eligible.** All of these:
1. Approved by the cut-off. I propose the **first 50 providers approved, or 31 March 2027, whichever comes first**. You choose the final cut-off (decision 3).
2. Verified by TBM within 60 days of approval.
3. At least one listing published within 60 days of approval.
4. In good standing when the badge is granted.

**How it's granted:**
- TBM grants it once, from an admin list of eligible providers. It's recorded in `founding_provider_at`.
- It isn't recalculated afterwards, so it can't drift.

**How it's shown:**
- "Founding Provider", with the line "One of the first providers to join TBM".
- It sits beside the Verified badge and never above the reviews.
- It makes no claim about quality or safety.

**Keeping or losing it:**
- It's hidden while the provider is suspended or the page is switched off, and comes back if they're reinstated.
- A provider who pauses by choice keeps it.
- It's removed permanently if the account is removed, or the provider is suspended for fraud, safety or impersonation.

## 8. Onboarding fixes

**One application for every service, cars included.**
- Cars get the same four steps:
  - the vehicle: make, model, year, seats, gearbox, with or without driver, and area;
  - about you;
  - photos;
  - check and send.
- `/partner/apply` redirects to `/partner/apply/cars`.
- Old fleet applications stay readable in admin.
- Approving a car application creates the account, as other services do now. The car listing is then added in the Hub's existing "add a car" page, pre-filled from the application where possible.

**Honest wording about documents**, the same on the landing page, the application and the receipt email: "About five minutes to apply. Documents come later: before your listing goes live, TBM checks your ID and proof the service is yours. For a car, that's the logbook and insurance, so TBM knows the car is yours and insured to carry paying guests."
- Documents are uploaded at the verification stage, in the Hub, to private storage. Nothing that's genuinely required is dropped.

**A reference number.** For example `TBM-P-0142`, on the thank-you page and in the receipt email.

**A status page.** A link in the receipt email opens `/partner/application/<token>`.
- **Stages shown:** Received, In review, More information needed, Approved, Not approved, each with the next step.
- **Nothing personal** beyond the first name and the service.
- **The token:** random, stored only as a hash, valid for 90 days. The page is rate-limited, not indexed, and sends no referrer.

**Status emails:**
- **More information needed** (a new admin status): what TBM needs, and how to reply.
- **Approved:** the account-setup link.
- **Not approved:** kind wording, a reason chosen from a short list, and when to apply again.

The admin's own notes stay internal.

**Account setup without "Forgot password?":**
- The approval email has a "Set up your account" link. It works once and expires after 72 hours, and only its hash is stored. It uses the existing `password_reset_otps` table, with `purpose = 'account-setup'`.
- An expired link offers to send a new one.
- The email also says "Continue with Google" works if the address is a Gmail one.

**Draft answers** are kept for the browser tab, as today, for all services. It's deliberately not kept longer, because many providers use shared phones.

**Anti-impersonation line** on the landing page and in every application email: "TBM's official number is +254 718 475 264. TBM never asks for a joining fee, your password or a sign-in code."

## 9. Fees and earnings: no change

These are already as you asked, and this work keeps them:
- There's no universal commission rate. Payouts can't be approved without a recorded rate, and "Not set yet" shows until one is agreed.
- The estimator says it's "an example to plan with, not a promise".
- "No joining or monthly fee" appears next to "TBM earns a commission on each booking… agreed with you before your first payout".
- The call-back wording promises no two-day response.

Commission arrangements don't change.

## 10. Schema and migrations

All changes are additive, and no data is deleted. The SQL files are kept for the record, as with 0021 to 0023. `drizzle-kit push` applies `shared/schema.ts` on deploy.

The numbers below are the files as built (they were built in a different order from the first draft of this plan).

| Migration | Changes |
|---|---|
| `0024_review_integrity.sql` (Phase 1) | `reviews`: adds `status` (default `published`), `hidden_reason`, `hidden_by`, `hidden_at`, `provider_reply`, `provider_reply_status`, `provider_reply_at`, `provider_reply_reviewed_by` and `provider_reply_reviewed_at`. Adds a unique index on (`booking_id`, `user_id`, `target_type`, `target_id`). Check for duplicates before adding it (query below). |
| `0025_provider_application_tracking.sql` (Phase 1) | `provider_applications`: adds `reference` (unique, filled in for existing rows), `status_token_hash`, `applicant_message`, `decline_reason` and `decided_at`. Adds the status `needs-info`. `password_reset_otps`: adds `purpose` (default `password-reset`). |
| `0026_provider_public_pages.sql` (Phase 2) | `provider_profiles`: adds `public_code` (unique), `public_enabled` (default false), `public_enabled_at`, TBM's switch (`public_blocked_at`, `public_blocked_by`, `public_blocked_note`), photo approval (`photo_status`, `photo_kind`, `photo_approved_at`, `photo_pending_key`, `photo_pending_kind`, `photo_submitted_at`, `photo_reviewed_at`, `photo_reviewed_by`, `photo_review_note`) and `founding_provider_at`, `founding_cohort`. The slug isn't stored: it's made from the display name each time, and the code alone finds the page. |
| `0028_provider_spotlight.sql` (Spotlight) | `provider_profiles`: adds `spotlight_opt_out_at`, when the provider said no to TBM featuring their page. Empty means TBM may feature it while it's live. |
| `0027_listing_published_and_carer_photo.sql` (gap fixes) | `stays`, `cars`, `cooks`, `errands`, `experiences`: adds `first_published_at`, set by a database trigger the first time a listing goes from private to public and never changed afterwards. A value sent in a request is ignored. Listings already public before this ran have no date. `provider_profiles`: adds `photo_private_key`, the approved photo's private copy. Needs Postgres 14 or later (`CREATE OR REPLACE TRIGGER`). |
| No change | `listing_share_links` and `listing_share_events`: the kind and event-type columns are free text, so `provider` and `enquire` are new values in code only. |

The server also adds each migration's columns when it starts (`ADD COLUMN IF NOT EXISTS`), so an older database keeps working before the deploy step has run.

Read-only checks to run on the live database before migration 0024:

```sql
-- Listings whose stored review count doesn't match real reviews
SELECT 'stay' AS kind, s.id, s.review_count, (SELECT count(*) FROM reviews r WHERE r.target_type = 'stay' AND r.target_id = s.id) AS real_reviews
FROM stays s WHERE s.review_count <> (SELECT count(*) FROM reviews r WHERE r.target_type = 'stay' AND r.target_id = s.id);
-- (repeat for cars, cooks, errands and experiences)

-- Duplicate reviews that would block the unique index
SELECT booking_id, user_id, target_type, target_id, count(*) FROM reviews
GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;
```

## 11. Tests, by phase

| Phase | Unit | API (local harness) | Browser | Live script |
|---|---|---|---|---|
| 1 Onboarding and review integrity | Application status changes; reference format; the setup link expires, works once and is stored hashed; review eligibility (self-review, admin, cancelled, duplicate); one-decimal averages; the 3-review threshold | A car application through to approval and account setup; a status page with a bad or expired token; a self-review is refused; a duplicate is refused by the database; review comments have contact details removed | The car form on a phone; the status page; the setup page | R1 (exists) |
| 2 Provider pages | The exact allowlist keys; contact removal in bios; photo states; home help and childcare never public; suspended, off or no listings means unavailable; credit rule R9b | A deep key scan of the page and "Your host" responses (no IDs, contact details or payout data); suspension hides the page and refuses new bookings; a pending photo isn't served; credit, helped and own-link cases for provider links; enquiry counts | Provider page on phone and desktop; the unavailable page; the listing "Your host" block; the share preview | New P1 |
| 3 Ratings, replies, Founding badge | Eligibility shared by the API and the pages; reply moderation states; badge grant, hide and remove | The rating appears at 3 eligible reviews and not at 2; a hidden review leaves the average; replies stay unpublished until approved | The rating line, the reviews list and the replies | P1 extended |
| 4 Smart card | QR target and share code; card content (no rating, no personal number) | A card scan counts as a visit and credits correctly | PNG 1080 × 1920; PDF page size 91 × 61 mm with bleed and 85 × 55 mm trim; the contact file has no personal data | — |

Every phase also re-runs the existing suites: privacy access, provider end-to-end, comms and payouts.

## 12. Phases

| Phase | Contents | Status (13 October 2026) |
|---|---|---|
| 0 | Public reviews fix | On `main` (96cd989). **Not verified on the live site**: needs check R1. |
| 1 | Onboarding fixes (section 8) and review integrity (eligibility, self-review check, unique index, one decimal place, comment cleaning) | Released to `main` on 13 October 2026. |
| 2 | Public provider pages, "Your host" block, photo approval, suspension handling, provider links (R9b and `enquire`) and their reporting | Released to `main` on 13 October 2026. |
| 3 | Rating display and replies, Founding Provider badge | Released to `main` on 13 October 2026. |
| 4 | Smart business card, in every format | Released to `main` on 13 October 2026. |
| Gaps | Carer details after booking, listing publish dates, provider pages in the sitemap, the photo queue, the stored-rating check and recount, and the card redesign with the new back wording | Released to `main` on 13 October 2026. |
| Spotlight | TBM shares provider pages on its own channels (section 6) | Released to `main` on 13 October 2026. |

The owner approved the release on 13 October 2026. On `main`, the older page designs got the same rating rules (a number only from 3 eligible reviews), "Ask TBM about this provider" opens WhatsApp to TBM, and "Your host" sits after the reviews. What to check after deploy: `docs/provider-pages-release-runbook.md`. **Not yet verified on the live site.**

### As built: where it differs from this plan

- **Status and set-up links** carry their token after `#` (`/partner/application#…`, `/set-up-account#…`), not in the path, so it never reaches server logs or other sites; the page removes it from the address bar once read.
- **The page slug isn't stored.** It's made from the display name each time; the code alone finds the page, and an old or bare address moves to the current one.
- **Photos:** the approved photo is public only once `photo_approved_at` is set. Photos saved before this change stay private until TBM approves them. A new photo waits in private storage; the approved one stays up meanwhile. The Hub's business form can no longer set a photo directly.
- **TBM's switch** (`public_blocked_at`) was added so a page TBM switches off can't be switched back on by the provider.
- **Bios** also lose links and social handles, not only phone numbers and emails; listing cards show an area name, never a street or plot.
- **Founding Provider:** "a listing within 60 days" uses the date the listing was first published (`first_published_at`). A listing that was already public before dates were recorded uses its creation date instead, and the admin list marks it "estimated from its creation date" so TBM checks it before granting. Older accounts with no application use the account's creation date as their approval date.
- **Paying safely, in the provider's favour:** the page and the back of the card say "Book with confidence: to keep every transaction safe, and to protect hosts and guests alike from impersonation and scams, use the payment options in your My Bookings checkout." It frames paying through TBM as protection for both sides, not a warning about the provider. The contact file's note says the same.
- **The card's look:** deep ink-teal and ivory with champagne-gold hairlines, a quiet coastal wave line, Cormorant Garamond for names and tracked small capitals for labels. The QR code is drawn from its modules (rounded dots and eyes) in dark teal on ivory, with error correction Q; every format's code is read back by a decoder in the tests. Print text is at least 5.5 pt.
- **Replies** are also shown under reviews on listing pages, not only on the provider page.

### Gaps, now built (dev branch)

- **Home help, after booking:** "Who's coming" in My Bookings (section 2, Home help and childcare).
- **When a listing was first published:** recorded by the database (migration 0027) and used for the Founding Provider list.
- **Provider pages in the sitemap:** live pages only, with the same rules as the page itself (switched on, not blocked by TBM, provider not suspended, at least one public listing).
- **Photos to check:** one list on Admin › Providers of every photo waiting, including photos saved before checks began. Each opens the same review panel as the provider's account.
- **Stored ratings:** Admin › Reviews › Stored ratings compares the stored `rating` and `review_count` on every listing with its eligible reviews, and recounts only when TBM confirms. Seeded numbers with no eligible reviews behind them go to zero. Guests never saw the stored numbers; this tidies TBM's own screens.

### Still open

- **Live checks:** P1 (and R1 with replies) can only be run once these phases are released. Nothing here is verified on the live site.
- **The stored-rating recount on the live database** is TBM's call, after looking at the list of differences there.

## 13. Decisions

The owner accepted the recommended option for each on 13 October 2026 ("Yes, let's work on the phases"). What was built follows them:

1. **Suspended providers:** new bookings stop automatically. Their listings leave public lists, pages and the sitemap; Zaina doesn't offer them; booking creation checks the database directly.
2. **Page switch:** the provider switches their page on after opening a preview. TBM's switch wins over theirs.
3. **Founding Provider:** the first 50 approved, or approved by 31 March 2027, whichever comes first.
4. **Contact file:** included, with TBM's number only.
5. **Reviews on bookings TBM marked completed:** they count, like any other completed booking.
6. **Old `/api/providers` endpoints:** kept for now.
7. **`pdf-lib`:** allowed for the print PDF, loaded only when someone downloads it.

The questions as first asked:

1. **Suspended providers' listings:** stop new bookings automatically (recommended), or leave them to TBM to handle by hand?
2. **Provider page switch:** the provider switches it on after a preview (recommended), or it turns on automatically when they're verified?
3. **Founding Provider cut-off:** a date, the first N providers, or whichever comes first (recommended: the first 50 or 31 March 2027)?
4. **Contact file (.vcf):** include it, with TBM's number only, or leave it out?
5. **Reviews on bookings TBM marked completed by hand:** count them? TBM sets "completed" on some bookings itself.
6. **The old `/api/providers` endpoints:** remove them once a live check confirms the table is empty?
7. **One new library** (`pdf-lib`) for the print PDF: OK?
