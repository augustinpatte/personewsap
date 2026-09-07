-- Scored questions in the staging preflight — STAGING project (kukyotcgbnchsoeriqoz).
--
-- THE GAP THIS CLOSES.
--
-- `assert_edition_publishable` re-runs `validate_generation_output` on the stored
-- bytes of all 23 jobs before an edition may publish, and that check knows
-- nothing about questions. So an edition whose generators emitted no questions at
-- all — or two questions with three options, or a French half graded differently
-- from the English one — passes the hard gate, publishes, and arrives in
-- production as an edition whose game does not work. The failure is silent by
-- construction: `publish_scheduled_batch_questions` treats "no questions" as a
-- valid state (two months of approved Premium predates them), so nothing raises.
--
-- The preflight is the only place this can be caught while it is still cheap.
-- After publication the article is live and a missing question set means a
-- reader opening a challenge that does not exist.
--
-- WHY THIS IS ADDITIVE AND NOT A REWRITE OF `validate_generation_output`.
--
-- That function was applied directly to the staging project and has no file in
-- this repository — it is one of the 30 migrations `npm run supabase:migration-check`
-- reports as orphaned. Replacing it here would mean writing it from memory, and
-- getting one of its word-count or schema rules subtly wrong would reject every
-- correct article at 19:00 with no way to tell why. So the question contract is
-- its own validator, and the gate calls both. The editorial checks keep the
-- definition production already trusts; the question checks are added beside
-- them.
--
-- WHAT IS ENFORCED (Prompt 2 §3), per job, on the stored output bytes:
--
--   newsletter_article   2 questions   interpretation, application_decision
--   business_story       2 questions   interpretation, application_decision
--   mini_case            3 questions   method_framework, technical_application,
--                                      conclusion_decision
--
--   every question:  4 options, ids unique and non-empty, texts non-empty and
--                    not repeated, exactly one option per tier 0/300/600/1000,
--                    a feedback line per option, and the five rationale fields
--                    the Reviewer needs in order to be able to disagree.
--
--   FR/EN parity:    same question ids in the same order, same roles, same
--                    option ids, same tier per option id — and DIFFERENT wording,
--                    because a French option that is byte-identical to the
--                    English one was copied, not written.
--
-- This mirrors services/content-engine/src/generation/gradedQuestions.ts. Two
-- implementations of one contract is a real cost; it is paid deliberately,
-- because the generator needs the rule before it writes and the gate needs it
-- after, and a gate that trusted the generator's own verdict would not be a gate.

begin;

-- ---------------------------------------------------------------------------
-- 1. The contract, as data
-- ---------------------------------------------------------------------------
-- Served to the Scheduled Tasks through the bridge, so the generators and the
-- gate read the same object rather than two prose descriptions that drift. A
-- markdown file in services/content-engine/prompts is not reachable by a
-- ChatGPT Scheduled Task; this is.

create or replace function public.scored_question_contract()
returns jsonb
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'version', 'scored-questions-v1',
    'score_tiers', jsonb_build_array(0, 300, 600, 1000),
    'options_per_question', 4,
    'time_limit_seconds', 20,
    'question_counts', jsonb_build_object(
      'newsletter_article', 2,
      'business_story', 2,
      'mini_case', 3),
    'roles', jsonb_build_object(
      'newsletter_article', jsonb_build_array('interpretation', 'application_decision'),
      'business_story', jsonb_build_array('interpretation', 'application_decision'),
      'mini_case', jsonb_build_array(
        'method_framework', 'technical_application', 'conclusion_decision')),
    'question_shape', jsonb_build_object(
      'id', 'stable across fr and en',
      'role', 'from roles[content_type], in order',
      'question', 'the prompt the reader sees',
      'rationale', jsonb_build_array(
        'decision_criterion', 'excellent_reason', 'good_limitation',
        'average_limitation', 'bad_failure'),
      'options', 'exactly 4: {id, text, score_milli, feedback}'),
    'parity', jsonb_build_array(
      'same question ids, in the same order',
      'same roles',
      'same option ids per question',
      'same score_milli for the same option id',
      'different wording: an identical fr/en option was copied, not written'),
    'privacy', jsonb_build_array(
      'rationale is internal and never reaches a client',
      'feedback is released only after the reader submits or times out',
      'score_milli never appears in content metadata'),
    'review_scopes', jsonb_build_array(
      'content', 'question_1', 'question_2', 'question_3'),
    'max_attempts', 3,
    'attempt_policy', jsonb_build_array(
      'attempts 1 and 2: revision_required, targeted at the failing scopes only',
      'a question defect never triggers a rewrite of an approved article',
      'attempt 3, content failing: failed. There is no attempt 4',
      'attempt 3, only a local question defect: the reviewer repairs it, revalidates, approves',
      'attempt 3, hallucination / grounding / safety / irreparable ambiguity: failed, never forced through')
  );
$function$;

comment on function public.scored_question_contract() is
  'The scored-question contract as data, served to the Scheduled Tasks through the bridge so the generators, the reviewer and this gate read one definition rather than three prose copies.';

-- ---------------------------------------------------------------------------
-- 2. Which batches must carry questions (§4)
-- ---------------------------------------------------------------------------
-- Historic material stays valid forever. A batch published in July had no
-- question contract to fail, and retroactively invalidating it would mean the
-- gate refusing to explain editions that are already live.
--
-- The distinction is an explicit declaration, never "the field happens to be
-- absent" — absence is exactly what a broken new generator produces, and a gate
-- that read absence as "legacy" would wave through the failure it exists to
-- catch. Three sources, most specific first:
--
--   1. the batch says so             metadata.scored_questions = true | false
--   2. the prompt bundle says so     prompt_bundle_version contains the version
--   3. otherwise, the calendar        edition_date >= the cutover
--
-- (3) is what makes the requirement automatic for everything new: a batch that
-- declares nothing and is dated after the cutover must carry questions. (1) is
-- the escape hatch for a deliberate one-off, and it is a written decision in a
-- row rather than a silence.

create or replace function public.scored_question_cutover_edition()
returns date
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    nullif(current_setting('app.scored_question_cutover_edition', true), '')::date,
    -- The first edition expected to ship with the contract. Movable without a
    -- migration (ALTER DATABASE ... SET app.scored_question_cutover_edition)
    -- because the date the generators are actually ready is an operational fact,
    -- not a schema one.
    date '2026-09-09'
  );
$function$;

comment on function public.scored_question_cutover_edition() is
  'First edition date required to carry scored questions. Override with the app.scored_question_cutover_edition setting; editions before it are legacy and are never retroactively invalidated.';

create or replace function public.batch_requires_scored_questions(p_batch_id uuid)
returns boolean
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_batch public.automation_batches%rowtype;
  v_declared text;
begin
  select * into v_batch from public.automation_batches where id = p_batch_id;

  if not found then
    return false;
  end if;

  v_declared := lower(btrim(coalesce(v_batch.metadata->>'scored_questions', '')));

  if v_declared in ('true', 't', 'yes', '1') then
    return true;
  end if;

  if v_declared in ('false', 'f', 'no', '0') then
    return false;
  end if;

  if coalesce(v_batch.prompt_bundle_version, '') ilike '%scored-questions%' then
    return true;
  end if;

  return v_batch.edition_date >= public.scored_question_cutover_edition();
end;
$function$;

comment on function public.batch_requires_scored_questions(uuid) is
  'True when a batch must carry the scored-question contract: it declared so, its prompt bundle names the contract, or its edition falls on or after the cutover. Legacy batches stay publishable exactly as they were.';

-- ---------------------------------------------------------------------------
-- 3. One option's tier, or nothing
-- ---------------------------------------------------------------------------
-- A scalar helper rather than an inline cast: `(o->>'score_milli')::integer`
-- raises 22P02 on "1000 " or "high", and a preflight that throws instead of
-- reporting is a preflight nobody can diagnose at 19:05.

create or replace function public.scored_question_tier(p_option jsonb)
returns integer
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when p_option->>'score_milli' ~ '^(0|300|600|1000)$'
      then (p_option->>'score_milli')::integer
    else null
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. The validator
-- ---------------------------------------------------------------------------

create or replace function public.validate_generation_questions(
  p_job_id uuid,
  p_output_json jsonb
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_reading_roles constant text[] := array['interpretation', 'application_decision'];
  c_case_roles constant text[] := array['method_framework', 'technical_application', 'conclusion_decision'];
  c_tiers constant integer[] := array[0, 300, 600, 1000];
  c_rationale_keys constant text[] := array[
    'decision_criterion', 'excellent_reason', 'good_limitation', 'average_limitation', 'bad_failure'];
  c_feedback_max constant integer := 320;

  v_job public.generation_jobs%rowtype;
  v_roles text[];
  v_expected integer;
  v_errors jsonb := '[]'::jsonb;
  v_lang text;
  v_questions jsonb;
  v_question jsonb;
  v_index integer;
  v_tiers integer[];
  v_option_ids text[];
  v_option_texts text[];
  v_key text;
  v_fr jsonb;
  v_en jsonb;
  v_fr_q jsonb;
  v_en_q jsonb;
  v_fr_option jsonb;
  v_en_option jsonb;
  v_option_id text;
begin
  select * into v_job from public.generation_jobs where id = p_job_id;

  if not found then
    return jsonb_build_object('valid', false, 'errors', jsonb_build_array(jsonb_build_object(
      'code', 'job_not_found', 'detail', format('no generation job %s', p_job_id))));
  end if;

  v_roles := case when v_job.content_type = 'mini_case' then c_case_roles else c_reading_roles end;
  v_expected := array_length(v_roles, 1);

  -- ---- per language, structural ------------------------------------------
  foreach v_lang in array array['fr', 'en']
  loop
    v_questions := p_output_json->v_lang->'questions';

    if jsonb_typeof(v_questions) <> 'array' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'questions_missing', 'language', v_lang,
        'detail', format('%s carries no questions array', v_lang)));
      continue;
    end if;

    if jsonb_array_length(v_questions) <> v_expected then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'question_count_invalid', 'language', v_lang,
        'detail', format('%s has %s questions, %s needs %s',
          v_lang, jsonb_array_length(v_questions), v_job.content_type, v_expected)));
      continue;
    end if;

    for v_index in 1 .. v_expected
    loop
      v_question := v_questions->(v_index - 1);

      if coalesce(v_question->>'id', '') = '' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_id_missing', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s has no id, so parity cannot be checked', v_lang, v_index)));
      end if;

      -- The role is pinned to the position. For a mini case that ordering IS the
      -- exercise — method, then application, then decision — and production's
      -- logical_questions check enforces the same thing, so a mismatch here
      -- would publish and then fail at persistence.
      if coalesce(v_question->>'role', '') <> v_roles[v_index] then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_role_invalid', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s is role %s, expected %s',
            v_lang, v_index, coalesce(v_question->>'role', '<none>'), v_roles[v_index])));
      end if;

      if length(btrim(coalesce(v_question->>'question', ''))) < 12 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_prompt_missing', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s has no usable prompt', v_lang, v_index)));
      end if;

      -- The rationale is what the Reviewer disagrees with. Without it a ranking
      -- is an assertion, and a question whose ranking cannot be defended is one
      -- a reader will experience as arbitrary the first time they lose points.
      foreach v_key in array c_rationale_keys
      loop
        if length(btrim(coalesce(v_question->'rationale'->>v_key, ''))) < 12 then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'code', 'question_rationale_incomplete', 'language', v_lang, 'question', v_index,
            'field', v_key,
            'detail', format('%s question %s rationale.%s is missing or too short',
              v_lang, v_index, v_key)));
        end if;
      end loop;

      if jsonb_typeof(v_question->'options') <> 'array'
         or jsonb_array_length(v_question->'options') <> 4 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_option_count_invalid', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s must have exactly 4 options', v_lang, v_index)));
        continue;
      end if;

      -- Exactly one option per tier. `array_agg(distinct ...)` collapses a
      -- duplicated tier and keeps a NULL for anything that is not one of the
      -- four, so a single comparison catches a missing tier, a repeated tier and
      -- an invented score at once.
      select coalesce(array_agg(distinct public.scored_question_tier(o)
                                order by public.scored_question_tier(o)), array[]::integer[])
      into v_tiers
      from jsonb_array_elements(v_question->'options') o;

      if v_tiers is distinct from c_tiers then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_score_tier_set_invalid', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s tiers are %s, expected exactly 0/300/600/1000',
            v_lang, v_index, coalesce(array_to_string(v_tiers, ',', 'null'), '<none>'))));
      end if;

      select
        coalesce(array_agg(o->>'id'), array[]::text[]),
        coalesce(array_agg(lower(btrim(coalesce(o->>'text', '')))), array[]::text[])
      into v_option_ids, v_option_texts
      from jsonb_array_elements(v_question->'options') o;

      if exists (select 1 from unnest(v_option_ids) t where coalesce(btrim(t), '') = '') then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_option_id_missing', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s has an option with no id', v_lang, v_index)));
      end if;

      if (select count(distinct t) from unnest(v_option_ids) t) <> 4 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_option_id_duplicated', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s repeats an option id', v_lang, v_index)));
      end if;

      if exists (select 1 from unnest(v_option_texts) t where length(t) < 3) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_option_text_missing', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s has an empty option', v_lang, v_index)));
      end if;

      if (select count(distinct t) from unnest(v_option_texts) t) <> 4 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_option_text_duplicated', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s offers the same answer twice', v_lang, v_index)));
      end if;

      -- Feedback is the whole payoff of a scored question: it is the only thing
      -- the reader is given after answering, and an option without one loses
      -- points for a reason nobody explains.
      if exists (
        select 1 from jsonb_array_elements(v_question->'options') o
        where length(btrim(coalesce(o->>'feedback', ''))) = 0
      ) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_feedback_missing', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s has an option with no feedback', v_lang, v_index)));
      end if;

      if exists (
        select 1 from jsonb_array_elements(v_question->'options') o
        where length(btrim(coalesce(o->>'feedback', ''))) > c_feedback_max
      ) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_feedback_too_long', 'language', v_lang, 'question', v_index,
          'detail', format('%s question %s has feedback longer than %s characters',
            v_lang, v_index, c_feedback_max)));
      end if;
    end loop;
  end loop;

  -- ---- parity -------------------------------------------------------------
  -- Only meaningful once both halves are structurally sound: comparing two
  -- malformed arrays produces a second copy of the same finding.
  v_fr := p_output_json->'fr'->'questions';
  v_en := p_output_json->'en'->'questions';

  if jsonb_typeof(v_fr) = 'array'
     and jsonb_typeof(v_en) = 'array'
     and jsonb_array_length(v_fr) = v_expected
     and jsonb_array_length(v_en) = v_expected
  then
    for v_index in 1 .. v_expected
    loop
      v_fr_q := v_fr->(v_index - 1);
      v_en_q := v_en->(v_index - 1);

      if coalesce(v_fr_q->>'id', '') is distinct from coalesce(v_en_q->>'id', '') then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_parity_id_mismatch', 'question', v_index,
          'detail', format('question %s is id %s in fr and %s in en',
            v_index, coalesce(v_fr_q->>'id', '<none>'), coalesce(v_en_q->>'id', '<none>'))));
      end if;

      if coalesce(v_fr_q->>'role', '') is distinct from coalesce(v_en_q->>'role', '') then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'question_parity_role_mismatch', 'question', v_index,
          'detail', format('question %s is %s in fr and %s in en',
            v_index, coalesce(v_fr_q->>'role', '<none>'), coalesce(v_en_q->>'role', '<none>'))));
      end if;

      if jsonb_typeof(v_fr_q->'options') <> 'array' or jsonb_typeof(v_en_q->'options') <> 'array' then
        continue;
      end if;

      for v_fr_option in select value from jsonb_array_elements(v_fr_q->'options')
      loop
        v_option_id := v_fr_option->>'id';

        select value into v_en_option
        from jsonb_array_elements(v_en_q->'options') value
        where value->>'id' = v_option_id
        limit 1;

        if v_en_option is null then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'code', 'question_parity_option_missing', 'question', v_index,
            'option', v_option_id,
            'detail', format('question %s option %s exists in fr and not in en',
              v_index, coalesce(v_option_id, '<none>'))));
          continue;
        end if;

        -- The same answer must be worth the same thing in both languages, or two
        -- team-mates reading the same edition are playing different games.
        if public.scored_question_tier(v_fr_option)
           is distinct from public.scored_question_tier(v_en_option) then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'code', 'question_parity_tier_mismatch', 'question', v_index,
            'option', v_option_id,
            'detail', format('question %s option %s scores %s in fr and %s in en',
              v_index, v_option_id,
              coalesce(public.scored_question_tier(v_fr_option)::text, '<invalid>'),
              coalesce(public.scored_question_tier(v_en_option)::text, '<invalid>'))));
        end if;

        -- Identical text is the parity failure that looks like parity: it means
        -- one language was copied rather than written.
        if length(btrim(coalesce(v_fr_option->>'text', ''))) > 0
           and lower(btrim(v_fr_option->>'text')) = lower(btrim(coalesce(v_en_option->>'text', ''))) then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'code', 'question_parity_text_identical', 'question', v_index,
            'option', v_option_id,
            'detail', format('question %s option %s has identical fr and en text',
              v_index, v_option_id)));
        end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'valid', jsonb_array_length(v_errors) = 0,
    'job_id', p_job_id,
    'content_type', v_job.content_type,
    'expected_questions', v_expected,
    'expected_roles', to_jsonb(v_roles),
    'errors', v_errors
  );
end;
$function$;

comment on function public.validate_generation_questions(uuid, jsonb) is
  'Deterministic scored-question preflight for one job: counts, roles, four options, one option per tier, feedback, rationale, and FR/EN parity. Mirrors services/content-engine/src/generation/gradedQuestions.ts.';

-- ---------------------------------------------------------------------------
-- 5. The edition-level question gate
-- ---------------------------------------------------------------------------
-- Shaped like `assert_edition_publishable`: a verdict with every reason, never
-- an exception. Kept separate from it deliberately — see the header — and
-- separately callable, so `npm run publisher:status` can say "the batch is
-- approved but four jobs have no questions" instead of "not ready".

create or replace function public.assert_edition_questions_publishable(p_edition_date date)
returns jsonb
language plpgsql
volatile
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_kind text;
  v_batch public.automation_batches%rowtype;
  v_required boolean;
  v_blockers jsonb := '[]'::jsonb;
  v_job record;
  v_output public.generation_outputs%rowtype;
  v_validation jsonb;
  v_checked integer := 0;
  v_with_questions integer := 0;
begin
  v_kind := public.resolve_staging_edition_kind(p_edition_date);

  if v_kind is null then
    return jsonb_build_object(
      'ok', true, 'required', false, 'reason', 'quiet_day',
      'edition_date', p_edition_date, 'blockers', '[]'::jsonb);
  end if;

  select * into v_batch
  from public.automation_batches
  where edition_date = p_edition_date and edition_kind = v_kind
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', true, 'required', false, 'reason', 'batch_not_found',
      'edition_date', p_edition_date, 'blockers', '[]'::jsonb);
  end if;

  v_required := public.batch_requires_scored_questions(v_batch.id);

  if not v_required then
    -- Legacy, and legitimately so. Reported rather than silent: an edition
    -- publishing without questions after the cutover is something an operator
    -- should be able to see happening.
    return jsonb_build_object(
      'ok', true, 'required', false, 'reason', 'legacy_batch',
      'edition_date', p_edition_date, 'batch_id', v_batch.id,
      'cutover_edition', public.scored_question_cutover_edition(),
      'blockers', '[]'::jsonb);
  end if;

  for v_job in
    select * from public.generation_jobs where batch_id = v_batch.id order by id
  loop
    select * into v_output
    from public.generation_outputs
    where job_id = v_job.id and attempt = v_job.attempt_count
    order by submitted_at desc
    limit 1;

    if not found then
      -- `assert_edition_publishable` already reports a missing output as its own
      -- blocker. Not repeated here: two codes for one fact makes a verdict
      -- harder to read, not safer.
      continue;
    end if;

    v_checked := v_checked + 1;
    v_validation := public.validate_generation_questions(v_job.id, v_output.output_json);

    if coalesce((v_validation->>'valid')::boolean, false) then
      v_with_questions := v_with_questions + 1;
    else
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'scored_questions_invalid',
        'job_id', v_job.id,
        'content_type', v_job.content_type,
        'topic', coalesce(v_job.topic, v_job.mini_case_topic),
        'ordinal', v_job.ordinal,
        'detail', format('%s %s#%s failed the scored-question preflight',
          v_job.content_type, coalesce(v_job.topic, v_job.mini_case_topic, '-'), v_job.ordinal),
        'errors', coalesce(v_validation->'errors', '[]'::jsonb)));
    end if;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'required', true,
    'reason', case when jsonb_array_length(v_blockers) = 0 then 'ok'
                   else 'scored_questions_invalid' end,
    'edition_date', p_edition_date,
    'batch_id', v_batch.id,
    'contract_version', public.scored_question_contract()->>'version',
    'cutover_edition', public.scored_question_cutover_edition(),
    'jobs_checked', v_checked,
    'jobs_with_valid_questions', v_with_questions,
    'blockers', v_blockers
  );
end;
$function$;

comment on function public.assert_edition_questions_publishable(date) is
  'Edition-level scored-question gate. Returns ok=true for a legacy batch and for a quiet day; otherwise every job whose questions fail the contract, with its errors.';

-- ---------------------------------------------------------------------------
-- 6. The publisher's single entry point now asks both questions
-- ---------------------------------------------------------------------------
-- Byte-for-byte the body from 20260901090000, plus one block. Restated in full
-- rather than wrapped because this function is the one the scheduled publisher
-- calls and its whole value is that it is readable end to end in one place.

create or replace function public.get_scheduled_edition_publish_plan(p_edition_date date)
returns jsonb
language plpgsql
volatile
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_production_ref constant text := 'wkbviidrbmehmjbhvpeh';
  v_gate jsonb;
  v_questions jsonb;
  v_payload jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_jobs jsonb;
  v_news integer;
  v_story integer;
  v_mini integer;
begin
  v_gate := public.assert_edition_publishable(p_edition_date);

  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return jsonb_build_object('gate', v_gate, 'ready_payload', null);
  end if;

  -- THE ADDED BLOCK. The editorial gate passed; the game must also be
  -- publishable. Run second because a batch that is not editorially ready has
  -- nothing worth reporting about its questions, and running it first would bury
  -- the real blocker under 23 question errors.
  v_questions := public.assert_edition_questions_publishable(p_edition_date);

  if coalesce((v_questions->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'gate', v_gate
        || jsonb_build_object('ok', false, 'reason', 'scored_questions_invalid')
        || jsonb_build_object('blockers',
             (v_gate->'blockers') || coalesce(v_questions->'blockers', '[]'::jsonb))
        || jsonb_build_object('question_gate', v_questions),
      'ready_payload', null);
  end if;

  v_payload := public.get_ready_batch_payload(p_edition_date);

  if coalesce((v_payload->>'ready')::text,'false') <> 'true' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','payload_not_ready',
      'detail', format('get_ready_batch_payload answered %s', coalesce(v_payload->>'reason','<no reason>'))));
  else
    v_jobs := v_payload->'jobs';

    if (v_payload->'batch'->>'id') is distinct from (v_gate->>'batch_id') then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','payload_batch_mismatch',
        'detail', format('payload carries batch %s, gate approved %s',
          v_payload->'batch'->>'id', v_gate->>'batch_id')));
    end if;

    if (v_payload->'batch'->>'edition_date')::date is distinct from p_edition_date then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','payload_date_mismatch',
        'detail', format('payload is dated %s', v_payload->'batch'->>'edition_date')));
    end if;

    if (v_payload->'batch'->>'edition_kind') is distinct from (v_gate->>'expected_edition_kind') then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','payload_kind_mismatch',
        'detail', format('payload kind is %s, calendar says %s',
          v_payload->'batch'->>'edition_kind', v_gate->>'expected_edition_kind')));
    end if;

    if coalesce(v_payload->'batch'->>'target_project_ref','') <> c_production_ref then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','payload_target_mismatch',
        'detail', format('payload targets %s', coalesce(v_payload->'batch'->>'target_project_ref','<null>'))));
    end if;

    if jsonb_typeof(v_jobs) <> 'array' or jsonb_array_length(v_jobs) <> 23 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','payload_job_count_mismatch',
        'detail', format('payload carries %s jobs, expected 23',
          case when jsonb_typeof(v_jobs) = 'array' then jsonb_array_length(v_jobs)::text else 'a non-array' end)));
    else
      select
        count(*) filter (where j->>'content_type' = 'newsletter_article'),
        count(*) filter (where j->>'content_type' = 'business_story'),
        count(*) filter (where j->>'content_type' = 'mini_case')
      into v_news, v_story, v_mini
      from jsonb_array_elements(v_jobs) j;

      if v_news <> 16 or v_story <> 1 or v_mini <> 6 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','payload_composition_invalid',
          'detail', format('payload composition is %s/%s/%s, expected 16/1/6', v_news, v_story, v_mini)));
      end if;

      if exists (
        select 1 from jsonb_array_elements(v_jobs) j
        where jsonb_typeof(j->'output_json') <> 'object'
           or jsonb_typeof(j->'source_records') <> 'array'
           or jsonb_array_length(j->'source_records') = 0
           or coalesce(j->'review'->>'verdict','') <> 'approved'
      ) then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','payload_job_incomplete',
          'detail','a payload job is missing its output, its sources or an approved review'));
      end if;
    end if;
  end if;

  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object(
      'gate', v_gate
        || jsonb_build_object('ok', false, 'reason', v_blockers->0->>'code')
        || jsonb_build_object('blockers', (v_gate->'blockers') || v_blockers),
      'ready_payload', null);
  end if;

  -- The question verdict travels with a passing plan too, so the run audit
  -- records which contract version an edition was published under.
  return jsonb_build_object(
    'gate', v_gate || jsonb_build_object('question_gate', v_questions),
    'ready_payload', v_payload);
end;
$function$;

comment on function public.get_scheduled_edition_publish_plan(date) is
  'Single entry point for the scheduled publisher: the editorial hard gate, the scored-question gate, and only when both pass, the canonical get_ready_batch_payload output.';

-- ---------------------------------------------------------------------------
-- 7. Permissions
-- ---------------------------------------------------------------------------
-- The contract is readable by the bridge (service_role) and by nobody else. The
-- validators are preflight machinery, not client surface.

revoke all on function public.scored_question_contract() from public, anon, authenticated;
revoke all on function public.scored_question_cutover_edition() from public, anon, authenticated;
revoke all on function public.scored_question_tier(jsonb) from public, anon, authenticated;
revoke all on function public.batch_requires_scored_questions(uuid) from public, anon, authenticated;
revoke all on function public.validate_generation_questions(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.assert_edition_questions_publishable(date) from public, anon, authenticated;

grant execute on function public.scored_question_contract() to service_role;
grant execute on function public.scored_question_cutover_edition() to service_role;
grant execute on function public.scored_question_tier(jsonb) to service_role;
grant execute on function public.batch_requires_scored_questions(uuid) to service_role;
grant execute on function public.validate_generation_questions(uuid, jsonb) to service_role;
grant execute on function public.assert_edition_questions_publishable(date) to service_role;

commit;
