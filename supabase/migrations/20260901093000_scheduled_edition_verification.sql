-- Scheduled edition verification — PRODUCTION project (wkbviidrbmehmjbhvpeh).
--
-- `publish_scheduled_staging_payload` returning `published: true` means the
-- transaction committed. It does not, by itself, mean the edition a reader will
-- open tomorrow morning is complete. The scheduled publisher must be able to go
-- and look, from outside that transaction, before it writes a receipt in staging
-- saying the job is done.
--
-- This function is the looking. It is read-only, deterministic, and it answers
-- with counts rather than an opinion.

begin;

create or replace function public.verify_scheduled_edition(
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
  c_mini_case_topics constant text[] := array[
    'finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations'
  ];
  v_batch_key constant text := p_batch_id::text;
  v_problems jsonb := '[]'::jsonb;
  v_news_fr integer; v_news_en integer;
  v_story_fr integer; v_story_en integer;
  v_mini_fr integer; v_mini_en integer;
  v_total integer;
  v_distinct_dedup integer;
  v_unpaired integer;
  v_wrong_date integer;
  v_missing_links integer;
  v_source_links integer;
  v_drops integer;
  v_drop_items integer;
  v_mini_topics text[];
  v_run_mismatch integer;
begin
  select
    count(*) filter (where content_type='newsletter_article' and language='fr'),
    count(*) filter (where content_type='newsletter_article' and language='en'),
    count(*) filter (where content_type='business_story' and language='fr'),
    count(*) filter (where content_type='business_story' and language='en'),
    count(*) filter (where content_type='mini_case' and language='fr'),
    count(*) filter (where content_type='mini_case' and language='en'),
    count(*),
    count(distinct metadata->>'dedup_key')
  into v_news_fr, v_news_en, v_story_fr, v_story_en, v_mini_fr, v_mini_en, v_total, v_distinct_dedup
  from public.content_items
  where status='published'
    and metadata->>'staging_batch_id' = v_batch_key;

  if v_news_fr <> 16 or v_news_en <> 16 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','newsletter_count_mismatch',
      'detail', format('newsletter items fr=%s en=%s, expected 16/16', v_news_fr, v_news_en)));
  end if;

  if v_story_fr <> 1 or v_story_en <> 1 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','business_story_count_mismatch',
      'detail', format('business story items fr=%s en=%s, expected 1/1', v_story_fr, v_story_en)));
  end if;

  if v_mini_fr <> 6 or v_mini_en <> 6 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','mini_case_count_mismatch',
      'detail', format('mini case items fr=%s en=%s, expected 6/6', v_mini_fr, v_mini_en)));
  end if;

  if v_total <> 46 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','item_count_mismatch',
      'detail', format('%s published items carry this batch, expected 46', v_total)));
  end if;

  -- Two items sharing a dedup key would mean the same job was written twice.
  if v_distinct_dedup <> v_total then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','duplicate_items',
      'detail', format('%s items but only %s distinct dedup keys', v_total, v_distinct_dedup)));
  end if;

  -- Every job must have produced exactly one FR and one EN item.
  select count(*) into v_unpaired
  from (
    select metadata->>'staging_job_id' as job_id,
           count(*) filter (where language='fr') as fr,
           count(*) filter (where language='en') as en
    from public.content_items
    where status='published' and metadata->>'staging_batch_id' = v_batch_key
    group by 1
  ) p
  where p.fr <> 1 or p.en <> 1;

  if v_unpaired > 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','fr_en_pair_incomplete',
      'detail', format('%s job(s) do not have exactly one FR and one EN item', v_unpaired)));
  end if;

  -- Atomicity: this batch must have touched exactly one edition date.
  select count(*) into v_wrong_date
  from public.content_items
  where metadata->>'staging_batch_id' = v_batch_key
    and publication_date <> p_edition_date;

  if v_wrong_date > 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','other_edition_date_touched',
      'detail', format('%s item(s) from this batch carry a publication_date other than %s',
        v_wrong_date, p_edition_date)));
  end if;

  if p_run_id is not null then
    select count(*) into v_run_mismatch
    from public.content_items
    where metadata->>'scheduler_run_id' = p_run_id
      and (publication_date <> p_edition_date or metadata->>'staging_batch_id' <> v_batch_key);

    if v_run_mismatch > 0 then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'code','run_wrote_outside_edition',
        'detail', format('%s item(s) written by run %s fall outside this edition', v_run_mismatch, p_run_id)));
    end if;
  end if;

  -- Source links: the citation trail must exist for every item.
  select count(*) into v_missing_links
  from public.content_items ci
  where ci.status='published'
    and ci.metadata->>'staging_batch_id' = v_batch_key
    and not exists (select 1 from public.content_item_sources s where s.content_item_id = ci.id);

  if v_missing_links > 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','source_links_missing',
      'detail', format('%s item(s) have no content_item_sources row', v_missing_links)));
  end if;

  select count(*) into v_source_links
  from public.content_item_sources s
  join public.content_items ci on ci.id = s.content_item_id
  where ci.metadata->>'staging_batch_id' = v_batch_key;

  -- The six product topics, present once per language.
  select coalesce(array_agg(distinct metadata->>'product_topic' order by metadata->>'product_topic'), array[]::text[])
  into v_mini_topics
  from public.content_items
  where status='published' and metadata->>'staging_batch_id' = v_batch_key and content_type='mini_case';

  if v_mini_topics is distinct from (select array_agg(t order by t) from unnest(c_mini_case_topics) t) then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','mini_case_topics_incomplete',
      'detail', format('published mini case topics are %s', array_to_string(v_mini_topics, ','))));
  end if;

  -- Daily drops for the edition date.
  select count(*) into v_drops
  from public.daily_drops
  where drop_date = p_edition_date and status = 'published';

  select count(*) into v_drop_items
  from public.daily_drop_items di
  join public.daily_drops d on d.id = di.daily_drop_id
  where d.drop_date = p_edition_date;

  if v_drops = 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','daily_drops_missing',
      'detail', format('no published daily_drops exist for %s', p_edition_date)));
  end if;

  if v_drop_items = 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'code','daily_drop_items_missing',
      'detail', format('daily_drops for %s hold no items', p_edition_date)));
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_problems) = 0,
    'edition_date', p_edition_date,
    'batch_id', p_batch_id,
    'run_id', p_run_id,
    'items', jsonb_build_object(
      'total', v_total,
      'newsletter_fr', v_news_fr, 'newsletter_en', v_news_en,
      'business_story_fr', v_story_fr, 'business_story_en', v_story_en,
      'mini_case_fr', v_mini_fr, 'mini_case_en', v_mini_en,
      'distinct_dedup_keys', v_distinct_dedup),
    'source_links', v_source_links,
    'daily_drops', v_drops,
    'daily_drop_items', v_drop_items,
    'mini_case_topics', to_jsonb(v_mini_topics),
    'problems', v_problems
  );
end;
$function$;

comment on function public.verify_scheduled_edition(date, uuid, text) is
  'Read-only proof that a scheduled edition actually landed: 16/1/6 per language, FR+EN paired, source links, daily drops, no duplicates, no other edition date touched.';

revoke all on function public.verify_scheduled_edition(date, uuid, text) from public, anon, authenticated;
grant execute on function public.verify_scheduled_edition(date, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Published-quality trigger, restated at the CURRENT bounds.
-- ---------------------------------------------------------------------------
-- This function was created directly against the production database and never
-- existed in this repository, which means a future `supabase db push` had
-- nothing to say about it. It is written down here at the bounds the runtime
-- actually enforces today — newsletter 220-275 words — so that replaying this
-- repository's migrations can only ever reassert those. The superseded 120-220
-- range is deliberately absent and must never come back: the generators, the
-- staging preflight (`validate_generation_output`) and the review policy all
-- target 220-275, and a trigger at 120-220 would reject every correct article.

create or replace function public.enforce_personews_published_quality()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_words integer;
  v_expected_topic text;
begin
  if new.status <> 'published' then return new; end if;

  if coalesce(new.metadata->>'persisted_by','') <> 'public.publish_scheduled_staging_payload'
     and coalesce(new.metadata->>'preview_mode','') <> 'business_story' then
    return new;
  end if;

  select count(*) into v_words
  from regexp_split_to_table(trim(coalesce(new.body_md,'')), E'\\s+') w
  where w <> '';

  if new.content_type='newsletter_article' and (v_words < 220 or v_words > 275) then
    raise exception 'published newsletter body word count % outside 220-275', v_words;
  elsif new.content_type='business_story' then
    if v_words < 750 or v_words > 950 then
      raise exception 'published business story body word count % outside 750-950', v_words;
    end if;
    if coalesce(new.source_count,0) < 2 then
      raise exception 'published business story requires at least 2 sources';
    end if;
    if new.topic_id <> 'business' then
      raise exception 'published business story topic must be business, got %',new.topic_id;
    end if;
  elsif new.content_type='mini_case' then
    if v_words < 200 or v_words > 320 then
      raise exception 'published mini case body word count % outside 200-320',v_words;
    end if;
    v_expected_topic := case new.metadata->>'product_topic'
      when 'finance_economy' then 'finance'
      when 'stock_market' then 'finance'
      when 'ai' then 'tech_ai'
      when 'law_compliance' then 'law'
      when 'health_pharma' then 'medicine'
      when 'engineering_operations' then 'engineering'
      else null
    end;
    if v_expected_topic is null or new.topic_id <> v_expected_topic then
      raise exception 'published mini case topic mismatch: product_topic %, topic_id %, expected %',
        new.metadata->>'product_topic',new.topic_id,v_expected_topic;
    end if;
  end if;

  return new;
end;
$function$;

commit;
