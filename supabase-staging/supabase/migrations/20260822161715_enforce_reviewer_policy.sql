create or replace function public.get_generation_review_queue_v2(p_limit integer default 30)
returns setof jsonb
language sql
stable
set search_path = public, pg_temp
as $$
select jsonb_build_object(
  'job', to_jsonb(j),
  'output', jsonb_build_object(
    'id',o.id,
    'attempt',o.attempt,
    'worker_id',o.worker_id,
    'prompt_version',o.prompt_version,
    'output_json',o.output_json,
    'source_records',o.source_records,
    'submitted_at',o.submitted_at
  ),
  'deterministic_preflight',public.validate_generation_output(j.id,o.output_json,o.source_records),
  'reviewer_prompt',(select jsonb_build_object('version',version,'content',content,'metadata',metadata) from public.prompt_versions where prompt_key='reviewer' and active=true limit 1),
  'review_policy',(select value from public.automation_config where key='review_policy'),
  'editorial_memory',public.latest_editorial_memory_snapshot()
)
from public.generation_jobs j
join public.generation_outputs o on o.job_id=j.id and o.attempt=j.attempt_count
left join public.generation_reviews r on r.output_id=o.id
where j.status='submitted' and r.id is null
order by o.submitted_at
limit greatest(1,least(p_limit,100));
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
set search_path = public, pg_temp
as $$
declare
  v_threshold integer := 90;
  v_critical text;
  v_effective_verdict text := p_verdict;
begin
  select coalesce((value->>'approval_threshold')::integer,90)
    into v_threshold
  from public.automation_config where key='review_policy';

  if p_verdict='approved' then
    if p_score is null or p_score < v_threshold then
      v_effective_verdict := 'revision_required';
    end if;

    foreach v_critical in array array['source_grounding','factual_accuracy','safety','schema','fr_en_parity'] loop
      if coalesce((p_checks->>v_critical)::boolean,false) is not true then
        v_effective_verdict := 'revision_required';
      end if;
    end loop;
  end if;

  return public.submit_generation_review(
    p_output_id,p_reviewer_id,v_effective_verdict,p_score,p_checks,p_feedback
  );
end;
$$;

revoke all on function public.get_generation_review_queue_v2(integer) from public,anon,authenticated;
revoke all on function public.submit_generation_review_v2(uuid,text,text,integer,jsonb,text) from public,anon,authenticated;;
