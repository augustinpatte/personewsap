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
    ('content_interactions')
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
    ('topics'),
    ('content_items'),
    ('sources'),
    ('daily_drops'),
    ('daily_drop_items'),
    ('content_interactions')
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
    ('content_items', 'Authenticated users can read published content'),
    ('sources', 'Authenticated users can read sources for published content'),
    ('content_item_sources', 'Authenticated users can read source links for published content'),
    ('daily_drops', 'Users can read their own published daily drops'),
    ('daily_drop_items', 'Users can read items for their own published daily drops'),
    ('content_interactions', 'Users can read their own interactions'),
    ('content_interactions', 'Users can insert their own interactions')
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

select
  'published content available for authenticated-read test' as check_name,
  count(*) as published_content_items
from public.content_items
where status = 'published';

select
  'published/read/archive daily drops available for app-read test' as check_name,
  count(*) as visible_status_daily_drops
from public.daily_drops
where status in ('published', 'read', 'archived');

