-- Set-based reader assignment in the canonical publisher — PRODUCTION.
--
-- WHAT CHANGES
--
-- publish_scheduled_staging_payload assigned readers one at a time: a PL/pgSQL
-- loop over every profile running 10-20 statements per reader (upsert the drop,
-- clear its items, read the reader's topic preferences, read candidates per
-- topic, insert each item, then the same for the story and the mini case).
-- Inside one transaction that grows linearly with readers and is the first
-- hard ceiling on publication.
--
-- The reader half is now four statements for all readers (see the comment in
-- the function). The rules, the ordering and the output are unchanged; the
-- parity suite publishes the same batch with the old and the new function and
-- compares every drop, item, slot and position
-- (supabase/tests/set_based_publisher_parity.test.sql).
--
-- WHAT DOES NOT CHANGE
--
--   - the payload checks, the 23-job / 16+1+6 composition, the review bar, the
--     sources, the content items and their histories (the item half is
--     restated byte-for-byte from 20261005130000);
--   - the per-batch and per-edition-date advisory locks, the immutability
--     guard (personews.publishing_batch_id) and the same-batch retry rule;
--   - atomicity: one transaction, every reader or none. No chunking.
--   - the return shape.
--
-- One provenance key is added to content metadata: staging_review_id, the
-- review the staging plan verified this item under (staging 20261005190000
-- stamps it on the payload). Not read by any client.
--
-- INDEXES: none added. The batch's items are read once per publication, by
-- publication_date (idx_content_items_publication_date); the preference tables
-- are joined whole, which is what a hash join over every reader wants. See the
-- benchmark notes in the parity suite.
--
-- Restated in full (CREATE OR REPLACE), not patched from pg_get_functiondef.
-- Forward-only.

BEGIN;

CREATE OR REPLACE FUNCTION public.publish_scheduled_staging_payload(p_payload jsonb, p_run_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_batch jsonb;
  v_jobs jsonb;
  v_batch_id uuid;
  v_edition_date date;
  v_edition_kind text;
  v_target_ref text;
  v_job_rec record;
  v_job jsonb;
  v_item jsonb;
  v_review jsonb;
  v_checks jsonb;
  v_content_type text;
  v_lang text;
  v_topic text;
  v_difficulty text;
  v_summary text;
  v_body text;
  v_metadata jsonb;
  v_dedup_key text;
  v_content_item_id uuid;
  v_source_id uuid;
  v_source_rec jsonb;
  v_source_url text;
  v_source_ord bigint;
  v_items_written integer := 0;
  v_items_reused integer := 0;
  v_source_links integer := 0;
  v_drops_written integer := 0;
  v_drop_items integer := 0;
  v_news_count integer;
  v_story_count integer;
  v_case_count integer;
  v_case_topic_count integer;
  v_memory jsonb;
  v_edition_existed boolean := false;
  v_existing_batch uuid;
  v_drops_skipped integer := 0;
  v_drop_ids uuid[];
  v_drop_users uuid[];
  v_drop_langs text[];
begin
  if coalesce(p_run_id, '') = '' then
    raise exception 'scheduled publish refused: run id is required';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or coalesce(p_payload->>'ready','false') <> 'true' then
    raise exception 'scheduled publish refused: payload is not ready';
  end if;

  v_batch := p_payload->'batch';
  v_jobs := p_payload->'jobs';

  if jsonb_typeof(v_batch) <> 'object' or jsonb_typeof(v_jobs) <> 'array' then
    raise exception 'scheduled publish refused: malformed batch payload';
  end if;

  v_batch_id := (v_batch->>'id')::uuid;
  v_edition_date := (v_batch->>'edition_date')::date;
  v_edition_kind := v_batch->>'edition_kind';
  v_target_ref := v_batch->>'target_project_ref';

  if v_edition_kind not in ('daily','weekly_digest') then
    raise exception 'scheduled publish refused: unsupported edition kind %', v_edition_kind;
  end if;

  if v_target_ref is not null and v_target_ref <> '' and v_target_ref <> 'wkbviidrbmehmjbhvpeh' then
    raise exception 'scheduled publish refused: batch targets %, not production', v_target_ref;
  end if;

  if jsonb_array_length(v_jobs) <> 23 then
    raise exception 'scheduled publish refused: expected 23 jobs, got %', jsonb_array_length(v_jobs);
  end if;

  select
    count(*) filter (where j->>'content_type'='newsletter_article'),
    count(*) filter (where j->>'content_type'='business_story'),
    count(*) filter (where j->>'content_type'='mini_case'),
    count(distinct j->>'mini_case_topic') filter (where j->>'content_type'='mini_case')
  into v_news_count,v_story_count,v_case_count,v_case_topic_count
  from jsonb_array_elements(v_jobs) j;

  if v_news_count <> 16 or v_story_count <> 1 or v_case_count <> 6 or v_case_topic_count <> 6 then
    raise exception 'scheduled publish refused: composition is newsletter %, story %, mini %, mini topics %',
      v_news_count,v_story_count,v_case_count,v_case_topic_count;
  end if;

  if exists (
    select 1
    from (
      select j->>'topic' as topic, count(*) as c
      from jsonb_array_elements(v_jobs) j
      where j->>'content_type'='newsletter_article'
      group by j->>'topic'
    ) q
    where q.c <> 2 or q.topic not in ('business','finance','tech_ai','law','medicine','engineering','sport_business','culture_media')
  ) or (
    select count(distinct j->>'topic')
    from jsonb_array_elements(v_jobs) j
    where j->>'content_type'='newsletter_article'
  ) <> 8 then
    raise exception 'scheduled publish refused: newsletter topic composition is invalid';
  end if;


  -- One publisher per batch AND one per edition date: two different batches
  -- for the same date serialise here instead of racing.
  perform pg_advisory_xact_lock(hashtext(v_batch_id::text));
  perform pg_advisory_xact_lock(hashtext('personews:edition:' || v_edition_date::text));

  -- A published date belongs to the batch that published it. The same batch
  -- may come back (a retry after a timeout) and only fill what is missing; a
  -- different batch is refused rather than allowed to replace what readers have.
  v_edition_existed := exists (select 1 from public.editions e where e.edition_date = v_edition_date);

  if v_edition_existed then
    v_existing_batch := public.edition_batch_id(v_edition_date);

    if v_existing_batch is distinct from v_batch_id then
      raise exception 'scheduled publish refused: edition % is already published by batch %; batch % cannot replace it',
        v_edition_date, coalesce(v_existing_batch::text, '<unknown>'), v_batch_id
        using errcode = '55000',
              hint = 'Published editions are immutable. Investigate why a second batch exists for this date.';
    end if;
  end if;

  -- Tell the edition registry and the immutability guards which batch this
  -- transaction publishes. Transaction-local: gone at commit or rollback.
  perform set_config('personews.publishing_batch_id', v_batch_id::text, true);


  for v_job_rec in
    select value as job, ordinality as ord
    from jsonb_array_elements(v_jobs) with ordinality
  loop
    v_job := v_job_rec.job;
    v_content_type := v_job->>'content_type';
    v_review := v_job->'review';
    v_checks := v_review->'checks';

    if v_content_type not in ('newsletter_article','business_story','mini_case') then
      raise exception 'scheduled publish refused: unsupported content type %', v_content_type;
    end if;

    if coalesce(v_review->>'verdict','') <> 'approved'
       or coalesce((v_review->>'score')::numeric,0) < 90
       or coalesce(v_checks->>'source_grounding','false') <> 'true'
       or coalesce(v_checks->>'factual_accuracy','false') <> 'true'
       or coalesce(v_checks->>'safety','false') <> 'true'
       or coalesce(v_checks->>'schema','false') <> 'true'
       or coalesce(v_checks->>'fr_en_parity','false') <> 'true'
       or coalesce(v_checks->>'novelty_anti_repetition','false') <> 'true'
    then
      raise exception 'scheduled publish refused: job % review is below bar', v_job->>'job_id';
    end if;

    if jsonb_typeof(v_job->'source_records') <> 'array' or jsonb_array_length(v_job->'source_records') = 0 then
      raise exception 'scheduled publish refused: job % has no source records', v_job->>'job_id';
    end if;

    for v_source_rec in select value from jsonb_array_elements(v_job->'source_records')
    loop
      v_source_url := nullif(trim(v_source_rec->>'url'),'');
      if v_source_url is null then
        raise exception 'scheduled publish refused: job % contains a blank source URL', v_job->>'job_id';
      end if;

      insert into public.sources(
        url,title,publisher,author,published_at,retrieved_at,language,credibility_score,content_hash
      ) values (
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
      on conflict (url) do update set
        title=coalesce(excluded.title,public.sources.title),
        publisher=coalesce(excluded.publisher,public.sources.publisher),
        published_at=coalesce(excluded.published_at,public.sources.published_at),
        retrieved_at=greatest(public.sources.retrieved_at,excluded.retrieved_at),
        language=coalesce(excluded.language,public.sources.language),
        content_hash=coalesce(public.sources.content_hash,excluded.content_hash),
        updated_at=now();
    end loop;

    foreach v_lang in array array['fr','en']
    loop
      v_item := v_job->'output_json'->v_lang;
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'scheduled publish refused: job % missing % item', v_job->>'job_id',v_lang;
      end if;
      if coalesce(v_item->>'language','') <> v_lang or coalesce(v_item->>'content_type','') <> v_content_type then
        raise exception 'scheduled publish refused: job % % identity mismatch', v_job->>'job_id',v_lang;
      end if;
      if nullif(trim(v_item->>'title'),'') is null or nullif(trim(v_item->>'body_md'),'') is null then
        raise exception 'scheduled publish refused: job % % missing title/body', v_job->>'job_id',v_lang;
      end if;
      if jsonb_typeof(v_item->'source_urls') <> 'array' or jsonb_array_length(v_item->'source_urls')=0 then
        raise exception 'scheduled publish refused: job % % has no source URLs', v_job->>'job_id',v_lang;
      end if;
      if exists (
        select 1
        from jsonb_array_elements_text(v_item->'source_urls') u(url)
        where not exists (
          select 1 from jsonb_array_elements(v_job->'source_records') r
          where r->>'url'=u.url
        )
      ) then
        raise exception 'scheduled publish refused: job % % cites an unrecorded source', v_job->>'job_id',v_lang;
      end if;

      v_topic := nullif(v_item->>'topic','');
      if v_topic is null or not exists(select 1 from public.topics t where t.id=v_topic) then
        raise exception 'scheduled publish refused: job % % has invalid topic %', v_job->>'job_id',v_lang,v_topic;
      end if;

      v_body := v_item->>'body_md';
      v_summary := case v_content_type
        when 'newsletter_article' then nullif(v_item->>'summary','')
        when 'business_story' then nullif(v_item->>'lesson','')
        when 'mini_case' then nullif(v_item->>'challenge','')
      end;

      if v_content_type='mini_case' then
        v_difficulty := case lower(coalesce(v_item->>'difficulty',''))
          when 'easy' then 'easy'
          when 'medium' then 'medium'
          when 'intermediate' then 'medium'
          when 'hard' then 'hard'
          else null
        end;
        if v_difficulty is null then
          raise exception 'scheduled publish refused: job % % has unsupported difficulty %', v_job->>'job_id',v_lang,v_item->>'difficulty';
        end if;
      else
        v_difficulty := null;
      end if;

      v_dedup_key := 'staging:'||v_batch_id::text||':'||(v_job->>'job_id')||':'||v_lang;
      v_metadata := (v_item - 'body_md' - 'title' - 'summary' - 'language' - 'content_type' - 'topic' - 'version' - 'difficulty' - 'questions')
        || jsonb_build_object(
          'is_test_data',false,
          'scheduler_mode','scheduled-reviewer-publish-rpc',
          'scheduler_run_id',p_run_id,
          'content_status','published',
          'generator','chatgpt_scheduled',
          'model_name',null,
          'staging_batch_id',v_batch_id::text,
          'staging_job_id',v_job->>'job_id',
          'staging_output_id',v_job->>'output_id',
          -- The verified review this item was published under, as the staging
          -- plan stamps it (20261005190000 in staging). NULL from an older plan.
          'staging_review_id',coalesce(v_job->>'review_id',v_review->>'id'),
          'staging_prompt_version',v_job->>'prompt_version',
          'staging_review_score',(v_review->>'score')::numeric,
          'staging_reviewer_id',v_review->>'reviewer_id',
          'staging_edition_kind',v_edition_kind,
          'staging_prompt_bundle_version',v_batch->>'prompt_bundle_version',
          'staging_ordinal',coalesce((v_job->>'ordinal')::integer,v_job_rec.ord::integer),
          'dedup_key',v_dedup_key,
          'persisted_by','public.publish_scheduled_staging_payload',
          'staging_scored_question_contract',public.scored_question_declaration(p_payload->'batch')
        );

      select id into v_content_item_id
      from public.content_items
      where metadata->>'dedup_key'=v_dedup_key and status<>'archived'
      limit 1;

      if v_content_item_id is null then
        insert into public.content_items(
          content_type,topic_id,language,title,summary,body_md,difficulty,
          estimated_read_seconds,publication_date,version,status,generation_run_id,source_count,metadata
        ) values (
          v_content_type,v_topic,v_lang,v_item->>'title',v_summary,v_body,v_difficulty,
          greatest(30,ceil((coalesce(array_length(regexp_split_to_array(trim(v_body),E'\\s+'),1),1)::numeric/220)*60)::integer),
          v_edition_date,coalesce((v_item->>'version')::integer,1),'published',null,
          jsonb_array_length(v_item->'source_urls'),v_metadata
        ) returning id into v_content_item_id;
        v_items_written := v_items_written+1;
      else
        v_items_reused := v_items_reused+1;
      end if;

      for v_source_url,v_source_ord in
        select value,ordinality
        from jsonb_array_elements_text(v_item->'source_urls') with ordinality
      loop
        select id into v_source_id from public.sources where url=v_source_url;
        if v_source_id is null then
          raise exception 'scheduled publish refused: persisted source missing for %',v_source_url;
        end if;
        insert into public.content_item_sources(content_item_id,source_id,claim,source_order)
        values(v_content_item_id,v_source_id,null,(v_source_ord-1)::integer)
        on conflict do nothing;
        if found then v_source_links:=v_source_links+1; end if;
      end loop;

      if v_content_type='business_story' then
        v_memory:=v_item->'editorial_memory';
        if jsonb_typeof(v_memory)='object'
          and nullif(trim(v_memory->>'entity_name'),'') is not null
          and nullif(trim(v_memory->>'main_company'),'') is not null
          and nullif(trim(v_memory->>'industry'),'') is not null
          and nullif(trim(v_memory->>'key_mechanism'),'') is not null
          and nullif(trim(v_memory->>'strategic_angle'),'') is not null
          and nullif(trim(v_memory->>'core_takeaway'),'') is not null
          and nullif(trim(v_memory->>'year_period'),'') is not null
        then
          insert into public.business_story_history(
            content_item_id,title,slug,entity_name,entity_type,main_company,companies_mentioned,
            industry,key_mechanism,secondary_mechanisms,strategic_angle,core_takeaway,year_period,language,published_date
          ) values(
            v_content_item_id,v_item->>'title','staging-'||v_batch_id::text||'-'||(v_job->>'job_id')||'-'||v_lang,
            v_memory->>'entity_name',
            case when v_memory->>'entity_type' in ('founder','ceo','investor','company','product','crisis','acquisition','strategy','other') then v_memory->>'entity_type' else 'other' end,
            v_memory->>'main_company',
            case when jsonb_typeof(v_memory->'companies_mentioned')='array' then array(select jsonb_array_elements_text(v_memory->'companies_mentioned')) else array[]::text[] end,
            v_memory->>'industry',v_memory->>'key_mechanism',
            case when jsonb_typeof(v_memory->'secondary_mechanisms')='array' then array(select jsonb_array_elements_text(v_memory->'secondary_mechanisms')) else array[]::text[] end,
            v_memory->>'strategic_angle',v_memory->>'core_takeaway',v_memory->>'year_period',v_lang,v_edition_date
          ) on conflict do nothing;
        end if;
      elsif v_content_type='mini_case' then
        if v_item->>'product_topic' in ('finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations')
          and v_item->>'scenario_type' in ('acquisition_decision','pricing_decision','compliance_risk','capital_allocation','product_launch','market_entry','cost_optimization','clinical_trial_decision','supply_chain_constraint','ai_build_vs_buy','portfolio_risk','contract_negotiation','capacity_planning')
          and v_item->>'decision_type' in ('choose_metric','choose_strategy','identify_risk','rank_options','reject_bad_assumption','interpret_result','allocate_budget','choose_next_step')
          and v_item->>'concept_tested' in ('margin','cash_flow','valuation_multiple','risk_adjusted_return','regulatory_risk','privacy_compliance','opportunity_cost','switching_cost','bottleneck','sensitivity_analysis','market_liquidity','trial_endpoint','unit_economics')
          and v_item->>'question_pattern' in ('framework_then_apply_then_decide','diagnose_then_prioritize_then_recommend','metric_then_tradeoff_then_next_step','risk_then_evidence_then_decision','reject_assumption_then_test_then_conclude')
          and v_item->>'correct_answer_pattern' in ('best_next_signal','least_risky_option','highest_expected_value','constraint_first','evidence_before_action','reject_overconfident_claim')
          and nullif(trim(v_item->>'mechanism'),'') is not null
          and nullif(trim(v_item->>'core_takeaway'),'') is not null
        then
          insert into public.mini_case_history(
            content_item_id,title,slug,topic,scenario_type,decision_type,concept_tested,mechanism,difficulty,
            question_pattern,correct_answer_pattern,core_takeaway,published_date,language
          ) values(
            v_content_item_id,v_item->>'title','staging-'||v_batch_id::text||'-'||(v_job->>'job_id')||'-'||v_lang,
            v_item->>'product_topic',v_item->>'scenario_type',v_item->>'decision_type',v_item->>'concept_tested',
            v_item->>'mechanism',v_difficulty,v_item->>'question_pattern',v_item->>'correct_answer_pattern',
            v_item->>'core_takeaway',v_edition_date,v_lang
          ) on conflict do nothing;
        end if;
      end if;
    end loop;
  end loop;


  -- ------------------------------------------------------------------------
  -- READERS, SET-BASED.
  --
  -- What was one PL/pgSQL iteration per reader (an upsert, a delete, a
  -- preference read, a candidate read per topic, one insert per item, two more
  -- reads and inserts for the story and the mini case: 10-20 statements each)
  -- is now four statements for all readers, with the same rules:
  --
  --   readers     profiles in fr/en that have a user_preferences row. On a retry
  --               of a published edition, a reader who already has their drop
  --               is kept untouched (counted in daily_drops_kept).
  --   newsletter  only if newsletter_enabled (NULL = off). Enabled topics in
  --               (position NULLS LAST, topic_id) order; per topic the batch's
  --               articles in that language by (staging_ordinal, id), at most
  --               least(2, greatest(1, articles_count)); positions numbered
  --               0.. across topics; capped at newsletter_article_count
  --               (NULL = no cap, <= 0 = none).
  --   story       only if business_stories_enabled: the batch's story in the
  --               reader's language, lowest id, position 0.
  --   mini case   only if mini_cases_enabled: the first enabled mini-case topic
  --               (position NULLS LAST, topic_id) that has a case in the
  --               reader's language, lowest id on a tie, position 0.
  --
  -- The batch's own items are read ONCE (at most 46 rows) instead of once per
  -- reader per slot. Still one transaction: the edition is published for every
  -- reader or for none.
  -- ------------------------------------------------------------------------

  if v_edition_existed then
    select count(*) into v_drops_skipped
    from public.profiles p
    join public.user_preferences up on up.user_id = p.id
    where p.language in ('fr','en')
      and exists (
        select 1 from public.daily_drops d
        where d.user_id = p.id and d.drop_date = v_edition_date
      );
  end if;

  with readers as (
    select p.id as user_id, p.language
    from public.profiles p
    join public.user_preferences up on up.user_id = p.id
    where p.language in ('fr','en')
      and not (
        v_edition_existed
        and exists (
          select 1 from public.daily_drops d
          where d.user_id = p.id and d.drop_date = v_edition_date
        )
      )
  ),
  upserted as (
    insert into public.daily_drops(user_id,drop_date,language,status,generated_at,published_at,hide_display_date,updated_at)
    select r.user_id, v_edition_date, r.language, 'published', now(), now(), false, now()
    from readers r
    order by r.user_id
    on conflict(user_id,drop_date) do update set
      language=excluded.language,status='published',published_at=now(),hide_display_date=false,updated_at=now()
    returning id, user_id, language
  )
  select
    coalesce(array_agg(u.id order by u.user_id), array[]::uuid[]),
    coalesce(array_agg(u.user_id order by u.user_id), array[]::uuid[]),
    coalesce(array_agg(u.language order by u.user_id), array[]::text[])
  into v_drop_ids, v_drop_users, v_drop_langs
  from upserted u;

  v_drops_written := coalesce(array_length(v_drop_ids, 1), 0);

  -- A drop that already existed (a date the registry did not know) is
  -- reassigned from scratch, exactly as before. A new drop has nothing to delete.
  delete from public.daily_drop_items di
  where di.daily_drop_id = any(v_drop_ids);

  with drops as (
    select d.drop_id, d.user_id, d.language
    from unnest(v_drop_ids, v_drop_users, v_drop_langs) as d(drop_id, user_id, language)
  ),
  batch_items as (
    select ci.id, ci.language, ci.content_type, ci.topic_id,
           ci.metadata->>'product_topic' as product_topic,
           coalesce((ci.metadata->>'staging_ordinal')::integer, 999) as ordinal
    from public.content_items ci
    where ci.status = 'published'
      and ci.publication_date = v_edition_date
      and ci.metadata->>'staging_batch_id' = v_batch_id::text
  ),
  ranked_news as (
    select bi.id, bi.language, bi.topic_id,
           row_number() over (partition by bi.language, bi.topic_id order by bi.ordinal, bi.id) as topic_rank
    from batch_items bi
    where bi.content_type = 'newsletter_article'
  ),
  news as (
    select d.drop_id,
           rn.id as content_item_id,
           (row_number() over (
              partition by d.drop_id
              order by tp.position nulls last, tp.topic_id, rn.topic_rank
            ) - 1)::integer as position,
           up.newsletter_article_count as cap
    from drops d
    join public.user_preferences up
      on up.user_id = d.user_id and up.newsletter_enabled
    join public.user_topic_preferences tp
      on tp.user_id = d.user_id and tp.enabled = true
    join ranked_news rn
      on rn.language = d.language
     and rn.topic_id = tp.topic_id
     and rn.topic_rank <= least(2, greatest(1, tp.articles_count))
  ),
  stories as (
    select d.drop_id, s.id as content_item_id
    from drops d
    join public.user_preferences up
      on up.user_id = d.user_id and up.business_stories_enabled
    join (
      select distinct on (bi.language) bi.id, bi.language
      from batch_items bi
      where bi.content_type = 'business_story'
      order by bi.language, bi.id
    ) s on s.language = d.language
  ),
  minis as (
    select distinct on (d.drop_id) d.drop_id, bi.id as content_item_id
    from drops d
    join public.user_preferences up
      on up.user_id = d.user_id and up.mini_cases_enabled
    join public.user_mini_case_topic_preferences mp
      on mp.user_id = d.user_id and mp.enabled = true
    join batch_items bi
      on bi.content_type = 'mini_case'
     and bi.language = d.language
     and bi.product_topic = mp.topic_id
    order by d.drop_id, mp.position nulls last, mp.topic_id, bi.id
  ),
  inserted as (
    insert into public.daily_drop_items(daily_drop_id,content_item_id,slot,position)
    select n.drop_id, n.content_item_id, 'newsletter', n.position
    from news n
    where n.cap is null or n.position < n.cap
    union all
    select s.drop_id, s.content_item_id, 'business_story', 0 from stories s
    union all
    select m.drop_id, m.content_item_id, 'mini_case', 0 from minis m
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_drop_items from inserted;

  return jsonb_build_object(
    'published',true,
    'batch_id',v_batch_id,
    'edition_date',v_edition_date,
    'edition_kind',v_edition_kind,
    'run_id',p_run_id,
    'items_written',v_items_written,
    'items_reused',v_items_reused,
    'source_links_written',v_source_links,
    'daily_drops_written',v_drops_written,
    'daily_drop_items_written',v_drop_items,
    'retry_of_published_edition',v_edition_existed,
    'daily_drops_kept',v_drops_skipped,
    'publisher','public.publish_scheduled_staging_payload'
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.publish_scheduled_staging_payload(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_scheduled_staging_payload(jsonb, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
