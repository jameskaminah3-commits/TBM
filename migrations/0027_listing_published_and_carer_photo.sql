-- When listings are first published, and the private copy of a provider's
-- approved photo. Additive only: no data is changed or removed. The server
-- also runs this on start (server/listing-published.ts and
-- server/provider-pages.ts), so an older database keeps working before this
-- has run.

-- The database sets first_published_at the first time a listing goes from
-- private to public, and never changes it afterwards; whatever a request
-- sends for it is ignored. Listings already public before this ran have no
-- date: the Founding Provider list uses their creation date, marked as an
-- estimate.
CREATE OR REPLACE FUNCTION tbm_listing_first_published() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.first_published_at := CASE WHEN NEW.is_public THEN to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END;
  ELSIF OLD.first_published_at IS NOT NULL THEN
    NEW.first_published_at := OLD.first_published_at;
  ELSIF NEW.is_public AND NOT OLD.is_public THEN
    NEW.first_published_at := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  ELSE
    NEW.first_published_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE stays ADD COLUMN IF NOT EXISTS first_published_at text;
CREATE OR REPLACE TRIGGER stays_first_published BEFORE INSERT OR UPDATE ON stays
  FOR EACH ROW EXECUTE FUNCTION tbm_listing_first_published();
ALTER TABLE cars ADD COLUMN IF NOT EXISTS first_published_at text;
CREATE OR REPLACE TRIGGER cars_first_published BEFORE INSERT OR UPDATE ON cars
  FOR EACH ROW EXECUTE FUNCTION tbm_listing_first_published();
ALTER TABLE cooks ADD COLUMN IF NOT EXISTS first_published_at text;
CREATE OR REPLACE TRIGGER cooks_first_published BEFORE INSERT OR UPDATE ON cooks
  FOR EACH ROW EXECUTE FUNCTION tbm_listing_first_published();
ALTER TABLE errands ADD COLUMN IF NOT EXISTS first_published_at text;
CREATE OR REPLACE TRIGGER errands_first_published BEFORE INSERT OR UPDATE ON errands
  FOR EACH ROW EXECUTE FUNCTION tbm_listing_first_published();
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS first_published_at text;
CREATE OR REPLACE TRIGGER experiences_first_published BEFORE INSERT OR UPDATE ON experiences
  FOR EACH ROW EXECUTE FUNCTION tbm_listing_first_published();

-- The approved photo's private copy, kept when TBM approves a photo. A guest
-- with a confirmed home-help booking sees the carer's face from here, through
-- a signed-in route, never a public link.
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS photo_private_key varchar;
