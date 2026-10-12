# Production clean-up after the Provider Hub release

For the owner, or someone the owner authorises. Do the steps in order. Each one says who does it, what to run or click, and what a good result looks like. If a result doesn't match, stop and don't go on to the next step.

The detailed checks behind steps 4 to 7 are in `docs/live-verification-checklist.md`. Record each result in section 7 of that file.

## What this release changes on the live site

- The Provider Hub: each provider sees only their own services; Home, Profile & payouts, Earnings, Share & grow, Messages and Custom quotes; "Dates you're away" for home help and experiences.
- Become a Provider for every service, with an application form and TBM's Provider Applications page.
- **No default commission.** A payout can't be approved or paid until TBM records the rate agreed with that provider for that service.
- Emails when a provider is approved, verified or has payout details confirmed, and when their listing goes live.
- Share credit for custom requests and Zaina chat bookings. The paid-booking rule is now exact: full payment, or the booking's required deposit.
- Database: four new tables (`provider_profiles`, `listing_blocks`, `provider_applications`, `zaina_share_claims`). Nothing is changed or removed. A rehearsal on a copy of main's database structure confirmed this.

Not in this release: the website redesign, hotel rooms and the Zaina Platform.

## Step 1. Watch the deploy (you, 10 minutes)

1. Railway › the TBM service › **Deployments**. Open the new deployment for the release commit on `main`.
2. In the **pre-deploy log**, the schema push should create the four tables above and their indexes. It should drop nothing. If it asks a question, mentions dropping anything, or fails, **stop**: the previous deployment keeps running.
3. When it's Active, open the live site:
   - `/partner` shows "No joining or monthly fee" and "Commission agreed before your first payout";
   - `/api/provider-program/stats` shows a short JSON answer.

**Rollback.** In Railway › Deployments, redeploy the previous release. The new tables are left unused and do no harm. No existing data is changed by this release.

## Step 2. Record agreed commission rates (you, before any payout)

Without this step, no payout can be approved.

1. Admin › **Payments**. Open each provider that has unpaid orders.
2. Under **Commission**, each service with no rate shows "No rate recorded yet". Enter the rate you've agreed with that provider for that service, then press **Record rate**.
3. Payouts for that service now show the provider's amount, and can be approved and paid as before.

A rate of 0% is allowed, but only if that is what you agreed. Nothing is filled in for you.

## Step 3. Check emails go out (you, 5 minutes)

1. Railway › Variables: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and `NOTIFICATION_EMAILS` must be set. (Don't copy their values anywhere else.)
2. Submit a test application at `/partner/apply/stays` using an email address you can read.
3. Good result:
   - you receive "We've got your application";
   - the team address receives "New provider application";
   - Admin › **Provider Applications** shows it, marked "Arrived today".
4. Keep it open: you'll approve it in step 5.

## Step 4. Signed-out checks (you or Claude, 5 minutes)

On any computer with Node 18 or later, in a copy of the repository on `main`:

```
node scripts/verify-live-privacy.mjs
```

Good result: sections A to E all pass. If this session's environment is allowed to reach tembeabilamatata.com, Claude can run this step.

## Step 5. A test provider and the signed-in checks (you, 20 minutes)

1. Approve the test application from step 3. You'll get "Karibu: your Provider Hub is ready".
2. On `/auth`, use **Forgot password?** with that email and set a password.
3. As admin:
   - give that provider one test listing (Admin › Listings: create it, set the provider as its manager, make it public). You should get "Your listing is live";
   - make one test booking on it as a test guest;
   - in Admin › Bookings, record its payment.
4. In your own terminal (don't send the password to anyone, Claude included):
   ```
   VERIFY_PROVIDER_EMAIL=<test provider email> VERIFY_PROVIDER_PASSWORD=<its password> node scripts/verify-live-privacy.mjs
   ```
   Good result: section G passes. Guests appear as first name and initial, with no phone numbers or email addresses.
5. Sign in as the test provider and look at the Provider Hub on your phone: Home, the booking, Messages and Earnings.

## Step 6. Make existing documents private (an authorised person, about 1.5 hours, mostly waiting)

**This is the step that closes the open documents issue.** Files uploaded before the private-storage release are still in the public bucket.

**Where to run it.** On a trusted computer, in a copy of the repository on `main`, after `npm ci`.

**Credentials.**
- The tools need `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_MEDIA_BUCKET`.
- The simplest way is the Railway CLI: `railway link`, then put `railway run` in front of each command. The variables are passed in without being typed or saved.
- If Railway's `DATABASE_URL` is an internal address, use the external connection string from Supabase › Project Settings › Database.

**Keep every output file private and out of git.**

| # | Action | Good result |
|---|---|---|
| a | Supabase › Logs › Storage: export the logs for as far back as they go. | Saved with the incident file. They are the only record of who opened old links. |
| b | `railway run npx tsx scripts/storage-inventory.ts --out ./storage-inventory-private` | `summary.json` gives counts by category. Note the protected ones: vehicle documents, application documents and photos, guest attachments, unreferenced PDFs. |
| c | `node scripts/verify-live-privacy.mjs --inventory ./storage-inventory-private/objects.csv --public-base <media bucket public URL>` | **Fails**, listing the files still open. This is the "before" picture. The public URL is `https://<project>.supabase.co/storage/v1/object/public/<media bucket>`, or `SUPABASE_MEDIA_PUBLIC_BASE_URL` if set. |
| d | `railway run npx tsx scripts/migrate-private-files.ts` (dry run) | Counts match step b. Nothing changes. |
| e | **Approval needed.** `railway run npx tsx scripts/migrate-private-files.ts --apply` | `failed: 0`, and `verified` equals `moved`. Then check in Admin: a car's documents open for its provider, and an application's files open for admin. |
| f | **Approval needed.** `railway run npx tsx scripts/migrate-private-files.ts --remove-public` | Public copies deleted. The few old links it tests answer 4xx. |
| g | Wait **one hour** for cached copies to expire. Purge the CDN if there is one. | |
| h | Re-run the command in c. | **Passes**: every protected file refuses its old link, directly and through `/uploads/…`. |
| i | Re-run the command in b. | Zero files in protected categories left in the public bucket. |
| j | Supabase › SQL editor: run query A2 from `docs/storage-and-exposure-queries.sql`. | No policy lets the public (anon) key list the media bucket. If one does, remove it in Supabase › Storage › Policies. |

**Undo.**
- After e, and before f: `railway run npx tsx scripts/migrate-private-files.ts --restore-references` points records back at the public copies.
- After f there is nothing to undo: the private copies are what the app now uses.

## Step 7. Upload and guest-contact checks (you, 20 minutes)

Do sections 4 and 5 of `docs/live-verification-checklist.md` with the test provider:
- upload a document and open it as owner (opens), signed out (401) and as another provider (404);
- a test fleet application's files are private;
- the test booking's job, alert and messages show no guest contact.

## Step 8. Record and close (you)

1. Fill in section 7 of `docs/live-verification-checklist.md`: date, who, result.
2. Mark each security issue resolved only when its rows all pass:
   - **Calendars:** check C1.
   - **Provider booking data:** D1, G1, G2 and section 5.
   - **Documents:** A1, B1, B2, G3, G5 and sections 3 and 4 of the checklist (step 6 here).
3. Tidy the test data:
   - cancel the test booking and refund its payment;
   - make the test listing private.

   Keep the test provider account for future checks.

## Ongoing

- **Monthly:** re-run steps 4 and 6b. Expect zero protected files in the public bucket.
- **Quarantined files:** decide with your legal adviser how long to keep them. These are unreferenced PDFs moved to private storage in step 6.
- **New providers:** record their agreed rate as soon as you agree it, before their first payout.
