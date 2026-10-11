# Making vehicle documents and fleet-application files private

Status: **plan for review (11 Oct 2026). Nothing in production has been changed.** The inventory tools are read-only. Every step that changes production storage or data needs the owner's approval, and is run by someone authorised to hold production credentials.

## How files are stored today (from the code)

- **One bucket for everything.** Every upload (listing photos, vehicle documents, fleet-application documents and photos, custom-request photos, blog images) goes into one Supabase bucket, `SUPABASE_MEDIA_BUCKET` (`server/media.ts`).
- **Permanent public links.** Each upload is saved as `YYYY-MM-DD/<timestamp>-<12 hex>.<ext>`, and the app stores its permanent public URL (`getPublicUrl`). Anyone holding a link can open the file; no sign-in is involved. Files are served with `Cache-Control: max-age=3600`.
- **Old local uploads.** `/uploads/<file>` links redirect to `legacy/<file>` in the same bucket.
- **Document types.**
  - Vehicle documents are uploaded through `POST /api/provider/documents/upload` (partners and admins) and stored as links in `cars.documents`.
  - Fleet-application files are uploaded through `POST /api/fleet-applications/upload`, **with no sign-in**, before the application is submitted, and stored as links in `fleet_applications.document_urls` and `photo_urls`.
  - The application form asks for the registration logbook, insurance certificate, inspection certificate and tourism licence. When an application is approved, its document links are copied into the new car's `documents`.
  - Custom-request photos (`POST /api/custom-service-requests/upload`, signed-in guests) are written into the booking's request text as `Attachment: <link>`.
- **Orphaned uploads.** An application that was started and abandoned, or an anonymous upload, leaves files in the bucket that no record points at.
- **Who had links.**
  - Until `eb97639` (pushed to `main` on 11 Oct, live deploy unverified), `GET /api/cars` and `/api/cars/:id` gave every car's document links to anyone.
  - Until the same fix, the media library (`GET /api/admin/media`) listed the newest 200 bucket files to every partner, including other partners' and applicants' files.
  - Links may also have been copied into emails, chats or browser histories.
- **The public key.** The browser app ships the Supabase public (anon) key. Whether that key can list the bucket depends on the storage policies, which are not in this repository. Query A2 below shows them.

## Step 1: inventory (read-only, run now)

1. In the Supabase SQL editor, run sections A and B of `docs/storage-and-exposure-queries.sql`. They show:
   - whether the bucket is public;
   - which policies let the public list it;
   - how many files of each type and month it holds;
   - how many document links cars and fleet applications have, by document type.
2. From a trusted machine with production credentials, run:
   ```
   npx tsx scripts/storage-inventory.ts --out ./storage-inventory-private
   ```
   It writes:
   - `objects.csv`: every file, its category, whether it should be private, its size, type and date, and which records point at it;
   - `missing-files.csv`: records pointing at files that no longer exist;
   - `summary.json`: counts per category, date ranges, whether the bucket is public, whether the public key can list it, and the HTTP status of a HEAD request (headers only) for three files that should be private.
   
   It never downloads, changes or deletes a file. Keep the output private.
3. Decide from the counts. If there are no vehicle or application documents and no orphaned PDFs, step 3 is short. If there are, step 3 handles every one of them, including the orphans.

Categories the script uses:

| Category | From | Should be private |
|---|---|---|
| `vehicle-document` | `cars.documents` | Yes |
| `fleet-application-document` | `fleet_applications.document_urls` | Yes |
| `fleet-application-photo` | `fleet_applications.photo_urls` | Yes, until approved (then the listing's chosen photos are public) |
| `guest-attachment` | `Attachment:` links in bookings | Yes |
| `unreferenced-pdf` | No record points at it | Yes, as likely abandoned application documents |
| `listing-photo`, `blog-image` | Listing and blog image fields | No, they are meant to be public |
| `unreferenced-media` | No record points at it | Review; usually abandoned photo uploads |

## Step 2: stop new sensitive files going public (code, needs a release)

Built on the dev branch, released only with approval:

- **A private bucket.** For example `tbm-private-documents`, with `public = false` and no anon or authenticated policies. Only the server's service role reaches it.
- **Private document uploads.** Vehicle documents, fleet-application files and custom-request attachments are stored there under an opaque key, such as `documents/<random>`. The database stores the key, not a URL.
- **An authorised file route.** `GET /api/files/:key` checks who is asking:
  - admins: any file;
  - the partner who manages the car: that car's documents;
  - the guest who owns the booking: their own attachment.
  
  It then redirects to a signed URL that expires in 5 minutes, with `Cache-Control: private, no-store`. Each access is logged, as for contact releases.
- **A protected application upload.** `POST /api/fleet-applications/upload` keeps working for applicants without an account, but:
  - it needs a short-lived upload token issued with the application form (signed by the server, valid for about an hour, limited to a few files);
  - it is rate-limited per IP;
  - it keeps the existing type, size and file-signature checks;
  - files go to the private bucket.
- **Screens.** Admin › Fleet applications and the car document lists open files through the authorised route.

This protects **new** files only. Every file already in the public bucket stays public until step 3.

## Step 3: existing files and old links (one-off migration, needs approval)

Run as a script in two passes, `--dry-run` first, reviewed before the real run:

1. **Copy.** For each object the inventory marks private, copy it server-side into the private bucket. The service role does this inside Supabase, and contents don't leave it.
2. **Repoint.** Update each referring record (`cars.documents`, `fleet_applications.document_urls`/`photo_urls`, the booking's attachment link) to the new key, in a transaction.
3. **Record.** Write each move to a mapping table: old path, new key, record, time. This is the audit trail and the way back.
4. **Verify.** Each new key opens through the authorised route, and every referring record now points at a key.
5. **Remove the public copy.** Delete it from the public bucket only after verification. Old public links then return an error from Supabase instead of the file.
6. **Orphans.** Don't delete them. Move them to a private quarantine prefix, because the legal adviser may want them preserved as evidence (see the incident fact sheet). Decide retention with the adviser.
7. **Check old links are dead.** Re-run the inventory: the public bucket holds no private-category objects, and a HEAD request on a sample of old document links returns 400 or 404.
8. **Allow for caching.** Supabase's CDN may serve a cached copy for up to the `max-age` (1 hour) after deletion. If `SUPABASE_MEDIA_PUBLIC_BASE_URL` points at another CDN, purge it there too. Re-test after the cache window.

What this cannot do:
- recall copies already downloaded, forwarded, or kept in someone's browser cache or chat app;
- prove who opened a link in the past, unless Supabase's storage logs for that period still exist. They are kept for a limited time that depends on the plan, so check and export them now.

### Rollback for step 3

- **Before deleting public copies:** reverse by repointing records to the old paths from the mapping table.
- **After deleting:** the private copies remain; repoint the records and serve them through the authorised route. Re-publishing them is possible from the private copies, but not advised.

## Step 4: tidy up and prevent recurrence

- Turn off listing for the public key on the media bucket, if A2 shows a policy that allows it.
- Keep `/api/admin/media` admin-only for documents (done in `eb97639` for non-admins), and exclude document categories from the media library entirely.
- Add the inventory to a monthly check: zero private-category objects in the public bucket.
- Record what was done, when and by whom, for the incident file.

## Tests before each step is called done

- **Step 1:** inventory output reviewed; counts reconcile with queries A and B.
- **Step 2:**
  - an upload lands in the private bucket;
  - the stored value is a key, not a URL;
  - the authorised route returns 302 to a signed link for the admin and the owning partner, and 403 or 404 for another partner, a guest and a signed-out visitor;
  - the signed link expires;
  - the upload endpoint refuses requests without a valid token, and over its rate limit.
- **Step 3:**
  - the dry run lists every expected object;
  - the real run reports zero failures;
  - the post-migration inventory shows zero private-category objects in the public bucket;
  - old links return 400 or 404 after the cache window;
  - every referring record opens through the authorised route.
- **Live:** each of these is repeated against production after release. Results run against a local copy are labelled as such and don't count as verified on live.
