-- PersoNewsAP Supabase schema/RLS doctor.
-- Run in the Supabase SQL editor or with psql against a local/disposable project.
-- This file is read-only: it only SELECTs catalog and app data.

with expected_tables(table_name) as (
  values
    ('profiles'),
    ('user_preferences'),
    ('user_topic_preferences'),
    ('topics'),
    ('content_items'),
    ('sources'),
    ('daily_drops'),
    ('daily_drop_items'),
    ('content_interactions'),
    ('generation_runs'),
    ('job_runs'),
    ('push_tokens')
)
select
  'required table exists' as check_name,
  expected_tables.table_name,
  case when tables.table_name is null then 'FAIL' else 'PASS' end as status
from expected_tables
left join information_schema.tables tables
  on tables.table_schema = 'public'
 and tables.table_name = expected_tables.table_name
order by expected_tables.table_name;

with expected_topics(id) as (
  values
    ('business'),
    ('finance'),
    ('tech_ai'),
    ('law'),
    ('medicine'),
    ('engineering'),
    ('sport_business'),
    ('culture_media')
)
select
  'topic seeded and active' as check_name,
  expected_topics.id as topic_id,
  case when topics.id is null then 'FAIL' else 'PASS' end as status
from expected_topics
left join public.topics topics
  on topics.id = expected_topics.id
 and topics.active = true
order by expected_topics.id;

with expected_rls(table_name) as (
  values
    ('profiles'),
    ('user_preferences'),
    ('user_topic_preferences'),
    ('user_mini_case_topic_preferences'),
    ('topics'),
    ('content_items'),
    ('sources'),
    ('content_item_sources'),
    ('daily_drops'),
    ('daily_drop_items'),
    ('content_interactions'),
    ('mini_case_responses'),
    ('generation_runs'),
    ('job_runs'),
    ('push_tokens'),
    ('pending_registrations'),
    ('newsletter_feedback')
)
select
  'RLS enabled' as check_name,
  expected_rls.table_name,
  case when pg_class.relrowsecurity then 'PASS' else 'FAIL' end as status
from expected_rls
join pg_class on pg_class.relname = expected_rls.table_name
join pg_namespace on pg_namespace.oid = pg_class.relnamespace
where pg_namespace.nspname = 'public'
order by expected_rls.table_name;

with expected_policies(table_name, policy_name) as (
  values
    ('profiles', 'Users can insert their own mobile profile'),
    ('profiles', 'Users can read their own mobile profile'),
    ('profiles', 'Users can update their own mobile profile'),
    ('user_preferences', 'Users can insert their own preferences'),
    ('user_preferences', 'Users can read their own preferences'),
    ('user_preferences', 'Users can update their own preferences'),
    ('topics', 'Anyone can read active topics'),
    ('user_topic_preferences', 'Users can insert their own topic preferences'),
    ('user_topic_preferences', 'Users can read their own topic preferences'),
    ('user_topic_preferences', 'Users can update their own topic preferences'),
    ('user_topic_preferences', 'Users can delete their own topic preferences'),
    ('content_items', 'Users can read assigned published content'),
    ('sources', 'Users can read sources for assigned content'),
    ('content_item_sources', 'Users can read source links for assigned content'),
    ('daily_drops', 'Users can read their own published daily drops'),
    ('daily_drop_items', 'Users can read items for their own published daily drops'),
    ('content_interactions', 'Users can read own interactions for assigned content'),
    ('content_interactions', 'Users can insert own interactions for assigned content'),
    ('mini_case_responses', 'Users can read own mini-case responses for assigned content'),
    ('mini_case_responses', 'Users can insert own mini-case responses for assigned content'),
    ('mini_case_responses', 'Users can update own mini-case responses for assigned content'),
    ('pending_registrations', 'Users can update their pending registration'),
    ('push_tokens', 'Users can read their own push tokens'),
    ('push_tokens', 'Users can insert their own push tokens'),
    ('push_tokens', 'Users can update their own push tokens'),
    ('push_tokens', 'Users can delete their own push tokens')
)
select
  'expected policy exists' as check_name,
  expected_policies.table_name,
  expected_policies.policy_name,
  case when pg_policies.policyname is null then 'FAIL' else 'PASS' end as status
from expected_policies
left join pg_policies
  on pg_policies.schemaname = 'public'
 and pg_policies.tablename = expected_policies.table_name
 and pg_policies.policyname = expected_policies.policy_name
order by expected_policies.table_name, expected_policies.policy_name;

with removed_policies(table_name, policy_name) as (
  values
    ('content_items', 'Authenticated users can read published content'),
    ('sources', 'Authenticated users can read sources for published content'),
    ('content_item_sources', 'Authenticated users can read source links for published content'),
    ('content_interactions', 'Users can read their own interactions'),
    ('content_interactions', 'Users can insert their own interactions'),
    ('mini_case_responses', 'Users can read their own mini-case responses'),
    ('mini_case_responses', 'Users can insert their own mini-case responses'),
    ('mini_case_responses', 'Users can update their own mini-case responses'),
    ('pending_registrations', 'Anyone can update pending registrations')
)
select
  'removed broad policy absent' as check_name,
  removed_policies.table_name,
  removed_policies.policy_name,
  case when pg_policies.policyname is null then 'PASS' else 'FAIL' end as status
from removed_policies
left join pg_policies
  on pg_policies.schemaname = 'public'
 and pg_policies.tablename = removed_policies.table_name
 and pg_policies.policyname = removed_policies.policy_name
order by removed_policies.table_name, removed_policies.policy_name;

select
  'push token uniqueness exists' as check_name,
  case when constraints.constraint_name is null then 'FAIL' else 'PASS' end as status
from (select 'push_tokens_user_id_expo_push_token_key'::text as constraint_name) expected
left join information_schema.table_constraints constraints
  on constraints.table_schema = 'public'
 and constraints.table_name = 'push_tokens'
 and constraints.constraint_name = expected.constraint_name;

select
  'mini-case topic preference column exists' as check_name,
  case when columns.column_name is null then 'FAIL' else 'PASS' end as status
from (select 'mini_case_topic_id'::text as column_name) expected
left join information_schema.columns columns
  on columns.table_schema = 'public'
 and columns.table_name = 'user_preferences'
 and columns.column_name = expected.column_name;

with expected_functions(function_name) as (
  values
    ('public_archive_enabled'),
    ('user_has_assigned_content'),
    ('user_has_assigned_source'),
    ('published_content_has_source'),
    ('is_published_content')
)
select
  'RLS helper function exists' as check_name,
  expected_functions.function_name,
  case when pg_proc.oid is null then 'FAIL' else 'PASS' end as status
from expected_functions
left join pg_proc
  on pg_proc.proname = expected_functions.function_name
left join pg_namespace
  on pg_namespace.oid = pg_proc.pronamespace
 and pg_namespace.nspname = 'public'
order by expected_functions.function_name;

select
  'published content available for assigned-read test' as check_name,
  count(*) as published_content_items
from public.content_items
where status = 'published';

select
  'published/read/archive daily drops available for app-read test' as check_name,
  count(*) as visible_status_daily_drops
from public.daily_drops
where status in ('published', 'read', 'archived');

-- ---------------------------------------------------------------------------
-- Storage and realtime policies the app depends on
-- ---------------------------------------------------------------------------

with expected(schema_name, table_name, policy_name) as (
  values
    ('storage', 'objects', 'Readers upload their own avatar'),
    ('storage', 'objects', 'Readers replace their own avatar'),
    ('storage', 'objects', 'Readers delete their own avatar'),
    ('storage', 'objects', 'Team mates can read an avatar'),
    ('storage', 'objects', 'Owners upload a team avatar'),
    ('storage', 'objects', 'Owners replace a team avatar'),
    ('storage', 'objects', 'Owners delete a team avatar'),
    ('storage', 'objects', 'Team members can read a team avatar'),
    ('realtime', 'messages', 'Team members can receive leaderboard broadcasts')
)
select
  'storage / realtime policy exists' as check_name,
  expected.schema_name || '.' || expected.table_name as table_name,
  expected.policy_name,
  case when pg_policies.policyname is null then 'FAIL' else 'PASS' end as status
from expected
left join pg_policies
  on pg_policies.schemaname = expected.schema_name
 and pg_policies.tablename = expected.table_name
 and pg_policies.policyname = expected.policy_name
order by 2, 3;

-- ---------------------------------------------------------------------------
-- RLS evaluates auth.uid() once per statement (20261005180000)
-- ---------------------------------------------------------------------------

select
  'no policy calls auth.uid() per row' as check_name,
  count(*) as policies_with_bare_auth_uid,
  case when count(*) = 0 then 'PASS' else 'WARN' end as status
from pg_policies
where schemaname in ('public', 'storage', 'realtime')
  and replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '') ~ 'auth\.uid\(\)';

-- ---------------------------------------------------------------------------
-- Content identity: one published row per (logical key, language, type)
-- ---------------------------------------------------------------------------
-- Not enforced by an index (catalog publishing can legitimately produce a
-- second version); watched here. Details: content_logical_key_duplicates.sql.

select
  'published logical-key duplicates' as check_name,
  count(*) as duplicated_identities,
  case when count(*) = 0 then 'PASS' else 'WARN' end as status
from (
  select 1
  from public.content_items ci
  where ci.status = 'published'
    and public.content_logical_key(ci.metadata) is not null
  group by public.content_logical_key(ci.metadata), ci.language, ci.content_type
  having count(*) > 1
) duplicates;

-- A Team assignment names a logical key; if no published content carries it,
-- the Team's members see nothing for it.
select
  'Team content assignments point at published content' as check_name,
  count(*) as orphan_assignments,
  case when count(*) = 0 then 'PASS' else 'WARN' end as status
from public.team_content_assignments tca
where not exists (
  select 1
  from public.content_items ci
  where ci.status = 'published'
    and ci.content_type = tca.content_type
    and public.content_logical_key(ci.metadata) = tca.content_logical_key
);

-- ---------------------------------------------------------------------------
-- Critical privileges
-- ---------------------------------------------------------------------------

with service_only(signature) as (
  values
    ('public.publish_scheduled_staging_payload(jsonb,text)'),
    ('public.claim_due_push_notifications(text,integer,integer,timestamptz)'),
    ('public.record_push_delivery_attempt(uuid,text,text,text,text)'),
    ('public.record_push_delivery_attempts(text,jsonb)'),
    ('public.purge_operational_history(integer,boolean)'),
    ('public.materialize_solo_question_assignments(date)')
)
select
  'service-only function closed to clients' as check_name,
  service_only.signature,
  case
    when to_regprocedure(service_only.signature) is null then 'SKIP (not deployed)'
    when has_function_privilege('anon', to_regprocedure(service_only.signature), 'execute')
      or has_function_privilege('authenticated', to_regprocedure(service_only.signature), 'execute') then 'FAIL'
    else 'PASS'
  end as status
from service_only
order by 2;

with client_read_only(table_name) as (
  values ('content_items'), ('sources'), ('content_item_sources'), ('daily_drops'), ('daily_drop_items'), ('editions')
)
select
  'clients cannot write publication tables' as check_name,
  client_read_only.table_name,
  case
    when to_regclass('public.' || client_read_only.table_name) is null then 'SKIP (not deployed)'
    when has_table_privilege('authenticated', 'public.' || client_read_only.table_name, 'insert,update,delete')
         and not exists (
           select 1 from pg_policies p
           where p.schemaname = 'public' and p.tablename = client_read_only.table_name
             and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
             and ('authenticated' = any (p.roles) or 'public' = any (p.roles))
         )
      then 'PASS (grant, but no write policy)'
    when has_table_privilege('authenticated', 'public.' || client_read_only.table_name, 'insert,update,delete')
      then 'FAIL'
    else 'PASS'
  end as status
from client_read_only
order by 2;

select
  'new objects start closed (default privileges)' as check_name,
  count(*) as default_grants_to_clients,
  case when count(*) = 0 then 'PASS' else 'WARN' end as status
from pg_default_acl d, aclexplode(d.defaclacl) a
where d.defaclrole = 'postgres'::regrole
  and d.defaclnamespace = 'public'::regnamespace
  and a.grantee in ('anon'::regrole, 'authenticated'::regrole);

-- ---------------------------------------------------------------------------
-- Published editions are immutable (20261005130000)
-- ---------------------------------------------------------------------------

with expected(table_name, trigger_name) as (
  values
    ('daily_drops', 'trg_daily_drops_guard_published_edition'),
    ('daily_drop_items', 'trg_daily_drop_items_guard_published_edition'),
    ('editions', 'trg_editions_guard_registry')
)
select
  'edition immutability trigger exists and is enabled' as check_name,
  expected.table_name,
  expected.trigger_name,
  case
    when t.oid is null then 'FAIL'
    when t.tgenabled = 'D' then 'FAIL (disabled)'
    else 'PASS'
  end as status
from expected
left join pg_trigger t
  on t.tgname = expected.trigger_name
 and t.tgrelid = to_regclass('public.' || expected.table_name)
order by 2;

-- ---------------------------------------------------------------------------
-- Input size limits (20261005182000)
-- ---------------------------------------------------------------------------

select
  'input size limits present' as check_name,
  count(*) as constraints_found,
  count(*) filter (where convalidated) as validated,
  case when count(*) = 8 then 'PASS' else 'WARN' end as status
from pg_constraint
where conname in (
  'mini_case_responses_answer_md_length_check',
  'mini_case_responses_ai_feedback_md_length_check',
  'mini_case_responses_selections_size_check',
  'content_interactions_message_length_check',
  'newsletter_feedback_message_length_check',
  'newsletter_feedback_email_length_check',
  'pending_registrations_email_length_check',
  'pending_registrations_payload_size_check'
);
