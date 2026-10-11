-- Partners don't get guests' contact details or full names. TBM can share them with one
-- partner on one booking for a limited time, with a recorded reason, and every
-- time the partner opens them is recorded.
CREATE TABLE IF NOT EXISTS guest_contact_releases (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id varchar NOT NULL,
  provider_user_id varchar NOT NULL,
  share_phone boolean NOT NULL DEFAULT true,
  share_email boolean NOT NULL DEFAULT false,
  share_full_name boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  granted_by varchar NOT NULL,
  granted_at text NOT NULL,
  expires_at text NOT NULL,
  revoked_at text,
  revoked_by varchar
);

CREATE INDEX IF NOT EXISTS guest_contact_releases_booking_idx
  ON guest_contact_releases (booking_id, provider_user_id, expires_at);

CREATE TABLE IF NOT EXISTS guest_contact_release_views (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id varchar NOT NULL,
  booking_id varchar NOT NULL,
  provider_user_id varchar NOT NULL,
  viewed_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS guest_contact_release_views_release_idx
  ON guest_contact_release_views (release_id, viewed_at);
