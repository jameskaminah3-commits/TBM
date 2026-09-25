-- 0005_channels_and_console.sql
--
-- Phase 3: channels and the business console.
--
--   * A conversation has a channel: the website widget or WhatsApp. A
--     WhatsApp conversation knows the customer's number, when they last
--     wrote (WhatsApp's 24-hour window) and how far Zaina's and the team's
--     replies have been delivered.
--   * whatsapp_numbers: the WhatsApp number a business connected. Kept inside
--     the business; the webhook finds a number's business through one narrow
--     function and nothing else.
--   * whatsapp_inbound: messages received, a queue and a guard against
--     WhatsApp sending the same message twice. whatsapp_outbound: messages
--     sent, with what WhatsApp says happened to them.
--   * Handoff routing: a waiting chat is offered to one available person
--     first, then to everyone. staff_presence says who is available.
--   * staff_push_subscriptions: the phones and browsers that get alerts.
--   * business_settings: how the website widget looks and greets.

-- ── Conversations: channel, delivery and routing ──────────────────────
alter table chat_sessions
  add column channel text not null default 'web' check (channel in ('web', 'whatsapp')),
  -- WhatsApp: the customer's number as WhatsApp gives it (digits, country code first).
  add column customer_address text,
  -- WhatsApp: the name on the customer's profile, for the team only.
  add column customer_name text,
  -- When the customer last wrote: replies are free for 24 hours after it.
  add column customer_last_message_at timestamptz,
  -- The last event delivered to the customer's channel, and a lease so two
  -- instances never send the same replies.
  add column delivered_event_id bigint not null default 0,
  add column delivery_lock_until timestamptz,
  -- When the approved follow-up template was last sent (the window had closed).
  add column followup_sent_at timestamptz,
  -- The first time the chat needed the team (a handoff or a callback); never cleared.
  add column first_handoff_at timestamptz,
  -- Who claimed the chat (assigned_agent_id stays the label shown to the team).
  add column claimed_by uuid,
  -- Who the waiting chat was offered to first, and when everyone was alerted.
  add column routed_to uuid,
  add column routed_at timestamptz,
  add column team_alerted_at timestamptz;

update chat_sessions set first_handoff_at = coalesce(handoff_at, callback_requested_at)
  where handoff_at is not null or callback_requested_at is not null;

create index chat_sessions_whatsapp_idx on chat_sessions (business_id, customer_address, last_activity_at desc)
  where channel = 'whatsapp';

-- What the customer sent that isn't text (photos, voice notes, documents), by
-- WhatsApp's media id; and which person wrote a team reply.
alter table chat_events
  add column media jsonb,
  add column author uuid;

-- ── WhatsApp ──────────────────────────────────────────────────────────
create table whatsapp_numbers (
  -- One number per business for now.
  business_id text primary key references businesses (id) on delete cascade,
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{5,30}$'),
  waba_id text check (waba_id is null or waba_id ~ '^[0-9]{5,30}$'),
  display_phone_number text,
  verified_name text,
  -- A template approved in WhatsApp Manager, sent when the team replies after
  -- the customer's 24-hour window has closed.
  followup_template text check (followup_template is null or (followup_template ~ '^[a-z0-9_]+$' and length(followup_template) <= 512)),
  followup_template_language text not null default 'en' check (followup_template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  followup_template_parameter text not null default 'none'
    check (followup_template_parameter in ('none', 'business_name', 'customer_name')),
  status text not null default 'active' check (status in ('active', 'paused')),
  connected_at timestamptz not null default now(),
  connected_by uuid,
  updated_at timestamptz not null default now()
);

-- The webhook's only way to a business: which business a number belongs to.
create function whatsapp_number_business(number_id text) returns text
  language sql stable security definer
  set search_path = public, pg_temp
  as $$ select business_id from whatsapp_numbers where phone_number_id = number_id and status = 'active' $$;
revoke all on function whatsapp_number_business(text) from public;

create table whatsapp_inbound (
  id bigserial primary key,
  business_id text not null references businesses (id) on delete cascade,
  session_id uuid not null,
  -- WhatsApp's message id: the same message is never taken twice.
  message_id text not null,
  kind text not null,
  -- What the customer wrote (card numbers removed); cleared once it is in the conversation.
  body text,
  media jsonb,
  received_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'ignored', 'failed')),
  attempts integer not null default 0,
  processed_at timestamptz,
  unique (business_id, message_id),
  foreign key (business_id, session_id) references chat_sessions (business_id, id) on delete cascade
);
create index whatsapp_inbound_open_idx on whatsapp_inbound (business_id, session_id, id)
  where status in ('pending', 'processing');

create table whatsapp_outbound (
  id bigserial primary key,
  business_id text not null references businesses (id) on delete cascade,
  session_id uuid not null,
  -- The conversation event this message delivered (none for a template).
  event_id bigint,
  message_id text,
  kind text not null check (kind in ('text', 'template')),
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read', 'failed')),
  error_code integer,
  error_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, session_id) references chat_sessions (business_id, id) on delete cascade
);
create unique index whatsapp_outbound_message_idx on whatsapp_outbound (business_id, message_id) where message_id is not null;
create index whatsapp_outbound_session_idx on whatsapp_outbound (business_id, session_id, id);

-- ── Staff: availability, alerts ───────────────────────────────────────
create table staff_presence (
  business_id text not null references businesses (id) on delete cascade,
  user_id uuid not null references staff_users (id) on delete cascade,
  available boolean not null default false,
  last_seen_at timestamptz not null default now(),
  last_routed_at timestamptz,
  primary key (business_id, user_id)
);

alter table staff_memberships add column alert_email boolean not null default true;

-- A person's phones and browsers, for alerts from any business they work for.
-- Written by the platform on the person's behalf; read inside a business only
-- for that business's own people.
create table staff_push_subscriptions (
  id bigserial primary key,
  user_id uuid not null references staff_users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 2000),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index staff_push_subscriptions_user_idx on staff_push_subscriptions (user_id);

-- ── The website widget ────────────────────────────────────────────────
alter table business_settings
  add column widget_color text not null default '#0f766e' check (widget_color ~ '^#[0-9a-fA-F]{6}$'),
  add column widget_position text not null default 'right' check (widget_position in ('right', 'left')),
  add column widget_greeting text check (widget_greeting is null or length(widget_greeting) <= 300);

-- ── Privileges and row-level security ─────────────────────────────────
grant select, insert, update, delete on whatsapp_numbers, whatsapp_inbound, whatsapp_outbound, staff_presence to zaina_app;
grant select on staff_push_subscriptions to zaina_app;
grant usage, select on all sequences in schema public to zaina_app;
grant execute on function whatsapp_number_business(text) to zaina_app;

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array['whatsapp_numbers', 'whatsapp_inbound', 'whatsapp_outbound', 'staff_presence'] loop
    execute format('alter table %I enable row level security', tenant_table);
    execute format(
      'create policy business_rows on %I to zaina_app using (business_id = app_business()) with check (business_id = app_business())',
      tenant_table
    );
  end loop;
end $$;

alter table staff_push_subscriptions enable row level security;
create policy fellow_members on staff_push_subscriptions for select to zaina_app
  using (exists (
    select 1 from staff_memberships as m
    where m.user_id = staff_push_subscriptions.user_id and m.business_id = app_business()
  ));
