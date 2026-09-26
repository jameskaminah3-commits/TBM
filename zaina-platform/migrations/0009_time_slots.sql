-- 0009_time_slots.sql
--
-- Phase 5, a second kind of business: salons and restaurants book time,
-- not nights. The same bookings, payments, payment page and deposits serve
-- them; what changes is what is booked and how "free" is worked out.
--
--   business_type     adds salon and restaurant.
--   booking_settings  opening_hours: the business's week, each day a list of
--                     [opens, closes] local times ("09:00", "18:00");
--                     slot_interval_minutes: how often a booking can start.
--   resources         who or what a booking takes: a stylist, a chair, a
--                     table (with its seats). A resource can keep its own
--                     working hours inside the business's.
--   offerings         a service (a haircut: its length and price) or a
--                     table booking (a dinner seating: its length and the
--                     party sizes it takes). duration_minutes is the booking's
--                     length; buffer_minutes the time after it before the
--                     resource is free again (clean-up, turning a table).
--   offering_resources  which resources can do a service (none listed: any
--                     that fits).
--   resource_blocks   time a resource (or, with no resource, the whole
--                     business) is closed: time off, a private event, or a
--                     busy time from a connected calendar.
--   bookings          a time-slot booking has starts_at, ends_at, busy_until
--                     (ends_at plus the buffer) and its resource. Its
--                     check_in is its local day and check_out the day after,
--                     so lists by date work for stays and slots alike.

alter table businesses drop constraint businesses_business_type_check;
alter table businesses add constraint businesses_business_type_check
  check (business_type in ('general', 'travel_concierge', 'guesthouse', 'salon', 'restaurant'));

alter table booking_settings
  add column opening_hours jsonb not null default '{}' check (jsonb_typeof(opening_hours) = 'object'),
  add column slot_interval_minutes integer not null default 30 check (slot_interval_minutes in (5, 10, 15, 20, 30, 45, 60, 90, 120));

create table resources (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('staff', 'chair', 'table', 'room', 'other')),
  -- A table's seats; 1 for a person or a chair.
  seats integer not null default 1 check (seats between 1 and 100),
  -- The smallest party a table is given to (a table for six isn't used for two).
  min_party integer not null default 1 check (min_party between 1 and 100),
  -- Its own week, inside the business's; null: the business's hours.
  hours jsonb check (hours is null or jsonb_typeof(hours) = 'object'),
  status text not null default 'active' check (status in ('active', 'hidden')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (min_party <= seats)
);
create unique index resources_name_idx on resources (business_id, lower(btrim(name)));

alter table offerings drop constraint offerings_kind_check;
alter table offerings add constraint offerings_kind_check check (kind in ('room_type', 'service', 'table'));
alter table offerings
  add column duration_minutes integer check (duration_minutes is null or duration_minutes between 5 and 720),
  add column buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 240),
  add column min_party integer not null default 1 check (min_party between 1 and 100),
  add constraint offerings_slot_duration check (kind = 'room_type' or duration_minutes is not null);

create table offering_resources (
  business_id text not null references businesses (id) on delete cascade,
  offering_id uuid not null,
  resource_id uuid not null,
  primary key (business_id, offering_id, resource_id),
  foreign key (business_id, offering_id) references offerings (business_id, id) on delete cascade,
  foreign key (business_id, resource_id) references resources (business_id, id) on delete cascade
);

create table resource_blocks (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  -- Null: the whole business is closed.
  resource_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '' check (length(reason) <= 200),
  -- staff: added in the console; calendar: a busy time from a connected calendar.
  source text not null default 'staff' check (source in ('staff', 'calendar')),
  external_id text,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (ends_at > starts_at and ends_at - starts_at <= interval '366 days'),
  foreign key (business_id, resource_id) references resources (business_id, id) on delete cascade
);
create index resource_blocks_time_idx on resource_blocks (business_id, starts_at, ends_at);
create unique index resource_blocks_external_idx on resource_blocks (business_id, source, external_id) where external_id is not null;

alter table bookings
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column busy_until timestamptz,
  add column resource_id uuid,
  add constraint bookings_resource_fk foreign key (business_id, resource_id) references resources (business_id, id),
  add constraint bookings_slot_times check (
    (starts_at is null and ends_at is null and busy_until is null)
    or (starts_at is not null and ends_at > starts_at and busy_until >= ends_at and ends_at - starts_at <= interval '12 hours')
  );
-- The time-slot bookings that can take a resource.
create index bookings_slots_idx on bookings (business_id, starts_at, busy_until)
  where starts_at is not null and status in ('held', 'requested', 'awaiting_payment', 'confirmed');

grant select, insert, update, delete on resources, offering_resources, resource_blocks to zaina_app;

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array['resources', 'offering_resources', 'resource_blocks'] loop
    execute format('alter table %I enable row level security', tenant_table);
    execute format(
      'create policy business_rows on %I to zaina_app using (business_id = app_business()) with check (business_id = app_business())',
      tenant_table
    );
  end loop;
end $$;
