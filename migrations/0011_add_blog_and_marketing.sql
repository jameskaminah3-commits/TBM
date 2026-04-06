CREATE TABLE IF NOT EXISTS public.blog_posts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL,
  excerpt text NOT NULL,
  content_markdown text NOT NULL,
  featured_image text,
  featured_image_alt text,
  author text NOT NULL,
  seo_title text,
  seo_description text,
  seo_keywords text,
  published_at text,
  status text NOT NULL DEFAULT 'draft',
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS blog_posts_slug_idx
ON public.blog_posts (slug);

CREATE INDEX IF NOT EXISTS blog_posts_status_idx
ON public.blog_posts (status);

CREATE TABLE IF NOT EXISTS public.marketing_promos (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code varchar UNIQUE,
  description text,
  promo_type varchar NOT NULL DEFAULT 'percent',
  status varchar NOT NULL DEFAULT 'draft',
  channel varchar NOT NULL DEFAULT 'homepage',
  audience text,
  eligible_categories text[] NOT NULL DEFAULT '{}'::text[],
  bundle_label text,
  discount_percent integer,
  discount_amount integer,
  minimum_spend integer,
  usage_limit integer,
  redemption_count integer NOT NULL DEFAULT 0,
  attributed_revenue integer NOT NULL DEFAULT 0,
  landing_path text,
  start_at text,
  end_at text,
  notes text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS marketing_promos_status_idx
ON public.marketing_promos (status);

CREATE INDEX IF NOT EXISTS marketing_promos_channel_idx
ON public.marketing_promos (channel);
