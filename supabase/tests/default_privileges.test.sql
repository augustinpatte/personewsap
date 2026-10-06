-- Default privileges — PRODUCTION project.
--
-- Proves 20261005181000_default_privileges_explicit_grants: an object created
-- after it is closed to anon and authenticated until a migration grants it, and
-- every object that existed before keeps its grants.
--
-- Run locally:
--   node scripts/local-sql-tests.mjs default-privileges --with-migrations
--
-- One transaction, rolled back. The final SELECT is the report.

begin;

create temp table dp_results (seq int, test text, expectation text, observed text, pass boolean);

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into dp_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

-- Created now, as a future migration would (the runner runs as postgres).
create table public.dp_probe_table (id bigserial primary key, note text);
create function public.dp_probe_function() returns int language sql as $$ select 1 $$;
create function public.dp_probe_definer() returns int language sql security definer as $$ select 1 $$;

select pg_temp.record(1, 'N1 a new table is not readable or writable by anon / authenticated', 'false|false|false|false',
  has_table_privilege('anon', 'public.dp_probe_table', 'select')::text || '|' ||
  has_table_privilege('anon', 'public.dp_probe_table', 'insert')::text || '|' ||
  has_table_privilege('authenticated', 'public.dp_probe_table', 'select')::text || '|' ||
  has_table_privilege('authenticated', 'public.dp_probe_table', 'insert')::text);

select pg_temp.record(2, 'N2 the service role still gets it', 'true|true',
  has_table_privilege('service_role', 'public.dp_probe_table', 'select')::text || '|' ||
  has_table_privilege('service_role', 'public.dp_probe_table', 'insert')::text);

select pg_temp.record(3, 'N3 its sequence is closed too', 'false|false|true',
  has_sequence_privilege('anon', 'public.dp_probe_table_id_seq', 'usage')::text || '|' ||
  has_sequence_privilege('authenticated', 'public.dp_probe_table_id_seq', 'usage')::text || '|' ||
  has_sequence_privilege('service_role', 'public.dp_probe_table_id_seq', 'usage')::text);

select pg_temp.record(4, 'N4 a new function is not executable by anon / authenticated / PUBLIC', 'false|false|false',
  has_function_privilege('anon', 'public.dp_probe_function()', 'execute')::text || '|' ||
  has_function_privilege('authenticated', 'public.dp_probe_function()', 'execute')::text || '|' ||
  exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = 'public.dp_probe_function()'::regprocedure and a.grantee = 0)::text);

select pg_temp.record(5, 'N5 not even a SECURITY DEFINER one', 'false|true',
  has_function_privilege('authenticated', 'public.dp_probe_definer()', 'execute')::text || '|' ||
  has_function_privilege('service_role', 'public.dp_probe_definer()', 'execute')::text);

-- An explicit grant is how a migration opens something; it still works.
grant execute on function public.dp_probe_function() to authenticated;
select pg_temp.record(7, 'N7 after GRANT, authenticated may execute it', 'true',
  has_function_privilege('authenticated', 'public.dp_probe_function()', 'execute')::text);

-- ---------------------------------------------------------------------------
-- E. Nothing that existed changes
-- ---------------------------------------------------------------------------

select pg_temp.record(10, 'E1 the app still reads its own tables (profiles, preferences)', 'true|true',
  has_table_privilege('authenticated', 'public.profiles', 'select')::text || '|' ||
  has_table_privilege('authenticated', 'public.user_preferences', 'select')::text);

select pg_temp.record(11, 'E2 the app still calls its RPCs (current_edition_date, update_profile_language)', 'true|true',
  has_function_privilege('authenticated', 'public.current_edition_date(timestamptz)', 'execute')::text || '|' ||
  has_function_privilege('authenticated', to_regprocedure('public.update_profile_language(text)'), 'execute')::text);

select pg_temp.record(12, 'E3 service-only functions stay service-only', 'false|true',
  has_function_privilege('authenticated', 'public.publish_scheduled_staging_payload(jsonb,text)', 'execute')::text || '|' ||
  has_function_privilege('service_role', 'public.publish_scheduled_staging_payload(jsonb,text)', 'execute')::text);

select pg_temp.record(13, 'E4 the default ACLs for postgres in public no longer name anon or authenticated', '0',
  (select count(*) from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole))::text);

select
  (select count(*) from dp_results) as checks,
  (select count(*) from dp_results where pass) as passed,
  (select count(*) from dp_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from dp_results where not pass) as failures;

rollback;
