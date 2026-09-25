-- 0001_platform_core.sql
--
-- The platform's own tables: businesses, conversations, per-turn telemetry,
-- daily usage for spend caps, shared rate limits and chat M-Pesa claims.
-- A business's bookings and listings stay in its own system and are reached
-- through a connector (TBM's through the TBM connector), so none of them are
-- here. Every conversation row carries its business from day one.

create table businesses (
  id text primary key,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  -- Public key a website widget sends to open a session. Not a secret.
  public_key text not null unique,
  -- Websites allowed to call the chat API from a browser.
  allowed_origins text[] not null default '{}',
  time_zone text not null default 'Africa/Nairobi',
  -- When staff answer handoffs: {"days": [0-6, Sunday = 0], "open": "HH:MM", "close": "HH:MM"}.
  -- Null means staff are always on.
  staffed_hours jsonb,
  -- A handoff nobody claims within this many minutes goes back to Zaina,
  -- with a callback request for the team.
  unclaimed_timeout_minutes integer not null default 10 check (unclaimed_timeout_minutes > 0),
  -- Model tokens (input + output) a business may use per day. Null = no cap.
  daily_token_cap bigint check (daily_token_cap is null or daily_token_cap > 0),
  -- Conversations untouched for this many days are deleted. Null = kept.
  retention_days integer check (retention_days is null or retention_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id),
  managed_by text not null default 'AI' check (managed_by in ('AI', 'HUMAN', 'CLOSED')),
  assigned_agent_id text,
  handoff_reason text,
  handoff_at timestamptz,
  claimed_at timestamptz,
  callback_requested_at timestamptz,
  display_currency text not null default 'USD' check (display_currency in ('USD', 'KES')),
  -- A keyed hash of the visitor's IP address, for rate limits. Never the address.
  visitor_key text,
  -- Model failures in a row; a handoff happens only after several (C4b).
  consecutive_failures integer not null default 0,
  -- One turn at a time per session (I3): the running turn holds this lease.
  turn_lock_id uuid,
  turn_lock_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create index chat_sessions_business_state_idx on chat_sessions (business_id, managed_by, updated_at desc);
create index chat_sessions_unclaimed_idx on chat_sessions (handoff_at)
  where managed_by = 'HUMAN' and assigned_agent_id is null;
create index chat_sessions_activity_idx on chat_sessions (business_id, last_activity_at);

-- Everything said and done in a conversation, in order.
create table chat_events (
  id bigserial primary key,
  business_id text not null references businesses (id),
  session_id uuid not null references chat_sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  actor text not null check (actor in ('USER', 'ZAINA_REASONING', 'SYSTEM_TOOL', 'AGENT', 'SYSTEM')),
  content text,
  tool_name text,
  tool_arguments jsonb,
  tool_response jsonb
);

create index chat_events_session_idx on chat_events (session_id, id);
create index chat_events_session_tool_idx on chat_events (session_id, tool_name) where tool_name is not null;

-- One row per chat turn (I15). No message text: counts, timings and outcome.
create table turn_metrics (
  id bigserial primary key,
  business_id text not null references businesses (id),
  session_id uuid references chat_sessions (id) on delete set null,
  started_at timestamptz not null,
  duration_ms integer not null,
  model_ms integer not null default 0,
  tool_ms integer not null default 0,
  model_calls integer not null default 0,
  model_retries integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  tools text[] not null default '{}',
  outcome text not null,
  error text
);

create index turn_metrics_business_time_idx on turn_metrics (business_id, started_at);
create index turn_metrics_session_idx on turn_metrics (session_id);

-- Model tokens per business per day, in the business's own time zone (C6).
create table usage_daily (
  business_id text not null references businesses (id),
  day date not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  turns integer not null default 0,
  cap_alert_sent_at timestamptz,
  primary key (business_id, day)
);

-- Fixed-window counters shared by every server instance (C6).
create table rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

create index rate_limit_counters_window_idx on rate_limit_counters (window_start);

-- M-Pesa codes customers send in the chat (C5), recorded against a booking.
create table payment_claims (
  id bigserial primary key,
  business_id text not null references businesses (id),
  session_id uuid references chat_sessions (id) on delete set null,
  booking_ref text not null,
  method text not null default 'mpesa',
  code text not null,
  expected_amount text,
  status text not null default 'recorded' check (status in ('recorded', 'duplicate', 'failed')),
  note text,
  created_at timestamptz not null default now(),
  unique (business_id, code)
);

create index payment_claims_booking_idx on payment_claims (business_id, booking_ref);
