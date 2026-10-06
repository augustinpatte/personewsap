-- Column-level least privilege on public.profiles.
--
-- WHAT WAS WRONG
--
-- RLS on profiles limits a signed-in reader to their own row, but it says
-- nothing about WHICH columns of that row they may write. A Supabase project
-- ships with
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON TABLES TO anon, authenticated, service_role;
--
-- so `authenticated` (and `anon`) hold INSERT and UPDATE on every column of
-- profiles. With nothing but the public anon key and their own session, a
-- reader could
--
--   update profiles set username_status = 'active' where id = auth.uid();
--
-- and undo a moderator's decision, set a reserved or blocked username that
-- set_player_identity would refuse, point avatar_path at a team-mate's avatar
-- object (team-mates can read it, so the reader appears with someone else's
-- face), or write legacy_user_id and teams_intro_completed_at directly.
-- Verified on a database rebuilt from these migrations: both roles hold all
-- seven table privileges.
--
-- WHO LEGITIMATELY WRITES WHAT (from the current code)
--
--   column                     writer                                   path
--   id, email                  AuthProvider (insert), onboarding        client, own row
--                              (upsert)
--   language                   same; update_profile_language            client, RPC (definer)
--   timezone                   same; useProfileTimezoneSync (update)     client, own row
--   username, country_code,    set_player_identity                      RPC (definer) only
--   avatar_path
--   username_status,           moderate_player_identity                 service_role only
--   avatar_status
--   teams_intro_completed_at   complete_teams_intro                     RPC (definer) only
--   legacy_user_id             nothing on the client                    server only
--   created_at, updated_at     column defaults                          nobody writes them
--
-- An upsert from PostgREST is INSERT ... ON CONFLICT (id) DO UPDATE SET <every
-- column in the payload>, `id` included, so the client's UPDATE grant has to
-- carry the same four columns as its INSERT grant. Updating `id` cannot move a
-- row: the RLS WITH CHECK still requires auth.uid() = id.
--
-- WHAT THIS DOES
--
-- The grant becomes the outer lock and RLS the inner one, as 20260907150000 did
-- for the Teams tables: revoke everything from PUBLIC, anon and authenticated,
-- then grant back SELECT on the table and INSERT/UPDATE on exactly the four
-- client-written columns. DELETE is not granted (there is no DELETE policy and
-- account deletion runs in the delete-account Edge Function as service_role).
--
-- Every identity RPC is SECURITY DEFINER and runs as the table owner, so none of
-- them is affected. service_role and postgres are untouched.
--
-- Forward-only, idempotent, and it changes no data.

BEGIN;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.profiles TO authenticated;

GRANT INSERT (id, email, language, timezone) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (id, email, language, timezone) ON TABLE public.profiles TO authenticated;

COMMENT ON TABLE public.profiles IS
  'One row per reader. Clients may INSERT/UPDATE only id, email, language and timezone on their own row (column grants + RLS). Identity (username, country_code, avatar_path) goes through set_player_identity, moderation (username_status, avatar_status) through moderate_player_identity, teams_intro_completed_at through complete_teams_intro; legacy_user_id is server-only. See 20261005120000_profiles_column_privileges.';

COMMIT;

NOTIFY pgrst, 'reload schema';
