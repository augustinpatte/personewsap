-- Verification held to the DECLARED contract — PRODUCTION project.
--
-- 20260907180000 made the requirement a declaration. This is the other half:
-- the read-back that acts on it, and that checks the whole contract rather than
-- the counts alone.
--
-- WHAT CHANGES, AND WHY EACH ONE IS A FAILURE THAT COULD REACH A READER.
--
--   the requirement now comes from `edition_question_contract`, so a batch that
--   declared questions and persisted none reports `questions_missing_entirely`
--   and can never again report `questions_not_expected`;
--
--   `declaration_missing` and `inconsistent` are failures in their own right. An
--   edition nobody can classify is not an edition anybody may write a receipt
--   for;
--
--   ROLES are checked. A mini case whose three questions are not
--   method_framework / technical_application / conclusion_decision is not a
--   mini case, it is three questions in a row;
--
--   TIERS are checked, as a set, per question. Two options worth 1000 and no 300
--   is not a scored question: two readers who reasoned differently score the
--   same, and the leaderboard stops being comparable;
--
--   OPTION LOCALES are checked. An option with an English label and no French
--   one is an option a French reader is shown blank, mid-competition.
--
-- Counts, never contents. `private.logical_question_grades` is aggregated and
-- not one row of it is returned — a verification that proved the answer key
-- exists by showing it would be the leak it checks for.
--
-- The composition assertions (16/1/6) stay in `verify_scheduled_edition`, which
-- is where composition belongs. Everything here is derived from what the batch
-- actually published.

begin;

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
  c_case_roles constant text[] := array['method_framework', 'technical_application', 'conclusion_decision'];
  c_reading_roles constant text[] := array['interpretation', 'application_decision'];
  c_tiers constant integer[] := array[0, 300, 600, 1000];
  v_batch_key constant text := p_batch_id::text;
  v_problems jsonb := '[]'::jsonb;
  v_contract jsonb;
  v_state text;
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
  -- THE REQUIREMENT IS READ, NOT INFERRED. See 20260907180000.
  v_contract := public.edition_question_contract(p_batch_id);
  v_state := v_contract->>'state';

  -- -------------------------------------------------------------------------
  -- 1. The answer key never travels in a client-readable column (§17)
  -- -------------------------------------------------------------------------
  -- Checked FIRST and whatever the contract says, because a leak is the one
  -- failure whose blast radius is the whole feature: an edition that shipped
  -- `score_milli` in metadata is not fixable by republishing, it is fixable by
  -- rewriting every question in it.
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

  -- -------------------------------------------------------------------------
  -- 2. A contract nobody can read is a failure, not a legacy edition
  -- -------------------------------------------------------------------------
  if v_state in ('declaration_missing', 'inconsistent') then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code', case v_state
                when 'declaration_missing' then 'contract_declaration_missing'
                else 'contract_declaration_inconsistent' end,
      'detail', case v_state
        when 'declaration_missing' then format(
          '%s published item(s) of this batch were written by a contract-aware publisher from a payload that declared nothing',
          v_contract->>'undeclared')
        else format(
          'this batch mixes declarations: %s required, %s not required, %s pre-contract',
          v_contract->>'declared_required', v_contract->>'declared_not_required',
          v_contract->>'historical') end));

    return jsonb_build_object(
      'ok', false,
      'required', true,
      'reason', v_problems->0->>'code',
      'edition_date', p_edition_date,
      'batch_id', p_batch_id,
      'run_id', p_run_id,
      'contract', v_contract,
      'problems', v_problems);
  end if;

  if v_state <> 'required' then
    -- Genuinely legacy: every item either predates the contract or was
    -- explicitly declared not to carry questions.
    return jsonb_build_object(
      'ok', jsonb_array_length(v_problems) = 0,
      'required', false,
      'reason', case when jsonb_array_length(v_problems) = 0 then 'questions_not_expected'
                     else v_problems->0->>'code' end,
      'edition_date', p_edition_date,
      'batch_id', p_batch_id,
      'run_id', p_run_id,
      'contract', v_contract,
      'problems', v_problems);
  end if;

  -- -------------------------------------------------------------------------
  -- 3. Every logical content has the question set its surface owes
  -- -------------------------------------------------------------------------
  -- One statement, not a temp table: this function is declared `stable` like its
  -- sibling, and a `stable` function that runs DDL is lying about what it does.
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
      lq.question_sequence,
      lq.question_role,
      (select count(*) from public.logical_question_locales loc
        where loc.logical_question_id = lq.id and loc.language = 'fr') as fr,
      (select count(*) from public.logical_question_locales loc
        where loc.logical_question_id = lq.id and loc.language = 'en') as en,
      (select count(*) from public.logical_question_options o
        where o.logical_question_id = lq.id) as options,
      -- Every option carries a label in BOTH languages. Counted per question:
      -- four options, eight option-locale rows, four fr and four en.
      (select count(*) from public.logical_question_options o
        join public.logical_question_option_locales ol on ol.option_id = o.id
        where o.logical_question_id = lq.id and ol.language = 'fr') as fr_labels,
      (select count(*) from public.logical_question_options o
        join public.logical_question_option_locales ol on ol.option_id = o.id
        where o.logical_question_id = lq.id and ol.language = 'en') as en_labels,
      -- The private grade rows are COUNTED, never selected.
      (select count(*) from private.logical_question_grades g
        join public.logical_question_options o2 on o2.id = g.option_id
        where o2.logical_question_id = lq.id) as grades,
      -- The TIER SET, as a sorted distinct array. `array_agg(distinct …)`
      -- collapses a duplicated tier and keeps whatever an invented score was, so
      -- one comparison catches a missing tier, a repeated tier and a 750 at once.
      (select coalesce(array_agg(distinct g.score_milli order by g.score_milli), array[]::integer[])
        from private.logical_question_grades g
        join public.logical_question_options o3 on o3.id = g.option_id
        where o3.logical_question_id = lq.id) as tiers
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
      coalesce(q.bad_grade_counts, 0) as bad_grade_counts,
      coalesce(q.bad_roles, 0) as bad_roles,
      coalesce(q.bad_tier_sets, 0) as bad_tier_sets,
      coalesce(q.bad_option_locales, 0) as bad_option_locales
    from published p
    left join (
      select
        content_logical_key,
        content_type,
        count(*) as actual,
        count(*) filter (where fr > 0) as fr_locales,
        count(*) filter (where en > 0) as en_locales,
        count(*) filter (where options <> 4) as bad_option_counts,
        count(*) filter (where grades <> 4) as bad_grade_counts,
        count(*) filter (
          where question_sequence < 1
             or question_sequence > (case when content_type = 'mini_case' then 3 else 2 end)
             or (content_type = 'mini_case'
                 and question_role is distinct from c_case_roles[question_sequence])
             or (content_type <> 'mini_case'
                 and question_role is distinct from c_reading_roles[question_sequence])
        ) as bad_roles,
        count(*) filter (where tiers is distinct from c_tiers) as bad_tier_sets,
        count(*) filter (where fr_labels <> 4 or en_labels <> 4) as bad_option_locales
      from per_question
      group by content_logical_key, content_type
    ) q on q.content_logical_key = p.content_logical_key and q.content_type = p.content_type
  ),
  findings as (
    -- ORDERED, AND DELIBERATELY SO. `reason` is the single line an operator
    -- reads off a failed receipt at 19:05, and it is `problems->0`. One broken
    -- question usually trips several checks at once — three options is also
    -- three grades and also a hole in the tier set — so without an explicit
    -- order the headline reason is whichever row the planner happened to return
    -- first, and the same failure reports differently on two runs.
    --
    -- The order is most-fundamental-first: what is missing, then how many, then
    -- how it is shaped, then how it is graded. A reader loses a question before
    -- they lose a tier.
    select coalesce(jsonb_agg(problem order by
      problem->>'content_logical_key',
      case problem->>'code'
        when 'questions_missing_entirely'         then 1
        when 'question_count_mismatch'            then 2
        when 'question_option_count_mismatch'     then 3
        when 'question_locale_incomplete'         then 4
        when 'question_option_locale_incomplete'  then 5
        when 'question_grade_count_mismatch'      then 6
        when 'question_score_tier_set_invalid'    then 7
        when 'question_role_invalid'              then 8
        else 9
      end), '[]'::jsonb) as problems
    from (
      -- ZERO IS THE CASE THIS WHOLE MIGRATION EXISTS FOR, and it gets its own
      -- code so an operator reading the receipt at 19:05 sees "the question
      -- stage wrote nothing" rather than an arithmetic mismatch.
      select jsonb_build_object(
        'code', 'questions_missing_entirely',
        'content_logical_key', content_logical_key,
        'content_type', content_type,
        'detail', format('%s %s declared scored questions and has none',
          content_type, content_logical_key)) as problem
      from per_content where actual = 0

      union all

      select jsonb_build_object(
        'code', 'question_count_mismatch',
        'content_logical_key', content_logical_key,
        'content_type', content_type,
        'detail', format('%s %s has %s questions, expected %s',
          content_type, content_logical_key, actual, expected))
      from per_content where actual > 0 and actual <> expected

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
        'code', 'question_role_invalid',
        'content_logical_key', content_logical_key,
        'content_type', content_type,
        'detail', format('%s question(s) of %s carry the wrong role for their position',
          bad_roles, content_logical_key))
      from per_content where bad_roles > 0

      union all

      select jsonb_build_object(
        'code', 'question_option_count_mismatch',
        'content_logical_key', content_logical_key,
        'detail', format('%s question(s) of %s do not have exactly 4 options',
          bad_option_counts, content_logical_key))
      from per_content where bad_option_counts > 0

      union all

      select jsonb_build_object(
        'code', 'question_option_locale_incomplete',
        'content_logical_key', content_logical_key,
        'detail', format('%s question(s) of %s have an option without both a fr and an en label',
          bad_option_locales, content_logical_key))
      from per_content where bad_option_locales > 0

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

      union all

      select jsonb_build_object(
        'code', 'question_score_tier_set_invalid',
        'content_logical_key', content_logical_key,
        'detail', format('%s question(s) of %s are not graded exactly 0/300/600/1000',
          bad_tier_sets, content_logical_key))
      from per_content where bad_tier_sets > 0
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

  -- A questions-required batch that published no logical content at all would
  -- otherwise produce an empty findings set and pass. It cannot: the editorial
  -- verification would already have failed, but this half must not be the one
  -- that says yes.
  if v_logical_contents = 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code', 'no_logical_content_published',
      'detail', format('batch %s declared scored questions and published no keyed content', p_batch_id)));
  end if;

  -- -------------------------------------------------------------------------
  -- 4. The assignments (§14)
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
    'contract', v_contract,
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
  'Read-only proof that a published edition is playable, held to the contract the edition DECLARED. A batch that declared scored questions and persisted none fails with questions_missing_entirely and can never report questions_not_expected. Checks counts, roles, both prompt locales, four options with both label locales, four private grades, and the exact 0/300/600/1000 tier set — counting the private rows, never returning one.';

revoke all on function public.verify_scheduled_edition_game(date, uuid, text) from public, anon, authenticated;
grant execute on function public.verify_scheduled_edition_game(date, uuid, text) to service_role;

commit;

NOTIFY pgrst, 'reload schema';
