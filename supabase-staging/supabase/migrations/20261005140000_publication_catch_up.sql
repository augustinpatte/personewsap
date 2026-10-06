-- Catch-up publication, stale-run recovery and per-edition health — STAGING.
--
-- WHAT WAS WRONG
--
-- 19:00 Europe/Paris was a single shot. scheduled_publication_due() was true
-- only during the 19:00 hour, the cron fired at minute 0 only, and the tick
-- refused to fire within 30 minutes of any earlier attempt. So:
--   - a batch approved at 19:02 never published that evening;
--   - a staging Edge Function killed after production committed (no receipt,
--     no verification, no notification release) was never retried;
--   - a run left open by a killed function stayed open forever.
--
-- WHAT THIS DOES
--
-- 1. The publication WINDOW is 19:00–21:00 Europe/Paris on a publication day.
--    19:00 is still the target; the cron now fires every 15 minutes across the
--    UTC hours that can contain that window (17–20 UTC covers CEST and CET),
--    and the Paris-local guard decides, so DST never needs a table.
-- 2. One pure decision, scheduled_publication_tick_decision(), says whether a
--    tick fires. It fires only when: due (or forced), no batch for the date has
--    a publication receipt, no attempt is in flight, and the last attempt is at
--    least 10 minutes old. The advisory lock, the deterministic run id, the
--    receipt and the production-side same-batch idempotence
--    (20261005130000 in production) are unchanged and still make a repeat safe.
-- 3. A run still open after 10 minutes is abandoned explicitly
--    (reason 'stale_open_run_abandoned'), never marked successful. The next
--    tick re-runs the canonical batch: production completes it without
--    duplicating anything, verification runs, the receipt is written.
-- 4. scheduled_edition_publication_health(date) answers the monitoring
--    question for ONE edition date — did today's Paris edition publish? —
--    instead of looking at the latest published one. edition_publication_timeline()
--    shows everything about one date in one call.
--
-- Forward-only. Changes no existing row; the cron job is re-registered.

begin;

-- ---------------------------------------------------------------------------
-- 1. The window
-- ---------------------------------------------------------------------------

create or replace function public.scheduled_publication_window()
returns jsonb
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'timezone', 'Europe/Paris',
    'opens', '19:00',
    'last_attempt', '21:00',
    'health_deadline', '21:15',
    'catch_up_every_minutes', 15,
    'min_minutes_between_attempts', 10,
    'stale_after_minutes', 10);
$function$;

comment on function public.scheduled_publication_window() is
  'The publication window, in one place: target 19:00 Europe/Paris, catch-up attempts until 21:00, health deadline 21:15, at most one attempt per 10 minutes, an open run is stale after 10 minutes.';

-- Same signature as 20260901090000: true inside the window on a publication day.
create or replace function public.scheduled_publication_due(p_at timestamptz default now())
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select ((p_at at time zone 'Europe/Paris')::time between time '19:00' and time '21:00')
     and public.resolve_staging_edition_kind((p_at at time zone 'Europe/Paris')::date) is not null;
$function$;

comment on function public.scheduled_publication_due(timestamptz) is
  'True from 19:00 to 21:00 Europe/Paris on a PersoNews publication day: the 19:00 target plus its catch-up window. DST-correct by construction.';

create or replace function public.scheduled_edition_receipted(p_edition_date date)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.publication_receipts r
    join public.automation_batches b on b.id = r.batch_id
    where b.edition_date = p_edition_date
  );
$function$;

comment on function public.scheduled_edition_receipted(date) is
  'True when ANY batch for this edition date carries a publication receipt: the edition went out and was verified.';

-- ---------------------------------------------------------------------------
-- 2. Stale open runs
-- ---------------------------------------------------------------------------

create or replace function public.abandon_stale_publication_runs(
  p_edition_date date,
  p_at timestamptz default now()
)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_count integer;
begin
  update public.scheduled_publication_runs r
  set finished_at = p_at,
      reason = 'stale_open_run_abandoned',
      error = coalesce(r.error,
        'no outcome was recorded within 10 minutes: the publisher was terminated or timed out. '
        || 'Nothing is assumed about production; the next attempt re-runs the same batch.')
  where r.edition_date = p_edition_date
    and r.finished_at is null
    and r.started_at < p_at - interval '10 minutes';

  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into public.automation_health (batch_id, actor, event_type, severity, details)
    values (null, 'scheduled-publisher', 'scheduled_publication_stale_run', 'warning',
      jsonb_build_object('edition_date', p_edition_date, 'abandoned_runs', v_count));
  end if;

  return v_count;
end;
$function$;

comment on function public.abandon_stale_publication_runs(date, timestamptz) is
  'Closes publication runs for this date that have been open more than 10 minutes, as stale_open_run_abandoned. Never marks anything successful.';

-- ---------------------------------------------------------------------------
-- 3. Whether a tick fires
-- ---------------------------------------------------------------------------

create or replace function public.scheduled_publication_tick_decision(
  p_edition_date date,
  p_at timestamptz default now(),
  p_force boolean default false
)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when not p_force and not public.scheduled_publication_due(p_at) then 'not_due'
    when not p_force and public.scheduled_edition_receipted(p_edition_date) then 'already_published'
    when exists (
      select 1 from public.scheduled_publication_runs r
      where r.edition_date = p_edition_date
        and r.finished_at is null
        and r.started_at >= p_at - interval '10 minutes'
    ) then 'attempt_in_flight'
    when not p_force and exists (
      select 1 from public.scheduled_publication_runs r
      where r.edition_date = p_edition_date
        and r.started_at > p_at - interval '10 minutes'
    ) then 'recent_attempt'
    else 'fire'
  end;
$function$;

comment on function public.scheduled_publication_tick_decision(date, timestamptz, boolean) is
  'fire | not_due | already_published | attempt_in_flight | recent_attempt. Pure decision used by run_scheduled_publication_tick; force skips the window, receipt and spacing checks but never fires over a run that is still in flight.';

-- Same signature and same firing mechanics as 20260901091000.
create or replace function public.run_scheduled_publication_tick(p_force boolean default false)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_default_url constant text :=
    'https://kukyotcgbnchsoeriqoz.supabase.co/functions/v1/personews-scheduled-publisher';
  v_date date := public.scheduled_publication_edition_date();
  v_paris text := to_char(now() at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI');
  v_decision text;
  v_abandoned integer := 0;
  v_token text;
  v_url text;
  v_request_id bigint;
begin
  if not (p_force or public.scheduled_publication_due()) then
    return jsonb_build_object(
      'fired', false, 'reason', 'not_due',
      'edition_date', v_date, 'paris_local_time', v_paris);
  end if;

  if not pg_try_advisory_lock(hashtext('personews_scheduled_publication')) then
    return jsonb_build_object('fired', false, 'reason', 'another_tick_holds_the_lock', 'edition_date', v_date);
  end if;

  -- A run left open by a terminated publisher must not block the evening.
  v_abandoned := public.abandon_stale_publication_runs(v_date);
  v_decision := public.scheduled_publication_tick_decision(v_date, now(), p_force);

  if v_decision <> 'fire' then
    perform pg_advisory_unlock(hashtext('personews_scheduled_publication'));
    return jsonb_build_object(
      'fired', false, 'reason', v_decision,
      'edition_date', v_date, 'paris_local_time', v_paris,
      'stale_runs_abandoned', v_abandoned);
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'personews_scheduled_publisher_token'
  limit 1;

  if v_token is null then
    perform pg_advisory_unlock(hashtext('personews_scheduled_publication'));
    raise exception 'vault secret personews_scheduled_publisher_token is missing';
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'personews_scheduled_publisher_url'
  limit 1;

  select net.http_post(
    url := coalesce(v_url, c_default_url),
    body := jsonb_build_object(
      'token', v_token,
      'action', 'run',
      'date', to_char(v_date, 'YYYY-MM-DD'),
      'trigger', case when p_force then 'forced' else 'cron' end),
    headers := jsonb_build_object('content-type', 'application/json'),
    timeout_milliseconds := 120000
  ) into v_request_id;

  perform pg_advisory_unlock(hashtext('personews_scheduled_publication'));

  return jsonb_build_object(
    'fired', true,
    'edition_date', v_date,
    'edition_kind', public.resolve_staging_edition_kind(v_date),
    'paris_local_time', v_paris,
    'stale_runs_abandoned', v_abandoned,
    'net_request_id', v_request_id);
end;
$function$;

comment on function public.run_scheduled_publication_tick(boolean) is
  'Cron entry point, every 15 minutes from 19:00 to 21:00 Europe/Paris on a publication day. Fires the scheduled publisher unless the edition is receipted, an attempt is in flight or one ran in the last 10 minutes. run_scheduled_publication_tick(true) is the operator recovery: same gate, same stages, same receipt.';

-- ---------------------------------------------------------------------------
-- 4. Monitoring: one edition date, not "the latest published"
-- ---------------------------------------------------------------------------

create or replace function public.scheduled_edition_publication_health(
  p_edition_date date default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_date date := coalesce(p_edition_date, (p_at at time zone 'Europe/Paris')::date);
  v_kind text := public.resolve_staging_edition_kind(v_date);
  v_deadline timestamptz := (v_date::text || ' 21:15')::timestamp at time zone 'Europe/Paris';
  v_receipt jsonb;
  v_status text;
  v_stale jsonb;
  v_last jsonb;
  v_attempts integer;
begin
  select jsonb_build_object(
    'batch_id', r.batch_id, 'production_run_id', r.production_run_id, 'published_at', r.published_at)
  into v_receipt
  from public.publication_receipts r
  join public.automation_batches b on b.id = r.batch_id
  where b.edition_date = v_date
  order by r.published_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'run_id', r.run_id, 'started_at', r.started_at, 'open_minutes',
    round(extract(epoch from (p_at - r.started_at)) / 60)) order by r.started_at), '[]'::jsonb)
  into v_stale
  from public.scheduled_publication_runs r
  where r.edition_date = v_date
    and r.finished_at is null
    and r.started_at < p_at - interval '10 minutes';

  select count(*) into v_attempts
  from public.scheduled_publication_runs r where r.edition_date = v_date;

  select jsonb_build_object(
    'started_at', r.started_at, 'finished_at', r.finished_at, 'reason', r.reason,
    'approved_jobs', r.approved_jobs, 'expected_jobs', r.expected_jobs,
    'blockers', r.blockers, 'error', r.error)
  into v_last
  from public.scheduled_publication_runs r
  where r.edition_date = v_date
  order by r.started_at desc
  limit 1;

  v_status := case
    when v_kind is null then 'not_publication_day'
    when v_receipt is not null then 'published'
    when p_at < v_deadline then 'pending'
    else 'missed'
  end;

  return jsonb_build_object(
    'edition_date', v_date,
    'edition_kind', v_kind,
    'status', v_status,
    -- The one bit monitoring needs: false means page someone.
    'ok', v_status in ('not_publication_day', 'published', 'pending') and jsonb_array_length(v_stale) = 0,
    'deadline_paris', to_char(v_date, 'YYYY-MM-DD') || ' 21:15',
    'receipt', v_receipt,
    'attempts', v_attempts,
    'last_attempt', v_last,
    'stale_open_runs', v_stale);
end;
$function$;

comment on function public.scheduled_edition_publication_health(date, timestamptz) is
  'Did this Paris edition date publish? status: not_publication_day | published | pending (before 21:15 Paris) | missed. ok=false when missed or when a run has been open more than 10 minutes. Defaults to today in Europe/Paris, never to the latest published edition.';

create or replace function public.edition_publication_timeline(p_edition_date date)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'health', public.scheduled_edition_publication_health(p_edition_date),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch_id', b.id, 'edition_kind', b.edition_kind, 'status', b.status,
        'approved_jobs', b.approved_jobs, 'expected_jobs', b.expected_jobs,
        'created_at', b.created_at) order by b.created_at)
      from public.automation_batches b where b.edition_date = p_edition_date), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'run_id', r.run_id,
        'trigger', r.trigger_source,
        'started_at', r.started_at,
        'finished_at', r.finished_at,
        'open', r.finished_at is null,
        'reason', r.reason,
        'gate_passed', r.gate_passed,
        'approved_jobs', r.approved_jobs,
        'expected_jobs', r.expected_jobs,
        'blocker_count', jsonb_array_length(r.blockers),
        'blockers', r.blockers,
        'publication_attempted', r.publication_attempted,
        'publication_succeeded', r.publication_succeeded,
        'production_verified', r.production_verified,
        'receipt_recorded', r.receipt_recorded,
        'already_published', r.already_published,
        'notification_release', r.verification_result->'notification_release',
        'error', r.error) order by r.started_at)
      from public.scheduled_publication_runs r where r.edition_date = p_edition_date), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch_id', r.batch_id, 'production_run_id', r.production_run_id, 'published_at', r.published_at))
      from public.publication_receipts r
      join public.automation_batches b on b.id = r.batch_id
      where b.edition_date = p_edition_date), '[]'::jsonb));
$function$;

comment on function public.edition_publication_timeline(date) is
  'Everything about one edition date in one call: health, batches, every attempt (gate verdict, blockers, publish, verification, notification release, receipt, errors), receipts.';

-- The operator one-liner keeps working, and knows about the window.
create or replace function public.next_scheduled_publication_date(p_from timestamptz default now())
returns date
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_today date := (p_from at time zone 'Europe/Paris')::date;
  v_time time := (p_from at time zone 'Europe/Paris')::time;
  v_start date;
  v_candidate date;
begin
  -- Today still counts until its window closes at 21:00 Paris, unless it has
  -- already published.
  v_start := case
    when v_time <= time '21:00' and not public.scheduled_edition_receipted(v_today) then v_today
    else v_today + 1
  end;

  for i in 0..7 loop
    v_candidate := v_start + i;
    if public.resolve_staging_edition_kind(v_candidate) is not null then
      return v_candidate;
    end if;
  end loop;

  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------------

do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.scheduled_publication_window()',
    'public.scheduled_edition_receipted(date)',
    'public.abandon_stale_publication_runs(date, timestamptz)',
    'public.scheduled_publication_tick_decision(date, timestamptz, boolean)',
    'public.scheduled_edition_publication_health(date, timestamptz)',
    'public.edition_publication_timeline(date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role, postgres', v_signature);
  end loop;
end;
$grants$;

-- ---------------------------------------------------------------------------
-- 6. The schedule
-- ---------------------------------------------------------------------------
-- Every 15 minutes across 17:00–20:45 UTC. 19:00–21:00 Paris is 17:00–19:00 UTC
-- in summer and 18:00–20:00 UTC in winter; the guard picks the right ticks.

select cron.unschedule(jobid)
from cron.job
where jobname = 'personews-scheduled-publication';

select cron.schedule(
  'personews-scheduled-publication',
  '0,15,30,45 17-20 * * *',
  $cron$select public.run_scheduled_publication_tick();$cron$
);

update public.automation_config
set value = value || jsonb_build_object(
      'publication_window', public.scheduled_publication_window()),
    updated_at = now()
where key = 'pipeline';

commit;
