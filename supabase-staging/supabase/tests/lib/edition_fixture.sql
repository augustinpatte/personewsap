-- The canonical staging edition fixture, shared by every local staging harness.
--
-- Extracted from scheduled_publication_gate.test.sql so the publication E2E
-- (scripts/teams-e2e-local.mjs) builds THE SAME batch the gate suite is written
-- against, rather than a second, slightly different 23-job edition that would
-- prove the two fixtures agree and nothing else.
--
-- Everything here creates pg_temp functions, so it is per-session and vanishes
-- with the connection. It is concatenated into one psql session with whatever
-- uses it — a separate psql invocation would get a fresh, empty pg_temp.
--
-- The edition it builds is the real shape: 23 jobs (16 newsletter / 1 business
-- story / 6 mini cases), both languages, source records, scored questions with
-- one option per tier, and approved reviews at score 95 with all six critical
-- checks true.


-- ---------------------------------------------------------------------------
-- Fixture builders
-- ---------------------------------------------------------------------------
-- Temp functions: they exist for this connection only.

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

/**
 * The LEGACY question block: one `is_correct`, no tiers, no rationale.
 *
 * Kept, and kept working, because two months of approved Premium carries exactly
 * this shape and the gate must never retroactively invalidate it. Used only by
 * the legacy scenario below; every other fixture carries the scored contract.
 */
create or replace function pg_temp.legacy_mini_case_questions() returns jsonb
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
 * The SCORED question block, built to satisfy
 * `validate_generation_questions` exactly.
 *
 * Every negative scenario below starts from this and breaks exactly one thing,
 * so a failure can only mean the preflight reacted to that one thing.
 *
 * The FR and EN halves share ids and tiers and differ in wording — which is the
 * parity contract, not a stylistic choice: identical text across languages is a
 * copy, and the preflight rejects it.
 */
-- Defined before pg_temp.scored_questions, which calls it.
--
-- Not cosmetic ordering: scored_questions is `language sql`, and a SQL-bodied
-- function is parsed at CREATE time, not at first call. With the definitions
-- the other way round the suite died on its 123rd line with
-- `function pg_temp.scored_option(text, unknown, integer, text) does not exist`
-- before a single check had run.
create or replace function pg_temp.scored_option(
  p_question text,
  p_key text,
  p_tier int,
  p_language text
) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', p_question || '-' || p_key,
    'text', case when p_language = 'fr'
      then 'Reponse ' || upper(p_key) || ' en francais pour ' || p_question
      else 'Answer ' || upper(p_key) || ' in english for ' || p_question end,
    'score_milli', p_tier,
    'feedback', case when p_language = 'fr'
      then 'Pourquoi cette reponse vaut ' || p_tier || ' points.'
      else 'Why this answer is worth ' || p_tier || ' points.' end);
$$;

create or replace function pg_temp.scored_questions(
  p_content_type text,
  p_language text
) returns jsonb
language sql immutable as $$
  select jsonb_agg(
    jsonb_build_object(
      'id', 'q' || n,
      'role', role,
      'question', case when p_language = 'fr'
        then 'Quelle lecture resiste a la contrainte enoncee, question ' || n || ' ?'
        else 'Which reading survives the stated constraint, question ' || n || '?' end,
      'rationale', jsonb_build_object(
        'decision_criterion', 'Which reading survives the constraint stated in the second paragraph.',
        'excellent_reason', 'Names the mechanism and the constraint that bounded it.',
        'good_limitation', 'Names the mechanism but not the constraint.',
        'average_limitation', 'Restates the outcome without naming a mechanism.',
        'bad_failure', 'Contradicts what the article establishes.'),
      'options', jsonb_build_array(
        pg_temp.scored_option('q' || n, 'a', 1000, p_language),
        pg_temp.scored_option('q' || n, 'b', 600, p_language),
        pg_temp.scored_option('q' || n, 'c', 300, p_language),
        pg_temp.scored_option('q' || n, 'd', 0, p_language)))
    order by n)
  from (
    select n, role from (values
      (1, case when p_content_type = 'mini_case' then 'method_framework' else 'interpretation' end),
      (2, case when p_content_type = 'mini_case' then 'technical_application' else 'application_decision' end),
      (3, 'conclusion_decision')
    ) v(n, role)
    where p_content_type = 'mini_case' or n <= 2
  ) q;
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
      'questions', pg_temp.scored_questions('newsletter_article', p_language),
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
      'questions', pg_temp.scored_questions('business_story', p_language),
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
    'questions', pg_temp.scored_questions('mini_case', p_language),
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
