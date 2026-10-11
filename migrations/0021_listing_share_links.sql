-- Phase 3: crediting bookings to the partner whose share link brought the guest.
-- Additive only: two new tables and nullable columns on booking_attributions.

-- A partner's share link: a random code for one of their listings.
CREATE TABLE IF NOT EXISTS listing_share_links (
  code varchar PRIMARY KEY,
  listing_kind varchar NOT NULL,
  listing_id varchar NOT NULL,
  created_by_user_id varchar NOT NULL,
  channel varchar,
  created_at text NOT NULL,
  shared_at text,
  stopped_at text,
  stopped_by_user_id varchar
);
CREATE INDEX IF NOT EXISTS listing_share_links_owner_idx
  ON listing_share_links (created_by_user_id, listing_kind, listing_id);

-- Visits and Book taps from share links, one per device per link per 24 hours.
-- Device and address are stored only as keyed hashes.
CREATE TABLE IF NOT EXISTS listing_share_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar NOT NULL,
  event_type varchar NOT NULL,
  device_hash varchar,
  ip_hash varchar,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS listing_share_events_code_idx
  ON listing_share_events (code, event_type, created_at);

-- The share decision for each booking, made once when the booking is created.
ALTER TABLE booking_attributions ADD COLUMN IF NOT EXISTS share_code varchar;
ALTER TABLE booking_attributions ADD COLUMN IF NOT EXISTS share_listing_kind varchar;
ALTER TABLE booking_attributions ADD COLUMN IF NOT EXISTS share_listing_id varchar;
ALTER TABLE booking_attributions ADD COLUMN IF NOT EXISTS share_credit varchar;
ALTER TABLE booking_attributions ADD COLUMN IF NOT EXISTS share_credit_reason varchar;
ALTER TABLE booking_attributions ADD COLUMN IF NOT EXISTS credited_user_id varchar;
ALTER TABLE booking_attributions ADD COLUMN IF NOT EXISTS assisted_share_codes text[] NOT NULL DEFAULT '{}'::text[];
