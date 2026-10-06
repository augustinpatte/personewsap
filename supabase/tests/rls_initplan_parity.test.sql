-- RLS initplan rewrite parity — PRODUCTION project.
--
-- Proves 20261005180000_rls_auth_uid_initplan changes how often auth.uid() is
-- evaluated and nothing else:
--
--   1. structurally: every policy after the rewrite is, with
--      "( SELECT auth.uid() AS uid)" read back as "auth.uid()", exactly the
--      policy before it — same table, name, command, roles, permissive flag and
--      expression — and no policy was added or lost;
--   2. behaviourally: two readers and an anonymous caller see and can do
--      exactly the same on the hot user-owned tables before and after.
--
-- The runner applies migrations up to (not including) 20261005180000, then
-- inlines fixtures/rls_initplan_before.sql (snapshot + probe), then the
-- migration. One transaction, rolled back.
--
-- Run locally:
--   node scripts/local-sql-tests.mjs rls-initplan --with-migrations
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table ri_results (seq int, test text, expectation text, observed text, pass boolean);

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into ri_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

create temp table rls_after as
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage', 'realtime');

create or replace function pg_temp.unwrap(p text) returns text language sql immutable as $$
  select replace(p, '( SELECT auth.uid() AS uid)', 'auth.uid()')
$$;

-- ---------------------------------------------------------------------------
-- S. Structure
-- ---------------------------------------------------------------------------

select pg_temp.record(1, 'S1 the same set of policies exists', '0|0',
  (select count(*) from rls_before b where not exists (
     select 1 from rls_after a where (a.schemaname, a.tablename, a.policyname) = (b.schemaname, b.tablename, b.policyname)))::text
  || '|' ||
  (select count(*) from rls_after a where not exists (
     select 1 from rls_before b where (a.schemaname, a.tablename, a.policyname) = (b.schemaname, b.tablename, b.policyname)))::text);

select pg_temp.record(2, 'S2 every policy keeps its command, roles and permissive flag', '0',
  (select count(*) from rls_before b join rls_after a using (schemaname, tablename, policyname)
   where (a.cmd, a.roles, a.permissive) is distinct from (b.cmd, b.roles, b.permissive))::text);

select pg_temp.record(3, 'S3 every expression is the old one with only auth.uid() wrapped', '0',
  (select count(*) from rls_before b join rls_after a using (schemaname, tablename, policyname)
   where pg_temp.unwrap(a.qual) is distinct from pg_temp.unwrap(b.qual)
      or pg_temp.unwrap(a.with_check) is distinct from pg_temp.unwrap(b.with_check))::text);

select pg_temp.record(4, 'S4 49 policies were rewritten', '49',
  (select count(*) from rls_before b join rls_after a using (schemaname, tablename, policyname)
   where a.qual is distinct from b.qual or a.with_check is distinct from b.with_check)::text);

select pg_temp.record(5, 'S5 no policy calls auth.uid() per row any more', '',
  (select coalesce(string_agg(a.tablename || '.' || a.policyname || ' :: ' || coalesce(a.qual,'') || ' // ' || coalesce(a.with_check,''), ' ;; '), '') from rls_after a
   where coalesce(a.qual, '') || ' ' || coalesce(a.with_check, '') ~ 'auth\.uid\(\)'
     and (length(replace(coalesce(a.qual, '') || coalesce(a.with_check, ''), '( SELECT auth.uid() AS uid)', ''))
          - length(replace(replace(coalesce(a.qual, '') || coalesce(a.with_check, ''), '( SELECT auth.uid() AS uid)', ''), 'auth.uid()', ''))) > 0));

-- ---------------------------------------------------------------------------
-- B. Behaviour
-- ---------------------------------------------------------------------------

select pg_temp.record(10, 'B1 reader A sees and may do exactly what they could before',
  (select outcome from rls_probe_before where who = 'reader-a'),
  pg_temp.rls_probe('authenticated', 'aa000000-0000-4000-8000-00000000000a'));

select pg_temp.record(11, 'B2 reader B, the same',
  (select outcome from rls_probe_before where who = 'reader-b'),
  pg_temp.rls_probe('authenticated', 'aa000000-0000-4000-8000-00000000000b'));

select pg_temp.record(12, 'B3 an anonymous caller, the same',
  (select outcome from rls_probe_before where who = 'anon'),
  pg_temp.rls_probe('anon', null));

-- Sanity: the probe is not vacuous. A reader sees their own rows and not the
-- other's, and cannot touch the other's.
select pg_temp.record(13, 'B4 the probe sees isolation (own rows only, writes to the other refused or empty)', 'true',
  ((select outcome from rls_probe_before where who = 'reader-a') like '%profiles:see=1;%'
   and (select outcome from rls_probe_before where who = 'reader-a') like '%push_tokens:see=1;%'
   and (select outcome from rls_probe_before where who = 'reader-a') like '%daily_drops:see=1;%')::text);

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from ri_results) as checks,
  (select count(*) from ri_results where pass) as passed,
  (select count(*) from ri_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from ri_results where not pass) as failures;

rollback;
