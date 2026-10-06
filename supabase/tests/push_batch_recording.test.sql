-- Batch recording of push attempts — PRODUCTION project.
--
-- Proves 20261005170000_push_batch_recording: one call records a whole Expo
-- chunk with exactly the per-row rules of record_push_delivery_attempt, and can
-- write nothing the caller does not hold under its lease.
--
-- One transaction ending in ROLLBACK. Nothing reaches Expo: rows are leased by
-- the real claim (claim_due_push_notifications, with an injected clock) and the
-- outcomes are recorded by hand, as the Edge worker would.
--
-- Run locally (the push migrations are in the unapplied tail):
--   node scripts/local-sql-tests.mjs push-batch --with-migrations
--
-- The final SELECT is the report: `failed` must be 0.

begin;

-- The fixture publishes its own drop by hand (rolled back); see
-- published_edition_immutability.test.sql for the guard itself.
select set_config('personews.allow_edition_rewrite', 'on', true);

create temp table pb_results (seq int, test text, expectation text, observed text, pass boolean);

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into pb_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

-- Fixture clock: edition day D, its 19:00 Paris slot at 17:00Z.
create or replace function pg_temp.d() returns date language sql immutable as $$ select date '2031-05-05' $$;
create or replace function pg_temp.t(p_minutes int) returns timestamptz language sql immutable as $$
  select timestamptz '2031-05-05 17:00:00+00' + make_interval(mins => p_minutes)
$$;
create or replace function pg_temp.reader() returns uuid language sql immutable as $$
  select 'cb000000-0000-4000-8000-000000000001'::uuid
$$;

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000',pg_temp.reader(),'authenticated','authenticated','pb@example.test','x',
  now(),now(),now(),'','','','','{}','{}');
insert into public.profiles(id,email,language,timezone) values (pg_temp.reader(),'pb@example.test','fr','Europe/Paris');
insert into public.user_preferences(user_id,newsletter_enabled,business_stories_enabled,mini_cases_enabled,
  newsletter_article_count,learning_path_choice_completed,notifications_enabled)
values (pg_temp.reader(), true, true, true, 3, true, true);

-- 150 devices, one edition_ready delivery each, due at 17:00Z.
insert into public.push_tokens(id, user_id, expo_push_token, platform)
select ('cb100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, pg_temp.reader(),
       'ExponentPushToken[pb-' || n || ']', 'ios'
from generate_series(1, 150) n;

insert into public.daily_drops(user_id, drop_date, language, status, generated_at, published_at)
values (pg_temp.reader(), pg_temp.d(), 'fr', 'published', now(), now());

-- Released: the outbox row the drop enqueued, verified at 16:50Z.
update public.notification_outbox
set status = 'processed', verified_at = pg_temp.t(-10), processed_at = pg_temp.t(-10)
where event_type = 'edition_published' and event_date = pg_temp.d();

insert into public.push_notification_deliveries(
  push_token_id, user_id, drop_date, notification_kind, status, target_at, scheduled_for, reader_timezone, edition_ready_at)
select ('cb100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, pg_temp.reader(), pg_temp.d(), 'edition_ready',
       'pending', pg_temp.t(0), pg_temp.t(0), 'Europe/Paris', pg_temp.t(-10)
from generate_series(1, 150) n
on conflict on constraint push_notification_deliveries_identity_unique do nothing;

create temp table pb_claims (claim text, delivery_id uuid, attempt int);

create or replace function pg_temp.claim(p_claim text, p_limit int, p_minutes int) returns int
language plpgsql as $$
declare v int;
begin
  insert into pb_claims
  select p_claim, c.claimed_delivery_id, c.claimed_attempt_number
  from public.claim_due_push_notifications(p_claim, p_limit, 600, pg_temp.t(p_minutes)) c;
  get diagnostics v = row_count;
  return v;
end $$;

-- Results for a claim's rows, outcome chosen by row number within the claim.
create or replace function pg_temp.results(p_claim text, p_outcome_of text) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'delivery_id', c.delivery_id,
           'outcome', o.outcome,
           'expo_ticket_id', case when o.outcome = 'ticket_accepted' then 'ticket-' || c.delivery_id end,
           'error', case when o.outcome = 'ticket_accepted' then null else 'Expo said no (suite)' end)
         order by c.delivery_id), '[]'::jsonb)
  from (select delivery_id, row_number() over (order by delivery_id) as rn from pb_claims where claim = p_claim) c
  cross join lateral (
    select case p_outcome_of
      when 'mixed' then case
        when c.rn <= 70 then 'ticket_accepted'
        when c.rn <= 90 then 'retryable'
        when c.rn <= 95 then 'permanent'
        else 'token_invalid' end
      else p_outcome_of end as outcome
  ) o;
$$;

create temp table pb_recorded (call text, delivery_id uuid, status text, next_at timestamptz);

create or replace function pg_temp.record_batch(p_call text, p_claim text, p_results jsonb) returns int
language plpgsql as $$
declare v int;
begin
  insert into pb_recorded
  select p_call, r.recorded_delivery_id, r.recorded_status, r.recorded_next_attempt_at
  from public.record_push_delivery_attempts(p_claim, p_results) r;
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function pg_temp.statuses(p_call text) returns text language sql as $$
  select coalesce(string_agg(status || '=' || n, ',' order by status), 'none')
  from (select status, count(*) n from pb_recorded where call = p_call group by status) s;
$$;

create or replace function pg_temp.table_state(p_claim text) returns text language sql as $$
  select string_agg(d.status || '/' || d.attempt_count, ',' order by d.id)
  from public.push_notification_deliveries d
  where d.id in (select delivery_id from pb_claims where claim = p_claim);
$$;

-- ---------------------------------------------------------------------------
-- D. Leases: two workers never hold the same delivery
-- ---------------------------------------------------------------------------

select pg_temp.record(1, 'D1 worker A leases 100', '100', pg_temp.claim('w-a', 100, 5)::text);
select pg_temp.record(2, 'D2 worker B, at the same moment, gets only the other 50', '50', pg_temp.claim('w-b', 100, 5)::text);
select pg_temp.record(3, 'D3 no delivery is held by both', '0',
  (select count(*) from pb_claims a join pb_claims b on a.delivery_id = b.delivery_id
   where a.claim = 'w-a' and b.claim = 'w-b')::text);

-- ---------------------------------------------------------------------------
-- A / B. One call records a 100-result chunk, mixed outcomes, per-row rules
-- ---------------------------------------------------------------------------

select pg_temp.record(10, 'A1 one call returns one status per result: 100', '100',
  pg_temp.record_batch('a-1', 'w-a', pg_temp.results('w-a', 'mixed'))::text);

select pg_temp.record(11, 'B1 accepted -> awaiting_receipt, retryable -> retryable_failure, permanent and dead tokens -> terminal',
  'awaiting_receipt=70,retryable_failure=20,terminal_failure=10', pg_temp.statuses('a-1'));

select pg_temp.record(12, 'B2 the ticket id is kept on accepted rows, errors on the others', '70|30',
  (select count(*) filter (where expo_ticket_id = 'ticket-' || id) || '|' || count(*) filter (where error = 'Expo said no (suite)')
   from public.push_notification_deliveries where id in (select delivery_id from pb_claims where claim = 'w-a')));

select pg_temp.record(13, 'B3 the five dead devices are disabled, no other', '5',
  (select count(*) from public.push_tokens where user_id = pg_temp.reader() and not enabled)::text);

select pg_temp.record(14, 'B4 the attempt is counted once (the lease counted it), not twice', '1',
  (select string_agg(distinct attempt_count::text, ',') from public.push_notification_deliveries
   where id in (select delivery_id from pb_claims where claim = 'w-a')));

-- ---------------------------------------------------------------------------
-- C. Recording the same chunk again changes nothing
-- ---------------------------------------------------------------------------

create temp table pb_before as select pg_temp.table_state('w-a') as s;

select pg_temp.record_batch('a-2', 'w-a', pg_temp.results('w-a', 'mixed'));
select pg_temp.record(20, 'C1 a replayed chunk is reported stale, row by row', 'stale_claim=100',
  pg_temp.statuses('a-2'));

select pg_temp.record(21, 'C2 and writes nothing', 'true',
  ((select s from pb_before) = pg_temp.table_state('w-a'))::text);

-- ---------------------------------------------------------------------------
-- G. Retry timing is the single-row function's, to the second
-- ---------------------------------------------------------------------------
-- Worker B's 50 rows fail retryably: 25 recorded one by one, 25 in one batch.

do $$
declare v_id uuid;
begin
  for v_id in select delivery_id from pb_claims where claim = 'w-b' order by delivery_id limit 25 loop
    perform public.record_push_delivery_attempt(v_id, 'w-b', 'retryable', null, 'Expo 503 (suite)');
  end loop;
end $$;

select pg_temp.record_batch('b-1', 'w-b', (
  select jsonb_agg(jsonb_build_object('delivery_id', delivery_id, 'outcome', 'retryable', 'error', 'Expo 503 (suite)'))
  from (select delivery_id from pb_claims where claim = 'w-b' order by delivery_id offset 25) x));

select pg_temp.record(30, 'G1 single and batch give every row the same status and next slot (+15 min)',
  'retryable_failure|' || to_char(pg_temp.t(15) at time zone 'UTC', 'HH24:MI') || '|1',
  (select string_agg(distinct status || '|' || to_char(next_attempt_at at time zone 'UTC', 'HH24:MI'), ';') || '|' ||
          count(distinct (status, next_attempt_at))
   from public.push_notification_deliveries
   where id in (select delivery_id from pb_claims where claim = 'w-b')));

-- ---------------------------------------------------------------------------
-- F. The attempt cap
-- ---------------------------------------------------------------------------
-- The 20 retryable rows of worker A: retried at +15 and +30, failing each time.

select pg_temp.record(40, 'F1 the retries come due at +15: attempt 2 (worker B''s 50 included)', '70',
  pg_temp.claim('w-f2', 200, 16)::text);
select pg_temp.record_batch('f-2', 'w-f2', pg_temp.results('w-f2', 'retryable'));
select pg_temp.record(41, 'F2 at +30, attempt 3', '70', pg_temp.claim('w-f3', 200, 31)::text);
select pg_temp.record_batch('f-3', 'w-f3', pg_temp.results('w-f3', 'retryable'));

select pg_temp.record(42, 'F3 a third failure is terminal with no slot, the cap stated', 'terminal_failure=70',
  pg_temp.statuses('f-3'));
select pg_temp.record(43, 'F4 nothing is leased a fourth time', '0', pg_temp.claim('w-f4', 200, 46)::text);
select pg_temp.record(44, 'F5 the reason is written down', '70',
  (select count(*) from public.push_notification_deliveries
   where id in (select delivery_id from pb_claims where claim = 'w-f3') and error like '%gave up after 3 attempts%')::text);

-- ---------------------------------------------------------------------------
-- E. An expired lease is recovered; its first holder cannot write any more
-- ---------------------------------------------------------------------------

insert into public.push_tokens(id, user_id, expo_push_token, platform)
values ('cb200000-0000-4000-8000-000000000001', pg_temp.reader(), 'ExponentPushToken[pb-late]', 'android');
insert into public.push_notification_deliveries(
  push_token_id, user_id, drop_date, notification_kind, status, target_at, scheduled_for, reader_timezone, edition_ready_at)
values ('cb200000-0000-4000-8000-000000000001', pg_temp.reader(), pg_temp.d(), 'edition_ready',
        'pending', pg_temp.t(60), pg_temp.t(60), 'Europe/Paris', pg_temp.t(-10));

select pg_temp.record(50, 'E1 worker X leases it, then dies', '1', pg_temp.claim('w-x', 10, 61)::text);
-- Not at minute 71, when the lease ends: the lease already scheduled the row's
-- next slot (+15 from its scheduled time), and that is when it is owed again.
select pg_temp.record(51, 'E2 the lease has expired and the next slot (+15) has come: worker Y takes it over', '1',
  pg_temp.claim('w-y', 10, 76)::text);
select pg_temp.record_batch('x-late', 'w-x', pg_temp.results('w-x', 'ticket_accepted'));
select pg_temp.record(52, 'E3 the dead worker''s late record is refused', 'stale_claim=1', pg_temp.statuses('x-late'));
select pg_temp.record_batch('y-1', 'w-y', pg_temp.results('w-y', 'ticket_accepted'));
select pg_temp.record(53, 'E4 the current holder records it', 'awaiting_receipt=1', pg_temp.statuses('y-1'));

-- ---------------------------------------------------------------------------
-- H. A malformed or foreign record writes nothing
-- ---------------------------------------------------------------------------

insert into public.push_tokens(id, user_id, expo_push_token, platform)
select ('cb300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, pg_temp.reader(), 'ExponentPushToken[pb-h' || n || ']', 'ios'
from generate_series(1, 2) n;
insert into public.push_notification_deliveries(
  push_token_id, user_id, drop_date, notification_kind, status, target_at, scheduled_for, reader_timezone, edition_ready_at)
select ('cb300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, pg_temp.reader(), pg_temp.d(), 'edition_ready',
       'pending', pg_temp.t(90), pg_temp.t(90), 'Europe/Paris', pg_temp.t(-10)
from generate_series(1, 2) n;

select pg_temp.claim('w-h', 1, 91);   -- one of the two
select pg_temp.claim('w-other', 1, 91); -- the other, held by someone else

create temp table pb_foreign_before as select pg_temp.table_state('w-other') as s;

select pg_temp.record_batch('h-1', 'w-h', jsonb_build_array(
  jsonb_build_object('delivery_id', (select delivery_id from pb_claims where claim = 'w-other'), 'outcome', 'permanent'),
  jsonb_build_object('delivery_id', 'not-a-uuid', 'outcome', 'permanent'),
  jsonb_build_object('delivery_id', (select delivery_id from pb_claims where claim = 'w-h'), 'outcome', 'delete_everything'),
  '"just a string"'::jsonb,
  jsonb_build_object('delivery_id', (select delivery_id from pb_claims where claim = 'w-h'), 'outcome', 'ticket_accepted', 'expo_ticket_id', 't-h'),
  jsonb_build_object('delivery_id', (select delivery_id from pb_claims where claim = 'w-h'), 'outcome', 'permanent')
));

select pg_temp.record(60, 'H1 each bad record is named, the one good record is written',
  'stale_claim,invalid_record,invalid_record,invalid_record,awaiting_receipt,duplicate_in_batch',
  (select string_agg(status, ',' order by ctid) from pb_recorded where call = 'h-1'));

select pg_temp.record(61, 'H2 another worker''s delivery is untouched', 'true',
  ((select s from pb_foreign_before) = pg_temp.table_state('w-other'))::text);

select pg_temp.record(62, 'H3 the first record for a delivery wins; the duplicate does not overwrite it', 'awaiting_receipt|t-h',
  (select status || '|' || expo_ticket_id from public.push_notification_deliveries
   where id = (select delivery_id from pb_claims where claim = 'w-h')));

do $$
declare v_state text;
begin
  for v_state in
    select x from unnest(array['no-claim', 'not-array', 'too-many']) x
  loop
    begin
      if v_state = 'no-claim' then
        perform public.record_push_delivery_attempts('', '[]'::jsonb);
      elsif v_state = 'not-array' then
        perform public.record_push_delivery_attempts('w-h', '{"delivery_id": "x"}'::jsonb);
      else
        perform public.record_push_delivery_attempts('w-h',
          (select jsonb_agg(jsonb_build_object('delivery_id', gen_random_uuid(), 'outcome', 'permanent')) from generate_series(1, 1001)));
      end if;
      perform pg_temp.record(63, 'H4 a malformed call raises: ' || v_state, '22023', 'no error');
    exception when others then
      perform pg_temp.record(63, 'H4 a malformed call raises: ' || v_state, '22023', sqlstate);
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- I. A whole failed Expo request, recorded as one chunk
-- ---------------------------------------------------------------------------
-- (Covered row by row above; here the shape the worker sends for a 400.)

select pg_temp.record(70, 'I1 an empty chunk records nothing and does not raise', '0',
  (select count(*) from public.record_push_delivery_attempts('w-h', '[]'::jsonb))::text);

-- ---------------------------------------------------------------------------
-- J. The single-row function is kept, deliberately, and both are service-only
-- ---------------------------------------------------------------------------

select pg_temp.record(80, 'J1 single-row record_push_delivery_attempt still exists (deployed worker, fallback)', 'true',
  (to_regprocedure('public.record_push_delivery_attempt(uuid,text,text,text,text)') is not null)::text);

select pg_temp.record(81, 'J2 only the service role may record', 'false|false|true',
  has_function_privilege('anon', 'public.record_push_delivery_attempts(text,jsonb)', 'execute')::text || '|' ||
  has_function_privilege('authenticated', 'public.record_push_delivery_attempts(text,jsonb)', 'execute')::text || '|' ||
  has_function_privilege('service_role', 'public.record_push_delivery_attempts(text,jsonb)', 'execute')::text);

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from pb_results) as checks,
  (select count(*) from pb_results where pass) as passed,
  (select count(*) from pb_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from pb_results where not pass) as failures;

rollback;
