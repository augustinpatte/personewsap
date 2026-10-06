-- Column privileges on public.profiles — PRODUCTION project.
--
-- Proves 20261005120000_profiles_column_privileges: a signed-in reader can
-- write only id, email, language and timezone on their own profile row.
-- Identity and moderation columns are reachable only through their RPCs
-- (set_player_identity, complete_teams_intro, update_profile_language) or the
-- service role (moderate_player_identity), and anon holds nothing.
--
-- Every statement a client would send is run AS the client: role
-- `authenticated` with a JWT carrying sub and email, so grants and RLS both
-- apply exactly as through PostgREST.
--
-- One transaction ending in ROLLBACK. Nothing is written.
--
-- Run locally:
--   node scripts/local-sql-tests.mjs profiles-privileges --with-migrations
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table pp_results (seq int, test text, expectation text, observed text, pass boolean);
grant all on pp_results to public;

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into pp_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

create or replace function pg_temp.email_of(p_user uuid) returns text
language sql immutable as $$ select 'pp-suite-' || p_user || '@example.test' $$;

create or replace function pg_temp.sign_in(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'email', pg_temp.email_of(p_user))::text, true);
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  select set_config('request.jwt.claim.email', coalesce(pg_temp.email_of(p_user), ''), true);
$$;

create or replace function pg_temp.ua() returns uuid
language sql immutable as $$ select 'f7000000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.ub() returns uuid
language sql immutable as $$ select 'f7000000-0000-4000-8000-00000000000b'::uuid $$;
-- A brand-new account with no profile yet.
create or replace function pg_temp.uc() returns uuid
language sql immutable as $$ select 'f7000000-0000-4000-8000-00000000000c'::uuid $$;

-- Run a statement as the current role and report the SQLSTATE it raised, or
-- 'ok' with the number of rows it touched.
create or replace function pg_temp.attempt(p_sql text) returns text
language plpgsql as $$
declare
  v_rows bigint;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return 'ok:' || v_rows;
exception when others then
  return sqlstate;
end;
$$;

grant execute on function pg_temp.record(int, text, text, text) to public;
grant execute on function pg_temp.email_of(uuid) to public;
grant execute on function pg_temp.sign_in(uuid) to public;
grant execute on function pg_temp.ua() to public;
grant execute on function pg_temp.ub() to public;
grant execute on function pg_temp.uc() to public;
grant execute on function pg_temp.attempt(text) to public;

do $$
declare
  v_user uuid;
begin
  foreach v_user in array array[pg_temp.ua(), pg_temp.ub(), pg_temp.uc()] loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      pg_temp.email_of(v_user), 'x', now(), now(), now(),
      '', '', '', '', '{"provider":"email"}', '{}'
    );
  end loop;

  -- ua and ub are existing readers; uc has signed up and has no profile yet.
  insert into public.profiles (id, email, language, timezone)
  values
    (pg_temp.ua(), pg_temp.email_of(pg_temp.ua()), 'en', 'Europe/Paris'),
    (pg_temp.ub(), pg_temp.email_of(pg_temp.ub()), 'en', 'Europe/Paris');

  update public.profiles
  set avatar_path = pg_temp.ub() || '/face.jpg'
  where id = pg_temp.ub();
end $$;

-- ---------------------------------------------------------------------------
-- P. The privileges themselves
-- ---------------------------------------------------------------------------

select pg_temp.record(1, 'P1 anon holds nothing on profiles', 'false|false|false|false',
  concat_ws('|',
    has_table_privilege('anon', 'public.profiles', 'SELECT')::text,
    has_table_privilege('anon', 'public.profiles', 'INSERT')::text,
    has_table_privilege('anon', 'public.profiles', 'UPDATE')::text,
    has_table_privilege('anon', 'public.profiles', 'DELETE')::text));

select pg_temp.record(2, 'P2 authenticated keeps SELECT, loses table-wide INSERT/UPDATE/DELETE/TRUNCATE',
  'true|false|false|false|false',
  concat_ws('|',
    has_table_privilege('authenticated', 'public.profiles', 'SELECT')::text,
    has_table_privilege('authenticated', 'public.profiles', 'INSERT')::text,
    has_table_privilege('authenticated', 'public.profiles', 'UPDATE')::text,
    has_table_privilege('authenticated', 'public.profiles', 'DELETE')::text,
    has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')::text));

select pg_temp.record(3, 'P3 the four client-written columns are insertable and updatable',
  'id:true/true|email:true/true|language:true/true|timezone:true/true',
  (select string_agg(
     c || ':' || has_column_privilege('authenticated', 'public.profiles', c, 'INSERT')::text
       || '/' || has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE')::text,
     '|' order by ord)
   from unnest(array['id', 'email', 'language', 'timezone']) with ordinality as t(c, ord)));

select pg_temp.record(4, 'P4 every other column is neither insertable nor updatable by a client', '',
  (select coalesce(string_agg(column_name, ',' order by column_name), '')
   from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name not in ('id', 'email', 'language', 'timezone')
     and (has_column_privilege('authenticated', 'public.profiles', column_name, 'INSERT')
       or has_column_privilege('authenticated', 'public.profiles', column_name, 'UPDATE'))));

select pg_temp.record(5, 'P5 service_role still writes every column', 'true|true',
  concat_ws('|',
    has_table_privilege('service_role', 'public.profiles', 'INSERT')::text,
    has_table_privilege('service_role', 'public.profiles', 'UPDATE')::text));

-- ---------------------------------------------------------------------------
-- A–D. Protected columns, written directly by the reader on their own row
-- ---------------------------------------------------------------------------

set local role authenticated;

do $$
begin
  perform pg_temp.sign_in(pg_temp.ua());

  perform pg_temp.record(10, 'A a reader cannot set username_status', '42501',
    pg_temp.attempt(format('update public.profiles set username_status = %L where id = %L', 'active', pg_temp.ua())));

  perform pg_temp.record(11, 'B a reader cannot set a username directly', '42501',
    pg_temp.attempt(format('update public.profiles set username = %L where id = %L', 'admin', pg_temp.ua())));

  perform pg_temp.record(12, 'C a reader cannot point avatar_path at a team-mate''s avatar', '42501',
    pg_temp.attempt(format('update public.profiles set avatar_path = %L where id = %L',
      pg_temp.ub() || '/face.jpg', pg_temp.ua())));

  perform pg_temp.record(13, 'D1 nor set avatar_status', '42501',
    pg_temp.attempt(format('update public.profiles set avatar_status = %L where id = %L', 'active', pg_temp.ua())));

  perform pg_temp.record(14, 'D2 nor country_code', '42501',
    pg_temp.attempt(format('update public.profiles set country_code = %L where id = %L', 'FR', pg_temp.ua())));

  perform pg_temp.record(15, 'D3 nor teams_intro_completed_at', '42501',
    pg_temp.attempt(format('update public.profiles set teams_intro_completed_at = now() where id = %L', pg_temp.ua())));

  perform pg_temp.record(16, 'D4 nor legacy_user_id', '42501',
    pg_temp.attempt(format('update public.profiles set legacy_user_id = null where id = %L', pg_temp.ua())));

  perform pg_temp.record(17, 'D5 nor created_at / updated_at', '42501|42501',
    pg_temp.attempt(format('update public.profiles set created_at = now() where id = %L', pg_temp.ua()))
      || '|' ||
    pg_temp.attempt(format('update public.profiles set updated_at = now() where id = %L', pg_temp.ua())));

  perform pg_temp.record(18, 'D6 nor delete their profile row', '42501',
    pg_temp.attempt(format('delete from public.profiles where id = %L', pg_temp.ua())));

  -- A brand-new account cannot smuggle identity in through its first INSERT.
  perform pg_temp.sign_in(pg_temp.uc());

  perform pg_temp.record(19, 'D7 a new profile cannot be created with a username', '42501',
    pg_temp.attempt(format(
      'insert into public.profiles (id, email, language, timezone, username) values (%L, %L, %L, %L, %L)',
      pg_temp.uc(), pg_temp.email_of(pg_temp.uc()), 'en', 'UTC', 'admin')));

  perform pg_temp.record(20, 'D8 nor with a moderation status', '42501',
    pg_temp.attempt(format(
      'insert into public.profiles (id, email, language, timezone, username_status) values (%L, %L, %L, %L, %L)',
      pg_temp.uc(), pg_temp.email_of(pg_temp.uc()), 'en', 'UTC', 'active')));
end $$;

reset role;

select pg_temp.record(21, 'A–D left every protected value exactly as it was', 'active|NULL|NULL|NULL',
  (select concat_ws('|', p.username_status, coalesce(p.username, 'NULL'), coalesce(p.avatar_path, 'NULL'),
     coalesce(p.teams_intro_completed_at::text, 'NULL'))
   from public.profiles p where p.id = pg_temp.ua()));

-- ---------------------------------------------------------------------------
-- E. What the app legitimately does, exactly as it does it
-- ---------------------------------------------------------------------------

set local role authenticated;

do $$
begin
  -- AuthProvider: create the missing profile of a brand-new account.
  perform pg_temp.sign_in(pg_temp.uc());

  perform pg_temp.record(30, 'E1 a new account creates its own profile (id, email, language, timezone)', 'ok:1',
    pg_temp.attempt(format(
      'insert into public.profiles (id, email, language, timezone) values (%L, %L, %L, %L)',
      pg_temp.uc(), pg_temp.email_of(pg_temp.uc()), 'en', 'America/Chicago')));

  -- Onboarding: PostgREST upsert = INSERT ... ON CONFLICT DO UPDATE SET every payload column.
  perform pg_temp.record(31, 'E2 onboarding''s upsert of the same four columns still works', 'ok:1',
    pg_temp.attempt(format(
      'insert into public.profiles (id, email, language, timezone) values (%L, %L, %L, %L) '
      'on conflict (id) do update set id = excluded.id, email = excluded.email, '
      'language = excluded.language, timezone = excluded.timezone',
      pg_temp.uc(), pg_temp.email_of(pg_temp.uc()), 'fr', 'Europe/Paris')));

  -- useProfileTimezoneSync: update timezone, only when it changed.
  perform pg_temp.sign_in(pg_temp.ua());

  perform pg_temp.record(32, 'E3 a reader updates their own timezone', 'ok:1',
    pg_temp.attempt(format(
      'update public.profiles set timezone = %L where id = %L and timezone <> %L',
      'Asia/Tokyo', pg_temp.ua(), 'Asia/Tokyo')));

  perform pg_temp.record(33, 'E4 and their own language', 'ok:1',
    pg_temp.attempt(format('update public.profiles set language = %L where id = %L', 'fr', pg_temp.ua())));

  perform pg_temp.record(34, 'E5 and still reads their whole row', 'Asia/Tokyo|fr|active',
    (select concat_ws('|', p.timezone, p.language, p.username_status)
     from public.profiles p where p.id = pg_temp.ua()));

  -- ---------------------------------------------------------------------------
  -- F. Somebody else's row
  -- ---------------------------------------------------------------------------

  perform pg_temp.record(40, 'F1 an update aimed at another reader touches nothing', 'ok:0',
    pg_temp.attempt(format('update public.profiles set timezone = %L where id = %L', 'Asia/Tokyo', pg_temp.ub())));

  perform pg_temp.record(41, 'F2 a profile cannot be created for another account', '42501',
    pg_temp.attempt(format(
      'insert into public.profiles (id, email, language, timezone) values (%L, %L, %L, %L)',
      gen_random_uuid(), pg_temp.email_of(pg_temp.ua()), 'en', 'UTC')));

  perform pg_temp.record(42, 'F3 another reader''s row is not even visible', '0',
    (select count(*)::text from public.profiles p where p.id = pg_temp.ub()));

  -- ---------------------------------------------------------------------------
  -- G. The official paths still work for the caller
  -- ---------------------------------------------------------------------------

  perform pg_temp.record(50, 'G1 set_player_identity sets username and country', 'pp_reader_a|FR',
    (select concat_ws('|', r.username, r.country_code)
     from public.set_player_identity('pp_reader_a', 'FR', null) as r));

  perform pg_temp.record(51, 'G2 set_player_identity sets the caller''s own avatar', pg_temp.ua() || '/me.jpg',
    (select r.avatar_path from public.set_player_identity(null, null, pg_temp.ua() || '/me.jpg') as r));

  perform pg_temp.record(52, 'G3 complete_teams_intro stamps the caller', 'true',
    (public.complete_teams_intro() is not null)::text);

  perform pg_temp.record(53, 'G4 update_profile_language switches the caller''s language', 'en',
    (select r.language from public.update_profile_language('en') as r));
end $$;

reset role;

-- G5: moderation is the service role's, and a reader cannot undo it.
set local role service_role;
select public.moderate_player_identity(pg_temp.ua(), 'hidden', null);
reset role;

select pg_temp.record(54, 'G5 the service role hides a username', 'hidden',
  (select p.username_status from public.profiles p where p.id = pg_temp.ua()));

set local role authenticated;

do $$
begin
  perform pg_temp.sign_in(pg_temp.ua());

  perform pg_temp.record(55, 'G6 and the reader cannot un-hide it', '42501',
    pg_temp.attempt(format('update public.profiles set username_status = %L where id = %L', 'active', pg_temp.ua())));

  perform pg_temp.record(56, 'G7 nor call the moderation RPC themselves', '42501',
    pg_temp.attempt(format('select public.moderate_player_identity(%L, %L, null)', pg_temp.ua(), 'active')));
end $$;

reset role;

select pg_temp.record(57, 'G8 which leaves it hidden', 'hidden',
  (select p.username_status from public.profiles p where p.id = pg_temp.ua()));

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from pp_results) as checks,
  (select count(*) from pp_results where pass) as passed,
  (select count(*) from pp_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from pp_results where not pass) as failures;

rollback;
