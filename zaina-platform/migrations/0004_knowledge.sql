-- 0004_knowledge.sql
--
-- Phase 2: each business's own knowledge, searched per question instead of
-- pasted into every prompt.
--
--   * knowledge_sources: what the business wrote or imported (a web page, an
--     FAQ, a policy, a guide), with a link customers can be pointed to.
--   * knowledge_chunks: the same text cut into passages for search. They are
--     rebuilt whenever their source changes.
--   * knowledge_misses: questions Zaina searched for and found nothing, so the
--     business can fill the gaps.
--   * businesses.business_type: which tools Zaina gets (travel concierge,
--     guesthouse, or a general business answering from its knowledge).
--   * chat_sessions.language: the language the customer writes in, for the
--     fixed texts the server adds (English or Swahili).
--
-- All three knowledge tables sit inside the business: row-level security as in
-- 0003, and chunks can only belong to a source of their own business.

alter table businesses add column business_type text not null default 'general'
  check (business_type in ('general', 'travel_concierge', 'guesthouse'));
update businesses set business_type = 'travel_concierge' where id = 'tbm';

alter table chat_sessions add column language text not null default 'en'
  check (language in ('en', 'sw'));

create table knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  kind text not null default 'page' check (kind in ('page', 'faq', 'policy', 'guide', 'menu', 'document')),
  -- Where a customer can read it; given with answers from it.
  url text check (url is null or url ~ '^https://'),
  language text not null default 'en' check (language in ('en', 'sw')),
  content text not null check (length(content) between 1 and 200000),
  content_hash text not null,
  status text not null default 'published' check (status in ('published', 'draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (business_id, id),
  unique (business_id, title)
);

create table knowledge_chunks (
  id bigserial primary key,
  business_id text not null,
  source_id uuid not null,
  position integer not null,
  heading text,
  content text not null,
  foreign key (business_id, source_id) references knowledge_sources (business_id, id) on delete cascade
);
create index knowledge_chunks_source_idx on knowledge_chunks (business_id, source_id, position);

create table knowledge_misses (
  id bigserial primary key,
  business_id text not null references businesses (id) on delete cascade,
  session_id uuid,
  query text not null,
  created_at timestamptz not null default now(),
  foreign key (business_id, session_id) references chat_sessions (business_id, id) on delete set null (session_id)
);
create index knowledge_misses_business_idx on knowledge_misses (business_id, created_at desc);

grant select, insert, update, delete on knowledge_sources, knowledge_chunks, knowledge_misses to zaina_app;
grant usage, select on all sequences in schema public to zaina_app;

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array['knowledge_sources', 'knowledge_chunks', 'knowledge_misses'] loop
    execute format('alter table %I enable row level security', tenant_table);
    execute format(
      'create policy business_rows on %I to zaina_app using (business_id = app_business()) with check (business_id = app_business())',
      tenant_table
    );
  end loop;
end $$;
