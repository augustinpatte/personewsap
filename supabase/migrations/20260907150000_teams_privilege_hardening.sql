-- Take back the table privileges `authenticated` was never meant to hold.
--
-- WHAT WAS WRONG
--
-- Every Teams migration locks its tables the same way:
--
--   REVOKE ALL ON TABLE public.<t> FROM PUBLIC, anon;
--
-- and every one of them stops there. `authenticated` is not in that list, and a
-- Supabase project ships with
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
--
-- so the moment CREATE TABLE runs, `authenticated` holds SELECT, INSERT,
-- UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on it. The REVOKE removes
-- anon's copy and leaves authenticated's untouched.
--
-- Proven, not inferred: on a database rebuilt from these migrations with
-- `supabase db reset`, `authenticated` holds all seven privileges on all
-- eighteen Teams tables.
--
-- WHAT IT COST TODAY
--
-- Not data, yet. Every one of those tables has RLS enabled and none has an
-- UPDATE or DELETE policy, so a signed-in client writing to them changes zero
-- rows. The privilege is a loaded gun with the safety on.
--
-- What it did cost is the design. 20260906110000 says in as many words that
-- `authenticated` holds nothing on public.teams and that the predicate inside
-- team_directory "IS the access rule, not a convenience". That was false:
-- members could SELECT public.teams directly, invite_code column included,
-- subject only to the read policy. The contract suite's checks B23, H14, I8, I9
-- and I11 all assert the refusal that was never actually there — they expect an
-- error, and an UPDATE with the privilege but no policy is not an error, it is
-- a silent no-op. They failed the first time the suite was run against a real
-- database.
--
-- WHAT THIS DOES
--
-- Revokes everything from PUBLIC, anon and authenticated on each table, then
-- grants back exactly what a client's own code needs and the RLS policies
-- allow — nothing wider. The grant becomes the outer lock and the policy the
-- inner one, which is the arrangement the migrations claimed all along.
--
-- service_role and postgres are untouched: the content engine, the publisher
-- and the Edge Functions write through them and must keep doing so.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Read-only for the client
-- ---------------------------------------------------------------------------
-- Each of these has exactly one policy, a SELECT policy, and the mobile client
-- reads it directly (apps/mobile/src/features/teams/teamsData.ts,
-- .../today/dailyDropData.ts, .../account/privacyData.ts). SELECT is all they
-- have ever needed.

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'editions',
    'logical_questions',
    'logical_question_options',
    'logical_question_locales',
    'logical_question_option_locales',
    'solo_question_assignments',
    'team_question_assignments',
    'team_content_assignments',
    'team_members',
    'team_config_versions',
    'team_config_newsletter_topics',
    'team_config_mini_case_topics',
    'question_attempts',
    'team_question_scores',
    'team_member_edition_scores'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. public.teams: nothing at all
-- ---------------------------------------------------------------------------
-- Members read public.team_directory, which is an owner-rights view carrying
-- its own membership predicate and no invite_code column. No client reads
-- public.teams — the mobile app does not name the table anywhere, and
-- apps/mobile/src/features/quiz/releaseAudit.test.ts asserts that it never
-- will. Creating, renaming, joining, leaving and archiving all go through
-- SECURITY DEFINER RPCs.
--
-- The "Members can read their teams" SELECT policy from 20260906092000 stays
-- where it is. With no grant it can never be reached, and that is the point: if
-- a future migration re-grants SELECT by accident, the policy is the second
-- lock that stops the accident becoming a leak.

REVOKE ALL ON TABLE public.teams FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The two tables a client genuinely writes
-- ---------------------------------------------------------------------------
-- user_blocks: the block button inserts and the unblock button deletes, both
-- gated by policies on blocker_id = auth.uid(). No UPDATE — a block row has no
-- field worth changing, and the client's upsert is pinned to ON CONFLICT DO
-- NOTHING so it never asks for one.
--
-- user_reports: the reporter inserts and reads back their own. Never updates:
-- `status` is triage, and a reporter triaging their own report is check I11.

REVOKE ALL ON TABLE public.user_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.user_blocks TO authenticated;

REVOKE ALL ON TABLE public.user_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.user_reports TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. notification_outbox: not a client table in any sense
-- ---------------------------------------------------------------------------
-- Same defect, same commit series, and here anon held all seven too. RLS is on
-- with zero policies, so nobody outside service_role can reach a row — but the
-- outbox holds the push payload for every reader, and the privilege has no
-- business existing.

REVOKE ALL ON TABLE public.notification_outbox FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Stop the next table inheriting the same mistake
-- ---------------------------------------------------------------------------
-- The default privileges above are what re-granted everything, and they apply
-- to whatever `postgres` creates next. Narrowing them for the whole public
-- schema would change how every other feature's tables behave, so this leaves
-- them alone and states the rule instead: a new table in public starts with
-- ALL granted to anon and authenticated, and a migration that creates one is
-- not finished until it has revoked from BOTH — the suite's grant sweep
-- (supabase/tests/teams_and_scored_questions.test.sql, checks G1–G3) fails if
-- a Teams table ever drifts back.

COMMIT;

NOTIFY pgrst, 'reload schema';
