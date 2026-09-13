-- Post-answer explanation — PRODUCTION project.
--
-- Proves 20260913090000_question_explanation:
--   * nothing is released before the caller's own attempt is settled;
--   * after it, get_question_explanation returns ONE row — the option chosen
--     (label, awarded score, feedback) and the best option (label, 1000,
--     feedback) — for 0, 0.3, 0.6, 1, a timeout and a skip, in FR and EN;
--   * never the two other options, never the grade table, never a rationale;
--   * get_question_feedback, kept for builds in the store, is narrowed to the
--     same two options.
--
-- One transaction ending in ROLLBACK; every reader, question and attempt below
-- is a fixture. The caller is simulated with the JWT claims auth.uid() reads.
--
-- Run locally without applying the migration:
--   node scripts/local-sql-tests.mjs question-explanation --with-migrations
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table qe_results (seq int, test text, expectation text, observed text, pass boolean);
grant all on qe_results to public;

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into qe_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

create or replace function pg_temp.sign_in(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
$$;

create or replace function pg_temp.lq() returns uuid
language sql immutable as $$ select 'f6000000-0000-4000-8000-000000000001'::uuid $$;

-- Options a (1000), b (600), c (300), d (0).
create or replace function pg_temp.opt(p_key text) returns uuid
language sql immutable as $$ select ('f7000000-0000-4000-8000-00000000000' || p_key)::uuid $$;

create temp table qe_readers (name text primary key, id uuid, language text);
grant select on qe_readers to public;

insert into qe_readers values
  ('r1000',    'f5000000-0000-4000-8000-000000000001', 'en'),
  ('r600',     'f5000000-0000-4000-8000-000000000002', 'en'),
  ('r300',     'f5000000-0000-4000-8000-000000000003', 'en'),
  ('r0',       'f5000000-0000-4000-8000-000000000004', 'en'),
  ('rexpired', 'f5000000-0000-4000-8000-000000000005', 'en'),
  ('rskipped', 'f5000000-0000-4000-8000-000000000006', 'en'),
  ('rfr',      'f5000000-0000-4000-8000-000000000007', 'fr'),
  ('rnone',    'f5000000-0000-4000-8000-000000000008', 'en'),
  ('ropen',    'f5000000-0000-4000-8000-000000000009', 'en');

create or replace function pg_temp.reader(p_name text) returns uuid
language sql stable as $$ select id from qe_readers where name = p_name $$;

-- The explanation as the named reader sees it, flattened, or the refusal.
create or replace function pg_temp.explain(p_reader text) returns text
language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.sign_in(pg_temp.reader(p_reader));

  select concat_ws('|',
           explanation.outcome,
           coalesce(explanation.selected_label, 'NULL'),
           coalesce(explanation.selected_score_milli::text, 'NULL'),
           coalesce(explanation.selected_feedback_md, 'NULL'),
           coalesce(explanation.best_label, 'NULL'),
           coalesce(explanation.best_score_milli::text, 'NULL'),
           coalesce(explanation.best_feedback_md, 'NULL'))
  into v
  from public.get_question_explanation(pg_temp.lq()) as explanation;

  return v;
exception when others then
  return 'refused:' || sqlstate;
end $$;

-- Everything the explanation returned, as one text, and how many rows.
create or replace function pg_temp.explain_raw(p_reader text) returns text
language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.sign_in(pg_temp.reader(p_reader));

  select count(*)::text || '#' || coalesce(string_agg(explanation::text, ' '), '')
  into v
  from public.get_question_explanation(pg_temp.lq()) as explanation;

  return v;
end $$;

-- What the older door returns: "option_key:score" per row, or the refusal.
create or replace function pg_temp.feedback_rows(p_reader text) returns text
language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.sign_in(pg_temp.reader(p_reader));

  select coalesce(string_agg(choice.option_key || ':' || feedback.score_milli, ',' order by choice.option_key), 'none')
  into v
  from public.get_question_feedback(pg_temp.lq()) as feedback
  join public.logical_question_options as choice on choice.id = feedback.option_id;

  return v;
exception when others then
  return 'refused:' || sqlstate;
end $$;

-- A settled (or open) attempt, written the way submit_question_answer leaves it.
create or replace function pg_temp.attempt(p_reader text, p_option text, p_score int, p_kind text)
returns void language sql as $$
  insert into public.question_attempts (
    user_id, logical_question_id, edition_date, started_at, deadline_at,
    submitted_at, selected_option_id, score_milli, status, option_order
  ) values (
    pg_temp.reader(p_reader), pg_temp.lq(), date '2026-09-14',
    case when p_kind = 'open' then now() - interval '5 seconds' else now() - interval '60 seconds' end,
    case when p_kind = 'open' then now() + interval '15 seconds' else now() - interval '40 seconds' end,
    case p_kind
      when 'answered' then now() - interval '50 seconds'
      when 'skipped' then now() - interval '45 seconds'
      when 'expired' then now() - interval '10 seconds'
    end,
    case when p_kind = 'answered' then pg_temp.opt(p_option) end,
    case when p_kind = 'open' then null else p_score end,
    case when p_kind = 'open' then 'in_progress' else 'submitted' end,
    array[pg_temp.opt('a'), pg_temp.opt('b'), pg_temp.opt('c'), pg_temp.opt('d')]
  );
$$;

grant execute on function pg_temp.record(int, text, text, text) to public;
grant execute on function pg_temp.sign_in(uuid) to public;
grant execute on function pg_temp.lq() to public;
grant execute on function pg_temp.opt(text) to public;
grant execute on function pg_temp.reader(text) to public;
grant execute on function pg_temp.explain(text) to public;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

do $$
declare
  v_reader record;
begin
  for v_reader in select * from qe_readers loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', v_reader.id, 'authenticated', 'authenticated',
      'qe-suite-' || v_reader.name || '@example.test', 'x', now(), now(), now(),
      '', '', '', '', '{"provider":"email"}', '{}'
    );

    insert into public.profiles (id, email, language, timezone)
    values (v_reader.id, 'qe-suite-' || v_reader.name || '@example.test', v_reader.language, 'Europe/Paris');
  end loop;

  insert into public.logical_questions (id, content_logical_key, content_type, question_sequence, question_role)
  values (pg_temp.lq(), 'qe-suite-question', 'newsletter_article', 1, 'interpretation');

  insert into public.logical_question_options (id, logical_question_id, option_key)
  select pg_temp.opt(k), pg_temp.lq(), k from unnest(array['a', 'b', 'c', 'd']) as k;

  insert into public.logical_question_option_locales (option_id, language, label)
  select pg_temp.opt(k), l, 'Option ' || upper(k) || ' (' || l || ')'
  from unnest(array['a', 'b', 'c', 'd']) as k
  cross join unnest(array['en', 'fr']) as l;

  insert into private.logical_question_grades (option_id, score_milli, grade_band, rationale_md) values
    (pg_temp.opt('a'), 1000, 'excellent', 'RATIONALE-SECRET-A'),
    (pg_temp.opt('b'), 600, 'good', 'RATIONALE-SECRET-B'),
    (pg_temp.opt('c'), 300, 'average', 'RATIONALE-SECRET-C'),
    (pg_temp.opt('d'), 0, 'bad', 'RATIONALE-SECRET-D');

  insert into private.logical_question_option_feedback (option_id, language, feedback_md)
  select pg_temp.opt(k), l, upper(l) || ' feedback ' || upper(k)
  from unnest(array['a', 'b', 'c', 'd']) as k
  cross join unnest(array['en', 'fr']) as l;

  perform pg_temp.attempt('r1000', 'a', 1000, 'answered');
  perform pg_temp.attempt('r600', 'b', 600, 'answered');
  perform pg_temp.attempt('r300', 'c', 300, 'answered');
  perform pg_temp.attempt('r0', 'd', 0, 'answered');
  perform pg_temp.attempt('rexpired', null, 0, 'expired');
  perform pg_temp.attempt('rskipped', null, 0, 'skipped');
  perform pg_temp.attempt('rfr', 'c', 300, 'answered');
  perform pg_temp.attempt('ropen', null, null, 'open');
end $$;

-- ---------------------------------------------------------------------------
-- P. Who may call it, and with what
-- ---------------------------------------------------------------------------

select pg_temp.record(1, 'P1 no anonymous caller; signed-in readers and the service role only',
  'false|false|true|true|true',
  concat_ws('|',
    has_function_privilege('anon', 'public.get_question_explanation(uuid)', 'EXECUTE')::text,
    has_function_privilege('anon', 'public.get_question_feedback(uuid)', 'EXECUTE')::text,
    has_function_privilege('authenticated', 'public.get_question_explanation(uuid)', 'EXECUTE')::text,
    has_function_privilege('authenticated', 'public.get_question_feedback(uuid)', 'EXECUTE')::text,
    has_function_privilege('service_role', 'public.get_question_explanation(uuid)', 'EXECUTE')::text));

select pg_temp.record(2, 'P2 its only argument is the question: no attempt id, no user id to point elsewhere',
  'p_logical_question_id uuid',
  pg_get_function_identity_arguments('public.get_question_explanation(uuid)'::regprocedure));

-- ---------------------------------------------------------------------------
-- S. Before settlement: nothing
-- ---------------------------------------------------------------------------

select pg_temp.record(10, 'S1 an open attempt gets no explanation, no best answer, no score', 'refused:42501',
  pg_temp.explain('ropen'));
select pg_temp.record(11, 'S2 nor through the older door', 'refused:42501', pg_temp.feedback_rows('ropen'));
select pg_temp.record(12, 'S3 no attempt at all: the same refusal, so it says nothing', 'refused:42501',
  pg_temp.explain('rnone'));
select pg_temp.record(13, 'S4 signed out: refused', 'refused:28000', pg_temp.explain('nobody'));

-- ---------------------------------------------------------------------------
-- A. After settlement: your answer, and the best answer
-- ---------------------------------------------------------------------------

select pg_temp.record(20, 'A1 0.3: the chosen answer, its score and why; then the 1-point answer and why',
  'answered|Option C (en)|300|EN feedback C|Option A (en)|1000|EN feedback A', pg_temp.explain('r300'));
select pg_temp.record(21, 'A2 0.6: the same shape',
  'answered|Option B (en)|600|EN feedback B|Option A (en)|1000|EN feedback A', pg_temp.explain('r600'));
select pg_temp.record(22, 'A3 0: why it fails, and the best answer',
  'answered|Option D (en)|0|EN feedback D|Option A (en)|1000|EN feedback A', pg_temp.explain('r0'));
select pg_temp.record(23, 'A4 1: the chosen answer is the best answer',
  'answered|Option A (en)|1000|EN feedback A|Option A (en)|1000|EN feedback A', pg_temp.explain('r1000'));
select pg_temp.record(24, 'A5 a timeout: zero, nothing chosen, and the best answer with its explanation',
  'expired|NULL|0|NULL|Option A (en)|1000|EN feedback A', pg_temp.explain('rexpired'));
select pg_temp.record(25, 'A6 a skip: the same, named as a skip',
  'skipped|NULL|0|NULL|Option A (en)|1000|EN feedback A', pg_temp.explain('rskipped'));
select pg_temp.record(26, 'A7 a French reader reads it in French',
  'answered|Option C (fr)|300|FR feedback C|Option A (fr)|1000|FR feedback A', pg_temp.explain('rfr'));

-- ---------------------------------------------------------------------------
-- L. And nothing more
-- ---------------------------------------------------------------------------

select pg_temp.record(30, 'L1 one row, never one per option', '1',
  split_part(pg_temp.explain_raw('r300'), '#', 1));

select pg_temp.record(31, 'L2 a 0.3 answer says nothing about the 0.6 and 0 options, and nothing of a rationale',
  'false|false|false|false|false',
  (select concat_ws('|',
     (raw like '%feedback B%')::text,
     (raw like '%feedback D%')::text,
     (raw like '%Option B%')::text,
     (raw like '%' || pg_temp.opt('b')::text || '%')::text,
     (raw like '%RATIONALE%')::text)
   from (select pg_temp.explain_raw('r300') as raw) as captured));

select pg_temp.record(32, 'L3 a timeout says nothing about any option but the best', 'false|false|false|false',
  (select concat_ws('|',
     (raw like '%feedback B%')::text,
     (raw like '%feedback C%')::text,
     (raw like '%feedback D%')::text,
     (raw like '%RATIONALE%')::text)
   from (select pg_temp.explain_raw('rexpired') as raw) as captured));

-- ---------------------------------------------------------------------------
-- N. The older door, narrowed
-- ---------------------------------------------------------------------------

select pg_temp.record(40, 'N1 get_question_feedback returns the chosen and the best option, never the grid',
  'a:1000,c:300', pg_temp.feedback_rows('r300'));
select pg_temp.record(41, 'N2 one row when the chosen option is the best', 'a:1000', pg_temp.feedback_rows('r1000'));
select pg_temp.record(42, 'N3 only the best one after a timeout', 'a:1000', pg_temp.feedback_rows('rexpired'));

-- ---------------------------------------------------------------------------
-- O. Ownership
-- ---------------------------------------------------------------------------
-- Eight readers have settled this question. A reader who has not gets none of
-- their results: the function only ever reads the caller's own attempt.

select pg_temp.record(50, 'O1 another reader cannot read someone else''s result', 'refused:42501',
  pg_temp.explain('rnone'));

-- ---------------------------------------------------------------------------
-- R. As a client really calls it
-- ---------------------------------------------------------------------------

set local role authenticated;

select pg_temp.record(60, 'R1 through the authenticated role, the owner gets their explanation', 'answered|600',
  (select split_part(v, '|', 1) || '|' || split_part(v, '|', 3) from (select pg_temp.explain('r600') as v) as x));

do $$
begin
  begin
    perform 1 from private.logical_question_grades limit 1;
    perform pg_temp.record(61, 'R2 the grade table stays unreadable to clients', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(61, 'R2 the grade table stays unreadable to clients', 'refused', 'refused');
  end;

  begin
    perform 1 from private.logical_question_option_feedback limit 1;
    perform pg_temp.record(62, 'R3 so are the explanations themselves', 'refused', 'returned');
  exception when others then
    perform pg_temp.record(62, 'R3 so are the explanations themselves', 'refused', 'refused');
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from qe_results) as checks,
  (select count(*) from qe_results where pass) as passed,
  (select count(*) from qe_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from qe_results where not pass) as failures;

rollback;
