-- Scheduled publication cron — STAGING project (kukyotcgbnchsoeriqoz).
--
-- pg_cron speaks UTC and nothing else. PersoNews publishes at 19:00 Europe/Paris,
-- which is 17:00 UTC for most of the year and 18:00 UTC from late October to late
-- March. Hardcoding either one is a bug with a delivery date.
--
-- So the schedule is deliberately dumb and the guard is deliberately smart: the
-- job ticks at 17:00 and 18:00 UTC every day, and `scheduled_publication_due()`
-- — which asks Postgres what time it is in Europe/Paris, and therefore knows
-- about CET and CEST — lets exactly one of those ticks through, on exactly the
-- four publication days. No table of DST dates, nothing to maintain, no manual
-- clock change twice a year.
--
-- The tick itself does not publish. It calls the Edge Function that does, which
-- is where the cross-project hop and the hard gate live. This file is the alarm
-- clock, nothing more.

begin;

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- The tick
-- ---------------------------------------------------------------------------

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
  v_token text;
  v_url text;
  v_request_id bigint;
begin
  if not (p_force or public.scheduled_publication_due()) then
    return jsonb_build_object(
      'fired', false, 'reason', 'not_due',
      'edition_date', v_date, 'paris_local_time', v_paris);
  end if;

  -- Two processes must never publish the same evening. Session-level lock,
  -- released when the cron worker's session ends.
  if not pg_try_advisory_lock(hashtext('personews_scheduled_publication')) then
    return jsonb_build_object('fired', false, 'reason', 'another_tick_holds_the_lock', 'edition_date', v_date);
  end if;

  -- A tick that fires twice within the half hour is a scheduler hiccup, not a
  -- second edition. Retries after a genuine failure remain possible with
  -- p_force, and the Edge Function is idempotent regardless.
  if exists (
    select 1 from public.scheduled_publication_runs
    where edition_date = v_date and started_at > now() - interval '30 minutes'
  ) and not p_force then
    perform pg_advisory_unlock(hashtext('personews_scheduled_publication'));
    return jsonb_build_object(
      'fired', false, 'reason', 'attempt_already_made_within_30_minutes',
      'edition_date', v_date);
  end if;

  -- Credentials live in Vault, never in this file, never in a public table.
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
      'trigger', 'cron'),
    headers := jsonb_build_object('content-type', 'application/json'),
    timeout_milliseconds := 120000
  ) into v_request_id;

  perform pg_advisory_unlock(hashtext('personews_scheduled_publication'));

  return jsonb_build_object(
    'fired', true,
    'edition_date', v_date,
    'edition_kind', public.resolve_staging_edition_kind(v_date),
    'paris_local_time', v_paris,
    'net_request_id', v_request_id);
end;
$function$;

comment on function public.run_scheduled_publication_tick(boolean) is
  'Cron entry point. Fires the scheduled publisher Edge Function only at 19:00 Europe/Paris on a publication day.';

revoke all on function public.run_scheduled_publication_tick(boolean) from public, anon, authenticated;
grant execute on function public.run_scheduled_publication_tick(boolean) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- A note on pg_net privileges
-- ---------------------------------------------------------------------------
-- pg_net was installed by `supabase_admin` with EXECUTE granted to PUBLIC, so
-- any role in this project — including `anon` — can call `net.http_post`. That
-- lets a caller make the database issue an outbound HTTP request; it does NOT
-- let them read the reply, because the `net` schema grants no table privileges
-- to `anon` or `authenticated`, so `net.http_request_queue` and
-- `net._http_response` (where the scheduler's token transits) stay unreadable.
--
-- Tightening it is not possible from here: only the grantor, `supabase_admin`,
-- can revoke a grant it made, and `postgres` is not a member of that role. A
-- REVOKE written here would be a silent no-op pretending to be a control, which
-- is worse than this comment. If the exposure matters, it has to be revoked by
-- Supabase support or from an owner-level session.
--
-- It does not weaken the publisher: the Edge Function authenticates every caller
-- against a token hash regardless of who managed to send the request.

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------
-- Every day, both candidate hours. The day-of-week filter lives in
-- `resolve_staging_edition_kind` (via `scheduled_publication_due`) rather than in
-- the cron expression, so the calendar has exactly one definition in this system
-- instead of two that can drift apart.

select cron.unschedule(jobid)
from cron.job
where jobname = 'personews-scheduled-publication';

select cron.schedule(
  'personews-scheduled-publication',
  '0 17,18 * * *',
  $cron$select public.run_scheduled_publication_tick();$cron$
);

commit;
