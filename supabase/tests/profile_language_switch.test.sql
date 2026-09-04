-- Reading-language switch and cross-language archive — PRODUCTION project.
--
-- Everything here runs in one transaction that ends in ROLLBACK: the throwaway
-- reader accounts, content pairs, drops and interactions created below never
-- survive the run, and no real user or content row is read or written.
--
-- The suite asserts the POST-migration contract and therefore expects
--   20260904120000_fix_update_profile_language_ambiguity
--   20260904121000_content_translation_access
-- to be applied. Against a database without them, the first block fails with
-- 42702 — which is precisely the production bug those migrations fix.
--
-- Run it (after applying the migrations):
--   npm run language:test:sql
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table language_results (
  seq int,
  test text,
  expectation text,
  observed text,
  pass boolean
);

-- The RLS probes below run under `set local role authenticated`; the temp
-- report table must stay writable for them.
grant select, insert on language_results to public;

create or replace function pg_temp.record(
  p_seq int, p_test text, p_expected text, p_observed text
) returns void
language sql as $$
  insert into language_results
  values (p_seq, p_test, p_expected, p_observed, p_expected = p_observed);
$$;

grant execute on function pg_temp.record(int, text, text, text) to public;

-- ---------------------------------------------------------------------------
-- Fixtures: two readers, two FR/EN content pairs, one unrelated FR item,
-- one EN edition per reader, one completed interaction, one learning path.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.uid_a() returns uuid
language sql immutable as $$ select 'aaaaaaaa-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.uid_b() returns uuid
language sql immutable as $$ select 'bbbbbbbb-0000-4000-8000-00000000000b'::uuid $$;

grant execute on function pg_temp.uid_a() to public;
grant execute on function pg_temp.uid_b() to public;

create or replace function pg_temp.sign_in(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
$$;

grant execute on function pg_temp.sign_in(uuid) to public;

do $$
declare
  v_user uuid;
  v_drop_a uuid;
  v_drop_b uuid;
  v_domain text;
  v_objective text;
  v_path uuid;
begin
  foreach v_user in array array[pg_temp.uid_a(), pg_temp.uid_b()] loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      'language-suite-' || v_user || '@example.test', 'x', now(), now(), now(),
      '', '', '', '', '{"provider":"email"}', '{}'
    );

    insert into public.profiles (id, email, language, timezone)
    values (v_user, 'language-suite-' || v_user || '@example.test', 'en', 'UTC');
  end loop;

  -- Pair 1: a newsletter article, keyed like a scheduled edition.
  insert into public.content_items
    (id, content_type, topic_id, language, title, body_md, publication_date, status, metadata)
  values
    ('11111111-0000-4000-8000-000000000001', 'newsletter_article', 'business', 'en',
     'Language suite article EN', 'Body EN.', '2027-02-01', 'published',
     '{"staging_job_id":"language-suite-pair-1"}'),
    ('11111111-0000-4000-8000-000000000002', 'newsletter_article', 'business', 'fr',
     'Article de la suite langue FR', 'Corps FR.', '2027-02-01', 'published',
     '{"staging_job_id":"language-suite-pair-1"}');

  -- Pair 2: a mini case, keyed like the weekly payload.
  insert into public.content_items
    (id, content_type, topic_id, language, title, body_md, publication_date, status, metadata)
  values
    ('11111111-0000-4000-8000-000000000003', 'mini_case', 'business', 'en',
     'Language suite mini case EN', 'Case EN.', '2027-02-01', 'published',
     '{"entry_key":"language-suite-pair-2"}'),
    ('11111111-0000-4000-8000-000000000004', 'mini_case', 'business', 'fr',
     'Mini cas de la suite langue FR', 'Cas FR.', '2027-02-01', 'published',
     '{"entry_key":"language-suite-pair-2"}');

  -- Published FR item whose pair is assigned to nobody in this suite: reading
  -- it must stay impossible for both readers.
  insert into public.content_items
    (id, content_type, topic_id, language, title, body_md, publication_date, status, metadata)
  values
    ('11111111-0000-4000-8000-000000000005', 'newsletter_article', 'business', 'fr',
     'Article non assigné FR', 'Corps.', '2027-02-01', 'published',
     '{"staging_job_id":"language-suite-unassigned"}');

  insert into public.daily_drops (user_id, drop_date, language, status, published_at)
  values (pg_temp.uid_a(), '2027-02-01', 'en', 'published', now())
  returning id into v_drop_a;

  insert into public.daily_drops (user_id, drop_date, language, status, published_at)
  values (pg_temp.uid_b(), '2027-02-01', 'en', 'published', now())
  returning id into v_drop_b;

  insert into public.daily_drop_items (daily_drop_id, content_item_id, slot, position)
  values
    (v_drop_a, '11111111-0000-4000-8000-000000000001', 'newsletter', 0),
    (v_drop_a, '11111111-0000-4000-8000-000000000003', 'mini_case', 0),
    (v_drop_b, '11111111-0000-4000-8000-000000000001', 'newsletter', 0);

  -- Reader A has read the newsletter article (EN row: the id their edition
  -- assigned). This single row is the state every language switch must keep.
  insert into public.content_interactions (user_id, content_item_id, interaction_type)
  values (pg_temp.uid_a(), '11111111-0000-4000-8000-000000000001', 'complete');

  -- Learning fixtures only when the catalog exists in this database.
  select ld.id, lo.id into v_domain, v_objective
  from public.learning_domains ld
  join public.learning_objectives lo on lo.domain_id = ld.id
  limit 1;

  if v_domain is not null then
    insert into public.user_learning_paths
      (user_id, domain_id, objective_id, current_level, target_level, language, status)
    values (pg_temp.uid_a(), v_domain, v_objective, 1, 3, 'en', 'active')
    returning id into v_path;

    -- A completed session is history: the switch must never rewrite it.
    insert into public.learning_sessions
      (path_id, curriculum_step_key, session_number, language, prompt_text,
       generation_status, status, opened_at, started_at, completed_at)
    values
      (v_path, 'language-suite-step-1', 1, 'en', 'Completed EN prompt',
       'ready', 'completed', now(), now(), now());

    -- A session still ahead of the reader: the switch requeues it.
    insert into public.learning_sessions
      (path_id, curriculum_step_key, session_number, language, prompt_text,
       generation_status, status)
    values
      (v_path, 'language-suite-step-2', 2, 'en', 'Pending EN prompt',
       'ready', 'available');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The switch itself: EN -> FR -> FR -> EN, invalid input, no session
-- ---------------------------------------------------------------------------
do $$
declare
  v_row record;
  v_state text;
begin
  perform pg_temp.sign_in(pg_temp.uid_a());

  select * into v_row from public.update_profile_language('fr');
  perform pg_temp.record(1, 'T1 EN -> FR returns the updated profile', 'fr', v_row.language);
  perform pg_temp.record(2, 'T2 profiles.language is persisted',
    'fr', (select profiles.language from public.profiles where profiles.id = pg_temp.uid_a()));

  -- Learning path follows, history does not.
  if exists (select 1 from public.user_learning_paths where user_id = pg_temp.uid_a()) then
    perform pg_temp.record(3, 'L1 the active learning path follows the switch',
      'fr', (select ulp.language from public.user_learning_paths ulp
             where ulp.user_id = pg_temp.uid_a() and ulp.status = 'active'));
    perform pg_temp.record(4, 'L2 a completed session is left untouched',
      'en|Completed EN prompt',
      (select ls.language || '|' || ls.prompt_text from public.learning_sessions ls
       where ls.curriculum_step_key = 'language-suite-step-1'));
    perform pg_temp.record(5, 'L3 a pending session is requeued in the new language',
      'fr|queued|',
      (select ls.language || '|' || ls.generation_status || '|' || coalesce(ls.prompt_text, '')
       from public.learning_sessions ls
       where ls.curriculum_step_key = 'language-suite-step-2'));
  else
    perform pg_temp.record(3, 'L1 the active learning path follows the switch', 'SKIPPED', 'SKIPPED');
    perform pg_temp.record(4, 'L2 a completed session is left untouched', 'SKIPPED', 'SKIPPED');
    perform pg_temp.record(5, 'L3 a pending session is requeued in the new language', 'SKIPPED', 'SKIPPED');
  end if;

  -- Selecting the same language twice is a no-op, not an error or a reset.
  select * into v_row from public.update_profile_language('fr');
  perform pg_temp.record(6, 'T3 selecting FR twice stays FR without error', 'fr', v_row.language);
  perform pg_temp.record(7, 'T4 no duplicate profile row is created',
    '1', (select count(*)::text from public.profiles where profiles.id = pg_temp.uid_a()));

  select * into v_row from public.update_profile_language('en');
  perform pg_temp.record(8, 'T5 FR -> EN returns the updated profile', 'en', v_row.language);

  begin
    perform public.update_profile_language('de');
    perform pg_temp.record(9, 'T6 an unsupported language is refused', '22023', 'no error');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_temp.record(9, 'T6 an unsupported language is refused', '22023', v_state);
  end;

  perform pg_temp.sign_in(null);
  begin
    perform public.update_profile_language('fr');
    perform pg_temp.record(10, 'T7 an unauthenticated call is refused', '28000', 'no error');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_temp.record(10, 'T7 an unauthenticated call is refused', '28000', v_state);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Stability: eight consecutive switches change nothing but the language
-- ---------------------------------------------------------------------------
do $$
declare
  v_language text;
begin
  perform pg_temp.sign_in(pg_temp.uid_a());

  foreach v_language in array array['fr','en','fr','en','fr','en','fr','en'] loop
    perform public.update_profile_language(v_language);
  end loop;

  perform pg_temp.record(11, 'S1 the last selected language wins',
    'en', (select profiles.language from public.profiles where profiles.id = pg_temp.uid_a()));
  perform pg_temp.record(12, 'S2 switching writes no interaction rows',
    '1', (select count(*)::text from public.content_interactions
          where user_id = pg_temp.uid_a()));
  perform pg_temp.record(13, 'S3 switching rewrites no edition content',
    '2', (select count(*)::text from public.daily_drop_items ddi
          join public.daily_drops dd on dd.id = ddi.daily_drop_id
          where dd.user_id = pg_temp.uid_a()));
end $$;

-- ---------------------------------------------------------------------------
-- 3. RLS: a reader sees the translations of their own archive, nothing more,
--    and interactions only ever attach to the assigned item
-- ---------------------------------------------------------------------------
set local role authenticated;

do $$
declare
  v_state text;
begin
  perform pg_temp.sign_in(pg_temp.uid_a());

  perform pg_temp.record(14, 'R1 the assigned EN item is readable',
    '1', (select count(*)::text from public.content_items
          where id = '11111111-0000-4000-8000-000000000001'));
  perform pg_temp.record(15, 'R2 its FR translation is readable',
    '1', (select count(*)::text from public.content_items
          where id = '11111111-0000-4000-8000-000000000002'));
  perform pg_temp.record(16, 'R3 an unassigned FR item stays invisible',
    '0', (select count(*)::text from public.content_items
          where id = '11111111-0000-4000-8000-000000000005'));

  -- The archive search view: one row per language, both anchored to the
  -- assigned item id.
  perform pg_temp.record(17, 'R4 the view lists the FR rendering of an EN edition',
    'Article de la suite langue FR',
    (select v.title from public.user_archive_search_items v
     where v.content_item_id = '11111111-0000-4000-8000-000000000001'
       and v.language = 'fr'));
  perform pg_temp.record(18, 'R5 the view keeps the EN rendering too',
    'Language suite article EN',
    (select v.title from public.user_archive_search_items v
     where v.content_item_id = '11111111-0000-4000-8000-000000000001'
       and v.language = 'en'));
  perform pg_temp.record(19, 'R6 view rows anchor to the assigned id per language',
    '1|1',
    (select count(*) filter (where v.language = 'fr')::text || '|' ||
            count(*) filter (where v.language = 'en')::text
     from public.user_archive_search_items v
     where v.content_item_id = '11111111-0000-4000-8000-000000000003'));

  -- Writes: the assigned id is accepted, the translation id is refused, so a
  -- language switch can never fork read/unread state across renderings.
  begin
    insert into public.content_interactions (user_id, content_item_id, interaction_type)
    values (pg_temp.uid_a(), '11111111-0000-4000-8000-000000000003', 'complete');
    perform pg_temp.record(20, 'W1 an interaction on the assigned id is accepted', 'inserted', 'inserted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_temp.record(20, 'W1 an interaction on the assigned id is accepted', 'inserted', v_state);
  end;

  begin
    insert into public.content_interactions (user_id, content_item_id, interaction_type)
    values (pg_temp.uid_a(), '11111111-0000-4000-8000-000000000002', 'complete');
    perform pg_temp.record(21, 'W2 an interaction on the translation id is refused', '42501', 'inserted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_temp.record(21, 'W2 an interaction on the translation id is refused', '42501', v_state);
  end;

  -- Account isolation: reader B sees none of reader A's interactions.
  perform pg_temp.sign_in(pg_temp.uid_b());
  perform pg_temp.record(22, 'R7 another reader sees none of these interactions',
    '0', (select count(*)::text from public.content_interactions));
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from language_results) as checks,
  (select count(*) from language_results where pass) as passed,
  (select count(*) from language_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from language_results where not pass) as failures;

rollback;
