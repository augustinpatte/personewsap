-- Optional player avatars, and Team avatars — PRODUCTION project.
--
-- One transaction ending in ROLLBACK: the throwaway readers, teams and storage
-- objects created below never survive the run, and no real user, team or
-- content row is read or written.
--
-- The suite asserts the POST-migration contract and expects
--   20260906091000_player_identity
--   20260906092000_teams_foundation
--   20260906101000_avatar_storage
--   20260907160000_avatar_path_guard_null_fix
--   20260908090000_optional_player_avatar
--   20260908091000_team_avatar
-- to be applied.
--
-- Run it against the local stack, with the unapplied migrations inlined into
-- this same rolled-back transaction:
--   npm run avatars:test:sql:local -- --with-migrations
--
-- Once they are applied to the local stack (`supabase db reset`), the flag is
-- no longer needed:
--   npm run avatars:test:sql:local
--
-- WHAT IT IS FOR. Three product rules that are one careless edit apart from
-- each other:
--
--   A. A photo is optional. A reader with avatar_path NULL is a complete
--      player, and every read surface serves them.
--   B. A photo can be taken OFF again. NULL means "leave it alone" in the
--      write, so removal needs its own argument, and it must not be possible
--      to smuggle a rename or a moderation reversal in beside it.
--   C. A Team photo is the TEAM's, not a member's. Only the owner may write
--      the object and the row; only an active member may read the object; a
--      path naming another Team is refused even to that Team's owner.
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table avatar_results (
  seq int,
  test text,
  expectation text,
  observed text,
  pass boolean
);

grant select, insert on avatar_results to public;

create or replace function pg_temp.record(
  p_seq int, p_test text, p_expected text, p_observed text
) returns void
language sql as $$
  insert into avatar_results
  values (p_seq, p_test, p_expected, p_observed, p_expected = p_observed);
$$;

grant execute on function pg_temp.record(int, text, text, text) to public;

-- Owner of the fixture team.
create or replace function pg_temp.uid_owner() returns uuid
language sql immutable as $$ select 'a1a1a1a1-0000-4000-8000-00000000000a'::uuid $$;
-- An ordinary member of it.
create or replace function pg_temp.uid_member() returns uuid
language sql immutable as $$ select 'b1b1b1b1-0000-4000-8000-00000000000b'::uuid $$;
-- In no team at all: the outsider every leakage check is run against.
create or replace function pg_temp.uid_outsider() returns uuid
language sql immutable as $$ select 'c1c1c1c1-0000-4000-8000-00000000000c'::uuid $$;

create or replace function pg_temp.team_one() returns uuid
language sql immutable as $$ select 'd1d1d1d1-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.team_two() returns uuid
language sql immutable as $$ select 'd2d2d2d2-0000-4000-8000-000000000002'::uuid $$;

grant execute on function pg_temp.uid_owner() to public;
grant execute on function pg_temp.uid_member() to public;
grant execute on function pg_temp.uid_outsider() to public;
grant execute on function pg_temp.team_one() to public;
grant execute on function pg_temp.team_two() to public;

create or replace function pg_temp.sign_in(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
$$;

grant execute on function pg_temp.sign_in(uuid) to public;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- Planted with the suite's own rights, before any sign_in: this is setup, not
-- something a client is being asked to prove it can do.

do $$
DECLARE
  v_user UUID;
  v_name TEXT;
BEGIN
  FOR v_user, v_name IN
    SELECT * FROM (VALUES
      (pg_temp.uid_owner(), 'avatarowner'),
      (pg_temp.uid_member(), 'avatarmember'),
      (pg_temp.uid_outsider(), 'avatarstranger')
    ) AS seed(id, username)
  LOOP
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      'avatar-suite-' || v_user || '@example.test', 'x', now(), now(), now(),
      '', '', '', '', '{"provider":"email"}', '{}'
    );

    INSERT INTO public.profiles (id, email, language, timezone, username, country_code)
    VALUES (
      v_user, 'avatar-suite-' || v_user || '@example.test', 'en', 'UTC',
      v_name, 'FR'
    );
  END LOOP;
END;
$$;

insert into public.teams (id, owner_id, name, invite_code)
values
  (pg_temp.team_one(), pg_temp.uid_owner(), 'Avatar Fixture One', 'AVFIXT01'),
  (pg_temp.team_two(), pg_temp.uid_outsider(), 'Avatar Fixture Two', 'AVFIXT02');

insert into public.team_members (team_id, user_id, role, eligible_from_edition)
values
  (pg_temp.team_one(), pg_temp.uid_owner(), 'owner', current_date),
  (pg_temp.team_one(), pg_temp.uid_member(), 'member', current_date),
  (pg_temp.team_two(), pg_temp.uid_outsider(), 'owner', current_date);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- A. A photo is optional
-- ---------------------------------------------------------------------------

do $$
DECLARE
  v_path TEXT;
  v_row RECORD;
BEGIN
  perform pg_temp.sign_in(pg_temp.uid_member());

  -- A1. The identity write accepts a name and a country with no photo at all.
  -- This is the whole of objective 2 at the layer that decides it.
  select p.avatar_path into v_path
  from public.set_player_identity('avatarmember', 'BE', NULL) p;

  perform pg_temp.record(1, 'A1 an identity can be written with no photo',
    'null', coalesce(v_path, 'null'));

  select avatar_path into v_path from public.profiles where id = pg_temp.uid_member();

  perform pg_temp.record(2, 'A2 and the column keeps NULL rather than a placeholder',
    'null', coalesce(v_path, 'null'));

  -- A3. Teams still serves that reader everything. The roster is what a
  -- leaderboard is drawn from, so a photo-less member appearing in it IS
  -- "Teams is accessible without a photo".
  perform pg_temp.record(3, 'A3 a member with no photo is on the roster',
    'true',
    (exists (
      select 1 from public.get_team_roster(pg_temp.team_one()) r
      where r.user_id = pg_temp.uid_member()
    ))::text);

  select * into v_row from public.get_team_detail(pg_temp.team_one());

  perform pg_temp.record(4, 'A4 and can read their team',
    pg_temp.team_one()::text, coalesce(v_row.team_id::text, 'null'));
END;
$$;

-- ---------------------------------------------------------------------------
-- B. A photo can be added, replaced and taken off again
-- ---------------------------------------------------------------------------

do $$
DECLARE
  v_first TEXT := pg_temp.uid_member()::text || '/one.jpg';
  v_second TEXT := pg_temp.uid_member()::text || '/two.jpg';
  v_path TEXT;
  v_failed BOOLEAN;
BEGIN
  perform pg_temp.sign_in(pg_temp.uid_member());

  select p.avatar_path into v_path
  from public.set_player_identity(NULL, NULL, v_first) p;

  perform pg_temp.record(10, 'B1 a photo can be added later',
    v_first, coalesce(v_path, 'null'));

  select p.avatar_path into v_path
  from public.set_player_identity(NULL, NULL, v_second) p;

  perform pg_temp.record(11, 'B2 and replaced', v_second, coalesce(v_path, 'null'));

  -- B3. A bare NULL must NOT remove it: that is the COALESCE which stops a
  -- caller sending only a country from erasing a username.
  select p.avatar_path into v_path
  from public.set_player_identity(NULL, 'BE', NULL) p;

  perform pg_temp.record(12, 'B3 NULL leaves the photo alone, it does not remove it',
    v_second, coalesce(v_path, 'null'));

  -- B4. The explicit flag does remove it.
  select p.avatar_path into v_path
  from public.set_player_identity(NULL, NULL, NULL, TRUE) p;

  perform pg_temp.record(13, 'B4 p_clear_avatar removes the photo',
    'null', coalesce(v_path, 'null'));

  select avatar_path into v_path from public.profiles where id = pg_temp.uid_member();

  perform pg_temp.record(14, 'B5 and the column is NULL again',
    'null', coalesce(v_path, 'null'));

  -- B6. Removing must not take the rest of the identity with it.
  perform pg_temp.record(15, 'B6 removing a photo keeps the username',
    'avatarmember',
    coalesce((select username from public.profiles where id = pg_temp.uid_member()), 'null'));

  -- B7. Set and clear together is refused rather than resolved by precedence.
  v_failed := false;
  BEGIN
    perform public.set_player_identity(NULL, NULL, v_first, TRUE);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(16, 'B7 setting and clearing at once is refused',
    'true', v_failed::text);

  -- B8. The impersonation guard survived the rewrite: another reader's path is
  -- still refused, and so is a malformed one.
  v_failed := false;
  BEGIN
    perform public.set_player_identity(NULL, NULL, pg_temp.uid_owner()::text || '/theirs.jpg');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(17, 'B8 another reader''s avatar path is still refused',
    'true', v_failed::text);

  v_failed := false;
  BEGIN
    perform public.set_player_identity(NULL, NULL, 'https://example.test/photo.jpg');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(18, 'B9 and a URL is still refused', 'true', v_failed::text);
END;
$$;

-- ---------------------------------------------------------------------------
-- B'. The 3-argument signature the installed build still calls
-- ---------------------------------------------------------------------------
-- A TestFlight build in people's hands calls set_player_identity with exactly
-- three arguments and cannot be changed retroactively. These checks are the
-- ones that would have caught dropping it.

do $$
DECLARE
  v_first TEXT := pg_temp.uid_member()::text || '/legacy-one.jpg';
  v_path TEXT;
  v_failed BOOLEAN;
  v_names TEXT;
BEGIN
  perform pg_temp.sign_in(pg_temp.uid_member());

  -- BC1. It still exists, with exactly the argument types the old build sends.
  -- `identity_arguments` renders the signature without defaults, which is the
  -- thing a call has to match.
  perform pg_temp.record(60, 'BC1 the 3-argument signature still exists',
    'p_username text, p_country_code text, p_avatar_path text',
    coalesce((
      select pg_get_function_identity_arguments(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_player_identity'
        and p.pronargs = 3
    ), 'missing'));

  perform pg_temp.record(61, 'BC2 there are exactly two overloads, 3 and 4 args',
    '3,4',
    coalesce((
      select string_agg(distinct p.pronargs::text, ',' order by p.pronargs::text)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_player_identity'
    ), 'none'));

  -- BC3. An old-build call — three arguments, nothing else — still works.
  select p.avatar_path into v_path
  from public.set_player_identity('avatarmember', 'BE', v_first) p;

  perform pg_temp.record(62, 'BC3 a 3-argument call still sets an avatar',
    v_first, coalesce(v_path, 'null'));

  -- BC4. And it can never remove one. The old body's COALESCE could not write
  -- NULL, and the wrapper passes p_clear_avatar => false, so a partial update
  -- from an old client leaves the photo exactly where it was.
  select p.avatar_path into v_path
  from public.set_player_identity(NULL, 'BE', NULL) p;

  perform pg_temp.record(63, 'BC4 a 3-argument call never removes the avatar',
    v_first, coalesce(v_path, 'null'));

  -- BC5. Nor does it erase the rest of the identity.
  perform pg_temp.record(64, 'BC5 nor the username',
    'avatarmember',
    coalesce((select pr.username from public.profiles pr
              where pr.id = pg_temp.uid_member()), 'null'));

  -- BC6. The 4-argument call is the one that can remove, and it still does.
  select p.avatar_path into v_path
  from public.set_player_identity(NULL, NULL, NULL, TRUE) p;

  perform pg_temp.record(65, 'BC6 the 4-argument call still removes the avatar',
    'null', coalesce(v_path, 'null'));

  -- BC7. Resolution is unambiguous in both directions. A 3-argument call
  -- cannot reach the 4-argument function, because p_clear_avatar carries no
  -- default — which is exactly what keeps PostgREST from refusing the old
  -- build's request with PGRST203.
  perform pg_temp.record(66, 'BC7 p_clear_avatar has no default',
    'false',
    coalesce((
      select (pg_get_function_arguments(p.oid) like '%p_clear_avatar boolean DEFAULT%')::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_player_identity'
        and p.pronargs = 4
    ), 'missing'));

  -- BC8. Both calls resolve, neither raises 42725 (function is not unique).
  v_failed := false;
  BEGIN
    perform public.set_player_identity(NULL, 'BE', NULL);
    perform public.set_player_identity(NULL, 'BE', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(67, 'BC8 neither arity is ambiguous', 'false', v_failed::text);

  -- BC9. The guards are the same through both doors. The wrapper holds no
  -- rules of its own, so an impersonating path must be refused through it too.
  v_failed := false;
  BEGIN
    perform public.set_player_identity(NULL, NULL, pg_temp.uid_owner()::text || '/theirs.jpg');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(68, 'BC9 the 3-argument door refuses another reader''s path',
    'true', v_failed::text);

  v_failed := false;
  BEGIN
    perform public.set_player_identity('admin', 'BE', NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(69, 'BC10 and a reserved username', 'true', v_failed::text);

  v_failed := false;
  BEGIN
    perform public.set_player_identity(NULL, 'FRANCE', NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(70, 'BC11 and a malformed country', 'true', v_failed::text);

  -- BC12. The 3-argument function DELEGATES rather than duplicating.
  --
  -- This is the check that can tell "recreated as a wrapper" from "the old
  -- plpgsql body is still sitting there": both behave identically, which is
  -- the point of the wrapper, so behaviour alone cannot distinguish them. Two
  -- copies of an avatar ownership guard is one copy too many, and the copy
  -- that drifts is always the one nobody is looking at.
  perform pg_temp.record(71, 'BC12 the 3-argument function delegates to the 4-argument one',
    'sql|delegates|no duplicated guard',
    coalesce((
      select
        l.lanname
        || '|' || (case when p.prosrc like '%set_player_identity(%' then 'delegates' else 'inlines' end)
        || '|' || (case when p.prosrc like '%is_own_avatar_path%' then 'duplicated guard'
                        else 'no duplicated guard' end)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
      where n.nspname = 'public' and p.proname = 'set_player_identity'
        and p.pronargs = 3
    ), 'missing'));

  -- BC13. Neither signature is reachable by anon or PUBLIC.
  select coalesce(string_agg(distinct g.grantee, ',' order by g.grantee), 'none')
  into v_names
  from information_schema.routine_privileges g
  where g.routine_schema = 'public'
    and g.routine_name = 'set_player_identity'
    and g.grantee in ('anon', 'PUBLIC');

  perform pg_temp.record(72, 'BC13 neither signature is granted to anon or PUBLIC',
    'none', v_names);
END;
$$;

-- ---------------------------------------------------------------------------
-- C. A Team photo is the Team's
-- ---------------------------------------------------------------------------

do $$
DECLARE
  v_first TEXT := pg_temp.team_one()::text || '/one.jpg';
  v_second TEXT := pg_temp.team_one()::text || '/two.jpg';
  v_other TEXT := pg_temp.team_two()::text || '/theirs.jpg';
  v_path TEXT;
  v_failed BOOLEAN;
  v_row RECORD;
BEGIN
  -- C1. A Team starts with no photo, and that is an ordinary state.
  perform pg_temp.sign_in(pg_temp.uid_member());

  select * into v_row from public.get_team_detail(pg_temp.team_one());

  perform pg_temp.record(20, 'C1 a team with no photo reads back as NULL',
    'null', coalesce(v_row.avatar_path, 'null'));

  perform pg_temp.record(21, 'C2 and the directory serves it the same way',
    'null',
    coalesce((select t.avatar_path from public.team_directory t
              where t.id = pg_temp.team_one()), 'null'));

  -- C3. A member is not an owner. Refused server-side, not merely hidden in
  -- the app.
  v_failed := false;
  BEGIN
    perform public.set_team_avatar(pg_temp.team_one(), v_first);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(22, 'C3 a member cannot set the team photo', 'true', v_failed::text);

  -- C4/C5/C6. The owner can add, replace and remove.
  perform pg_temp.sign_in(pg_temp.uid_owner());

  perform pg_temp.record(23, 'C4 the owner can add a team photo',
    v_first, coalesce(public.set_team_avatar(pg_temp.team_one(), v_first), 'null'));

  perform pg_temp.record(24, 'C5 and replace it',
    v_second, coalesce(public.set_team_avatar(pg_temp.team_one(), v_second), 'null'));

  -- The members see it in between.
  perform pg_temp.sign_in(pg_temp.uid_member());

  select * into v_row from public.get_team_detail(pg_temp.team_one());

  perform pg_temp.record(25, 'C6 a member reads the team photo path',
    v_second, coalesce(v_row.avatar_path, 'null'));

  perform pg_temp.sign_in(pg_temp.uid_owner());

  perform pg_temp.record(26, 'C7 and remove it',
    'null',
    coalesce(public.set_team_avatar(pg_temp.team_one(), NULL, TRUE), 'null'));

  -- Read straight off the table, with the suite's own rights: `authenticated`
  -- holds no SELECT on public.teams at all, and that is itself part of the
  -- contract — the column is reachable only through the moderated projection.
  set local role postgres;
  select t.avatar_path into v_path from public.teams t where t.id = pg_temp.team_one();
  set local role authenticated;

  perform pg_temp.record(27, 'C8 the column is NULL again',
    'null', coalesce(v_path, 'null'));

  -- C9. A path naming another Team is refused even to an owner.
  v_failed := false;
  BEGIN
    perform public.set_team_avatar(pg_temp.team_one(), v_other);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(28, 'C9 a path naming another team is refused',
    'true', v_failed::text);

  -- C10. So is a URL, and a traversal.
  v_failed := false;
  BEGIN
    perform public.set_team_avatar(pg_temp.team_one(), 'https://example.test/x.jpg');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(29, 'C10 and a URL is refused', 'true', v_failed::text);

  v_failed := false;
  BEGIN
    perform public.set_team_avatar(pg_temp.team_one(), '../secrets.jpg');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(30, 'C11 and a traversal is refused', 'true', v_failed::text);

  -- C12. Neither a path nor a clear flag is not a request.
  v_failed := false;
  BEGIN
    perform public.set_team_avatar(pg_temp.team_one(), NULL, FALSE);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  perform pg_temp.record(31, 'C12 an empty call is refused rather than clearing',
    'true', v_failed::text);

  -- C13. Setting a photo writes nothing else. The name is what a photo change
  -- must never be able to touch, because that is how a moderation decision
  -- would be lifted.
  perform public.set_team_avatar(pg_temp.team_one(), v_first);

  set local role postgres;

  perform pg_temp.record(32, 'C13 setting a photo does not touch the name',
    'Avatar Fixture One',
    coalesce((select t.name from public.teams t where t.id = pg_temp.team_one()), 'null'));

  perform pg_temp.record(33, 'C14 nor the invite code',
    'AVFIXT01',
    coalesce((select t.invite_code from public.teams t where t.id = pg_temp.team_one()), 'null'));

  set local role authenticated;
END;
$$;

-- ---------------------------------------------------------------------------
-- D. Who may see a Team photo
-- ---------------------------------------------------------------------------

do $$
DECLARE
  v_row RECORD;
BEGIN
  -- D1. An outsider gets no row at all — not an empty photo, no row. Same
  -- answer they get for the Team's existence.
  perform pg_temp.sign_in(pg_temp.uid_outsider());

  perform pg_temp.record(40, 'D1 an outsider sees no row in the directory',
    '0',
    (select count(*)::text from public.team_directory t where t.id = pg_temp.team_one()));

  select * into v_row from public.get_team_detail(pg_temp.team_one());

  perform pg_temp.record(41, 'D2 and no detail row',
    'null', coalesce(v_row.team_id::text, 'null'));

  -- D3. Moderation hides the photo with the name. Planted with the suite's own
  -- rights: moderate_team_name is service-role only, which is itself the point.
  set local role postgres;
  update public.teams set name_status = 'hidden' where id = pg_temp.team_one();
  set local role authenticated;

  perform pg_temp.sign_in(pg_temp.uid_member());

  select * into v_row from public.get_team_detail(pg_temp.team_one());

  perform pg_temp.record(42, 'D3 a moderated team hides its name',
    'null', coalesce(v_row.display_name, 'null'));

  perform pg_temp.record(43, 'D4 and hides its photo with it',
    'null', coalesce(v_row.avatar_path, 'null'));

  perform pg_temp.record(44, 'D5 the directory agrees',
    'null',
    coalesce((select t.avatar_path from public.team_directory t
              where t.id = pg_temp.team_one()), 'null'));

  set local role postgres;
  update public.teams set name_status = 'active' where id = pg_temp.team_one();
  set local role authenticated;
END;
$$;

-- ---------------------------------------------------------------------------
-- E. The bucket
-- ---------------------------------------------------------------------------

do $$
DECLARE
  v_public BOOLEAN;
  v_limit BIGINT;
BEGIN
  set local role postgres;

  select b.public, b.file_size_limit into v_public, v_limit
  from storage.buckets b where b.id = 'team-avatars';

  perform pg_temp.record(50, 'E1 the team-avatars bucket exists and is private',
    'false', coalesce(v_public::text, 'missing'));

  perform pg_temp.record(51, 'E2 with the same 400 KB ceiling as avatars',
    '409600', coalesce(v_limit::text, 'missing'));

  perform pg_temp.record(52, 'E3 and four policies scoped to it',
    '4',
    (select count(*)::text from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       -- coalesce on BOTH: an INSERT policy has no USING clause, so `qual` is
       -- NULL and a bare concatenation would swallow the whole row.
       and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%team-avatars%'));

  -- E4. The path is what carries the permission: a malformed one resolves to
  -- no team, which every membership predicate reads as false.
  perform pg_temp.record(53, 'E4 a malformed object path names no team',
    'null',
    coalesce(public.team_avatar_object_team('nested/deeper/file.jpg')::text, 'null'));

  perform pg_temp.record(54, 'E5 and a well-formed one names its team',
    pg_temp.team_one()::text,
    coalesce(
      public.team_avatar_object_team(pg_temp.team_one()::text || '/one.jpg')::text,
      'null'));

  -- E6. The shape predicate answers false, never NULL — the lesson of
  -- 20260907160000, which every caller here negates.
  perform pg_temp.record(55, 'E6 the path predicate never answers NULL',
    'false',
    coalesce(public.is_team_avatar_path('rubbish', pg_temp.team_one())::text, 'null'));

  set local role authenticated;
END;
$$;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------

reset role;

select
  (select count(*) from avatar_results) as checks,
  (select count(*) from avatar_results where pass) as passed,
  (select count(*) from avatar_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from avatar_results where not pass) as failures;

rollback;
