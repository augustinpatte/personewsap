-- Late answers earn half — PRODUCTION project.
--
-- The contract for 20261006120000_late_answer_credit. One transaction ending
-- in ROLLBACK: every reader, team, edition, question and attempt below is a
-- throwaway, and the local database is unchanged afterwards.
--
-- Run it locally (the migration is inlined, nothing is applied):
--   node scripts/local-sql-tests.mjs late-answer --with-migrations
--
-- THE RULE UNDER TEST
--
--   full_credit_date := max(edition_date, local date of editions.published_at)
--   late             := local date of the answer > full_credit_date
--
-- in the reader's zone as it was when the edition published.
--
-- Section A proves the rule on fixed October instants, so the examples read
-- exactly like the product brief. Sections B–E drive the real RPCs, where now()
-- is fixed for the transaction; there, "on time" and "late" are produced by
-- publication instants and zones chosen so the outcome holds whenever the
-- suite runs (see the fixture comment).
--
-- The final SELECT is the report: `failed` must be 0.

begin;

select set_config('personews.allow_edition_rewrite', 'on', true);

create temp table late_results (seq int, test text, expectation text, observed text, pass boolean);
grant select, insert on late_results to public;

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into late_results values (p_seq, p_test, p_expected, p_observed, p_expected is not distinct from p_observed);
$$;
grant execute on function pg_temp.record(int, text, text, text) to public;

create or replace function pg_temp.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
$$;
grant execute on function pg_temp.sign_in(uuid) to public;

-- A wall-clock time in a zone, as an instant.
create or replace function pg_temp.at(p_local text, p_zone text) returns timestamptz
language sql immutable as $$ select (p_local::timestamp) at time zone p_zone $$;

-- Late, for an edition published at p_pub, answered at p_answer, in p_zone.
create or replace function pg_temp.late(p_edition date, p_pub timestamptz, p_zone text, p_answer timestamptz)
returns text language sql stable as $$ select public.is_late_answer(p_edition, p_pub, p_zone, p_answer)::text $$;

-- ---------------------------------------------------------------------------
-- A. The rule, on fixed instants
-- ---------------------------------------------------------------------------
-- The Oct 6 edition publishes at 19:00 Paris (17:00 UTC).
select pg_temp.record(1, 'A1 on-time credit: 0/300/600/1000 -> 0/300/600/1000', '0|300|600|1000',
  (select string_agg(public.answer_credit_milli(g, false)::text, '|' order by g) from unnest(array[0, 300, 600, 1000]) g));
select pg_temp.record(2, 'A2 late credit: 0/300/600/1000 -> 0/150/300/500 (0/15/30/50 pts)', '0|150|300|500',
  (select string_agg(public.answer_credit_milli(g, true)::text, '|' order by g) from unnest(array[0, 300, 600, 1000]) g));

select pg_temp.record(3, 'A3 Paris: Oct 6 edition answered Oct 6 23:30 -> full; Oct 7 08:00 -> late', 'false|true',
  pg_temp.late('2026-10-06', pg_temp.at('2026-10-06 19:00', 'Europe/Paris'), 'Europe/Paris',
               pg_temp.at('2026-10-06 23:30', 'Europe/Paris'))
  || '|' ||
  pg_temp.late('2026-10-06', pg_temp.at('2026-10-06 19:00', 'Europe/Paris'), 'Europe/Paris',
               pg_temp.at('2026-10-07 08:00', 'Europe/Paris')));

select pg_temp.record(4, 'A4 Chicago: available Oct 6 12:00 local; Oct 6 23:30 -> full; Oct 7 08:00 -> late', 'false|true',
  pg_temp.late('2026-10-06', pg_temp.at('2026-10-06 19:00', 'Europe/Paris'), 'America/Chicago',
               pg_temp.at('2026-10-06 23:30', 'America/Chicago'))
  || '|' ||
  pg_temp.late('2026-10-06', pg_temp.at('2026-10-06 19:00', 'Europe/Paris'), 'America/Chicago',
               pg_temp.at('2026-10-07 08:00', 'America/Chicago')));

select pg_temp.record(5, 'A5 Tokyo: Oct 6 edition first available Oct 7 02:00 local -> full-credit day is Oct 7',
  '2026-10-07',
  public.full_credit_date('2026-10-06', pg_temp.at('2026-10-06 19:00', 'Europe/Paris'), 'Asia/Tokyo')::text);

select pg_temp.record(6, 'A6 Tokyo: answered Oct 7 23:30 local -> FULL (was unfairly late before)', 'false',
  pg_temp.late('2026-10-06', pg_temp.at('2026-10-06 19:00', 'Europe/Paris'), 'Asia/Tokyo',
               pg_temp.at('2026-10-07 23:30', 'Asia/Tokyo')));

select pg_temp.record(7, 'A7 Tokyo: the same edition answered Oct 8 -> late', 'true',
  pg_temp.late('2026-10-06', pg_temp.at('2026-10-06 19:00', 'Europe/Paris'), 'Asia/Tokyo',
               pg_temp.at('2026-10-08 08:00', 'Asia/Tokyo')));

select pg_temp.record(8, 'A8 Kiritimati (UTC+14): available Oct 7 07:00 local; Oct 7 -> full, Oct 8 -> late', 'false|true',
  pg_temp.late('2026-10-06', pg_temp.at('2026-10-06 19:00', 'Europe/Paris'), 'Pacific/Kiritimati',
               pg_temp.at('2026-10-07 22:00', 'Pacific/Kiritimati'))
  || '|' ||
  pg_temp.late('2026-10-06', pg_temp.at('2026-10-06 19:00', 'Europe/Paris'), 'Pacific/Kiritimati',
               pg_temp.at('2026-10-08 00:30', 'Pacific/Kiritimati')));

select pg_temp.record(9, 'A9 the Sep 18 edition opened on Oct 6 is late everywhere', 'true|true|true',
  pg_temp.late('2026-09-18', pg_temp.at('2026-09-18 19:00', 'Europe/Paris'), 'Europe/Paris',
               pg_temp.at('2026-10-06 10:00', 'Europe/Paris'))
  || '|' ||
  pg_temp.late('2026-09-18', pg_temp.at('2026-09-18 19:00', 'Europe/Paris'), 'Asia/Tokyo',
               pg_temp.at('2026-10-06 10:00', 'Asia/Tokyo'))
  || '|' ||
  pg_temp.late('2026-09-18', pg_temp.at('2026-09-18 19:00', 'Europe/Paris'), 'America/Chicago',
               pg_temp.at('2026-10-06 10:00', 'America/Chicago')));

select pg_temp.record(10, 'A10 full credit never ends before the edition date (early publication, west zone)', '2026-10-06',
  public.full_credit_date('2026-10-06', pg_temp.at('2026-10-05 20:00', 'Europe/Paris'), 'Pacific/Pago_Pago')::text);
select pg_temp.record(11, 'A11 an edition with no registry row falls back to its own date', '2026-10-06',
  public.full_credit_date('2026-10-06', null, 'Asia/Tokyo')::text);
select pg_temp.record(12, 'A12 an unusable zone reads as UTC, never Paris', 'UTC|UTC|UTC|America/Chicago',
  public.reader_calendar_timezone('Not/AZone') || '|' || public.reader_calendar_timezone('CEST') || '|' ||
  public.reader_calendar_timezone(null) || '|' || public.reader_calendar_timezone('America/Chicago'));

-- What the rule is allowed to depend on: the edition registry and the zone
-- history. Never notifications, attempt opening times, or the open edition.
select pg_temp.record(13, 'A13 eligibility reads no notification, open time or current edition', 'false',
  (select bool_or(
            pg_get_functiondef(f) ~* '(push_|notification|started_at|current_edition_date|daily_drops)')::text
   from unnest(array[
     'public.answer_is_late(uuid,date,timestamptz)'::regprocedure,
     'public.is_late_answer(date,timestamptz,text,timestamptz)'::regprocedure,
     'public.full_credit_date(date,timestamptz,text)'::regprocedure,
     'public.reader_timezone_at(uuid,timestamptz)'::regprocedure
   ]) f));
select pg_temp.record(14, 'A14 availability is editions.published_at', 'true',
  (pg_get_functiondef('public.answer_is_late(uuid,date,timestamptz)'::regprocedure) ~ 'e\.published_at')::text);

-- ---------------------------------------------------------------------------
-- Fixtures for the RPCs
-- ---------------------------------------------------------------------------
-- THE OPEN EDITION O is dated Pago Pago's today and was published exactly 24
-- hours ago. In any zone, the local date of that publication is the local
-- date of now() minus one day. So:
--   Pago Pago (UTC-11):  full credit = max(O, today-1) = O = today  -> FULL
--   Kiritimati (UTC+14): its today is O+1 or O+2, its publication date is
--                        today-1 >= O, full credit = today-1      -> LATE
-- whatever the hour this suite runs.
--
-- THE PAST EDITION P is twelve days older, published at 19:00 Paris on its
-- own date: late for anyone answering now.

create or replace function pg_temp.u_ontime() returns uuid language sql immutable as $$ select '1a7e0000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.u_late() returns uuid language sql immutable as $$ select '1a7e0000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.u_moved() returns uuid language sql immutable as $$ select '1a7e0000-0000-4000-8000-00000000000c'::uuid $$;
create or replace function pg_temp.u_tied() returns uuid language sql immutable as $$ select '1a7e0000-0000-4000-8000-00000000000d'::uuid $$;
create or replace function pg_temp.u_old() returns uuid language sql immutable as $$ select '1a7e0000-0000-4000-8000-00000000000e'::uuid $$;
create or replace function pg_temp.team() returns uuid language sql immutable as $$ select '1a7e7ea3-0000-4000-8000-000000000001'::uuid $$;
grant execute on function pg_temp.u_ontime() to public;
grant execute on function pg_temp.u_late() to public;
grant execute on function pg_temp.u_moved() to public;
grant execute on function pg_temp.u_tied() to public;
grant execute on function pg_temp.u_old() to public;
grant execute on function pg_temp.team() to public;

-- q(n) has options o(n,1000) o(n,600) o(n,300) o(n,0).
create or replace function pg_temp.q(p_n int) returns uuid language sql immutable as $$
  select ('1a7e9000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.o(p_n int, p_grade int) returns uuid language sql immutable as $$
  select ('1a7e0a00-' || lpad(p_n::text, 4, '0') || '-4000-8000-' || lpad(p_grade::text, 12, '0'))::uuid $$;
grant execute on function pg_temp.q(int) to public;
grant execute on function pg_temp.o(int, int) to public;

create temp table fixture (k text primary key, d date);
grant select on fixture to public;
create or replace function pg_temp.ed(p_k text) returns date language sql stable as $$ select d from fixture where k = p_k $$;
grant execute on function pg_temp.ed(text) to public;

do $$
declare
  v_user uuid;
  v_n int;
  v_grade int;
begin
  insert into fixture values ('open', (now() at time zone 'Pacific/Pago_Pago')::date);
  insert into fixture values ('past', (now() at time zone 'Pacific/Pago_Pago')::date - 12);

  foreach v_user in array array[pg_temp.u_ontime(), pg_temp.u_late(), pg_temp.u_moved(), pg_temp.u_tied(), pg_temp.u_old()] loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new, raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      'late-suite-' || v_user || '@example.test', 'x', now(), now(), now(), '', '', '', '', '{"provider":"email"}', '{}'
    );
    insert into public.profiles (id, email, language, timezone)
    values (v_user, 'late-suite-' || v_user || '@example.test', 'en',
            case v_user
              when pg_temp.u_ontime() then 'Pacific/Pago_Pago'
              when pg_temp.u_old() then 'Europe/Paris'
              else 'Pacific/Kiritimati'
            end);
  end loop;

  delete from public.editions;
  insert into public.editions (edition_date, edition_kind, published_at) values
    (pg_temp.ed('past'), 'daily', pg_temp.at(pg_temp.ed('past')::text || ' 19:00', 'Europe/Paris')),
    (pg_temp.ed('open'), 'daily', now() - interval '24 hours');

  insert into public.content_items
    (id, content_type, topic_id, language, title, body_md, publication_date, status, metadata)
  values
    ('1a7ec000-0000-4000-8000-000000000001', 'newsletter_article', 'business', 'en',
     'Late suite article', 'Body.', '2027-03-01', 'published', '{"staging_job_id":"late-suite-job"}');

  insert into public.teams (id, owner_id, name, invite_code)
  values (pg_temp.team(), pg_temp.u_ontime(), 'Late suite', 'LATESU01');

  foreach v_user in array array[pg_temp.u_ontime(), pg_temp.u_late(), pg_temp.u_moved(), pg_temp.u_tied()] loop
    insert into public.team_members (team_id, user_id, role, eligible_from_edition, joined_at)
    values (pg_temp.team(), v_user,
            case when v_user = pg_temp.u_ontime() then 'owner' else 'member' end,
            pg_temp.ed('open') - 30, now() - interval '30 days');
  end loop;

  for v_n in 1..12 loop
    insert into public.logical_questions (id, content_logical_key, content_type, question_sequence, question_role)
    values (pg_temp.q(v_n), 'late-suite-job-' || v_n, 'newsletter_article', 1, 'interpretation');

    insert into public.logical_question_locales (logical_question_id, language, content_item_id, prompt)
    values (pg_temp.q(v_n), 'en', '1a7ec000-0000-4000-8000-000000000001', 'Question ' || v_n);

    foreach v_grade in array array[1000, 600, 300, 0] loop
      insert into public.logical_question_options (id, logical_question_id, option_key)
      values (pg_temp.o(v_n, v_grade), pg_temp.q(v_n),
              case v_grade when 1000 then 'a' when 600 then 'b' when 300 then 'c' else 'd' end);
      insert into public.logical_question_option_locales (option_id, language, label)
      values (pg_temp.o(v_n, v_grade), 'en', 'Option ' || v_grade);
      insert into private.logical_question_grades (option_id, score_milli, grade_band)
      values (pg_temp.o(v_n, v_grade), v_grade,
              case v_grade when 1000 then 'excellent' when 600 then 'good' when 300 then 'average' else 'bad' end);
    end loop;

    if v_n <= 8 then
      -- The open edition: in the Team's edition AND each player's own.
      insert into public.team_question_assignments (team_id, edition_date, logical_question_id, content_type)
      values (pg_temp.team(), pg_temp.ed('open'), pg_temp.q(v_n), 'newsletter_article');

      foreach v_user in array array[pg_temp.u_ontime(), pg_temp.u_late(), pg_temp.u_moved(), pg_temp.u_tied()] loop
        insert into public.solo_question_assignments (user_id, edition_date, logical_question_id)
        values (v_user, pg_temp.ed('open'), pg_temp.q(v_n));
      end loop;
    else
      -- The past edition, for the reader opening an old edition today.
      insert into public.solo_question_assignments (user_id, edition_date, logical_question_id)
      values (pg_temp.u_old(), pg_temp.ed('past'), pg_temp.q(v_n));
    end if;
  end loop;
end $$;

select pg_temp.record(20, 'A20 the fixture zones land as designed: Pago on time, Kiritimati late', 'false|true',
  public.answer_is_late(pg_temp.u_ontime(), pg_temp.ed('open'), now())::text || '|' ||
  public.answer_is_late(pg_temp.u_late(), pg_temp.ed('open'), now())::text);

-- ---------------------------------------------------------------------------
-- B. Settlement, as the reader (RLS and privileges really applied)
-- ---------------------------------------------------------------------------
set local role authenticated;

do $$
declare
  v_attempt uuid;
  v_row record;
  v_preview boolean;
begin
  -- Within the full-credit day: full credit, every grade.
  perform pg_temp.sign_in(pg_temp.u_ontime());

  select s.late_if_submitted_now into v_preview from public.start_question_attempt(pg_temp.q(1)) s;
  perform pg_temp.record(30, 'B1 the preview says an answer now is on time', 'false', v_preview::text);

  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(1)) s;
  select * into v_row from public.submit_question_answer(v_attempt, pg_temp.o(1, 1000));
  perform pg_temp.record(31, 'B2 full-credit day, best answer: grade 1000, not late, earns 1000', '1000|false|1000|excellent',
    v_row.score_milli || '|' || v_row.late_answer || '|' || v_row.earned_milli || '|' || v_row.grade_band);

  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(2)) s;
  select * into v_row from public.submit_question_answer(v_attempt, pg_temp.o(2, 600));
  perform pg_temp.record(32, 'B3 on time, good answer earns 600 (60 pts)', '600|false', v_row.earned_milli || '|' || v_row.late_answer);

  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(3)) s;
  select * into v_row from public.submit_question_answer(v_attempt, pg_temp.o(3, 300));
  perform pg_temp.record(33, 'B4 on time, partial answer earns 300 (30 pts)', '300|false', v_row.earned_milli || '|' || v_row.late_answer);

  -- After the full-credit day: half credit, every grade, decided by the server.
  perform pg_temp.sign_in(pg_temp.u_late());

  select s.late_if_submitted_now into v_preview from public.start_question_attempt(pg_temp.q(1)) s;
  perform pg_temp.record(40, 'B5 the preview says an answer now is late', 'true', v_preview::text);

  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(1)) s;
  select * into v_row from public.submit_question_answer(v_attempt, pg_temp.o(1, 1000));
  perform pg_temp.record(41, 'B6 after the full-credit day: grade 1000 kept, late, earns 500', '1000|true|500|excellent',
    v_row.score_milli || '|' || v_row.late_answer || '|' || v_row.earned_milli || '|' || v_row.grade_band);

  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(2)) s;
  select * into v_row from public.submit_question_answer(v_attempt, pg_temp.o(2, 600));
  perform pg_temp.record(42, 'B7 late good answer earns 300 (30 pts)', '300', v_row.earned_milli::text);

  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(3)) s;
  select * into v_row from public.submit_question_answer(v_attempt, pg_temp.o(3, 300));
  perform pg_temp.record(43, 'B8 late partial answer earns 150 (15 pts)', '150', v_row.earned_milli::text);

  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(4)) s;
  select * into v_row from public.submit_question_answer(v_attempt, pg_temp.o(4, 0));
  perform pg_temp.record(44, 'B9 late miss earns 0', '0', v_row.earned_milli::text);

  perform pg_temp.record(45, 'B10 the stored attempt agrees: grade, flag, generated earned', '1000|true|500',
    (select a.score_milli || '|' || a.late_answer || '|' || a.earned_milli
     from public.question_attempts a where a.user_id = pg_temp.u_late() and a.logical_question_id = pg_temp.q(1)));

  select * into v_row from public.start_question_attempt(pg_temp.q(1));
  perform pg_temp.record(46, 'B11 a reopened late answer: excellent, late, 500, no preview', 'true|excellent|true|500|',
    v_row.already_submitted || '|' || v_row.grade_band || '|' || v_row.late_answer || '|' || v_row.earned_milli
    || '|' || coalesce(v_row.late_if_submitted_now::text, ''));

  -- Retry / idempotency: a second submit is refused and awards nothing twice.
  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(1)) s;
  begin
    perform * from public.submit_question_answer(v_attempt, pg_temp.o(1, 1000));
    perform pg_temp.record(47, 'B12 a retried submit is refused', 'refused', 'accepted');
  exception when unique_violation then
    perform pg_temp.record(47, 'B12 a retried submit is refused', 'refused', 'refused');
  end;

  perform pg_temp.record(48, 'B13 the retry wrote no second ledger row and changed no total', '1|500',
    (select count(*)::text || '|' || sum(s.score_milli)::text from public.team_question_scores s
     where s.user_id = pg_temp.u_late() and s.logical_question_id = pg_temp.q(1)));

  -- An old edition opened today: late, and opening it again changes nothing.
  perform pg_temp.sign_in(pg_temp.u_old());

  select s.late_if_submitted_now into v_preview from public.start_question_attempt(pg_temp.q(9)) s;
  perform pg_temp.record(50, 'B14 an old edition opened today is late', 'true', v_preview::text);
  select s.late_if_submitted_now into v_preview from public.start_question_attempt(pg_temp.q(9)) s;
  perform pg_temp.record(51, 'B15 reopening it does not reset its full-credit day', 'true', v_preview::text);
  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(9)) s;
  select * into v_row from public.submit_question_answer(v_attempt, pg_temp.o(9, 1000));
  perform pg_temp.record(52, 'B16 ...and it settles late, earning 500 (50 pts)', 'true|500',
    v_row.late_answer || '|' || v_row.earned_milli);
end $$;

-- Opened ON its full-credit day (the attempt below is started at 20:00 Paris
-- on the past edition's own date), answered now: the instant that counts is
-- the answer, not the opening. Planted as the owner, because a client cannot
-- choose its own started_at.
reset role;
insert into public.question_attempts (user_id, logical_question_id, edition_date, started_at, deadline_at, option_order)
values (pg_temp.u_old(), pg_temp.q(10), pg_temp.ed('past'),
        pg_temp.at(pg_temp.ed('past')::text || ' 20:00', 'Europe/Paris'),
        now() + interval '1 hour',
        array[pg_temp.o(10, 1000), pg_temp.o(10, 600), pg_temp.o(10, 300), pg_temp.o(10, 0)]);

-- A zone changed AFTER publication: Kiritimati when the open edition
-- published, Pago Pago now. Under the reader's current zone this answer would
-- be on time; it is judged in the zone that applied when it published.
update public.profiles set timezone = 'Pacific/Pago_Pago' where id = pg_temp.u_moved();
select pg_temp.record(53, 'B17 under the new zone alone the answer would have been on time', 'false',
  public.is_late_answer(pg_temp.ed('open'), now() - interval '24 hours', 'Pacific/Pago_Pago', now())::text);
select pg_temp.record(54, 'B18 the zone change is recorded with its instant', 'Pacific/Kiritimati|Pacific/Pago_Pago',
  public.reader_timezone_at(pg_temp.u_moved(), now() - interval '24 hours') || '|' ||
  public.reader_timezone_at(pg_temp.u_moved(), now()));
update public.profiles set timezone = 'Pacific/Kiritimati' where id = pg_temp.u_tied();
set local role authenticated;

do $$
declare
  v_attempt uuid;
  v_row record;
begin
  perform pg_temp.sign_in(pg_temp.u_old());
  select a.id into v_attempt from public.question_attempts a
  where a.user_id = pg_temp.u_old() and a.logical_question_id = pg_temp.q(10);
  select * into v_row from public.submit_question_answer(v_attempt, pg_temp.o(10, 1000));
  perform pg_temp.record(55, 'B19 opened on the full-credit day, answered after it: late, 500', 'true|500',
    v_row.late_answer || '|' || v_row.earned_milli);

  perform pg_temp.sign_in(pg_temp.u_moved());
  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(5)) s;
  select * into v_row from public.submit_question_answer(v_attempt, pg_temp.o(5, 1000));
  perform pg_temp.record(56, 'B20 moving zones after publication buys no full credit: late, 500', 'true|500',
    v_row.late_answer || '|' || v_row.earned_milli);

  -- A client cannot talk its way out of the rule. There is no score, date or
  -- zone parameter to send…
  begin
    perform * from public.submit_question_answer(v_attempt, pg_temp.o(5, 1000), 1000);
    perform pg_temp.record(57, 'B21 there is no parameter through which to claim a score', 'refused', 'accepted');
  exception when others then
    perform pg_temp.record(57, 'B21 there is no parameter through which to claim a score', 'refused', 'refused');
  end;

  -- …no write path to the flag, the ledger or the zone history…
  begin
    update public.question_attempts set late_answer = false where id = v_attempt;
    perform pg_temp.record(58, 'B22 a reader cannot clear their own late flag', 'refused', 'updated');
  exception when others then
    perform pg_temp.record(58, 'B22 a reader cannot clear their own late flag', 'refused', 'refused');
  end;

  begin
    update public.team_question_scores set score_milli = 1000 where user_id = pg_temp.u_moved();
    perform pg_temp.record(59, 'B23 a reader cannot rewrite their Team ledger row', 'refused', 'updated');
  exception when others then
    perform pg_temp.record(59, 'B23 a reader cannot rewrite their Team ledger row', 'refused', 'refused');
  end;

  begin
    insert into public.profile_timezone_history (user_id, valid_from, timezone)
    values (pg_temp.u_moved(), '-infinity', 'Pacific/Pago_Pago');
    perform pg_temp.record(60, 'B24 a reader cannot rewrite their zone history', 'refused', 'inserted');
  exception when others then
    perform pg_temp.record(60, 'B24 a reader cannot rewrite their zone history', 'refused', 'refused');
  end;

  -- …and no way to call the rule's own helpers.
  begin
    perform public.answer_is_late(pg_temp.u_moved(), pg_temp.ed('open'), now());
    perform pg_temp.record(61, 'B25 the rule helpers are not callable by a client', 'refused', 'called');
  exception when insufficient_privilege then
    perform pg_temp.record(61, 'B25 the rule helpers are not callable by a client', 'refused', 'refused');
  end;

  -- The tie partner: Kiritimati throughout, one late best answer.
  perform pg_temp.sign_in(pg_temp.u_tied());
  select s.attempt_id into v_attempt from public.start_question_attempt(pg_temp.q(6)) s;
  perform * from public.submit_question_answer(v_attempt, pg_temp.o(6, 1000));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- C. Teams: the ledger, the aggregate and the leaderboard count what was earned
-- ---------------------------------------------------------------------------
select pg_temp.record(70, 'C1 the late ledger rows carry the halved values and the flag', '0|150|300|500;true',
  (select string_agg(s.score_milli::text, '|' order by s.score_milli) || ';' || bool_and(s.late_answer)::text
   from public.team_question_scores s where s.user_id = pg_temp.u_late()));
select pg_temp.record(71, 'C2 the on-time ledger rows carry full values, unflagged', '300|600|1000;false',
  (select string_agg(s.score_milli::text, '|' order by s.score_milli) || ';' || bool_or(s.late_answer)::text
   from public.team_question_scores s where s.user_id = pg_temp.u_ontime()));
select pg_temp.record(72, 'C3 member aggregates: on time 1900 (190 pts), late 950 (95 pts)', '1900|950',
  (select s.score_milli::text from public.team_member_edition_scores s
   where s.user_id = pg_temp.u_ontime() and s.team_id = pg_temp.team())
  || '|' ||
  (select s.score_milli::text from public.team_member_edition_scores s
   where s.user_id = pg_temp.u_late() and s.team_id = pg_temp.team()));

set local role authenticated;
do $$
declare
  v_board text;
begin
  perform pg_temp.sign_in(pg_temp.u_ontime());
  select string_agg(
           case b.user_id
             when pg_temp.u_ontime() then 'ontime'
             when pg_temp.u_late() then 'late'
             when pg_temp.u_moved() then 'moved'
             when pg_temp.u_tied() then 'tied'
           end || ':' || b.rank || ':' || b.score_milli,
           ',' order by b.rank, b.score_milli desc,
             case b.user_id when pg_temp.u_moved() then 1 when pg_temp.u_tied() then 2 else 0 end)
    into v_board
  from public.get_team_leaderboard(pg_temp.team(), 'edition', pg_temp.ed('open')) b;

  perform pg_temp.record(73, 'C4 ranking by earned value, ties share a rank (1, 2, 3, 3)',
    'ontime:1:1900,late:2:950,moved:3:500,tied:3:500', v_board);
end $$;
reset role;

select pg_temp.record(74, 'C5 the order is the same in points (milli/10): scaling never reorders', 'true',
  (select (array_agg(s.user_id order by s.score_milli desc, s.user_id)
           = array_agg(s.user_id order by (s.score_milli / 10) desc, s.user_id))::text
   from public.team_member_edition_scores s where s.team_id = pg_temp.team()));

-- ---------------------------------------------------------------------------
-- D. Historical data: nothing is penalised, nothing is rescaled
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.question_attempts
    (user_id, logical_question_id, edition_date, started_at, deadline_at, option_order,
     status, submitted_at, selected_option_id, score_milli)
  values
    (pg_temp.u_ontime(), pg_temp.q(8), pg_temp.ed('open') - 20, now() - interval '20 days',
     now() - interval '20 days' + interval '20 seconds', array[pg_temp.o(8, 1000)],
     'submitted', now() - interval '20 days' + interval '5 seconds', pg_temp.o(8, 1000), 1000);

  perform pg_temp.record(80, 'D1 a historical full-credit answer is not late and still earns 1000 (100 pts)', 'false|1000|100',
    (select a.late_answer || '|' || a.earned_milli || '|' || (a.earned_milli / 10)
     from public.question_attempts a where a.user_id = pg_temp.u_ontime() and a.logical_question_id = pg_temp.q(8)));

  begin
    insert into public.team_question_scores (team_id, user_id, logical_question_id, edition_date, attempt_id, score_milli)
    select pg_temp.team(), pg_temp.u_ontime(), pg_temp.q(8), pg_temp.ed('open') - 20, a.id, 500
    from public.question_attempts a where a.user_id = pg_temp.u_ontime() and a.logical_question_id = pg_temp.q(8);
    perform pg_temp.record(81, 'D2 an unflagged 500 is refused by the ledger', 'refused', 'inserted');
  exception when check_violation then
    perform pg_temp.record(81, 'D2 an unflagged 500 is refused by the ledger', 'refused', 'refused');
  end;

  insert into public.team_question_scores (team_id, user_id, logical_question_id, edition_date, attempt_id, score_milli)
  select pg_temp.team(), pg_temp.u_ontime(), pg_temp.q(8), pg_temp.ed('open') - 20, a.id, 1000
  from public.question_attempts a where a.user_id = pg_temp.u_ontime() and a.logical_question_id = pg_temp.q(8);
  perform pg_temp.record(82, 'D3 a historical full ledger row is still valid, unflagged', 'false|1000',
    (select s.late_answer || '|' || s.score_milli from public.team_question_scores s
     where s.user_id = pg_temp.u_ontime() and s.logical_question_id = pg_temp.q(8)));

  perform pg_temp.record(83, 'D4 every profile has a zone history row', '0',
    (select count(*)::text from public.profiles p
     where not exists (select 1 from public.profile_timezone_history h where h.user_id = p.id)));
end $$;

-- E. Replaying the migration a second time, on top of the data above, is
-- harmless. The harness substitutes the migration file for the marker below.
-- replay-migration: supabase/migrations/20261006120000_late_answer_credit.sql
select pg_temp.record(90, 'E1 after a replay the attempt values are unchanged', '1000|true|500',
  (select a.score_milli || '|' || a.late_answer || '|' || a.earned_milli
   from public.question_attempts a where a.user_id = pg_temp.u_late() and a.logical_question_id = pg_temp.q(1)));
select pg_temp.record(91, 'E2 one generated earned column, one constraint, history intact', '1|1|2',
  (select count(*)::text from information_schema.columns
   where table_schema = 'public' and table_name = 'question_attempts' and column_name = 'earned_milli')
  || '|' ||
  (select count(*)::text from pg_constraint where conname = 'team_question_scores_score_check')
  || '|' ||
  (select count(*)::text from public.profile_timezone_history h where h.user_id = pg_temp.u_moved()));
select pg_temp.record(92, 'E3 after a replay the moved reader is still judged in the publication zone', 'true',
  public.answer_is_late(pg_temp.u_moved(), pg_temp.ed('open'), now())::text);

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from late_results) as checks,
  (select count(*) from late_results where pass) as passed,
  (select count(*) from late_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from late_results where not pass) as failures;

rollback;
