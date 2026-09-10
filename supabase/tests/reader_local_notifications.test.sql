-- Reader-local edition notifications — PRODUCTION project.
--
-- Proves 20260910090000_reader_local_notifications: 19:00 reader-local
-- edition_ready, the 08:30 reader-local edition_answer_reminder, its exact
-- eligibility re-checked at claim time, and the health states.
--
-- One transaction ending in ROLLBACK. Every reader, device, edition and delivery
-- row below is a fixture that never survives the run, and nothing reaches Expo:
-- the dispatcher, the only function here that can leave PostgreSQL, is never
-- invoked — only its source and its cron entry are inspected.
--
-- Time is injected (p_now), never read from the wall clock, so each case names
-- the instant it is about. The fixture edition is Monday 2026-09-14, published
-- 17:00Z and verified 17:05Z (19:05 Paris); the next edition publishes
-- Wednesday 2026-09-16 17:00Z. The cases run in chronological order.
--
-- Run locally without applying the migration:
--   node scripts/local-sql-tests.mjs local-time --with-migrations
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table ltn_results (
  seq int,
  test text,
  expectation text,
  observed text,
  pass boolean
);

create or replace function pg_temp.record(
  p_seq int, p_test text, p_expected text, p_observed text
) returns void
language sql as $$
  insert into ltn_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'),
          p_expected = coalesce(p_observed, 'NULL'));
$$;

-- An instant, in UTC, to the minute. Every expected value below is written in
-- this shape so the conversions can be checked by eye.
create or replace function pg_temp.utc(p_at timestamptz) returns text
language sql immutable as $$
  select coalesce(to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), 'NULL');
$$;

create or replace function pg_temp.ed() returns date
language sql immutable as $$ select date '2026-09-14' $$;

-- Readers.
create or replace function pg_temp.r_paris() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.r_newyork() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-000000000002'::uuid $$;
create or replace function pg_temp.r_chicago() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-000000000003'::uuid $$;
create or replace function pg_temp.r_la() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-000000000004'::uuid $$;
create or replace function pg_temp.r_shanghai() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-000000000005'::uuid $$;
create or replace function pg_temp.r_done() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-000000000006'::uuid $$;
create or replace function pg_temp.r_zero() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-000000000007'::uuid $$;
create or replace function pg_temp.r_muted() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-000000000008'::uuid $$;
create or replace function pg_temp.r_nodevice() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-000000000009'::uuid $$;
create or replace function pg_temp.r_team() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.r_traveler() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.r_badzone() returns uuid language sql immutable as $$ select 'e1000000-0000-4000-8000-00000000000c'::uuid $$;

create or replace function pg_temp.lq_a() returns uuid language sql immutable as $$ select 'e2000000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.lq_b() returns uuid language sql immutable as $$ select 'e2000000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.lq_c() returns uuid language sql immutable as $$ select 'e2000000-0000-4000-8000-00000000000c'::uuid $$;
create or replace function pg_temp.team_one() returns uuid language sql immutable as $$ select 'e3000000-0000-4000-8000-000000000001'::uuid $$;

create or replace function pg_temp.state(p_user uuid, p_at timestamptz) returns text
language sql stable as $$
  select reader.reader_state
  from public.edition_answer_reminder_reader(p_user, pg_temp.ed(), p_at) as reader;
$$;

create or replace function pg_temp.due(p_user uuid) returns text
language sql stable as $$
  select pg_temp.utc(reader.due_at)
  from public.edition_answer_reminder_reader(p_user, pg_temp.ed(), now()) as reader;
$$;

-- Claim at an instant; answers "reader-short-name:language" sorted, so a case
-- can say exactly who was leased.
create temp table ltn_names (user_id uuid primary key, short_name text);

create or replace function pg_temp.claim(p_claim text, p_at timestamptz) returns text
language sql as $$
  select coalesce(string_agg(names.short_name || ':' || claimed.claimed_language, ',' order by names.short_name, claimed.claimed_push_token_id), 'none')
  from public.claim_edition_answer_reminders(p_claim, 500, 900, p_at) as claimed
  join ltn_names as names on names.user_id = claimed.claimed_user_id;
$$;

create or replace function pg_temp.reminder_rows(p_user uuid) returns text
language sql stable as $$
  select count(*)::text
  from public.push_notification_deliveries as delivery
  where delivery.user_id = p_user
    and delivery.drop_date = pg_temp.ed()
    and delivery.notification_kind = 'edition_answer_reminder';
$$;

create or replace function pg_temp.reminder_status(p_user uuid) returns text
language sql stable as $$
  select coalesce(string_agg(delivery.status || coalesce('/' || delivery.error, ''), ',' order by delivery.status), 'none')
  from public.push_notification_deliveries as delivery
  where delivery.user_id = p_user
    and delivery.drop_date = pg_temp.ed()
    and delivery.notification_kind = 'edition_answer_reminder';
$$;

create or replace function pg_temp.mark_reminders(p_user uuid, p_status text) returns void
language sql as $$
  update public.push_notification_deliveries as delivery
  set status = p_status,
      sent_at = case when p_status = 'sent' then now() else delivery.sent_at end,
      expo_ticket_id = case when p_status in ('sent', 'awaiting_receipt') then 'ticket-' || delivery.id else delivery.expo_ticket_id end,
      claim_id = null,
      claim_expires_at = null
  where delivery.user_id = p_user
    and delivery.drop_date = pg_temp.ed()
    and delivery.notification_kind = 'edition_answer_reminder';
$$;

create or replace function pg_temp.answer(p_user uuid, p_question uuid, p_at timestamptz) returns void
language sql as $$
  insert into public.question_attempts (
    user_id, logical_question_id, edition_date, started_at, deadline_at,
    submitted_at, selected_option_id, score_milli, status, option_order
  ) values (
    p_user, p_question, pg_temp.ed(), p_at - interval '30 seconds', p_at - interval '10 seconds',
    p_at - interval '15 seconds', null, 0, 'submitted', array[gen_random_uuid()]
  );
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

do $$
declare
  v_reader record;
begin
  for v_reader in
    select * from (values
      (pg_temp.r_paris(),    'paris',    'fr', 'Europe/Paris',        true,  2),
      (pg_temp.r_newyork(),  'newyork',  'en', 'America/New_York',    true,  1),
      (pg_temp.r_chicago(),  'chicago',  'en', 'America/Chicago',     true,  1),
      (pg_temp.r_la(),       'la',       'en', 'America/Los_Angeles', true,  1),
      (pg_temp.r_shanghai(), 'shanghai', 'en', 'Asia/Shanghai',       true,  1),
      (pg_temp.r_done(),     'done',     'fr', 'Europe/Paris',        true,  1),
      (pg_temp.r_zero(),     'zero',     'fr', 'Europe/Paris',        true,  1),
      (pg_temp.r_muted(),    'muted',    'fr', 'Europe/Paris',        false, 1),
      (pg_temp.r_nodevice(), 'nodevice', 'fr', 'Europe/Paris',        true,  0),
      (pg_temp.r_team(),     'team',     'en', 'Europe/Paris',        true,  1),
      (pg_temp.r_traveler(), 'traveler', 'en', 'Europe/Paris',        true,  1),
      (pg_temp.r_badzone(),  'badzone',  'en', 'Mars/Olympus',        true,  1)
    ) as fixture(id, short_name, language, zone, notifications, devices)
  loop
    insert into ltn_names values (v_reader.id, v_reader.short_name);

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', v_reader.id, 'authenticated', 'authenticated',
      'ltn-suite-' || v_reader.short_name || '@example.test', 'x', now(), now(), now(),
      '', '', '', '', '{"provider":"email"}', '{}'
    );

    insert into public.profiles (id, email, language, timezone)
    values (v_reader.id, 'ltn-suite-' || v_reader.short_name || '@example.test',
            v_reader.language, v_reader.zone);

    -- Newsletter only, so one linked item makes a complete edition.
    insert into public.user_preferences (
      user_id, notifications_enabled, newsletter_enabled, business_stories_enabled, mini_cases_enabled
    ) values (v_reader.id, v_reader.notifications, true, false, false);

    for v_device in 1..v_reader.devices loop
      insert into public.push_tokens (user_id, expo_push_token, platform, enabled)
      values (v_reader.id, 'ExponentPushToken[ltn-' || v_reader.short_name || '-' || v_device || ']', 'ios', true);
    end loop;
  end loop;

  -- The device-less reader does have rows — neither of which can receive a push:
  -- one switched off, one a raw APNs token an old build stored.
  insert into public.push_tokens (user_id, expo_push_token, platform, enabled) values
    (pg_temp.r_nodevice(), 'ExponentPushToken[ltn-nodevice-off]', 'ios', false),
    (pg_temp.r_nodevice(), repeat('ab', 32), 'ios', true);

  update public.profiles set username = 'ltnsuite_team' where id = pg_temp.r_team();

  insert into public.content_items
    (id, content_type, topic_id, language, title, body_md, publication_date, status, metadata)
  values
    ('e4000000-0000-4000-8000-000000000001', 'newsletter_article', 'business', 'en',
     'LTN suite article', 'Body.', date '2026-09-14', 'published', '{"staging_job_id":"ltn-suite-job"}');

  -- Five readers have tonight's edition, which fires the outbox and the edition
  -- registry triggers. Both are overwritten below with controlled values.
  insert into public.daily_drops (user_id, drop_date, language, status, generated_at, published_at)
  select fixture.id, pg_temp.ed(), 'en', 'published', now(), now()
  from (values (pg_temp.r_paris()), (pg_temp.r_newyork()), (pg_temp.r_chicago()),
               (pg_temp.r_la()), (pg_temp.r_shanghai())) as fixture(id);

  insert into public.daily_drop_items (daily_drop_id, content_item_id, slot, position)
  select edition_drop.id, 'e4000000-0000-4000-8000-000000000001', 'newsletter', 0
  from public.daily_drops as edition_drop
  where edition_drop.drop_date = pg_temp.ed()
    and edition_drop.user_id in (select user_id from ltn_names);

  -- The edition sequence is this suite's clock, so it is isolated. Nothing
  -- references editions by foreign key, and the transaction rolls back.
  delete from public.editions;
  insert into public.editions (edition_date, edition_kind, published_at) values
    (date '2026-09-13', 'weekly_digest', timestamptz '2026-09-13 17:00:00+00'),
    (pg_temp.ed(),      'daily',         timestamptz '2026-09-14 17:00:00+00'),
    (date '2026-09-16', 'daily',         timestamptz '2026-09-16 17:00:00+00');

  -- Verified at 19:05 Paris.
  insert into public.notification_outbox (event_type, event_date, status, verified_at, processed_at)
  values ('edition_published', pg_temp.ed(), 'processed', timestamptz '2026-09-14 17:05:00+00', now())
  on conflict on constraint notification_outbox_identity_unique
  do update set status = 'processed', verified_at = excluded.verified_at, processed_at = now();

  -- Three questions: two personal newsletter questions, one Team mini case.
  insert into public.logical_questions
    (id, content_logical_key, content_type, question_sequence, question_role)
  values
    (pg_temp.lq_a(), 'ltn-suite-a', 'newsletter_article', 1, 'interpretation'),
    (pg_temp.lq_b(), 'ltn-suite-b', 'newsletter_article', 1, 'interpretation'),
    (pg_temp.lq_c(), 'ltn-suite-c', 'mini_case', 1, 'method_framework');

  insert into public.solo_question_assignments (user_id, edition_date, logical_question_id, position)
  select fixture.id, pg_temp.ed(), fixture.question, 0
  from (values
    (pg_temp.r_paris(), pg_temp.lq_a()),
    (pg_temp.r_paris(), pg_temp.lq_b()),
    (pg_temp.r_newyork(), pg_temp.lq_a()),
    (pg_temp.r_chicago(), pg_temp.lq_a()),
    (pg_temp.r_chicago(), pg_temp.lq_b()),
    (pg_temp.r_la(), pg_temp.lq_a()),
    (pg_temp.r_shanghai(), pg_temp.lq_a()),
    (pg_temp.r_done(), pg_temp.lq_a()),
    (pg_temp.r_muted(), pg_temp.lq_a()),
    (pg_temp.r_nodevice(), pg_temp.lq_a()),
    (pg_temp.r_traveler(), pg_temp.lq_a()),
    (pg_temp.r_badzone(), pg_temp.lq_a())
  ) as fixture(id, question);

  -- The Team reader has NO personal assignment: only their Team's question.
  insert into public.teams (id, owner_id, name, invite_code)
  values (pg_temp.team_one(), pg_temp.r_team(), 'LTN suite team', 'LTNSUIT1');

  insert into public.team_members (team_id, user_id, role, eligible_from_edition, joined_at)
  values (pg_temp.team_one(), pg_temp.r_team(), 'owner', date '2026-09-13',
          timestamptz '2026-09-12 12:00:00+00');

  insert into public.team_question_assignments (team_id, edition_date, logical_question_id, content_type)
  values (pg_temp.team_one(), pg_temp.ed(), pg_temp.lq_c(), 'mini_case');

  -- Already answered before the edition closed.
  perform pg_temp.answer(pg_temp.r_done(), pg_temp.lq_a(), timestamptz '2026-09-14 20:00:00+00');
  perform pg_temp.answer(pg_temp.r_chicago(), pg_temp.lq_a(), timestamptz '2026-09-15 02:00:00+00');
end $$;

-- ---------------------------------------------------------------------------
-- T. The reader's clock — pure, no fixture involved
-- ---------------------------------------------------------------------------

do $$
declare
  v_released timestamptz := timestamptz '2026-09-14 17:05:00+00';
begin
  perform pg_temp.record(1, 'T1 an IANA zone is used as-is', 'America/Chicago',
    public.reader_notification_timezone('America/Chicago'));
  perform pg_temp.record(2, 'T2 an unknown zone falls back to the product zone', 'Europe/Paris',
    public.reader_notification_timezone('Mars/Olympus'));
  perform pg_temp.record(3, 'T3 offsets and abbreviations are refused, never trusted',
    'Europe/Paris|Europe/Paris|Europe/Paris|Europe/Paris|UTC',
    concat_ws('|',
      public.reader_notification_timezone('UTC+5'),
      public.reader_notification_timezone('CEST'),
      public.reader_notification_timezone(null),
      public.reader_notification_timezone('  '),
      public.reader_notification_timezone('UTC')));

  -- 19:00 local on 2026-09-14 (all four in summer time), edition verified 17:05Z.
  perform pg_temp.record(4, 'T4 edition_ready: Paris, New York, Chicago (New Orleans), Los Angeles',
    '2026-09-14T17:05Z|2026-09-14T23:00Z|2026-09-15T00:00Z|2026-09-15T02:00Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_due_at(pg_temp.ed(), 'Europe/Paris', v_released)),
      pg_temp.utc(public.edition_ready_due_at(pg_temp.ed(), 'America/New_York', v_released)),
      pg_temp.utc(public.edition_ready_due_at(pg_temp.ed(), 'America/Chicago', v_released)),
      pg_temp.utc(public.edition_ready_due_at(pg_temp.ed(), 'America/Los_Angeles', v_released))));

  -- 08:30 local on 2026-09-15.
  perform pg_temp.record(5, 'T5 reminder: Paris, New York, Chicago (New Orleans), Los Angeles',
    '2026-09-15T06:30Z|2026-09-15T12:30Z|2026-09-15T13:30Z|2026-09-15T15:30Z',
    concat_ws('|',
      pg_temp.utc(public.edition_answer_reminder_due_at(pg_temp.ed(), 'Europe/Paris', v_released)),
      pg_temp.utc(public.edition_answer_reminder_due_at(pg_temp.ed(), 'America/New_York', v_released)),
      pg_temp.utc(public.edition_answer_reminder_due_at(pg_temp.ed(), 'America/Chicago', v_released)),
      pg_temp.utc(public.edition_answer_reminder_due_at(pg_temp.ed(), 'America/Los_Angeles', v_released))));

  -- 19:00 in Shanghai is 11:00Z, six hours before Paris verified at 17:05Z. It
  -- has already passed, so Shanghai is due AT verification (01:05 Shanghai on
  -- the 15th) — never moved to the next evening. The reminder is 08:30
  -- Shanghai on the 15th. Tokyo the same, an hour further east.
  perform pg_temp.record(6, 'T6 Asia/Shanghai (and Tokyo): 19:00 already passed at verification, so due immediately',
    '2026-09-14T17:05Z|2026-09-15T00:30Z|2026-09-14T17:05Z|2026-09-14T23:30Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_due_at(pg_temp.ed(), 'Asia/Shanghai', v_released)),
      pg_temp.utc(public.edition_answer_reminder_due_at(pg_temp.ed(), 'Asia/Shanghai', v_released)),
      pg_temp.utc(public.edition_ready_due_at(pg_temp.ed(), 'Asia/Tokyo', v_released)),
      pg_temp.utc(public.edition_answer_reminder_due_at(pg_temp.ed(), 'Asia/Tokyo', v_released))));

  perform pg_temp.record(7, 'T7 a Paris verification after 19:00 is announced at once, however late, never the next day',
    '2026-09-14T19:30Z|2026-09-14T20:30Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_due_at(pg_temp.ed(), 'Europe/Paris', timestamptz '2026-09-14 19:30:00+00')),
      pg_temp.utc(public.edition_ready_due_at(pg_temp.ed(), 'Europe/Paris', timestamptz '2026-09-14 20:30:00+00'))));

  perform pg_temp.record(8, 'T8 an unverified edition is never due', 'NULL|NULL',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_due_at(pg_temp.ed(), 'Europe/Paris', null)),
      pg_temp.utc(public.edition_answer_reminder_due_at(pg_temp.ed(), 'Europe/Paris', null))));

  -- DST, autumn. Europe left summer time on 2026-10-25, the US on 2026-11-01.
  -- Monday 2026-10-26: Paris is on CET, New York still on EDT.
  perform pg_temp.record(9, 'T9 DST: Paris after 25 Oct is UTC+1, New York before 1 Nov is UTC-4',
    '2026-10-26T18:05Z|2026-10-27T07:30Z|2026-10-26T23:00Z|2026-10-27T12:30Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_due_at(date '2026-10-26', 'Europe/Paris', timestamptz '2026-10-26 18:05:00+00')),
      pg_temp.utc(public.edition_answer_reminder_due_at(date '2026-10-26', 'Europe/Paris', timestamptz '2026-10-26 18:05:00+00')),
      pg_temp.utc(public.edition_ready_due_at(date '2026-10-26', 'America/New_York', timestamptz '2026-10-26 18:05:00+00')),
      pg_temp.utc(public.edition_answer_reminder_due_at(date '2026-10-26', 'America/New_York', timestamptz '2026-10-26 18:05:00+00'))));

  -- Friday 2026-10-30 (CDT) and Sunday 2026-11-01, the day Chicago and Los
  -- Angeles fall back at 02:00 local: the same 19:00 and 08:30 move by an hour
  -- in UTC with nothing written down.
  perform pg_temp.record(10, 'T10 DST: Chicago and Los Angeles across the 1 Nov fall-back',
    '2026-10-31T00:00Z|2026-10-31T13:30Z|2026-11-02T01:00Z|2026-11-02T14:30Z|2026-11-02T03:00Z|2026-11-02T16:30Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_due_at(date '2026-10-30', 'America/Chicago', timestamptz '2026-10-30 18:05:00+00')),
      pg_temp.utc(public.edition_answer_reminder_due_at(date '2026-10-30', 'America/Chicago', timestamptz '2026-10-30 18:05:00+00')),
      pg_temp.utc(public.edition_ready_due_at(date '2026-11-01', 'America/Chicago', timestamptz '2026-11-01 18:05:00+00')),
      pg_temp.utc(public.edition_answer_reminder_due_at(date '2026-11-01', 'America/Chicago', timestamptz '2026-11-01 18:05:00+00')),
      pg_temp.utc(public.edition_ready_due_at(date '2026-11-01', 'America/Los_Angeles', timestamptz '2026-11-01 18:05:00+00')),
      pg_temp.utc(public.edition_answer_reminder_due_at(date '2026-11-01', 'America/Los_Angeles', timestamptz '2026-11-01 18:05:00+00'))));

  -- DST, spring. The US springs forward on 2027-03-14, Europe on 2027-03-28.
  perform pg_temp.record(11, 'T11 DST: New York and Paris on the spring-forward Sundays',
    '2027-03-14T23:00Z|2027-03-15T12:30Z|2027-03-28T17:05Z|2027-03-29T06:30Z',
    concat_ws('|',
      pg_temp.utc(public.edition_ready_due_at(date '2027-03-14', 'America/New_York', timestamptz '2027-03-14 18:05:00+00')),
      pg_temp.utc(public.edition_answer_reminder_due_at(date '2027-03-14', 'America/New_York', timestamptz '2027-03-14 18:05:00+00')),
      pg_temp.utc(public.edition_ready_due_at(date '2027-03-28', 'Europe/Paris', timestamptz '2027-03-28 17:05:00+00')),
      pg_temp.utc(public.edition_answer_reminder_due_at(date '2027-03-28', 'Europe/Paris', timestamptz '2027-03-28 17:05:00+00'))));

  perform pg_temp.record(12, 'T12 the release instant is the outbox verification time', '2026-09-14T17:05Z',
    pg_temp.utc(public.edition_notification_released_at(pg_temp.ed())));
end $$;

-- ---------------------------------------------------------------------------
-- S. edition_ready on the reader's clock (the sender's gate, the probe, health)
-- ---------------------------------------------------------------------------

do $$
declare
  v_ids uuid[] := array[pg_temp.r_paris(), pg_temp.r_chicago(), pg_temp.r_la(), pg_temp.r_shanghai()];
begin
  -- The verification instant itself. Shanghai's 19:00 (11:00Z) is long past,
  -- so it is eligible at 17:05:00Z exactly — and not a second before.
  perform pg_temp.record(104, 'S0 Shanghai is eligible at the verification instant, not before',
    'false|true',
    (select schedule.schedule_is_due::text
     from public.get_edition_ready_schedule(pg_temp.ed(), array[pg_temp.r_shanghai()], timestamptz '2026-09-14 17:04:59+00') as schedule)
    || '|' ||
    (select schedule.schedule_is_due::text
     from public.get_edition_ready_schedule(pg_temp.ed(), array[pg_temp.r_shanghai()], timestamptz '2026-09-14 17:05:00+00') as schedule));

  -- 19:10 Paris on the edition evening.
  perform pg_temp.record(13, 'S1 at 19:10 Paris: Paris and Shanghai are due, the Americas are not',
    'chicago:false,la:false,paris:true,shanghai:true',
    (select string_agg(names.short_name || ':' || schedule.schedule_is_due, ',' order by names.short_name)
     from public.get_edition_ready_schedule(pg_temp.ed(), v_ids, timestamptz '2026-09-14 17:10:00+00') as schedule
     join ltn_names as names on names.user_id = schedule.schedule_user_id));

  perform pg_temp.record(14, 'S2 at 19:00 Chicago the Chicago reader is due, Los Angeles still not',
    'chicago:true,la:false,paris:true,shanghai:true',
    (select string_agg(names.short_name || ':' || schedule.schedule_is_due, ',' order by names.short_name)
     from public.get_edition_ready_schedule(pg_temp.ed(), v_ids, timestamptz '2026-09-15 00:01:00+00') as schedule
     join ltn_names as names on names.user_id = schedule.schedule_user_id));

  perform pg_temp.record(15, 'S3 the probe wakes the sender for exactly the due readers (Paris and Shanghai at 19:10)',
    '2|0',
    (select due.edition_ready_due || '|' || due.answer_reminders_due
     from public.count_due_edition_notifications(timestamptz '2026-09-14 17:10:00+00') as due));

  perform pg_temp.record(16, 'S4 and later for New York and Chicago; Paris is past its six-hour window',
    '2|0',
    (select due.edition_ready_due || '|' || due.answer_reminders_due
     from public.count_due_edition_notifications(timestamptz '2026-09-15 00:05:00+00') as due));

  -- Health is read at the real clock (2026-09-10), before this fixture edition
  -- is due for anyone: six devices, all healthy, none "never attempted".
  perform pg_temp.record(17, 'S5 health: a reader whose 19:00 has not come is scheduled, not failed',
    'eligible=6 scheduled_not_due=6 never_attempted=0',
    (select format('eligible=%s scheduled_not_due=%s never_attempted=%s',
                   health.eligible_devices, health.scheduled_not_due, health.never_attempted)
     from public.get_edition_notification_health(pg_temp.ed()) as health));

  -- Unverified: nobody is due, and health is critical exactly as before.
  update public.notification_outbox
  set status = 'awaiting_verification', verified_at = null, processed_at = null
  where event_type = 'edition_published' and event_date = pg_temp.ed();

  perform pg_temp.record(18, 'S6 an unverified edition makes nobody due and stays critical in health',
    'due=0 scheduled_not_due=0 never_attempted=6',
    (select format('due=%s', count(*) filter (where schedule.schedule_is_due))
     from public.get_edition_ready_schedule(pg_temp.ed(), v_ids, timestamptz '2026-09-15 06:00:00+00') as schedule)
    || ' ' ||
    (select format('scheduled_not_due=%s never_attempted=%s', health.scheduled_not_due, health.never_attempted)
     from public.get_edition_notification_health(pg_temp.ed()) as health));

  update public.notification_outbox
  set status = 'processed', verified_at = timestamptz '2026-09-14 17:05:00+00', processed_at = now()
  where event_type = 'edition_published' and event_date = pg_temp.ed();
end $$;

-- ---------------------------------------------------------------------------
-- E. East of Paris: told at verification, reminded the next local morning
-- ---------------------------------------------------------------------------

do $$
declare
  v_claimed text;
begin
  -- 00:35Z is 08:35 in Shanghai on the 15th. Nobody else is due yet.
  perform pg_temp.record(106, 'E1 Shanghai is reminded at 08:30 Shanghai on the day after the edition', 'shanghai:en',
    pg_temp.claim('ltn-e1', timestamptz '2026-09-15 00:35:00+00'));

  update public.push_notification_deliveries
  set status = 'retryable_failure', claim_id = null, claim_expires_at = null
  where user_id = pg_temp.r_shanghai() and notification_kind = 'edition_answer_reminder';

  -- 03:31Z is 11:31 in Shanghai: the morning window is over. No afternoon nag.
  v_claimed := pg_temp.claim('ltn-e2', timestamptz '2026-09-15 03:31:00+00');

  perform pg_temp.record(107, 'E2 a reminder still unsent after the three-hour window is final, not retried',
    'none|terminal_failure/reminder send window elapsed',
    v_claimed || '|' || pg_temp.reminder_status(pg_temp.r_shanghai()));
end $$;

-- ---------------------------------------------------------------------------
-- R. Reminder eligibility at 07:00Z (08:30 Paris has passed; 08:30 New York
--    has not)
-- ---------------------------------------------------------------------------

do $$
declare
  v_at timestamptz := timestamptz '2026-09-15 07:00:00+00';
begin
  perform pg_temp.record(19, 'R1 an incomplete Paris reader is due at 08:30 Paris', 'due|2026-09-15T06:30Z',
    pg_temp.state(pg_temp.r_paris(), v_at) || '|' || pg_temp.due(pg_temp.r_paris()));
  perform pg_temp.record(20, 'R2 a reader who answered everything is owed nothing', 'completed',
    pg_temp.state(pg_temp.r_done(), v_at));
  perform pg_temp.record(21, 'R3 a reader with zero assigned questions is never reminded', 'no_assignments|absent',
    pg_temp.state(pg_temp.r_zero(), v_at) || '|' ||
    (select case when count(*) = 0 then 'absent' else 'present' end
     from public.edition_answer_reminder_readers(pg_temp.ed(), v_at) as reader
     where reader.reader_id = pg_temp.r_zero()));
  perform pg_temp.record(22, 'R4 notifications off in PersoNews', 'notifications_disabled',
    pg_temp.state(pg_temp.r_muted(), v_at));
  perform pg_temp.record(23, 'R5 no device can receive a push (disabled, or a raw APNs token)', 'no_active_token',
    pg_temp.state(pg_temp.r_nodevice(), v_at));
  perform pg_temp.record(24, 'R6 New York is scheduled for 08:30 New York', 'scheduled_not_due|2026-09-15T12:30Z',
    pg_temp.state(pg_temp.r_newyork(), v_at) || '|' || pg_temp.due(pg_temp.r_newyork()));
  perform pg_temp.record(25, 'R7 Team questions count as assigned questions', 'due|1',
    (select reader.reader_state || '|' || reader.assigned_questions
     from public.edition_answer_reminder_reader(pg_temp.r_team(), pg_temp.ed(), v_at) as reader));
  perform pg_temp.record(26, 'R8 an unknown zone is computed on Paris time', 'due|2026-09-15T06:30Z',
    pg_temp.state(pg_temp.r_badzone(), v_at) || '|' || pg_temp.due(pg_temp.r_badzone()));
  perform pg_temp.record(27, 'R9 a partly answered reader still owes answers', 'scheduled_not_due|2|1',
    (select reader.reader_state || '|' || reader.assigned_questions || '|' || reader.answered_questions
     from public.edition_answer_reminder_reader(pg_temp.r_chicago(), pg_temp.ed(), v_at) as reader));

  -- Travel: the traveler was due on Paris time. The app writes their new zone
  -- before the claim runs; they are now owed the reminder at 08:30 CHICAGO, and
  -- the same move pushes their 19:00 edition_ready too.
  perform pg_temp.record(28, 'R10 before travel: due on Paris time', 'due|2026-09-15T06:30Z',
    pg_temp.state(pg_temp.r_traveler(), v_at) || '|' || pg_temp.due(pg_temp.r_traveler()));

  update public.profiles set timezone = 'America/Chicago' where id = pg_temp.r_traveler();

  perform pg_temp.record(29, 'R11 after travel: the CURRENT zone decides, for both notifications',
    'scheduled_not_due|2026-09-15T13:30Z|2026-09-15T00:00Z',
    pg_temp.state(pg_temp.r_traveler(), v_at) || '|' || pg_temp.due(pg_temp.r_traveler()) || '|' ||
    (select pg_temp.utc(schedule.schedule_due_at)
     from public.get_edition_ready_schedule(pg_temp.ed(), array[pg_temp.r_traveler()], v_at) as schedule));

  perform pg_temp.record(30, 'R12 the probe sees the three readers owed a reminder right now', '3',
    (select due.answer_reminders_due::text
     from public.count_due_edition_notifications(v_at) as due));
end $$;

-- ---------------------------------------------------------------------------
-- C. Claiming, in chronological order
-- ---------------------------------------------------------------------------

do $$
declare
  v_first_device uuid;
  v_error text;
  v_claimed text;
begin
  -- 07:00Z. Paris (two devices, in French), the Team reader, the bad-zone reader.
  perform pg_temp.record(31, 'C1 the claim fans out to every live device of every due reader',
    'badzone:en,paris:fr,paris:fr,team:en',
    pg_temp.claim('ltn-c1', timestamptz '2026-09-15 07:00:00+00'));

  perform pg_temp.record(32, 'C2 a live lease is never handed to a second worker', 'none',
    pg_temp.claim('ltn-c2', timestamptz '2026-09-15 07:01:00+00'));

  perform pg_temp.mark_reminders(pg_temp.r_paris(), 'awaiting_receipt');
  perform pg_temp.mark_reminders(pg_temp.r_team(), 'sent');
  perform pg_temp.mark_reminders(pg_temp.r_badzone(), 'sent');

  perform pg_temp.record(33, 'C3 an accepted or sent reminder is never sent again', 'none',
    pg_temp.claim('ltn-c3', timestamptz '2026-09-15 07:20:00+00'));

  -- A device registered after the reminder went out does not earn a second one.
  insert into public.push_tokens (user_id, expo_push_token, platform, enabled)
  values (pg_temp.r_paris(), 'ExponentPushToken[ltn-paris-new]', 'ios', true);

  perform pg_temp.record(34, 'C4 one reminder per reader per edition, even for a new device', 'none|2',
    pg_temp.claim('ltn-c4', timestamptz '2026-09-15 07:30:00+00') || '|' || pg_temp.reminder_rows(pg_temp.r_paris()));

  -- edition_ready and the reminder for the same device and edition are two
  -- rows under two kinds of the same identity key.
  select token.id into v_first_device
  from public.push_tokens as token
  where token.expo_push_token = 'ExponentPushToken[ltn-paris-1]';

  perform public.claim_push_notification_deliveries(
    jsonb_build_array(jsonb_build_object(
      'push_token_id', v_first_device, 'user_id', pg_temp.r_paris(),
      'drop_date', to_char(pg_temp.ed(), 'YYYY-MM-DD'), 'notification_kind', 'edition_ready')),
    'ltn-edition-ready', 900);

  perform pg_temp.record(35, 'C5 edition_ready and edition_answer_reminder are distinct, independent deliveries',
    'edition_answer_reminder,edition_ready',
    (select string_agg(delivery.notification_kind, ',' order by delivery.notification_kind)
     from public.push_notification_deliveries as delivery
     where delivery.push_token_id = v_first_device and delivery.drop_date = pg_temp.ed()));

  begin
    insert into public.push_notification_deliveries (push_token_id, user_id, drop_date, notification_kind)
    values (v_first_device, pg_temp.r_paris(), pg_temp.ed(), 'edition_answer_reminder');
    v_error := 'inserted';
  exception when unique_violation then
    v_error := 'unique_violation';
  end;

  perform pg_temp.record(36, 'C6 the reminder itself cannot be duplicated', 'unique_violation', v_error);

  begin
    insert into public.push_notification_deliveries (push_token_id, user_id, drop_date, notification_kind)
    values (v_first_device, pg_temp.r_paris(), pg_temp.ed(), 'edition_answer_remider');
    v_error := 'inserted';
  exception when check_violation then
    v_error := 'check_violation';
  end;

  perform pg_temp.record(37, 'C7 a misspelt kind is refused by the CHECK', 'check_violation', v_error);

  -- 13:40Z. 08:30 Chicago has passed. New York (08:30 at 12:30Z) is mid-window,
  -- but switched notifications off this morning.
  update public.user_preferences set notifications_enabled = false where user_id = pg_temp.r_newyork();

  perform pg_temp.record(38, 'C8 Chicago is due while a question is unanswered', 'due',
    pg_temp.state(pg_temp.r_chicago(), timestamptz '2026-09-15 13:40:00+00'));

  -- Chicago answers the last question before the worker gets to them.
  perform pg_temp.answer(pg_temp.r_chicago(), pg_temp.lq_b(), timestamptz '2026-09-15 13:39:00+00');

  perform pg_temp.record(39, 'C9 answering before the claim suppresses the reminder: only the traveler is leased',
    'traveler:en|completed|0',
    pg_temp.claim('ltn-c5', timestamptz '2026-09-15 13:40:00+00') || '|' ||
    pg_temp.state(pg_temp.r_chicago(), timestamptz '2026-09-15 13:40:00+00') || '|' ||
    pg_temp.reminder_rows(pg_temp.r_chicago()));

  perform pg_temp.mark_reminders(pg_temp.r_traveler(), 'sent');
  update public.user_preferences set notifications_enabled = true where user_id = pg_temp.r_newyork();

  -- 15:35Z. 08:30 Los Angeles has passed; New York's window closed at 15:30Z.
  perform pg_temp.record(40, 'C10 Los Angeles is leased at 08:35 Los Angeles; New York is not, its window is over',
    'la:en|window_missed',
    pg_temp.claim('ltn-c6', timestamptz '2026-09-15 15:35:00+00') || '|' ||
    pg_temp.state(pg_temp.r_newyork(), timestamptz '2026-09-15 15:35:00+00'));

  -- The worker died after leasing and the row came back retryable; meanwhile
  -- the reader answered. The next claim stands it down instead of sending it.
  update public.push_notification_deliveries
  set status = 'retryable_failure', claim_id = null, claim_expires_at = null
  where user_id = pg_temp.r_la() and notification_kind = 'edition_answer_reminder';

  perform pg_temp.answer(pg_temp.r_la(), pg_temp.lq_a(), timestamptz '2026-09-15 15:38:00+00');

  -- Two statements, not one: a STABLE read in the claim's own statement would
  -- see that statement's starting snapshot, not what the claim just wrote.
  v_claimed := pg_temp.claim('ltn-c7', timestamptz '2026-09-15 15:40:00+00');

  perform pg_temp.record(41, 'C11 completion between fan-out and send cancels cleanly, never a failure',
    'none|cancelled/completed_before_send',
    v_claimed || '|' || pg_temp.reminder_status(pg_temp.r_la()));
end $$;

-- ---------------------------------------------------------------------------
-- H. Reminder health at 16:00Z — every state is a separate number
-- ---------------------------------------------------------------------------

select pg_temp.record(42, 'H1 reminder health distinguishes every outcome',
  'assigned=11 completed=2 scheduled=0 due=0 sent=3 awaiting=1 retryable=0 terminal=1 cancelled=1 not_eligible=2 closed=0 never_attempted=1 next=NULL',
  (select format(
     'assigned=%s completed=%s scheduled=%s due=%s sent=%s awaiting=%s retryable=%s terminal=%s cancelled=%s not_eligible=%s closed=%s never_attempted=%s next=%s',
     health.assigned_readers, health.completed_before_reminder, health.scheduled_not_due,
     health.due_awaiting_worker, health.sent, health.awaiting_receipt, health.retryable,
     health.terminal, health.cancelled, health.not_eligible, health.edition_closed,
     health.never_attempted, pg_temp.utc(health.next_due_at))
   from public.get_edition_answer_reminder_health(pg_temp.ed(), timestamptz '2026-09-15 16:00:00+00') as health));

-- ---------------------------------------------------------------------------
-- W. The window, and the edition closing
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.record(45, 'W3 once the next edition publishes, the old one owes nothing', 'edition_closed',
    pg_temp.state(pg_temp.r_newyork(), timestamptz '2026-09-16 18:00:00+00'));

  perform pg_temp.record(46, 'W4 readers who were never eligible have no reminder row at all', '0|0|0|0',
    concat_ws('|',
      pg_temp.reminder_rows(pg_temp.r_zero()),
      pg_temp.reminder_rows(pg_temp.r_muted()),
      pg_temp.reminder_rows(pg_temp.r_nodevice()),
      pg_temp.reminder_rows(pg_temp.r_done())));

  perform pg_temp.record(47, 'W5 at most one reminder row per device and edition, anywhere', '0',
    (select count(*)::text from (
       select delivery.push_token_id
       from public.push_notification_deliveries as delivery
       where delivery.drop_date = pg_temp.ed()
         and delivery.notification_kind = 'edition_answer_reminder'
       group by delivery.push_token_id
       having count(*) > 1) as duplicated));
end $$;

-- ---------------------------------------------------------------------------
-- P. Plumbing: privileges, the dispatcher, the schedule
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.record(48, 'P1 no client key can claim or read reminders', 'false|false|true',
    concat_ws('|',
      has_function_privilege('authenticated', 'public.claim_edition_answer_reminders(text,integer,integer,timestamptz)', 'EXECUTE')::text,
      has_function_privilege('anon', 'public.edition_answer_reminder_readers(date,timestamptz)', 'EXECUTE')::text,
      has_function_privilege('service_role', 'public.claim_edition_answer_reminders(text,integer,integer,timestamptz)', 'EXECUTE')::text));

  perform pg_temp.record(49, 'P2 the dispatcher probes reader-local work and still never sends anything itself',
    'true|true|false',
    (select concat_ws('|',
       (position('count_due_edition_notifications' in p.prosrc) > 0)::text,
       (position('edition_notifications_due' in p.prosrc) > 0)::text,
       (position('expo' in lower(p.prosrc)) > 0)::text)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'dispatch_notification_events'));

  perform pg_temp.record(50, 'P3 one dispatcher job, now every two minutes all day — not one per reader or zone',
    '*/2 * * * *|1',
    case when to_regclass('cron.job') is null then 'NO CRON SCHEMA'
      else (select coalesce(max(job.schedule), 'NOT SCHEDULED') || '|' || count(*)
            from cron.job as job
            where job.jobname like 'personews-notification%')
    end);
end $$;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from ltn_results) as checks,
  (select count(*) from ltn_results where pass) as passed,
  (select count(*) from ltn_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from ltn_results where not pass) as failures;

rollback;
