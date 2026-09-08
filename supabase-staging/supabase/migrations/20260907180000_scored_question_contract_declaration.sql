-- Declaring the scored-question contract on the canonical payload — STAGING.
--
-- The production half of this change (supabase/migrations/20260907180000) stops
-- production inferring "this edition owes its readers questions" from the fact
-- that question rows happen to exist. It cannot do that unless something tells
-- it, and this is the something.
--
-- WHERE THE DECLARATION COMES FROM.
--
-- `batch_requires_scored_questions()` already answers the question, and it is
-- already the single source of the cutover: an explicit `metadata.scored_questions`
-- on the batch, else a prompt bundle naming the contract, else
-- `scored_question_cutover_edition()`. Nothing new decides anything here. The
-- verdict simply stops being a private thought of the gate and starts travelling
-- with the payload, on the `batch` object:
--
--     scored_questions_required          boolean
--     scored_question_contract_version   integer
--
-- ONE VERSION NUMBER. `scored_question_contract()` reported `scored-questions-v1`
-- as a literal and production had no notion of a version at all. Both now derive
-- from `scored_question_contract_version()`, so the number a generator is handed,
-- the number the payload declares and the number production checks are the same
-- integer rather than three strings that can drift.
--
-- THE GATE GETS STRICTER IN ONE PLACE. A questions-required batch with no jobs
-- to check used to pass this gate — `v_blockers` stayed empty, so ok was true —
-- and was refused only by the editorial gate next door. A gate whose verdict is
-- correct only because a different gate is also running is not a gate.

begin;

-- ---------------------------------------------------------------------------
-- 1. The version, as one integer
-- ---------------------------------------------------------------------------

create or replace function public.scored_question_contract_version()
returns integer
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select 1;
$function$;

comment on function public.scored_question_contract_version() is
  'The scored-question contract version this staging project generates and gates against. Production implements the same integer; a payload declaring a higher one is refused there rather than published under rules it does not know.';

revoke all on function public.scored_question_contract_version() from public, anon, authenticated;
grant execute on function public.scored_question_contract_version() to service_role;

-- The contract itself, unchanged except that its version is now derived rather
-- than spelled. Restated in full because it is served verbatim to the Scheduled
-- Tasks and its whole value is being readable in one place.
create or replace function public.scored_question_contract()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'version', 'scored-questions-v' || public.scored_question_contract_version()::text,
    'contract_version', public.scored_question_contract_version(),
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
  'The scored-question contract as data, served to the Scheduled Tasks through the bridge so the generators, the reviewer and this gate read one definition rather than three prose copies. Its version derives from scored_question_contract_version().';

revoke all on function public.scored_question_contract() from public, anon, authenticated;
grant execute on function public.scored_question_contract() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Decorating the canonical payload
-- ---------------------------------------------------------------------------
-- `get_ready_batch_payload` is the canonical payload builder and it lives only
-- inside this project, outside version control (see KNOWN_ISSUES). It is
-- deliberately NOT modified: this decorates its output on the way past, which
-- means the declaration is added by code that is reviewable here and the
-- canonical builder keeps its single responsibility.

create or replace function public.decorate_payload_with_question_contract(
  p_payload jsonb,
  p_questions jsonb
)
returns jsonb
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_required boolean;
begin
  if coalesce(jsonb_typeof(p_payload), 'null') <> 'object'
     or coalesce(jsonb_typeof(p_payload->'batch'), 'null') <> 'object' then
    -- Nothing to decorate and nothing to guess at. Returned unchanged so the
    -- caller's own payload checks report the real shape problem.
    return p_payload;
  end if;

  -- The verdict is the gate's, not this function's. `required` absent is treated
  -- as false only because the caller has already refused a payload whose
  -- question gate did not answer, and a NULL here would publish an undeclared
  -- edition — which production fails rather than accepts.
  v_required := coalesce((p_questions->>'required')::boolean, false);

  return p_payload || jsonb_build_object(
    'batch',
    (p_payload->'batch') || jsonb_build_object(
      'scored_questions_required', v_required,
      'scored_question_contract_version', public.scored_question_contract_version()));
end;
$function$;

comment on function public.decorate_payload_with_question_contract(jsonb, jsonb) is
  'Stamps the scored-question declaration onto a canonical payload''s batch object. Production stamps it onto every item it writes and holds the edition to it, so this is what makes "this edition owes questions" a fact recorded before any question exists.';

revoke all on function public.decorate_payload_with_question_contract(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.decorate_payload_with_question_contract(jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. A questions-required batch with nothing to check is not publishable
-- ---------------------------------------------------------------------------
-- Patched at one anchor rather than restated: `assert_edition_questions_publishable`
-- is 90 lines of loop that 20260906110000 owns, and a second copy of it here is
-- a second thing to keep in step.

do $$
declare
  v_source text;
  c_anchor constant text := E'  return jsonb_build_object(\n    \'ok\', jsonb_array_length(v_blockers) = 0,\n    \'required\', true,';
  c_guard constant text := E'  if v_checked = 0 then\n'
    '    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(\n'
    '      ''code'', ''scored_questions_absent'',\n'
    '      ''detail'', ''this batch must carry scored questions and has no output to check''));\n'
    '  end if;\n\n';
begin
  select pg_get_functiondef(p.oid) into v_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'assert_edition_questions_publishable'
  limit 1;

  if v_source is null then
    raise exception 'assert_edition_questions_publishable not found: apply 20260906110000 first';
  end if;

  if v_source like '%scored_questions_absent%' then
    raise notice 'question gate already refuses an empty questions-required batch; nothing to do';
    return;
  end if;

  if position(c_anchor in v_source) = 0 then
    raise exception 'question gate return statement did not match; refusing to patch blind';
  end if;

  v_source := replace(v_source, c_anchor, c_guard || c_anchor);

  if v_source not like '%scored_questions_absent%' then
    raise exception 'question gate patch produced no change; refusing to continue';
  end if;

  execute v_source;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The plan hands the publisher a declared payload
-- ---------------------------------------------------------------------------
-- One anchor, and it is unique: every refusing branch returns
-- `'ready_payload', null)`, and only the success branch returns the payload.

do $$
declare
  v_source text;
  c_anchor constant text := E'\'ready_payload\', v_payload);';
begin
  select pg_get_functiondef(p.oid) into v_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_scheduled_edition_publish_plan'
  limit 1;

  if v_source is null then
    raise exception 'get_scheduled_edition_publish_plan not found: apply 20260901090000 and 20260906110000 first';
  end if;

  if v_source like '%decorate_payload_with_question_contract%' then
    raise notice 'publish plan already declares the scored-question contract; nothing to do';
    return;
  end if;

  if position(c_anchor in v_source) = 0 then
    raise exception 'publish plan return statement did not match; refusing to patch blind';
  end if;

  v_source := replace(
    v_source,
    c_anchor,
    E'\'ready_payload\', public.decorate_payload_with_question_contract(v_payload, v_questions));'
  );

  if v_source not like '%decorate_payload_with_question_contract%' then
    raise exception 'publish plan patch produced no change; refusing to continue';
  end if;

  execute v_source;
end;
$$;

commit;
