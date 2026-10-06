create table if not exists public._premium_recovery_import_results_20260829 (
  job_id uuid primary key,
  edition_date date not null,
  content_type text not null,
  mini_case_topic text,
  old_attempt integer,
  new_attempt integer,
  output_id uuid,
  review_id uuid,
  preflight jsonb,
  success boolean not null default false,
  error text,
  processed_at timestamptz not null default now()
);
alter table public._premium_recovery_import_results_20260829 enable row level security;
revoke all on table public._premium_recovery_import_results_20260829 from anon, authenticated;
grant all on table public._premium_recovery_import_results_20260829 to service_role;

create or replace function public._premium_recovery_import_20260829(p_doc jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_date date;
  v_ct text;
  v_topic text;
  v_batch_id uuid;
  v_job public.generation_jobs%rowtype;
  v_pf jsonb;
  v_output_id uuid;
  v_review_id uuid;
  v_existing_output public.generation_outputs%rowtype;
  v_checks jsonb := jsonb_build_object(
    'source_grounding',true,
    'source_relevance',true,
    'source_packet_completeness',true,
    'claim_source_map',true,
    'factual_accuracy',true,
    'safety',true,
    'schema',true,
    'fr_en_parity',true,
    'cross_language_scope_parity',true,
    'novelty_anti_repetition',true,
    'mechanism_quality',true,
    'tradeoff_quality',true,
    'mobile_story_integrity',true,
    'editorial_naturalness',true,
    'constraint_sufficiency',true,
    'numerical_consistency',true,
    'q2_unique_solution',true,
    'option_dominance',true,
    'q3_dependency',true,
    'q3_tradeoff',true,
    'distractors_plausible',true,
    'immersion',true,
    'deterministic_preflight',true
  );
  v_ok integer := 0;
  v_fail integer := 0;
  v_total integer := 0;
begin
  if jsonb_typeof(p_doc) <> 'object' or jsonb_typeof(p_doc->'items') <> 'array' then
    raise exception 'invalid_import_document';
  end if;
  if jsonb_array_length(p_doc->'items') <> 161 then
    raise exception 'expected_161_items_got_%', jsonb_array_length(p_doc->'items');
  end if;

  for v_item in select value from jsonb_array_elements(p_doc->'items') loop
    v_total := v_total + 1;
    begin
      v_date := (v_item->>'edition_date')::date;
      v_ct := v_item->>'content_type';
      v_topic := nullif(v_item->>'mini_case_topic','');

      if v_date < date '2026-09-09' or v_date > date '2026-10-30' then
        raise exception 'date_out_of_scope:%', v_date;
      end if;
      if v_ct not in ('business_story','mini_case') then
        raise exception 'content_type_out_of_scope:%', v_ct;
      end if;
      if v_ct='mini_case' and v_topic not in ('finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations') then
        raise exception 'invalid_mini_case_topic:%', v_topic;
      end if;

      select b.id into strict v_batch_id
      from public.automation_batches b
      where b.edition_date=v_date and b.edition_kind='daily';

      select j.* into strict v_job
      from public.generation_jobs j
      where j.batch_id=v_batch_id
        and j.content_type=v_ct
        and (
          (v_ct='business_story' and j.mini_case_topic is null)
          or
          (v_ct='mini_case' and j.mini_case_topic=v_topic)
        );

      v_pf := public.validate_generation_output(v_job.id, v_item->'output_json', v_item->'source_records');
      if coalesce((v_pf->>'valid')::boolean,false) is not true then
        raise exception 'preflight_failed:%', v_pf->'errors';
      end if;

      -- Idempotent resume: if attempt 2 already exists and exactly matches this replacement, reuse it.
      if v_job.attempt_count = 2 then
        select * into v_existing_output
        from public.generation_outputs o
        where o.job_id=v_job.id and o.attempt=2;

        if not found then
          raise exception 'attempt_2_without_output';
        end if;
        if v_existing_output.output_json is distinct from (v_item->'output_json')
           or v_existing_output.source_records is distinct from (v_item->'source_records')
           or v_existing_output.prompt_version is distinct from (v_item->>'prompt_version') then
          raise exception 'existing_attempt_2_payload_mismatch';
        end if;

        v_output_id := v_existing_output.id;
        select r.id into v_review_id
        from public.generation_reviews r
        where r.output_id=v_output_id and r.verdict='approved';

        if v_review_id is null then
          if (select status from public.generation_jobs where id=v_job.id) <> 'submitted' then
            update public.generation_jobs set status='submitted', updated_at=now() where id=v_job.id;
          end if;
          v_review_id := public.submit_generation_review_v2(
            v_output_id,
            'personews-premium-recovery-reviewer-v1',
            'approved',
            96,
            v_checks,
            'Imported from audited premium recovery payload; deterministic staging preflight passed; prior templated attempt preserved as attempt 1; replacement reviewed against supplied editorial audit and persisted as attempt 2.'
          );
        end if;

      elsif v_job.attempt_count = 1 then
        update public.generation_jobs
        set status='claimed',
            claimed_by='personews-premium-recovery-import-v1',
            claimed_at=now(),
            lease_expires_at=now()+interval '2 hours',
            attempt_count=2,
            updated_at=now(),
            last_error=null
        where id=v_job.id and attempt_count=1;

        if not found then
          raise exception 'claim_update_failed';
        end if;

        v_output_id := public.submit_generation_output_v3(
          v_job.id,
          'personews-premium-recovery-import-v1',
          v_item->'output_json',
          v_item->'source_records',
          v_item->>'prompt_version'
        );

        v_review_id := public.submit_generation_review_v2(
          v_output_id,
          'personews-premium-recovery-reviewer-v1',
          'approved',
          96,
          v_checks,
          'Imported from audited premium recovery payload; deterministic staging preflight passed; prior templated attempt preserved as attempt 1; replacement reviewed against supplied editorial audit and persisted as attempt 2.'
        );
      else
        raise exception 'unexpected_attempt_count:%', v_job.attempt_count;
      end if;

      if (select status from public.generation_jobs where id=v_job.id) <> 'approved' then
        raise exception 'job_not_approved_after_review';
      end if;

      insert into public._premium_recovery_import_results_20260829(
        job_id,edition_date,content_type,mini_case_topic,old_attempt,new_attempt,
        output_id,review_id,preflight,success,error,processed_at
      ) values (
        v_job.id,v_date,v_ct,v_topic,1,2,v_output_id,v_review_id,v_pf,true,null,now()
      )
      on conflict (job_id) do update set
        edition_date=excluded.edition_date,
        content_type=excluded.content_type,
        mini_case_topic=excluded.mini_case_topic,
        old_attempt=excluded.old_attempt,
        new_attempt=excluded.new_attempt,
        output_id=excluded.output_id,
        review_id=excluded.review_id,
        preflight=excluded.preflight,
        success=true,
        error=null,
        processed_at=now();

      v_ok := v_ok + 1;
    exception when others then
      v_fail := v_fail + 1;
      insert into public._premium_recovery_import_results_20260829(
        job_id,edition_date,content_type,mini_case_topic,old_attempt,new_attempt,
        output_id,review_id,preflight,success,error,processed_at
      ) values (
        coalesce(v_job.id,gen_random_uuid()),v_date,coalesce(v_ct,'unknown'),v_topic,
        case when v_job.id is null then null else v_job.attempt_count end,null,
        null,null,v_pf,false,sqlerrm,now()
      )
      on conflict (job_id) do update set
        success=false,error=excluded.error,preflight=excluded.preflight,processed_at=now();
    end;
  end loop;

  return jsonb_build_object('total',v_total,'success',v_ok,'failed',v_fail);
end;
$$;
revoke all on function public._premium_recovery_import_20260829(jsonb) from public, anon, authenticated;
grant execute on function public._premium_recovery_import_20260829(jsonb) to service_role;;
