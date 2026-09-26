-- 0014_price_list.sql
--
-- A business's price list: what it charges for things that aren't booked
-- through Zaina. A shop's or clinic's services and products; a place to
-- stay's extras (airport transfers, laundry, a dinner); a salon's products.
-- Zaina quotes prices only from here and from rooms and services: never
-- from documents (amounts in documents are hidden from it).
--
--   price_items   a name, an optional section ("Transfers"), a short
--                 description, the price (a fixed amount, or from one
--                 amount to another), what it's per ("per person", "per
--                 car"), its currency, and whether it's shown.

create table price_items (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  section text check (section is null or length(btrim(section)) between 1 and 80),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 500),
  price_minor bigint not null check (price_minor between 0 and 100000000000),
  -- A range ("KSh 1,000 to 1,500"): the most it costs.
  price_max_minor bigint check (price_max_minor is null or price_max_minor > price_minor),
  currency text not null default 'KES' check (currency in ('KES', 'USD')),
  unit text check (unit is null or length(btrim(unit)) between 1 and 40),
  status text not null default 'active' check (status in ('active', 'hidden')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (business_id, id)
);
create unique index price_items_name_idx on price_items (business_id, lower(btrim(coalesce(section, ''))), lower(btrim(name)));
create index price_items_list_idx on price_items (business_id, status, sort_order);

grant select, insert, update, delete on price_items to zaina_app;
alter table price_items enable row level security;
create policy business_rows on price_items to zaina_app using (business_id = app_business()) with check (business_id = app_business());
