-- Publication catch-up, stale runs and per-edition health — STAGING project.
--
-- Proves 20261005140000_publication_catch_up:
--   - the 19:00–21:00 Europe/Paris window, through CET, CEST and both DST days;
--   - a tick fires when the edition is due and not receipted, and only then;
--   - a not-ready 19:00 attempt is followed by a 19:15 catch-up;
--   - a receipt makes every later tick a no-op;
--   - an attempt in flight blocks a second one, even a forced one;
--   - a run open for more than 10 minutes is reported and abandoned, never
--     marked successful, and the next tick retries the same batch;
--   - health asks about one Paris edition date: pending, published, missed,
--     not_publication_day.
--
-- The migration is inlined by the runner inside this transaction, which ends
-- in ROLLBACK. Nothing is applied and no request is sent: the tick's firing
-- decision is a pure function and is what is asserted here.
--
-- Run locally:
--   node scripts/local-sql-tests.mjs staging-catch-up
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table cu_results (seq int, test text, expectation text, observed text, pass boolean);

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into cu_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

-- 2030-07-01 is a Sunday (weekly digest), 2030-07-02 a Tuesday (quiet).
-- July is CEST: 19:00 Paris = 17:00 UTC.
create or replace function pg_temp.d() returns date language sql immutable as $$ select date '2030-07-01' $$;
create or replace function pg_temp.at(p_paris text) returns timestamptz language sql immutable as $$
  select ('2030-07-01 ' || p_paris)::timestamp at time zone 'Europe/Paris'
$$;

create or replace function pg_temp.run(p_started text, p_finished text, p_reason text, p_succeeded boolean default false)
returns void language sql as $$
  insert into public.scheduled_publication_runs (run_id, edition_date, started_at, finished_at, reason, publication_succeeded)
  values ('cu-' || p_started, pg_temp.d(), pg_temp.at(p_started),
          case when p_finished is null then null else pg_temp.at(p_finished) end, p_reason, p_succeeded);
$$;

-- This suite owns the runs, batches and receipts for its own dates.
delete from public.publication_receipts r using public.automation_batches b
  where b.id = r.batch_id and b.edition_date in (date '2030-07-01', date '2030-07-02');
delete from public.automation_batches where edition_date in (date '2030-07-01', date '2030-07-02');
delete from public.scheduled_publication_runs where edition_date in (date '2030-07-01', date '2030-07-02');

-- ---------------------------------------------------------------------------
-- H. The window, through CET, CEST and both DST changeovers
-- ---------------------------------------------------------------------------

select pg_temp.record(1, 'H1 summer (CEST): 18:59 no, 19:00 yes, 21:00 yes, 21:01 no', 'false|true|true|false',
  concat_ws('|',
    public.scheduled_publication_due(timestamptz '2026-07-06 16:59:00+00')::text,
    public.scheduled_publication_due(timestamptz '2026-07-06 17:00:00+00')::text,
    public.scheduled_publication_due(timestamptz '2026-07-06 19:00:00+00')::text,
    public.scheduled_publication_due(timestamptz '2026-07-06 19:01:00+00')::text));

select pg_temp.record(2, 'H2 winter (CET): 18:59 no, 19:00 yes, 21:00 yes, 21:15 no', 'false|true|true|false',
  concat_ws('|',
    public.scheduled_publication_due(timestamptz '2026-01-05 17:59:00+00')::text,
    public.scheduled_publication_due(timestamptz '2026-01-05 18:00:00+00')::text,
    public.scheduled_publication_due(timestamptz '2026-01-05 20:00:00+00')::text,
    public.scheduled_publication_due(timestamptz '2026-01-05 20:15:00+00')::text));

-- Sun 2026-03-29: clocks go forward at 02:00. Sun 2026-10-25: back at 03:00.
select pg_temp.record(3, 'H3 the spring-forward Sunday is due from 19:00 CEST (17:00 UTC)', 'false|true',
  concat_ws('|',
    public.scheduled_publication_due(timestamptz '2026-03-29 16:45:00+00')::text,
    public.scheduled_publication_due(timestamptz '2026-03-29 17:00:00+00')::text));

select pg_temp.record(4, 'H4 the fall-back Sunday is due from 19:00 CET (18:00 UTC)', 'false|true',
  concat_ws('|',
    public.scheduled_publication_due(timestamptz '2026-10-25 17:45:00+00')::text,
    public.scheduled_publication_due(timestamptz '2026-10-25 18:00:00+00')::text));

select pg_temp.record(5, 'H5 every cron slot in the window lands on a quarter hour in Paris, summer and winter',
  '9|9',
  concat_ws('|',
    (select count(*) from generate_series(timestamptz '2026-07-06 17:00+00', timestamptz '2026-07-06 20:45+00', interval '15 minutes') t
     where public.scheduled_publication_due(t)),
    (select count(*) from generate_series(timestamptz '2026-01-05 17:00+00', timestamptz '2026-01-05 20:45+00', interval '15 minutes') t
     where public.scheduled_publication_due(t))));

-- ---------------------------------------------------------------------------
-- G. A quiet day never fires and never alarms
-- ---------------------------------------------------------------------------

select pg_temp.record(10, 'G1 a Tuesday is never due', 'false',
  public.scheduled_publication_due(timestamptz '2030-07-02 17:00:00+00')::text);

select pg_temp.record(11, 'G2 a Tuesday is healthy at any hour', 'not_publication_day|true',
  (select (h->>'status') || '|' || (h->>'ok')
   from public.scheduled_edition_publication_health(date '2030-07-02', timestamptz '2030-07-02 22:00:00+00') h));

-- ---------------------------------------------------------------------------
-- A / B. 19:00, then the catch-up
-- ---------------------------------------------------------------------------

select pg_temp.record(20, 'A1 at 19:00 with nothing tried yet, the tick fires', 'fire',
  public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('19:00')));

select pg_temp.record(21, 'A2 before 19:00 it does not', 'not_due',
  public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('18:45')));

-- The 19:00 attempt found the batch not ready.
select pg_temp.run('19:00:02', '19:00:20', 'jobs_not_all_approved');

select pg_temp.record(22, 'B1 five minutes later is too soon', 'recent_attempt',
  public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('19:05')));

select pg_temp.record(23, 'B2 the 19:15 catch-up fires', 'fire',
  public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('19:15')));

select pg_temp.record(24, 'B3 and health says pending, not missed, meanwhile', 'pending|true',
  (select (h->>'status') || '|' || (h->>'ok')
   from public.scheduled_edition_publication_health(pg_temp.d(), pg_temp.at('19:15')) h));

-- ---------------------------------------------------------------------------
-- I. Two ticks cannot both publish
-- ---------------------------------------------------------------------------

-- The 19:15 attempt is running.
select pg_temp.run('19:15:01', null, null);

select pg_temp.record(30, 'I1 a second tick while one is in flight does not fire', 'attempt_in_flight',
  public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('19:15:30')));

select pg_temp.record(31, 'I2 not even a forced one', 'attempt_in_flight',
  public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('19:15:30'), true));

-- ---------------------------------------------------------------------------
-- E. A run the publisher never closed
-- ---------------------------------------------------------------------------

select pg_temp.record(40, 'E1 after 10 minutes open, health reports it and stops being ok', '1|false',
  (select jsonb_array_length(h->'stale_open_runs') || '|' || (h->>'ok')
   from public.scheduled_edition_publication_health(pg_temp.d(), pg_temp.at('19:30')) h));

select pg_temp.record(41, 'E2 the next tick abandons it', '1',
  public.abandon_stale_publication_runs(pg_temp.d(), pg_temp.at('19:30'))::text);

select pg_temp.record(42, 'E3 as abandoned, never as successful', 'stale_open_run_abandoned|false',
  (select r.reason || '|' || r.publication_succeeded from public.scheduled_publication_runs r
   where r.run_id = 'cu-19:15:01'));

select pg_temp.record(43, 'E4 and then fires again for the same edition', 'fire',
  public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('19:30')));

-- ---------------------------------------------------------------------------
-- D. Production committed, the caller timed out, no receipt: retried
-- ---------------------------------------------------------------------------

select pg_temp.run('19:30:01', '19:31:40', 'production_publish_timeout');

select pg_temp.record(50, 'D1 a timed-out publish leaves the edition unreceipted, so the 19:45 tick retries', 'fire',
  public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('19:45')));

-- ---------------------------------------------------------------------------
-- F. Missed, published
-- ---------------------------------------------------------------------------

select pg_temp.record(60, 'F1 no receipt after 21:15 Paris is a missed edition', 'missed|false',
  (select (h->>'status') || '|' || (h->>'ok')
   from public.scheduled_edition_publication_health(pg_temp.d(), pg_temp.at('21:20')) h));

select pg_temp.record(61, 'F2 after 21:00 the tick no longer fires on its own', 'not_due',
  public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('21:15')));

select pg_temp.record(62, 'F3 but the operator recovery still can', 'fire',
  public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('21:30'), true));

-- The 19:45 retry published and wrote its receipt.
insert into public.automation_batches (id, edition_date, edition_kind, status, prompt_bundle_version)
values ('00000000-0000-4000-8000-00000000c0de', pg_temp.d(), 'weekly_digest', 'published', 'test');
insert into public.publication_receipts (batch_id, production_project_ref, production_run_id, published_at)
values ('00000000-0000-4000-8000-00000000c0de', 'wkbviidrbmehmjbhvpeh', 'cu-retry', pg_temp.at('19:46'));
select pg_temp.run('19:45:01', '19:46:30', 'published', true);

-- ---------------------------------------------------------------------------
-- C. After the receipt, every tick is a no-op
-- ---------------------------------------------------------------------------

select pg_temp.record(70, 'C1 the 20:00, 20:15 … 21:00 ticks do nothing', 'already_published|already_published|already_published',
  concat_ws('|',
    public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('20:00')),
    public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('20:30')),
    public.scheduled_publication_tick_decision(pg_temp.d(), pg_temp.at('21:00'))));

select pg_temp.record(71, 'C2 and the edition is healthy, before and after the deadline', 'published|true|published|true',
  (select (h->>'status') || '|' || (h->>'ok')
   from public.scheduled_edition_publication_health(pg_temp.d(), pg_temp.at('20:00')) h)
  || '|' ||
  (select (h->>'status') || '|' || (h->>'ok')
   from public.scheduled_edition_publication_health(pg_temp.d(), pg_temp.at('23:00')) h));

-- ---------------------------------------------------------------------------
-- T. One call shows the whole evening
-- ---------------------------------------------------------------------------

select pg_temp.record(80, 'T1 the timeline lists every attempt in order, with reasons', '4|jobs_not_all_approved,stale_open_run_abandoned,production_publish_timeout,published',
  (select jsonb_array_length(t->'attempts') || '|' ||
     (select string_agg(a->>'reason', ',' order by (a->>'started_at')::timestamptz)
      from jsonb_array_elements(t->'attempts') a where a->>'reason' is not null)
   from public.edition_publication_timeline(pg_temp.d()) t));

select pg_temp.record(81, 'T2 and the receipt', '1',
  (select jsonb_array_length(t->'receipts')::text from public.edition_publication_timeline(pg_temp.d()) t));

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from cu_results) as checks,
  (select count(*) from cu_results where pass) as passed,
  (select count(*) from cu_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from cu_results where not pass) as failures;

rollback;
