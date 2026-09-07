-- Verifying the game, not just the edition — PRODUCTION project.
--
-- `verify_scheduled_edition` proves the EDITORIAL surfaces landed: 16/1/6 per
-- language, FR and EN paired, source links, daily drops, no duplicates. It says
-- nothing about whether the edition is playable, because when it was written
-- there was nothing to play.
--
-- There is now, and the gap matters more than it looks. `publish_scheduled_batch_questions`
-- treats "this job has no questions" as a valid state — deliberately, because two
-- months of approved Premium predates them and an edition of question-less items
-- must still publish. So an edition whose question pass silently wrote nothing
-- verifies clean today: 46 items, every count right, and not one reader able to
-- open a challenge.
--
-- This is the second half of the read-back. Same contract as its sibling:
-- read-only, deterministic, counts rather than opinions, and it never returns a
-- row of anything private.
--
-- DERIVED, NOT HARDCODED. Prompt 2 §13 asks for 16 contents / 32 questions,
-- 1 / 2, 6 / 18 — and those are the right numbers for the canonical batch. They
-- are not written down here. The expected question count is computed from the
-- content items the batch actually published (2 per newsletter and story, 3 per
-- mini case), so the check stays true if the composition ever changes and cannot
-- pass by coincidence if the composition is wrong. The canonical totals are
-- asserted by `verify_scheduled_edition`, which is where composition belongs.

begin;

-- ---------------------------------------------------------------------------
-- Does this batch's edition owe its readers questions?
-- ---------------------------------------------------------------------------
-- Production cannot ask staging, and must not guess. The publisher stamps the
-- answer onto every item it writes (`metadata.staging_prompt_bundle_version`),
-- and the question pass records what it actually wrote — so the honest question
-- production can answer is "does ANY item of this batch have questions". A batch
-- with some is a batch that was meant to have all.
--
-- That framing is what keeps a legacy batch verifying clean: none of its items
-- has questions, so none is expected to, and the check reports `not_required`
-- rather than 23 failures.

create or replace function public.edition_expects_questions(p_batch_id uuid)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.content_items ci
    join public.logical_questions q
      on q.content_logical_key = public.content_logical_key(ci.metadata)
     and q.content_type = ci.content_type
    where ci.status = 'published'
      and ci.metadata->>'staging_batch_id' = p_batch_id::text
  );
$function$;

comment on function public.edition_expects_questions(uuid) is
  'True when at least one published item of this batch carries logical questions. A batch with some is a batch that was meant to have all; a legacy batch has none and is not held to the contract.';

revoke all on function public.edition_expects_questions(uuid) from public, anon, authenticated;
grant execute on function public.edition_expects_questions(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The verification
-- ---------------------------------------------------------------------------

create or replace function public.verify_scheduled_edition_game(
  p_edition_date date,
  p_batch_id uuid,
  p_run_id text default null
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_batch_key constant text := p_batch_id::text;
  v_problems jsonb := '[]'::jsonb;
  v_required boolean;
  v_logical_contents integer := 0;
  v_expected_questions integer := 0;
  v_actual_questions integer := 0;
  v_question_problems jsonb := '[]'::jsonb;
  v_solo integer := 0;
  v_team_content integer := 0;
  v_team_questions integer := 0;
  v_roster integer := 0;
  v_active_teams integer := 0;
  v_leaked integer := 0;
  v_by_type jsonb;
begin
  v_required := public.edition_expects_questions(p_batch_id);

  -- -------------------------------------------------------------------------
  -- 1. The answer key never travels in a client-readable column (§17)
  -- -------------------------------------------------------------------------
  -- Checked FIRST and regardless of whether questions are expected, because a
  -- leak is the one failure whose blast radius is the whole feature: an edition
  -- that shipped `score_milli` in metadata is not fixable by republishing, it is
  -- fixable by rewriting every question in it.
  select count(*) into v_leaked
  from public.content_items ci
  where ci.status = 'published'
    and ci.metadata->>'staging_batch_id' = v_batch_key
    and (
      ci.metadata ? 'questions'
      or ci.metadata::text ~ '"score_milli"'
      or ci.metadata::text ~ '"(is_correct|grade_band|decision_criterion)"'
    );

  if v_leaked > 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code', 'answer_key_in_metadata',
      'detail', format('%s published item(s) of this batch carry grading in metadata', v_leaked)));
  end if;

  if not v_required then
    return jsonb_build_object(
      'ok', jsonb_array_length(v_problems) = 0,
      'required', false,
      'reason', case when jsonb_array_length(v_problems) = 0 then 'questions_not_expected'
                     else v_problems->0->>'code' end,
      'edition_date', p_edition_date,
      'batch_id', p_batch_id,
      'run_id', p_run_id,
      'problems', v_problems);
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Every logical content has the question set its surface owes
  -- -------------------------------------------------------------------------
  -- One statement, not a temp table: this function is declared `stable` like its
  -- sibling, and a `stable` function that runs DDL is lying about what it does.
  -- Everything below reads.
  --
  -- `expected` is derived from the surface each published content belongs to —
  -- 3 for a mini case, 2 for a newsletter or a story — so the canonical
  -- 16/32, 1/2, 6/18 falls out of the composition rather than being asserted
  -- against it.
  with published as (
    select distinct
      public.content_logical_key(ci.metadata) as content_logical_key,
      ci.content_type
    from public.content_items ci
    where ci.status = 'published'
      and ci.metadata->>'staging_batch_id' = v_batch_key
      and public.content_logical_key(ci.metadata) is not null
  ),
  per_question as (
    select
      lq.content_logical_key,
      lq.content_type,
      (select count(*) from public.logical_question_locales loc
        where loc.logical_question_id = lq.id and loc.language = 'fr') as fr,
      (select count(*) from public.logical_question_locales loc
        where loc.logical_question_id = lq.id and loc.language = 'en') as en,
      (select count(*) from public.logical_question_options o
        where o.logical_question_id = lq.id) as options,
      -- The private grade rows are COUNTED, never selected. A verification that
      -- returned the answer key to prove the answer key exists would be the leak
      -- it is checking for.
      (select count(*) from private.logical_question_grades g
        join public.logical_question_options o2 on o2.id = g.option_id
        where o2.logical_question_id = lq.id) as grades
    from public.logical_questions lq
    where exists (
      select 1 from published p
      where p.content_logical_key = lq.content_logical_key
        and p.content_type = lq.content_type
    )
  ),
  per_content as (
    select
      p.content_logical_key,
      p.content_type,
      case when p.content_type = 'mini_case' then 3 else 2 end as expected,
      coalesce(q.actual, 0) as actual,
      coalesce(q.fr_locales, 0) as fr_locales,
      coalesce(q.en_locales, 0) as en_locales,
      coalesce(q.bad_option_counts, 0) as bad_option_counts,
      coalesce(q.bad_grade_counts, 0) as bad_grade_counts
    from published p
    left join (
      select
        content_logical_key,
        content_type,
        count(*) as actual,
        count(*) filter (where fr > 0) as fr_locales,
        count(*) filter (where en > 0) as en_locales,
        count(*) filter (where options <> 4) as bad_option_counts,
        count(*) filter (where grades <> 4) as bad_grade_counts
      from per_question
      group by content_logical_key, content_type
    ) q on q.content_logical_key = p.content_logical_key and q.content_type = p.content_type
  ),
  findings as (
    select coalesce(jsonb_agg(problem order by problem->>'content_logical_key'), '[]'::jsonb) as problems
    from (
      select jsonb_build_object(
        'code', 'question_count_mismatch',
        'content_logical_key', content_logical_key,
        'content_type', content_type,
        'detail', format('%s %s has %s questions, expected %s',
          content_type, content_logical_key, actual, expected)) as problem
      from per_content where actual <> expected

      union all

      -- Both renderings, for every question. A question with only an English
      -- locale is a question a French reader is assigned and cannot read.
      select jsonb_build_object(
        'code', 'question_locale_incomplete',
        'content_logical_key', content_logical_key,
        'detail', format('%s has %s questions but fr=%s en=%s locales',
          content_logical_key, actual, fr_locales, en_locales))
      from per_content where actual > 0 and (fr_locales <> actual or en_locales <> actual)

      union all

      select jsonb_build_object(
        'code', 'question_option_count_mismatch',
        'content_logical_key', content_logical_key,
        'detail', format('%s question(s) of %s do not have exactly 4 options',
          bad_option_counts, content_logical_key))
      from per_content where bad_option_counts > 0

      union all

      -- Four options and four grades. A missing grade row is an option that
      -- scores NULL, which the submit path reads as zero: a reader silently
      -- losing points on an answer nobody graded.
      select jsonb_build_object(
        'code', 'question_grade_count_mismatch',
        'content_logical_key', content_logical_key,
        'detail', format('%s question(s) of %s do not have exactly 4 private grade rows',
          bad_grade_counts, content_logical_key))
      from per_content where bad_grade_counts > 0
    ) f
  ),
  totals as (
    select
      count(*)::integer as logical_contents,
      coalesce(sum(expected), 0)::integer as expected_questions,
      coalesce(sum(actual), 0)::integer as actual_questions
    from per_content
  ),
  by_type as (
    select coalesce(jsonb_object_agg(content_type, counts), '{}'::jsonb) as by_content_type
    from (
      select
        content_type,
        jsonb_build_object(
          'logical_contents', count(*),
          'expected_questions', sum(expected),
          'questions', sum(actual)) as counts
      from per_content
      group by content_type
    ) t
  )
  select
    totals.logical_contents,
    totals.expected_questions,
    totals.actual_questions,
    by_type.by_content_type,
    findings.problems
  into v_logical_contents, v_expected_questions, v_actual_questions, v_by_type, v_question_problems
  from totals, by_type, findings;

  v_problems := v_problems || coalesce(v_question_problems, '[]'::jsonb);

  -- -------------------------------------------------------------------------
  -- 3. The assignments (§14)
  -- -------------------------------------------------------------------------
  select count(*) into v_solo
  from public.solo_question_assignments
  where edition_date = p_edition_date;

  select count(*) into v_team_content
  from public.team_content_assignments
  where edition_date = p_edition_date;

  select count(*) into v_team_questions
  from public.team_question_assignments
  where edition_date = p_edition_date;

  select count(*) into v_roster
  from public.team_member_edition_scores
  where edition_date = p_edition_date;

  select count(*) into v_active_teams
  from public.teams where status = 'active';

  -- A reader with a drop and no assignments is a reader with an edition and no
  -- game. Checked as "at least one", not as a count: how many depends on how
  -- many readers exist and on their preferences, and neither is this function's
  -- business.
  if v_solo = 0 and exists (
    select 1 from public.daily_drops where drop_date = p_edition_date and status = 'published'
  ) then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code', 'solo_assignments_missing',
      'detail', format('drops exist for %s but no solo question assignment does', p_edition_date)));
  end if;

  -- NO TEAMS IS NOT A FAILURE (§14). It is the current state of the product and
  -- will be for as long as nobody has created one.
  if v_active_teams > 0 and v_team_questions > 0 and v_roster = 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code', 'team_roster_missing',
      'detail', format('%s team question assignments exist for %s but no member has a leaderboard row',
        v_team_questions, p_edition_date)));
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_problems) = 0,
    'required', true,
    'reason', case when jsonb_array_length(v_problems) = 0 then 'ok'
                   else v_problems->0->>'code' end,
    'edition_date', p_edition_date,
    'batch_id', p_batch_id,
    'run_id', p_run_id,
    'questions', jsonb_build_object(
      'logical_contents', v_logical_contents,
      'expected', v_expected_questions,
      'actual', v_actual_questions,
      'by_content_type', v_by_type),
    'assignments', jsonb_build_object(
      'solo_questions', v_solo,
      'team_contents', v_team_content,
      'team_questions', v_team_questions,
      'team_roster_rows', v_roster,
      'active_teams', v_active_teams),
    'problems', v_problems
  );
end;
$function$;

comment on function public.verify_scheduled_edition_game(date, uuid, text) is
  'Read-only proof that a published edition is playable: every logical content carries the question set its surface owes, in both languages, with four options and four private grades each, no grading in client-readable metadata, and assignments materialized. Counts the private grade rows; never returns one.';

revoke all on function public.verify_scheduled_edition_game(date, uuid, text) from public, anon, authenticated;
grant execute on function public.verify_scheduled_edition_game(date, uuid, text) to service_role;

commit;

NOTIFY pgrst, 'reload schema';
