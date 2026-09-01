-- "Will tonight's edition go out?" — STAGING project (kukyotcgbnchsoeriqoz).
--
-- One function, one answer. It exists because the question gets asked at 18:45 on
-- a Wednesday, and the answer must not require knowing which tables to join.

begin;

create or replace function public.next_scheduled_publication_date(p_from timestamptz default now())
returns date
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_today date := (p_from at time zone 'Europe/Paris')::date;
  v_hour integer := extract(hour from (p_from at time zone 'Europe/Paris'))::int;
  v_start date;
  v_candidate date;
begin
  -- Today still counts until 19:00 Paris has passed; after that the next
  -- interesting edition is the following publication day.
  v_start := case when v_hour < 19 then v_today else v_today + 1 end;

  for i in 0..7 loop
    v_candidate := v_start + i;
    if public.resolve_staging_edition_kind(v_candidate) is not null then
      return v_candidate;
    end if;
  end loop;

  return null;
end;
$function$;

/**
 * The operator's one-liner.
 *
 * Reports what the calendar wants, when the alarm will ring, whether the cron
 * entry is actually armed, and what the hard gate currently makes of the batch —
 * including, when it refuses, exactly which jobs are holding the edition up.
 */
create or replace function public.next_scheduled_publication_status()
returns jsonb
language plpgsql
volatile   -- calls assert_edition_publishable, which refreshes the batch status cache
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_date date := public.next_scheduled_publication_date();
  v_gate jsonb;
  v_cron jsonb;
  v_last jsonb;
begin
  if v_date is null then
    return jsonb_build_object('error','no_publication_day_found_in_the_next_week');
  end if;

  v_gate := public.assert_edition_publishable(v_date);

  select coalesce(jsonb_agg(jsonb_build_object(
    'jobname', jobname, 'schedule', schedule, 'active', active, 'command', command)), '[]'::jsonb)
  into v_cron
  from cron.job
  where jobname = 'personews-scheduled-publication';

  select coalesce(jsonb_agg(jsonb_build_object(
    'run_id', run_id, 'edition_date', edition_date, 'started_at', started_at,
    'reason', reason, 'gate_passed', gate_passed,
    'publication_succeeded', publication_succeeded,
    'production_verified', production_verified,
    'receipt_recorded', receipt_recorded) order by started_at desc), '[]'::jsonb)
  into v_last
  from (
    select * from public.scheduled_publication_runs order by started_at desc limit 3
  ) r;

  return jsonb_build_object(
    'now_paris', to_char(now() at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI Dy'),
    'next_edition_date', v_date,
    'next_edition_kind', public.resolve_staging_edition_kind(v_date),
    'fires_at_paris', to_char(v_date, 'YYYY-MM-DD') || ' 19:00',
    'fires_at_utc', ((v_date::text || ' 19:00')::timestamp at time zone 'Europe/Paris') at time zone 'UTC',
    'cron_job', v_cron,
    'cron_armed', jsonb_array_length(v_cron) > 0 and coalesce((v_cron->0->>'active')::boolean, false),
    'will_publish_now', coalesce((v_gate->>'ok')::boolean, false),
    'already_published', coalesce((v_gate->>'already_published')::boolean, false),
    'approved_jobs', coalesce(v_gate->>'approved_jobs', '0') || '/' || coalesce(v_gate->>'expected_jobs', '23'),
    'reason', v_gate->>'reason',
    'job_status_counts', v_gate->'job_status_counts',
    'blockers', v_gate->'blockers',
    'blocking_jobs', v_gate->'blocking_jobs',
    'recent_runs', v_last
  );
end;
$function$;

comment on function public.next_scheduled_publication_status() is
  'Operator one-liner: will the next PersoNews edition publish automatically, and if not, why not.';

revoke all on function public.next_scheduled_publication_date(timestamptz) from public, anon, authenticated;
revoke all on function public.next_scheduled_publication_status() from public, anon, authenticated;
grant execute on function public.next_scheduled_publication_date(timestamptz) to service_role, postgres;
grant execute on function public.next_scheduled_publication_status() to service_role, postgres;

commit;
