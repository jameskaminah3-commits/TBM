-- 0007_rooms_and_bookings.sql
--
-- Phase 4, the hospitality pilot: a guesthouse, lodge or small hotel sells
-- its rooms through Zaina and takes deposits into its own payment account.
--
--   booking_settings   the business's booking policy (currency, deposit,
--                      holds, check-in and check-out times, tax,
--                      cancellation) and the payment accounts it has
--                      connected. Keys and passwords are business secrets
--                      (encrypted), never columns here.
--   offerings          what can be booked. For now, room types: a name, how
--                      many identical rooms there are (I11), how many guests
--                      each sleeps, how it is booked (instantly with a
--                      deposit, on request, or by enquiry) and its pricing
--                      rules, which the pricing module checks and applies
--                      (src/booking/pricing.ts, I1).
--   offering_blocks    nights closed to bookings: repairs, or rooms sold
--                      elsewhere.
--   bookings           a stay: dates, rooms, guests, the price as quoted and
--                      where it stands. An unpaid booking holds its rooms
--                      until hold_expires_at.
--   payments           money towards a booking: card or M-Pesa through
--                      Paystack, M-Pesa Express (a payment prompt on the
--                      customer's phone), an M-Pesa code the team checks, or
--                      cash and bank transfers the team records.

create table booking_settings (
  business_id text primary key references businesses (id) on delete cascade,
  currency text not null default 'KES' check (currency in ('KES', 'USD')),
  -- 0: no deposit (the stay is paid at the venue); 100: paid in full.
  deposit_percent integer not null default 30 check (deposit_percent between 0 and 100),
  -- How long an unpaid booking keeps its rooms.
  hold_minutes integer not null default 30 check (hold_minutes between 10 and 1440),
  -- How long a request keeps its rooms while the team decides (0: it doesn't).
  request_hold_hours integer not null default 24 check (request_hold_hours between 0 and 168),
  check_in_time text not null default '14:00' check (check_in_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  check_out_time text not null default '10:00' check (check_out_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  cancellation_policy text check (cancellation_policy is null or length(cancellation_policy) <= 2000),
  tax_name text check (tax_name is null or length(tax_name) between 1 and 40),
  tax_percent numeric(5, 2) check (tax_percent is null or (tax_percent > 0 and tax_percent <= 50)),
  tax_included boolean not null default true,
  -- Payment accounts. Paystack: the business's own keys (secret
  -- "paystack_secret_key"), or a subaccount of the platform's account.
  paystack_mode text not null default 'off' check (paystack_mode in ('off', 'own_keys', 'subaccount')),
  paystack_subaccount text check (paystack_subaccount is null or paystack_subaccount ~ '^ACCT_[A-Za-z0-9]{4,40}$'),
  -- M-Pesa Express (Daraja): secrets "mpesa_consumer_key", "mpesa_consumer_secret", "mpesa_passkey".
  mpesa_express boolean not null default false,
  mpesa_environment text not null default 'production' check (mpesa_environment in ('sandbox', 'production')),
  mpesa_type text check (mpesa_type is null or mpesa_type in ('paybill', 'till')),
  mpesa_shortcode text check (mpesa_shortcode is null or mpesa_shortcode ~ '^[0-9]{5,10}$'),
  -- Buy goods: the till customers pay (the shortcode is then the store number).
  mpesa_till text check (mpesa_till is null or mpesa_till ~ '^[0-9]{5,10}$'),
  -- A paybill or till the customer pays by hand; the team checks the code.
  mpesa_manual_type text check (mpesa_manual_type is null or mpesa_manual_type in ('paybill', 'till')),
  mpesa_manual_number text check (mpesa_manual_number is null or mpesa_manual_number ~ '^[0-9]{5,10}$'),
  -- The paybill's account number; empty means the booking's reference.
  mpesa_manual_account text check (mpesa_manual_account is null or length(mpesa_manual_account) between 1 and 40),
  pay_at_venue boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (paystack_mode <> 'subaccount' or paystack_subaccount is not null),
  check (not mpesa_express or (mpesa_type is not null and mpesa_shortcode is not null and (mpesa_type = 'paybill' or mpesa_till is not null))),
  check ((mpesa_manual_type is null) = (mpesa_manual_number is null))
);

create table offerings (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  kind text not null default 'room_type' check (kind in ('room_type')),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  -- How many identical rooms of this type (I11).
  units integer not null check (units between 1 and 500),
  -- Guests one room sleeps.
  max_guests integer not null check (max_guests between 1 and 50),
  booking_mode text not null default 'instant' check (booking_mode in ('instant', 'request', 'enquiry')),
  pricing jsonb not null check (jsonb_typeof(pricing) = 'object'),
  status text not null default 'active' check (status in ('active', 'hidden')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (business_id, id)
);
create unique index offerings_name_idx on offerings (business_id, lower(btrim(name)));

create table offering_blocks (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  offering_id uuid not null,
  -- The first night closed, and the first night open again.
  starts_on date not null,
  ends_on date not null,
  units integer not null check (units between 1 and 500),
  reason text not null default '' check (length(reason) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid,
  check (ends_on > starts_on and ends_on - starts_on <= 366),
  foreign key (business_id, offering_id) references offerings (business_id, id) on delete cascade
);
create index offering_blocks_nights_idx on offering_blocks (business_id, offering_id, starts_on);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  -- What the customer and the team call it.
  reference text not null check (reference ~ '^[A-Z0-9]{6,12}$'),
  offering_id uuid not null,
  check_in date not null,
  check_out date not null,
  units integer not null default 1 check (units between 1 and 50),
  guests integer not null check (guests between 1 and 500),
  -- held              waiting for the deposit, rooms held until hold_expires_at
  -- requested         waiting for the team (rooms held until hold_expires_at, if set)
  -- awaiting_payment  accepted by the team, waiting for the deposit (held)
  -- confirmed         the deposit is paid, or the team confirmed it
  -- conflict          paid after its hold ended, when the rooms had gone: the team moves or refunds
  -- declined, cancelled, expired
  status text not null check (status in ('held', 'requested', 'awaiting_payment', 'confirmed', 'conflict', 'declined', 'cancelled', 'expired')),
  hold_expires_at timestamptz,
  customer_name text not null check (length(customer_name) between 1 and 120),
  customer_email text check (customer_email is null or length(customer_email) <= 200),
  customer_phone text check (customer_phone is null or length(customer_phone) <= 40),
  customer_notes text check (customer_notes is null or length(customer_notes) <= 1000),
  -- The price as quoted (the pricing module's output), and its totals.
  quote jsonb not null,
  currency text not null check (currency in ('KES', 'USD')),
  total_minor bigint not null check (total_minor >= 0),
  deposit_minor bigint not null check (deposit_minor >= 0 and deposit_minor <= total_minor),
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  -- The payment page's address: whoever has the link can see and pay this booking.
  pay_token text not null unique check (length(pay_token) >= 24),
  source text not null check (source in ('chat', 'staff')),
  session_id uuid,
  idempotency_key text,
  conflict text,
  staff_note text check (staff_note is null or length(staff_note) <= 1000),
  decided_by uuid,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out > check_in and check_out - check_in <= 90),
  unique (business_id, id),
  unique (business_id, reference),
  unique (business_id, idempotency_key),
  foreign key (business_id, offering_id) references offerings (business_id, id),
  foreign key (business_id, session_id) references chat_sessions (business_id, id) on delete set null (session_id)
);
-- The bookings that can take rooms, by night.
create index bookings_nights_idx on bookings (business_id, offering_id, check_in, check_out)
  where status in ('held', 'requested', 'awaiting_payment', 'confirmed');
create index bookings_hold_idx on bookings (hold_expires_at) where status in ('held', 'awaiting_payment');
create index bookings_session_idx on bookings (business_id, session_id) where session_id is not null;
create index bookings_created_idx on bookings (business_id, created_at desc);

create table payments (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  booking_id uuid not null,
  method text not null check (method in ('paystack', 'mpesa_express', 'mpesa_code', 'cash', 'bank', 'other')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('KES', 'USD')),
  -- pending: started, or a code waiting for the team; rejected: a code the team didn't find.
  status text not null check (status in ('pending', 'succeeded', 'failed', 'rejected')),
  -- Paystack: the platform's reference; M-Pesa Express: the checkout request id; a code: the code.
  provider_reference text,
  -- The M-Pesa receipt number, or Paystack's transaction id.
  receipt text,
  payer_phone text,
  payer_email text,
  failure text,
  -- The secret part of M-Pesa's callback address for this payment.
  callback_token text unique,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, booking_id) references bookings (business_id, id) on delete cascade
);
create unique index payments_reference_idx on payments (business_id, method, provider_reference) where provider_reference is not null;
create unique index payments_paystack_reference_idx on payments (provider_reference) where method = 'paystack';
create index payments_booking_idx on payments (business_id, booking_id);
create index payments_pending_idx on payments (created_at) where status = 'pending';

-- The payment page, Paystack's platform webhook and M-Pesa's callbacks
-- arrive with no business in scope: they find it by their token, one exact
-- token at a time.
create function payment_route(kind text, token text) returns text
  language sql stable security definer
  set search_path = public, pg_temp
  as $$
    select case kind
      when 'pay' then (select business_id from bookings where pay_token = token limit 1)
      when 'mpesa' then (select business_id from payments where callback_token = token limit 1)
      when 'paystack' then (select business_id from payments where method = 'paystack' and provider_reference = token limit 1)
    end
  $$;
revoke all on function payment_route(text, text) from public;
grant execute on function payment_route(text, text) to zaina_app;

-- ── Privileges and row-level security ─────────────────────────────────
grant select, insert, update, delete on booking_settings, offerings, offering_blocks, bookings, payments to zaina_app;

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array['booking_settings', 'offerings', 'offering_blocks', 'bookings', 'payments'] loop
    execute format('alter table %I enable row level security', tenant_table);
    execute format(
      'create policy business_rows on %I to zaina_app using (business_id = app_business()) with check (business_id = app_business())',
      tenant_table
    );
  end loop;
end $$;
