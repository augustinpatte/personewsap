create or replace function public.validate_generation_output(
  p_job_id uuid,
  p_output_json jsonb,
  p_source_records jsonb
)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_lang text;
  v_item jsonb;
  v_required text[];
  v_key text;
  v_errors jsonb := '[]'::jsonb;
  v_source_urls text[] := array[]::text[];
  v_url text;
  v_q jsonb;
  v_option_count integer;
  v_correct_count integer;
  v_words integer;
  v_section_words integer;
  v_combined_section_words integer;
  v_expected_topic text;
begin
  select * into v_job from public.generation_jobs where id=p_job_id;
  if not found then
    return jsonb_build_object('valid',false,'errors',jsonb_build_array('job_not_found'));
  end if;

  if jsonb_typeof(p_output_json) <> 'object' or not (p_output_json ? 'fr') or not (p_output_json ? 'en') then
    v_errors := v_errors || jsonb_build_array('bilingual_envelope_required');
  end if;

  if jsonb_typeof(coalesce(p_source_records,'[]'::jsonb)) <> 'array' then
    v_errors := v_errors || jsonb_build_array('source_records_must_be_array');
  else
    select coalesce(array_agg(s->>'url') filter (where nullif(trim(s->>'url'),'') is not null), array[]::text[])
      into v_source_urls
    from jsonb_array_elements(coalesce(p_source_records,'[]'::jsonb)) s;
  end if;

  if v_job.content_type='newsletter_article' then
    v_required := array['content_type','slot','language','title','topic','source_urls','version','published_date','summary','body_md','why_it_matters'];
  elsif v_job.content_type='business_story' then
    v_required := array['content_type','slot','language','title','topic','source_urls','version','company_or_market','story_date','setup','tension','decision','outcome','lesson','body_md','editorial_memory'];
    if coalesce(array_length(v_source_urls,1),0) < 2 then
      v_errors := v_errors || jsonb_build_array('business_story:at_least_two_source_records_required');
    end if;
  elsif v_job.content_type='mini_case' then
    v_required := array['content_type','slot','language','title','topic','source_urls','version','product_topic','scenario_type','decision_type','concept_tested','mechanism','question_pattern','correct_answer_pattern','core_takeaway','difficulty','context','challenge','constraints','question','questions','expected_reasoning','sample_answer','conclusion','final_takeaway','score_max','body_md'];
  else
    v_errors := v_errors || jsonb_build_array('unsupported_content_type');
  end if;

  foreach v_lang in array array['fr','en'] loop
    v_item := p_output_json->v_lang;
    if jsonb_typeof(v_item) <> 'object' then
      v_errors := v_errors || jsonb_build_array(v_lang || ':item_must_be_object');
      continue;
    end if;

    foreach v_key in array v_required loop
      if not (v_item ? v_key) then
        v_errors := v_errors || jsonb_build_array(v_lang || ':missing_' || v_key);
      end if;
    end loop;

    if coalesce(v_item->>'language','') <> v_lang then
      v_errors := v_errors || jsonb_build_array(v_lang || ':language_mismatch');
    end if;
    if coalesce(v_item->>'content_type','') <> v_job.content_type then
      v_errors := v_errors || jsonb_build_array(v_lang || ':content_type_mismatch');
    end if;

    if v_job.content_type='newsletter_article' and coalesce(v_item->>'slot','') <> 'newsletter' then
      v_errors := v_errors || jsonb_build_array(v_lang || ':slot_mismatch');
    elsif v_job.content_type='business_story' and coalesce(v_item->>'slot','') <> 'business_story' then
      v_errors := v_errors || jsonb_build_array(v_lang || ':slot_mismatch');
    elsif v_job.content_type='mini_case' and coalesce(v_item->>'slot','') <> 'mini_case' then
      v_errors := v_errors || jsonb_build_array(v_lang || ':slot_mismatch');
    end if;

    if jsonb_typeof(v_item->'source_urls') <> 'array' then
      v_errors := v_errors || jsonb_build_array(v_lang || ':source_urls_must_be_array');
    else
      if jsonb_array_length(v_item->'source_urls') = 0 then
        v_errors := v_errors || jsonb_build_array(v_lang || ':at_least_one_source_url_required');
      end if;
      if v_job.content_type='business_story' and jsonb_array_length(v_item->'source_urls') < 2 then
        v_errors := v_errors || jsonb_build_array(v_lang || ':business_story_at_least_two_source_urls_required');
      end if;
      for v_url in select jsonb_array_elements_text(v_item->'source_urls') loop
        if not (v_url = any(v_source_urls)) then
          v_errors := v_errors || jsonb_build_array(v_lang || ':undeclared_source_url:' || v_url);
        end if;
      end loop;
    end if;

    if coalesce(array_length(v_source_urls,1),0)=0 then
      v_errors := v_errors || jsonb_build_array(v_lang || ':source_records_required');
    end if;

    select count(*) into v_words
    from regexp_split_to_table(trim(coalesce(v_item->>'body_md','')), E'\\s+') w
    where w <> '';

    if v_job.content_type='newsletter_article' then
      if v_words < 120 or v_words > 220 then
        v_errors := v_errors || jsonb_build_array(v_lang || ':newsletter_body_words_' || v_words || '_outside_120_220');
      end if;
      if coalesce(v_item->>'topic','') <> coalesce(v_job.topic,'') then
        v_errors := v_errors || jsonb_build_array(v_lang || ':newsletter_topic_mismatch');
      end if;

    elsif v_job.content_type='business_story' then
      if v_words < 750 or v_words > 950 then
        v_errors := v_errors || jsonb_build_array(v_lang || ':business_story_body_words_' || v_words || '_outside_750_950');
      end if;
      if coalesce(v_item->>'topic','') <> 'business' then
        v_errors := v_errors || jsonb_build_array(v_lang || ':business_story_topic_must_be_business');
      end if;

      v_combined_section_words := 0;
      foreach v_key in array array['setup','tension','decision','outcome'] loop
        select count(*) into v_section_words
        from regexp_split_to_table(trim(coalesce(v_item->>v_key,'')), E'\\s+') w
        where w <> '';
        v_combined_section_words := v_combined_section_words + v_section_words;
        if v_section_words < 120 or v_section_words > 280 then
          v_errors := v_errors || jsonb_build_array(v_lang || ':business_story_' || v_key || '_words_' || v_section_words || '_outside_120_280');
        end if;
      end loop;

      if v_combined_section_words < 700 or v_combined_section_words > 1000 then
        v_errors := v_errors || jsonb_build_array(v_lang || ':business_story_reader_sections_total_' || v_combined_section_words || '_outside_700_1000');
      end if;
      if abs(v_combined_section_words - v_words) > 100 then
        v_errors := v_errors || jsonb_build_array(v_lang || ':business_story_body_and_reader_sections_diverge');
      end if;

    elsif v_job.content_type='mini_case' then
      if v_words < 200 or v_words > 320 then
        v_errors := v_errors || jsonb_build_array(v_lang || ':mini_case_body_words_' || v_words || '_outside_200_320');
      end if;
      if coalesce(v_item->>'product_topic','') <> coalesce(v_job.mini_case_topic,'') then
        v_errors := v_errors || jsonb_build_array(v_lang || ':product_topic_mismatch');
      end if;

      v_expected_topic := case v_job.mini_case_topic
        when 'finance_economy' then 'finance'
        when 'stock_market' then 'finance'
        when 'ai' then 'tech_ai'
        when 'law_compliance' then 'law'
        when 'health_pharma' then 'medicine'
        when 'engineering_operations' then 'engineering'
        else null
      end;
      if v_expected_topic is null or coalesce(v_item->>'topic','') <> v_expected_topic then
        v_errors := v_errors || jsonb_build_array(v_lang || ':mini_case_content_topic_mismatch_expected_' || coalesce(v_expected_topic,'null'));
      end if;

      if jsonb_typeof(v_item->'questions') <> 'array' or jsonb_array_length(v_item->'questions') <> 3 then
        v_errors := v_errors || jsonb_build_array(v_lang || ':exactly_three_questions_required');
      else
        for v_q in select * from jsonb_array_elements(v_item->'questions') loop
          if jsonb_typeof(v_q->'options') <> 'array' then
            v_errors := v_errors || jsonb_build_array(v_lang || ':question_options_must_be_array');
          else
            v_option_count := jsonb_array_length(v_q->'options');
            select count(*) into v_correct_count
            from jsonb_array_elements(v_q->'options') opt
            where coalesce((opt->>'is_correct')::boolean,false)=true;
            if v_option_count <> 4 then
              v_errors := v_errors || jsonb_build_array(v_lang || ':four_options_required');
            end if;
            if v_correct_count <> 1 then
              v_errors := v_errors || jsonb_build_array(v_lang || ':one_correct_option_required');
            end if;
          end if;
        end loop;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'valid', jsonb_array_length(v_errors)=0,
    'errors', v_errors,
    'content_type', v_job.content_type,
    'source_record_count', coalesce(array_length(v_source_urls,1),0)
  );
end;
$$;

create or replace function public.submit_generation_review_v2(
  p_output_id uuid,
  p_reviewer_id text,
  p_verdict text,
  p_score integer,
  p_checks jsonb,
  p_feedback text default null
)
returns uuid
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_threshold integer := 90;
  v_critical text;
  v_critical_checks jsonb := '["source_grounding","factual_accuracy","safety","schema","fr_en_parity","novelty_anti_repetition"]'::jsonb;
  v_effective_verdict text := p_verdict;
  v_review_id uuid;
  v_batch_id uuid;
  v_job_id uuid;
  v_output_json jsonb;
  v_source_records jsonb;
  v_preflight jsonb;
begin
  select coalesce((value->>'approval_threshold')::integer,90),
         coalesce(value->'critical_checks', v_critical_checks)
  into v_threshold, v_critical_checks
  from public.automation_config
  where key='review_policy';

  select j.batch_id,j.id,o.output_json,o.source_records
  into v_batch_id,v_job_id,v_output_json,v_source_records
  from public.generation_outputs o
  join public.generation_jobs j on j.id=o.job_id
  where o.id=p_output_id;

  if v_job_id is null then raise exception 'output_not_found'; end if;

  v_preflight := public.validate_generation_output(v_job_id,v_output_json,v_source_records);

  if p_verdict='approved' then
    if coalesce((v_preflight->>'valid')::boolean,false) is not true then
      v_effective_verdict := 'revision_required';
    end if;
    if p_score is null or p_score < v_threshold then
      v_effective_verdict := 'revision_required';
    end if;
    for v_critical in select jsonb_array_elements_text(v_critical_checks) loop
      if coalesce((p_checks->>v_critical)::boolean,false) is not true then
        v_effective_verdict := 'revision_required';
      end if;
    end loop;
  end if;

  v_review_id := public.submit_generation_review(
    p_output_id,p_reviewer_id,v_effective_verdict,p_score,p_checks,
    case
      when p_verdict='approved' and v_effective_verdict='revision_required' and coalesce((v_preflight->>'valid')::boolean,false) is not true
      then concat_ws(E'\n',nullif(p_feedback,''),'Deterministic preflight failed: ' || (v_preflight->'errors')::text)
      else p_feedback
    end
  );

  perform public.refresh_batch_status(v_batch_id);
  return v_review_id;
end;
$$;

create or replace function public.create_business_story_preview_batch(p_execution_date date default current_date)
returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_logical_date date;
  v_batch_id uuid;
  v_job_id uuid;
  v_bundle text;
  v_i integer;
begin
  if p_execution_date is null then raise exception 'execution_date_required'; end if;

  for v_i in 1..365 loop
    v_logical_date := p_execution_date + v_i;
    exit when not exists (
      select 1 from public.automation_batches
      where edition_date=v_logical_date and edition_kind='test'
    );
  end loop;

  if v_logical_date is null then raise exception 'no_free_test_logical_date'; end if;

  select 'business_story:' || version into v_bundle
  from public.prompt_versions
  where prompt_key='business_story' and active=true
  limit 1;

  if v_bundle is null then raise exception 'no_active_business_story_prompt'; end if;

  insert into public.automation_batches(
    edition_date,edition_kind,status,expected_jobs,completed_jobs,approved_jobs,
    prompt_bundle_version,target_project_ref,metadata
  ) values (
    v_logical_date,'test','queued',1,0,0,v_bundle,'kukyotcgbnchsoeriqoz',
    jsonb_build_object(
      'test_mode','business_story_preview',
      'actual_execution_date',p_execution_date,
      'preview_target_date',p_execution_date,
      'publication_disabled',true,
      'full_publisher_disabled',true,
      'business_story_preview_allowed_after_independent_review',true,
      'pipeline_version','business-story-preview-v1'
    )
  ) returning id into v_batch_id;

  insert into public.generation_jobs(
    batch_id,content_type,ordinal,prompt_key,status,attempt_count,max_attempts,constraints
  ) values (
    v_batch_id,'business_story',1,'business_story','queued',0,3,
    jsonb_build_object(
      'languages',jsonb_build_array('fr','en'),
      'paired',true,
      'canonical_output_required',true,
      'source_records_required',true,
      'minimum_source_records',2,
      'editorial_memory_required',true,
      'freshness_mode','evergreen_business_story',
      'source_window_days',null,
      'body_word_range',jsonb_build_array(750,950),
      'body_word_target',jsonb_build_array(800,900),
      'reader_sections_are_full_story',true,
      'reader_section_word_range',jsonb_build_array(120,280),
      'reader_sections_total_word_range',jsonb_build_array(700,1000),
      'selection_rule','Choose a strong business mechanism story with enough evidence for a real narrative. Do not force a J/J-1 press release into a Business Story. Reject thin source packets and choose another story.',
      'preview_target_date',p_execution_date
    )
  ) returning id into v_job_id;

  perform public.refresh_batch_status(v_batch_id);

  return jsonb_build_object(
    'batch_id',v_batch_id,
    'job_id',v_job_id,
    'logical_test_date',v_logical_date,
    'preview_target_date',p_execution_date
  );
end;
$$;;
