-- Provider application tracking (Phase 1): a reference, a status link stored as
-- a hash only, what TBM told the applicant, and account-set-up links that reuse
-- the password code table. Additive only.
ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS reference varchar;
ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS status_token_hash varchar;
ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS applicant_message text;
ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS decline_reason varchar;
ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS decided_at text;
-- Older applications get a reference from their ID.
UPDATE provider_applications SET reference = 'TBM-P-' || upper(substr(md5(id), 1, 6)) WHERE reference IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS provider_applications_reference_idx ON provider_applications (reference);
CREATE INDEX IF NOT EXISTS provider_applications_status_token_idx ON provider_applications (status_token_hash);
ALTER TABLE password_reset_otps ADD COLUMN IF NOT EXISTS purpose varchar NOT NULL DEFAULT 'password-reset';
