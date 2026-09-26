-- 0015_lead_follow_up.sql
--
-- Leads the team follows up, on the console's Leads page:
--
--   leads.status       new (just in), contacted, won (became a customer)
--                      or lost
--   leads.team_note    the team's own note (the lead's notes are what Zaina
--                      wrote down in the chat)
--   leads.handled_by   who last changed it, and when (updated_at)

alter table leads
  add column status text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  add column team_note text check (team_note is null or length(team_note) <= 1000),
  add column handled_by uuid,
  add column updated_at timestamptz;
create index leads_status_idx on leads (business_id, status, created_at desc);
