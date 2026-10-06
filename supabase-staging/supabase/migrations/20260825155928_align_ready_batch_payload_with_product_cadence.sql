create or replace function public.get_ready_batch_payload(p_edition_date date)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_batch public.automation_batches%rowtype;
  v_total integer;
  v_approved integer;
  v_payload jsonb;
  v_kind text;
begin
  v_kind := public.resolve_staging_edition_kind(p_edition_date);

  if v_kind is null then
    return jsonb_build_object(
      'ready',false,
      'reason','quiet_day',
      'edition_date',p_edition_date
    );
  end if;

  select * into v_batch
  from public.automation_batches
  where edition_date=p_edition_date and edition_kind=v_kind
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ready',false,
      'reason','batch_not_found',
      'edition_date',p_edition_date,
      'edition_kind',v_kind
    );
  end if;

  select count(*), count(*) filter (where status='approved')
  into v_total,v_approved
  from public.generation_jobs
  where batch_id=v_batch.id;

  if v_batch.status <> 'ready' or v_total <> 23 or v_approved <> 23 then
    return jsonb_build_object(
      'ready',false,
      'reason','batch_not_fully_approved',
      'batch_id',v_batch.id,
      'batch_status',v_batch.status,
      'edition_kind',v_batch.edition_kind,
      'total_jobs',v_total,
      'approved_jobs',v_approved
    );
  end if;

  select jsonb_build_object(
    'ready',true,
    'batch',jsonb_build_object(
      'id',v_batch.id,
      'edition_date',v_batch.edition_date,
      'edition_kind',v_batch.edition_kind,
      'prompt_bundle_version',v_batch.prompt_bundle_version,
      'target_project_ref',v_batch.target_project_ref,
      'metadata',v_batch.metadata
    ),
    'jobs',coalesce(jsonb_agg(
      jsonb_build_object(
        'job_id',j.id,
        'content_type',j.content_type,
        'topic',j.topic,
        'mini_case_topic',j.mini_case_topic,
        'ordinal',j.ordinal,
        'attempt',j.attempt_count,
        'prompt_key',j.prompt_key,
        'output_id',o.id,
        'prompt_version',o.prompt_version,
        'output_json',o.output_json,
        'source_records',o.source_records,
        'review',jsonb_build_object(
          'id',r.id,
          'reviewer_id',r.reviewer_id,
          'verdict',r.verdict,
          'score',r.score,
          'checks',r.checks,
          'feedback',r.feedback,
          'reviewed_at',r.reviewed_at
        )
      ) order by
        case j.content_type when 'newsletter_article' then 1 when 'business_story' then 2 else 3 end,
        j.topic nulls last,j.mini_case_topic nulls last,j.ordinal
    ),'[]'::jsonb)
  ) into v_payload
  from public.generation_jobs j
  join public.generation_outputs o on o.job_id=j.id and o.attempt=j.attempt_count
  join public.generation_reviews r on r.output_id=o.id and r.verdict='approved'
  where j.batch_id=v_batch.id and j.status='approved';

  return v_payload;
end;
$function$;;
