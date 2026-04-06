ALTER TABLE IF EXISTS public.blog_posts
ADD COLUMN IF NOT EXISTS primary_cta_label text,
ADD COLUMN IF NOT EXISTS primary_cta_href text,
ADD COLUMN IF NOT EXISTS primary_promo_code varchar;

ALTER TABLE IF EXISTS public.marketing_promos
ADD COLUMN IF NOT EXISTS auto_apply boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS required_categories text[] NOT NULL DEFAULT '{}'::text[],
ADD COLUMN IF NOT EXISTS minimum_nights integer,
ADD COLUMN IF NOT EXISTS minimum_guests integer,
ADD COLUMN IF NOT EXISTS minimum_service_count integer;

CREATE TABLE IF NOT EXISTS public.marketing_attribution_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id varchar NOT NULL,
  source_type varchar NOT NULL DEFAULT 'direct',
  source_id varchar,
  source_slug text,
  source_path text,
  source_title text,
  promo_code varchar,
  landing_path text,
  referrer_path text,
  entry_path text,
  utm_source varchar,
  utm_medium varchar,
  utm_campaign varchar,
  utm_content varchar,
  event_type varchar NOT NULL,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS marketing_attribution_events_session_idx
ON public.marketing_attribution_events (session_id);

CREATE INDEX IF NOT EXISTS marketing_attribution_events_source_idx
ON public.marketing_attribution_events (source_type, source_id);

CREATE INDEX IF NOT EXISTS marketing_attribution_events_created_at_idx
ON public.marketing_attribution_events (created_at);

CREATE TABLE IF NOT EXISTS public.booking_attributions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id varchar NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  session_id varchar NOT NULL,
  source_type varchar NOT NULL DEFAULT 'direct',
  source_id varchar,
  source_slug text,
  source_path text,
  source_title text,
  promo_id varchar REFERENCES public.marketing_promos(id) ON DELETE SET NULL,
  promo_code varchar,
  promo_name text,
  landing_path text,
  referrer_path text,
  entry_path text,
  utm_source varchar,
  utm_medium varchar,
  utm_campaign varchar,
  utm_content varchar,
  original_subtotal integer NOT NULL DEFAULT 0,
  discount_amount integer NOT NULL DEFAULT 0,
  final_revenue integer NOT NULL DEFAULT 0,
  created_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_attributions_booking_idx
ON public.booking_attributions (booking_id);

CREATE INDEX IF NOT EXISTS booking_attributions_session_idx
ON public.booking_attributions (session_id);

CREATE INDEX IF NOT EXISTS booking_attributions_source_idx
ON public.booking_attributions (source_type, source_id);

CREATE INDEX IF NOT EXISTS booking_attributions_promo_idx
ON public.booking_attributions (promo_id, promo_code);
