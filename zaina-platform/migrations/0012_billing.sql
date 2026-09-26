-- 0012_billing.sql
--
-- Phase 5, subscriptions and billing: what businesses pay the platform.
-- Prices are the platform team's decision, kept as data (no plan is built
-- in): billing is off until the team adds a plan.
--
--   plans             what a business can subscribe to: a price per month or
--                     year, in shillings or dollars, a free trial, and how
--                     many conversations a month it's meant for (shown, not
--                     cut off).
--   subscriptions     a business's plan and where it stands:
--                       incomplete  chosen, its first payment not made yet
--                       trialing    in its free trial
--                       active      paid up to current_period_end
--                       past_due    an invoice is waiting to be paid
--                       cancelled   ended (it asked to stop)
--                     A trial is a first period that costs nothing:
--                     trial_ends_at stays set afterwards, so a business has
--                     one trial.
--   invoices          what's owed for a period: open, paid (by card or M-Pesa
--                     through the platform's Paystack account, by hand, or
--                     waived by the platform team) or void (not owed). At
--                     most one is open per business.
--   invoice_payments  each try at paying an invoice through Paystack, by its
--                     reference ("zi_…"): a payment finished in a tab the
--                     owner had left behind still finds its invoice.
--   businesses.pause_reason
--                     why a business is paused: by the platform team, or for
--                     an invoice left unpaid past the grace period (it
--                     resumes itself when paid).

create table plans (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,39}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 500),
  price_minor bigint not null check (price_minor >= 0 and price_minor <= 100000000000),
  currency text not null check (currency in ('KES', 'USD')),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  trial_days integer not null default 0 check (trial_days between 0 and 90),
  conversations_per_month integer check (conversations_per_month is null or conversations_per_month > 0),
  status text not null default 'active' check (status in ('active', 'hidden')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table businesses add column pause_reason text check (pause_reason is null or pause_reason in ('platform', 'billing'));
update businesses set pause_reason = 'platform' where status = 'paused';

create table subscriptions (
  business_id text primary key references businesses (id) on delete cascade,
  plan_id text not null references plans (id),
  status text not null check (status in ('incomplete', 'trialing', 'active', 'past_due', 'cancelled')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'trialing' or trial_ends_at is not null),
  check (status not in ('trialing', 'active', 'past_due') or (current_period_start is not null and current_period_end > current_period_start))
);

create sequence invoice_numbers;

create table invoices (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  number text not null unique,
  plan_id text not null references plans (id),
  plan_name text not null,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('KES', 'USD')),
  status text not null check (status in ('open', 'paid', 'void')),
  due_at timestamptz not null,
  paid_at timestamptz,
  -- How it was paid: through Paystack, by hand (bank or M-Pesa, recorded by the platform team), or waived.
  method text check (method is null or method in ('paystack', 'manual', 'waived')),
  -- Paystack's transaction id, or the receipt of a payment made by hand.
  receipt text check (receipt is null or length(receipt) <= 120),
  recorded_by uuid references staff_users (id),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end > period_start),
  check ((status = 'paid') = (paid_at is not null and method is not null)),
  check ((status = 'void') = (voided_at is not null))
);
create index invoices_business_idx on invoices (business_id, created_at desc);
create unique index invoices_one_open on invoices (business_id) where status = 'open';

create table invoice_payments (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  invoice_id uuid not null references invoices (id) on delete cascade,
  reference text not null unique check (reference ~ '^zi_[0-9a-f]{24}$'),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('KES', 'USD')),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  payer_email text,
  authorization_url text,
  receipt text,
  -- Why it failed, or what's wrong with it (paid twice: refund it in Paystack).
  note text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index invoice_payments_invoice_idx on invoice_payments (invoice_id, created_at desc);
create index invoice_payments_pending_idx on invoice_payments (created_at) where status = 'pending';

-- Plans are the platform's price list: any business may read them. A
-- business reads its own subscription, invoices and payments; only the
-- platform (the owner connection) changes them.
grant select on plans to zaina_app;
grant select on subscriptions, invoices, invoice_payments to zaina_app;

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array['subscriptions', 'invoices', 'invoice_payments'] loop
    execute format('alter table %I enable row level security', tenant_table);
    execute format('create policy business_rows on %I to zaina_app using (business_id = app_business())', tenant_table);
  end loop;
end $$;
