-- Input size limits — PRODUCTION project.
--
-- Proves 20261005182000_input_length_limits: each client-writable column
-- accepts a value at its limit and refuses one past it, through the same role
-- and RLS path the app (or the anonymous web form) uses.
--
-- Run locally:
--   node scripts/local-sql-tests.mjs input-limits --with-migrations
--
-- One transaction, rolled back. The final SELECT is the report.

begin;

create temp table il_results (seq int, test text, expectation text, observed text, pass boolean);
grant all on il_results to public;

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into il_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

-- 'ok' or the SQLSTATE; the write is always undone.
create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql;
    v := 'ok';
    raise exception using errcode = 'P0U01';
  exception
    when sqlstate 'P0U01' then return v;
    when others then return sqlstate;
  end;
end $$;

grant execute on function pg_temp.record(int, text, text, text) to public;
grant execute on function pg_temp.try(text) to public;

-- A reader with an assigned mini case, to write through RLS as the app does.
select set_config('personews.allow_edition_rewrite', 'on', true);

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000','ab000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'il@example.test','x',now(),now(),now(),'','','','','{}','{}');
insert into public.profiles(id,email,language,timezone) values ('ab000000-0000-4000-8000-000000000001','il@example.test','en','Europe/Paris');

insert into public.content_items(id, content_type, topic_id, language, title, summary, body_md, difficulty,
  estimated_read_seconds, publication_date, version, status, source_count, metadata)
values ('ab100000-0000-4000-8000-000000000001', 'mini_case', 'finance', 'en', 'Case', 'Challenge.', 'Body of the case.',
  'medium', 60, '2031-07-07', 1, 'published', 1, '{"persisted_by":"test","is_test_data":true}');

insert into public.daily_drops(id, user_id, drop_date, language, status, generated_at, published_at)
values ('ab200000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', '2031-07-07', 'en', 'published', now(), now());
insert into public.daily_drop_items(daily_drop_id, content_item_id, slot, position)
values ('ab200000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'mini_case', 0);

select set_config('personews.allow_edition_rewrite', '', true);

-- ---------------------------------------------------------------------------
-- As the signed-in reader
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated","email":"il@example.test"}', true);
set local role authenticated;

select pg_temp.record(1, 'R1 a mini-case answer at the limit is accepted', 'ok',
  pg_temp.try($q$insert into public.mini_case_responses(user_id, content_item_id, answer_md)
               values ('ab000000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', repeat('a', 10000))$q$));

select pg_temp.record(2, 'R2 one character more is refused', '23514',
  pg_temp.try($q$insert into public.mini_case_responses(user_id, content_item_id, answer_md)
               values ('ab000000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', repeat('a', 10001))$q$));

select pg_temp.record(3, 'R3 an oversized selections object is refused', '23514',
  pg_temp.try($q$insert into public.mini_case_responses(user_id, content_item_id, answer_md, selections)
               values ('ab000000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'q1: a',
                       jsonb_build_object('q', repeat('x', 10001)))$q$));

select pg_temp.record(4, 'R4 a normal answer (what the app writes) is accepted', 'ok',
  pg_temp.try($q$insert into public.mini_case_responses(user_id, content_item_id, answer_md, selections)
               values ('ab000000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001',
                       E'- q1: b\n- q2: a\n- q3: c', '{"q1":"b","q2":"a","q3":"c"}')$q$));

select pg_temp.record(5, 'R5 an interaction message at 2,000 is accepted, 2,001 refused', 'ok|23514',
  pg_temp.try($q$insert into public.content_interactions(user_id, content_item_id, interaction_type, message)
               values ('ab000000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'feedback', repeat('m', 2000))$q$)
  || '|' ||
  pg_temp.try($q$insert into public.content_interactions(user_id, content_item_id, interaction_type, message)
               values ('ab000000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'feedback', repeat('m', 2001))$q$));

reset role;

-- ---------------------------------------------------------------------------
-- As an anonymous visitor (the legacy web forms)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select pg_temp.record(10, 'A1 a feedback message at 5,000 is accepted, 5,001 refused', 'ok|23514',
  pg_temp.try($q$insert into public.newsletter_feedback(email, rating, message) values ('a@example.test', 'good', repeat('f', 5000))$q$)
  || '|' ||
  pg_temp.try($q$insert into public.newsletter_feedback(email, rating, message) values ('a@example.test', 'good', repeat('f', 5001))$q$));

select pg_temp.record(11, 'A2 an absurd email is refused', '23514',
  pg_temp.try($q$insert into public.newsletter_feedback(email, rating) values (repeat('e', 321), 'good')$q$));

select pg_temp.record(12, 'A3 a megabyte signup payload is refused', '23514',
  pg_temp.try($q$insert into public.pending_registrations(email, payload)
               values ('p@example.test', jsonb_build_object('blob', repeat('p', 1000000)))$q$));

reset role;

-- ---------------------------------------------------------------------------
-- Existing rows are never what fails the migration
-- ---------------------------------------------------------------------------

select pg_temp.record(20, 'V1 every new constraint is NOT VALID (no scan of history at migration time)', '8|0',
  (select count(*) from pg_constraint where conname like any (array['%_length_check', '%_size_check'])
     and conrelid in ('public.mini_case_responses'::regclass, 'public.content_interactions'::regclass,
                      'public.newsletter_feedback'::regclass, 'public.pending_registrations'::regclass))::text
  || '|' ||
  (select count(*) from pg_constraint where conname like any (array['%_length_check', '%_size_check']) and convalidated
     and conrelid in ('public.mini_case_responses'::regclass, 'public.content_interactions'::regclass,
                      'public.newsletter_feedback'::regclass, 'public.pending_registrations'::regclass))::text);

select
  (select count(*) from il_results) as checks,
  (select count(*) from il_results where pass) as passed,
  (select count(*) from il_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from il_results where not pass) as failures;

rollback;
