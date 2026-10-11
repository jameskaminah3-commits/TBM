# Making vehicle documents and fleet-application files private

Status (11 Oct 2026):
- **Built and tested on the dev branch only.** It is not released. Production storage and data are unchanged.
- Tested against a local database and a local stand-in for Supabase Storage. It has not been run against a real Supabase project.
- Releasing it, and moving existing files, each need the owner's approval. They are run by someone authorised to hold production credentials.

The rule: **customers see listings and their photos, and nothing else.**
- Logbooks, insurance and inspection certificates, licences and registration papers are for compliance. Only TBM and the provider who manages the vehicle can open them.
- An applicant's files are for TBM's review only.
- A guest's request photo is for TBM, that guest and the providers working on that booking.

## How files were stored before this change

- **One public bucket for everything.** Every upload went into `SUPABASE_MEDIA_BUCKET` (`server/media.ts`). That covered listing photos, vehicle documents, fleet-application documents and photos, custom-request photos and blog images.
- **Permanent public links.** Each upload was saved as `YYYY-MM-DD/<timestamp>-<12 hex>.<ext>`, and the app stored its permanent public URL.
  - Anyone holding a link could open the file without signing in.
  - Files are served with `Cache-Control: max-age=3600`.
  - `/uploads/<file>` links redirect to `legacy/<file>` in the same bucket.
- **Where links were kept.**
  - Vehicle documents: `cars.documents`.
  - Fleet-application files: `fleet_applications.document_urls` and `photo_urls`. These were uploaded **with no sign-in**, before the application was submitted.
  - When an application was approved, its document links were copied into the new car's `documents`.
  - Custom-request photos: written into the booking's request text as `Attachment: <link>`.
- **Orphaned uploads.** Abandoned applications left files in the bucket that no record points at.
- **Who had links.**
  - Until `eb97639`, `GET /api/cars` and `/api/cars/:id` gave every car's document links to anyone. That fix is on `main`; whether it is live is unverified.
  - Until the same fix, the media library (`GET /api/admin/media`) listed the newest 200 bucket files to every provider.
  - Links may also have been copied into emails, chats or browser histories.

## What is built on dev

### Private storage

- **A private bucket.**
  - Name: `SUPABASE_PRIVATE_BUCKET`, default `tbm-private-files`.
  - On start-up the server creates it as private if it is missing.
  - If the bucket exists but is public, or has the same name as the media bucket, the server refuses to use it and logs an error. Uploads of protected files then fail rather than go public.
- **Local-disk setup.** Files go to `private-uploads/`, which is never served as static files and is ignored by git.
- **Opaque names.** Files are stored as `<kind>/<YYYY-MM>/<32 random hex>.<ext>`. The kinds are `vehicle-document`, `fleet-application`, `guest-attachment` and `quarantine`.
- **What the database holds.** Records hold `/api/files/<key>`, a link to the app itself, not to storage. The link is useless without a signed-in account that is allowed to open the file.
- **New tables** (migration `0020_private_files.sql`; the server also creates them if missing):
  - `private_files`: one row per protected file (kind, uploader, type, size).
  - `private_file_access`: every attempt to open one, allowed or not, with the user, role, reason and time.
  - `storage_migrations`: one row per file moved from the public bucket.

### Who can open a file: `GET /api/files/<key>`

| Who | Vehicle documents | Application files | Guest request photos | Quarantined files |
|---|---|---|---|---|
| Signed out | No (401) | No (401) | No (401) | No (401) |
| TBM admin | Yes | Yes | Yes | Yes |
| The provider who uploaded it | Yes | n/a (applicants upload without an account) | n/a | No |
| The provider managing a car whose documents list it | Yes | n/a | n/a | No |
| The guest who made the request | n/a | n/a | Yes | No |
| A provider working on that booking | n/a | n/a | Yes | No |
| Anyone else | No (404) | No (404) | No (404) | No (404) |

How the route works:
- A refusal to a signed-in user is a 404, so it doesn't confirm that the file exists.
- **Every attempt is logged**, including signed-out ones and refusals.
- Allowed requests are redirected to a signed storage link issued for **5 minutes**. On the local-disk setup, the file is sent directly.
- Responses carry `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- Paths with `..`, `.` or empty segments, and unknown kinds, are refused.

### Uploads

| Endpoint | Before | Now |
|---|---|---|
| `POST /api/provider/documents/upload` | public bucket | private, kind `vehicle-document`, uploader recorded |
| `POST /api/fleet-applications/upload` (no sign-in) | public bucket, no limit | private, kind `fleet-application`; **30 uploads per IP per hour** |
| `POST /api/custom-service-requests/upload` | public bucket | private, kind `guest-attachment`, uploader recorded |

The existing type, size and file-signature checks are unchanged. The response field names are also unchanged, so the pages didn't need to change.

### Records that refuse public links

- **Saving a car's documents** (`POST`/`PATCH` on `/api/provider/cars` and `/api/admin/cars`):
  - each new document must be a protected file;
  - a provider can only add files they uploaded;
  - TBM can add any protected file, but not a public link;
  - documents already on the car are kept as they are.
- **Submitting a fleet application** (`POST /api/fleet-applications`): every photo and document must be a protected application file. Otherwise the applicant sees "Please upload your photos and documents again."
- **Submitting a custom request** (`POST /api/custom-service-requests`): the attachment must be the requester's own protected photo. Otherwise they see "Please attach your photo again."

### Approving an application

- **Documents** go to the new car and stay private.
- **Vehicle photos** are copied into the public bucket at that moment, because they become the listing's photos.
- The new car starts **hidden** (`isPublic: false`), so TBM sees the photos before customers do.
- Front and rear photos may show the number plate, which is otherwise a protected field. Check or crop them before making the car public.

### Not changed

- Listing photos, blog images and the media library stay public, as intended.
- Public listing endpoints already leave out `documents`, registration number and other protected fields (`server/listing-privacy.ts`).
- A provider could still upload a document photo as a listing photo by mistake. TBM's review of listing changes is the check for that.

### A change from the earlier plan

The earlier plan suggested a short-lived upload token for the application form. It was not built, because anyone can load the form and get a token, so it adds little. What protects the files now:
- uploads land in private storage, so the endpoint can't be used to publish files;
- the per-IP limit caps abuse;
- an application only accepts application files.

## Existing files: the one-off move

New uploads being private **does not protect files already in the public bucket.** They stay public until they are moved.

The tool is `scripts/migrate-private-files.ts` (logic in `server/private-files-migration.ts`). It uses the same classification as the inventory (`server/storage-inventory.ts`):

| Category | Moved to |
|---|---|
| `vehicle-document` (in `cars.documents`) | `vehicle-document/migrated/<old path>` |
| `fleet-application-document`, `fleet-application-photo` | `fleet-application/migrated/<old path>` |
| `guest-attachment` (`Attachment:` links in bookings) | `guest-attachment/migrated/<old path>` |
| `unreferenced-pdf` (no record points at it) | `quarantine/migrated/<old path>`: TBM only, kept as possible evidence |
| `listing-photo`, `blog-image`, `unreferenced-media` | not moved |

A photo used by both an application and a listing counts as a listing photo, so a live listing never loses its pictures.

The steps are separate and each one is run on purpose:

1. **Dry run** (the default): lists what would move, by category, with record IDs. Changes nothing.
2. **`--apply`**: for each file:
   - copies it into the private bucket, server-side;
   - in one transaction, points every record that used it at the private link and logs the move;
   - checks the private copy exists.
   
   **The public copy stays**, so this step can be undone.
3. **`--remove-public`**: deletes the public copies of checked moves, then sends a header-only request to up to five old links to confirm they fail.
4. **`--restore-references`** (only before step 3): points records back at the public copies and forgets those moves. The private copies are kept.

The output has file paths and record IDs only, with no names or contact details. Running it again moves nothing twice.

## Runbook (needs approval for each step)

**Before the release**
1. Export Supabase's storage logs for as far back as they go. They are the only record of who opened public links before. See the incident fact sheet.
2. Run the read-only inventory: sections A and B of `docs/storage-and-exposure-queries.sql`, and `npx tsx scripts/storage-inventory.ts --out ./storage-inventory-private`. Keep the output private.

**Release (needs approval)**
3. Optional: set `SUPABASE_PRIVATE_BUCKET`. The default is `tbm-private-files`. No new secret is needed; the existing service-role key is used.
4. Deploy. The predeploy step creates the three new tables. Migration `0020_private_files.sql` does the same if run by hand.
5. Check the server log for `[private-files]` errors. In Supabase, confirm the private bucket exists and **Public** is off.
6. Smoke test:
   - upload a vehicle document as a test provider and open it from their documents page;
   - open the same link signed out (expect 401) and as another provider (expect 404).

**Existing files (needs approval)**
7. Run `npx tsx scripts/migrate-private-files.ts` (the dry run). Check that the counts match the inventory.
8. Run `--apply`. Expect `failed: 0` and `verified` equal to `moved`. Spot-check in the app:
   - a car's documents open for its provider;
   - an application's files open for an admin;
   - a booking's request photo opens for the guest.
9. Run `--remove-public`. Old public links stop working.
   - The CDN can still serve a cached copy for up to **1 hour**.
   - If `SUPABASE_MEDIA_PUBLIC_BASE_URL` points at another CDN, purge it there.
   - Re-test a few old links after the hour.
10. Re-run the inventory. Expect zero files in protected categories in the public bucket.
11. Record what was done, when and by whom, for the incident file.

**Rollback**
- **Code:** redeploy the previous release.
  - New protected files stay in the private bucket, but their links would no longer open.
  - So only roll back code before `--remove-public`, and run `--restore-references` first.
- **Step 8 (`--apply`):** `--restore-references` points records back at the public copies.
- **After step 9:** the private copies remain and the records already point at them. There is nothing to restore. Re-publishing the files is possible, but not advised.

What this cannot do:
- recall copies already downloaded, forwarded, or kept in someone's browser cache or chat app;
- show who opened a public link in the past, unless Supabase's storage logs for that period still exist.

## Still to do after the move

- Turn off listing for the public key on the media bucket, if query A2 shows a policy that allows it.
- Add the inventory to a monthly check: zero protected files in the public bucket.
- Decide, with the legal adviser, how long quarantined files are kept.

## Tests run on dev (local data and a local storage stand-in; not live)

- **`server/private-file-access.test.ts`:** the access rules (5 tests).
- **`server/storage-inventory.test.ts`:** classification, including a shared photo staying public.
- **Full unit suite:** 175/175 pass. Type check, client build and server bundle are clean.

**Protected files end to end, with the Supabase stand-in: 37/37.**
- Every upload lands in the private bucket and never in the public one.
- Each is opened by exactly the people in the table above, through a signed link marked not to be cached.
- Path tricks such as `..` and encoded `..` are refused.
- The per-IP upload limit applies.
- Applications, car documents and request photos refuse public links.
- Approval publishes the photos and keeps the documents private.
- Each attempt is logged, including refusals and signed-out attempts.

Not covered by a test:
- the 5-minute expiry of signed links. It is set in code (`signedUrlSeconds`) and enforced by Supabase.
- the approved car starting hidden. That behaviour already existed and is unchanged.

**A public "private" bucket is refused.** With the private bucket set to public, start-up refuses it, uploads fail, and nothing is stored.

**Moving existing files: 22/22.**
- The dry run lists exactly the protected files, leaves listing photos out and changes nothing.
- `--apply` repoints the car, the application and the booking. The right people can open the moved files and others can't.
- Orphans are quarantined.
- Running it again moves nothing.
- `--remove-public` makes old links fail and leaves listing photos untouched. Every move is recorded.
- `--restore-references` undoes a move whose public copy still exists.

**Local-disk setup: 5/5.** Files are stored outside the public uploads folder and opened only by the right people.

**TBM's car routes: 4/4.** An admin edit keeps a car's existing documents, can add a protected document, and can't add a public link when editing or creating a car.

**Regression suites still pass:**
- provider privacy API checks: 106/106;
- messaging screens: 17/17;
- listing sharing: 17/17;
- public listing fields: 22/22.

**Live:** none of this is verified on the live site. Repeat the smoke test and runbook checks against production after release.
