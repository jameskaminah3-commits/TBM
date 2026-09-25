-- 0003_business_separation.sql
--
-- Phase 1: every business's data is separated by Postgres itself, not by
-- the application remembering to filter.
--
--   * The service runs its business queries as the role zaina_app, which is
--     subject to row-level security. A query only ever sees rows of the
--     business named in app.business_id, set per transaction; with none set
--     it sees nothing.
--   * The business directory (businesses) is read-only to the service, so a
--     widget's public key can be looked up; only the platform changes it.
--   * A row can only point at a conversation of its own business.
--   * Staff accounts are platform-wide identities; which business they work
--     for, and as what, is a membership row inside the business. The service
--     sees only the accounts of the business in scope, never password hashes.
--   * Business settings and encrypted secrets live inside the business too.
--   * TBM's settings are its current hard-coded values, so nothing changes.
--
-- Needs Postgres 15 or newer (on delete set null of one column).

-- ── The restricted role ───────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'zaina_app') then
    create role zaina_app nologin;
  end if;
end $$;

-- The service connects as the owner and switches to zaina_app.
do $$
begin
  execute format('grant zaina_app to %I', current_user);
exception when others then
  raise notice 'zaina_app not granted to %: %', current_user, sqlerrm;
end $$;

create function app_business() returns text
  language sql stable
  as $$ select nullif(current_setting('app.business_id', true), '') $$;

-- ── New tables ────────────────────────────────────────────────────────
create table staff_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text not null,
  password_hash text not null,
  is_platform_admin boolean not null default false,
  -- Raised to sign a person out everywhere.
  token_version integer not null default 1,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff_memberships (
  business_id text not null references businesses (id) on delete cascade,
  user_id uuid not null references staff_users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'agent', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index staff_memberships_user_idx on staff_memberships (user_id);

-- How the business presents itself, and what Zaina may pass on.
create table business_settings (
  business_id text primary key references businesses (id) on delete cascade,
  display_name text not null,
  assistant_name text not null default 'Zaina',
  about text not null default '',
  contact_phone text,
  contact_phone_display text,
  website_url text,
  support_email text,
  -- Links Zaina may share: these hosts, hosts ending in these suffixes,
  -- and links the customer sent.
  allowed_link_hosts text[] not null default '{}',
  allowed_link_host_suffixes text[] not null default '{}',
  default_currency text not null default 'USD' check (default_currency in ('USD', 'KES')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Payment keys, messaging tokens and the like, encrypted with AES-256-GCM.
-- The key never touches the database; the row's business and name are
-- bound into the encryption, so a secret can't be moved to another row.
create table business_secrets (
  business_id text not null references businesses (id) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9_]{1,62}$'),
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  key_id text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (business_id, name)
);

-- ── A row can only point at its own business's conversation ──────────
-- Conversation references include the business, so even a buggy write can't
-- attach an event, a metric or a payment to another business's chat.
alter table chat_sessions add constraint chat_sessions_business_session_key unique (business_id, id);
alter table chat_events
  drop constraint chat_events_session_id_fkey,
  add constraint chat_events_session_fkey foreign key (business_id, session_id)
    references chat_sessions (business_id, id) on delete cascade;
alter table turn_metrics
  drop constraint turn_metrics_session_id_fkey,
  add constraint turn_metrics_session_fkey foreign key (business_id, session_id)
    references chat_sessions (business_id, id) on delete set null (session_id);
alter table payment_claims
  drop constraint payment_claims_session_id_fkey,
  add constraint payment_claims_session_fkey foreign key (business_id, session_id)
    references chat_sessions (business_id, id) on delete set null (session_id);

-- People who asked to be contacted, for businesses whose own system doesn't keep leads.
create table leads (
  id bigserial primary key,
  business_id text not null references businesses (id),
  session_id uuid,
  name text not null,
  email text,
  phone text,
  interest text,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (business_id, session_id) references chat_sessions (business_id, id) on delete set null (session_id)
);
create index leads_business_idx on leads (business_id, created_at desc);

-- ── Privileges ────────────────────────────────────────────────────────
grant usage on schema public to zaina_app;
-- The directory: read-only. Businesses are created and changed by the platform.
grant select on businesses to zaina_app;
grant select, insert, update, delete on
  chat_sessions, chat_events, turn_metrics, usage_daily, payment_claims,
  rate_limit_counters, staff_memberships, business_settings, business_secrets, leads
  to zaina_app;
grant usage, select on all sequences in schema public to zaina_app;
-- Staff identities: readable without password hashes; written only by the platform.
grant select (id, email, name, is_platform_admin, token_version, disabled_at, created_at) on staff_users to zaina_app;

-- ── Row-level security ────────────────────────────────────────────────
-- Only the people who work for the business in scope.
alter table staff_users enable row level security;
create policy fellow_members on staff_users for select to zaina_app
  using (exists (
    select 1 from staff_memberships as m
    where m.user_id = staff_users.id and m.business_id = app_business()
  ));

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'chat_sessions', 'chat_events', 'turn_metrics', 'usage_daily', 'payment_claims',
    'staff_memberships', 'business_settings', 'business_secrets', 'leads'
  ] loop
    execute format('alter table %I enable row level security', tenant_table);
    execute format(
      'create policy business_rows on %I to zaina_app using (business_id = app_business()) with check (business_id = app_business())',
      tenant_table
    );
  end loop;
end $$;

-- ── TBM's settings: today's values ────────────────────────────────────
insert into business_settings (
  business_id, display_name, contact_phone, contact_phone_display, website_url,
  allowed_link_hosts, allowed_link_host_suffixes, default_currency
) values (
  'tbm', 'Tembea Bila Matata', '+254718475264', '+254 718 475 264', 'https://tembeabilamatata.com',
  array['tembeabilamatata.com', 'wa.me', 'whatsapp.com', 'api.whatsapp.com'], array['.go.ke'], 'USD'
);
