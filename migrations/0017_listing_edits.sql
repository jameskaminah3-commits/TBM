-- Providers' listing edits go live at once; TBM reviews them afterwards.
CREATE TABLE IF NOT EXISTS listing_edits (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_kind text NOT NULL,
  listing_id varchar NOT NULL,
  listing_title text NOT NULL,
  editor_user_id varchar NOT NULL,
  changes jsonb NOT NULL,
  created_at text NOT NULL,
  reviewed_at text,
  reviewed_by varchar
);

CREATE INDEX IF NOT EXISTS listing_edits_unreviewed_idx
  ON listing_edits (reviewed_at, created_at);
