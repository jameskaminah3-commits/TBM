-- Provider Hub: business profiles with payout details and verification, date
-- blocks for home help and experience listings, and applications from every
-- kind of provider. The server also creates these on first use.
CREATE TABLE IF NOT EXISTS provider_profiles (
  user_id varchar PRIMARY KEY,
  business_name text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  photo_url text NOT NULL DEFAULT '',
  languages text[] NOT NULL DEFAULT '{}'::text[],
  service_areas text[] NOT NULL DEFAULT '{}'::text[],
  payout_method varchar,
  mpesa_number varchar,
  mpesa_name text,
  bank_name text,
  bank_account_name text,
  bank_account_number varchar,
  bank_branch text,
  payout_details_status varchar NOT NULL DEFAULT 'none',
  payout_details_updated_at text,
  payout_details_confirmed_at text,
  payout_details_confirmed_by varchar,
  verification_status varchar NOT NULL DEFAULT 'not-started',
  verification_note text,
  verified_at text,
  verified_by varchar,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_blocks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_kind varchar NOT NULL,
  listing_id varchar NOT NULL,
  start_date varchar NOT NULL,
  end_date varchar NOT NULL,
  reason text,
  created_by_user_id varchar,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS listing_blocks_listing_idx ON listing_blocks (listing_kind, listing_id, start_date);

CREATE TABLE IF NOT EXISTS provider_applications (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type varchar NOT NULL,
  full_name text NOT NULL,
  phone varchar NOT NULL,
  email varchar NOT NULL,
  town text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar NOT NULL DEFAULT 'new',
  review_note text,
  created_user_id varchar,
  reviewed_by varchar,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_applications_status_idx ON provider_applications (status, created_at);
