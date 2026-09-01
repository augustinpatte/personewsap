-- Hard gate regression suite — STAGING project (kukyotcgbnchsoeriqoz).
--
-- Runs against the real `assert_edition_publishable` and
-- `get_scheduled_edition_publish_plan`, on real tables, with real constraints and
-- triggers — then throws it all away. The whole file is one transaction ending in
-- ROLLBACK, so it writes fixtures, asks the gate what it thinks, and leaves the
-- database exactly as it found it. No editorial content is created, modified or
-- deleted.
--
-- Run it:
--   npm run publisher:test:sql
--
-- Every scenario uses January 2027 edition dates, which no real batch occupies,
-- so the fixtures cannot collide with the pipeline even mid-transaction.
--
-- The final SELECT is the report: one row per scenario, `pass` must be true
-- everywhere.

begin;

-- ---------------------------------------------------------------------------
-- Fixture builders
-- ---------------------------------------------------------------------------
-- Temp functions: they exist for this connection and this transaction only.

create temp table gate_results (
  seq int,
  test text,
  expectation text,
  observed text,
  pass boolean
);

create or replace function pg_temp.words(p_count int) returns text
language sql immutable as $$
  select trim(repeat('mot ', p_count));
$$;

create or replace function pg_temp.source_records(p_count int) returns jsonb
language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
    'url', 'https://example.test/article-' || i,
    'title', 'Source ' || i,
    'publisher', 'Example Press',
    'published_at', '2027-01-02T08:00:00Z',
    'retrieved_at', '2027-01-02T09:00:00Z',
    'language', 'en',
    'topic', 'business',
    'summary', 'A source summary.'
  ))
  from generate_series(1, p_count) i;
$$;

create or replace function pg_temp.source_urls(p_count int) returns jsonb
language sql immutable as $$
  select jsonb_agg('https://example.test/article-' || i) from generate_series(1, p_count) i;
$$;

create or replace function pg_temp.mini_case_questions() returns jsonb
language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
    'role', role,
    'prompt', 'Question ' || n,
    'options', jsonb_build_array(
      jsonb_build_object('label','Option A','is_correct',true,'feedback','Correct.'),
      jsonb_build_object('label','Option B','is_correct',false,'feedback','No.'),
      jsonb_build_object('label','Option C','is_correct',false,'feedback','No.'),
      jsonb_build_object('label','Option D','is_correct',false,'feedback','No.'))
  ))
  from (values (1,'method_framework'),(2,'technical_application'),(3,'conclusion_decision')) v(n, role);
$$;

/**
 * One language half of a canonical item, built to satisfy
 * `validate_generation_output` exactly — same required keys, same word counts,
 * same topic mapping. `p_body_words` is the one knob a test turns to make the
 * deterministic preflight fail on purpose.
 */
create or replace function pg_temp.mk_item(
  p_content_type text,
  p_language text,
  p_topic text,
  p_mini_case_topic text,
  p_body_words int
) returns jsonb
language plpgsql immutable as $$
declare
  v_urls jsonb := pg_temp.source_urls(case when p_content_type = 'business_story' then 2 else 1 end);
  v_item jsonb;
begin
  if p_content_type = 'newsletter_article' then
    return jsonb_build_object(
      'content_type','newsletter_article','slot','newsletter','language',p_language,
      'title','Newsletter title','topic',p_topic,'source_urls',v_urls,'version',1,
      'published_date','2027-01-04','summary','A short summary of the article.',
      'body_md', pg_temp.words(coalesce(p_body_words, 240)),
      'why_it_matters','Why this matters to the reader.');
  end if;

  if p_content_type = 'business_story' then
    return jsonb_build_object(
      'content_type','business_story','slot','business_story','language',p_language,
      'title','Business story title','topic','business','source_urls',v_urls,'version',1,
      'company_or_market','Example Corp','story_date','2027-01-02',
      'setup', pg_temp.words(210), 'tension', pg_temp.words(210),
      'decision', pg_temp.words(210), 'outcome', pg_temp.words(210),
      'lesson','The lesson of the story.',
      'body_md', pg_temp.words(coalesce(p_body_words, 840)),
      'editorial_memory', jsonb_build_object(
        'entity_name','Example Corp','entity_type','company','main_company','Example Corp',
        'companies_mentioned', jsonb_build_array('Example Corp'),
        'industry','software','key_mechanism','distribution lock-in',
        'secondary_mechanisms', jsonb_build_array('pricing'),
        'strategic_angle','bundling','core_takeaway','Distribution beats features.',
        'year_period','2024-2025'));
  end if;

  v_item := jsonb_build_object(
    'content_type','mini_case','slot','mini_case','language',p_language,
    'title','Mini case title','topic',p_topic,'source_urls',v_urls,'version',1,
    'product_topic',p_mini_case_topic,'scenario_type','pricing_decision',
    'decision_type','choose_strategy','concept_tested','margin',
    'mechanism','Unit economics under a pricing change.',
    'question_pattern','framework_then_apply_then_decide',
    'correct_answer_pattern','highest_expected_value',
    'core_takeaway','Margin structure decides the answer.','difficulty','medium',
    'context','The context of the case.','challenge','The challenge to resolve.',
    'constraints','The binding constraints.','question','The central question.',
    'questions', pg_temp.mini_case_questions(),
    'expected_reasoning','The reasoning a strong answer follows.',
    'sample_answer','A model answer.','conclusion','The conclusion.',
    'final_takeaway','The final takeaway.','score_max',3,
    'body_md', pg_temp.words(coalesce(p_body_words, 260)));

  return v_item;
end;
$$;

create or replace function pg_temp.mini_case_content_topic(p_mini_case_topic text) returns text
language sql immutable as $$
  select case p_mini_case_topic
    when 'finance_economy' then 'finance'
    when 'stock_market' then 'finance'
    when 'ai' then 'tech_ai'
    when 'law_compliance' then 'law'
    when 'health_pharma' then 'medicine'
    when 'engineering_operations' then 'engineering'
  end;
$$;

/**
 * A complete, genuinely publishable edition: 23 jobs, both languages, source
 * records, approved reviews at score 95 with all six critical checks true.
 *
 * Every negative test starts from this and breaks exactly one thing, so a
 * failure can only mean the gate reacted to that one thing.
 */
create or replace function pg_temp.mk_edition(
  p_edition_date date,
  p_edition_kind text default 'daily',
  p_target text default 'wkbviidrbmehmjbhvpeh'
) returns uuid
language plpgsql as $$
declare
  c_newsletter_topics constant text[] := array[
    'business','finance','tech_ai','law','medicine','engineering','sport_business','culture_media'];
  c_mini_topics constant text[] := array[
    'finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations'];
  v_batch uuid;
  v_job uuid;
  v_output uuid;
  v_topic text;
  v_mini text;
  v_ordinal int;
begin
  insert into public.automation_batches (
    edition_date, edition_kind, status, expected_jobs, completed_jobs, approved_jobs,
    prompt_bundle_version, target_project_ref, metadata)
  values (p_edition_date, p_edition_kind, 'ready', 23, 23, 23,
    'test-bundle', p_target, jsonb_build_object('edition_type', p_edition_kind))
  returning id into v_batch;

  foreach v_topic in array c_newsletter_topics loop
    for v_ordinal in 1..2 loop
      insert into public.generation_jobs (
        batch_id, content_type, topic, ordinal, status, attempt_count, prompt_key)
      values (v_batch, 'newsletter_article', v_topic, v_ordinal, 'approved', 1, 'newsletter_prompt_final')
      returning id into v_job;

      insert into public.generation_outputs (job_id, attempt, worker_id, prompt_version, output_json, source_records)
      values (v_job, 1, 'personews-generator-a', 'test-v1',
        jsonb_build_object(
          'fr', pg_temp.mk_item('newsletter_article','fr',v_topic,null,null),
          'en', pg_temp.mk_item('newsletter_article','en',v_topic,null,null)),
        pg_temp.source_records(1))
      returning id into v_output;

      insert into public.generation_reviews (job_id, output_id, reviewer_id, verdict, score, checks)
      values (v_job, v_output, 'personews-reviewer', 'approved', 95, jsonb_build_object(
        'source_grounding',true,'factual_accuracy',true,'safety',true,
        'schema',true,'fr_en_parity',true,'novelty_anti_repetition',true));
    end loop;
  end loop;

  insert into public.generation_jobs (batch_id, content_type, topic, ordinal, status, attempt_count, prompt_key)
  values (v_batch, 'business_story', 'business', 1, 'approved', 1, 'business_story_prompt_final')
  returning id into v_job;

  insert into public.generation_outputs (job_id, attempt, worker_id, prompt_version, output_json, source_records)
  values (v_job, 1, 'personews-generator-b', 'test-v1',
    jsonb_build_object(
      'fr', pg_temp.mk_item('business_story','fr','business',null,null),
      'en', pg_temp.mk_item('business_story','en','business',null,null)),
    pg_temp.source_records(2))
  returning id into v_output;

  insert into public.generation_reviews (job_id, output_id, reviewer_id, verdict, score, checks)
  values (v_job, v_output, 'personews-reviewer', 'approved', 95, jsonb_build_object(
    'source_grounding',true,'factual_accuracy',true,'safety',true,
    'schema',true,'fr_en_parity',true,'novelty_anti_repetition',true));

  foreach v_mini in array c_mini_topics loop
    insert into public.generation_jobs (
      batch_id, content_type, topic, mini_case_topic, ordinal, status, attempt_count, prompt_key)
    values (v_batch, 'mini_case', pg_temp.mini_case_content_topic(v_mini), v_mini, 1, 'approved', 1, 'mini_case_prompt_final')
    returning id into v_job;

    insert into public.generation_outputs (job_id, attempt, worker_id, prompt_version, output_json, source_records)
    values (v_job, 1, 'personews-generator-c', 'test-v1',
      jsonb_build_object(
        'fr', pg_temp.mk_item('mini_case','fr',pg_temp.mini_case_content_topic(v_mini),v_mini,null),
        'en', pg_temp.mk_item('mini_case','en',pg_temp.mini_case_content_topic(v_mini),v_mini,null)),
      pg_temp.source_records(1))
    returning id into v_output;

    insert into public.generation_reviews (job_id, output_id, reviewer_id, verdict, score, checks)
    values (v_job, v_output, 'personews-reviewer', 'approved', 95, jsonb_build_object(
      'source_grounding',true,'factual_accuracy',true,'safety',true,
      'schema',true,'fr_en_parity',true,'novelty_anti_repetition',true));
  end loop;

  return v_batch;
end;
$$;

create or replace function pg_temp.record(
  p_seq int, p_test text, p_expectation text, p_observed text
) returns void language sql as $$
  insert into gate_results values (
    p_seq, p_test, p_expectation, p_observed, p_expectation = p_observed);
$$;

/** `ok:<reason>` — the whole verdict in one comparable string. */
create or replace function pg_temp.verdict(p_date date) returns text
language sql as $$
  select (g->>'ok') || ':' || (g->>'reason')
  from (select public.assert_edition_publishable(p_date) as g) s;
$$;

-- ---------------------------------------------------------------------------
-- Test 1 — 23/23 approved and every check valid: publication authorised.
-- ---------------------------------------------------------------------------
do $$
declare v_plan jsonb;
begin
  perform pg_temp.mk_edition('2027-01-04'::date, 'daily');   -- Monday
  perform pg_temp.record(1, 'T1 full valid daily edition', 'true:ok', pg_temp.verdict('2027-01-04'));

  v_plan := public.get_scheduled_edition_publish_plan('2027-01-04');
  perform pg_temp.record(1, 'T1 canonical payload returned ready with 23 jobs', 'true:23',
    coalesce((v_plan->'ready_payload'->>'ready'),'null') || ':' ||
    coalesce(jsonb_array_length(v_plan->'ready_payload'->'jobs')::text,'null'));
  perform pg_temp.record(1, 'T1 payload batch matches the gated batch', 'true',
    ((v_plan->'ready_payload'->'batch'->>'id') = (v_plan->'gate'->>'batch_id'))::text);
end $$;

-- ---------------------------------------------------------------------------
-- Test 2 — 22/23 approved: nothing publishes.
-- ---------------------------------------------------------------------------
do $$
declare v_batch uuid; v_job uuid;
begin
  v_batch := pg_temp.mk_edition('2027-01-06'::date, 'daily');   -- Wednesday
  select id into v_job from public.generation_jobs
  where batch_id = v_batch and content_type = 'newsletter_article' limit 1;
  update public.generation_jobs set status = 'revision_required' where id = v_job;
  update public.automation_batches set approved_jobs = 22 where id = v_batch;

  -- The gate refreshes the cached status before reading it, so a batch that is
  -- one job short is demoted to `reviewing` and reports that first. The shortfall
  -- itself is asserted directly rather than through blocker ordering.
  perform pg_temp.record(2, 'T2 22/23 approved refuses', 'false:batch_not_ready',
    pg_temp.verdict('2027-01-06'));
  perform pg_temp.record(2, 'T2 the shortfall is still named', 'true',
    (public.assert_edition_publishable('2027-01-06')->'blockers' @> jsonb_build_array(
      jsonb_build_object('code','jobs_not_all_approved',
        'detail','22 of 23 jobs are approved')))::text);
  perform pg_temp.record(2, 'T2 the blocking job is named', 'true',
    (public.assert_edition_publishable('2027-01-06')->'blocking_jobs' @> jsonb_build_array(
      jsonb_build_object('blocker','job_not_approved')))::text);
  perform pg_temp.record(2, 'T2 no payload is offered', 'true',
    (public.get_scheduled_edition_publish_plan('2027-01-06')->'ready_payload' = 'null'::jsonb)::text);
end $$;

-- ---------------------------------------------------------------------------
-- Test 3 — 23/23 approved but one review scored 89.
-- ---------------------------------------------------------------------------
do $$
declare v_batch uuid;
begin
  v_batch := pg_temp.mk_edition('2027-01-08'::date, 'daily');   -- Friday
  update public.generation_reviews set score = 89
  where id = (select r.id from public.generation_reviews r
              join public.generation_jobs j on j.id = r.job_id
              where j.batch_id = v_batch and j.content_type = 'mini_case' limit 1);

  perform pg_temp.record(3, 'T3 a review below 90 refuses', 'false:review_score_below_bar',
    pg_temp.verdict('2027-01-08'));
end $$;

-- ---------------------------------------------------------------------------
-- Test 4 — 23/23 approved but one critical check is false.
-- ---------------------------------------------------------------------------
do $$
declare v_batch uuid;
begin
  v_batch := pg_temp.mk_edition('2027-01-11'::date, 'daily');   -- Monday
  update public.generation_reviews
  set checks = checks || jsonb_build_object('novelty_anti_repetition', false)
  where id = (select r.id from public.generation_reviews r
              join public.generation_jobs j on j.id = r.job_id
              where j.batch_id = v_batch and j.content_type = 'business_story' limit 1);

  perform pg_temp.record(4, 'T4 a false critical check refuses', 'false:critical_check_failed',
    pg_temp.verdict('2027-01-11'));
  perform pg_temp.record(4, 'T4 the failing check is named', 'novelty_anti_repetition',
    (select b->>'check' from jsonb_array_elements(
      public.assert_edition_publishable('2027-01-11')->'blockers') b
     where b->>'code' = 'critical_check_failed' limit 1));
end $$;

-- ---------------------------------------------------------------------------
-- Test 5 — approved and reviewed, but the deterministic preflight disagrees.
-- ---------------------------------------------------------------------------
-- A 100-word newsletter body. The reviewer said yes; arithmetic says no; the
-- gate re-runs the arithmetic and arithmetic wins.
do $$
declare v_batch uuid; v_job uuid;
begin
  v_batch := pg_temp.mk_edition('2027-01-13'::date, 'daily');   -- Wednesday
  select j.id into v_job from public.generation_jobs j
  where j.batch_id = v_batch and j.content_type = 'newsletter_article' and j.topic = 'finance' limit 1;

  update public.generation_outputs
  set output_json = jsonb_build_object(
    'fr', pg_temp.mk_item('newsletter_article','fr','finance',null,100),
    'en', pg_temp.mk_item('newsletter_article','en','finance',null,100))
  where job_id = v_job;

  perform pg_temp.record(5, 'T5 invalid preflight refuses', 'false:deterministic_preflight_invalid',
    pg_temp.verdict('2027-01-13'));
  perform pg_temp.record(5, 'T5 the preflight errors are reported', 'true',
    (jsonb_array_length((select b->'errors' from jsonb_array_elements(
      public.assert_edition_publishable('2027-01-13')->'blockers') b
      where b->>'code' = 'deterministic_preflight_invalid' limit 1)) > 0)::text);
end $$;

-- ---------------------------------------------------------------------------
-- Test 6 — the batch targets the wrong project.
-- ---------------------------------------------------------------------------
-- `trg_enforce_production_batch_mode` already refuses to create such a batch.
-- It is disabled for the length of this scenario purely to prove the gate is a
-- second, independent line of defence rather than a restatement of the trigger.
do $$
declare v_batch uuid;
begin
  alter table public.automation_batches disable trigger trg_enforce_production_batch_mode;
  v_batch := pg_temp.mk_edition('2027-01-15'::date, 'daily', 'kukyotcgbnchsoeriqoz');
  alter table public.automation_batches enable trigger trg_enforce_production_batch_mode;

  perform pg_temp.record(6, 'T6 a batch targeting staging refuses', 'false:wrong_target_project',
    pg_temp.verdict('2027-01-15'));
  perform pg_temp.record(6, 'T6 no payload is offered', 'true',
    (public.get_scheduled_edition_publish_plan('2027-01-15')->'ready_payload' = 'null'::jsonb)::text);
end $$;

-- ---------------------------------------------------------------------------
-- Test 7 — edition_kind = test.
-- ---------------------------------------------------------------------------
-- A test batch is not "a batch that fails the gate", it is not a candidate at
-- all: the calendar asks for a daily edition and there isn't one.
do $$
begin
  alter table public.automation_batches disable trigger trg_enforce_production_batch_mode;
  perform pg_temp.mk_edition('2027-01-18'::date, 'test');   -- Monday
  alter table public.automation_batches enable trigger trg_enforce_production_batch_mode;

  perform pg_temp.record(7, 'T7 a test batch is never publishable', 'false:batch_not_found',
    pg_temp.verdict('2027-01-18'));

  -- ... and neither is `regular`.
  alter table public.automation_batches disable trigger trg_enforce_production_batch_mode;
  perform pg_temp.mk_edition('2027-01-20'::date, 'regular');   -- Wednesday
  alter table public.automation_batches enable trigger trg_enforce_production_batch_mode;

  perform pg_temp.record(7, 'T7 a regular batch is never publishable', 'false:batch_not_found',
    pg_temp.verdict('2027-01-20'));
end $$;

-- ---------------------------------------------------------------------------
-- Test 8 — the edition is already published: idempotent no-op.
-- ---------------------------------------------------------------------------
do $$
declare v_batch uuid; v_gate jsonb;
begin
  v_batch := pg_temp.mk_edition('2027-01-22'::date, 'daily');   -- Friday
  insert into public.publication_receipts (batch_id, production_project_ref, production_run_id, production_result)
  values (v_batch, 'wkbviidrbmehmjbhvpeh',
    public.scheduled_publication_run_id('2027-01-22', v_batch), '{"published":true}'::jsonb);

  v_gate := public.assert_edition_publishable('2027-01-22');
  perform pg_temp.record(8, 'T8 an already-published edition refuses', 'false:already_published',
    (v_gate->>'ok') || ':' || (v_gate->>'reason'));
  perform pg_temp.record(8, 'T8 it is flagged as a no-op, not a failure', 'true',
    (v_gate->>'already_published'));
  perform pg_temp.record(8, 'T8 it carries no blockers', '0',
    jsonb_array_length(v_gate->'blockers')::text);
  perform pg_temp.record(8, 'T8 the run id is deterministic', 'true',
    (public.scheduled_publication_run_id('2027-01-22', v_batch) =
     public.scheduled_publication_run_id('2027-01-22', v_batch))::text);
end $$;

-- ---------------------------------------------------------------------------
-- Test 11 — Sunday is a weekly digest.
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.record(11, 'T11 Sunday resolves to weekly_digest', 'weekly_digest',
    public.resolve_staging_edition_kind('2027-01-03'));   -- Sunday

  perform pg_temp.mk_edition('2027-01-03'::date, 'weekly_digest');
  perform pg_temp.record(11, 'T11 a valid Sunday digest publishes', 'true:ok',
    pg_temp.verdict('2027-01-03'));

  -- A daily batch filed on a Sunday is not the edition the calendar asked for.
  perform pg_temp.mk_edition('2027-01-10'::date, 'daily');   -- Sunday
  perform pg_temp.record(11, 'T11 a daily batch on a Sunday is not found', 'false:batch_not_found',
    pg_temp.verdict('2027-01-10'));
end $$;

-- ---------------------------------------------------------------------------
-- Test 12 — Monday, Wednesday and Friday are dailies; the rest are quiet.
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.record(12, 'T12 Monday resolves to daily', 'daily',
    public.resolve_staging_edition_kind('2027-01-25'));
  perform pg_temp.record(12, 'T12 Wednesday resolves to daily', 'daily',
    public.resolve_staging_edition_kind('2027-01-27'));
  perform pg_temp.record(12, 'T12 Friday resolves to daily', 'daily',
    public.resolve_staging_edition_kind('2027-01-29'));
  perform pg_temp.record(12, 'T12 Tuesday is a quiet day', 'QUIET',
    coalesce(public.resolve_staging_edition_kind('2027-01-26'), 'QUIET'));
  perform pg_temp.record(12, 'T12 Thursday is a quiet day', 'QUIET',
    coalesce(public.resolve_staging_edition_kind('2027-01-28'), 'QUIET'));
  perform pg_temp.record(12, 'T12 Saturday is a quiet day', 'QUIET',
    coalesce(public.resolve_staging_edition_kind('2027-01-30'), 'QUIET'));

  perform pg_temp.mk_edition('2027-01-25'::date, 'daily');
  perform pg_temp.record(12, 'T12 a valid Monday daily publishes', 'true:ok',
    pg_temp.verdict('2027-01-25'));

  -- Nothing can publish on a quiet day, however ready a batch looks.
  perform pg_temp.record(12, 'T12 a quiet day refuses outright', 'false:quiet_day',
    pg_temp.verdict('2027-01-26'));
end $$;

-- ---------------------------------------------------------------------------
-- Composition — the shapes the edition is allowed to have.
-- ---------------------------------------------------------------------------
do $$
declare v_batch uuid; v_job uuid;
begin
  -- A missing job: 22 rows where 23 are required.
  v_batch := pg_temp.mk_edition('2027-02-01'::date, 'daily');   -- Monday
  select j.id into v_job from public.generation_jobs j
  where j.batch_id = v_batch and j.content_type = 'newsletter_article' and j.topic = 'culture_media' limit 1;
  delete from public.generation_reviews where job_id = v_job;
  delete from public.generation_outputs where job_id = v_job;
  delete from public.generation_jobs where id = v_job;

  perform pg_temp.record(13, 'C1 a missing job refuses', 'false:job_count_mismatch',
    pg_temp.verdict('2027-02-01'));
  perform pg_temp.record(13, 'C1 the thin topic is named', 'true',
    (public.assert_edition_publishable('2027-02-01')->'blockers' @> jsonb_build_array(
      jsonb_build_object('code','newsletter_topic_count_invalid',
        'detail','newsletter topic culture_media has 1 job(s), expected 2')))::text);

  -- A duplicated mini case topic: six jobs, five distinct topics. The ordinal
  -- has to move too — `generation_jobs_identity_idx` already forbids two jobs
  -- claiming the identical slot, so the only way to build this defect is the way
  -- it could actually occur.
  v_batch := pg_temp.mk_edition('2027-02-03'::date, 'daily');   -- Wednesday
  update public.generation_jobs
  set mini_case_topic = 'ai', topic = 'tech_ai', ordinal = 2
  where id = (select id from public.generation_jobs
              where batch_id = v_batch and mini_case_topic = 'stock_market' limit 1);

  perform pg_temp.record(13, 'C2 a repeated mini case topic refuses', 'false:mini_case_topics_invalid',
    pg_temp.verdict('2027-02-03'));

  -- An approved job whose current attempt produced nothing.
  v_batch := pg_temp.mk_edition('2027-02-05'::date, 'daily');   -- Friday
  update public.generation_jobs set attempt_count = 2
  where id = (select id from public.generation_jobs
              where batch_id = v_batch and content_type = 'business_story' limit 1);

  perform pg_temp.record(13, 'C3 an approved job with no current output refuses', 'false:output_missing',
    pg_temp.verdict('2027-02-05'));

  -- An output nobody reviewed.
  v_batch := pg_temp.mk_edition('2027-02-08'::date, 'daily');   -- Monday
  delete from public.generation_reviews r
  using public.generation_jobs j
  where r.job_id = j.id and j.batch_id = v_batch and j.content_type = 'mini_case'
    and r.id = (select r2.id from public.generation_reviews r2
                join public.generation_jobs j2 on j2.id = r2.job_id
                where j2.batch_id = v_batch and j2.content_type = 'mini_case' limit 1);

  perform pg_temp.record(13, 'C4 an unreviewed current output refuses', 'false:review_missing',
    pg_temp.verdict('2027-02-08'));

  -- A batch that is genuinely not ready: one job failed outright. `reviewing`
  -- alone is no longer a valid fixture here — the gate refreshes the cached
  -- status, so a merely stale row is healed rather than refused (see R1 below).
  -- What must still refuse is a batch whose *jobs* say it is not ready.
  v_batch := pg_temp.mk_edition('2027-02-10'::date, 'daily');   -- Wednesday
  update public.generation_jobs set status = 'failed'
  where id = (select id from public.generation_jobs
              where batch_id = v_batch and content_type = 'mini_case' limit 1);
  update public.automation_batches set status = 'ready' where id = v_batch;

  perform pg_temp.record(13, 'C5 a batch with a failed job refuses', 'false:batch_not_ready',
    pg_temp.verdict('2027-02-10'));
  perform pg_temp.record(13, 'C5 the refresh recorded the failure', 'failed',
    (select status from public.automation_batches where id = v_batch));
  perform pg_temp.record(13, 'C5 the failed job is named', 'true',
    (public.assert_edition_publishable('2027-02-10')->'blocking_jobs' @> jsonb_build_array(
      jsonb_build_object('status','failed')))::text);

  -- No batch at all.
  perform pg_temp.record(13, 'C6 a missing batch refuses', 'false:batch_not_found',
    pg_temp.verdict('2027-02-12'));   -- Friday, nothing created
end $$;

-- ---------------------------------------------------------------------------
-- Stale batch status — the cache must never decide the edition
-- ---------------------------------------------------------------------------
-- `automation_batches.status` and `approved_jobs` are maintained by
-- `refresh_batch_status`, which a worker calls after each review. A worker that
-- dies between approving the last job and refreshing the batch leaves a complete,
-- genuinely publishable edition behind a row still claiming `reviewing` with 7
-- approved. The gate must recompute the cache rather than believe it — an edition
-- skipped for a bookkeeping reason is the failure nobody would think to look for
-- at 19:05.
do $$
declare v_batch uuid; v_before record; v_after record; v_gate jsonb;
begin
  v_batch := pg_temp.mk_edition('2027-02-15'::date, 'daily');   -- Monday

  -- All 23 jobs really are approved; only the cached summary is wrong.
  update public.automation_batches
  set status = 'reviewing', approved_jobs = 7, completed_jobs = 7, expected_jobs = 23
  where id = v_batch;

  select status, approved_jobs into v_before
  from public.automation_batches where id = v_batch;

  perform pg_temp.record(14, 'R1 the batch starts stale', 'reviewing:7',
    v_before.status || ':' || v_before.approved_jobs);
  perform pg_temp.record(14, 'R1 all 23 jobs really are approved', '23',
    (select count(*)::text from public.generation_jobs
     where batch_id = v_batch and status = 'approved'));

  v_gate := public.assert_edition_publishable('2027-02-15');

  perform pg_temp.record(14, 'R1 the gate passes anyway', 'true:ok',
    (v_gate->>'ok') || ':' || (v_gate->>'reason'));
  perform pg_temp.record(14, 'R1 the stale status is reported, not hidden', 'reviewing:true',
    (v_gate->>'batch_status_before_refresh') || ':' || (v_gate->>'batch_status_refreshed'));

  select status, approved_jobs into v_after
  from public.automation_batches where id = v_batch;

  perform pg_temp.record(14, 'R1 the batch row was healed', 'ready:23',
    v_after.status || ':' || v_after.approved_jobs);

  -- And the canonical payload, which reads `status = ready` itself, now agrees.
  perform pg_temp.record(14, 'R1 the canonical payload is now offered', 'true:23',
    coalesce(public.get_ready_batch_payload('2027-02-15')->>'ready','null') || ':' ||
    coalesce(jsonb_array_length(
      public.get_scheduled_edition_publish_plan('2027-02-15')->'ready_payload'->'jobs')::text,'null'));

  -- `mark_batch_published` re-checks `ready` on its own; the heal makes the whole
  -- chain consistent rather than just the gate.
  perform pg_temp.record(14, 'R1 the receipt can now be written', 'true',
    (public.mark_batch_published(v_batch, 'wkbviidrbmehmjbhvpeh',
      public.scheduled_publication_run_id('2027-02-15', v_batch),
      '{"published":true}'::jsonb) is not null)::text);
end $$;

-- The refresh heals in both directions. A batch someone marked `ready` by hand
-- while jobs are still in revision is demoted, and the gate refuses it.
do $$
declare v_batch uuid; v_gate jsonb;
begin
  v_batch := pg_temp.mk_edition('2027-02-17'::date, 'daily');   -- Wednesday

  update public.generation_jobs set status = 'revision_required'
  where id = (select id from public.generation_jobs
              where batch_id = v_batch and content_type = 'newsletter_article' limit 1);

  -- The cache still insists everything is fine.
  update public.automation_batches
  set status = 'ready', approved_jobs = 23 where id = v_batch;

  v_gate := public.assert_edition_publishable('2027-02-17');

  perform pg_temp.record(14, 'R2 a falsely-ready batch is refused', 'false:batch_not_ready',
    (v_gate->>'ok') || ':' || (v_gate->>'reason'));
  perform pg_temp.record(14, 'R2 the batch row was demoted', 'reviewing:22',
    (select status || ':' || approved_jobs from public.automation_batches where id = v_batch));
end $$;

-- A published batch is never refreshed: `refresh_batch_status` knows nothing
-- about publication and would demote it straight back to `ready`.
do $$
declare v_batch uuid; v_gate jsonb;
begin
  v_batch := pg_temp.mk_edition('2027-02-19'::date, 'daily');   -- Friday
  insert into public.publication_receipts (batch_id, production_project_ref, production_run_id, production_result)
  values (v_batch, 'wkbviidrbmehmjbhvpeh',
    public.scheduled_publication_run_id('2027-02-19', v_batch), '{"published":true}'::jsonb);
  update public.automation_batches set status = 'published' where id = v_batch;

  v_gate := public.assert_edition_publishable('2027-02-19');

  perform pg_temp.record(14, 'R3 a published batch is a no-op', 'false:already_published',
    (v_gate->>'ok') || ':' || (v_gate->>'reason'));
  perform pg_temp.record(14, 'R3 its status was left alone', 'published',
    (select status from public.automation_batches where id = v_batch));
end $$;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------

select
  (select count(*) from gate_results) as checks,
  (select count(*) from gate_results where pass) as passed,
  (select count(*) from gate_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from gate_results where not pass) as failures;

rollback;
