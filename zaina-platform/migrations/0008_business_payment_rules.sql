-- 0008_business_payment_rules.sql
--
-- Deposits, the ways customers pay and the limits around them are each
-- business's own decisions, not Zaina's. Until now some were fixed in code
-- (how long an accepted request is held, how long the team has to check an
-- M-Pesa code, how far ahead and how long a stay can be booked, how many
-- payment tries a booking gets). They become the business's settings, each
-- within bounds the platform keeps for safety.
--
--   deposit_type          not_set  the business hasn't chosen yet: nothing is
--                                  charged online, and bookings from the chat
--                                  come in as requests for the team
--                         none     nothing to pay before arriving
--                         percent  deposit_percent of the total
--                         fixed    deposit_fixed_minor per booking (at most the total)
--                         full     the whole amount up front
--   payment_order         the order the payment page offers the ways to pay
--   method_max_minor      the most one payment can be, per way to pay (the
--                         business's own limits; M-Pesa's own limit still applies)
--   accepted_hold_hours   how long an accepted request keeps its rooms while the customer pays
--   payment_hold_minutes  starting to pay keeps the rooms at least this long
--   code_check_hours      how long the team has to check an M-Pesa code
--   booking_horizon_days  how far ahead customers can book
--   max_nights            the longest stay, unless a room type says otherwise
--   min_notice_hours      how soon before arrival customers can still book online
--   pay_attempts_limit    payment tries per booking in 10 minutes
--   mpesa_prompts_limit   M-Pesa prompts per booking in 10 minutes
--   rules_confirmed_at    when the business last saved its deposit and payment rules

alter table booking_settings
  add column deposit_type text not null default 'not_set' check (deposit_type in ('not_set', 'none', 'percent', 'fixed', 'full')),
  add column deposit_fixed_minor bigint check (deposit_fixed_minor is null or deposit_fixed_minor > 0),
  add column payment_order text[] not null default '{}'
    check (payment_order <@ array['mpesa_express', 'paystack', 'mpesa_manual', 'pay_at_venue']::text[] and cardinality(payment_order) <= 4),
  add column method_max_minor jsonb not null default '{}' check (jsonb_typeof(method_max_minor) = 'object'),
  add column accepted_hold_hours integer not null default 24 check (accepted_hold_hours between 1 and 168),
  add column payment_hold_minutes integer not null default 15 check (payment_hold_minutes between 5 and 120),
  add column code_check_hours integer not null default 12 check (code_check_hours between 1 and 72),
  add column booking_horizon_days integer not null default 548 check (booking_horizon_days between 1 and 730),
  add column max_nights integer not null default 30 check (max_nights between 1 and 90),
  add column min_notice_hours integer not null default 0 check (min_notice_hours between 0 and 720),
  add column pay_attempts_limit integer not null default 12 check (pay_attempts_limit between 3 and 30),
  add column mpesa_prompts_limit integer not null default 3 check (mpesa_prompts_limit between 1 and 10),
  add column rules_confirmed_at timestamptz;

-- A business that already saved settings chose its deposit as a percentage.
update booking_settings
  set deposit_type = case deposit_percent when 0 then 'none' when 100 then 'full' else 'percent' end,
      rules_confirmed_at = updated_at;

alter table booking_settings
  add constraint booking_settings_fixed_deposit check (deposit_type <> 'fixed' or deposit_fixed_minor is not null);
