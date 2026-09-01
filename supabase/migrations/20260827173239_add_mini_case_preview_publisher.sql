-- Recovered from the production database on 2026-09-01.
--
-- This migration was applied to wkbviidrbmehmjbhvpeh directly and never had a
-- file here, so `supabase db push` refused to run at all: it will not touch a
-- database holding migrations it cannot see. The SQL below is the statement
-- recorded verbatim in supabase_migrations.schema_migrations for this version —
-- read back, not reconstructed. No database was changed to create this file.

create or replace function public.publish_mini_case_preview(
  p_payload jsonb,
  p_run_id text,
  p_preview_date date default current_date
) returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_jobs jsonb;
  v_job jsonb;
  v_output jsonb;
  v_sources jsonb;
  v_review jsonb;
  v_checks jsonb;
  v_lang text;
  v_item jsonb;
  v_topic text;
  v_expected_topic text;
  v_body text;
  v_words int;
  v_q jsonb;
  v_opt_count int;
  v_correct_count int;
  v_source_rec jsonb;
  v_source_url text;
  v_source_id uuid;
  v_content_id uuid;
  v_drop_id uuid;
  v_mini_id uuid;
  v_user record;
  v_links int := 0;
  v_items int := 0;
  v_drops int := 0;
  v_drop_items int := 0;
  v_metadata jsonb;
  v_dedup_key text;
  v_topic_count int;
begin
  if nullif(trim(coalesce(p_run_id,'')),'') is null then
    raise exception 'mini-case preview refused: run_id required';
  end if;
  if p_preview_date is null then raise exception 'mini-case preview refused: preview_date required'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'mini-case preview refused: payload object required'; end if;
  v_jobs := p_payload->'jobs';
  if jsonb_typeof(v_jobs) <> 'array' or jsonb_array_length(v_jobs) <> 6 then
    raise exception 'mini-case preview refused: exactly 6 approved jobs required';
  end if;

  select count(distinct j->>'mini_case_topic') into v_topic_count from jsonb_array_elements(v_jobs) j;
  if v_topic_count <> 6 or exists (
    select 1 from jsonb_array_elements(v_jobs) j
    where j->>'mini_case_topic' not in ('finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations')
  ) then
    raise exception 'mini-case preview refused: six canonical product topics required';
  end if;

  -- Validate everything before any write.
  for v_job in select value from jsonb_array_elements(v_jobs) loop
    if coalesce(v_job->>'content_type','') <> 'mini_case' then
      raise exception 'mini-case preview refused: non-mini job supplied';
    end if;
    v_output := v_job->'output_json';
    v_sources := v_job->'source_records';
    v_review := v_job->'review';
    v_checks := v_review->'checks';
    if jsonb_typeof(v_output) <> 'object' or not (v_output ? 'fr') or not (v_output ? 'en') then
      raise exception 'mini-case preview refused: bilingual output required for job %',v_job->>'job_id';
    end if;
    if jsonb_typeof(v_sources) <> 'array' or jsonb_array_length(v_sources) < 1 then
      raise exception 'mini-case preview refused: source records required for job %',v_job->>'job_id';
    end if;
    if coalesce(v_review->>'verdict','') <> 'approved' or coalesce((v_review->>'score')::int,0) < 90 then
      raise exception 'mini-case preview refused: approved review >=90 required for job %',v_job->>'job_id';
    end if;
    if coalesce((v_checks->>'source_grounding')::boolean,false) is not true
       or coalesce((v_checks->>'factual_accuracy')::boolean,false) is not true
       or coalesce((v_checks->>'safety')::boolean,false) is not true
       or coalesce((v_checks->>'schema')::boolean,false) is not true
       or coalesce((v_checks->>'fr_en_parity')::boolean,false) is not true
       or coalesce((v_checks->>'novelty_anti_repetition')::boolean,false) is not true then
      raise exception 'mini-case preview refused: critical review checks failed for job %',v_job->>'job_id';
    end if;

    foreach v_lang in array array['fr','en'] loop
      v_item := v_output->v_lang;
      v_topic := v_job->>'mini_case_topic';
      v_expected_topic := case v_topic
        when 'finance_economy' then 'finance'
        when 'stock_market' then 'finance'
        when 'ai' then 'tech_ai'
        when 'law_compliance' then 'law'
        when 'health_pharma' then 'medicine'
        when 'engineering_operations' then 'engineering'
      end;
      if jsonb_typeof(v_item) <> 'object'
         or coalesce(v_item->>'content_type','') <> 'mini_case'
         or coalesce(v_item->>'slot','') <> 'mini_case'
         or coalesce(v_item->>'language','') <> v_lang
         or coalesce(v_item->>'product_topic','') <> v_topic
         or coalesce(v_item->>'topic','') <> v_expected_topic then
        raise exception 'mini-case preview refused: identity mismatch job % lang %',v_job->>'job_id',v_lang;
      end if;
      if nullif(trim(v_item->>'title'),'') is null or nullif(trim(v_item->>'body_md'),'') is null then
        raise exception 'mini-case preview refused: title/body missing job % lang %',v_job->>'job_id',v_lang;
      end if;
      if jsonb_typeof(v_item->'source_urls') <> 'array' or jsonb_array_length(v_item->'source_urls') < 1 then
        raise exception 'mini-case preview refused: source URLs missing job % lang %',v_job->>'job_id',v_lang;
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(v_item->'source_urls') u(url)
        where not exists (select 1 from jsonb_array_elements(v_sources) s where s->>'url'=u.url)
      ) then
        raise exception 'mini-case preview refused: unrecorded source job % lang %',v_job->>'job_id',v_lang;
      end if;
      v_body := v_item->>'body_md';
      select count(*) into v_words from regexp_split_to_table(trim(v_body),E'\\s+') w where w<>'';
      if v_words < 200 or v_words > 320 then
        raise exception 'mini-case preview refused: body words % outside 200-320 job % lang %',v_words,v_job->>'job_id',v_lang;
      end if;
      if jsonb_typeof(v_item->'questions') <> 'array' or jsonb_array_length(v_item->'questions') <> 3 then
        raise exception 'mini-case preview refused: exactly 3 questions required job % lang %',v_job->>'job_id',v_lang;
      end if;
      for v_q in select value from jsonb_array_elements(v_item->'questions') loop
        if jsonb_typeof(v_q->'options') <> 'array' then
          raise exception 'mini-case preview refused: question options array required job % lang %',v_job->>'job_id',v_lang;
        end if;
        v_opt_count := jsonb_array_length(v_q->'options');
        select count(*) into v_correct_count from jsonb_array_elements(v_q->'options') o where coalesce((o->>'is_correct')::boolean,false)=true;
        if v_opt_count <> 4 or v_correct_count <> 1 then
          raise exception 'mini-case preview refused: 4 options / 1 correct required job % lang %',v_job->>'job_id',v_lang;
        end if;
      end loop;
    end loop;
  end loop;

  -- Persist all sources first.
  for v_job in select value from jsonb_array_elements(v_jobs) loop
    v_sources := v_job->'source_records';
    for v_source_rec in select value from jsonb_array_elements(v_sources) loop
      v_source_url := nullif(trim(v_source_rec->>'url'),'');
      if v_source_url is null then raise exception 'mini-case preview refused: blank source URL'; end if;
      insert into public.sources(url,title,publisher,author,published_at,retrieved_at,language,credibility_score,content_hash)
      values(
        v_source_url,
        nullif(v_source_rec->>'title',''),
        nullif(v_source_rec->>'publisher',''),
        null,
        nullif(v_source_rec->>'published_at','')::timestamptz,
        coalesce(nullif(v_source_rec->>'retrieved_at','')::timestamptz,now()),
        case when v_source_rec->>'language' in ('fr','en') then v_source_rec->>'language' else null end,
        0.6,md5(v_source_url)
      ) on conflict(url) do update set
        title=coalesce(excluded.title,public.sources.title),
        publisher=coalesce(excluded.publisher,public.sources.publisher),
        published_at=coalesce(excluded.published_at,public.sources.published_at),
        retrieved_at=greatest(public.sources.retrieved_at,excluded.retrieved_at),
        language=coalesce(excluded.language,public.sources.language),
        updated_at=now();
    end loop;
  end loop;

  update public.content_items set status='archived',updated_at=now()
  where content_type='mini_case' and publication_date=p_preview_date and status='published'
    and metadata->>'preview_mode'='mini_case';

  -- Write 12 localized preview items, but no mini_case_history.
  for v_job in select value from jsonb_array_elements(v_jobs) loop
    v_output := v_job->'output_json';
    v_review := v_job->'review';
    foreach v_lang in array array['fr','en'] loop
      v_item := v_output->v_lang;
      v_topic := v_job->>'mini_case_topic';
      v_expected_topic := case v_topic
        when 'finance_economy' then 'finance'
        when 'stock_market' then 'finance'
        when 'ai' then 'tech_ai'
        when 'law_compliance' then 'law'
        when 'health_pharma' then 'medicine'
        when 'engineering_operations' then 'engineering'
      end;
      v_body := v_item->>'body_md';
      v_dedup_key := 'mini-case-preview:'||p_run_id||':'||v_topic||':'||v_lang;
      v_metadata := (v_item - 'body_md' - 'title' - 'summary' - 'language' - 'content_type' - 'topic' - 'version' - 'difficulty')
        || jsonb_build_object(
          'preview_mode','mini_case',
          'preview_run_id',p_run_id,
          'preview_target_date',p_preview_date,
          'content_status','published',
          'generator','chatgpt_work_preview',
          'product_topic',v_topic,
          'staging_batch_id',p_payload->>'staging_batch_id',
          'staging_job_id',v_job->>'job_id',
          'staging_output_id',v_job->>'output_id',
          'staging_review_score',(v_review->>'score')::int,
          'staging_reviewer_id',v_review->>'reviewer_id',
          'dedup_key',v_dedup_key,
          'persisted_by','public.publish_mini_case_preview'
        );
      insert into public.content_items(
        content_type,topic_id,language,title,summary,body_md,difficulty,
        estimated_read_seconds,publication_date,version,status,generation_run_id,source_count,metadata
      ) values(
        'mini_case',v_expected_topic,v_lang,v_item->>'title',nullif(v_item->>'challenge',''),v_body,
        case lower(coalesce(v_item->>'difficulty','')) when 'easy' then 'easy' when 'medium' then 'medium' when 'intermediate' then 'medium' when 'hard' then 'hard' else 'medium' end,
        greatest(30,ceil((array_length(regexp_split_to_array(trim(v_body),E'\\s+'),1)::numeric/220)*60)::int),
        p_preview_date,coalesce((v_item->>'version')::int,1),'published',null,
        jsonb_array_length(v_item->'source_urls'),v_metadata
      ) returning id into v_content_id;
      v_items := v_items+1;
      for v_source_url in select value from jsonb_array_elements_text(v_item->'source_urls') loop
        select id into v_source_id from public.sources where url=v_source_url;
        if v_source_id is null then raise exception 'mini-case preview refused: persisted source missing %',v_source_url; end if;
        insert into public.content_item_sources(content_item_id,source_id,claim,source_order)
        values(v_content_id,v_source_id,null,
          (select ordinality::int-1 from jsonb_array_elements_text(v_item->'source_urls') with ordinality x(value,ordinality) where x.value=v_source_url limit 1)
        ) on conflict do nothing;
        if found then v_links:=v_links+1; end if;
      end loop;
    end loop;
  end loop;

  -- Replace only the mini_case slot according to each user's preferred mini-case topic.
  for v_user in
    select p.id,p.language
    from public.profiles p
    join public.user_preferences up on up.user_id=p.id
    where p.language in ('fr','en') and up.mini_cases_enabled=true
    order by p.id
  loop
    select ci.id into v_mini_id
    from public.user_mini_case_topic_preferences mp
    join public.content_items ci
      on ci.status='published'
     and ci.publication_date=p_preview_date
     and ci.language=v_user.language
     and ci.content_type='mini_case'
     and ci.metadata->>'preview_mode'='mini_case'
     and ci.metadata->>'preview_run_id'=p_run_id
     and ci.metadata->>'product_topic'=mp.topic_id
    where mp.user_id=v_user.id and mp.enabled=true
    order by mp.position nulls last,mp.topic_id,ci.id
    limit 1;

    if v_mini_id is not null then
      insert into public.daily_drops(user_id,drop_date,language,status,generated_at,published_at,hide_display_date,updated_at)
      values(v_user.id,p_preview_date,v_user.language,'published',now(),now(),false,now())
      on conflict(user_id,drop_date) do update set
        language=excluded.language,status='published',published_at=now(),hide_display_date=false,updated_at=now()
      returning id into v_drop_id;
      delete from public.daily_drop_items where daily_drop_id=v_drop_id and slot='mini_case';
      insert into public.daily_drop_items(daily_drop_id,content_item_id,slot,position)
      values(v_drop_id,v_mini_id,'mini_case',0) on conflict do nothing;
      if found then v_drop_items:=v_drop_items+1; end if;
      v_drops:=v_drops+1;
    end if;
  end loop;

  return jsonb_build_object(
    'published',true,
    'preview_mode','mini_case',
    'preview_date',p_preview_date,
    'run_id',p_run_id,
    'content_items_written',v_items,
    'source_links_written',v_links,
    'daily_drops_touched',v_drops,
    'daily_drop_items_written',v_drop_items
  );
end;
$$;

revoke all on function public.publish_mini_case_preview(jsonb,text,date) from public, anon, authenticated;
grant execute on function public.publish_mini_case_preview(jsonb,text,date) to service_role;
