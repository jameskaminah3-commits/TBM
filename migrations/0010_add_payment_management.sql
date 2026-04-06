CREATE TABLE IF NOT EXISTS public.provider_commission_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id varchar NOT NULL,
  provider_category varchar NOT NULL,
  commission_percent integer NOT NULL DEFAULT 0,
  notes text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_commission_settings_provider_category_idx
ON public.provider_commission_settings (provider_user_id, provider_category);

CREATE TABLE IF NOT EXISTS public.booking_payouts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id varchar NOT NULL,
  provider_user_id varchar NOT NULL,
  provider_category varchar NOT NULL,
  service_id varchar NOT NULL,
  service_name text NOT NULL,
  guest_name text NOT NULL,
  gross_amount integer NOT NULL,
  commission_percent integer NOT NULL DEFAULT 0,
  commission_amount integer NOT NULL DEFAULT 0,
  payout_amount integer NOT NULL DEFAULT 0,
  status varchar NOT NULL DEFAULT 'pending',
  due_at text,
  paid_at text,
  payment_method varchar,
  payment_reference text,
  notes text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_payouts_booking_provider_service_idx
ON public.booking_payouts (booking_id, provider_user_id, provider_category, service_id);

CREATE INDEX IF NOT EXISTS booking_payouts_status_idx
ON public.booking_payouts (status);
