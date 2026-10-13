// When each listing was first published (migration 0027). The database sets
// first_published_at itself, the first time a listing goes from private to
// public, and never changes it afterwards, so no request can backdate it. A
// listing that was already public before this existed has no date; the
// Founding Provider list falls back to its creation date and says so.
import { pool } from "./db";

export const publishedListingTables = ["stays", "cars", "cooks", "errands", "experiences"] as const;

const nowIso = `to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const listingPublishedSql = `
  CREATE OR REPLACE FUNCTION tbm_listing_first_published() RETURNS trigger AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      NEW.first_published_at := CASE WHEN NEW.is_public THEN ${nowIso} ELSE NULL END;
    ELSIF OLD.first_published_at IS NOT NULL THEN
      NEW.first_published_at := OLD.first_published_at;
    ELSIF NEW.is_public AND NOT OLD.is_public THEN
      NEW.first_published_at := ${nowIso};
    ELSE
      NEW.first_published_at := NULL;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  ${publishedListingTables.map((table) => `
  ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS first_published_at text;
  CREATE OR REPLACE TRIGGER ${table}_first_published BEFORE INSERT OR UPDATE ON ${table}
    FOR EACH ROW EXECUTE FUNCTION tbm_listing_first_published();`).join("")}
`;

let ready: Promise<void> | null = null;

// Run at start-up, so the date is recorded from the first publish after a deploy.
export function ensureListingPublishedTracking(): Promise<void> {
  ready ??= pool.query(listingPublishedSql).then(() => undefined).catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}
