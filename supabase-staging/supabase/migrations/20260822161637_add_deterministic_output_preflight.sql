create or replace function public.validate_generation_output(
  p_job_id uuid,
  p_output_json jsonb,
  p_source_records jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
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
    select coalesce(array_agg(s->>'url') filter (where nullif(s->>'url','') is not null), array[]::text[])
      into v_source_urls
    from jsonb_array_elements(coalesce(p_source_records,'[]'::jsonb)) s;
  end if;

  if v_job.content_type='newsletter_article' then
    v_required := array['content_type','slot','language','title','topic','source_urls','version','published_date','summary','body_md','why_it_matters'];
  elsif v_job.content_type='business_story' then
    v_required := array['content_type','slot','language','title','topic','source_urls','version','company_or_market','story_date','setup','tension','decision','outcome','lesson','body_md','editorial_memory'];
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
      for v_url in select jsonb_array_elements_text(v_item->'source_urls') loop
        if not (v_url = any(v_source_urls)) then
          v_errors := v_errors || jsonb_build_array(v_lang || ':undeclared_source_url:' || v_url);
        end if;
      end loop;
    end if;

    if v_job.content_type in ('newsletter_article','business_story') and coalesce(array_length(v_source_urls,1),0)=0 then
      v_errors := v_errors || jsonb_build_array(v_lang || ':source_records_required');
    end if;

    if v_job.content_type='mini_case' then
      if coalesce(v_item->>'product_topic','') <> coalesce(v_job.mini_case_topic,'') then
        v_errors := v_errors || jsonb_build_array(v_lang || ':product_topic_mismatch');
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

create or replace function public.submit_generation_output_v3(
  p_job_id uuid,
  p_worker_id text,
  p_output_json jsonb,
  p_source_records jsonb,
  p_prompt_version text
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_check jsonb;
  v_output_id uuid;
begin
  v_check := public.validate_generation_output(p_job_id,p_output_json,p_source_records);
  if coalesce((v_check->>'valid')::boolean,false) is not true then
    raise exception 'output_preflight_failed: %', v_check->'errors';
  end if;

  v_output_id := public.submit_generation_output_v2(
    p_job_id,p_worker_id,p_output_json,p_source_records,p_prompt_version
  );
  return v_output_id;
end;
$$;

revoke all on function public.validate_generation_output(uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.submit_generation_output_v3(uuid,text,jsonb,jsonb,text) from public,anon,authenticated;;
