ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS payment_status varchar NOT NULL DEFAULT 'paid',
ADD COLUMN IF NOT EXISTS payment_provider varchar,
ADD COLUMN IF NOT EXISTS payment_reference text,
ADD COLUMN IF NOT EXISTS payment_session_id text,
ADD COLUMN IF NOT EXISTS payment_currency varchar NOT NULL DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS payment_amount integer,
ADD COLUMN IF NOT EXISTS payment_hold_expires_at text,
ADD COLUMN IF NOT EXISTS paid_at text,
ADD COLUMN IF NOT EXISTS payment_failed_at text;
