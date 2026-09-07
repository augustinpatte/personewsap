-- Teams, scored questions and server-authoritative grading — PRODUCTION project.
--
-- One transaction ending in ROLLBACK: the throwaway readers, teams, editions,
-- questions and attempts created below never survive the run, and no real user,
-- team or content row is read or written.
--
-- The suite asserts the POST-migration contract and expects
--   20260906090000_edition_registry
--   20260906091000_player_identity
--   20260906092000_teams_foundation
--   20260906093000_scored_questions
--   20260906094000_question_attempts_and_scoring
--   20260906095000_realtime_and_moderation
--   20260906103000_team_content_assignments
--   20260906104000_edition_assignment_engine
--   20260906106000_team_read_surface_and_invite
--   20260907140000_teams_security_hardening
-- to be applied.
--
-- Run it (after applying the migrations):
--   SUPABASE_ACCESS_TOKEN=sbp_… npm run teams:test:sql
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table team_results (
  seq int,
  test text,
  expectation text,
  observed text,
  pass boolean
);

grant select, insert on team_results to public;

create or replace function pg_temp.record(
  p_seq int, p_test text, p_expected text, p_observed text
) returns void
language sql as $$
  insert into team_results
  values (p_seq, p_test, p_expected, p_observed, p_expected = p_observed);
$$;

grant execute on function pg_temp.record(int, text, text, text) to public;

-- Owner of team 1, member of team 2.
create or replace function pg_temp.uid_owner() returns uuid
language sql immutable as $$ select 'aaaa0000-0000-4000-8000-00000000000a'::uuid $$;
-- Joins team 1 mid-edition. Reads in French.
create or replace function pg_temp.uid_late() returns uuid
language sql immutable as $$ select 'bbbb0000-0000-4000-8000-00000000000b'::uuid $$;
-- In no team at all: the outsider every leakage check is run against.
create or replace function pg_temp.uid_outsider() returns uuid
language sql immutable as $$ select 'cccc0000-0000-4000-8000-00000000000c'::uuid $$;
-- In team 1 from the start, and leaves later.
create or replace function pg_temp.uid_leaver() returns uuid
language sql immutable as $$ select 'dddd0000-0000-4000-8000-00000000000d'::uuid $$;

grant execute on function pg_temp.uid_owner() to public;
grant execute on function pg_temp.uid_late() to public;
grant execute on function pg_temp.uid_outsider() to public;
grant execute on function pg_temp.uid_leaver() to public;

create or replace function pg_temp.sign_in(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
$$;

grant execute on function pg_temp.sign_in(uuid) to public;

-- The two fixture editions, resolved at run time rather than hardcoded.
--
-- They have to be in the *past*, because half of this suite is about what
-- `current_edition_date()` and `next_scoring_edition_date()` answer, and those
-- read now(). A fixture pinned to 2027 would sit in the future, leave the real
-- most-recent production edition as "current", and quietly test nothing.
create temp table team_editions (label text primary key, edition_date date);
grant select on team_editions to public;

create or replace function pg_temp.ed(p_label text) returns date
language sql stable as $$
  select edition_date from team_editions where label = p_label;
$$;

grant execute on function pg_temp.ed(text) to public;

-- Fixed ids so every assertion can name what it is talking about.
create or replace function pg_temp.team_one() returns uuid
language sql immutable as $$ select 'e1e1e1e1-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.team_two() returns uuid
language sql immutable as $$ select 'e2e2e2e2-0000-4000-8000-000000000002'::uuid $$;
create or replace function pg_temp.lq_shared() returns uuid
language sql immutable as $$ select 'f0f0f0f0-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.lq_solo() returns uuid
language sql immutable as $$ select 'f0f0f0f0-0000-4000-8000-000000000002'::uuid $$;
create or replace function pg_temp.lq_unassigned() returns uuid
language sql immutable as $$ select 'f0f0f0f0-0000-4000-8000-000000000003'::uuid $$;
create or replace function pg_temp.opt_best() returns uuid
language sql immutable as $$ select 'ababab00-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.opt_weak() returns uuid
language sql immutable as $$ select 'ababab00-0000-4000-8000-000000000002'::uuid $$;

grant execute on function pg_temp.team_one() to public;
grant execute on function pg_temp.team_two() to public;
grant execute on function pg_temp.lq_shared() to public;
grant execute on function pg_temp.lq_solo() to public;
grant execute on function pg_temp.lq_unassigned() to public;
grant execute on function pg_temp.opt_best() to public;
grant execute on function pg_temp.opt_weak() to public;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Two editions in the recent past, resolved from now():
--   E1  four days ago  — published, then closed by E2
--   E2  two days ago   — published, and still the open edition
-- Their content_items keep a fixed publication_date; that column plays no part
-- in the edition sequence and only has to be a valid date.
do $$
declare
  v_user uuid;
begin
  foreach v_user in array array[
    pg_temp.uid_owner(), pg_temp.uid_late(), pg_temp.uid_outsider(), pg_temp.uid_leaver()
  ] loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      'teams-suite-' || v_user || '@example.test', 'x', now(), now(), now(),
      '', '', '', '', '{"provider":"email"}', '{}'
    );

    insert into public.profiles (id, email, language, timezone)
    values (v_user, 'teams-suite-' || v_user || '@example.test',
            case when v_user = pg_temp.uid_late() then 'fr' else 'en' end, 'UTC');
  end loop;

  update public.profiles set username = 'teamsuite_owner' where id = pg_temp.uid_owner();
  update public.profiles set username = 'teamsuite_late' where id = pg_temp.uid_late();
  update public.profiles set username = 'teamsuite_out' where id = pg_temp.uid_outsider();
  update public.profiles set username = 'teamsuite_leaver' where id = pg_temp.uid_leaver();

  -- The edition sequence is the clock this whole suite runs on, so it is
  -- isolated: real production editions would otherwise decide what "current"
  -- means and every ordering assertion below would be about them. Safe because
  -- the transaction ends in ROLLBACK, and nothing references editions by
  -- foreign key.
  delete from public.editions;

  insert into team_editions (label, edition_date) values
    ('e1', (now() - interval '4 days')::date),
    ('e2', (now() - interval '2 days')::date);

  -- E1 is closed by E2 having published after it; E2 is the open edition.
  insert into public.editions (edition_date, edition_kind, published_at) values
    (pg_temp.ed('e1'), 'daily', now() - interval '4 days'),
    (pg_temp.ed('e2'), 'daily', now() - interval '2 days');

  -- One editorial job, two renderings. The FR and EN mini cases share a
  -- content_logical_key, which is what the logical question hangs off.
  insert into public.content_items
    (id, content_type, topic_id, language, title, body_md, publication_date, status, metadata)
  values
    ('c1c1c1c1-0000-4000-8000-000000000001', 'mini_case', 'business', 'en',
     'Teams suite case EN', 'Case EN.', '2027-03-01', 'published',
     '{"staging_job_id":"teams-suite-job-1"}'),
    ('c1c1c1c1-0000-4000-8000-000000000002', 'mini_case', 'business', 'fr',
     'Teams suite cas FR', 'Cas FR.', '2027-03-01', 'published',
     '{"staging_job_id":"teams-suite-job-1"}'),
    ('c1c1c1c1-0000-4000-8000-000000000003', 'newsletter_article', 'business', 'en',
     'Teams suite article EN', 'Body EN.', '2027-03-01', 'published',
     '{"staging_job_id":"teams-suite-job-2"}'),
    ('c1c1c1c1-0000-4000-8000-000000000004', 'newsletter_article', 'business', 'fr',
     'Teams suite article FR', 'Corps FR.', '2027-03-01', 'published',
     '{"staging_job_id":"teams-suite-job-2"}');

  -- Teams. Created directly rather than through create_team() so the ids are
  -- fixed; create_team is exercised separately below.
  insert into public.teams (id, owner_id, name, invite_code) values
    (pg_temp.team_one(), pg_temp.uid_owner(), 'Teams suite one', 'TSUITE01'),
    (pg_temp.team_two(), pg_temp.uid_owner(), 'Teams suite two', 'TSUITE02');

  insert into public.team_members (team_id, user_id, role, eligible_from_edition, joined_at) values
    (pg_temp.team_one(), pg_temp.uid_owner(), 'owner', pg_temp.ed('e1'), now() - interval '4 days' - interval '1 hour'),
    (pg_temp.team_one(), pg_temp.uid_leaver(), 'member', pg_temp.ed('e1'), now() - interval '4 days' - interval '1 hour'),
    -- The late joiner arrives during E1 and is only eligible from E2.
    (pg_temp.team_one(), pg_temp.uid_late(), 'member', pg_temp.ed('e2'), now() - interval '4 days' + interval '1 hour'),
    (pg_temp.team_two(), pg_temp.uid_owner(), 'owner', pg_temp.ed('e1'), now() - interval '4 days' - interval '1 hour');

  insert into public.team_config_versions (id, team_id, version, effective_from_edition, created_by)
  values ('a0a0a0a0-0000-4000-8000-000000000001', pg_temp.team_one(), 1, pg_temp.ed('e1'), pg_temp.uid_owner());

  insert into public.team_config_newsletter_topics (config_version_id, topic_id, articles_count)
  values ('a0a0a0a0-0000-4000-8000-000000000001', 'business', 2);

  -- The questions. lq_shared is a mini-case question assigned to BOTH teams in
  -- E2 (the multi-team fanout case); lq_solo is personal only; lq_unassigned is
  -- the control nobody may reach.
  insert into public.logical_questions
    (id, content_logical_key, content_type, question_sequence, question_role)
  values
    (pg_temp.lq_shared(), 'teams-suite-job-1', 'mini_case', 1, 'method_framework'),
    (pg_temp.lq_solo(), 'teams-suite-job-2', 'newsletter_article', 1, 'comprehension'),
    (pg_temp.lq_unassigned(), 'teams-suite-job-1', 'mini_case', 2, 'technical_application');

  insert into public.logical_question_options (id, logical_question_id, option_key) values
    (pg_temp.opt_best(), pg_temp.lq_shared(), 'a'),
    (pg_temp.opt_weak(), pg_temp.lq_shared(), 'b'),
    ('ababab00-0000-4000-8000-000000000003', pg_temp.lq_solo(), 'a'),
    ('ababab00-0000-4000-8000-000000000004', pg_temp.lq_unassigned(), 'a');

  insert into public.logical_question_locales
    (logical_question_id, language, content_item_id, prompt)
  values
    (pg_temp.lq_shared(), 'en', 'c1c1c1c1-0000-4000-8000-000000000001', 'Which framework applies?'),
    (pg_temp.lq_shared(), 'fr', 'c1c1c1c1-0000-4000-8000-000000000002', 'Quel cadre s''applique ?'),
    (pg_temp.lq_solo(), 'en', 'c1c1c1c1-0000-4000-8000-000000000003', 'What changed?'),
    (pg_temp.lq_solo(), 'fr', 'c1c1c1c1-0000-4000-8000-000000000004', 'Qu''est-ce qui a changé ?'),
    (pg_temp.lq_unassigned(), 'en', 'c1c1c1c1-0000-4000-8000-000000000001', 'Unassigned prompt.');

  insert into public.logical_question_option_locales (option_id, language, label) values
    (pg_temp.opt_best(), 'en', 'The strong answer'),
    (pg_temp.opt_best(), 'fr', 'La bonne réponse'),
    (pg_temp.opt_weak(), 'en', 'The weak answer'),
    (pg_temp.opt_weak(), 'fr', 'La réponse faible'),
    ('ababab00-0000-4000-8000-000000000003', 'en', 'Solo option'),
    ('ababab00-0000-4000-8000-000000000003', 'fr', 'Option solo'),
    ('ababab00-0000-4000-8000-000000000004', 'en', 'Unassigned option');

  insert into private.logical_question_grades (option_id, score_milli, grade_band) values
    (pg_temp.opt_best(), 1000, 'excellent'),
    (pg_temp.opt_weak(), 0, 'bad'),
    ('ababab00-0000-4000-8000-000000000003', 600, 'good'),
    ('ababab00-0000-4000-8000-000000000004', 1000, 'excellent');

  insert into private.logical_question_option_feedback (option_id, language, feedback_md) values
    (pg_temp.opt_best(), 'en', 'Correct: it isolates the constraint.'),
    (pg_temp.opt_best(), 'fr', 'Correct : cela isole la contrainte.');

  -- Assignments. The shared question goes to both teams for E2, so one answer
  -- must score twice. The owner also has it personally.
  insert into public.team_question_assignments
    (team_id, edition_date, logical_question_id, content_type, config_version_id)
  values
    (pg_temp.team_one(), pg_temp.ed('e2'), pg_temp.lq_shared(), 'mini_case', 'a0a0a0a0-0000-4000-8000-000000000001'),
    (pg_temp.team_two(), pg_temp.ed('e2'), pg_temp.lq_shared(), 'mini_case', null);

  -- E1 assignment for team one, which the leaver completes before leaving.
  insert into public.team_question_assignments
    (team_id, edition_date, logical_question_id, content_type)
  values (pg_temp.team_one(), pg_temp.ed('e1'), pg_temp.lq_solo(), 'newsletter_article');

  insert into public.solo_question_assignments (user_id, edition_date, logical_question_id)
  values (pg_temp.uid_owner(), pg_temp.ed('e2'), pg_temp.lq_solo());
end $$;

-- ---------------------------------------------------------------------------
-- A. Structural guarantees, checked as the owning role
-- ---------------------------------------------------------------------------
do $$
declare
  v_state text;
begin
  -- A Business Story question can never be assigned to a Team (§2).
  insert into public.logical_questions
    (id, content_logical_key, content_type, question_sequence, question_role)
  values ('f0f0f0f0-0000-4000-8000-00000000000b', 'teams-suite-story', 'business_story', 1, 'comprehension');

  begin
    insert into public.team_question_assignments
      (team_id, edition_date, logical_question_id, content_type)
    values (pg_temp.team_one(), pg_temp.ed('e2'), 'f0f0f0f0-0000-4000-8000-00000000000b', 'business_story');
    perform pg_temp.record(1, 'A1 a business story cannot be assigned to a team', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(1, 'A1 a business story cannot be assigned to a team', 'refused', 'refused');
  end;

  -- The mini-case pedagogical order is pinned to the sequence (§2).
  begin
    insert into public.logical_questions
      (content_logical_key, content_type, question_sequence, question_role)
    values ('teams-suite-badrole', 'mini_case', 1, 'conclusion_decision');
    perform pg_temp.record(2, 'A2 mini-case role must match its sequence', 'refused', 'inserted');
  exception when check_violation then
    perform pg_temp.record(2, 'A2 mini-case role must match its sequence', 'refused', 'refused');
  end;

  -- A locale row cannot claim a language its content item does not have (§9).
  begin
    insert into public.logical_question_locales
      (logical_question_id, language, content_item_id, prompt)
    values (pg_temp.lq_solo(), 'fr', 'c1c1c1c1-0000-4000-8000-000000000003', 'Mismatch');
    perform pg_temp.record(3, 'A3 a locale cannot point at the other language''s item', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(3, 'A3 a locale cannot point at the other language''s item', 'refused', 'refused');
  end;

  -- An edition is open until the next one publishes (§15).
  perform pg_temp.record(4, 'A4 E1 is closed once E2 has published', 'false',
    public.is_edition_open(pg_temp.ed('e1'))::text);
  perform pg_temp.record(5, 'A5 E2 is still open', 'true',
    public.is_edition_open(pg_temp.ed('e2'))::text);
  perform pg_temp.record(6, 'A6 E1 closes exactly when E2 published', 'true',
    (public.edition_closes_at(pg_temp.ed('e1'))
      = (select e.published_at from public.editions e where e.edition_date = pg_temp.ed('e2')))::text);
  perform pg_temp.record(8, 'A8 the open edition is E2', pg_temp.ed('e2')::text,
    public.current_edition_date()::text);
  perform pg_temp.record(9, 'A9 a joiner now becomes eligible after E2', 'true',
    (public.next_scoring_edition_date() > pg_temp.ed('e2'))::text);

  -- The FR and EN renderings resolve to ONE logical question (§9): one question
  -- id, two content items. Counted from the question's own locales — counting
  -- from the content items instead would also sweep in the other questions of
  -- the same mini case, which share those items.
  perform pg_temp.record(7, 'A7 one logical question spans two content renderings', '1|2',
    (select count(distinct l.logical_question_id)::text || '|' ||
            count(distinct l.content_item_id)::text
     from public.logical_question_locales l
     where l.logical_question_id = pg_temp.lq_shared()));
end $$;

-- ---------------------------------------------------------------------------
-- B. Everything below runs as `authenticated`, so RLS is really applied
-- ---------------------------------------------------------------------------
set local role authenticated;

do $$
declare
  v_state text;
  v_attempt uuid;
  v_deadline timestamptz;
  v_score int;
  v_teams int;
  v_expired boolean;
begin
  -- -------------------------------------------------------------------------
  -- Ownership and cross-team leakage
  -- -------------------------------------------------------------------------
  perform pg_temp.sign_in(pg_temp.uid_outsider());

  perform pg_temp.record(10, 'B1 an outsider sees no team', '0',
    (select count(*)::text from public.teams));
  perform pg_temp.record(11, 'B2 an outsider sees no membership row', '0',
    (select count(*)::text from public.team_members));
  perform pg_temp.record(12, 'B3 an outsider sees no team config', '0',
    (select count(*)::text from public.team_config_versions));
  perform pg_temp.record(13, 'B4 an outsider sees no team assignment', '0',
    (select count(*)::text from public.team_question_assignments));

  begin
    perform * from public.get_team_leaderboard(pg_temp.team_one(), 'edition');
    perform pg_temp.record(14, 'B5 an outsider cannot read a leaderboard', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(14, 'B5 an outsider cannot read a leaderboard', 'refused', 'refused');
  end;

  begin
    perform * from public.get_team_roster(pg_temp.team_one());
    perform pg_temp.record(15, 'B6 an outsider cannot read a roster', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(15, 'B6 an outsider cannot read a roster', 'refused', 'refused');
  end;

  -- The private realtime channel (§17/§18).
  perform pg_temp.record(16, 'B7 an outsider cannot subscribe to the team channel', 'false',
    public.can_read_team_topic(public.team_leaderboard_topic(pg_temp.team_one()))::text);

  -- A question they were never assigned is unreachable (§18).
  perform pg_temp.record(17, 'B8 an outsider sees no question', '0',
    (select count(*)::text from public.logical_questions));
  perform pg_temp.record(18, 'B9 an outsider sees no option label', '0',
    (select count(*)::text from public.logical_question_option_locales));

  -- -------------------------------------------------------------------------
  -- The private grading schema is unreachable from a client role
  -- -------------------------------------------------------------------------
  begin
    perform * from private.logical_question_grades;
    perform pg_temp.record(19, 'B10 the answer key is unreadable as authenticated', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(19, 'B10 the answer key is unreadable as authenticated', 'refused', 'refused');
  end;

  begin
    perform * from private.logical_question_option_feedback;
    perform pg_temp.record(20, 'B11 the private feedback is unreadable as authenticated', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(20, 'B11 the private feedback is unreadable as authenticated', 'refused', 'refused');
  end;

  -- -------------------------------------------------------------------------
  -- Mid-edition join: eligible from the NEXT edition (§5)
  -- -------------------------------------------------------------------------
  perform pg_temp.sign_in(pg_temp.uid_late());

  perform pg_temp.record(21, 'B12 the late joiner sees the team immediately', '1',
    (select count(*)::text from public.teams t where t.id = pg_temp.team_one()));
  perform pg_temp.record(22, 'B13 the late joiner is not eligible for the edition they joined in', 'false',
    public.was_team_member_eligible_for_edition(
      pg_temp.team_one(), pg_temp.uid_late(), pg_temp.ed('e1'))::text);
  perform pg_temp.record(23, 'B14 the late joiner is eligible for the next edition', 'true',
    public.was_team_member_eligible_for_edition(
      pg_temp.team_one(), pg_temp.uid_late(), pg_temp.ed('e2'))::text);

  -- -------------------------------------------------------------------------
  -- Playing: the server clock, the single attempt, the fanout
  -- -------------------------------------------------------------------------
  perform pg_temp.sign_in(pg_temp.uid_owner());

  perform pg_temp.record(24, 'B15 an assigned reader can reach the question', '1',
    (select count(*)::text from public.logical_questions q where q.id = pg_temp.lq_shared()));
  perform pg_temp.record(25, 'B16 an unassigned question stays hidden', '0',
    (select count(*)::text from public.logical_questions q where q.id = pg_temp.lq_unassigned()));

  select s.attempt_id, s.deadline_at into v_attempt, v_deadline
  from public.start_question_attempt(pg_temp.lq_shared()) s;

  perform pg_temp.record(26, 'B17 the deadline is 20 seconds after the server start', '20',
    round(extract(epoch from (v_deadline - (
      select a.started_at from public.question_attempts a where a.id = v_attempt
    ))))::text);

  -- Resuming returns the SAME attempt, deadline and option order (§10/§11).
  perform pg_temp.record(27, 'B18 restarting resumes the same attempt', v_attempt::text,
    (select s.attempt_id::text from public.start_question_attempt(pg_temp.lq_shared()) s));
  perform pg_temp.record(28, 'B19 restarting does not extend the deadline',
    to_char(v_deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'),
    (select to_char(s.deadline_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')
     from public.start_question_attempt(pg_temp.lq_shared()) s));

  -- Nothing in the start payload reveals what an option is worth (§8).
  perform pg_temp.record(29, 'B20 the start payload carries no score or band', 'false',
    (select (s.options::text ilike '%score%' or s.options::text ilike '%excellent%')::text
     from public.start_question_attempt(pg_temp.lq_shared()) s));

  -- The feedback door is shut until the answer is in.
  begin
    perform * from public.get_question_feedback(pg_temp.lq_shared());
    perform pg_temp.record(30, 'B21 feedback is refused before submitting', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(30, 'B21 feedback is refused before submitting', 'refused', 'refused');
  end;

  -- A client cannot write its own score (§12).
  begin
    insert into public.question_attempts
      (user_id, logical_question_id, started_at, deadline_at, option_order, status, submitted_at, score_milli)
    values (pg_temp.uid_owner(), pg_temp.lq_solo(), now(), now() + interval '20 s',
            array[pg_temp.opt_best()], 'submitted', now(), 1000);
    perform pg_temp.record(31, 'B22 a client cannot insert an attempt with a score', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(31, 'B22 a client cannot insert an attempt with a score', 'refused', 'refused');
  end;

  begin
    update public.question_attempts a set score_milli = 1000 where a.id = v_attempt;
    perform pg_temp.record(32, 'B23 a client cannot update its own score', 'refused', 'updated');
  exception when others then
    perform pg_temp.record(32, 'B23 a client cannot update its own score', 'refused', 'refused');
  end;

  begin
    insert into public.team_member_edition_scores (team_id, user_id, edition_date, score_milli)
    values (pg_temp.team_one(), pg_temp.uid_owner(), pg_temp.ed('e2'), 999000);
    perform pg_temp.record(33, 'B24 a client cannot write the leaderboard', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(33, 'B24 a client cannot write the leaderboard', 'refused', 'refused');
  end;

  -- MULTI-TEAM FANOUT (§13): one answer, two teams.
  select s.score_milli, s.teams_scored, s.expired
  into v_score, v_teams, v_expired
  from public.submit_question_answer(v_attempt, pg_temp.opt_best()) s;

  perform pg_temp.record(34, 'B25 the strong answer scores 1000', '1000', v_score::text);
  perform pg_temp.record(35, 'B26 it was not treated as expired', 'false', v_expired::text);
  perform pg_temp.record(36, 'B27 it counted for both teams', '2', v_teams::text);
  perform pg_temp.record(37, 'B28 team one recorded it once', '1',
    (select count(*)::text from public.team_question_scores s
     where s.team_id = pg_temp.team_one() and s.user_id = pg_temp.uid_owner()));
  perform pg_temp.record(38, 'B29 team two recorded it once', '1',
    (select count(*)::text from public.team_question_scores s
     where s.team_id = pg_temp.team_two() and s.user_id = pg_temp.uid_owner()));
  perform pg_temp.record(39, 'B30 the aggregate reflects the fanout', '1000',
    (select s.score_milli::text from public.team_member_edition_scores s
     where s.team_id = pg_temp.team_one()
       and s.user_id = pg_temp.uid_owner()
       and s.edition_date = pg_temp.ed('e2')));

  -- NO RETRY (§10), and the same rule across languages (§9): the attempt is
  -- unique on the LOGICAL question, so there is nothing left to replay.
  begin
    perform * from public.submit_question_answer(v_attempt, pg_temp.opt_weak());
    perform pg_temp.record(40, 'B31 a second submit is refused', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(40, 'B31 a second submit is refused', 'refused', 'refused');
  end;

  perform pg_temp.record(41, 'B32 exactly one attempt exists for the logical question', '1',
    (select count(*)::text from public.question_attempts a
     where a.user_id = pg_temp.uid_owner() and a.logical_question_id = pg_temp.lq_shared()));

  perform pg_temp.record(42, 'B33 restarting after submitting reports it, and returns no options', 'true|0',
    (select s.already_submitted::text || '|' || jsonb_array_length(s.options)::text
     from public.start_question_attempt(pg_temp.lq_shared()) s));

  -- Feedback is released now, and only now.
  perform pg_temp.record(43, 'B34 feedback is readable after submitting', '2',
    (select count(*)::text from public.get_question_feedback(pg_temp.lq_shared())));

  -- -------------------------------------------------------------------------
  -- The same question, read in French (§9)
  -- -------------------------------------------------------------------------
  -- The late joiner reads French and is eligible from E2, the edition this
  -- question is assigned in. They get the French prompt and French labels for
  -- the SAME logical question, and the same answer key grades them.
  perform pg_temp.sign_in(pg_temp.uid_late());

  perform pg_temp.record(45, 'B36 a French reader gets the French prompt', 'fr',
    (select s.language from public.start_question_attempt(pg_temp.lq_shared()) s));

  perform pg_temp.record(46, 'B37 the prompt and options are the French ones', 'true|true',
    (select (s.prompt like 'Quel cadre%')::text || '|' ||
            (s.options::text like '%La bonne%')::text
     from public.start_question_attempt(pg_temp.lq_shared()) s));

  select s.attempt_id into v_attempt
  from public.start_question_attempt(pg_temp.lq_shared()) s;

  select s.score_milli into v_score
  from public.submit_question_answer(v_attempt, pg_temp.opt_best()) s;

  perform pg_temp.record(47, 'B38 the French reader is graded on the same scale', '1000', v_score::text);
  perform pg_temp.record(48, 'B39 there is one attempt, not one per language', '1',
    (select count(*)::text from public.question_attempts a
     where a.user_id = pg_temp.uid_late() and a.logical_question_id = pg_temp.lq_shared()));

  perform pg_temp.sign_in(pg_temp.uid_owner());

  -- -------------------------------------------------------------------------
  -- Skip, and answering after the deadline (§11)
  -- -------------------------------------------------------------------------
  select s.attempt_id into v_attempt
  from public.start_question_attempt(pg_temp.lq_solo()) s;

  select s.score_milli, s.skipped into v_score, v_expired
  from public.submit_question_answer(v_attempt, null) s;

  perform pg_temp.record(44, 'B35 a skip is an explicit submit worth zero', '0|true',
    v_score::text || '|' || v_expired::text);
end $$;

-- The late answer: the deadline is moved into the past by the owning role
-- (a client cannot do this — which is the point), then submitted as the reader.
reset role;

do $$
declare
  v_attempt uuid;
begin
  perform pg_temp.sign_in(pg_temp.uid_leaver());

  insert into public.question_attempts
    (id, user_id, logical_question_id, edition_date, started_at, deadline_at, option_order)
  values ('deadbeef-0000-4000-8000-000000000001', pg_temp.uid_leaver(), pg_temp.lq_shared(),
          pg_temp.ed('e2'), now() - interval '5 minutes', now() - interval '4 minutes',
          array[pg_temp.opt_best(), pg_temp.opt_weak()]);
end $$;

set local role authenticated;

do $$
declare
  v_score int;
  v_expired boolean;
  v_selected uuid;
begin
  perform pg_temp.sign_in(pg_temp.uid_leaver());

  select s.score_milli, s.expired, s.selected_option_id
  into v_score, v_expired, v_selected
  from public.submit_question_answer('deadbeef-0000-4000-8000-000000000001', pg_temp.opt_best()) s;

  perform pg_temp.record(50, 'C1 an answer after the server deadline scores zero', '0', v_score::text);
  perform pg_temp.record(51, 'C2 it is reported as expired', 'true', v_expired::text);
  perform pg_temp.record(52, 'C3 the late choice is not kept as if it counted', 'null',
    coalesce(v_selected::text, 'null'));
end $$;

-- ---------------------------------------------------------------------------
-- D. Configuration versioning, leaving, and history
-- ---------------------------------------------------------------------------
do $$
declare
  v_effective date;
  v_version int;
begin
  perform pg_temp.sign_in(pg_temp.uid_owner());

  -- CONFIG VERSIONING (§4). E2 is the open edition, so a change must take
  -- effect at the edition after it and leave E2 resolving to version 1.
  perform pg_temp.record(60, 'D1 E2 resolves to config version 1 before the change',
    'a0a0a0a0-0000-4000-8000-000000000001',
    public.team_effective_config_version(pg_temp.team_one(), pg_temp.ed('e2'))::text);

  select c.effective_from_edition, c.version into v_effective, v_version
  from public.update_team_config(
    pg_temp.team_one(),
    '[{"topic_id":"business","articles_count":2},{"topic_id":"tech_ai","articles_count":1}]'::jsonb,
    array['ai','finance_economy']
  ) c;

  perform pg_temp.record(61, 'D2 the new version is version 2', '2', v_version::text);
  perform pg_temp.record(62, 'D3 it takes effect after the current edition', 'true',
    (v_effective > pg_temp.ed('e2'))::text);
  perform pg_temp.record(63, 'D4 the edition in flight keeps its original config',
    'a0a0a0a0-0000-4000-8000-000000000001',
    public.team_effective_config_version(pg_temp.team_one(), pg_temp.ed('e2'))::text);
  perform pg_temp.record(64, 'D5 the next edition gets the new config', 'true',
    (public.team_effective_config_version(pg_temp.team_one(), v_effective)
      <> 'a0a0a0a0-0000-4000-8000-000000000001')::text);
  perform pg_temp.record(65, 'D6 the new config carries both newsletter topics', '2',
    (select count(*)::text from public.team_config_newsletter_topics n
     where n.config_version_id = public.team_effective_config_version(pg_temp.team_one(), v_effective)));

  -- Only the owner may change it (§18).
  perform pg_temp.sign_in(pg_temp.uid_late());
  begin
    perform * from public.update_team_config(pg_temp.team_one(), '[]'::jsonb, array[]::text[]);
    perform pg_temp.record(66, 'D7 a member cannot change the configuration', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(66, 'D7 a member cannot change the configuration', 'refused', 'refused');
  end;

  begin
    perform public.rename_team(pg_temp.team_one(), 'Hijacked');
    perform pg_temp.record(67, 'D8 a member cannot rename the team', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(67, 'D8 a member cannot rename the team', 'refused', 'refused');
  end;

  -- LEAVING (§6). The leaver has a recorded score in E2; it must survive.
  perform pg_temp.sign_in(pg_temp.uid_leaver());

  perform pg_temp.record(68, 'D9 the leaver has a recorded score before leaving', '1',
    (select count(*)::text from public.team_question_scores s
     where s.team_id = pg_temp.team_one() and s.user_id = pg_temp.uid_leaver()));

  perform * from public.leave_team(pg_temp.team_one());

  perform pg_temp.record(69, 'D10 leaving revokes access to the team', '0',
    (select count(*)::text from public.teams t where t.id = pg_temp.team_one()));
  perform pg_temp.record(70, 'D11 leaving revokes the realtime channel', 'false',
    public.can_read_team_topic(public.team_leaderboard_topic(pg_temp.team_one()))::text);
  perform pg_temp.record(71, 'D12 the membership row is closed, not deleted', 'true',
    (select (count(*) = 1)::text from public.team_members m
     where m.team_id = pg_temp.team_one()
       and m.user_id = pg_temp.uid_leaver()
       and m.left_at is not null));

  -- The score itself is still there for everyone who remains.
  perform pg_temp.sign_in(pg_temp.uid_owner());
  perform pg_temp.record(72, 'D13 the leaver''s historical score survives', '1',
    (select count(*)::text from public.team_question_scores s
     where s.team_id = pg_temp.team_one() and s.user_id = pg_temp.uid_leaver()));
  -- THE BOARD IS WHO YOU ARE PLAYING AGAINST, and this expectation changed
  -- deliberately (Prompt 3 §10). It used to assert the leaver stayed on the
  -- all-time leaderboard. The displayed board is now the CURRENT ACTIVE ROSTER:
  -- somebody who left is not a competitor any more, and leaving a former
  -- member's name at the top of a league they are no longer in reads as a bug
  -- to everyone still in it.
  --
  -- Nothing of theirs is deleted, recomputed or rewritten — D13 above asserts
  -- the ledger row is untouched — so the decision is reversible and a rejoin
  -- brings the same person back with their history intact.
  perform pg_temp.record(73, 'D14 the leaver leaves the board but not the ledger', 'false|1',
    (select (count(*) > 0)::text
     from public.get_team_leaderboard(pg_temp.team_one(), 'all_time') l
     where l.user_id = pg_temp.uid_leaver())
    || '|' ||
    (select count(*)::text from public.team_member_edition_scores s
     where s.team_id = pg_temp.team_one() and s.user_id = pg_temp.uid_leaver()));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- E. Team content assignment and the assignment engine
-- ---------------------------------------------------------------------------
-- The case the product is sold on, and the one that did not work:
--
--   PERSONAL   Tech & AI          (the only thing in uid_owner's own drop)
--   TEAM THREE Finance x2
--   TEAM FOUR  Finance x1 + Business x1 + Mini case AI
--
-- Every Finance, Business and mini-case row below is in NOBODY's daily drop. If
-- a reader can see one, it is because a Team was assigned it and for no other
-- reason — which is what has to be true, and what was false before
-- 20260906103000.
--
-- THE FIXTURE EDITION IS A QUIET DAY (E3), and that is not cosmetic. The
-- assignment engine selects an edition's content by publication_date, so real
-- published articles sharing that date would compete for the same topics and
-- silently decide the selection assertions below. The cadence publishes on
-- Mon/Wed/Fri/Sun only, so a recent Tue/Thu/Sat is a date this database cannot
-- hold an edition for — no content items, no daily drops, nothing to compete.
-- E3 is registered with the latest published_at of the three, which is what
-- makes it the open edition regardless of where its date falls.

create or replace function pg_temp.team_three() returns uuid
language sql immutable as $$ select 'e3e3e3e3-0000-4000-8000-000000000003'::uuid $$;
create or replace function pg_temp.team_four() returns uuid
language sql immutable as $$ select 'e4e4e4e4-0000-4000-8000-000000000004'::uuid $$;

grant execute on function pg_temp.team_three() to public;
grant execute on function pg_temp.team_four() to public;

do $$
declare
  v_drop_id uuid;
  v_baseline text;
  v_rerun text;
begin
  -- The most recent quiet day in the last week that is not already one of the
  -- two fixture editions. There are three quiet days in any seven, so this
  -- always resolves.
  insert into team_editions (label, edition_date)
  select 'e3', max(d)::date
  from generate_series(now()::date - 7, now()::date - 1, interval '1 day') d
  where public.resolve_edition_kind(d::date) is null
    and d::date <> pg_temp.ed('e1')
    and d::date <> pg_temp.ed('e2');

  insert into public.editions (edition_date, edition_kind, published_at)
  values (pg_temp.ed('e3'), 'daily', now() - interval '1 day');

  -- ---- the edition's content, none of it in anybody's drop -----------------
  insert into public.content_items
    (id, content_type, topic_id, language, title, body_md, publication_date, status, metadata)
  values
    ('aa010000-0000-4000-8000-000000000001', 'newsletter_article', 'finance', 'en',
     'Suite finance one EN', 'Body.', pg_temp.ed('e3'), 'published',
     '{"staging_job_id":"ts-fin-1","staging_ordinal":1}'),
    ('aa010000-0000-4000-8000-000000000002', 'newsletter_article', 'finance', 'fr',
     'Suite finance un FR', 'Corps.', pg_temp.ed('e3'), 'published',
     '{"staging_job_id":"ts-fin-1","staging_ordinal":1}'),
    ('aa010000-0000-4000-8000-000000000003', 'newsletter_article', 'finance', 'en',
     'Suite finance two EN', 'Body.', pg_temp.ed('e3'), 'published',
     '{"staging_job_id":"ts-fin-2","staging_ordinal":2}'),
    ('aa010000-0000-4000-8000-000000000004', 'newsletter_article', 'finance', 'fr',
     'Suite finance deux FR', 'Corps.', pg_temp.ed('e3'), 'published',
     '{"staging_job_id":"ts-fin-2","staging_ordinal":2}'),
    ('aa010000-0000-4000-8000-000000000005', 'newsletter_article', 'business', 'en',
     'Suite business EN', 'Body.', pg_temp.ed('e3'), 'published',
     '{"staging_job_id":"ts-biz-1","staging_ordinal":3}'),
    ('aa010000-0000-4000-8000-000000000006', 'newsletter_article', 'business', 'fr',
     'Suite business FR', 'Corps.', pg_temp.ed('e3'), 'published',
     '{"staging_job_id":"ts-biz-1","staging_ordinal":3}'),
    -- The personal one: in uid_owner's drop, in no Team configuration.
    ('aa010000-0000-4000-8000-000000000007', 'newsletter_article', 'tech_ai', 'en',
     'Suite tech EN', 'Body.', pg_temp.ed('e3'), 'published',
     '{"staging_job_id":"ts-tech-1","staging_ordinal":4}'),
    ('aa010000-0000-4000-8000-000000000008', 'mini_case', 'tech_ai', 'en',
     'Suite case EN', 'Body.', pg_temp.ed('e3'), 'published',
     '{"staging_job_id":"ts-case-ai","staging_ordinal":5,"product_topic":"ai"}'),
    ('aa010000-0000-4000-8000-000000000009', 'mini_case', 'tech_ai', 'fr',
     'Suite cas FR', 'Corps.', pg_temp.ed('e3'), 'published',
     '{"staging_job_id":"ts-case-ai","staging_ordinal":5,"product_topic":"ai"}'),
    -- Assigned to nobody, ever. The control every leakage check runs against.
    ('aa010000-0000-4000-8000-00000000000a', 'business_story', 'business', 'en',
     'Suite story EN', 'Body.', pg_temp.ed('e3'), 'published',
     '{"staging_job_id":"ts-story-1","staging_ordinal":6}');

  insert into public.sources (id, url, title, publisher) values
    ('50000000-0000-4000-8000-000000000001',
     'https://example.test/teams-suite/finance', 'Finance source', 'Suite'),
    ('50000000-0000-4000-8000-000000000002',
     'https://example.test/teams-suite/orphan', 'Orphan source', 'Suite');

  insert into public.content_item_sources (content_item_id, source_id, source_order) values
    ('aa010000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 0),
    ('aa010000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 0),
    ('aa010000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-000000000002', 0);

  -- Questions: two per article, three for the mini case, two for the story.
  insert into public.logical_questions
    (content_logical_key, content_type, question_sequence, question_role)
  values
    ('ts-fin-1', 'newsletter_article', 1, 'interpretation'),
    ('ts-fin-1', 'newsletter_article', 2, 'application_decision'),
    ('ts-fin-2', 'newsletter_article', 1, 'interpretation'),
    ('ts-fin-2', 'newsletter_article', 2, 'application_decision'),
    ('ts-biz-1', 'newsletter_article', 1, 'interpretation'),
    ('ts-biz-1', 'newsletter_article', 2, 'application_decision'),
    ('ts-tech-1', 'newsletter_article', 1, 'interpretation'),
    ('ts-tech-1', 'newsletter_article', 2, 'application_decision'),
    ('ts-case-ai', 'mini_case', 1, 'method_framework'),
    ('ts-case-ai', 'mini_case', 2, 'technical_application'),
    ('ts-case-ai', 'mini_case', 3, 'conclusion_decision'),
    ('ts-story-1', 'business_story', 1, 'interpretation'),
    ('ts-story-1', 'business_story', 2, 'application_decision');

  -- ---- the two teams ------------------------------------------------------
  insert into public.teams (id, owner_id, name, invite_code) values
    (pg_temp.team_three(), pg_temp.uid_owner(), 'Teams suite alpha', 'TSUITE03'),
    (pg_temp.team_four(), pg_temp.uid_owner(), 'Teams suite beta', 'TSUITE04');

  insert into public.team_members (team_id, user_id, role, eligible_from_edition, joined_at) values
    (pg_temp.team_three(), pg_temp.uid_owner(), 'owner', pg_temp.ed('e3'),
     now() - interval '4 days' - interval '1 hour'),
    (pg_temp.team_three(), pg_temp.uid_late(), 'member', pg_temp.ed('e3'),
     now() - interval '4 days' - interval '1 hour'),
    -- Joined during E3: eligible only from the edition AFTER it, so E3's Team
    -- content must be unreadable to them.
    (pg_temp.team_three(), pg_temp.uid_leaver(), 'member',
     public.next_edition_date_after(pg_temp.ed('e3')), now() - interval '1 hour'),
    (pg_temp.team_four(), pg_temp.uid_owner(), 'owner', pg_temp.ed('e3'),
     now() - interval '4 days' - interval '1 hour');

  insert into public.team_config_versions (id, team_id, version, effective_from_edition, created_by) values
    ('a0a0a0a0-0000-4000-8000-000000000003', pg_temp.team_three(), 1, pg_temp.ed('e3'), pg_temp.uid_owner()),
    ('a0a0a0a0-0000-4000-8000-000000000004', pg_temp.team_four(), 1, pg_temp.ed('e3'), pg_temp.uid_owner());

  insert into public.team_config_newsletter_topics (config_version_id, topic_id, articles_count, position) values
    ('a0a0a0a0-0000-4000-8000-000000000003', 'finance', 2, 1),
    ('a0a0a0a0-0000-4000-8000-000000000004', 'finance', 1, 1),
    ('a0a0a0a0-0000-4000-8000-000000000004', 'business', 1, 2);

  insert into public.team_config_mini_case_topics (config_version_id, topic_id, position) values
    ('a0a0a0a0-0000-4000-8000-000000000004', 'ai', 1);

  -- ---- uid_owner's own edition: Tech & AI, and nothing else ---------------
  insert into public.daily_drops (user_id, drop_date, language, status, published_at)
  values (pg_temp.uid_owner(), pg_temp.ed('e3'), 'en', 'published', now() - interval '1 day')
  returning id into v_drop_id;

  insert into public.daily_drop_items (daily_drop_id, content_item_id, slot, position)
  values (v_drop_id, 'aa010000-0000-4000-8000-000000000007', 'newsletter', 0);

  -- A Business Story cannot become Team content, by constraint rather than by
  -- convention (§10).
  begin
    insert into public.team_content_assignments
      (team_id, edition_date, content_logical_key, content_type, topic_id)
    values (pg_temp.team_three(), pg_temp.ed('e3'), 'ts-story-1', 'business_story', 'business');
    perform pg_temp.record(97, 'E18 a business story cannot be assigned to a team', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(97, 'E18 a business story cannot be assigned to a team', 'refused', 'refused');
  end;

  -- A newsletter depth of three is not a configuration this product has (§9).
  begin
    insert into public.team_config_newsletter_topics
      (config_version_id, topic_id, articles_count)
    values ('a0a0a0a0-0000-4000-8000-000000000003', 'law', 3);
    perform pg_temp.record(87, 'E8 a newsletter depth of three is refused by the schema', 'refused', 'inserted');
  exception when check_violation then
    perform pg_temp.record(87, 'E8 a newsletter depth of three is refused by the schema', 'refused', 'refused');
  end;

  -- ---- run the engine -----------------------------------------------------
  perform public.materialize_edition_assignments(pg_temp.ed('e3'));

  perform pg_temp.record(94, 'E15 the reader''s own content produced solo assignments', '2',
    (select count(*)::text
     from public.solo_question_assignments s
     join public.logical_questions q on q.id = s.logical_question_id
     where s.user_id = pg_temp.uid_owner()
       and s.edition_date = pg_temp.ed('e3')
       and q.content_logical_key = 'ts-tech-1'));

  -- Nothing personal was invented: the Team-only topics stayed out of the
  -- reader's own assignments.
  perform pg_temp.record(109, 'E30 team content did not leak into personal assignments', '0',
    (select count(*)::text
     from public.solo_question_assignments s
     join public.logical_questions q on q.id = s.logical_question_id
     where s.user_id = pg_temp.uid_owner()
       and s.edition_date = pg_temp.ed('e3')
       and q.content_logical_key in ('ts-fin-1', 'ts-fin-2', 'ts-biz-1', 'ts-case-ai')));

  perform pg_temp.record(85, 'E6 a topic configured for two articles gets two', '2',
    (select count(*)::text from public.team_content_assignments a
     where a.team_id = pg_temp.team_three()
       and a.edition_date = pg_temp.ed('e3')
       and a.topic_id = 'finance'));

  perform pg_temp.record(86, 'E7 a topic configured for one article gets the first ordinal', '1|ts-fin-1',
    (select count(*)::text || '|' || min(a.content_logical_key)
     from public.team_content_assignments a
     where a.team_id = pg_temp.team_four()
       and a.edition_date = pg_temp.ed('e3')
       and a.topic_id = 'finance'));

  perform pg_temp.record(95, 'E16 team assignments were materialized', '2|4',
    (select (select count(*) from public.team_content_assignments a
             where a.team_id = pg_temp.team_three() and a.edition_date = pg_temp.ed('e3'))::text
            || '|' ||
            (select count(*) from public.team_question_assignments q
             where q.team_id = pg_temp.team_three() and q.edition_date = pg_temp.ed('e3'))::text));

  perform pg_temp.record(96, 'E17 a team mini case produces exactly three questions', '3',
    (select count(*)::text from public.team_question_assignments q
     where q.team_id = pg_temp.team_four()
       and q.edition_date = pg_temp.ed('e3')
       and q.content_type = 'mini_case'));

  perform pg_temp.record(99, 'E20 an eligible member has a zero-score row before playing', '0|0|4|false',
    (select s.score_milli::text || '|' || s.answered_count::text || '|'
            || s.assigned_count::text || '|' || s.completed::text
     from public.team_member_edition_scores s
     where s.team_id = pg_temp.team_three()
       and s.user_id = pg_temp.uid_late()
       and s.edition_date = pg_temp.ed('e3')));

  -- The mid-edition joiner is not on this edition's roster at all.
  perform pg_temp.record(82, 'E3 a mid-edition joiner is absent from this edition''s roster', '0',
    (select count(*)::text from public.team_member_edition_scores s
     where s.team_id = pg_temp.team_three()
       and s.user_id = pg_temp.uid_leaver()
       and s.edition_date = pg_temp.ed('e3')));

  -- Every assignment carries the config version that produced it (§11).
  perform pg_temp.record(100, 'E21 every team assignment records its config version', '0',
    (select count(*)::text from public.team_content_assignments a
     where a.edition_date = pg_temp.ed('e3')
       and a.team_id in (pg_temp.team_three(), pg_temp.team_four())
       and a.config_version_id is null));

  -- ---- rerun ---------------------------------------------------------------
  select (select count(*) from public.team_content_assignments)::text || '|' ||
         (select count(*) from public.team_question_assignments)::text || '|' ||
         (select count(*) from public.solo_question_assignments)::text
    into v_baseline;

  perform public.materialize_edition_assignments(pg_temp.ed('e3'));
  perform public.materialize_edition_assignments(pg_temp.ed('e3'));

  select (select count(*) from public.team_content_assignments)::text || '|' ||
         (select count(*) from public.team_question_assignments)::text || '|' ||
         (select count(*) from public.solo_question_assignments)::text
    into v_rerun;

  perform pg_temp.record(98, 'E19 rerunning the engine changes nothing', v_baseline, v_rerun);
end $$;

-- ---------------------------------------------------------------------------
-- F. The same content, read through RLS
-- ---------------------------------------------------------------------------
set local role authenticated;

do $$
declare
  v_effective date;
  v_config_effective date;
begin
  -- -------------------------------------------------------------------------
  -- Team-only content is readable, and only by an entitled member
  -- -------------------------------------------------------------------------
  perform pg_temp.sign_in(pg_temp.uid_owner());

  perform pg_temp.record(80, 'E1 a team member can read team-only content that is in no drop', '1',
    (select count(*)::text from public.content_items ci
     where ci.id = 'aa010000-0000-4000-8000-000000000001'));

  -- The control: published, in this edition, assigned to no team and to no drop.
  perform pg_temp.record(91, 'E12 content nobody assigned stays unreadable', '0',
    (select count(*)::text from public.content_items ci
     where ci.id = 'aa010000-0000-4000-8000-00000000000a'));

  perform pg_temp.record(92, 'E13 the sources of team-only content are readable', '1',
    (select count(*)::text from public.sources s
     where s.id = '50000000-0000-4000-8000-000000000001'));

  perform pg_temp.record(93, 'E14 a source cited only by unassigned content is not', '0',
    (select count(*)::text from public.sources s
     where s.id = '50000000-0000-4000-8000-000000000002'));

  -- Progress on a Team-only article has to be writable (§7).
  begin
    insert into public.content_interactions (user_id, content_item_id, interaction_type)
    values (pg_temp.uid_owner(), 'aa010000-0000-4000-8000-000000000001', 'complete');
    perform pg_temp.record(90, 'E11 a team-only article can be marked complete', 'accepted', 'accepted');
  exception when others then
    perform pg_temp.record(90, 'E11 a team-only article can be marked complete', 'accepted', 'refused');
  end;

  begin
    insert into public.content_interactions (user_id, content_item_id, interaction_type)
    values (pg_temp.uid_owner(), 'aa010000-0000-4000-8000-00000000000a', 'complete');
    perform pg_temp.record(101, 'E22 an unassigned article cannot be marked complete', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(101, 'E22 an unassigned article cannot be marked complete', 'refused', 'refused');
  end;

  -- -------------------------------------------------------------------------
  -- One content, several teams, one row (§13)
  -- -------------------------------------------------------------------------
  perform pg_temp.record(88, 'E9 content assigned by two teams comes back once, with two teams', '1|2',
    (select count(*)::text || '|' || max(jsonb_array_length(c.teams))::text
     from public.get_my_team_edition_content(pg_temp.ed('e3')) c
     where c.content_logical_key = 'ts-fin-1'));

  -- An English reader gets the English rendering of a logical assignment.
  perform pg_temp.record(102, 'E23 the reader gets the rendering in their own language', 'en',
    (select c.display_language
     from public.get_my_team_edition_content(pg_temp.ed('e3')) c
     where c.content_logical_key = 'ts-fin-1'));

  -- The RPC carries the Team surfaces and nothing else: no business story, no
  -- personal-only article.
  perform pg_temp.record(110, 'E31 the team feed carries only team content', '0',
    (select count(*)::text
     from public.get_my_team_edition_content(pg_temp.ed('e3')) c
     where c.content_logical_key in ('ts-tech-1', 'ts-story-1')));

  -- -------------------------------------------------------------------------
  -- The outsider and the mid-edition joiner
  -- -------------------------------------------------------------------------
  perform pg_temp.sign_in(pg_temp.uid_outsider());

  perform pg_temp.record(81, 'E2 a non-member cannot read team-only content', '0',
    (select count(*)::text from public.content_items ci
     where ci.id = 'aa010000-0000-4000-8000-000000000001'));

  perform pg_temp.record(103, 'E24 a non-member gets no team content for the edition', '0',
    (select count(*)::text from public.get_my_team_edition_content(pg_temp.ed('e3'))));

  perform pg_temp.sign_in(pg_temp.uid_leaver());

  perform pg_temp.record(104, 'E25 a mid-edition joiner cannot read this edition''s team content', '0',
    (select count(*)::text from public.content_items ci
     where ci.id = 'aa010000-0000-4000-8000-000000000001'));

  perform pg_temp.record(105, 'E26 a mid-edition joiner gets no team content for this edition', '0',
    (select count(*)::text from public.get_my_team_edition_content(pg_temp.ed('e3'))));

  -- -------------------------------------------------------------------------
  -- FR and EN are one entitlement (§17)
  -- -------------------------------------------------------------------------
  perform pg_temp.sign_in(pg_temp.uid_late());

  perform pg_temp.record(89, 'E10 one logical assignment entitles both renderings', '2',
    (select count(*)::text from public.content_items ci
     where ci.id in ('aa010000-0000-4000-8000-000000000001',
                     'aa010000-0000-4000-8000-000000000002')));

  perform pg_temp.record(106, 'E27 a French reader is served the French rendering', 'fr',
    (select c.display_language
     from public.get_my_team_edition_content(pg_temp.ed('e3')) c
     where c.content_logical_key = 'ts-fin-1'));

  -- Same logical content for both readers: switching language is not a new
  -- assignment.
  perform pg_temp.record(111, 'E32 both languages resolve to the same logical content', '1',
    (select count(*)::text
     from public.get_my_team_edition_content(pg_temp.ed('e3')) c
     where c.content_logical_key = 'ts-fin-1'));

  -- -------------------------------------------------------------------------
  -- Creating a team starts at the NEXT edition, exactly like joining one (§12)
  -- -------------------------------------------------------------------------
  select t.effective_from_edition into v_effective
  from public.create_team('Teams suite delta') t;

  perform pg_temp.record(83, 'E4 the founder is not score-eligible in the open edition', 'true',
    (v_effective > public.current_edition_date())::text);

  perform pg_temp.record(107, 'E28 the founder''s membership starts at that same edition', 'true',
    (select (min(m.eligible_from_edition) = v_effective)::text
     from public.team_members m
     join public.teams t on t.id = m.team_id
     where t.name = 'Teams suite delta' and m.user_id = pg_temp.uid_late()));

  select min(v.effective_from_edition) into v_config_effective
  from public.team_config_versions v
  join public.teams t on t.id = v.team_id
  where t.name = 'Teams suite delta';

  perform pg_temp.record(84, 'E5 the first configuration takes effect next edition too', 'true',
    (v_config_effective > public.current_edition_date())::text);

  -- The owner asking for three articles is refused at the RPC too, not only by
  -- the constraint underneath it. Signed in as the owner, so a refusal here is
  -- about the count and not about who is asking.
  perform pg_temp.sign_in(pg_temp.uid_owner());

  begin
    perform * from public.update_team_config(
      pg_temp.team_three(),
      '[{"topic_id":"finance","articles_count":3}]'::jsonb,
      array[]::text[]);
    perform pg_temp.record(108, 'E29 the config RPC refuses three articles', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(108, 'E29 the config RPC refuses three articles', 'refused', 'refused');
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- G. Lifecycle, and what must survive it
-- ---------------------------------------------------------------------------
-- Every case here ends in somebody leaving, being removed, handing over or
-- deleting their account — and the property under test is always the same one:
-- HISTORICAL STANDINGS ARE IMMUTABLE RECORDS. A row that was true when it was
-- written stays true afterwards, whatever anyone does to the team around it.
--
-- The failure this guards against is not hypothetical. `resolve_team_ownership_on_profile_delete`
-- used to DELETE a team nobody was left in, with a comment claiming its scores
-- belonged only to the departing reader. They do not: every scoring table
-- cascades from `teams`, so that DELETE erased the history of everybody who had
-- left earlier — people still using the product, who had nothing to do with the
-- account being deleted.

create or replace function pg_temp.uid_founder() returns uuid
language sql immutable as $$ select 'f1f10000-0000-4000-8000-00000000000f'::uuid $$;
create or replace function pg_temp.uid_heir() returns uuid
language sql immutable as $$ select 'f2f20000-0000-4000-8000-00000000000e'::uuid $$;
create or replace function pg_temp.uid_gone() returns uuid
language sql immutable as $$ select 'f3f30000-0000-4000-8000-00000000000d'::uuid $$;
create or replace function pg_temp.team_life() returns uuid
language sql immutable as $$ select 'e5e5e5e5-0000-4000-8000-000000000005'::uuid $$;
create or replace function pg_temp.team_solo() returns uuid
language sql immutable as $$ select 'e6e6e6e6-0000-4000-8000-000000000006'::uuid $$;

grant execute on function pg_temp.uid_founder() to public;
grant execute on function pg_temp.uid_heir() to public;
grant execute on function pg_temp.uid_gone() to public;
grant execute on function pg_temp.team_life() to public;
grant execute on function pg_temp.team_solo() to public;

do $$
declare
  v_user uuid;
  v_owner_after uuid;
  v_status text;
begin
  foreach v_user in array array[pg_temp.uid_founder(), pg_temp.uid_heir(), pg_temp.uid_gone()]
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      'teams-life-' || v_user || '@example.test', 'x', now(), now(), now(),
      '', '', '', '', '{"provider":"email"}', '{}'
    );

    insert into public.profiles (id, email, language, timezone)
    values (v_user, 'teams-life-' || v_user || '@example.test', 'en', 'UTC');
  end loop;

  update public.profiles set username = 'life_founder' where id = pg_temp.uid_founder();
  update public.profiles set username = 'life_heir' where id = pg_temp.uid_heir();
  update public.profiles set username = 'life_gone' where id = pg_temp.uid_gone();

  -- A team with a founder, an heir, and somebody who leaves early and whose
  -- history must outlive every later event.
  insert into public.teams (id, owner_id, name, invite_code) values
    (pg_temp.team_life(), pg_temp.uid_founder(), 'Teams suite life', 'TSUITE05'),
    (pg_temp.team_solo(), pg_temp.uid_founder(), 'Teams suite solo', 'TSUITE06');

  insert into public.team_members (team_id, user_id, role, eligible_from_edition, joined_at) values
    (pg_temp.team_life(), pg_temp.uid_founder(), 'owner', pg_temp.ed('e1'), now() - interval '9 days'),
    (pg_temp.team_life(), pg_temp.uid_heir(), 'member', pg_temp.ed('e1'), now() - interval '8 days'),
    (pg_temp.team_life(), pg_temp.uid_gone(), 'member', pg_temp.ed('e1'), now() - interval '7 days'),
    (pg_temp.team_solo(), pg_temp.uid_founder(), 'owner', pg_temp.ed('e1'), now() - interval '9 days');

  -- Everybody scored in E1, including the reader who is about to leave.
  insert into public.team_member_edition_scores
    (team_id, user_id, edition_date, score_milli, answered_count, assigned_count, completed)
  values
    (pg_temp.team_life(), pg_temp.uid_founder(), pg_temp.ed('e1'), 1600, 2, 2, true),
    (pg_temp.team_life(), pg_temp.uid_heir(), pg_temp.ed('e1'), 1600, 2, 2, true),
    (pg_temp.team_life(), pg_temp.uid_gone(), pg_temp.ed('e1'), 1000, 2, 2, true);

  -- ---- remove a member -----------------------------------------------------
  perform pg_temp.sign_in(pg_temp.uid_founder());
  perform public.remove_team_member(pg_temp.team_life(), pg_temp.uid_gone());

  perform pg_temp.record(120, 'G1 removal closes the stint instead of deleting it', 'true',
    (select (count(*) = 1)::text from public.team_members m
     where m.team_id = pg_temp.team_life()
       and m.user_id = pg_temp.uid_gone()
       and m.left_at is not null));

  perform pg_temp.record(121, 'G2 removal keeps every point already earned', '1000',
    (select s.score_milli::text from public.team_member_edition_scores s
     where s.team_id = pg_temp.team_life()
       and s.user_id = pg_temp.uid_gone()
       and s.edition_date = pg_temp.ed('e1')));

  perform pg_temp.record(122, 'G3 a removed member leaves the board', 'false',
    (select exists (
      select 1 from public.get_team_leaderboard(pg_temp.team_life(), 'all_time') l
      where l.user_id = pg_temp.uid_gone()))::text);

  -- ---- the owner cannot walk out on a team that is still played ------------
  begin
    perform * from public.leave_team(pg_temp.team_life());
    perform pg_temp.record(123, 'G4 an owner with members must transfer first', 'refused', 'left');
  exception when others then
    perform pg_temp.record(123, 'G4 an owner with members must transfer first', 'refused', 'refused');
  end;

  perform pg_temp.record(124, 'G4 and the team is untouched by the refusal', 'active',
    (select t.status from public.teams t where t.id = pg_temp.team_life()));

  -- ---- an owner alone may archive -----------------------------------------
  perform * from public.leave_team(pg_temp.team_solo());

  perform pg_temp.record(125, 'G5 an owner alone archives rather than deletes', 'archived:1',
    (select t.status from public.teams t where t.id = pg_temp.team_solo())
    || ':' ||
    (select count(*)::text from public.teams t where t.id = pg_temp.team_solo()));

  -- ---- transfer, then leave ------------------------------------------------
  perform public.transfer_team_ownership(pg_temp.team_life(), pg_temp.uid_heir());

  perform pg_temp.record(126, 'G6 ownership moves to the named member', 'true',
    (select (t.owner_id = pg_temp.uid_heir())::text
     from public.teams t where t.id = pg_temp.team_life()));

  perform * from public.leave_team(pg_temp.team_life());

  perform pg_temp.record(127, 'G7 the former owner leaves without archiving the team', 'active',
    (select t.status from public.teams t where t.id = pg_temp.team_life()));
  perform pg_temp.record(128, 'G7 and their own history stays', '1600',
    (select s.score_milli::text from public.team_member_edition_scores s
     where s.team_id = pg_temp.team_life()
       and s.user_id = pg_temp.uid_founder()
       and s.edition_date = pg_temp.ed('e1')));
end $$;

-- ---------------------------------------------------------------------------
-- Account deletion: with a successor, and without one
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner_after uuid;
begin
  -- The heir owns team_life and one other reader has already left it. Deleting
  -- the heir's account must hand the team on, not end it.
  insert into public.team_members (team_id, user_id, role, eligible_from_edition, joined_at)
  values (pg_temp.team_life(), pg_temp.uid_founder(), 'member',
          public.next_scoring_edition_date(), now());

  delete from public.profiles where id = pg_temp.uid_heir();

  select t.owner_id into v_owner_after from public.teams t where t.id = pg_temp.team_life();

  perform pg_temp.record(129, 'G8 deleting the owner hands the team to the remaining member', 'true',
    (v_owner_after = pg_temp.uid_founder())::text);
  perform pg_temp.record(130, 'G8 the team stays active and playable', 'active',
    (select t.status from public.teams t where t.id = pg_temp.team_life()));

  -- And the reader who left long before is STILL in the ledger. This is the
  -- assertion the old DELETE would have failed.
  perform pg_temp.record(131, 'G9 an earlier leaver''s history survives the owner deletion', '1000',
    (select s.score_milli::text from public.team_member_edition_scores s
     where s.team_id = pg_temp.team_life()
       and s.user_id = pg_temp.uid_gone()
       and s.edition_date = pg_temp.ed('e1')));

  -- ---- now delete the last owner, leaving nobody --------------------------
  delete from public.profiles where id = pg_temp.uid_founder();

  perform pg_temp.record(132, 'G10 a team nobody is left in is archived, not deleted', 'archived',
    (select t.status from public.teams t where t.id = pg_temp.team_life()));
  perform pg_temp.record(133, 'G10 and its owner is released', 'true',
    (select (t.owner_id is null)::text from public.teams t where t.id = pg_temp.team_life()));
  perform pg_temp.record(134, 'G10 the row still exists', '1',
    (select count(*)::text from public.teams t where t.id = pg_temp.team_life()));

  -- THE POINT OF ALL OF IT: the reader who left months earlier still has their
  -- standing, after two account deletions and an archive.
  perform pg_temp.record(135, 'G11 the earlier leaver''s history survived every deletion', '1000',
    (select s.score_milli::text from public.team_member_edition_scores s
     where s.team_id = pg_temp.team_life()
       and s.user_id = pg_temp.uid_gone()
       and s.edition_date = pg_temp.ed('e1')));
end $$;

-- ---------------------------------------------------------------------------
-- H. The board, the statuses and the invite, read through RLS
-- ---------------------------------------------------------------------------
set local role authenticated;

do $$
declare
  v_row record;
  v_streak integer;
begin
  perform pg_temp.sign_in(pg_temp.uid_owner());

  -- team_three (section E) assigned 4 questions at E3. uid_owner answered none
  -- of them, uid_late is eligible, uid_leaver joined too late.
  perform pg_temp.record(140, 'H1 every active member appears, played or not', '3',
    (select count(*)::text
     from public.get_team_leaderboard(pg_temp.team_three(), 'edition', pg_temp.ed('e3'))));

  perform pg_temp.record(141, 'H2 a member who has not answered reads as not started',
    'not_started',
    (select l.status from public.get_team_leaderboard(pg_temp.team_three(), 'edition', pg_temp.ed('e3')) l
     where l.user_id = pg_temp.uid_late()));

  -- The mid-edition joiner is NOT a zero: they were never allowed to play.
  perform pg_temp.record(142, 'H3 a joiner who cannot score yet says so',
    'starts_next_edition',
    (select l.status from public.get_team_leaderboard(pg_temp.team_three(), 'edition', pg_temp.ed('e3')) l
     where l.user_id = pg_temp.uid_leaver()));

  perform pg_temp.record(143, 'H4 a zero-point member is still on the board', 'true',
    (select exists (
      select 1 from public.get_team_leaderboard(pg_temp.team_three(), 'edition', pg_temp.ed('e3')) l
      where l.user_id = pg_temp.uid_owner() and l.score_milli = 0))::text);

  -- Everyone is on 0, so everyone is 1st. Standard competition ranking.
  perform pg_temp.record(144, 'H5 a shared score is a shared rank', '1',
    (select count(distinct l.rank)::text
     from public.get_team_leaderboard(pg_temp.team_three(), 'edition', pg_temp.ed('e3')) l));

  -- In progress and completed, on a member with real counts.
  update public.team_member_edition_scores
  set answered_count = 1, score_milli = 600, completed = false
  where team_id = pg_temp.team_three()
    and user_id = pg_temp.uid_late()
    and edition_date = pg_temp.ed('e3');

  perform pg_temp.record(145, 'H6 some but not all reads as in progress', 'in_progress',
    (select l.status from public.get_team_leaderboard(pg_temp.team_three(), 'edition', pg_temp.ed('e3')) l
     where l.user_id = pg_temp.uid_late()));

  update public.team_member_edition_scores
  set answered_count = 4, score_milli = 2400, completed = true
  where team_id = pg_temp.team_three()
    and user_id = pg_temp.uid_late()
    and edition_date = pg_temp.ed('e3');

  perform pg_temp.record(146, 'H7 all of them reads as completed', 'completed',
    (select l.status from public.get_team_leaderboard(pg_temp.team_three(), 'edition', pg_temp.ed('e3')) l
     where l.user_id = pg_temp.uid_late()));

  perform pg_temp.record(147, 'H8 and the scorer ranks above the members on zero', '1',
    (select l.rank::text
     from public.get_team_leaderboard(pg_temp.team_three(), 'edition', pg_temp.ed('e3')) l
     where l.user_id = pg_temp.uid_late()));

  -- ---- the week does not depend on anybody's clock ------------------------
  -- The same call under two wildly different client timezones must agree: the
  -- boundary comes from edition dates cast to a timestamp with no zone at all.
  perform set_config('timezone', 'Pacific/Kiritimati', true);
  select l.score_milli into v_row
  from public.get_team_leaderboard(pg_temp.team_three(), 'week', pg_temp.ed('e3')) l
  where l.user_id = pg_temp.uid_late();

  perform set_config('timezone', 'Pacific/Niue', true);
  perform pg_temp.record(148, 'H9 This Week is the same on both sides of the date line', 'true',
    (v_row.score_milli = (
      select l.score_milli
      from public.get_team_leaderboard(pg_temp.team_three(), 'week', pg_temp.ed('e3')) l
      where l.user_id = pg_temp.uid_late()))::text);
  perform set_config('timezone', 'UTC', true);

  -- ---- streak --------------------------------------------------------------
  perform pg_temp.sign_in(pg_temp.uid_late());

  perform pg_temp.record(149, 'H10 a completed edition counts toward the streak', '1',
    public.team_member_edition_streak(pg_temp.team_three(), pg_temp.uid_late())::text);

  -- An edition the TEAM was assigned nothing in is neutral: it neither counts
  -- nor breaks. E1 and E2 have no team_three assignments at all.
  perform pg_temp.record(150, 'H11 an edition the team did not play is neutral', '1',
    public.team_member_edition_streak(pg_temp.team_three(), pg_temp.uid_late())::text);

  -- ---- the invite code is the owner's -------------------------------------
  begin
    perform * from public.get_team_invite_code(pg_temp.team_three());
    perform pg_temp.record(151, 'H12 a member cannot read the invite code', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(151, 'H12 a member cannot read the invite code', 'refused', 'refused');
  end;

  begin
    perform public.set_team_invite_open(pg_temp.team_three(), false);
    perform pg_temp.record(152, 'H13 a member cannot close the invite', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(152, 'H13 a member cannot close the invite', 'refused', 'refused');
  end;

  -- And the table itself is unreadable, so there is no way around the RPC.
  begin
    perform 1 from public.teams t where t.id = pg_temp.team_three();
    perform pg_temp.record(153, 'H14 members hold no SELECT on public.teams', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(153, 'H14 members hold no SELECT on public.teams', 'refused', 'refused');
  end;

  perform pg_temp.sign_in(pg_temp.uid_owner());

  perform pg_temp.record(154, 'H15 the owner can read it', 'TSUITE03',
    (select i.invite_code from public.get_team_invite_code(pg_temp.team_three()) i));

  perform pg_temp.record(155, 'H16 the owner can close it', 'false',
    (select public.set_team_invite_open(pg_temp.team_three(), false))::text);

  perform pg_temp.record(156, 'H16 and a closed invite is refused', 'refused',
    (select case when exists (
      select 1 from public.team_directory d
      where d.id = pg_temp.team_three() and d.invite_open
    ) then 'accepted' else 'refused' end));

  perform public.set_team_invite_open(pg_temp.team_three(), true);

  -- ---- a moderated name never reaches a client ----------------------------
  perform pg_temp.record(157, 'H17 the directory shows the name while it is active',
    'Teams suite alpha',
    (select d.display_name from public.team_directory d where d.id = pg_temp.team_three()));
end $$;

reset role;

-- Moderation, applied the way a moderator applies it: the stored name is left
-- exactly where it is and only its status changes.
update public.teams set name_status = 'hidden' where id = pg_temp.team_three();

set local role authenticated;

do $$
begin
  perform pg_temp.sign_in(pg_temp.uid_owner());

  perform pg_temp.record(158, 'H18 a hidden name is never returned by the directory', 'true',
    (select (d.display_name is null)::text
     from public.team_directory d where d.id = pg_temp.team_three()));

  perform pg_temp.record(159, 'H18 nor by the team detail RPC', 'true',
    (select (d.display_name is null and d.name_hidden)::text
     from public.get_team_detail(pg_temp.team_three()) d));

  perform pg_temp.record(160, 'H18 nor by the content badge RPC', '0',
    (select count(*)::text
     from public.get_my_team_refs_for_questions(
       pg_temp.ed('e3'),
       array(select a.logical_question_id from public.team_question_assignments a
             where a.team_id = pg_temp.team_three() and a.edition_date = pg_temp.ed('e3'))
     ) r
     where r.display_name is not null and r.team_id = pg_temp.team_three()));

  -- The stored value is untouched: moderation hides, it never destroys.
  perform pg_temp.record(161, 'H19 the name itself is hidden, not deleted', 'true',
    (select (d.name_status = 'hidden')::text
     from public.team_directory d where d.id = pg_temp.team_three()));

  -- ---- an archived team is closed for business ----------------------------
  perform pg_temp.sign_in(pg_temp.uid_outsider());

  begin
    perform * from public.join_team_with_invite('TSUITE05');
    perform pg_temp.record(162, 'H20 an archived team cannot be joined', 'refused', 'joined');
  exception when others then
    perform pg_temp.record(162, 'H20 an archived team cannot be joined', 'refused', 'refused');
  end;

  -- Its history is still there to inspect, which is the whole reason it was
  -- archived instead of deleted.
  --
  -- ONE row, not three, and the difference is the point. The two readers who
  -- deleted their accounts took their OWN rows with them — that is what account
  -- deletion is for, and the cascade from `profiles` does it. What survives is
  -- the row belonging to the reader who merely LEFT, who deleted nothing and is
  -- still using the product. The old DELETE FROM teams would have taken this
  -- row too.
  perform pg_temp.record(163, 'H20 the leaver''s row outlived two account deletions', '1',
    (select count(*)::text from public.team_member_edition_scores s
     where s.team_id = pg_temp.team_life()));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- I. The security pass (20260907140000)
-- ---------------------------------------------------------------------------
-- Everything below is written from the attacker's side: not "what does the app
-- send", but "what can a caller with a valid JWT and a rewritten binary send".
-- Each check corresponds to something that was possible before that migration.

set local role authenticated;

do $$
declare
  v_stolen text := pg_temp.uid_late()::text || '/stolen.jpg';
  v_mine   text := pg_temp.uid_owner()::text || '/mine.jpg';
begin
  perform pg_temp.sign_in(pg_temp.uid_owner());

  -- ---- avatar impersonation ------------------------------------------------
  -- Storage RLS governs which object you may WRITE. It says nothing about which
  -- object a profile may POINT AT, and that was the hole: a team-mate's path in
  -- your own row puts their face on your leaderboard entry, and the storage read
  -- policy allows the fetch because they are your team-mate.
  begin
    perform * from public.set_player_identity(null, null, v_stolen);
    perform pg_temp.record(164, 'I1 a team-mate''s avatar path is refused', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(164, 'I1 a team-mate''s avatar path is refused', 'refused', 'refused');
  end;

  perform pg_temp.record(165, 'I1 and the profile still holds the old value', 'true',
    (select (p.avatar_path is distinct from v_stolen)::text
     from public.profiles p where p.id = pg_temp.uid_owner()));

  -- The same call with the caller's own folder is the normal path and must work,
  -- or the check above proves nothing.
  perform * from public.set_player_identity(null, null, v_mine);

  perform pg_temp.record(166, 'I2 the caller''s own path is accepted', v_mine,
    (select p.avatar_path from public.profiles p where p.id = pg_temp.uid_owner()));

  -- A path carrying the bucket name is three segments, which avatar_object_owner
  -- returns NULL for, which makes every storage policy false.
  begin
    perform * from public.set_player_identity(null, null,
      'avatars/' || pg_temp.uid_owner()::text || '/prefixed.jpg');
    perform pg_temp.record(167, 'I3 a bucket-prefixed path is refused', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(167, 'I3 a bucket-prefixed path is refused', 'refused', 'refused');
  end;

  begin
    perform * from public.set_player_identity(null, null,
      'https://example.test/signed?token=abc');
    perform pg_temp.record(168, 'I3 a signed URL is refused', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(168, 'I3 a signed URL is refused', 'refused', 'refused');
  end;

  begin
    perform * from public.set_player_identity(null, null,
      pg_temp.uid_owner()::text || '/../' || pg_temp.uid_late()::text || '/x.jpg');
    perform pg_temp.record(169, 'I3 traversal is refused', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(169, 'I3 traversal is refused', 'refused', 'refused');
  end;

  -- ---- username moderation, server-side ------------------------------------
  begin
    perform * from public.set_player_identity('admin', null, null);
    perform pg_temp.record(170, 'I4 a reserved username is refused', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(170, 'I4 a reserved username is refused', 'refused', 'refused');
  end;

  -- Punctuated, so the normalisation is what is actually being tested.
  begin
    perform * from public.set_player_identity('a.d.m.i.n', null, null);
    perform pg_temp.record(171, 'I4 punctuation does not unlock it', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(171, 'I4 punctuation does not unlock it', 'refused', 'refused');
  end;

  perform pg_temp.record(172, 'I4 the probe agrees with the write', 'false',
    (select public.is_username_available('Admin'))::text);

  perform pg_temp.record(173, 'I4 and still says yes to an ordinary name', 'true',
    (select public.is_username_available('teamsuite_new'))::text);

  -- ---- team name moderation ------------------------------------------------
  begin
    perform * from public.create_team('The nazi club');
    perform pg_temp.record(174, 'I5 a disallowed team name is refused at create', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(174, 'I5 a disallowed team name is refused at create', 'refused', 'refused');
  end;

  begin
    perform public.rename_team(pg_temp.team_three(), 'The nazi club');
    perform pg_temp.record(175, 'I5 and at rename', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(175, 'I5 and at rename', 'refused', 'refused');
  end;

  -- ---- the private answer key ----------------------------------------------
  begin
    perform 1 from private.logical_question_grades g limit 1;
    perform pg_temp.record(176, 'I6 the grading schema is unreadable', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(176, 'I6 the grading schema is unreadable', 'refused', 'refused');
  end;

  begin
    perform 1 from private.logical_question_option_feedback f limit 1;
    perform pg_temp.record(177, 'I6 so is the explanation table', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(177, 'I6 so is the explanation table', 'refused', 'refused');
  end;

  -- Feedback before submitting IS the answer key.
  begin
    perform * from public.get_question_feedback(pg_temp.lq_unassigned());
    perform pg_temp.record(178, 'I7 feedback before submitting is refused', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(178, 'I7 feedback before submitting is refused', 'refused', 'refused');
  end;

  -- ---- scores are written by the server or not at all ----------------------
  begin
    insert into public.question_attempts
      (user_id, logical_question_id, edition_date, deadline_at, status, score_milli)
    values (pg_temp.uid_owner(), pg_temp.lq_unassigned(), pg_temp.ed('e1'),
            now() + interval '1 hour', 'submitted', 1000);
    perform pg_temp.record(179, 'I8 a hand-written attempt is refused', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(179, 'I8 a hand-written attempt is refused', 'refused', 'refused');
  end;

  begin
    update public.question_attempts set score_milli = 1000
    where user_id = pg_temp.uid_owner();
    perform pg_temp.record(180, 'I8 rewriting a score is refused', 'refused', 'updated');
  exception when others then
    perform pg_temp.record(180, 'I8 rewriting a score is refused', 'refused', 'refused');
  end;

  begin
    update public.question_attempts set deadline_at = now() + interval '1 day'
    where user_id = pg_temp.uid_owner();
    perform pg_temp.record(181, 'I8 extending the deadline is refused', 'refused', 'updated');
  exception when others then
    perform pg_temp.record(181, 'I8 extending the deadline is refused', 'refused', 'refused');
  end;

  begin
    delete from public.question_attempts where user_id = pg_temp.uid_owner();
    perform pg_temp.record(182, 'I8 deleting an attempt is refused', 'refused', 'deleted');
  exception when others then
    perform pg_temp.record(182, 'I8 deleting an attempt is refused', 'refused', 'refused');
  end;

  begin
    update public.team_member_edition_scores set score_milli = 9999
    where user_id = pg_temp.uid_owner();
    perform pg_temp.record(183, 'I9 rewriting a team score is refused', 'refused', 'updated');
  exception when others then
    perform pg_temp.record(183, 'I9 rewriting a team score is refused', 'refused', 'refused');
  end;

  begin
    insert into public.team_question_scores
      (team_id, user_id, logical_question_id, edition_date, score_milli)
    values (pg_temp.team_three(), pg_temp.uid_owner(), pg_temp.lq_unassigned(),
            pg_temp.ed('e3'), 1000);
    perform pg_temp.record(184, 'I9 inserting one is refused', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(184, 'I9 inserting one is refused', 'refused', 'refused');
  end;

  -- ---- a team-mate is a name, a country and a picture, not a row ----------
  perform pg_temp.record(185, 'I10 a team-mate''s profile row is unreadable', '0',
    (select count(*)::text from public.profiles p where p.id = pg_temp.uid_late()));

  -- Read from the function's declared result type, not from
  -- information_schema.columns: a FUNCTION has no rows there, so that query
  -- would have returned 0 whatever get_team_roster actually exposed.
  perform pg_temp.record(186, 'I10 and the roster carries no email', 'true',
    (select (position('email' in pg_get_function_result(p.oid)) = 0)::text
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_team_roster'));

  perform pg_temp.record(187, 'I10 while still naming them on the roster', 'true',
    (select (r.username is not null)::text
     from public.get_team_roster(pg_temp.team_three()) r
     where r.user_id = pg_temp.uid_late()));

  -- ---- reports cannot bury a queue ----------------------------------------
  insert into public.user_reports (reporter_id, reported_user_id, reason)
  values (pg_temp.uid_owner(), pg_temp.uid_late(), 'harassment');

  begin
    insert into public.user_reports (reporter_id, reported_user_id, reason)
    values (pg_temp.uid_owner(), pg_temp.uid_late(), 'harassment');
    perform pg_temp.record(188, 'I11 a duplicate open report is refused', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(188, 'I11 a duplicate open report is refused', 'refused', 'refused');
  end;

  -- A different reason is a different complaint and is still allowed.
  insert into public.user_reports (reporter_id, reported_user_id, reason)
  values (pg_temp.uid_owner(), pg_temp.uid_late(), 'inappropriate_username');

  perform pg_temp.record(189, 'I11 a different reason still gets through', '2',
    (select count(*)::text from public.user_reports r
     where r.reporter_id = pg_temp.uid_owner() and r.reported_user_id = pg_temp.uid_late()));

  -- Reporting a stranger you share nothing with was never allowed and still is
  -- not: the table would otherwise be an open channel to any account id.
  begin
    insert into public.user_reports (reporter_id, reported_user_id, reason)
    values (pg_temp.uid_owner(), pg_temp.uid_outsider(), 'harassment');
    perform pg_temp.record(190, 'I11 reporting a stranger is refused', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(190, 'I11 reporting a stranger is refused', 'refused', 'refused');
  end;

  -- Triage stays with the service role.
  begin
    update public.user_reports set status = 'dismissed'
    where reporter_id = pg_temp.uid_owner();
    perform pg_temp.record(191, 'I11 a reporter cannot triage their own report', 'refused', 'updated');
  exception when others then
    perform pg_temp.record(191, 'I11 a reporter cannot triage their own report', 'refused', 'refused');
  end;
end $$;

-- ---- storage: the object half of the same rule -----------------------------
-- Written as its own block because a failed INSERT aborts the enclosing
-- subtransaction, and these have to run whether or not the bucket exists here.

do $$
declare
  v_has_storage boolean := to_regclass('storage.objects') is not null;
begin
  if not v_has_storage then
    perform pg_temp.record(192, 'I12 storage is present to test', 'present', 'absent');
    return;
  end if;

  perform pg_temp.record(192, 'I12 storage is present to test', 'present', 'present');

  perform pg_temp.sign_in(pg_temp.uid_owner());

  -- THE POSITIVE CONTROL, and it is not optional. Every check below records
  -- 'refused' when the INSERT raises for ANY reason — a missing column default,
  -- a grant that was never made, a schema that moved. Without proof that the
  -- same statement succeeds for a legitimate path, three green denials would
  -- mean nothing at all.
  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', pg_temp.uid_owner()::text || '/control.jpg');
    perform pg_temp.record(193, 'I12 the caller can write their own object', 'inserted', 'inserted');
  exception when others then
    perform pg_temp.record(193, 'I12 the caller can write their own object', 'inserted', 'refused');
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', pg_temp.uid_late()::text || '/theirs.jpg');
    perform pg_temp.record(194, 'I12 writing into another folder is refused', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(194, 'I12 writing into another folder is refused', 'refused', 'refused');
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', 'flat.jpg');
    perform pg_temp.record(195, 'I12 an unownable flat path is refused', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(195, 'I12 an unownable flat path is refused', 'refused', 'refused');
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', 'avatars/' || pg_temp.uid_owner()::text || '/prefixed.jpg');
    perform pg_temp.record(196, 'I12 so is a bucket-prefixed one', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(196, 'I12 so is a bucket-prefixed one', 'refused', 'refused');
  end;
end $$;

reset role;

-- The victim's object, planted with definer rights so the denial checks below
-- have something real to fail against.
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.objects (bucket_id, name)
  values ('avatars', pg_temp.uid_late()::text || '/victim.jpg')
  on conflict do nothing;
end $$;

set local role authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    perform pg_temp.record(197, 'I13 another reader''s object cannot be deleted', 'skipped', 'skipped');
    perform pg_temp.record(198, 'I13 nor overwritten', 'skipped', 'skipped');
    return;
  end if;

  perform pg_temp.sign_in(pg_temp.uid_owner());

  delete from storage.objects
  where bucket_id = 'avatars' and name = pg_temp.uid_late()::text || '/victim.jpg';

  -- RLS makes this a no-op rather than an error: the row is simply not visible
  -- to the DELETE. Either way the object survives, which is what matters.
  perform pg_temp.record(197, 'I13 another reader''s object cannot be deleted', 'survives',
    (select case when exists (
      select 1 from storage.objects o
      where o.bucket_id = 'avatars' and o.name = pg_temp.uid_late()::text || '/victim.jpg'
    ) then 'survives' else 'gone' end));

  update storage.objects set name = pg_temp.uid_owner()::text || '/taken.jpg'
  where bucket_id = 'avatars' and name = pg_temp.uid_late()::text || '/victim.jpg';

  perform pg_temp.record(198, 'I13 nor overwritten', 'survives',
    (select case when exists (
      select 1 from storage.objects o
      where o.bucket_id = 'avatars' and o.name = pg_temp.uid_late()::text || '/victim.jpg'
    ) then 'survives' else 'gone' end));
end $$;

reset role;

-- Undo the plant: this suite rolls back, but leaving it out of the way keeps a
-- failure report readable.
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  delete from storage.objects
  where bucket_id = 'avatars'
    and name in (
      pg_temp.uid_late()::text || '/victim.jpg',
      pg_temp.uid_owner()::text || '/taken.jpg',
      pg_temp.uid_owner()::text || '/control.jpg'
    );
end $$;

set local role authenticated;

do $$
declare
  v_name text;
begin
  -- ---- a hidden team name does not come back through the join --------------
  -- team_three's name was hidden earlier in this suite. Every other read
  -- surface already resolved it; the join response returned it raw.
  perform pg_temp.sign_in(pg_temp.uid_outsider());

  select j.name into v_name from public.join_team_with_invite('TSUITE03') j;

  perform pg_temp.record(199, 'I14 joining does not reveal a hidden name', 'true',
    (v_name is null)::text);

  -- And joining still worked, so the check above is not passing by accident.
  perform pg_temp.record(200, 'I14 while the join itself succeeded', 'true',
    (select exists (
      select 1 from public.team_members m
      where m.team_id = pg_temp.team_three()
        and m.user_id = pg_temp.uid_outsider()
        and m.left_at is null
    ))::text);

  -- A fresh joiner is a member, so they may listen on the leaderboard channel
  -- even though they are not score-eligible until the next edition. That is
  -- correct: the channel carries a nudge, never a score.
  perform pg_temp.record(201, 'I15 a new member may listen on the team channel', 'true',
    (select public.can_read_team_topic(
      'team:' || pg_temp.team_three()::text || ':leaderboard'))::text);

  perform pg_temp.record(202, 'I15 and a malformed topic is false, not an error', 'false',
    (select public.can_read_team_topic('team:not-a-uuid:leaderboard'))::text);
end $$;

reset role;

-- Leaving must close the channel too: a former member keeps nothing.
set local role authenticated;

do $$
begin
  perform pg_temp.sign_in(pg_temp.uid_outsider());
  perform * from public.leave_team(pg_temp.team_three());

  perform pg_temp.record(203, 'I15 a former member is rejected by the channel', 'false',
    (select public.can_read_team_topic(
      'team:' || pg_temp.team_three()::text || ':leaderboard'))::text);

  perform pg_temp.record(204, 'I15 and the team vanishes from their directory', 'refused',
    (select case when exists (
      select 1 from public.team_directory d where d.id = pg_temp.team_three()
    ) then 'returned' else 'refused' end));

  begin
    perform * from public.get_team_invite_code(pg_temp.team_three());
    perform pg_temp.record(205, 'I15 and the invite code RPC refuses them', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(205, 'I15 and the invite code RPC refuses them', 'refused', 'refused');
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from team_results) as checks,
  (select count(*) from team_results where pass) as passed,
  (select count(*) from team_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from team_results where not pass) as failures;

rollback;
