-- Read-only queries for the Supabase SQL editor (production). SELECT only:
-- nothing here changes data. Results are counts and dates. The only rows they
-- list are policy definitions and document labels, never guests' names or
-- contact details.
-- Replace :bucket with the value of SUPABASE_MEDIA_BUCKET before running.

-------------------------------------------------------------------------------
-- A. Storage: is the bucket public, who can list it, what's in it
-------------------------------------------------------------------------------

-- A1. Buckets and whether each is public (public = anyone with a link can open a file).
SELECT id, name, public, file_size_limit, allowed_mime_types, created_at
FROM storage.buckets;

-- A2. Policies on storage.objects. A SELECT policy for anon/public on the media
-- bucket means anyone with the public (anon) key can list file names.
SELECT policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects';

-- A3. Files in the media bucket by month and type.
SELECT date_trunc('month', created_at) AS month,
       metadata->>'mimetype'        AS mimetype,
       count(*)                     AS files,
       pg_size_pretty(sum((metadata->>'size')::bigint)) AS size
FROM storage.objects
WHERE bucket_id = ':bucket'
GROUP BY 1, 2
ORDER BY 1, 2;

-- A4. PDFs (vehicle and application documents are mostly PDFs): count and dates.
SELECT count(*) AS pdf_files, min(created_at) AS first_uploaded, max(created_at) AS last_uploaded
FROM storage.objects
WHERE bucket_id = ':bucket'
  AND (metadata->>'mimetype' = 'application/pdf' OR name ILIKE '%.pdf');

-------------------------------------------------------------------------------
-- B. Records that point at documents
-------------------------------------------------------------------------------

-- B1. Vehicle documents attached to car listings.
SELECT count(*) FILTER (WHERE jsonb_array_length(documents) > 0) AS cars_with_documents,
       coalesce(sum(jsonb_array_length(documents)), 0)          AS document_links
FROM cars;

-- B2. Vehicle documents by type (labels such as "Registration Logbook").
SELECT d.label, count(*)
FROM cars, jsonb_to_recordset(documents) AS d(url text, label text)
GROUP BY d.label
ORDER BY 2 DESC;

-- B3. Fleet applications: how many, with how many documents and photos, by status and month.
SELECT status,
       date_trunc('month', created_at::timestamptz) AS month,
       count(*)                                     AS applications,
       coalesce(sum(jsonb_array_length(document_urls)), 0) AS document_links,
       coalesce(sum(jsonb_array_length(photo_urls)), 0)    AS photo_links
FROM fleet_applications
GROUP BY 1, 2
ORDER BY 2, 1;

-- B4. Fleet application documents by type.
SELECT d.label, count(*)
FROM fleet_applications, jsonb_to_recordset(document_urls) AS d(url text, label text)
GROUP BY d.label
ORDER BY 2 DESC;

-- B5. Custom requests with a guest-uploaded attachment.
SELECT count(*) AS bookings_with_attachments, min(created_at), max(created_at)
FROM bookings
WHERE service_request_details LIKE '%Attachment:%';

-------------------------------------------------------------------------------
-- C. Scale of the booking-data exposure (counts only)
-------------------------------------------------------------------------------

-- C1. Provider accounts, and how many have had at least one job.
SELECT count(*) FILTER (WHERE role = 'provider') AS provider_accounts,
       (SELECT count(DISTINCT provider_user_id) FROM booking_service_assignments WHERE provider_user_id IS NOT NULL) AS providers_with_jobs
FROM users;

-- C2. Bookings a provider had a job on (each was readable in full by that
-- provider), with the earliest and latest booking dates.
SELECT count(DISTINCT a.booking_id) AS bookings_with_provider_jobs,
       count(DISTINCT a.booking_id) FILTER (WHERE b.guest_phone IS NOT NULL AND b.guest_phone <> '') AS with_guest_phone,
       count(DISTINCT a.booking_id) FILTER (WHERE b.payment_reference IS NOT NULL AND b.payment_reference <> '') AS with_payment_reference,
       min(b.created_at) AS earliest_booking, max(b.created_at) AS latest_booking
FROM booking_service_assignments a
JOIN bookings b ON b.id = a.booking_id;

-- C3. Bookings on provider listings that had NO job for that provider (unpaid
-- holds, or bookings before the listing was theirs). The per-type provider
-- lists also showed these, to whoever managed the listing.
SELECT count(*) AS bookings_on_listings_without_a_job
FROM bookings b
WHERE NOT EXISTS (SELECT 1 FROM booking_service_assignments a WHERE a.booking_id = b.id);

-- C4. Bookings that showed on a public calendar: those that held dates (paid,
-- deposit paid, held, or admin-locked) and weren't cancelled. A booking stayed
-- on the calendar from creation until its end date, so this counts every
-- booking that could have appeared.
SELECT booking_type,
       count(*) AS bookings,
       min(check_in) AS earliest_check_in,
       max(check_out) AS latest_check_out
FROM bookings
WHERE status <> 'cancelled'
  AND (payment_status = 'paid' OR coalesce(payment_amount_paid, 0) > 0)
GROUP BY booking_type;

-- C5. Payment messages in booking chats (M-Pesa codes, cash notes) on bookings
-- that had a provider job.
SELECT count(*) AS payment_messages, min(m.created_at), max(m.created_at)
FROM booking_messages m
WHERE (m.message LIKE 'Customer submitted a temporary manual M-Pesa payment%'
    OR m.message LIKE 'Admin note: temporary M-Pesa%'
    OR m.message LIKE 'Admin note: cash %')
  AND EXISTS (SELECT 1 FROM booking_service_assignments a WHERE a.booking_id = m.booking_id);

-- C6. In-app and push alerts sent to providers about booking messages, and how
-- many push notifications were delivered to their devices.
SELECT count(*) AS alerts_to_providers,
       count(*) FILTER (WHERE i.delivery_state->'push'->>'status' = 'delivered') AS pushes_delivered,
       count(*) FILTER (WHERE i.body ILIKE '%M-Pesa%') AS mentioning_mpesa,
       min(i.created_at), max(i.created_at)
FROM app_inbox_items i
JOIN users u ON u.id = i.user_id AND u.role = 'provider'
WHERE i.type = 'booking-message';

-- C7. Payouts that carried TBM's internal notes to the provider.
SELECT count(*) FILTER (WHERE notes IS NOT NULL AND notes <> '') AS payouts_with_internal_notes,
       count(*) AS payouts
FROM booking_payouts;
