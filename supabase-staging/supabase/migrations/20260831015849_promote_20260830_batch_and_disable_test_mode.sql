begin;

update public.automation_batches
set edition_kind='weekly_digest',
    target_project_ref='wkbviidrbmehmjbhvpeh',
    metadata = (metadata - 'publication_disabled' - 'archive_reason' - 'archived_from_daily_date') || jsonb_build_object(
      'edition_type','weekly_digest',
      'period_start','2026-08-24',
      'period_end','2026-08-30',
      'publication_mode','production',
      'promoted_from_test',true
    ),
    updated_at=now()
where id='9afbf099-a49c-4392-b6ed-7ba9b3f72656';

create or replace function public.create_edition_batch(p_edition_date date, p_edition_kind text default 'daily')
returns uuid
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_batch_id uuid;
  v_bundle text;
  v_topic text;
  v_mini_topic text;
  v_ord integer;
  v_period_start date;
  v_period_end date;
begin
  if p_edition_kind not in ('daily','weekly_digest') then
    raise exception 'invalid_edition_kind_production_only';
  end if;

  v_period_end := p_edition_date;
  v_period_start := case when p_edition_kind='weekly_digest' then p_edition_date - 6 else p_edition_date - 1 end;

  select string_agg(prompt_key || ':' || version, '|' order by prompt_key)
    into v_bundle
  from public.prompt_versions
  where active=true;
  if v_bundle is null then raise exception 'no_active_prompts'; end if;

  insert into public.automation_batches(
    edition_date,edition_kind,status,expected_jobs,prompt_bundle_version,target_project_ref,metadata
  )
  values (
    p_edition_date,p_edition_kind,'queued',23,v_bundle,'wkbviidrbmehmjbhvpeh',
    jsonb_build_object(
      'pipeline_version','chatgpt-staging-v2',
      'paired_languages',true,
      'edition_type',p_edition_kind,
      'period_start',v_period_start,
      'period_end',v_period_end,
      'publication_mode','production'
    )
  )
  on conflict (edition_date,edition_kind) do update
    set prompt_bundle_version=excluded.prompt_bundle_version,
        expected_jobs=23,
        target_project_ref='wkbviidrbmehmjbhvpeh',
        metadata=excluded.metadata,
        updated_at=now()
  returning id into v_batch_id;

  foreach v_topic in array array['business','finance','tech_ai','law','medicine','engineering','sport_business','culture_media'] loop
    for v_ord in 1..2 loop
      insert into public.generation_jobs(batch_id,content_type,topic,ordinal,prompt_key,constraints)
      values (
        v_batch_id,'newsletter_article',v_topic,v_ord,'newsletter',
        jsonb_build_object(
          'languages',jsonb_build_array('fr','en'),'paired',true,
          'canonical_output_required',true,'source_records_required',true,
          'topic',v_topic,'ordinal',v_ord,'edition_type',p_edition_kind,
          'period_start',v_period_start,'period_end',v_period_end,
          'source_window_days',case when p_edition_kind='weekly_digest' then 7 else 2 end
        )
      ) on conflict do nothing;
    end loop;
  end loop;

  insert into public.generation_jobs(batch_id,content_type,ordinal,prompt_key,constraints)
  values (
    v_batch_id,'business_story',1,'business_story',
    jsonb_build_object(
      'languages',jsonb_build_array('fr','en'),'paired',true,
      'canonical_output_required',true,'source_records_required',true,
      'editorial_memory_required',true,'edition_type',p_edition_kind
    )
  ) on conflict do nothing;

  foreach v_mini_topic in array array['finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations'] loop
    insert into public.generation_jobs(batch_id,content_type,mini_case_topic,ordinal,prompt_key,constraints)
    values (
      v_batch_id,'mini_case',v_mini_topic,1,'mini_case',
      jsonb_build_object(
        'languages',jsonb_build_array('fr','en'),'paired',true,
        'canonical_output_required',true,'source_records_required',true,
        'editorial_memory_required',true,'product_topic',v_mini_topic,
        'edition_type',p_edition_kind
      )
    ) on conflict do nothing;
  end loop;

  perform public.refresh_batch_status(v_batch_id);
  return v_batch_id;
end;
$function$;

commit;;
