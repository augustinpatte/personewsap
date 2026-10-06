-- Publisher benchmark: per-reader (v1) vs set-based, at :readers synthetic readers.
--
-- LOCAL ONLY, and inside a transaction that ends in ROLLBACK: nothing persists.
-- Run through the runner-free wrapper (it inlines the migrations the same way
-- the parity suite does):
--
--   node scripts/publisher-benchmark.mjs 100 1000 10000
--
-- Prints one row per publisher: readers, milliseconds, drops, items. Timings
-- are this machine's, in a dev container; they show the SHAPE of the cost
-- (linear statements per reader vs a handful of set statements), not a
-- production latency.

-- (the runner inlines the migrations after this line)
begin;

create or replace function pg_temp.item(
  p_content_type text, p_language text, p_topic text, p_mini_case_topic text, p_date date
) returns jsonb
language sql immutable as $$
  select case p_content_type
    when 'newsletter_article' then jsonb_build_object(
      'content_type','newsletter_article','slot','newsletter','language',p_language,
      'title','Title','topic',p_topic,'source_urls',jsonb_build_array('https://example.test/pp-1'),
      'version',1,'published_date',p_date::text,'summary','Summary.',
      'body_md', trim(repeat('mot ', 240)),'why_it_matters','Why.')
    when 'business_story' then jsonb_build_object(
      'content_type','business_story','slot','business_story','language',p_language,
      'title','Title','topic','business',
      'source_urls',jsonb_build_array('https://example.test/pp-1','https://example.test/pp-2'),
      'version',1,'body_md', trim(repeat('mot ', 840)),'lesson','Lesson.')
    else jsonb_build_object(
      'content_type','mini_case','slot','mini_case','language',p_language,
      'title','Title','topic',p_topic,'source_urls',jsonb_build_array('https://example.test/pp-1'),
      'version',1,'product_topic',p_mini_case_topic,'difficulty','medium',
      'challenge','Challenge.','body_md', trim(repeat('mot ', 260)))
  end;
$$;

create or replace function pg_temp.job_id(p_tag text, p_index int) returns uuid
language sql immutable as $$ select md5(p_tag || ':' || p_index)::uuid $$;

create or replace function pg_temp.payload(p_tag text, p_batch uuid, p_date date) returns jsonb
language sql as $$
  with specs as (
    select 1 as idx, 'business_story' as ct, 'business' as topic, null::text as mini, 1 as ordinal
    union all
    -- Two articles per topic, ordinals 2 then 1: the publisher must order by
    -- ordinal, not by payload position.
    select 1 + t.ord::int, 'newsletter_article', t.topic, null, case when t.ord % 2 = 1 then 2 else 1 end
    from unnest(array[
      'business','business','finance','finance','tech_ai','tech_ai','law','law',
      'medicine','medicine','engineering','engineering','sport_business','sport_business',
      'culture_media','culture_media']) with ordinality t(topic, ord)
    union all
    select 17 + m.ord::int, 'mini_case',
      case m.topic when 'finance_economy' then 'finance' when 'stock_market' then 'finance'
                   when 'ai' then 'tech_ai' when 'law_compliance' then 'law'
                   when 'health_pharma' then 'medicine' else 'engineering' end,
      m.topic, 1
    from unnest(array['finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations'])
      with ordinality m(topic, ord)
  )
  select jsonb_build_object(
    'ready', true,
    'batch', jsonb_build_object(
      'id', p_batch, 'edition_date', p_date::text, 'edition_kind', 'daily',
      'prompt_bundle_version', 'pp-bundle', 'target_project_ref', 'wkbviidrbmehmjbhvpeh'),
    'jobs', jsonb_agg(jsonb_build_object(
      'job_id', pg_temp.job_id(p_tag, s.idx), 'output_id', md5('out' || p_tag || s.idx)::uuid,
      'content_type', s.ct, 'topic', s.topic, 'mini_case_topic', s.mini, 'ordinal', s.ordinal,
      'prompt_version', 'pp-v1',
      'output_json', jsonb_build_object(
        'fr', pg_temp.item(s.ct, 'fr', s.topic, s.mini, p_date),
        'en', pg_temp.item(s.ct, 'en', s.topic, s.mini, p_date)),
      'source_records', jsonb_build_array(
        jsonb_build_object('url','https://example.test/pp-1','title','S1','publisher','P',
          'published_at','2031-01-01T08:00:00Z','retrieved_at','2031-01-01T09:00:00Z','language','en'),
        jsonb_build_object('url','https://example.test/pp-2','title','S2','publisher','P',
          'published_at','2031-01-01T08:00:00Z','retrieved_at','2031-01-01T09:00:00Z','language','en')),
      'review', jsonb_build_object(
        'verdict','approved','score',95,'reviewer_id','personews-reviewer',
        'checks', jsonb_build_object('source_grounding',true,'factual_accuracy',true,'safety',true,
          'schema',true,'fr_en_parity',true,'novelty_anti_repetition',true)))
      order by s.idx))
  from specs s;
$$;


-- :readers readers with the parity suite's preference spread.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', md5('bench' || n)::uuid, 'authenticated','authenticated',
  'bench-'||n||'@example.test','x', now(),now(),now(),'','','','','{}','{}'
from generate_series(1, :readers) n;

insert into public.profiles(id,email,language,timezone)
select md5('bench' || n)::uuid, 'bench-'||n||'@example.test', case when n % 2 = 0 then 'fr' else 'en' end, 'Europe/Paris'
from generate_series(1, :readers) n;

insert into public.user_preferences(user_id,newsletter_enabled,business_stories_enabled,mini_cases_enabled,
  newsletter_article_count,learning_path_choice_completed)
select md5('bench' || n)::uuid, n % 7 <> 0, n % 5 <> 0, n % 3 <> 0, 1 + (n * 5) % 24, true
from generate_series(1, :readers) n;

insert into public.user_topic_preferences(user_id,topic_id,articles_count,enabled,position)
select md5('bench' || n)::uuid, t.topic, 1 + (n + t.k::int) % 3, (n + t.k::int) % 4 <> 0,
       case when (n + t.k::int) % 5 = 0 then null else ((t.k::int * 7 + n) % 4) + 1 end
from generate_series(1, :readers) n
cross join unnest(array['business','finance','tech_ai','law','medicine','engineering','sport_business','culture_media'])
  with ordinality t(topic, k)
where ((n * 37 + t.k::int * 11) % 5) <> 0;

insert into public.user_mini_case_topic_preferences(user_id,topic_id,enabled,position)
select md5('bench' || n)::uuid, m.topic, (n + m.k::int) % 5 <> 0,
       case when (n + m.k::int) % 4 = 0 then null else ((m.k::int * 5 + n) % 3) + 1 end
from generate_series(1, :readers) n
cross join unnest(array['finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations'])
  with ordinality m(topic, k)
where ((n * 13 + m.k::int * 7) % 3) <> 0;

analyze public.profiles;
analyze public.user_preferences;
analyze public.user_topic_preferences;
analyze public.user_mini_case_topic_preferences;

select set_config('bench.readers', :'readers', true);

create temp table bench (publisher text, readers int, ms numeric, drops int, items int);

do $$
declare t0 timestamptz; r jsonb;
begin
  t0 := clock_timestamp();
  r := public.publish_scheduled_staging_payload_v1(
    pg_temp.payload('A', 'be000000-0000-4000-8000-0000000000a1', '2031-04-07'), 'bench-old');
  insert into bench values ('per-reader (v1)', current_setting('bench.readers')::int,
    round(extract(epoch from clock_timestamp() - t0) * 1000, 1),
    (r->>'daily_drops_written')::int, (r->>'daily_drop_items_written')::int);

  t0 := clock_timestamp();
  r := public.publish_scheduled_staging_payload(
    pg_temp.payload('B', 'be000000-0000-4000-8000-0000000000b1', '2031-04-09'), 'bench-new');
  insert into bench values ('set-based', current_setting('bench.readers')::int,
    round(extract(epoch from clock_timestamp() - t0) * 1000, 1),
    (r->>'daily_drops_written')::int, (r->>'daily_drop_items_written')::int);
end $$;

select publisher, readers, ms, drops, items from bench order by publisher desc;

rollback;
