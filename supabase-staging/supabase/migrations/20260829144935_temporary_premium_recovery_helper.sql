create or replace function public._tmp_replace_premium_recovery_items(p_items jsonb)
returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  it jsonb;
  v_date date;
  v_batch uuid;
  v_job uuid;
  v_output uuid;
  v_check jsonb;
  v_urls jsonb;
  v_n int := 0;
  v_result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'items_must_be_array'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_date := (it->>'edition_date')::date;
    if v_date < date '2026-09-09' or v_date > date '2026-10-30' then raise exception 'date_out_of_scope:%',v_date; end if;
    select id into strict v_batch from public.automation_batches where edition_date=v_date and edition_kind='daily' order by created_at desc limit 1;
    if it->>'content_type'='business_story' then
      select id into strict v_job from public.generation_jobs where batch_id=v_batch and content_type='business_story';
    elsif it->>'content_type'='mini_case' then
      select id into strict v_job from public.generation_jobs where batch_id=v_batch and content_type='mini_case' and mini_case_topic=it->>'mini_case_topic';
    else raise exception 'unsupported_content_type'; end if;
    v_check := public.validate_generation_output(v_job,it->'output_json',it->'source_records');
    if coalesce((v_check->>'valid')::boolean,false) is not true then raise exception 'preflight_failed job %: %',v_job,v_check->'errors'; end if;
    select id into strict v_output from public.generation_outputs where job_id=v_job order by attempt desc, submitted_at desc limit 1;
    select coalesce(jsonb_agg(to_jsonb(s->>'url')) filter (where nullif(s->>'url','') is not null),'[]'::jsonb)
      into v_urls from jsonb_array_elements(it->'source_records') s;
    update public.generation_outputs
      set worker_id='personews-premium-recovery-direct-v2',
          prompt_version=(it->>'prompt_version')||'-recovery-v2',
          output_json=it->'output_json',
          source_records=it->'source_records',
          source_urls=v_urls,
          submitted_at=now()
      where id=v_output;
    update public.generation_jobs set status='approved',last_error=null,updated_at=now() where id=v_job;
    perform public.refresh_batch_status(v_batch);
    v_n:=v_n+1;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('date',v_date,'job_id',v_job,'output_id',v_output,'title',it->'output_json'->'en'->>'title'));
  end loop;
  return jsonb_build_object('replaced',v_n,'items',v_result);
end;
$$;;
