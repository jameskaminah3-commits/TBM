-- 0010_calendars.sql
--
-- Phase 5, the calendar connector. A business's bookings reach the calendars
-- its team already uses, and busy times elsewhere stop double bookings:
--
--   calendar_feeds        private iCal (.ics) links to the business's bookings
--                         (all of them, or one person's or table's), for any
--                         calendar app. Only a hash of each link's token is
--                         kept; a link is shown once, and replaced to revoke it.
--   calendar_connections  a Google Calendar account connected by the business
--                         (its refresh token is a business secret, never a
--                         column), where confirmed bookings are written as
--                         events, and how its last sync went.
--   calendar_sources      calendars whose busy times block bookings: a Google
--                         calendar, or an iCal link (a channel manager,
--                         Airbnb or Booking.com; the link is a business
--                         secret). Each blocks a room type (nights), a person
--                         or table, or the whole business.
--   calendar_events       which event in the business's calendar is which
--                         booking, so changes and cancellations follow.
--
-- Busy times arrive as closures with source 'calendar': offering_blocks (for
-- rooms) and resource_blocks (for time slots) remember the source that made
-- them, and each sync replaces them.

create table calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Null: every booking; otherwise one person's or table's.
  resource_id uuid,
  label text not null default '' check (length(label) <= 80),
  created_at timestamptz not null default now(),
  created_by uuid,
  last_read_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, resource_id) references resources (business_id, id) on delete cascade
);

create table calendar_connections (
  business_id text primary key references businesses (id) on delete cascade,
  provider text not null default 'google' check (provider in ('google')),
  account text check (account is null or length(account) <= 200),
  -- Where confirmed bookings are written; null: they aren't.
  write_calendar_id text check (write_calendar_id is null or length(write_calendar_id) <= 300),
  status text not null default 'connected' check (status in ('connected', 'error')),
  last_error text check (last_error is null or length(last_error) <= 500),
  last_sync_at timestamptz,
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table calendar_sources (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  kind text not null check (kind in ('google', 'ics')),
  -- A Google calendar's id; for an iCal link, the link itself is the secret "ics_<id without dashes>".
  calendar_id text check (calendar_id is null or length(calendar_id) <= 300),
  label text not null check (length(btrim(label)) between 1 and 120),
  -- What its busy times block: a room type, a person or table, or (neither) the whole business.
  offering_id uuid,
  resource_id uuid,
  status text not null default 'ok' check (status in ('ok', 'error')),
  last_error text check (last_error is null or length(last_error) <= 500),
  last_sync_at timestamptz,
  busy_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (business_id, id),
  check ((kind = 'google') = (calendar_id is not null)),
  check (offering_id is null or resource_id is null),
  foreign key (business_id, offering_id) references offerings (business_id, id) on delete cascade,
  foreign key (business_id, resource_id) references resources (business_id, id) on delete cascade
);

create table calendar_events (
  business_id text not null references businesses (id) on delete cascade,
  booking_id uuid not null,
  calendar_id text not null,
  event_id text not null,
  -- The booking as last written: its updated_at, so a change is written again.
  synced_version timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (business_id, booking_id),
  foreign key (business_id, booking_id) references bookings (business_id, id) on delete cascade
);

alter table offering_blocks
  add column source text not null default 'staff' check (source in ('staff', 'calendar')),
  add column calendar_source_id uuid,
  add column external_id text,
  add constraint offering_blocks_calendar_source_fk foreign key (business_id, calendar_source_id) references calendar_sources (business_id, id) on delete cascade;

alter table resource_blocks
  add column calendar_source_id uuid,
  add constraint resource_blocks_calendar_source_fk foreign key (business_id, calendar_source_id) references calendar_sources (business_id, id) on delete cascade;

-- A feed link arrives with no business in scope: it finds its feed by the
-- hash of its token, one exact hash at a time.
create function calendar_feed_route(hash text) returns table (business_id text, feed_id uuid)
  language sql stable security definer
  set search_path = public, pg_temp
  as $$
    select business_id, id from calendar_feeds where token_hash = hash limit 1
  $$;
revoke all on function calendar_feed_route(text) from public;
grant execute on function calendar_feed_route(text) to zaina_app;

grant select, insert, update, delete on calendar_feeds, calendar_connections, calendar_sources, calendar_events to zaina_app;

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array['calendar_feeds', 'calendar_connections', 'calendar_sources', 'calendar_events'] loop
    execute format('alter table %I enable row level security', tenant_table);
    execute format(
      'create policy business_rows on %I to zaina_app using (business_id = app_business()) with check (business_id = app_business())',
      tenant_table
    );
  end loop;
end $$;
