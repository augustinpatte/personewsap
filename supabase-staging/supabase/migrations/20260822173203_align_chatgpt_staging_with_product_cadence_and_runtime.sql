alter table public.automation_batches drop constraint if exists automation_batches_edition_kind_check;
alter table public.automation_batches add constraint automation_batches_edition_kind_check check (edition_kind in ('regular','daily','weekly_digest','test'));

insert into public.automation_config(key,value) values
('runtime_contracts', jsonb_build_object(
  'common', jsonb_build_object(
    'prompt_execution','Each paired job runs the editorial prompt twice internally: once with language=fr and once with language=en. Never ask an editorial prompt to output both languages in one item. The two renders share the exact same source packet, factual core, angle, uncertainty and content identity.',
    'source_rule','Research/select sources first, freeze source_material and allowed_source_urls, then write using only that frozen packet. No facts, URLs, dates, numbers, quotes or publishers may be added during drafting.',
    'language_rule','Every user-facing string is entirely in the requested language; French keeps accents and natural punctuation; FR and EN are equivalent in facts, sources, dates, angle and depth but are not literal translations.'
  ),
  'newsletter_article', jsonb_build_object(
    'body_md_words_min',120,'body_md_words_max',220,
    'rules',jsonb_build_array(
      'Follow newsletter_prompt_final.md as editorial specification.',
      'Title names the concrete company, institution, market, figure or mechanism in the event.',
      'Body includes a sharp thesis, concrete mechanism, specific implication, observable signal and exact source/date line.',
      'source_urls contains only exact URLs frozen in allowed_source_urls.',
      'daily uses the current-edition recent window; weekly_digest uses the exact weekly period supplied in job constraints.',
      'The standalone JSON shown in the markdown prompt is editorial guidance only; emit the canonical daily-drop item contract.'
    )
  ),
  'business_story', jsonb_build_object(
    'body_md_words_min',260,'body_md_words_max',330,
    'rules',jsonb_build_array(
      'Follow business_story_prompt_final.md for narrative quality, hook, mechanism, factual discipline and anti-repetition.',
      'The 650-850 word standalone target in the editorial markdown is superseded for the mobile runtime by body_md 260-330 words.',
      'Render setup, tension, decision, outcome, lesson, body_md and complete editorial_memory.',
      'Use dates and real sources; distinguish fact from interpretation; no investment recommendation.',
      'The standalone JSON shown in the markdown prompt is editorial guidance only; emit the canonical daily-drop item contract.'
    )
  ),
  'mini_case', jsonb_build_object(
    'body_md_words_min',150,'body_md_words_max',260,'absolute_body_md_max',330,
    'rules',jsonb_build_array(
      'Follow mini_case_prompt_final.md for scenario design, pressure, difficulty, distractor quality, safety and memory rotation.',
      'Exactly 3 questions with roles method_framework, technical_application and conclusion_decision.',
      'Exactly 4 options per question and exactly one is_correct=true per question; score_max=3.',
      'Include product_topic, scenario_type, decision_type, concept_tested, mechanism, question_pattern, correct_answer_pattern, core_takeaway and final_takeaway.',
      'Law/health/markets remain educational and never personalized advice.',
      'The standalone JSON shown in the markdown prompt is editorial guidance only; emit the canonical daily-drop item contract.'
    )
  )
)) on conflict (key) do update set value=excluded.value;

insert into public.automation_config(key,value) values
('schedule_plan', jsonb_build_object(
  'timezone','Europe/Paris',
  'daily_days',jsonb_build_array('Monday','Wednesday','Friday'),
  'weekly_digest_day','Sunday',
  'quiet_days',jsonb_build_array('Tuesday','Thursday','Saturday'),
  'generator_a',jsonb_build_array('04:30','07:30'),
  'generator_b',jsonb_build_array('04:35','07:35'),
  'generator_c',jsonb_build_array('04:40','07:40'),
  'reviewer',jsonb_build_array('06:30','08:30'),
  'target_publication_time','09:17',
  'production_bridge_enabled',false,
  'production_automations_enabled',false,
  'notes','Cadence mirrors services/content-engine/src/scheduler/editionCadence.ts. Recurring ChatGPT workers stay paused until quality tests are approved.'
)) on conflict (key) do update set value=excluded.value;

create or replace function public.resolve_staging_edition_kind(p_date date default current_date)
returns text
language sql
immutable
set search_path to 'public','pg_temp'
as $$
  select case extract(dow from p_date)::int
    when 1 then 'daily'
    when 3 then 'daily'
    when 5 then 'daily'
    when 0 then 'weekly_digest'
    else null
  end;
$$;

create or replace function public.create_edition_batch(p_edition_date date, p_edition_kind text default 'daily')
returns uuid
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_batch_id uuid;
  v_bundle text;
  v_topic text;
  v_mini_topic text;
  v_ord integer;
  v_effective_type text;
  v_period_start date;
  v_period_end date;
begin
  if p_edition_kind not in ('daily','weekly_digest','test','regular') then
    raise exception 'invalid_edition_kind';
  end if;

  v_effective_type := case when p_edition_kind in ('test','regular') then coalesce(public.resolve_staging_edition_kind(p_edition_date),'daily') else p_edition_kind end;
  v_period_end := p_edition_date;
  v_period_start := case when v_effective_type='weekly_digest' then p_edition_date - 6 else p_edition_date - 1 end;

  select string_agg(prompt_key || ':' || version, '|' order by prompt_key)
    into v_bundle
  from public.prompt_versions
  where active=true;
  if v_bundle is null then raise exception 'no_active_prompts'; end if;

  insert into public.automation_batches(edition_date,edition_kind,status,expected_jobs,prompt_bundle_version,metadata)
  values (
    p_edition_date,p_edition_kind,'queued',23,v_bundle,
    jsonb_build_object(
      'pipeline_version','chatgpt-staging-v2',
      'paired_languages',true,
      'edition_type',v_effective_type,
      'period_start',v_period_start,
      'period_end',v_period_end
    )
  )
  on conflict (edition_date,edition_kind) do update
    set prompt_bundle_version=excluded.prompt_bundle_version,
        expected_jobs=23,
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
          'topic',v_topic,'ordinal',v_ord,'edition_type',v_effective_type,
          'period_start',v_period_start,'period_end',v_period_end,
          'source_window_days',case when v_effective_type='weekly_digest' then 7 else 2 end
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
      'editorial_memory_required',true,'edition_type',v_effective_type
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
        'edition_type',v_effective_type
      )
    ) on conflict do nothing;
  end loop;

  perform public.refresh_batch_status(v_batch_id);
  return v_batch_id;
end;
$$;

create or replace function public.create_scheduled_edition_batch(p_edition_date date default current_date)
returns uuid
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare v_kind text;
begin
  v_kind := public.resolve_staging_edition_kind(p_edition_date);
  if v_kind is null then return null; end if;
  return public.create_edition_batch(p_edition_date,v_kind);
end;
$$;

create or replace function public.claim_generation_job_context_v3(
  p_worker_id text,
  p_limit integer default 8,
  p_lease_minutes integer default 120,
  p_edition_kind text default 'daily',
  p_edition_date date default current_date
)
returns setof jsonb
language sql
set search_path to 'public','pg_temp'
as $$
with claimed as (
  select * from public.claim_generation_jobs_v2(p_worker_id,p_limit,p_lease_minutes,p_edition_kind,p_edition_date)
)
select jsonb_build_object(
  'job',to_jsonb(c),
  'batch',jsonb_build_object('edition_kind',b.edition_kind,'edition_date',b.edition_date,'status',b.status,'prompt_bundle_version',b.prompt_bundle_version,'metadata',b.metadata),
  'prompt',jsonb_build_object('prompt_key',p.prompt_key,'version',p.version,'sha256',p.sha256,'metadata',p.metadata),
  'runtime_contract',(select value -> c.content_type from public.automation_config where key='runtime_contracts'),
  'common_runtime_contract',(select value -> 'common' from public.automation_config where key='runtime_contracts'),
  'canonical_output_contract',(select value from public.automation_config where key='canonical_output_contract'),
  'source_record_contract',(select value from public.automation_config where key='source_record_contract'),
  'editorial_memory',public.latest_editorial_memory_snapshot(),
  'pipeline_config',(select value from public.automation_config where key='pipeline')
)
from claimed c
join public.automation_batches b on b.id=c.batch_id
join public.prompt_versions p on p.prompt_key=c.prompt_key and p.active=true;
$$;

create or replace function public.get_generation_review_queue_v4(
  p_limit integer default 30,
  p_edition_kind text default 'daily',
  p_edition_date date default current_date
)
returns setof jsonb
language sql
stable
set search_path to 'public','pg_temp'
as $$
select jsonb_build_object(
  'batch',jsonb_build_object('id',b.id,'edition_kind',b.edition_kind,'edition_date',b.edition_date,'status',b.status,'metadata',b.metadata),
  'job',to_jsonb(j),
  'output',jsonb_build_object('id',o.id,'attempt',o.attempt,'worker_id',o.worker_id,'prompt_version',o.prompt_version,'output_json',o.output_json,'source_records',o.source_records,'submitted_at',o.submitted_at),
  'deterministic_preflight',public.validate_generation_output(j.id,o.output_json,o.source_records),
  'reviewer_prompt',(select jsonb_build_object('version',version,'content',content,'metadata',metadata) from public.prompt_versions where prompt_key='reviewer' and active=true limit 1),
  'runtime_contract',(select value -> j.content_type from public.automation_config where key='runtime_contracts'),
  'common_runtime_contract',(select value -> 'common' from public.automation_config where key='runtime_contracts'),
  'review_policy',(select value from public.automation_config where key='review_policy'),
  'editorial_memory',public.latest_editorial_memory_snapshot()
)
from public.automation_batches b
join public.generation_jobs j on j.batch_id=b.id
join public.generation_outputs o on o.job_id=j.id and o.attempt=j.attempt_count
left join public.generation_reviews r on r.output_id=o.id
where b.edition_kind=p_edition_kind and b.edition_date=p_edition_date and j.status='submitted' and r.id is null
order by o.submitted_at
limit greatest(1,least(p_limit,100));
$$;

create or replace function public.create_quality_test_batch(p_scope text default 'sample', p_simulated_edition_type text default 'daily')
returns uuid
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_batch_id uuid;
  v_bundle text;
  v_topic text;
  v_mini_topic text;
  v_ord integer;
  v_expected integer;
  v_period_start date;
begin
  if p_scope not in ('sample','full') then raise exception 'invalid_test_scope'; end if;
  if p_simulated_edition_type not in ('daily','weekly_digest') then raise exception 'invalid_simulated_edition_type'; end if;

  delete from public.automation_batches where edition_date=current_date and edition_kind='test';
  select string_agg(prompt_key || ':' || version, '|' order by prompt_key) into v_bundle from public.prompt_versions where active=true;
  v_expected := case when p_scope='sample' then 3 else 23 end;
  v_period_start := case when p_simulated_edition_type='weekly_digest' then current_date-6 else current_date-1 end;

  insert into public.automation_batches(edition_date,edition_kind,status,expected_jobs,prompt_bundle_version,metadata)
  values(current_date,'test','queued',v_expected,v_bundle,jsonb_build_object('pipeline_version','chatgpt-staging-v2','paired_languages',true,'test_scope',p_scope,'edition_type',p_simulated_edition_type,'period_start',v_period_start,'period_end',current_date))
  returning id into v_batch_id;

  if p_scope='sample' then
    insert into public.generation_jobs(batch_id,content_type,topic,ordinal,prompt_key,constraints)
    values(v_batch_id,'newsletter_article','tech_ai',1,'newsletter',jsonb_build_object('languages',jsonb_build_array('fr','en'),'paired',true,'canonical_output_required',true,'source_records_required',true,'topic','tech_ai','ordinal',1,'edition_type',p_simulated_edition_type,'period_start',v_period_start,'period_end',current_date,'source_window_days',case when p_simulated_edition_type='weekly_digest' then 7 else 2 end,'quality_test',true));
    insert into public.generation_jobs(batch_id,content_type,ordinal,prompt_key,constraints)
    values(v_batch_id,'business_story',1,'business_story',jsonb_build_object('languages',jsonb_build_array('fr','en'),'paired',true,'canonical_output_required',true,'source_records_required',true,'editorial_memory_required',true,'edition_type',p_simulated_edition_type,'quality_test',true));
    insert into public.generation_jobs(batch_id,content_type,mini_case_topic,ordinal,prompt_key,constraints)
    values(v_batch_id,'mini_case','finance_economy',1,'mini_case',jsonb_build_object('languages',jsonb_build_array('fr','en'),'paired',true,'canonical_output_required',true,'source_records_required',true,'editorial_memory_required',true,'product_topic','finance_economy','edition_type',p_simulated_edition_type,'quality_test',true));
  else
    foreach v_topic in array array['business','finance','tech_ai','law','medicine','engineering','sport_business','culture_media'] loop
      for v_ord in 1..2 loop
        insert into public.generation_jobs(batch_id,content_type,topic,ordinal,prompt_key,constraints)
        values(v_batch_id,'newsletter_article',v_topic,v_ord,'newsletter',jsonb_build_object('languages',jsonb_build_array('fr','en'),'paired',true,'canonical_output_required',true,'source_records_required',true,'topic',v_topic,'ordinal',v_ord,'edition_type',p_simulated_edition_type,'period_start',v_period_start,'period_end',current_date,'source_window_days',case when p_simulated_edition_type='weekly_digest' then 7 else 2 end,'quality_test',true));
      end loop;
    end loop;
    insert into public.generation_jobs(batch_id,content_type,ordinal,prompt_key,constraints)
    values(v_batch_id,'business_story',1,'business_story',jsonb_build_object('languages',jsonb_build_array('fr','en'),'paired',true,'canonical_output_required',true,'source_records_required',true,'editorial_memory_required',true,'edition_type',p_simulated_edition_type,'quality_test',true));
    foreach v_mini_topic in array array['finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations'] loop
      insert into public.generation_jobs(batch_id,content_type,mini_case_topic,ordinal,prompt_key,constraints)
      values(v_batch_id,'mini_case',v_mini_topic,1,'mini_case',jsonb_build_object('languages',jsonb_build_array('fr','en'),'paired',true,'canonical_output_required',true,'source_records_required',true,'editorial_memory_required',true,'product_topic',v_mini_topic,'edition_type',p_simulated_edition_type,'quality_test',true));
    end loop;
  end if;

  perform public.refresh_batch_status(v_batch_id);
  return v_batch_id;
end;
$$;;
