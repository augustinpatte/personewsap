-- Teams introduction state — PRODUCTION project.
--
-- Proves 20260913091000_teams_intro_state: one nullable timestamp per reader on
-- profiles, empty for every existing row, written only for the caller by
-- complete_teams_intro(), which keeps the first completion forever — and which
-- no reader can read or write for anyone else.
--
-- One transaction ending in ROLLBACK.
--
-- Run locally without applying the migration:
--   node scripts/local-sql-tests.mjs teams-intro --with-migrations
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table ti_results (seq int, test text, expectation text, observed text, pass boolean);
grant all on ti_results to public;

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into ti_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

create or replace function pg_temp.sign_in(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
$$;

create or replace function pg_temp.ua() returns uuid
language sql immutable as $$ select 'f9000000-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.ub() returns uuid
language sql immutable as $$ select 'f9000000-0000-4000-8000-000000000002'::uuid $$;

create or replace function pg_temp.minute(p_at timestamptz) returns text
language sql immutable as $$
  select coalesce(to_char(p_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'NULL');
$$;

grant execute on function pg_temp.record(int, text, text, text) to public;
grant execute on function pg_temp.sign_in(uuid) to public;
grant execute on function pg_temp.ua() to public;
grant execute on function pg_temp.ub() to public;
grant execute on function pg_temp.minute(timestamptz) to public;

do $$
declare
  v_user uuid;
begin
  foreach v_user in array array[pg_temp.ua(), pg_temp.ub()] loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      'ti-suite-' || v_user || '@example.test', 'x', now(), now(), now(),
      '', '', '', '', '{"provider":"email"}', '{}'
    );

    insert into public.profiles (id, email, language, timezone)
    values (v_user, 'ti-suite-' || v_user || '@example.test', 'en', 'Europe/Paris');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- C. The column
-- ---------------------------------------------------------------------------

select pg_temp.record(1, 'C1 nullable, and empty for readers who existed before it', 'YES|NULL|NULL',
  concat_ws('|',
    (select c.is_nullable from information_schema.columns as c
     where c.table_schema = 'public' and c.table_name = 'profiles'
       and c.column_name = 'teams_intro_completed_at'),
    pg_temp.minute((select p.teams_intro_completed_at from public.profiles as p where p.id = pg_temp.ua())),
    pg_temp.minute((select p.teams_intro_completed_at from public.profiles as p where p.id = pg_temp.ub()))));

select pg_temp.record(2, 'C2 only signed-in readers (and the service role) can finish it', 'false|true|true',
  concat_ws('|',
    has_function_privilege('anon', 'public.complete_teams_intro()', 'EXECUTE')::text,
    has_function_privilege('authenticated', 'public.complete_teams_intro()', 'EXECUTE')::text,
    has_function_privilege('service_role', 'public.complete_teams_intro()', 'EXECUTE')::text));

-- ---------------------------------------------------------------------------
-- F. Finishing it
-- ---------------------------------------------------------------------------

do $$
declare
  v_completed timestamptz;
begin
  perform pg_temp.sign_in(pg_temp.ua());
  v_completed := public.complete_teams_intro();

  perform pg_temp.record(10, 'F1 finishing stamps the reader''s own row and returns it', 'true|true',
    (v_completed is not null)::text || '|' ||
    ((select p.teams_intro_completed_at from public.profiles as p where p.id = pg_temp.ua()) = v_completed)::text);

  perform pg_temp.record(11, 'F2 and nobody else''s', 'NULL',
    pg_temp.minute((select p.teams_intro_completed_at from public.profiles as p where p.id = pg_temp.ub())));
end $$;

-- A first completion made long ago.
update public.profiles set teams_intro_completed_at = timestamptz '2026-01-01 09:00:00+00'
where id = pg_temp.ua();

do $$
declare
  v_error text := 'returned';
begin
  perform pg_temp.sign_in(pg_temp.ua());

  perform pg_temp.record(12, 'F3 finishing again keeps the first completion: reopening never resets it',
    '2026-01-01 09:00|2026-01-01 09:00',
    pg_temp.minute(public.complete_teams_intro()) || '|' ||
    pg_temp.minute((select p.teams_intro_completed_at from public.profiles as p where p.id = pg_temp.ua())));

  perform pg_temp.sign_in(null);

  begin
    perform public.complete_teams_intro();
  exception when others then
    v_error := sqlstate;
  end;

  perform pg_temp.record(13, 'F4 signed out: refused', '28000', v_error);
end $$;

-- ---------------------------------------------------------------------------
-- R. As a client really reads and writes it
-- ---------------------------------------------------------------------------

set local role authenticated;

do $$
begin
  perform pg_temp.sign_in(pg_temp.ub());

  perform pg_temp.record(20, 'R1 a reader cannot see another reader''s introduction state', '0',
    (select count(*)::text from public.profiles as p where p.id = pg_temp.ua()));

  perform pg_temp.record(21, 'R2 but sees their own, still empty', '1|NULL',
    (select count(*)::text || '|' || pg_temp.minute(max(p.teams_intro_completed_at))
     from public.profiles as p where p.id = pg_temp.ub()));

  perform pg_temp.record(22, 'R3 and finishes it for themselves', 'true',
    (public.complete_teams_intro() is not null)::text);
end $$;

reset role;

select pg_temp.record(23, 'R4 which leaves the other reader''s completion untouched', '2026-01-01 09:00',
  pg_temp.minute((select p.teams_intro_completed_at from public.profiles as p where p.id = pg_temp.ua())));

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from ti_results) as checks,
  (select count(*) from ti_results where pass) as passed,
  (select count(*) from ti_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from ti_results where not pass) as failures;

rollback;
