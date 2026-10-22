-- TBM's SEO work on listings and the area pages (shared/listing-seo.ts).
-- Additive only. The server also creates these on start
-- (server/listing-seo-store.ts).

CREATE TABLE IF NOT EXISTS listing_seo (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_kind varchar NOT NULL,
  listing_id varchar NOT NULL,
  seo_title text,
  seo_description text,
  focus_keyword text,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_alts jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by varchar,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS listing_seo_listing_idx ON listing_seo (listing_kind, listing_id);

CREATE TABLE IF NOT EXISTS seo_area_pages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  area_key varchar NOT NULL,
  service varchar NOT NULL,
  heading text,
  seo_title text,
  seo_description text,
  intro text,
  updated_by varchar,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS seo_area_pages_area_service_idx ON seo_area_pages (area_key, service);
