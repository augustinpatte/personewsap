-- Fixture for rls_initplan_parity.test.sql. Not a migration.
--
-- Runs BEFORE 20261005180000 inside the suite's rolled-back transaction: it
-- snapshots every policy and records what two readers and an anonymous caller
-- can see and do, so the test can ask the same questions after the rewrite.

create temp table rls_before as
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage', 'realtime');

grant all on rls_before to public;

-- Two readers with a little of everything a hot policy guards.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated','authenticated', u.email, 'x',
       now(),now(),now(),'','','','','{}','{}'
from (values ('aa000000-0000-4000-8000-00000000000a'::uuid, 'rls-a@example.test'),
             ('aa000000-0000-4000-8000-00000000000b'::uuid, 'rls-b@example.test')) u(id, email);

insert into public.profiles(id, email, language, timezone)
values ('aa000000-0000-4000-8000-00000000000a', 'rls-a@example.test', 'fr', 'Europe/Paris'),
       ('aa000000-0000-4000-8000-00000000000b', 'rls-b@example.test', 'en', 'Europe/Paris');

insert into public.user_preferences(user_id, learning_path_choice_completed)
values ('aa000000-0000-4000-8000-00000000000a', true), ('aa000000-0000-4000-8000-00000000000b', true);

insert into public.user_topic_preferences(user_id, topic_id, articles_count, enabled, position)
values ('aa000000-0000-4000-8000-00000000000a', 'law', 1, true, 1),
       ('aa000000-0000-4000-8000-00000000000b', 'law', 1, true, 1);

insert into public.push_tokens(user_id, expo_push_token, platform)
values ('aa000000-0000-4000-8000-00000000000a', 'ExponentPushToken[rls-a]', 'ios'),
       ('aa000000-0000-4000-8000-00000000000b', 'ExponentPushToken[rls-b]', 'ios');

select set_config('personews.allow_edition_rewrite', 'on', true);
insert into public.daily_drops(user_id, drop_date, language, status, generated_at, published_at)
values ('aa000000-0000-4000-8000-00000000000a', '2031-06-02', 'fr', 'published', now(), now()),
       ('aa000000-0000-4000-8000-00000000000b', '2031-06-02', 'en', 'published', now(), now()),
       ('aa000000-0000-4000-8000-00000000000a', '2031-06-04', 'fr', 'generated', now(), null);
select set_config('personews.allow_edition_rewrite', '', true);

-- What a caller can see and do, as one string. Every write is attempted in a
-- subtransaction and undone, so the probe changes nothing.
create or replace function pg_temp.rls_probe(p_role text, p_user uuid) returns text
language plpgsql as $$
declare
  v_out text := '';
  v_n bigint;
  v_try text;
  v_other uuid := case when p_user = 'aa000000-0000-4000-8000-00000000000a'
                       then 'aa000000-0000-4000-8000-00000000000b'::uuid
                       else 'aa000000-0000-4000-8000-00000000000a'::uuid end;
  v_tables text[] := array['profiles','user_preferences','user_topic_preferences','push_tokens','daily_drops',
                           'content_interactions','mini_case_responses','user_mini_case_topic_preferences'];
  v_table text;
  v_statement text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '{"role":"anon"}'
         else json_build_object('sub', p_user, 'role', p_role, 'email',
                case p_user when 'aa000000-0000-4000-8000-00000000000a' then 'rls-a@example.test' else 'rls-b@example.test' end)::text end,
    true);
  execute format('set local role %I', p_role);

  foreach v_table in array v_tables loop
    begin
      execute format('select count(*) from public.%I where %s', v_table,
        case v_table when 'profiles' then 'id' else 'user_id' end || ' in (''aa000000-0000-4000-8000-00000000000a'',''aa000000-0000-4000-8000-00000000000b'')')
        into v_n;
      v_out := v_out || v_table || ':see=' || v_n || ';';
    exception when others then
      v_out := v_out || v_table || ':see=' || sqlstate || ';';
    end;
  end loop;

  foreach v_statement in array array[
    format('update public.user_preferences set newsletter_article_count = 5 where user_id = %L', v_other),
    format('update public.user_preferences set newsletter_article_count = 5 where user_id = %L', coalesce(p_user, v_other)),
    format('delete from public.push_tokens where user_id = %L', v_other),
    format('delete from public.push_tokens where user_id = %L', coalesce(p_user, v_other)),
    format('insert into public.user_topic_preferences(user_id, topic_id, articles_count) values (%L, ''finance'', 1)', v_other),
    format('insert into public.user_topic_preferences(user_id, topic_id, articles_count) values (%L, ''finance'', 1)', coalesce(p_user, v_other)),
    format('update public.profiles set timezone = ''Asia/Tokyo'' where id = %L', v_other)
  ] loop
    begin
      begin
        execute v_statement;
        get diagnostics v_n = row_count;
        v_try := 'ok:' || v_n;
        raise exception using errcode = 'P0U01';
      exception
        when sqlstate 'P0U01' then null;
        when others then v_try := sqlstate;
      end;
    end;
    v_out := v_out || left(v_statement, 12) || '=' || v_try || ';';
  end loop;

  reset role;
  return v_out;
end $$;

grant execute on function pg_temp.rls_probe(text, uuid) to public;

create temp table rls_probe_before as
select 'reader-a' as who, pg_temp.rls_probe('authenticated', 'aa000000-0000-4000-8000-00000000000a') as outcome
union all
select 'reader-b', pg_temp.rls_probe('authenticated', 'aa000000-0000-4000-8000-00000000000b')
union all
select 'anon', pg_temp.rls_probe('anon', null);

grant all on rls_probe_before to public;
