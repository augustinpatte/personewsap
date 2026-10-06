-- Profiles identity audit — READ-ONLY.
--
-- Before 20261005120000_profiles_column_privileges, any signed-in reader could
-- write every column of their own profiles row directly, bypassing
-- set_player_identity (reserved/blocked usernames, own-avatar rule),
-- moderate_player_identity and complete_teams_intro. This lists rows whose
-- CURRENT values could only have arrived that way, so they can be reviewed by a
-- human. It changes nothing: the whole script runs in a READ ONLY transaction
-- that is rolled back.
--
-- Safe to run against production from the SQL editor (or psql) before and
-- after the migration. Each row is one finding: (check, profile_id, detail).
--
-- Limits: a moderator's `hidden` that a reader flipped back to `active` leaves
-- no trace on the row itself (there is no moderation log), so check 5 can only
-- surface hidden-worthy names that are active now, not prove a reversal.

begin transaction read only;

select 'username_reserved' as check, p.id as profile_id, p.username as detail
from public.profiles p
where p.username is not null
  and public.is_reserved_username(p.username)

union all

select 'username_blocked_fragment', p.id, p.username
from public.profiles p
where p.username is not null
  and public.has_blocked_fragment(p.username)

union all

-- set_player_identity only accepts `<own user id>/<file>`; anything else, and in
-- particular another reader's object, was written directly.
select 'avatar_path_not_own', p.id, p.avatar_path
from public.profiles p
where p.avatar_path is not null
  and public.is_own_avatar_path(p.avatar_path, p.id) is not true

union all

select 'avatar_path_shared', p.id, p.avatar_path
from public.profiles p
where p.avatar_path is not null
  and exists (
    select 1 from public.profiles other
    where other.avatar_path = p.avatar_path and other.id <> p.id
  )

union all

-- An active name that is reported and whose report was acted on: worth a look
-- in case a hidden status was reverted by the reader.
select 'active_username_with_actioned_report', p.id, p.username
from public.profiles p
where p.username_status = 'active'
  and p.username is not null
  and exists (
    select 1 from public.user_reports r
    where r.reported_user_id = p.id
      and r.status = 'actioned'
  )

union all

-- legacy_user_id is never written by any client path. A link to a legacy row
-- owned by a different auth user matters because account deletion follows it.
select 'legacy_user_id_mismatch', p.id, p.legacy_user_id::text
from public.profiles p
join public.users u on u.id = p.legacy_user_id
where u.auth_user_id is distinct from p.id

union all

-- Read through to_jsonb so the script also runs on a project where
-- 20260913091000_teams_intro_state has not been applied yet (no column, no rows).
select 'teams_intro_in_future', p.id, to_jsonb(p) ->> 'teams_intro_completed_at'
from public.profiles p
where (to_jsonb(p) ->> 'teams_intro_completed_at')::timestamptz > now() + interval '5 minutes'

order by 1, 2;

rollback;
