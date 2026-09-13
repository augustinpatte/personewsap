-- Push timing, retries and the attempt cap — PRODUCTION project.
--
-- Proves 20260912090000_push_timing_and_retries:
--   * edition_ready at 20:00 reader-local, or when the edition is ready if later;
--   * edition_answer_reminder at 08:30 reader-local the next morning;
--   * a failed attempt is retried at +15 and +30 minutes from its scheduled
--     time, three attempts at most, then terminal;
--   * an accepted ticket is never sent again, by either worker;
--   * a worker with nothing due does nothing.
--
-- One transaction ending in ROLLBACK. Nothing reaches Expo: the claims only
-- lease rows and the outcomes are recorded by hand, as the Edge Function would.
-- Time is injected (p_now) everywhere except the Node fallback section, which
-- works relative to the transaction clock.
--
-- The fixture edition E1 is Monday 2026-09-14, published 17:00Z, verified 17:05Z
-- (12:05 Chicago). E2 is Wednesday 2026-09-16, NOT ready at 20:00 Chicago:
-- published 01:20Z and verified 01:27Z on the 17th (20:27 Chicago).
--
-- Run locally without applying the migration:
--   node scripts/local-sql-tests.mjs push-timing --with-migrations
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table ptr_results (seq int, test text, expectation text, observed text, pass boolean);

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into ptr_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

create or replace function pg_temp.utc(p_at timestamptz) returns text
language sql immutable as $$
  select coalesce(to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), 'NULL');
$$;

create or replace function pg_temp.e1() returns date language sql immutable as $$ select date '2026-09-14' $$;
create or replace function pg_temp.e2() returns date language sql immutable as $$ select date '2026-09-16' $$;

create or replace function pg_temp.c_dead() returns uuid language sql immutable as $$ select 'f1000000-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.c_fail() returns uuid language sql immutable as $$ select 'f1000000-0000-4000-8000-000000000002'::uuid $$;
create or replace function pg_temp.c_ok() returns uuid language sql immutable as $$ select 'f1000000-0000-4000-8000-000000000003'::uuid $$;
create or replace function pg_temp.c_retry() returns uuid language sql immutable as $$ select 'f1000000-0000-4000-8000-000000000004'::uuid $$;
create or replace function pg_temp.paris() returns uuid language sql immutable as $$ select 'f1000000-0000-4000-8000-000000000005'::uuid $$;
create or replace function pg_temp.tokyo() returns uuid language sql immutable as $$ select 'f1000000-0000-4000-8000-000000000006'::uuid $$;

create or replace function pg_temp.lq_a() returns uuid language sql immutable as $$ select 'f2000000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.lq_b() returns uuid language sql immutable as $$ select 'f2000000-0000-4000-8000-00000000000b'::uuid $$;

create temp table ptr_names (user_id uuid primary key, short_name text);

-- Every row a claim returned, so a case can inspect what the worker was handed.
create temp table ptr_claimed (
  claim text, user_id uuid, kind text, attempt int,
  target timestamptz, scheduled timestamptz, zone text, ready timestamptz, token text
);

-- Claim at an instant, as the Edge Function does. Answers
-- "reader:kind:attempt" sorted, or 'none'.
create or replace function pg_temp.claim(p_claim text, p_at timestamptz) returns text
language plpgsql as $$
begin
  insert into ptr_claimed
  select p_claim, claimed.claimed_user_id, claimed.claimed_kind, claimed.claimed_attempt_number,
         claimed.claimed_target_at, claimed.claimed_scheduled_for, claimed.claimed_timezone,
         claimed.claimed_edition_ready_at, claimed.claimed_expo_push_token
  from public.claim_due_push_notifications(p_claim, 200, 600, p_at) as claimed;

  return (
    select coalesce(string_agg(
             names.short_name || ':' ||
             case claimed.kind when 'edition_ready' then 'ready' else 'reminder' end || ':' ||
             claimed.attempt, ',' order by names.short_name, claimed.kind), 'none')
    from ptr_claimed as claimed
    join ptr_names as names on names.user_id = claimed.user_id
    where claimed.claim = p_claim);
end $$;

-- What the claim handed over for one reader: target|scheduled|zone|ready.
create or replace function pg_temp.handed(p_claim text, p_user uuid) returns text
language sql stable as $$
  select pg_temp.utc(claimed.target) || '|' || pg_temp.utc(claimed.scheduled) || '|' ||
         coalesce(claimed.zone, 'NULL') || '|' || pg_temp.utc(claimed.ready)
  from ptr_claimed as claimed
  where claimed.claim = p_claim and claimed.user_id = p_user;
$$;

create or replace function pg_temp.delivery_id(p_user uuid, p_kind text, p_day date) returns uuid
language sql stable as $$
  select delivery.id
  from public.push_notification_deliveries as delivery
  where delivery.user_id = p_user and delivery.notification_kind = p_kind and delivery.drop_date = p_day;
$$;

-- Record an outcome as the lease holder would. Answers "status|next attempt".
create or replace function pg_temp.rec(p_user uuid, p_kind text, p_day date, p_outcome text) returns text
language plpgsql as $$
declare
  v_id uuid;
  v_claim text;
  v_status text;
  v_next timestamptz;
begin
  select delivery.id, delivery.claim_id into v_id, v_claim
  from public.push_notification_deliveries as delivery
  where delivery.user_id = p_user and delivery.notification_kind = p_kind and delivery.drop_date = p_day;

  select recorded.recorded_status, recorded.recorded_next_attempt_at into v_status, v_next
  from public.record_push_delivery_attempt(
    v_id, v_claim, p_outcome,
    case when p_outcome = 'ticket_accepted' then 'ticket-' || v_id end,
    case when p_outcome = 'ticket_accepted' then null else 'Expo 503 (suite)' end
  ) as recorded;

  return v_status || '|' || pg_temp.utc(v_next);
end $$;

create or replace function pg_temp.row_state(p_user uuid, p_kind text, p_day date) returns text
language sql stable as $$
  select coalesce((
    select delivery.status || '/' || delivery.attempt_count
    from public.push_notification_deliveries as delivery
    where delivery.user_id = p_user and delivery.notification_kind = p_kind and delivery.drop_date = p_day
  ), 'none');
$$;

create or replace function pg_temp.work(p_at timestamptz) returns text
language sql stable as $$ select public.count_claimable_push_work(p_at)::text $$;

-- Every delivery row, as one value: a no-op must leave it unchanged.
create or replace function pg_temp.fingerprint() returns text
language sql stable as $$
  select coalesce(md5(string_agg(
    delivery.id || delivery.status || delivery.attempt_count || coalesce(delivery.next_attempt_at::text, '') ||
    coalesce(delivery.claim_id, '') || delivery.updated_at::text, ',' order by delivery.id)), 'empty')
  from public.push_notification_deliveries as delivery;
$$;

create or replace function pg_temp.answer(p_user uuid, p_question uuid, p_at timestamptz) returns void
language sql as $$
  insert into public.question_attempts (
    user_id, logical_question_id, edition_date, started_at, deadline_at,
    submitted_at, selected_option_id, score_milli, status, option_order
  ) values (
    p_user, p_question, pg_temp.e1(), p_at - interval '30 seconds', p_at - interval '10 seconds',
    p_at - interval '15 seconds', null, 0, 'submitted', array[gen_random_uuid()]
  );
$$;

-- ---------------------------------------------------------------------------
-- 0. An empty minute: the pg_cron worker wakes nothing
-- ---------------------------------------------------------------------------
-- This suite owns the delivery table and the edition sequence; the
-- transaction rolls back.

delete from public.push_notification_deliveries;
delete from public.editions;

select pg_temp.record(1, 'Z1 with nothing due the minute job makes no request at all', 'false|no_due_work',
  (select (result ->> 'fired') || '|' || (result ->> 'reason') from (select public.invoke_push_worker() as result) as tick));

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

do $$
declare
  v_reader record;
begin
  for v_reader in
    select * from (values
      (pg_temp.c_dead(),  'c_dead',  'en', 'America/Chicago'),
      (pg_temp.c_fail(),  'c_fail',  'en', 'America/Chicago'),
      (pg_temp.c_ok(),    'c_ok',    'en', 'America/Chicago'),
      (pg_temp.c_retry(), 'c_retry', 'en', 'America/Chicago'),
      (pg_temp.paris(),   'paris',   'fr', 'Europe/Paris'),
      (pg_temp.tokyo(),   'tokyo',   'en', 'Asia/Tokyo')
    ) as fixture(id, short_name, language, zone)
  loop
    insert into ptr_names values (v_reader.id, v_reader.short_name);

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', v_reader.id, 'authenticated', 'authenticated',
      'ptr-suite-' || replace(v_reader.short_name, '_', '-') || '@example.test', 'x', now(), now(), now(),
      '', '', '', '', '{"provider":"email"}', '{}'
    );

    insert into public.profiles (id, email, language, timezone)
    values (v_reader.id, 'ptr-suite-' || replace(v_reader.short_name, '_', '-') || '@example.test',
            v_reader.language, v_reader.zone);

    -- Newsletter only, so one linked item makes a complete edition.
    insert into public.user_preferences (
      user_id, notifications_enabled, newsletter_enabled, business_stories_enabled, mini_cases_enabled
    ) values (v_reader.id, true, true, false, false);

    insert into public.push_tokens (user_id, expo_push_token, platform, enabled)
    values (v_reader.id, 'ExponentPushToken[ptr-' || v_reader.short_name || ']', 'ios', true);
  end loop;

  insert into public.content_items
    (id, content_type, topic_id, language, title, body_md, publication_date, status, metadata)
  values
    ('f4000000-0000-4000-8000-000000000001', 'newsletter_article', 'business', 'en',
     'PTR suite article one', 'Body.', pg_temp.e1(), 'published', '{"staging_job_id":"ptr-suite-job"}'),
    ('f4000000-0000-4000-8000-000000000002', 'newsletter_article', 'business', 'en',
     'PTR suite article two', 'Body.', pg_temp.e2(), 'published', '{"staging_job_id":"ptr-suite-job"}');

  -- E1 for every reader; E2 only for c_ok, the late-edition case.
  insert into public.daily_drops (user_id, drop_date, language, status, generated_at, published_at)
  select names.user_id, pg_temp.e1(), 'en', 'published', now(), now() from ptr_names as names;

  insert into public.daily_drops (user_id, drop_date, language, status, generated_at, published_at)
  values (pg_temp.c_ok(), pg_temp.e2(), 'en', 'published', now(), now());

  insert into public.daily_drop_items (daily_drop_id, content_item_id, slot, position)
  select edition_drop.id,
         case when edition_drop.drop_date = pg_temp.e1()
           then 'f4000000-0000-4000-8000-000000000001'::uuid
           else 'f4000000-0000-4000-8000-000000000002'::uuid end,
         'newsletter', 0
  from public.daily_drops as edition_drop
  where edition_drop.user_id in (select user_id from ptr_names);

  -- The drops fired the registry and outbox triggers; both are set by hand.
  delete from public.editions;
  insert into public.editions (edition_date, edition_kind, published_at) values
    (pg_temp.e1(), 'daily', timestamptz '2026-09-14 17:00:00+00'),
    (pg_temp.e2(), 'daily', timestamptz '2026-09-17 01:20:00+00');

  insert into public.notification_outbox (event_type, event_date, status, verified_at, processed_at)
  values
    ('edition_published', pg_temp.e1(), 'processed', timestamptz '2026-09-14 17:05:00+00', now()),
    ('edition_published', pg_temp.e2(), 'processed', timestamptz '2026-09-17 01:27:00+00', now())
  on conflict on constraint notification_outbox_identity_unique
  do update set status = 'processed', verified_at = excluded.verified_at, processed_at = now();

  insert into public.logical_questions
    (id, content_logical_key, content_type, question_sequence, question_role)
  values
    (pg_temp.lq_a(), 'ptr-suite-a', 'newsletter_article', 1, 'interpretation'),
    (pg_temp.lq_b(), 'ptr-suite-b', 'newsletter_article', 1, 'interpretation');

  -- c_fail and c_retry leave a question unanswered; c_ok answered theirs.
  insert into public.solo_question_assignments (user_id, edition_date, logical_question_id, position)
  values
    (pg_temp.c_fail(), pg_temp.e1(), pg_temp.lq_a(), 0),
    (pg_temp.c_ok(), pg_temp.e1(), pg_temp.lq_a(), 0),
    (pg_temp.c_retry(), pg_temp.e1(), pg_temp.lq_b(), 0);

  perform pg_temp.answer(pg_temp.c_ok(), pg_temp.lq_a(), timestamptz '2026-09-15 02:00:00+00');
end $$;

-- ---------------------------------------------------------------------------
-- T. The two targets on the reader's clock — pure, no fixture involved
-- ---------------------------------------------------------------------------

do $$
declare
  v_zone text := current_setting('timezone');
begin
  perform pg_temp.record(2, 'T1 20:00 local on 2026-09-14: Chicago, Paris, London, Tokyo, Sydney',
    '2026-09-15T01:00Z|2026-09-14T18:00Z|2026-09-14T19:00Z|2026-09-14T11:00Z|2026-09-14T10:00Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_target_at(pg_temp.e1(), 'America/Chicago')),
      pg_temp.utc(public.edition_ready_target_at(pg_temp.e1(), 'Europe/Paris')),
      pg_temp.utc(public.edition_ready_target_at(pg_temp.e1(), 'Europe/London')),
      pg_temp.utc(public.edition_ready_target_at(pg_temp.e1(), 'Asia/Tokyo')),
      pg_temp.utc(public.edition_ready_target_at(pg_temp.e1(), 'Australia/Sydney'))));

  perform pg_temp.record(3, 'T2 08:30 local the next morning: Chicago, Paris, London, Tokyo, Sydney',
    '2026-09-15T13:30Z|2026-09-15T06:30Z|2026-09-15T07:30Z|2026-09-14T23:30Z|2026-09-14T22:30Z',
    concat_ws('|',
      pg_temp.utc(public.edition_answer_reminder_target_at(pg_temp.e1(), 'America/Chicago')),
      pg_temp.utc(public.edition_answer_reminder_target_at(pg_temp.e1(), 'Europe/Paris')),
      pg_temp.utc(public.edition_answer_reminder_target_at(pg_temp.e1(), 'Europe/London')),
      pg_temp.utc(public.edition_answer_reminder_target_at(pg_temp.e1(), 'Asia/Tokyo')),
      pg_temp.utc(public.edition_answer_reminder_target_at(pg_temp.e1(), 'Australia/Sydney'))));

  -- Chicago falls back at 02:00 on Sunday 2026-11-01. Saturday's 20:00 is CDT,
  -- the 08:30 reminder the next morning is already CST, Sunday's 20:00 is CST.
  perform pg_temp.record(4, 'T3 DST fall-back, Chicago: 20:00 CDT, then 08:30 CST the next morning, then 20:00 CST',
    '2026-11-01T01:00Z|2026-11-01T14:30Z|2026-11-02T02:00Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_target_at(date '2026-10-31', 'America/Chicago')),
      pg_temp.utc(public.edition_answer_reminder_target_at(date '2026-10-31', 'America/Chicago')),
      pg_temp.utc(public.edition_ready_target_at(date '2026-11-01', 'America/Chicago'))));

  -- Chicago springs forward at 02:00 on Sunday 2027-03-14.
  perform pg_temp.record(5, 'T4 DST spring-forward, Chicago: 20:00 CST, then 08:30 CDT, then 20:00 CDT',
    '2027-03-14T02:00Z|2027-03-14T13:30Z|2027-03-15T01:00Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_target_at(date '2027-03-13', 'America/Chicago')),
      pg_temp.utc(public.edition_answer_reminder_target_at(date '2027-03-13', 'America/Chicago')),
      pg_temp.utc(public.edition_ready_target_at(date '2027-03-14', 'America/Chicago'))));

  -- Europe falls back on Sunday 2026-10-25.
  perform pg_temp.record(6, 'T5 DST, London and Paris: 20:00 BST, then 20:00 GMT, and 20:00 CET',
    '2026-10-24T19:00Z|2026-10-25T20:00Z|2026-10-25T19:00Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_target_at(date '2026-10-24', 'Europe/London')),
      pg_temp.utc(public.edition_ready_target_at(date '2026-10-25', 'Europe/London')),
      pg_temp.utc(public.edition_ready_target_at(date '2026-10-25', 'Europe/Paris'))));

  -- Sydney springs forward at 02:00 on Sunday 2026-10-04 (southern hemisphere).
  perform pg_temp.record(7, 'T6 DST, Sydney: 20:00 AEST, 08:30 AEDT the next morning, 20:00 AEDT',
    '2026-10-03T10:00Z|2026-10-03T21:30Z|2026-10-04T09:00Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_target_at(date '2026-10-03', 'Australia/Sydney')),
      pg_temp.utc(public.edition_answer_reminder_target_at(date '2026-10-03', 'Australia/Sydney')),
      pg_temp.utc(public.edition_ready_target_at(date '2026-10-04', 'Australia/Sydney'))));

  -- The real 2026-09-11 edition, verified at 17:00:19Z (12:00 Chicago).
  perform pg_temp.record(8, 'T7 ready before 20:00 -> due at 20:00 Chicago; reminder 08:30 Chicago',
    '2026-09-12T01:00Z|2026-09-12T13:30Z',
    pg_temp.utc(public.edition_ready_due_at(date '2026-09-11', 'America/Chicago', timestamptz '2026-09-11 17:00:19+00'))
    || '|' ||
    pg_temp.utc(public.edition_answer_reminder_due_at(date '2026-09-11', 'America/Chicago', timestamptz '2026-09-11 17:00:19+00')));

  perform pg_temp.record(9, 'T8 ready at 20:27 Chicago -> due at 20:27, never at 20:00 and never the next day',
    '2026-09-12T01:27Z',
    pg_temp.utc(public.edition_ready_due_at(date '2026-09-11', 'America/Chicago', timestamptz '2026-09-12 01:27:00+00')));

  perform pg_temp.record(10, 'T9 an edition that is not ready is never due', 'NULL',
    pg_temp.utc(public.edition_ready_due_at(date '2026-09-11', 'America/Chicago', null)));

  perform pg_temp.record(11, 'T10 zone fallback: missing, unknown and offset values are Europe/Paris; UTC and IANA names are kept',
    'Europe/Paris|Europe/Paris|Europe/Paris|UTC|Australia/Sydney|2026-09-14T18:00Z',
    concat_ws('|',
      public.reader_notification_timezone(null),
      public.reader_notification_timezone('Mars/Olympus'),
      public.reader_notification_timezone('UTC+5'),
      public.reader_notification_timezone('UTC'),
      public.reader_notification_timezone('Australia/Sydney'),
      pg_temp.utc(public.edition_ready_target_at(pg_temp.e1(), null))));

  -- The server's own zone plays no part.
  perform set_config('timezone', 'Pacific/Kiritimati', true);
  perform pg_temp.record(12, 'T11 the session/server timezone changes nothing', '2026-09-15T01:00Z|2026-09-15T13:30Z',
    pg_temp.utc(public.edition_ready_target_at(pg_temp.e1(), 'America/Chicago')) || '|' ||
    pg_temp.utc(public.edition_answer_reminder_target_at(pg_temp.e1(), 'America/Chicago')));
  perform set_config('timezone', v_zone, true);
end $$;

-- ---------------------------------------------------------------------------
-- W. The evening, E1 — 20:00 / 20:15 / 20:30 on each reader's clock
-- ---------------------------------------------------------------------------

do $$
declare
  v text;
  v_before text;
begin
  v := pg_temp.claim('w-1704', timestamptz '2026-09-14 17:04:00+00');
  perform pg_temp.record(20, 'W1 before verification nothing is due: clean no-op, no row written', '0|none|0',
    pg_temp.work(timestamptz '2026-09-14 17:04:00+00') || '|' || v || '|' ||
    (select count(*)::text from public.push_notification_deliveries));

  v := pg_temp.claim('w-1705', timestamptz '2026-09-14 17:05:00+00');
  perform pg_temp.record(21, 'W2 Tokyo: its 20:00 (11:00Z) passed before verification, so it is told at verification', 'tokyo:ready:1', v);
  perform pg_temp.record(22, 'W3 the leased row carries its schedule: target 20:00 Tokyo, scheduled at ready, zone, ready',
    '2026-09-14T11:00Z|2026-09-14T17:05Z|Asia/Tokyo|2026-09-14T17:05Z', pg_temp.handed('w-1705', pg_temp.tokyo()));
  perform pg_temp.record(23, 'W4 an accepted ticket waits for its receipt and gets no retry slot', 'awaiting_receipt|NULL',
    pg_temp.rec(pg_temp.tokyo(), 'edition_ready', pg_temp.e1(), 'ticket_accepted'));

  v := pg_temp.claim('w-1759', timestamptz '2026-09-14 17:59:00+00');
  perform pg_temp.record(24, 'W5 19:59 Paris: Paris waits for 20:00, Tokyo is not told twice', 'none', v);

  v := pg_temp.claim('w-1800', timestamptz '2026-09-14 18:00:00+00');
  perform pg_temp.record(25, 'W6 20:00 Paris on the minute', 'paris:ready:1', v);
  perform pg_temp.rec(pg_temp.paris(), 'edition_ready', pg_temp.e1(), 'ticket_accepted');

  v := pg_temp.claim('w-0059', timestamptz '2026-09-15 00:59:00+00');
  perform pg_temp.record(26, 'W7 19:59 Chicago: nothing — the old 19:00 target is gone', '0|none',
    pg_temp.work(timestamptz '2026-09-15 00:59:00+00') || '|' || v);

  v := pg_temp.claim('w-0100', timestamptz '2026-09-15 01:00:00+00');
  perform pg_temp.record(27, 'W8 20:00 Chicago: every Chicago device, attempt 1',
    'c_dead:ready:1,c_fail:ready:1,c_ok:ready:1,c_retry:ready:1', v);
  perform pg_temp.record(28, 'W9 target 20:00 Chicago = 01:00Z; ready at 12:05 Chicago did not move it',
    '2026-09-15T01:00Z|2026-09-15T01:00Z|America/Chicago|2026-09-14T17:05Z', pg_temp.handed('w-0100', pg_temp.c_fail()));

  v := pg_temp.claim('w-0100-b', timestamptz '2026-09-15 01:00:00+00');
  perform pg_temp.record(29, 'W10 a second worker in the same minute gets nothing: a live lease is never shared', 'none', v);

  perform pg_temp.record(30, 'W11 initial failure -> retry slot 20:15 Chicago', 'retryable_failure|2026-09-15T01:15Z',
    pg_temp.rec(pg_temp.c_fail(), 'edition_ready', pg_temp.e1(), 'retryable'));
  perform pg_temp.record(31, 'W12 initial success -> accepted, no retry slot', 'awaiting_receipt|NULL',
    pg_temp.rec(pg_temp.c_ok(), 'edition_ready', pg_temp.e1(), 'ticket_accepted'));
  perform pg_temp.rec(pg_temp.c_retry(), 'edition_ready', pg_temp.e1(), 'retryable');
  -- c_dead's worker never answers: its lease just expires.

  perform pg_temp.record(32, 'W13 a worker that no longer holds the lease records nothing', 'stale_claim|awaiting_receipt/1',
    (select recorded.recorded_status
     from public.record_push_delivery_attempt(
       pg_temp.delivery_id(pg_temp.c_ok(), 'edition_ready', pg_temp.e1()), 'someone-else', 'retryable', null, 'late') as recorded)
    || '|' || pg_temp.row_state(pg_temp.c_ok(), 'edition_ready', pg_temp.e1()));

  v_before := pg_temp.fingerprint();
  v := pg_temp.claim('w-0114', timestamptz '2026-09-15 01:14:00+00');
  perform pg_temp.record(33, 'W14 20:14: a frequent worker with nothing due is a clean no-op, nothing written', '0|none|true',
    pg_temp.work(timestamptz '2026-09-15 01:14:00+00') || '|' || v || '|' || (pg_temp.fingerprint() = v_before)::text);

  v := pg_temp.claim('w-0115', timestamptz '2026-09-15 01:15:00+00');
  perform pg_temp.record(34, 'W15 20:15: retry 1 for the failed and the silent devices, never for the accepted one',
    'c_dead:ready:2,c_fail:ready:2,c_retry:ready:2', v);
  perform pg_temp.record(35, 'W16 second failure -> retry slot 20:30 Chicago', 'retryable_failure|2026-09-15T01:30Z',
    pg_temp.rec(pg_temp.c_fail(), 'edition_ready', pg_temp.e1(), 'retryable'));
  perform pg_temp.record(36, 'W17 success at retry 1 -> no retry 2', 'awaiting_receipt|NULL',
    pg_temp.rec(pg_temp.c_retry(), 'edition_ready', pg_temp.e1(), 'ticket_accepted'));

  v := pg_temp.claim('w-0129', timestamptz '2026-09-15 01:29:00+00');
  perform pg_temp.record(37, 'W18 20:29: not a minute early', 'none', v);

  v := pg_temp.claim('w-0130', timestamptz '2026-09-15 01:30:00+00');
  perform pg_temp.record(38, 'W19 20:30: retry 2, the last one', 'c_dead:ready:3,c_fail:ready:3', v);
  perform pg_temp.record(39, 'W20 a third failure is terminal, with no fourth slot', 'terminal_failure|NULL',
    pg_temp.rec(pg_temp.c_fail(), 'edition_ready', pg_temp.e1(), 'retryable'));

  v := pg_temp.claim('w-0145', timestamptz '2026-09-15 01:45:00+00');
  perform pg_temp.record(40, 'W21 20:45: nothing — three attempts at most', 'none', v);
  perform pg_temp.record(41, 'W22 attempts are counted once per lease; a lease that died on attempt 3 ends terminal',
    'terminal_failure/3|terminal_failure/3|awaiting_receipt/1|awaiting_receipt/2',
    concat_ws('|',
      pg_temp.row_state(pg_temp.c_dead(), 'edition_ready', pg_temp.e1()),
      pg_temp.row_state(pg_temp.c_fail(), 'edition_ready', pg_temp.e1()),
      pg_temp.row_state(pg_temp.c_ok(), 'edition_ready', pg_temp.e1()),
      pg_temp.row_state(pg_temp.c_retry(), 'edition_ready', pg_temp.e1())));

  -- Someone forces an exhausted row back to pending.
  update public.push_notification_deliveries
  set status = 'pending'
  where id = pg_temp.delivery_id(pg_temp.c_fail(), 'edition_ready', pg_temp.e1());

  v := pg_temp.claim('w-0150', timestamptz '2026-09-15 01:50:00+00');
  perform pg_temp.record(42, 'W23 even a row forced back to pending never gets a fourth attempt', 'none|terminal_failure/3',
    v || '|' || pg_temp.row_state(pg_temp.c_fail(), 'edition_ready', pg_temp.e1()));

  -- The receipt comes back delivered.
  update public.push_notification_deliveries
  set status = 'sent', sent_at = now(), expo_receipt_checked_at = now()
  where id = pg_temp.delivery_id(pg_temp.c_ok(), 'edition_ready', pg_temp.e1());

  v := pg_temp.claim('w-0200', timestamptz '2026-09-15 02:00:00+00');
  perform pg_temp.record(43, 'W24 receipt pending or delivered: never sent again', 'none', v);

  perform pg_temp.record(44, 'W25 one row and one ticket per device, edition and kind', '0|1|1',
    (select count(*)::text from (
       select delivery.push_token_id
       from public.push_notification_deliveries as delivery
       group by delivery.push_token_id, delivery.drop_date, delivery.notification_kind
       having count(*) > 1) as duplicated)
    || '|' ||
    (select count(distinct delivery.expo_ticket_id)::text from public.push_notification_deliveries as delivery
     where delivery.user_id = pg_temp.c_ok() and delivery.notification_kind = 'edition_ready')
    || '|' ||
    (select count(distinct delivery.expo_ticket_id)::text from public.push_notification_deliveries as delivery
     where delivery.user_id = pg_temp.c_retry() and delivery.notification_kind = 'edition_ready'));
end $$;

-- ---------------------------------------------------------------------------
-- M. The next morning, E1 — 08:30 / 08:45 / 09:00 Chicago
-- ---------------------------------------------------------------------------

do $$
declare
  v text;
begin
  v := pg_temp.claim('m-1329', timestamptz '2026-09-15 13:29:00+00');
  perform pg_temp.record(50, 'M1 08:29 Chicago: no reminder yet', '0|none',
    pg_temp.work(timestamptz '2026-09-15 13:29:00+00') || '|' || v);

  v := pg_temp.claim('m-1330', timestamptz '2026-09-15 13:30:00+00');
  perform pg_temp.record(51, 'M2 08:30 Chicago: the readers with an unanswered question, attempt 1',
    'c_fail:reminder:1,c_retry:reminder:1', v);
  perform pg_temp.record(52, 'M3 the reminder row carries 08:30 Chicago the next morning',
    '2026-09-15T13:30Z|2026-09-15T13:30Z|America/Chicago|2026-09-14T17:05Z', pg_temp.handed('m-1330', pg_temp.c_fail()));
  perform pg_temp.record(53, 'M4 the reader who had answered everything is owed nothing', 'completed|none',
    (select reader.reader_state
     from public.edition_answer_reminder_reader(pg_temp.c_ok(), pg_temp.e1(), timestamptz '2026-09-15 13:30:00+00') as reader)
    || '|' || pg_temp.row_state(pg_temp.c_ok(), 'edition_answer_reminder', pg_temp.e1()));

  perform pg_temp.record(54, 'M5 failure at 08:30 -> retry 08:45', 'retryable_failure|2026-09-15T13:45Z',
    pg_temp.rec(pg_temp.c_fail(), 'edition_answer_reminder', pg_temp.e1(), 'retryable'));
  perform pg_temp.rec(pg_temp.c_retry(), 'edition_answer_reminder', pg_temp.e1(), 'retryable');

  -- c_retry answers before their retry.
  perform pg_temp.answer(pg_temp.c_retry(), pg_temp.lq_b(), timestamptz '2026-09-15 13:40:00+00');

  v := pg_temp.claim('m-1344', timestamptz '2026-09-15 13:44:00+00');
  perform pg_temp.record(55, 'M6 08:44: nothing early', 'none', v);

  v := pg_temp.claim('m-1345', timestamptz '2026-09-15 13:45:00+00');
  perform pg_temp.record(56, 'M7 08:45: retry 1; the reader who answered meanwhile is stood down, never reminded',
    'c_fail:reminder:2|cancelled/1',
    v || '|' || pg_temp.row_state(pg_temp.c_retry(), 'edition_answer_reminder', pg_temp.e1()));
  perform pg_temp.record(57, 'M8 second failure -> retry 09:00', 'retryable_failure|2026-09-15T14:00Z',
    pg_temp.rec(pg_temp.c_fail(), 'edition_answer_reminder', pg_temp.e1(), 'retryable'));

  v := pg_temp.claim('m-1400', timestamptz '2026-09-15 14:00:00+00');
  perform pg_temp.record(58, 'M9 09:00: retry 2', 'c_fail:reminder:3', v);
  perform pg_temp.record(59, 'M10 a third failure is terminal', 'terminal_failure|NULL',
    pg_temp.rec(pg_temp.c_fail(), 'edition_answer_reminder', pg_temp.e1(), 'retryable'));

  v := pg_temp.claim('m-1415', timestamptz '2026-09-15 14:15:00+00');
  perform pg_temp.record(60, 'M11 no fourth reminder', 'none|terminal_failure/3',
    v || '|' || pg_temp.row_state(pg_temp.c_fail(), 'edition_answer_reminder', pg_temp.e1()));
end $$;

-- ---------------------------------------------------------------------------
-- L. E2 is not ready at 20:00 Chicago — it is ready at 20:27
-- ---------------------------------------------------------------------------

do $$
declare
  v text;
begin
  v := pg_temp.claim('l-0100', timestamptz '2026-09-17 01:00:00+00');
  perform pg_temp.record(70, 'L1 20:00 Chicago, edition not ready: nothing sent, nothing written, nothing marked sent', '0|none|none',
    pg_temp.work(timestamptz '2026-09-17 01:00:00+00') || '|' || v || '|' ||
    pg_temp.row_state(pg_temp.c_ok(), 'edition_ready', pg_temp.e2()));

  v := pg_temp.claim('l-0126', timestamptz '2026-09-17 01:26:00+00');
  perform pg_temp.record(71, 'L2 published at 20:20 but verified only at 20:27: still nothing', 'none', v);

  v := pg_temp.claim('l-0127', timestamptz '2026-09-17 01:27:00+00');
  perform pg_temp.record(72, 'L3 20:27 Chicago, the minute it is ready', 'c_ok:ready:1', v);
  perform pg_temp.record(73, 'L4 the 20:00 target is kept; scheduled at the ready time',
    '2026-09-17T01:00Z|2026-09-17T01:27Z|America/Chicago|2026-09-17T01:27Z', pg_temp.handed('l-0127', pg_temp.c_ok()));
  perform pg_temp.record(74, 'L5 the timeline says why: 20:00 local target, blocked until ready',
    '2026-09-16 20:00|true|2026-09-17T01:27Z',
    (select timeline.timeline_target_local || '|' || timeline.timeline_blocked_until_ready || '|' ||
            pg_temp.utc(timeline.timeline_edition_ready_at)
     from public.get_push_delivery_timeline(pg_temp.e2()) as timeline
     where timeline.timeline_reader = left(md5(pg_temp.c_ok()::text), 8)));
  perform pg_temp.record(75, 'L6 its retries count from when it could first be sent: 20:42', 'retryable_failure|2026-09-17T01:42Z',
    pg_temp.rec(pg_temp.c_ok(), 'edition_ready', pg_temp.e2(), 'retryable'));

  v := pg_temp.claim('l-0142', timestamptz '2026-09-17 01:42:00+00');
  perform pg_temp.record(76, 'L7 20:42 Chicago: retry 1', 'c_ok:ready:2', v);
  perform pg_temp.record(77, 'L8 a second failure moves it to 20:57', 'retryable_failure|2026-09-17T01:57Z',
    pg_temp.rec(pg_temp.c_ok(), 'edition_ready', pg_temp.e2(), 'retryable'));

  v := pg_temp.claim('l-0156', timestamptz '2026-09-17 01:56:00+00');
  perform pg_temp.record(78, 'L9 not at 20:56', 'none', v);

  v := pg_temp.claim('l-0157', timestamptz '2026-09-17 01:57:00+00');
  perform pg_temp.record(79, 'L10 20:57 Chicago: retry 2, the last one', 'c_ok:ready:3', v);
  perform pg_temp.record(80, 'L11 and its failure is terminal', 'terminal_failure|NULL',
    pg_temp.rec(pg_temp.c_ok(), 'edition_ready', pg_temp.e2(), 'retryable'));
end $$;

-- ---------------------------------------------------------------------------
-- O. Observability — the whole story of an edition, with no token in it
-- ---------------------------------------------------------------------------

select pg_temp.record(80, 'O1 a failed evening device: zone, 20:00 local, UTC target, ready, not blocked, attempts, result',
  'America/Chicago|2026-09-14 20:00|2026-09-15T01:00Z|2026-09-14T17:05Z|false|3|terminal_failure',
  (select concat_ws('|', timeline.timeline_timezone, timeline.timeline_target_local,
            pg_temp.utc(timeline.timeline_target_utc), pg_temp.utc(timeline.timeline_edition_ready_at),
            timeline.timeline_blocked_until_ready::text, timeline.timeline_attempts, timeline.timeline_status)
   from public.get_push_delivery_timeline(pg_temp.e1()) as timeline
   where timeline.timeline_kind = 'edition_ready'
     and timeline.timeline_reader = left(md5(pg_temp.c_fail()::text), 8)));

select pg_temp.record(81, 'O2 Tokyo was blocked until ready: its 20:00 came before verification',
  'Asia/Tokyo|2026-09-14 20:00|true|awaiting_receipt',
  (select concat_ws('|', timeline.timeline_timezone, timeline.timeline_target_local,
            timeline.timeline_blocked_until_ready::text, timeline.timeline_status)
   from public.get_push_delivery_timeline(pg_temp.e1()) as timeline
   where timeline.timeline_reader = left(md5(pg_temp.tokyo()::text), 8)));

select pg_temp.record(82, 'O3 the morning timeline: 08:30 local target, three attempts, terminal',
  '2026-09-15 08:30|3|terminal_failure',
  (select concat_ws('|', timeline.timeline_target_local, timeline.timeline_attempts, timeline.timeline_status)
   from public.get_push_delivery_timeline(pg_temp.e1()) as timeline
   where timeline.timeline_kind = 'edition_answer_reminder'
     and timeline.timeline_reader = left(md5(pg_temp.c_fail()::text), 8)));

select pg_temp.record(83, 'O4 no push token and no user id appears anywhere in the timeline', '0|0',
  (select count(*)::text from public.get_push_delivery_timeline(pg_temp.e1()) as timeline
   where timeline::text like '%PushToken%')
  || '|' ||
  (select count(*)::text from public.get_push_delivery_timeline(pg_temp.e1()) as timeline
   where timeline::text like '%' || pg_temp.c_fail()::text || '%'));

-- ---------------------------------------------------------------------------
-- N. The Node fallback (GitHub workflow) is bound by the same rules
-- ---------------------------------------------------------------------------
-- claim_push_notification_deliveries reads the database clock, so this section
-- places its rows relative to now().

do $$
declare
  v_token uuid;
  v_count int;
  v_state text;
begin
  select count(*) into v_count
  from public.claim_push_notification_deliveries(
    (select jsonb_agg(jsonb_build_object(
       'push_token_id', delivery.push_token_id, 'user_id', delivery.user_id,
       'drop_date', to_char(delivery.drop_date, 'YYYY-MM-DD'), 'notification_kind', delivery.notification_kind))
     from public.push_notification_deliveries as delivery
     where delivery.drop_date = pg_temp.e1() and delivery.notification_kind = 'edition_ready'),
    'ptr-node-1', 900);

  perform pg_temp.record(90, 'N1 the Node fallback cannot re-send an accepted, delivered or exhausted row', '0', v_count::text);

  insert into public.push_tokens (user_id, expo_push_token, platform, enabled)
  values (pg_temp.paris(), 'ExponentPushToken[ptr-paris-2]', 'ios', true)
  returning id into v_token;

  insert into public.push_notification_deliveries (
    push_token_id, user_id, drop_date, notification_kind, status, attempt_count,
    target_at, scheduled_for, reader_timezone, next_attempt_at
  ) values (
    v_token, pg_temp.paris(), pg_temp.e1(), 'edition_ready', 'retryable_failure', 1,
    now() - interval '16 minutes', now() - interval '16 minutes', 'Europe/Paris', now() + interval '10 minutes'
  );

  select count(*) into v_count
  from public.claim_push_notification_deliveries(
    jsonb_build_array(jsonb_build_object('push_token_id', v_token, 'user_id', pg_temp.paris(),
      'drop_date', to_char(pg_temp.e1(), 'YYYY-MM-DD'), 'notification_kind', 'edition_ready')),
    'ptr-node-2', 900);

  perform pg_temp.record(91, 'N2 the Node fallback does not take a retry before its slot', '0', v_count::text);

  update public.push_notification_deliveries
  set next_attempt_at = now() - interval '1 minute'
  where push_token_id = v_token;

  select count(*) into v_count
  from public.claim_push_notification_deliveries(
    jsonb_build_array(jsonb_build_object('push_token_id', v_token, 'user_id', pg_temp.paris(),
      'drop_date', to_char(pg_temp.e1(), 'YYYY-MM-DD'), 'notification_kind', 'edition_ready')),
    'ptr-node-3', 900);

  select delivery.attempt_count || '|' || delivery.status into v_state
  from public.push_notification_deliveries as delivery
  where delivery.push_token_id = v_token;

  perform pg_temp.record(92, 'N3 at its slot it does, and the lease counts attempt 2', '1|2|claimed', v_count || '|' || v_state);

  -- The sender still on `main` records a failure by adding one itself.
  update public.push_notification_deliveries
  set status = 'retryable_failure', attempt_count = attempt_count + 1, last_attempt_at = now(), error = 'Expo 503'
  where push_token_id = v_token;

  perform pg_temp.record(93, 'N4 that extra +1 is not counted twice, and its retry is scheduled at +30', '2|true',
    (select delivery.attempt_count || '|' || (delivery.next_attempt_at = delivery.scheduled_for + interval '30 minutes')
     from public.push_notification_deliveries as delivery
     where delivery.push_token_id = v_token));
end $$;

-- ---------------------------------------------------------------------------
-- P. Plumbing: privileges and the minute job
-- ---------------------------------------------------------------------------

select pg_temp.record(100, 'P1 no client key can claim, record, read the timeline or wake the worker',
  'false|false|false|false|false|true|true',
  concat_ws('|',
    has_function_privilege('authenticated', 'public.claim_due_push_notifications(text,integer,integer,timestamptz)', 'EXECUTE')::text,
    has_function_privilege('anon', 'public.record_push_delivery_attempt(uuid,text,text,text,text)', 'EXECUTE')::text,
    has_function_privilege('authenticated', 'public.get_push_delivery_timeline(date)', 'EXECUTE')::text,
    has_function_privilege('authenticated', 'public.invoke_push_worker()', 'EXECUTE')::text,
    has_function_privilege('anon', 'public.count_claimable_push_work(timestamptz)', 'EXECUTE')::text,
    has_function_privilege('service_role', 'public.claim_due_push_notifications(text,integer,integer,timestamptz)', 'EXECUTE')::text,
    has_function_privilege('service_role', 'public.record_push_delivery_attempt(uuid,text,text,text,text)', 'EXECUTE')::text));

select pg_temp.record(101, 'P2 one worker job, every minute', '* * * * *|1',
  case when to_regclass('cron.job') is null then 'NO CRON SCHEMA'
    else (select coalesce(max(job.schedule), 'NOT SCHEDULED') || '|' || count(*)
          from cron.job as job
          where job.jobname = 'personews-push-worker')
  end);

select pg_temp.record(102, 'P3 the database never talks to Expo; the worker checks for due work before any secret',
  'false|true',
  (select concat_ws('|',
     (position('expo' in lower(p.prosrc)) > 0)::text,
     (position('no_due_work' in p.prosrc) < position('vault.decrypted_secrets' in p.prosrc))::text)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'invoke_push_worker'));

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from ptr_results) as checks,
  (select count(*) from ptr_results where pass) as passed,
  (select count(*) from ptr_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from ptr_results where not pass) as failures;

rollback;
