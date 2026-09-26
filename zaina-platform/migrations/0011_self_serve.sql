-- 0011_self_serve.sql
--
-- Phase 5, self-serve: a business signs up, sets itself up and goes live
-- without the platform team.
--
--   businesses.status   onboarding: signed up and setting up. Its team uses
--                       the console (and can try Zaina there), but its
--                       website chat and WhatsApp don't answer customers
--                       until it goes live (active).
--   went_live_at        when it first went live.
--   source              how it joined: the platform team added it, or it
--                       signed up itself.
--   staff_users.email_verified_at
--                       a person who signs up confirms their email before
--                       signing in. People the platform team adds are
--                       confirmed when they're created.
--   chat_sessions.preview
--                       a chat the business's team had with Zaina in the
--                       console, to try it: not a customer's, so reports
--                       leave it out.

alter table businesses drop constraint businesses_status_check;
alter table businesses add constraint businesses_status_check check (status in ('onboarding', 'active', 'paused'));
alter table businesses
  add column went_live_at timestamptz,
  add column source text not null default 'platform' check (source in ('platform', 'self_serve'));
update businesses set went_live_at = created_at where status = 'active';

alter table staff_users add column email_verified_at timestamptz default now();
update staff_users set email_verified_at = created_at;

alter table chat_sessions add column preview boolean not null default false;
