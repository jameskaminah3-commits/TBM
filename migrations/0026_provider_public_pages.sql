-- Public provider pages (Phase 2 of docs/provider-public-pages-plan.md).
-- Additive only: no data is changed or removed. The server also adds these
-- columns on start (server/provider-pages.ts), so an older database keeps
-- working before this has run.

-- The page's address is /p/<public_code>: 8 random characters, never the
-- account ID. Codes are given out when a provider first opens the page settings.
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_code varchar;
-- The provider's own switch (off until they turn it on after a preview), and
-- TBM's switch, which wins.
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_enabled_at text;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_blocked_at text;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_blocked_by varchar;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS public_blocked_note text;

-- Photo approval. photo_url is public only once photo_approved_at is set, so
-- photos saved before this change stay private until TBM approves them. A new
-- photo waits in private storage (photo_pending_key) until it's reviewed.
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_status varchar NOT NULL DEFAULT 'none';
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_kind varchar;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_approved_at text;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_pending_key varchar;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_pending_kind varchar;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_submitted_at text;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_reviewed_at text;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_reviewed_by varchar;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_review_note text;

-- Founding Provider badge (Phase 3): granted once by TBM, never recalculated.
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS founding_provider_at text;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS founding_cohort varchar;
-- Removed permanently for fraud, safety or impersonation, or a removed account.
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS founding_revoked_at text;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS founding_revoked_reason varchar;

CREATE UNIQUE INDEX IF NOT EXISTS provider_profiles_public_code_idx ON provider_profiles (public_code);

-- listing_share_links and listing_share_events don't change: provider page
-- links use listing_kind = 'provider' (listing_id = the page code), and taps on
-- "Ask TBM about this provider" are event_type = 'enquire'. Both columns are
-- free text.
