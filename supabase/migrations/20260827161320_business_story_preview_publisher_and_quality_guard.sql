-- Recovered from the production database on 2026-09-01.
--
-- This migration was applied to wkbviidrbmehmjbhvpeh directly and never had a
-- file here, so `supabase db push` refused to run at all: it will not touch a
-- database holding migrations it cannot see. The SQL below is the statement
-- recorded verbatim in supabase_migrations.schema_migrations for this version —
-- read back, not reconstructed. No database was changed to create this file.

create or replace function public.enforce_personews_published_quality()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
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

  if new.content_type='newsletter_article' and (v_words < 120 or v_words > 220) then
    raise exception 'published newsletter body word count % outside 120-220', v_words;
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
$$;

drop trigger if exists trg_enforce_personews_published_quality on public.content_items;
create trigger trg_enforce_personews_published_quality
before insert or update of body_md,content_type,topic_id,status,source_count,metadata
on public.content_items
for each row execute function public.enforce_personews_published_quality();

create or replace function public.publish_business_story_preview(
  p_payload jsonb,
  p_run_id text,
  p_preview_date date default current_date
)
returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_output jsonb;
  v_sources jsonb;
  v_review jsonb;
  v_checks jsonb;
  v_lang text;
  v_item jsonb;
  v_body text;
  v_words integer;
  v_section_words integer;
  v_sections_total integer;
  v_source_rec jsonb;
  v_source_url text;
  v_source_id uuid;
  v_content_id uuid;
  v_fr_id uuid;
  v_en_id uuid;
  v_drop_id uuid;
  v_user record;
  v_links integer := 0;
  v_drops integer := 0;
  v_drop_items integer := 0;
  v_source_count integer;
  v_dedup_key text;
  v_metadata jsonb;
begin
  if nullif(trim(coalesce(p_run_id,'')),'') is null then
    raise exception 'preview publish refused: run_id required';
  end if;
  if p_preview_date is null then raise exception 'preview publish refused: preview_date required'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'preview publish refused: payload object required'; end if;

  v_output := p_payload->'output_json';
  v_sources := p_payload->'source_records';
  v_review := p_payload->'review';
  v_checks := v_review->'checks';

  if jsonb_typeof(v_output) <> 'object' or not (v_output ? 'fr') or not (v_output ? 'en') then
    raise exception 'preview publish refused: bilingual output required';
  end if;
  if jsonb_typeof(v_sources) <> 'array' or jsonb_array_length(v_sources) < 2 then
    raise exception 'preview publish refused: at least two source records required';
  end if;
  if coalesce(v_review->>'verdict','') <> 'approved' or coalesce((v_review->>'score')::int,0) < 90 then
    raise exception 'preview publish refused: approved review >=90 required';
  end if;
  if coalesce((v_checks->>'source_grounding')::boolean,false) is not true
     or coalesce((v_checks->>'factual_accuracy')::boolean,false) is not true
     or coalesce((v_checks->>'safety')::boolean,false) is not true
     or coalesce((v_checks->>'schema')::boolean,false) is not true
     or coalesce((v_checks->>'fr_en_parity')::boolean,false) is not true
     or coalesce((v_checks->>'novelty_anti_repetition')::boolean,false) is not true then
    raise exception 'preview publish refused: critical review checks must all pass';
  end if;

  -- Validate both language items before writing anything.
  foreach v_lang in array array['fr','en'] loop
    v_item := v_output->v_lang;
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item->>'content_type','') <> 'business_story'
       or coalesce(v_item->>'slot','') <> 'business_story'
       or coalesce(v_item->>'language','') <> v_lang
       or coalesce(v_item->>'topic','') <> 'business' then
      raise exception 'preview publish refused: % identity mismatch',v_lang;
    end if;
    if nullif(trim(v_item->>'title'),'') is null or nullif(trim(v_item->>'body_md'),'') is null then
      raise exception 'preview publish refused: % title/body missing',v_lang;
    end if;
    if jsonb_typeof(v_item->'source_urls') <> 'array' or jsonb_array_length(v_item->'source_urls') < 2 then
      raise exception 'preview publish refused: % requires at least two source URLs',v_lang;
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(v_item->'source_urls') u(url)
      where not exists (select 1 from jsonb_array_elements(v_sources) s where s->>'url'=u.url)
    ) then
      raise exception 'preview publish refused: % cites unrecorded source',v_lang;
    end if;

    v_body := v_item->>'body_md';
    select count(*) into v_words from regexp_split_to_table(trim(v_body),E'\\s+') w where w<>'';
    if v_words < 750 or v_words > 950 then
      raise exception 'preview publish refused: % body words % outside 750-950',v_lang,v_words;
    end if;

    v_sections_total := 0;
    for v_source_url in select unnest(array['setup','tension','decision','outcome']) loop
      select count(*) into v_section_words
      from regexp_split_to_table(trim(coalesce(v_item->>v_source_url,'')),E'\\s+') w
      where w<>'';
      if v_section_words < 120 or v_section_words > 280 then
        raise exception 'preview publish refused: % % section words % outside 120-280',v_lang,v_source_url,v_section_words;
      end if;
      v_sections_total := v_sections_total + v_section_words;
    end loop;
    if v_sections_total < 700 or v_sections_total > 1000 or abs(v_sections_total-v_words)>100 then
      raise exception 'preview publish refused: % reader sections do not represent full story (sections %, body %)',v_lang,v_sections_total,v_words;
    end if;
  end loop;

  -- Persist sources once.
  for v_source_rec in select value from jsonb_array_elements(v_sources) loop
    v_source_url := nullif(trim(v_source_rec->>'url'),'');
    if v_source_url is null then raise exception 'preview publish refused: blank source URL'; end if;
    insert into public.sources(url,title,publisher,author,published_at,retrieved_at,language,credibility_score,content_hash)
    values(
      v_source_url,
      nullif(v_source_rec->>'title',''),
      nullif(v_source_rec->>'publisher',''),
      null,
      nullif(v_source_rec->>'published_at','')::timestamptz,
      coalesce(nullif(v_source_rec->>'retrieved_at','')::timestamptz,now()),
      case when v_source_rec->>'language' in ('fr','en') then v_source_rec->>'language' else null end,
      0.6,
      md5(v_source_url)
    )
    on conflict(url) do update set
      title=coalesce(excluded.title,public.sources.title),
      publisher=coalesce(excluded.publisher,public.sources.publisher),
      published_at=coalesce(excluded.published_at,public.sources.published_at),
      retrieved_at=greatest(public.sources.retrieved_at,excluded.retrieved_at),
      language=coalesce(excluded.language,public.sources.language),
      updated_at=now();
  end loop;

  -- Old previews remain auditable but disappear from active/library published content.
  update public.content_items
  set status='archived',updated_at=now()
  where content_type='business_story'
    and publication_date=p_preview_date
    and status='published'
    and metadata->>'preview_mode'='business_story';

  foreach v_lang in array array['fr','en'] loop
    v_item := v_output->v_lang;
    v_body := v_item->>'body_md';
    v_source_count := jsonb_array_length(v_item->'source_urls');
    v_dedup_key := 'business-story-preview:'||p_run_id||':'||v_lang;
    v_metadata := (v_item - 'body_md' - 'title' - 'summary' - 'language' - 'content_type' - 'topic' - 'version' - 'difficulty')
      || jsonb_build_object(
        'preview_mode','business_story',
        'preview_run_id',p_run_id,
        'preview_target_date',p_preview_date,
        'content_status','published',
        'generator','chatgpt_work_preview',
        'staging_batch_id',p_payload->>'staging_batch_id',
        'staging_job_id',p_payload->>'staging_job_id',
        'staging_output_id',p_payload->>'staging_output_id',
        'staging_review_score',(v_review->>'score')::int,
        'staging_reviewer_id',v_review->>'reviewer_id',
        'dedup_key',v_dedup_key,
        'persisted_by','public.publish_business_story_preview'
      );

    insert into public.content_items(
      content_type,topic_id,language,title,summary,body_md,difficulty,
      estimated_read_seconds,publication_date,version,status,generation_run_id,source_count,metadata
    ) values (
      'business_story','business',v_lang,v_item->>'title',nullif(v_item->>'lesson',''),v_body,null,
      greatest(30,ceil((array_length(regexp_split_to_array(trim(v_body),E'\\s+'),1)::numeric/220)*60)::int),
      p_preview_date,coalesce((v_item->>'version')::int,1),'published',null,v_source_count,v_metadata
    ) returning id into v_content_id;

    if v_lang='fr' then v_fr_id:=v_content_id; else v_en_id:=v_content_id; end if;

    for v_source_url in select value from jsonb_array_elements_text(v_item->'source_urls') loop
      select id into v_source_id from public.sources where url=v_source_url;
      if v_source_id is null then raise exception 'preview publish refused: persisted source missing %',v_source_url; end if;
      insert into public.content_item_sources(content_item_id,source_id,claim,source_order)
      values(v_content_id,v_source_id,null,
        (select ordinality::int-1 from jsonb_array_elements_text(v_item->'source_urls') with ordinality x(value,ordinality) where x.value=v_source_url limit 1)
      ) on conflict do nothing;
      if found then v_links:=v_links+1; end if;
    end loop;
  end loop;

  for v_user in
    select p.id,p.language
    from public.profiles p
    join public.user_preferences up on up.user_id=p.id
    where p.language in ('fr','en') and up.business_stories_enabled=true
    order by p.id
  loop
    insert into public.daily_drops(user_id,drop_date,language,status,generated_at,published_at,hide_display_date,updated_at)
    values(v_user.id,p_preview_date,v_user.language,'published',now(),now(),false,now())
    on conflict(user_id,drop_date) do update set
      language=excluded.language,status='published',published_at=now(),hide_display_date=false,updated_at=now()
    returning id into v_drop_id;

    delete from public.daily_drop_items where daily_drop_id=v_drop_id and slot='business_story';
    insert into public.daily_drop_items(daily_drop_id,content_item_id,slot,position)
    values(v_drop_id,case when v_user.language='fr' then v_fr_id else v_en_id end,'business_story',0)
    on conflict do nothing;
    if found then v_drop_items:=v_drop_items+1; end if;
    v_drops:=v_drops+1;
  end loop;

  return jsonb_build_object(
    'published',true,
    'preview_mode','business_story',
    'preview_date',p_preview_date,
    'run_id',p_run_id,
    'fr_content_item_id',v_fr_id,
    'en_content_item_id',v_en_id,
    'source_links_written',v_links,
    'daily_drops_touched',v_drops,
    'daily_drop_items_written',v_drop_items
  );
end;
$$;

revoke all on function public.publish_business_story_preview(jsonb,text,date) from public,anon,authenticated;
grant execute on function public.publish_business_story_preview(jsonb,text,date) to service_role;
