ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS stay_service_selections jsonb NOT NULL DEFAULT '[]'::jsonb;
