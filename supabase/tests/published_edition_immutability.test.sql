-- Published edition immutability — PRODUCTION project.
--
-- Proves 20261005130000_published_edition_immutability: once an edition date is
-- published, its reader assignments (daily_drops, daily_drop_items) and its
-- registry row cannot be rewritten by ordinary paths. The canonical publisher
-- may re-run the SAME batch to fill readers it did not reach; a different batch
-- is refused; an operator override exists, is off by default and is
-- transaction-local; account deletion still cascades.
--
-- Unlike the refusal suite (scheduled_edition_publication.test.sql) this one
-- PUBLISHES, inside one transaction that ends in ROLLBACK. Nothing persists.
--
-- Run locally:
--   node scripts/local-sql-tests.mjs edition-immutability --with-migrations
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table im_results (seq int, test text, expectation text, observed text, pass boolean);
grant all on im_results to public;

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into im_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

-- Run a statement and report 'ok:<rows>' or the SQLSTATE it raised. Writes it
-- makes are kept.
create or replace function pg_temp.attempt(p_sql text) returns text
language plpgsql as $$
declare v_rows bigint;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return 'ok:' || v_rows;
exception when others then
  return sqlstate;
end;
$$;

-- Same, but always undone afterwards (the subtransaction is rolled back).
create or replace function pg_temp.attempt_and_undo(p_sql text) returns text
language plpgsql as $$
declare v_rows bigint; v_outcome text;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_outcome := 'ok:' || v_rows;
    raise exception using errcode = 'P0U01', message = v_outcome;
  exception
    when sqlstate 'P0U01' then return v_outcome;
    when others then return sqlstate;
  end;
end;
$$;

grant execute on function pg_temp.record(int, text, text, text) to public;
grant execute on function pg_temp.attempt(text) to public;
grant execute on function pg_temp.attempt_and_undo(text) to public;

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

create or replace function pg_temp.reader(p_id uuid, p_lang text, p_news boolean, p_story boolean, p_mini boolean)
returns void language plpgsql as $$
begin
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
    confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000',p_id,'authenticated','authenticated','im-'||p_id||'@example.test','x',
    now(),now(),now(),'','','','','{}','{}');
  insert into public.profiles(id,email,language,timezone) values (p_id,'im-'||p_id||'@example.test',p_lang,'Europe/Paris');
  insert into public.user_preferences(user_id,newsletter_enabled,business_stories_enabled,mini_cases_enabled,
    newsletter_article_count,learning_path_choice_completed)
  values (p_id,p_news,p_story,p_mini,3,true);
  insert into public.user_topic_preferences(user_id,topic_id,articles_count,enabled,position)
  values (p_id,'tech_ai',2,true,1),(p_id,'law',1,true,2);
  insert into public.user_mini_case_topic_preferences(user_id,topic_id,enabled,position) values (p_id,'ai',true,1);
end $$;

create or replace function pg_temp.ra() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.rb() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.rc() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-00000000000c'::uuid $$;

-- What a reader's edition IS: their items, in order. Compared before and after.
create or replace function pg_temp.edition_of(p_user uuid) returns text language sql as $$
  select coalesce(string_agg(ddi.slot || ':' || ddi.position || ':' || ddi.content_item_id, ',' order by ddi.slot, ddi.position), 'none')
  from public.daily_drops dd join public.daily_drop_items ddi on ddi.daily_drop_id = dd.id
  where dd.user_id = p_user and dd.drop_date = '2027-01-04';
$$;

grant execute on function pg_temp.ra() to public;
grant execute on function pg_temp.rb() to public;
grant execute on function pg_temp.rc() to public;
grant execute on function pg_temp.edition_of(uuid) to public;

select pg_temp.reader(pg_temp.ra(), 'fr', true, true, true);
select pg_temp.reader(pg_temp.rb(), 'en', true, false, true);

-- One payload, kept, so a retry is the SAME batch with the SAME jobs.
create temp table im_payload as select pg_temp.payload() as p;
grant all on im_payload to public;

create temp table im_snapshot (label text, value text);
grant all on im_snapshot to public;

-- ---------------------------------------------------------------------------
-- O. The override is off unless someone turns it on
-- ---------------------------------------------------------------------------

select pg_temp.record(1, 'O1 the operator override is off by default', 'off',
  coalesce(nullif(current_setting('personews.allow_edition_rewrite', true), ''), 'off'));

-- ---------------------------------------------------------------------------
-- F. The first canonical publication
-- ---------------------------------------------------------------------------

set local role service_role;

do $$
declare v jsonb;
begin
  v := public.publish_scheduled_staging_payload((select p from im_payload), 'im-run-1');
  perform pg_temp.record(10, 'F1 the first publication succeeds', 'true|false',
    (v->>'published') || '|' || (v->>'retry_of_published_edition'));
end $$;

reset role;

select pg_temp.record(11, 'F2 both readers have an edition', 'true|true',
  (pg_temp.edition_of(pg_temp.ra()) <> 'none')::text || '|' || (pg_temp.edition_of(pg_temp.rb()) <> 'none')::text);

select pg_temp.record(12, 'F3 the edition records the batch that published it', '00000000-0000-4000-8000-000000000001',
  (select e.staging_batch_id::text from public.editions e where e.edition_date = '2027-01-04'));

select pg_temp.record(13, 'F4 the publishing batch does not outlive the publication call', 'true',
  (public.edition_publishing_batch() is null
   or public.edition_publishing_batch() = '00000000-0000-4000-8000-000000000001')::text);

select pg_temp.record(14, 'I1 the per-edition-date lock was taken', 'true',
  exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid()
      and l.objid::bigint = (hashtext('personews:edition:2027-01-04')::bigint & 4294967295)
  )::text);

insert into im_snapshot values
  ('ra', pg_temp.edition_of(pg_temp.ra())),
  ('rb', pg_temp.edition_of(pg_temp.rb()));

-- Leave the publishing transaction's own announcement behind, as a later,
-- separate caller would find it: nothing set.
select set_config('personews.publishing_batch_id', '', true);

-- ---------------------------------------------------------------------------
-- A. The same batch again (a retry after a timeout)
-- ---------------------------------------------------------------------------

-- A reader who signed up after the first attempt: the retry must reach them.
select pg_temp.reader(pg_temp.rc(), 'en', true, true, false);

set local role service_role;

do $$
declare v jsonb;
begin
  v := public.publish_scheduled_staging_payload((select p from im_payload), 'im-run-1');
  perform pg_temp.record(20, 'A1 a same-batch retry succeeds and knows it is a retry', 'true|true',
    (v->>'published') || '|' || (v->>'retry_of_published_edition'));
  perform pg_temp.record(21, 'A2 it creates no duplicate content', '0',
    v->>'items_written');
end $$;

reset role;
select set_config('personews.publishing_batch_id', '', true);

select pg_temp.record(22, 'A3 existing readers keep exactly the edition they had', 'true|true',
  ((select value from im_snapshot where label = 'ra') = pg_temp.edition_of(pg_temp.ra()))::text || '|' ||
  ((select value from im_snapshot where label = 'rb') = pg_temp.edition_of(pg_temp.rb()))::text);

select pg_temp.record(23, 'A4 a reader the first attempt missed is completed', 'true',
  (pg_temp.edition_of(pg_temp.rc()) <> 'none')::text);

select pg_temp.record(24, 'A5 one drop per reader, still', '1|1|1',
  concat_ws('|',
    (select count(*) from public.daily_drops where user_id = pg_temp.ra() and drop_date = '2027-01-04'),
    (select count(*) from public.daily_drops where user_id = pg_temp.rb() and drop_date = '2027-01-04'),
    (select count(*) from public.daily_drops where user_id = pg_temp.rc() and drop_date = '2027-01-04')));

-- ---------------------------------------------------------------------------
-- B / I. A different batch for the same date
-- ---------------------------------------------------------------------------

set local role service_role;

do $$
begin
  perform pg_temp.record(30, 'B1 a second batch for a published date is refused', '55000',
    pg_temp.attempt(format('select public.publish_scheduled_staging_payload(%L::jsonb, %L)',
      jsonb_set((select p from im_payload), '{batch,id}', '"00000000-0000-4000-8000-000000000002"'),
      'im-run-2')));
end $$;

reset role;

select pg_temp.record(31, 'B2 and the readers'' editions are untouched by it', 'true|true',
  ((select value from im_snapshot where label = 'ra') = pg_temp.edition_of(pg_temp.ra()))::text || '|' ||
  ((select value from im_snapshot where label = 'rb') = pg_temp.edition_of(pg_temp.rb()))::text);

select pg_temp.record(32, 'B3 the edition still belongs to the first batch', '00000000-0000-4000-8000-000000000001',
  (select e.staging_batch_id::text from public.editions e where e.edition_date = '2027-01-04'));

-- ---------------------------------------------------------------------------
-- C / D / E. Direct rewrites, as the service role the legacy paths use
-- ---------------------------------------------------------------------------

set local role service_role;

do $$
declare v_drop uuid; v_item uuid; v_other uuid;
begin
  select dd.id into v_drop from public.daily_drops dd where dd.user_id = pg_temp.ra() and dd.drop_date = '2027-01-04';
  select ddi.content_item_id into v_item from public.daily_drop_items ddi where ddi.daily_drop_id = v_drop and ddi.slot = 'newsletter' order by ddi.position limit 1;
  select ci.id into v_other from public.content_items ci
  where ci.metadata->>'staging_batch_id' = '00000000-0000-4000-8000-000000000001'
    and ci.content_type = 'newsletter_article' and ci.language = 'fr' and ci.topic_id = 'medicine' limit 1;

  -- The legacy daily job: contentRepository.insertDailyDrop then replaceDailyDropItems.
  perform pg_temp.record(40, 'C1 the legacy upsert of a reader''s drop is refused', '55000',
    pg_temp.attempt(format(
      'insert into public.daily_drops(user_id,drop_date,language,status,published_at,updated_at) '
      'values (%L,%L,%L,%L,now(),now()) on conflict (user_id,drop_date) do update set status = excluded.status, updated_at = now()',
      pg_temp.ra(), '2027-01-04', 'fr', 'published')));

  perform pg_temp.record(41, 'C2 a legacy drop for a new reader on a published date is refused too', '55000',
    pg_temp.attempt(format(
      'insert into public.daily_drops(user_id,drop_date,language,status) values ((select id from public.profiles where id not in (select user_id from public.daily_drops where drop_date = %L) limit 1),%L,%L,%L)',
      '2027-01-04', '2027-01-04', 'en', 'published')));

  perform pg_temp.record(42, 'D1 deleting a published reader''s items is refused', '55000',
    pg_temp.attempt(format('delete from public.daily_drop_items where daily_drop_id = %L', v_drop)));

  perform pg_temp.record(43, 'E1 replacing an item in place is refused', '55000',
    pg_temp.attempt(format('update public.daily_drop_items set content_item_id = %L where daily_drop_id = %L and content_item_id = %L',
      v_other, v_drop, v_item)));

  perform pg_temp.record(44, 'E2 adding an item to a published drop is refused', '55000',
    pg_temp.attempt(format('insert into public.daily_drop_items(daily_drop_id,content_item_id,slot,position) values (%L,%L,%L,%L)',
      v_drop, v_other, 'newsletter', 9)));

  perform pg_temp.record(45, 'E3 moving a drop to another date is refused', '55000',
    pg_temp.attempt(format('update public.daily_drops set drop_date = %L where id = %L', '2027-01-06', v_drop)));

  perform pg_temp.record(46, 'E4 deleting a reader''s drop is refused', '55000',
    pg_temp.attempt(format('delete from public.daily_drops where id = %L', v_drop)));

  perform pg_temp.record(47, 'E5 the edition record cannot be changed or removed', '55000|55000',
    pg_temp.attempt('update public.editions set published_at = now() where edition_date = ''2027-01-04''')
    || '|' || pg_temp.attempt('delete from public.editions where edition_date = ''2027-01-04'''));

  -- A different publishing batch announcing itself is no key either.
  perform set_config('personews.publishing_batch_id', '00000000-0000-4000-8000-000000000002', true);
  perform pg_temp.record(48, 'E6 announcing another batch does not open the date', '55000',
    pg_temp.attempt(format('delete from public.daily_drop_items where daily_drop_id = %L', v_drop)));
  perform set_config('personews.publishing_batch_id', '', true);

  -- -------------------------------------------------------------------------
  -- H. The deliberate operator override
  -- -------------------------------------------------------------------------

  perform set_config('personews.allow_edition_rewrite', 'on', true);
  perform pg_temp.record(50, 'H1 with the override on, an operator repair goes through', 'ok:1',
    pg_temp.attempt_and_undo(format('update public.daily_drop_items set content_item_id = %L where daily_drop_id = %L and content_item_id = %L',
      v_other, v_drop, v_item)));
  perform set_config('personews.allow_edition_rewrite', 'off', true);

  perform pg_temp.record(51, 'H2 and once it is off again, it is refused again', '55000',
    pg_temp.attempt(format('update public.daily_drop_items set content_item_id = %L where daily_drop_id = %L and content_item_id = %L',
      v_other, v_drop, v_item)));

  perform pg_temp.record(52, 'H3 a value other than ''on'' is not an override', '55000',
    (select pg_temp.attempt(format('delete from public.daily_drop_items where daily_drop_id = %L', v_drop))
     from (select set_config('personews.allow_edition_rewrite', 'true', true)) s));
  perform set_config('personews.allow_edition_rewrite', '', true);
end $$;

reset role;

select pg_temp.record(53, 'H4 nothing the refused statements tried actually changed the edition', 'true',
  ((select value from im_snapshot where label = 'ra') = pg_temp.edition_of(pg_temp.ra()))::text);

-- ---------------------------------------------------------------------------
-- G. Tail-stage recovery still works after publication
-- ---------------------------------------------------------------------------

set local role service_role;

do $$
begin
  perform pg_temp.record(60, 'G1 materialize_edition_assignments can run (and re-run) on a published date', 'ok|ok',
    (case when public.materialize_edition_assignments('2027-01-04') is not null then 'ok' else 'null' end) || '|' ||
    (case when public.materialize_edition_assignments('2027-01-04') is not null then 'ok' else 'null' end));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- X. Erasure is never blocked
-- ---------------------------------------------------------------------------

select pg_temp.record(70, 'X1 deleting an account is not blocked by its published drops', 'ok:1',
  pg_temp.attempt(format('delete from auth.users where id = %L', pg_temp.rb())));

-- A separate statement: the count must see the deletion above.
select pg_temp.record(71, 'X2 and its published drops are gone with it', '0',
  (select count(*)::text from public.daily_drops where user_id = pg_temp.rb()));

-- ---------------------------------------------------------------------------
-- U. An unpublished date is not affected
-- ---------------------------------------------------------------------------

set local role service_role;

do $$
begin
  perform pg_temp.record(80, 'U1 a date with no edition stays writable', 'ok:1|ok:1',
    pg_temp.attempt_and_undo(format(
      'insert into public.daily_drops(user_id,drop_date,language,status) values (%L,%L,%L,%L)',
      pg_temp.ra(), '2027-02-01', 'fr', 'generated'))
    || '|' ||
    pg_temp.attempt_and_undo(format(
      'insert into public.daily_drops(user_id,drop_date,language,status) values (%L,%L,%L,%L)',
      pg_temp.ra(), '2027-02-02', 'fr', 'generated')));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from im_results) as checks,
  (select count(*) from im_results where pass) as passed,
  (select count(*) from im_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from im_results where not pass) as failures;

rollback;
