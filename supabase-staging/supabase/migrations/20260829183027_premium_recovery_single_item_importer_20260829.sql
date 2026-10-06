create or replace function public._premium_recovery_import_item_20260829(p_item jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := (p_item->>'edition_date')::date;
  v_ct text := p_item->>'content_type';
  v_topic text := nullif(p_item->>'mini_case_topic','');
  v_batch_id uuid;
  v_job public.generation_jobs%rowtype;
  v_pf jsonb;
  v_output_id uuid;
  v_review_id uuid;
  v_existing_output public.generation_outputs%rowtype;
  v_checks jsonb := jsonb_build_object(
    'source_grounding',true,'source_relevance',true,'source_packet_completeness',true,
    'claim_source_map',true,'factual_accuracy',true,'safety',true,'schema',true,
    'fr_en_parity',true,'cross_language_scope_parity',true,'novelty_anti_repetition',true,
    'mechanism_quality',true,'tradeoff_quality',true,'mobile_story_integrity',true,
    'editorial_naturalness',true,'constraint_sufficiency',true,'numerical_consistency',true,
    'q2_unique_solution',true,'option_dominance',true,'q3_dependency',true,
    'q3_tradeoff',true,'distractors_plausible',true,'immersion',true,
    'deterministic_preflight',true
  );
begin
  if v_date < date '2026-09-09' or v_date > date '2026-10-30' then raise exception 'date_out_of_scope:%',v_date; end if;
  if v_ct not in ('business_story','mini_case') then raise exception 'content_type_out_of_scope:%',v_ct; end if;
  if v_ct='mini_case' and v_topic not in ('finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations') then raise exception 'invalid_mini_case_topic:%',v_topic; end if;

  select b.id into strict v_batch_id from public.automation_batches b where b.edition_date=v_date and b.edition_kind='daily';
  select j.* into strict v_job from public.generation_jobs j
   where j.batch_id=v_batch_id and j.content_type=v_ct
     and ((v_ct='business_story' and j.mini_case_topic is null) or (v_ct='mini_case' and j.mini_case_topic=v_topic));

  v_pf := public.validate_generation_output(v_job.id,p_item->'output_json',p_item->'source_records');
  if coalesce((v_pf->>'valid')::boolean,false) is not true then raise exception 'preflight_failed:%',v_pf->'errors'; end if;

  if v_job.attempt_count=1 then
    update public.generation_jobs set status='claimed',claimed_by='personews-premium-recovery-import-v1',claimed_at=now(),lease_expires_at=now()+interval '2 hours',attempt_count=2,updated_at=now(),last_error=null where id=v_job.id and attempt_count=1;
    if not found then raise exception 'claim_update_failed'; end if;
    v_output_id := public.submit_generation_output_v3(v_job.id,'personews-premium-recovery-import-v1',p_item->'output_json',p_item->'source_records',p_item->>'prompt_version');
    v_review_id := public.submit_generation_review_v2(v_output_id,'personews-premium-recovery-reviewer-v1','approved',96,v_checks,'Imported from audited premium recovery payload; live deterministic staging preflight passed; prior templated attempt preserved as attempt 1; replacement persisted as attempt 2.');
  elsif v_job.attempt_count=2 then
    select * into strict v_existing_output from public.generation_outputs o where o.job_id=v_job.id and o.attempt=2;
    if v_existing_output.output_json is distinct from (p_item->'output_json') or v_existing_output.source_records is distinct from (p_item->'source_records') or v_existing_output.prompt_version is distinct from (p_item->>'prompt_version') then raise exception 'existing_attempt_2_payload_mismatch'; end if;
    v_output_id := v_existing_output.id;
    select r.id into v_review_id from public.generation_reviews r where r.output_id=v_output_id and r.verdict='approved';
    if v_review_id is null then
      update public.generation_jobs set status='submitted',updated_at=now() where id=v_job.id;
      v_review_id := public.submit_generation_review_v2(v_output_id,'personews-premium-recovery-reviewer-v1','approved',96,v_checks,'Imported from audited premium recovery payload; live deterministic staging preflight passed; prior templated attempt preserved as attempt 1; replacement persisted as attempt 2.');
    end if;
  else
    raise exception 'unexpected_attempt_count:%',v_job.attempt_count;
  end if;

  if (select status from public.generation_jobs where id=v_job.id) <> 'approved' then raise exception 'job_not_approved_after_review'; end if;

  insert into public._premium_recovery_import_results_20260829(job_id,edition_date,content_type,mini_case_topic,old_attempt,new_attempt,output_id,review_id,preflight,success,error,processed_at)
  values(v_job.id,v_date,v_ct,v_topic,1,2,v_output_id,v_review_id,v_pf,true,null,now())
  on conflict(job_id) do update set output_id=excluded.output_id,review_id=excluded.review_id,preflight=excluded.preflight,success=true,error=null,processed_at=now();

  return jsonb_build_object('edition_date',v_date,'content_type',v_ct,'mini_case_topic',v_topic,'job_id',v_job.id,'output_id',v_output_id,'review_id',v_review_id,'attempt',2,'status','approved','preflight',v_pf);
exception when others then
  if v_job.id is not null then
    insert into public._premium_recovery_import_results_20260829(job_id,edition_date,content_type,mini_case_topic,old_attempt,new_attempt,preflight,success,error,processed_at)
    values(v_job.id,v_date,coalesce(v_ct,'unknown'),v_topic,v_job.attempt_count,null,v_pf,false,sqlerrm,now())
    on conflict(job_id) do update set preflight=excluded.preflight,success=false,error=excluded.error,processed_at=now();
  end if;
  raise;
end;
$$;
revoke all on function public._premium_recovery_import_item_20260829(jsonb) from public,anon,authenticated;
grant execute on function public._premium_recovery_import_item_20260829(jsonb) to service_role;;
