-- Fixture for scripts/publication-concurrency-test.mjs. Not a migration.
--
-- Loaded into the THROWAWAY database that script builds (a restore of the local
-- postgres database plus the unapplied migrations), never into the local
-- postgres database itself and never into a remote project. Committed there on
-- purpose: two independent sessions must both see these helpers.
--
-- The payload builder is the parity suite's (set_based_publisher_parity.test.sql):
-- a structurally complete 23-job batch whose job ids derive from (tag, index).

create schema if not exists concurrency_test;
grant usage on schema concurrency_test to postgres;

create or replace function concurrency_test.item(
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

create or replace function concurrency_test.job_id(p_tag text, p_index int) returns uuid
language sql immutable as $$ select md5(p_tag || ':' || p_index)::uuid $$;

create or replace function concurrency_test.payload(p_tag text, p_batch uuid, p_date date) returns jsonb
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
      'job_id', concurrency_test.job_id(p_tag, s.idx), 'output_id', md5('out' || p_tag || s.idx)::uuid,
      'content_type', s.ct, 'topic', s.topic, 'mini_case_topic', s.mini, 'ordinal', s.ordinal,
      'prompt_version', 'pp-v1',
      'output_json', jsonb_build_object(
        'fr', concurrency_test.item(s.ct, 'fr', s.topic, s.mini, p_date),
        'en', concurrency_test.item(s.ct, 'en', s.topic, s.mini, p_date)),
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


-- A few readers per run, so every publication has drops to write or refuse.
create or replace function concurrency_test.add_readers(p_run text, p_count int) returns int
language plpgsql as $$
declare n int; v_id uuid;
begin
  for n in 1..p_count loop
    v_id := md5('reader:' || p_run || ':' || n)::uuid;
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
      confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000',v_id,'authenticated','authenticated',
      'cc-' || p_run || '-' || n || '@example.test','x',now(),now(),now(),'','','','','{}','{}');
    insert into public.profiles(id,email,language,timezone)
    values (v_id,'cc-' || p_run || '-' || n || '@example.test', case when n % 2 = 0 then 'fr' else 'en' end,'Europe/Paris');
    insert into public.user_preferences(user_id,newsletter_enabled,business_stories_enabled,mini_cases_enabled,
      newsletter_article_count,learning_path_choice_completed)
    values (v_id, true, true, true, 4, true);
    insert into public.user_topic_preferences(user_id,topic_id,articles_count,enabled,position)
    values (v_id,'tech_ai',2,true,1),(v_id,'law',1,true,2);
    insert into public.user_mini_case_topic_preferences(user_id,topic_id,enabled,position) values (v_id,'ai',true,1);
  end loop;
  return p_count;
end $$;

-- The canonical publisher, called the way production's Edge Function calls it.
create or replace function concurrency_test.publish(p_tag text, p_batch uuid, p_date date) returns jsonb
language sql as $$
  select public.publish_scheduled_staging_payload(concurrency_test.payload(p_tag, p_batch, p_date), 'cc-run-' || p_tag)
$$;

-- Who owns a date, as one comparable string: the registry's batch, and the
-- batches behind every drop item for that date.
create or replace function concurrency_test.ownership(p_date date) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'editions_batch', (select e.staging_batch_id from public.editions e where e.edition_date = p_date),
    'drops', (select count(*) from public.daily_drops d where d.drop_date = p_date),
    'items', (select count(*) from public.daily_drop_items i join public.daily_drops d on d.id = i.daily_drop_id where d.drop_date = p_date),
    'item_batches', coalesce((
      select jsonb_agg(distinct ci.metadata->>'staging_batch_id')
      from public.daily_drop_items i
      join public.daily_drops d on d.id = i.daily_drop_id
      join public.content_items ci on ci.id = i.content_item_id
      where d.drop_date = p_date), '[]'::jsonb),
    'item_fingerprint', (
      select md5(coalesce(string_agg(i.daily_drop_id::text || ':' || i.content_item_id || ':' || i.slot || ':' || i.position,
                                     ',' order by i.daily_drop_id, i.slot, i.position), ''))
      from public.daily_drop_items i join public.daily_drops d on d.id = i.daily_drop_id where d.drop_date = p_date)
  )
$$;

-- Content rows a batch wrote.
create or replace function concurrency_test.content_count(p_batch uuid) returns bigint
language sql stable as $$
  select count(*) from public.content_items ci where ci.metadata->>'staging_batch_id' = p_batch::text
$$;

grant execute on all functions in schema concurrency_test to postgres;
