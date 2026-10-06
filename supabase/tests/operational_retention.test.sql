-- Operational retention — PRODUCTION project.
--
-- Proves 20261005183000_operational_retention_function: the purge is a dry run
-- unless told otherwise, keeps at least 90 days, only removes finished push
-- deliveries and finished legacy job runs, and is not scheduled.
--
-- Run locally:
--   node scripts/local-sql-tests.mjs retention --with-migrations
--
-- One transaction, rolled back. The final SELECT is the report.

begin;

create temp table rt_results (seq int, test text, expectation text, observed text, pass boolean);

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into rt_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000','ac000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'rt@example.test','x',now(),now(),now(),'','','','','{}','{}');
insert into public.profiles(id,email,language,timezone) values ('ac000000-0000-4000-8000-000000000001','rt@example.test','en','Europe/Paris');
insert into public.push_tokens(id, user_id, expo_push_token, platform)
select ('ac100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'ac000000-0000-4000-8000-000000000001',
       'ExponentPushToken[rt-' || n || ']', 'ios'
from generate_series(1, 8) n;

-- Deliveries: old and recent, in every relevant state. Their age is set by
-- hand, with the updated_at stamp trigger off for that one statement (all
-- rolled back).
insert into public.push_notification_deliveries(push_token_id, user_id, drop_date, notification_kind, status, sent_at)
select ('ac100000-0000-4000-8000-' || lpad(s.n::text, 12, '0'))::uuid, 'ac000000-0000-4000-8000-000000000001',
       date '2026-01-05', 'edition_ready', s.status, case when s.status = 'sent' then now() end
from (values (1,'sent'),(2,'terminal_failure'),(3,'failed'),(4,'awaiting_receipt'),
             (5,'pending'),(6,'retryable_failure'),(7,'sent'),(8,'claimed')) s(n, status);

alter table public.push_notification_deliveries disable trigger set_push_notification_deliveries_updated_at;
update public.push_notification_deliveries
set updated_at = case when push_token_id = 'ac100000-0000-4000-8000-000000000007' then now() - interval '10 days'
                      else now() - interval '400 days' end
where user_id = 'ac000000-0000-4000-8000-000000000001';
alter table public.push_notification_deliveries enable trigger set_push_notification_deliveries_updated_at;

insert into public.job_runs(run_id, job_type, run_date, generator, source_mode, status, completed_at)
values ('rt-old-done', 'daily-job', '2025-01-01', 'llm', 'rss', 'completed', now() - interval '400 days'),
       ('rt-old-failed', 'daily-job', '2025-01-02', 'llm', 'rss', 'failed', now() - interval '400 days'),
       ('rt-old-running', 'daily-job', '2025-01-03', 'llm', 'rss', 'running', null),
       ('rt-recent', 'daily-job', '2026-10-01', 'llm', 'rss', 'completed', now() - interval '5 days');

create temp table rt_out (label text, result jsonb);

insert into rt_out values ('default', public.purge_operational_history());

select pg_temp.record(1, 'D1 a call with no arguments is a dry run and deletes nothing', 'true|8|4',
  (select (result->>'dry_run') from rt_out where label = 'default') || '|' ||
  (select count(*) from public.push_notification_deliveries where user_id = 'ac000000-0000-4000-8000-000000000001')::text || '|' ||
  (select count(*) from public.job_runs where run_id like 'rt-%')::text);

select pg_temp.record(2, 'D2 it reports what it would remove: 3 finished old deliveries, 2 finished old runs', '3|2',
  (select (result->>'push_notification_deliveries') || '|' || (result->>'job_runs') from rt_out where label = 'default'));

insert into rt_out values ('floor', public.purge_operational_history(1, true));

select pg_temp.record(3, 'D3 the window is never shorter than 90 days', '90',
  (select result->>'keep_days' from rt_out where label = 'floor'));

insert into rt_out values ('real', public.purge_operational_history(180, false));

select pg_temp.record(10, 'P1 the real run removes exactly those', '3|2',
  (select (result->>'push_notification_deliveries') || '|' || (result->>'job_runs') from rt_out where label = 'real'));

select pg_temp.record(11, 'P2 never a pending, claimed, retrying or receipt-awaiting delivery, nor a recent one',
  'awaiting_receipt,claimed,pending,retryable_failure,sent',
  (select string_agg(status, ',' order by status) from public.push_notification_deliveries
   where user_id = 'ac000000-0000-4000-8000-000000000001'));

select pg_temp.record(12, 'P3 never a running or recent job run', 'rt-old-running,rt-recent',
  (select string_agg(run_id, ',' order by run_id) from public.job_runs where run_id like 'rt-%'));

select pg_temp.record(20, 'S1 nothing schedules it', '0',
  (select count(*) from cron.job where command ilike '%purge_operational_history%')::text);

select pg_temp.record(21, 'S2 service role only', 'false|false|true',
  has_function_privilege('anon', 'public.purge_operational_history(integer,boolean)', 'execute')::text || '|' ||
  has_function_privilege('authenticated', 'public.purge_operational_history(integer,boolean)', 'execute')::text || '|' ||
  has_function_privilege('service_role', 'public.purge_operational_history(integer,boolean)', 'execute')::text);

select
  (select count(*) from rt_results) as checks,
  (select count(*) from rt_results where pass) as passed,
  (select count(*) from rt_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from rt_results where not pass) as failures;

rollback;
