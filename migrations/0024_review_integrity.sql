-- Review integrity (Phase 1): moderation, one provider reply per review, and
-- one review per booking, guest and item. Additive only.
--
-- Before running: check for duplicates, which would stop the unique index.
--   SELECT booking_id, user_id, target_type, target_id, count(*) FROM reviews
--   GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'published';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_reason varchar;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_by varchar;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_at text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply_status varchar;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply_at text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply_reviewed_by varchar;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply_reviewed_at text;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_item_idx ON reviews (booking_id, user_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS reviews_target_idx ON reviews (target_type, target_id);
