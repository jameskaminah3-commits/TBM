-- 0006_hosted_database.sql
--
-- The platform's database is hosted on Supabase. A Supabase database comes
-- with roles for its Data API and GraphQL (anon, authenticated,
-- service_role), and gives them every table, sequence and function created
-- in the public schema. The platform uses neither: only its own roles reach
-- its data. This takes those grants back, now and for everything later
-- migrations create. On a database without those roles (a local Postgres,
-- the tests) the loop does nothing.
--
-- Functions are also callable by every role unless revoked: from here on,
-- the platform's functions are callable only by the roles given them.

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
    continue when not exists (select 1 from pg_roles where rolname = api_role);
    execute format('revoke all on all tables in schema public from %I', api_role);
    execute format('revoke all on all sequences in schema public from %I', api_role);
    execute format('revoke all on all functions in schema public from %I', api_role);
    execute format('revoke all on schema public from %I', api_role);
    -- What later migrations create (they run as this same role).
    execute format('alter default privileges in schema public revoke all on tables from %I', api_role);
    execute format('alter default privileges in schema public revoke all on sequences from %I', api_role);
    execute format('alter default privileges in schema public revoke all on functions from %I', api_role);
    execute format('alter default privileges revoke all on tables from %I', api_role);
    execute format('alter default privileges revoke all on sequences from %I', api_role);
    execute format('alter default privileges revoke all on functions from %I', api_role);
  end loop;
end $$;

revoke all on function app_business() from public;
grant execute on function app_business() to zaina_app;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges revoke execute on functions from public;
