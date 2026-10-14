# Provider pages release: what to check and do after deploy

For the owner, or someone the owner authorises. Do the steps in order. Each one says what to look at and what a good result looks like. If a result doesn't match, stop and don't go on.

The detailed checks are in `docs/live-verification-checklist.md`. The plan behind this release, and why it's built this way, is in `docs/provider-public-pages-plan.md`.

## What this release changes on the live site

**Guests will notice:**
- **Ratings come only from real, eligible reviews.** A rating number appears only from 3 eligible reviews, to one decimal place. Below that, listings say "New on TBM". Listings whose stored rating had no real reviews behind it (seed or old numbers) now show "New on TBM". This is intended: TBM never shows a rating it can't back up.
- Providers' replies to reviews appear under the review once TBM approves them.
- "Your host" on listing pages, and public provider pages (`/p/<code>/<name>`), once a provider switches theirs on. Every page starts switched off.
- A confirmed home-help booking shows "Who's coming" in My Bookings: the carer's first name and approved photo, for that guest only.
- The provider page and business card say: "Book with confidence. To keep every transaction safe, and to protect hosts and guests alike from impersonation and scams, use the payment options in your My Bookings checkout."

**Providers will notice:**
- Cars use the same short application as other services. Applicants get a reference, a status link and emails at each decision, and approved applicants get a one-time "Set up your account" link.
- Share & grow: their public page (preview, then switch on), a premium business card (Status image, print PDF, contact file), and the choice to let TBM feature them in its Spotlight.
- Reviews: reply to each review; TBM approves replies before they're public.
- **Profile photos now need TBM's approval.** A photo saved before this release stays private until TBM approves it in Admin › Providers › Photos to check.
- A suspended provider's listings stop taking new bookings and leave public lists.

**TBM will notice (Admin):**
- Providers: Photos to check, Founding Providers, each provider's public page and photo review, and the TBM Spotlight.
- Reviews: replies waiting for approval, hiding a review (abuse, personal details or wrong booking only), and Stored ratings.

**Database** (applied by the deploy's schema push, all additive; nothing is removed):
- New columns on `reviews`, `provider_applications`, `password_reset_otps`, `provider_profiles`, and `first_published_at` on the five listing tables.
- Unique indexes: one review per booking, guest and item; one application reference; one page code.
- On first start, the server also adds a database trigger that records when each listing is first published, and fills in a reference for each existing application.

A rehearsal on a database with main's structure and test data applied all of this with no questions and nothing dropped, and the release server started on it cleanly.

Not in this release: the website redesign, hotel rooms, the Zaina Platform, and website bookings with a 50% deposit.

## Step 1. Watch the deploy (10 minutes)

1. Railway › the TBM service › **Deployments**. Open the new deployment for the release commit on `main`.
2. In the **pre-deploy log**, the schema push should add the columns and indexes above and say "Changes applied". It should drop nothing.
   - If it **asks a question**, mentions **dropping** anything, or **fails**, stop: the previous deployment keeps running.
   - If it fails on `reviews_one_per_item_idx`, the live database has a duplicate review (the same guest reviewing the same item twice on one booking). Run the read-only duplicate query in `docs/provider-public-pages-plan.md`, section 10, and tell the developer which rows it finds. Nothing is changed meanwhile.
3. When it's Active, open the live site:
   - a listing page loads, with "New on TBM" or a rating like "4.7/5";
   - `/p/zzzzzzzz` says "This provider isn't taking bookings on TBM right now".

**Rollback.** In Railway › Deployments, redeploy the previous release. The new columns are left unused and do no harm. No existing data is changed by this release, except that each application gets a reference.

## Step 2. Run the live check (5 minutes, read-only)

From a computer with the repository: `node scripts/verify-live-privacy.mjs`. Every line should be PASS or SKIP; any FAIL means stop and tell the developer. Record the result in `docs/live-verification-checklist.md`, section 7.

## Step 3. Photos (as they come in)

Admin › Providers › **Photos to check**. Approve each photo that's the right person or business, with no phone numbers, QR codes, links, ID documents or children's faces. Turn one down with a short note so the provider can send a better one. For home help, a face is never shown publicly, even when approved; it's shown only to the guest of a confirmed booking.

## Step 4. Stored ratings (when you're ready)

Admin › Reviews › **Stored ratings** lists listings whose stored numbers differ from their eligible reviews. Guests already see the eligible numbers; this tidies TBM's own screens. Recount when you're happy with the list. Seeded numbers go to zero.

## Step 5. Invite providers to switch on their page

Tell providers (WhatsApp or email) that their page is ready to preview in Share & grow, and that they choose when it goes live. Once a page is live:
- their business card and page link are available to them;
- TBM can feature them in the Spotlight (Admin › Providers › the provider › TBM Spotlight), unless they've said no.

## Step 6. Founding Providers (any time before 31 March 2027)

Admin › Providers › **Founding Providers** lists who's eligible. Grant the badge once to each eligible provider. Dates marked "estimated" come from a listing that was already public before publish dates were recorded: check those before granting.
