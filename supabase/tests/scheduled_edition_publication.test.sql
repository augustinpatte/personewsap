-- Production publisher refusals — PRODUCTION project (wkbviidrbmehmjbhvpeh).
--
-- The staging hard gate decides. This suite checks the thing that happens when
-- the gate is wrong, bypassed, or bypassed on purpose: production's own
-- `publish_scheduled_staging_payload` refusing a payload it should never accept.
-- Two independent refusals for every rule is the design; this is the second one.
--
-- Every scenario here is a REFUSAL. Nothing in this file publishes anything: the
-- publisher raises before it writes, each raise is caught in a plpgsql
-- subtransaction, and the whole file ends in ROLLBACK. The only positive case is
-- `verify_scheduled_edition`, which is read-only by construction.
--
-- Run it:
--   npm run publisher:test:sql
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table publish_results (
  seq int,
  test text,
  expectation text,
  observed text,
  pass boolean
);

/** The word padding the quality trigger and the item shape expect. */
create or replace function pg_temp.words(p_count int) returns text
language sql immutable as $$
  select trim(repeat('mot ', p_count));
$$;

create or replace function pg_temp.item(
  p_content_type text, p_language text, p_topic text, p_mini_case_topic text
) returns jsonb
language sql immutable as $$
  select case p_content_type
    when 'newsletter_article' then jsonb_build_object(
      'content_type','newsletter_article','slot','newsletter','language',p_language,
      'title','Title','topic',p_topic,'source_urls',jsonb_build_array('https://example.test/a-1'),
      'version',1,'published_date','2027-01-04','summary','Summary.',
      'body_md', pg_temp.words(240),'why_it_matters','Why.')
    when 'business_story' then jsonb_build_object(
      'content_type','business_story','slot','business_story','language',p_language,
      'title','Title','topic','business',
      'source_urls',jsonb_build_array('https://example.test/a-1','https://example.test/a-2'),
      'version',1,'body_md', pg_temp.words(840),'lesson','Lesson.')
    else jsonb_build_object(
      'content_type','mini_case','slot','mini_case','language',p_language,
      'title','Title','topic',p_topic,'source_urls',jsonb_build_array('https://example.test/a-1'),
      'version',1,'product_topic',p_mini_case_topic,'difficulty','medium',
      'challenge','Challenge.','body_md', pg_temp.words(260))
  end;
$$;

create or replace function pg_temp.review(p_score int, p_broken_check text default null) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'verdict','approved','score',p_score,'reviewer_id','personews-reviewer',
    'checks', jsonb_build_object(
      'source_grounding',true,'factual_accuracy',true,'safety',true,
      'schema',true,'fr_en_parity',true,'novelty_anti_repetition',true)
      || case when p_broken_check is null then '{}'::jsonb
              else jsonb_build_object(p_broken_check, false) end);
$$;

create or replace function pg_temp.job(
  p_content_type text, p_topic text, p_mini_case_topic text, p_ordinal int,
  p_score int default 95, p_broken_check text default null
) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'job_id', gen_random_uuid(), 'output_id', gen_random_uuid(),
    'content_type', p_content_type, 'topic', p_topic,
    'mini_case_topic', p_mini_case_topic, 'ordinal', p_ordinal,
    'prompt_version','test-v1',
    'output_json', jsonb_build_object(
      'fr', pg_temp.item(p_content_type,'fr',p_topic,p_mini_case_topic),
      'en', pg_temp.item(p_content_type,'en',p_topic,p_mini_case_topic)),
    'source_records', jsonb_build_array(
      jsonb_build_object('url','https://example.test/a-1','title','S1','publisher','P',
        'published_at','2027-01-02T08:00:00Z','retrieved_at','2027-01-02T09:00:00Z','language','en'),
      jsonb_build_object('url','https://example.test/a-2','title','S2','publisher','P',
        'published_at','2027-01-02T08:00:00Z','retrieved_at','2027-01-02T09:00:00Z','language','en')),
    'review', pg_temp.review(p_score, p_broken_check));
$$;

/**
 * A structurally complete 23-job payload.
 *
 * `p_first_job` replaces job #1, which is the one the publisher reaches first —
 * so a defect placed there is refused before a single row is written anywhere.
 */
create or replace function pg_temp.payload(
  p_edition_kind text default 'daily',
  p_target text default 'wkbviidrbmehmjbhvpeh',
  p_first_job jsonb default null,
  p_drop_last boolean default false,
  p_news_topics text[] default null
) returns jsonb
language sql as $$
  with news as (
    select pg_temp.job('newsletter_article', t.topic, null, ((t.ord - 1) % 2 + 1)::int) as j
    from unnest(coalesce(p_news_topics, array[
      'business','business','finance','finance','tech_ai','tech_ai','law','law',
      'medicine','medicine','engineering','engineering','sport_business','sport_business',
      'culture_media','culture_media'])) with ordinality t(topic, ord)
  ),
  mini as (
    select pg_temp.job('mini_case',
      case m when 'finance_economy' then 'finance' when 'stock_market' then 'finance'
             when 'ai' then 'tech_ai' when 'law_compliance' then 'law'
             when 'health_pharma' then 'medicine' else 'engineering' end, m, 1) as j
    from unnest(array['finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations']) m
  ),
  all_jobs as (
    select coalesce(p_first_job, pg_temp.job('business_story','business',null,1)) as j, 0 as ord
    union all select j, 1 from news
    union all select j, 2 from mini
  ),
  kept as (
    select j from (select j, row_number() over (order by ord) as rn from all_jobs) s
    where not (p_drop_last and rn = 23)
  )
  select jsonb_build_object(
    'ready', true,
    'batch', jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000001'::uuid,
      'edition_date','2027-01-04',
      'edition_kind', p_edition_kind,
      'prompt_bundle_version','test-bundle',
      'target_project_ref', p_target),
    'jobs', jsonb_agg(j))
  from kept;
$$;

/**
 * Call the publisher and report the refusal.
 *
 * The exception block is a subtransaction: whatever the publisher managed to
 * write before raising is discarded here, and the outer transaction is rolled
 * back regardless.
 */
create or replace function pg_temp.refusal(p_payload jsonb, p_run_id text default 'test-run')
returns text
language plpgsql as $$
declare v_result jsonb;
begin
  v_result := public.publish_scheduled_staging_payload(p_payload, p_run_id);
  return 'NO REFUSAL: ' || coalesce(v_result->>'published','?');
exception when others then
  return sqlerrm;
end;
$$;

create or replace function pg_temp.record(
  p_seq int, p_test text, p_expectation text, p_observed text
) returns void language sql as $$
  insert into publish_results values (
    p_seq, p_test, p_expectation, p_observed,
    p_observed like ('%' || p_expectation || '%'));
$$;

-- ---------------------------------------------------------------------------
-- Refusals
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.record(1, 'P1 a test edition kind is refused',
    'unsupported edition kind test',
    pg_temp.refusal(pg_temp.payload('test')));

  perform pg_temp.record(2, 'P2 a regular edition kind is refused',
    'unsupported edition kind regular',
    pg_temp.refusal(pg_temp.payload('regular')));

  perform pg_temp.record(3, 'P3 a batch targeting staging is refused',
    'batch targets kukyotcgbnchsoeriqoz, not production',
    pg_temp.refusal(pg_temp.payload('daily','kukyotcgbnchsoeriqoz')));

  perform pg_temp.record(4, 'P4 22 jobs are refused',
    'expected 23 jobs, got 22',
    pg_temp.refusal(pg_temp.payload('daily','wkbviidrbmehmjbhvpeh', null, true)));

  perform pg_temp.record(5, 'P5 a review below 90 is refused',
    'review is below bar',
    pg_temp.refusal(pg_temp.payload('daily','wkbviidrbmehmjbhvpeh',
      pg_temp.job('business_story','business',null,1,89))));

  perform pg_temp.record(6, 'P6 a false critical check is refused',
    'review is below bar',
    pg_temp.refusal(pg_temp.payload('daily','wkbviidrbmehmjbhvpeh',
      pg_temp.job('business_story','business',null,1,95,'source_grounding'))));

  perform pg_temp.record(7, 'P7 a missing run id is refused',
    'run id is required',
    pg_temp.refusal(pg_temp.payload(), ''));

  perform pg_temp.record(8, 'P8 a payload that is not ready is refused',
    'payload is not ready',
    pg_temp.refusal(pg_temp.payload() - 'ready'));

  -- Sixteen newsletter articles, but three on business and one on culture_media.
  -- The count is right and the edition is still wrong.
  perform pg_temp.record(9, 'P9 a newsletter topic imbalance is refused',
    'newsletter topic composition is invalid',
    pg_temp.refusal(pg_temp.payload('daily','wkbviidrbmehmjbhvpeh', null, false, array[
      'business','business','business','finance','finance','tech_ai','tech_ai','law','law',
      'medicine','medicine','engineering','engineering','sport_business','sport_business',
      'culture_media'])));
end $$;

-- ---------------------------------------------------------------------------
-- Verification, read-only
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  -- A batch production has never heard of cannot verify as complete.
  v := public.verify_scheduled_edition('2027-01-04', '00000000-0000-4000-8000-000000000001');
  perform pg_temp.record(10, 'V1 an unpublished edition does not verify', 'false', (v->>'ok'));
  perform pg_temp.record(10, 'V1 the shortfall is itemised', 'true',
    (jsonb_array_length(v->'problems') > 0)::text);

  -- The most recent real edition must verify as complete, or something is wrong
  -- with the verifier rather than with the edition.
  select public.verify_scheduled_edition(
    (r.production_result->>'edition_date')::date,
    (r.production_result->>'batch_id')::uuid,
    r.production_result->>'run_id')
  into v
  from (
    select ci.metadata->>'staging_batch_id' as batch_id,
           ci.publication_date,
           jsonb_build_object(
             'edition_date', ci.publication_date::text,
             'batch_id', ci.metadata->>'staging_batch_id',
             'run_id', ci.metadata->>'scheduler_run_id') as production_result
    from public.content_items ci
    where ci.status = 'published'
      and ci.metadata->>'persisted_by' = 'public.publish_scheduled_staging_payload'
    order by ci.publication_date desc, ci.created_at desc
    limit 1
  ) r;

  if v is null then
    perform pg_temp.record(11, 'V2 the latest real edition verifies', 'SKIPPED', 'SKIPPED');
  else
    perform pg_temp.record(11, 'V2 the latest real edition verifies', 'true', (v->>'ok'));
    perform pg_temp.record(11, 'V2 it holds 46 items', '46', (v->'items'->>'total'));
  end if;
end $$;

select
  (select count(*) from publish_results) as checks,
  (select count(*) from publish_results where pass) as passed,
  (select count(*) from publish_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from publish_results where not pass) as failures;

rollback;
