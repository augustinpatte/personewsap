-- Set-based publisher parity — PRODUCTION project.
--
-- Proves 20261005160000_set_based_publisher: the set-based reader assignment
-- publishes exactly what the per-reader loop published.
--
-- The runner applies every migration BEFORE 20261005160000, then inlines
--   fixtures/keep_publisher_v1.sql  (the per-reader publisher, renamed _v1)
--   20261005160000                  (the set-based publisher)
-- so both exist side by side. Each publishes the same batch content (same
-- jobs, same ordinals, same languages) for the same readers, on two different
-- dates. Readers' editions are then compared item by item, through the job that
-- produced each item (content ids differ between the two batches by design).
--
-- Everything happens inside one transaction that ends in ROLLBACK.
--
-- Run locally:
--   node scripts/local-sql-tests.mjs publisher-parity --with-migrations
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table pp_results (seq int, test text, expectation text, observed text, pass boolean);

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into pp_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

-- ---------------------------------------------------------------------------
-- Payload: the same 23 jobs, parameterised by batch and date. Job ids are
-- derived from (batch tag, job index), so item → job index is recoverable.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Readers: 60 with every combination the rules distinguish, plus 3 without a
-- preferences row (never served). Deterministic from the reader number.
-- ---------------------------------------------------------------------------

create or replace function pg_temp.reader_id(p_n int) returns uuid
language sql immutable as $$ select ('ad000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;

do $$
declare
  n int;
  k int;
  v_id uuid;
  v_topics text[] := array['business','finance','tech_ai','law','medicine','engineering','sport_business','culture_media'];
  v_minis text[] := array['finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations'];
begin
  for n in 1..63 loop
    v_id := pg_temp.reader_id(n);
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
      confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000',v_id,'authenticated','authenticated','pp-'||n||'@example.test','x',
      now(),now(),now(),'','','','','{}','{}');
    insert into public.profiles(id,email,language,timezone)
    values (v_id,'pp-'||n||'@example.test',case when n % 2 = 0 then 'fr' else 'en' end,'Europe/Paris');

    continue when n > 60;

    insert into public.user_preferences(user_id,newsletter_enabled,business_stories_enabled,mini_cases_enabled,
      newsletter_article_count,learning_path_choice_completed)
    -- Reader 59 has every module off: a drop with no items.
    values (v_id, n % 7 <> 0 and n <> 59, n % 5 <> 0 and n <> 59, n % 3 <> 0 and n <> 59, 1 + (n * 5) % 24, true);

    for k in 1..8 loop
      -- A varying subset of topics, some disabled, some without a position,
      -- positions that collide (tie broken by topic_id), 1-3 articles each.
      continue when ((n * 37 + k * 11) % 5) = 0;
      insert into public.user_topic_preferences(user_id,topic_id,articles_count,enabled,position)
      values (v_id, v_topics[k], 1 + (n + k) % 3, (n + k) % 4 <> 0,
              case when (n + k) % 5 = 0 then null else ((k * 7 + n) % 4) + 1 end);
    end loop;

    for k in 1..6 loop
      continue when ((n * 13 + k * 7) % 3) = 0;
      insert into public.user_mini_case_topic_preferences(user_id,topic_id,enabled,position)
      values (v_id, v_minis[k], (n + k) % 5 <> 0,
              case when (n + k) % 4 = 0 then null else ((k * 5 + n) % 3) + 1 end);
    end loop;
  end loop;
end $$;

-- What a reader's edition IS, in terms both batches share: slot, position, the
-- job that produced the item, its language.
create temp table pp_jobs (tag text, job_id uuid, idx int);
insert into pp_jobs
select tag, pg_temp.job_id(tag, i), i
from unnest(array['A','B','C','D','E']) tag, generate_series(1, 23) i;

create or replace function pg_temp.edition_of(p_user uuid, p_date date) returns text language sql as $$
  select coalesce(string_agg(
           ddi.slot || ':' || ddi.position || ':' || j.idx || ':' || ci.language,
           ',' order by ddi.slot, ddi.position), 'none')
  from public.daily_drops dd
  join public.daily_drop_items ddi on ddi.daily_drop_id = dd.id
  join public.content_items ci on ci.id = ddi.content_item_id
  join pp_jobs j on j.job_id = (ci.metadata->>'staging_job_id')::uuid
  where dd.user_id = p_user and dd.drop_date = p_date;
$$;

create or replace function pg_temp.drop_of(p_user uuid, p_date date) returns text language sql as $$
  select coalesce((select dd.language || ':' || dd.status || ':' || dd.hide_display_date
                   from public.daily_drops dd where dd.user_id = p_user and dd.drop_date = p_date), 'no-drop');
$$;

-- Readers whose editions differ between two dates.
create or replace function pg_temp.mismatches(p_old date, p_new date) returns text language sql as $$
  select coalesce(string_agg(n::text, ',' order by n), '')
  from generate_series(1, 63) n
  where pg_temp.edition_of(pg_temp.reader_id(n), p_old) is distinct from pg_temp.edition_of(pg_temp.reader_id(n), p_new)
     or pg_temp.drop_of(pg_temp.reader_id(n), p_old) is distinct from pg_temp.drop_of(pg_temp.reader_id(n), p_new);
$$;

-- The publisher's own report, minus what legitimately differs (ids, dates, run).
create or replace function pg_temp.counts(p jsonb) returns text language sql immutable as $$
  select concat_ws('|', p->>'published', p->>'items_written', p->>'items_reused', p->>'source_links_written',
                   p->>'daily_drops_written', p->>'daily_drop_items_written',
                   p->>'retry_of_published_edition', p->>'daily_drops_kept')
$$;

create temp table pp_runs (label text, result jsonb);

-- Without --with-migrations there is no per-reader publisher to compare with,
-- and "new equals new" would pass for nothing. Say so instead.
select pg_temp.record(0, 'S0 _v1 really is the per-reader publisher (run with --with-migrations)', 'true',
  (pg_get_functiondef('public.publish_scheduled_staging_payload_v1(jsonb,text)'::regprocedure) ~* 'for\s+v_user\s+in')::text);

-- ---------------------------------------------------------------------------
-- P. First publication: old on 2031-03-03, new on 2031-03-05
-- ---------------------------------------------------------------------------

insert into pp_runs values
  ('old-1', public.publish_scheduled_staging_payload_v1(
     pg_temp.payload('A', 'ad000000-0000-4000-8000-0000000000a1', '2031-03-03'), 'pp-old-1'));
insert into pp_runs values
  ('new-1', public.publish_scheduled_staging_payload(
     pg_temp.payload('B', 'ad000000-0000-4000-8000-0000000000b1', '2031-03-05'), 'pp-new-1'));

select pg_temp.record(1, 'P1 the publisher reports the same counts',
  (select pg_temp.counts(result) from pp_runs where label = 'old-1'),
  (select pg_temp.counts(result) from pp_runs where label = 'new-1'));

select pg_temp.record(2, 'P2 every reader has the same edition (slot, position, job, language) and drop', '',
  pg_temp.mismatches('2031-03-03', '2031-03-05'));

select pg_temp.record(3, 'P3 the fixture is not trivial: 60 drops, readers without preferences get none', '60|0',
  (select count(*) from public.daily_drops where drop_date = '2031-03-05'
     and user_id in (select pg_temp.reader_id(n) from generate_series(1, 60) n))::text || '|' ||
  (select count(*) from public.daily_drops where drop_date = '2031-03-05'
     and user_id in (pg_temp.reader_id(61), pg_temp.reader_id(62), pg_temp.reader_id(63)))::text);

select pg_temp.record(4, 'P4 it covers capped, empty and full newsletters, and every slot', 'true',
  (exists (select 1 from generate_series(1,60) n where pg_temp.edition_of(pg_temp.reader_id(n), '2031-03-05') not like '%newsletter%')
   and exists (select 1 from generate_series(1,60) n where pg_temp.edition_of(pg_temp.reader_id(n), '2031-03-05') like '%newsletter:5:%')
   and exists (select 1 from generate_series(1,60) n where pg_temp.edition_of(pg_temp.reader_id(n), '2031-03-05') like '%business_story:0:%')
   and exists (select 1 from generate_series(1,60) n where pg_temp.edition_of(pg_temp.reader_id(n), '2031-03-05') like '%mini_case:0:%')
   and exists (select 1 from generate_series(1,60) n where pg_temp.edition_of(pg_temp.reader_id(n), '2031-03-05') = 'none'))::text);

select pg_temp.record(5, 'P5 the edition registry records the publishing batch, like the old publisher', 'true',
  ((select staging_batch_id from public.editions where edition_date = '2031-03-05') = 'ad000000-0000-4000-8000-0000000000b1'
   and (select staging_batch_id from public.editions where edition_date = '2031-03-03') = 'ad000000-0000-4000-8000-0000000000a1')::text);

select pg_temp.record(6, 'P6 one notification event per edition, as before', '1|1',
  (select count(*) from public.notification_outbox where event_date = '2031-03-03' and event_type = 'edition_published')::text || '|' ||
  (select count(*) from public.notification_outbox where event_date = '2031-03-05' and event_type = 'edition_published')::text);

-- A concrete reader worked out by hand from the fixture formulas, so parity is
-- not just "both wrong the same way". Reader 10 (fr), newsletter on (cap 3),
-- story off, mini cases on.
--   topics, enabled, by position: business (2, up to 2 articles), then
--   culture_media and law tied at 3 → topic_id order → culture_media (1).
--   business articles by ordinal: job 3 (ordinal 1), job 2 (ordinal 2); the
--   cap of 3 stops before law. culture_media's ordinal-1 article is job 17.
--   mini topics: finance_economy and law_compliance tied at position 1 →
--   finance_economy → job 18.
select pg_temp.record(7, 'P7 reader 10, old publisher, matches the rules worked by hand',
  'mini_case:0:18:fr,newsletter:0:3:fr,newsletter:1:2:fr,newsletter:2:17:fr',
  pg_temp.edition_of(pg_temp.reader_id(10), '2031-03-03'));
select pg_temp.record(8, 'P8 reader 10, new publisher, the same',
  'mini_case:0:18:fr,newsletter:0:3:fr,newsletter:1:2:fr,newsletter:2:17:fr',
  pg_temp.edition_of(pg_temp.reader_id(10), '2031-03-05'));

-- ---------------------------------------------------------------------------
-- R. A retry of the same batch, then a partial refill
-- ---------------------------------------------------------------------------

insert into pp_runs values
  ('old-2', public.publish_scheduled_staging_payload_v1(
     pg_temp.payload('A', 'ad000000-0000-4000-8000-0000000000a1', '2031-03-03'), 'pp-old-2'));
insert into pp_runs values
  ('new-2', public.publish_scheduled_staging_payload(
     pg_temp.payload('B', 'ad000000-0000-4000-8000-0000000000b1', '2031-03-05'), 'pp-new-2'));

select pg_temp.record(10, 'R1 a full retry reports the same (all kept, nothing written)',
  (select pg_temp.counts(result) from pp_runs where label = 'old-2'),
  (select pg_temp.counts(result) from pp_runs where label = 'new-2'));

select pg_temp.record(11, 'R2 and changes no edition', '0|0',
  (select (r->>'daily_drops_written') || '|' || (r->>'daily_drop_items_written')
   from (select result r from pp_runs where label = 'new-2') x));

-- A failed attempt reached only some readers: remove a third of the drops (the
-- operator override, as a recovery would), then retry the same batch.
select set_config('personews.allow_edition_rewrite', 'on', true);
delete from public.daily_drops
where drop_date in ('2031-03-03', '2031-03-05')
  and user_id in (select pg_temp.reader_id(n) from generate_series(1, 60) n where n % 3 = 1);
select set_config('personews.allow_edition_rewrite', '', true);

insert into pp_runs values
  ('old-3', public.publish_scheduled_staging_payload_v1(
     pg_temp.payload('A', 'ad000000-0000-4000-8000-0000000000a1', '2031-03-03'), 'pp-old-3'));
insert into pp_runs values
  ('new-3', public.publish_scheduled_staging_payload(
     pg_temp.payload('B', 'ad000000-0000-4000-8000-0000000000b1', '2031-03-05'), 'pp-new-3'));

select pg_temp.record(12, 'R3 a partial retry refills the same readers with the same counts',
  (select pg_temp.counts(result) from pp_runs where label = 'old-3'),
  (select pg_temp.counts(result) from pp_runs where label = 'new-3'));

select pg_temp.record(13, 'R4 the refill writes exactly the 20 removed drops; every other reader is kept', '20|true',
  (select (r->>'daily_drops_written') || '|' ||
          ((r->>'daily_drops_kept')::int =
             (select count(*) from public.daily_drops where drop_date = '2031-03-05') - 20)::text
   from (select result r from pp_runs where label = 'new-3') x));

select pg_temp.record(14, 'R5 every reader still has the same edition afterwards', '',
  pg_temp.mismatches('2031-03-03', '2031-03-05'));

-- ---------------------------------------------------------------------------
-- U. A drop that predates its registry row is reassigned from scratch
-- ---------------------------------------------------------------------------
-- Old rows from before the editions registry: a drop exists, the registry does
-- not know the date. Both publishers must upsert it and replace its items.

select set_config('personews.allow_edition_rewrite', 'on', true);
insert into public.daily_drops(user_id, drop_date, language, status, generated_at, published_at, hide_display_date)
values (pg_temp.reader_id(4), '2031-03-10', 'en', 'published', now(), now(), true),
       (pg_temp.reader_id(4), '2031-03-12', 'en', 'published', now(), now(), true);
insert into public.daily_drop_items(daily_drop_id, content_item_id, slot, position)
select dd.id, (select ci.id from public.content_items ci
               where ci.metadata->>'staging_job_id' = pg_temp.job_id('A', 2)::text and ci.language = 'en'),
       'newsletter', 7
from public.daily_drops dd where dd.user_id = pg_temp.reader_id(4) and dd.drop_date in ('2031-03-10', '2031-03-12');
delete from public.editions where edition_date in ('2031-03-10', '2031-03-12');
select set_config('personews.allow_edition_rewrite', '', true);

insert into pp_runs values
  ('old-4', public.publish_scheduled_staging_payload_v1(
     pg_temp.payload('C', 'ad000000-0000-4000-8000-0000000000c1', '2031-03-10'), 'pp-old-4'));
insert into pp_runs values
  ('new-4', public.publish_scheduled_staging_payload(
     pg_temp.payload('D', 'ad000000-0000-4000-8000-0000000000d1', '2031-03-12'), 'pp-new-4'));

select pg_temp.record(20, 'U1 the same counts when an old drop is upserted',
  (select pg_temp.counts(result) from pp_runs where label = 'old-4'),
  (select pg_temp.counts(result) from pp_runs where label = 'new-4'));

select pg_temp.record(21, 'U2 the old drop is reassigned identically (stale item gone, date shown again)', '',
  pg_temp.mismatches('2031-03-10', '2031-03-12'));

select pg_temp.record(22, 'U3 the stale item is gone', 'false',
  (pg_temp.edition_of(pg_temp.reader_id(4), '2031-03-12') like '%:2:en%' and
   pg_temp.edition_of(pg_temp.reader_id(4), '2031-03-12') like '%newsletter:7:%')::text);

-- ---------------------------------------------------------------------------
-- V. Provenance from the staging identity binding (staging 20261005190000)
-- ---------------------------------------------------------------------------
-- The plan stamps output_id and review_id on every job; production keeps them
-- on the content it writes. A payload from an older plan (no review_id) still
-- publishes, with NULL there.

insert into pp_runs values
  ('new-prov', public.publish_scheduled_staging_payload(
     (select jsonb_set(p, '{jobs}', (select jsonb_agg(j || jsonb_build_object(
                'review_id', md5('review' || (j->>'job_id'))::uuid)) from jsonb_array_elements(p->'jobs') j))
      from (select pg_temp.payload('E', 'ad000000-0000-4000-8000-0000000000e1', '2031-03-17') as p) x),
     'pp-new-prov'));

select pg_temp.record(25, 'V1 every published item records the verified output and review ids', '46|46',
  (select count(*) filter (where ci.metadata->>'staging_output_id' = md5('outE' || j.idx)::uuid::text)::text || '|' ||
          count(*) filter (where ci.metadata->>'staging_review_id' = md5('review' || (ci.metadata->>'staging_job_id'))::uuid::text)::text
   from public.content_items ci
   join pp_jobs j on j.job_id = (ci.metadata->>'staging_job_id')::uuid and j.tag = 'E'
   where ci.metadata->>'staging_batch_id' = 'ad000000-0000-4000-8000-0000000000e1'));

select pg_temp.record(26, 'V2 a payload without review ids still publishes (older plan)', 'true',
  (select (result->>'published') from pp_runs where label = 'new-1'));

-- ---------------------------------------------------------------------------
-- S. Shape of the new function
-- ---------------------------------------------------------------------------

select pg_temp.record(30, 'S1 no per-reader loop remains', 'false',
  (pg_get_functiondef('public.publish_scheduled_staging_payload(jsonb,text)'::regprocedure) ~* 'for\s+v_user\s+in')::text);

select pg_temp.record(31, 'S2 the immutability guard and both locks are still taken', 'true',
  (pg_get_functiondef('public.publish_scheduled_staging_payload(jsonb,text)'::regprocedure) like '%personews.publishing_batch_id%'
   and pg_get_functiondef('public.publish_scheduled_staging_payload(jsonb,text)'::regprocedure) like '%personews:edition:%')::text);

select pg_temp.record(32, 'S3 only the service role may call it', 'false|false|true',
  has_function_privilege('anon', 'public.publish_scheduled_staging_payload(jsonb,text)', 'execute')::text || '|' ||
  has_function_privilege('authenticated', 'public.publish_scheduled_staging_payload(jsonb,text)', 'execute')::text || '|' ||
  has_function_privilege('service_role', 'public.publish_scheduled_staging_payload(jsonb,text)', 'execute')::text);

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from pp_results) as checks,
  (select count(*) from pp_results where pass) as passed,
  (select count(*) from pp_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from pp_results where not pass) as failures;

rollback;
