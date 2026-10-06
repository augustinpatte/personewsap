-- RLS: evaluate auth.uid() once per statement, not once per row — PRODUCTION.
--
-- 49 policies compared a column with a bare auth.uid(). Postgres evaluates that
-- call for every row it checks. Written as (select auth.uid()) the planner runs
-- it once as an InitPlan and compares a constant — the change Supabase's own
-- linter (auth_rls_initplan) asks for. The authorization is identical:
-- auth.uid() is STABLE (it reads the request's JWT claim), so one evaluation per
-- statement returns exactly what the per-row evaluations returned.
--
-- Each policy is restated in place (same name, command, roles and permissive
-- flag) with the same expression and only auth.uid() wrapped. Nothing else in
-- any expression is touched (auth.email(), the assignment and Team helpers,
-- status lists). Policies whose auth.uid() was already wrapped are left alone.
--
-- Covered: profiles and every preference table, push_tokens, daily_drops,
-- daily_drop_items, content_interactions, mini_case_responses, the question
-- and learning tables, Teams roster, blocks and reports, the legacy users /
-- user_topics tables, and the avatar policies on storage.objects.
--
-- Proved by supabase/tests/rls_initplan_parity.test.sql: every rewritten policy
-- is the old expression with only that substitution, no policy is added or
-- lost, and two readers and an anonymous caller see and may do the same on the
-- hot tables before and after.
--
-- Forward-only. Restating a policy is undone by restating it again.

BEGIN;

ALTER POLICY "Users can delete their own interactions" ON public.content_interactions
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can insert own interactions for assigned content" ON public.content_interactions
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (user_has_assigned_content(content_item_id) OR user_has_team_content_entitlement(content_item_id))));

ALTER POLICY "Users can read own interactions for assigned content" ON public.content_interactions
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND (user_has_assigned_content(content_item_id) OR user_has_team_content_entitlement(content_item_id))));

ALTER POLICY "Users can read items for their own published daily drops" ON public.daily_drop_items
  USING ((EXISTS ( SELECT 1
   FROM (daily_drops dd
     JOIN content_items ci ON ((ci.id = daily_drop_items.content_item_id)))
  WHERE ((dd.id = daily_drop_items.daily_drop_id) AND (dd.user_id = ( SELECT auth.uid() AS uid)) AND (dd.status = ANY (ARRAY['published'::text, 'read'::text, 'archived'::text])) AND (ci.status = 'published'::text)))));

ALTER POLICY "Users can read their own published daily drops" ON public.daily_drops
  USING (((status = ANY (ARRAY['published'::text, 'read'::text, 'archived'::text])) AND (user_id = ( SELECT auth.uid() AS uid))));

ALTER POLICY "Users can read own learning feedback" ON public.learning_session_feedback
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can read ready own learning sessions" ON public.learning_sessions
  USING (((generation_status = 'ready'::text) AND (EXISTS ( SELECT 1
   FROM user_learning_paths paths
  WHERE ((paths.id = learning_sessions.path_id) AND (paths.user_id = ( SELECT auth.uid() AS uid)))))));

ALTER POLICY "Users can delete their own mini-case responses" ON public.mini_case_responses
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can insert own mini-case responses for assigned content" ON public.mini_case_responses
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (user_has_assigned_content(content_item_id) OR user_has_team_content_entitlement(content_item_id)) AND is_published_content(content_item_id, 'mini_case'::text)));

ALTER POLICY "Users can read own mini-case responses for assigned content" ON public.mini_case_responses
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND (user_has_assigned_content(content_item_id) OR user_has_team_content_entitlement(content_item_id))));

ALTER POLICY "Users can update own mini-case responses for assigned content" ON public.mini_case_responses
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND (user_has_assigned_content(content_item_id) OR user_has_team_content_entitlement(content_item_id))))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (user_has_assigned_content(content_item_id) OR user_has_team_content_entitlement(content_item_id))));

ALTER POLICY "Users can insert their own mobile profile" ON public.profiles
  WITH CHECK (((( SELECT auth.uid() AS uid) = id) AND (lower(email) = lower(auth.email()))));

ALTER POLICY "Users can read their own mobile profile" ON public.profiles
  USING ((( SELECT auth.uid() AS uid) = id));

ALTER POLICY "Users can update their own mobile profile" ON public.profiles
  USING ((( SELECT auth.uid() AS uid) = id))
  WITH CHECK (((( SELECT auth.uid() AS uid) = id) AND (lower(email) = lower(auth.email()))));

ALTER POLICY "Users can delete their own push tokens" ON public.push_tokens
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can insert their own push tokens" ON public.push_tokens
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can read their own push tokens" ON public.push_tokens
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can update their own push tokens" ON public.push_tokens
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Readers can read their own attempts" ON public.question_attempts
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Readers can read their own solo assignments" ON public.solo_question_assignments
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Members can read the roster of their teams" ON public.team_members
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR is_active_team_member(team_id)));

ALTER POLICY "Readers can add to their own block list" ON public.user_blocks
  WITH CHECK ((blocker_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Readers can remove from their own block list" ON public.user_blocks
  USING ((blocker_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Readers manage their own block list" ON public.user_blocks
  USING ((blocker_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can read own learning paths" ON public.user_learning_paths
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can delete their own mini-case topic preferences" ON public.user_mini_case_topic_preferences
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can insert their own mini-case topic preferences" ON public.user_mini_case_topic_preferences
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can read their own mini-case topic preferences" ON public.user_mini_case_topic_preferences
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can update their own mini-case topic preferences" ON public.user_mini_case_topic_preferences
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can insert their own preferences" ON public.user_preferences
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can read their own preferences" ON public.user_preferences
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can update their own preferences" ON public.user_preferences
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Reporters can file a report" ON public.user_reports
  WITH CHECK (((reporter_id = ( SELECT auth.uid() AS uid)) AND (((reported_user_id IS NOT NULL) AND shares_active_team_with(reported_user_id)) OR ((team_id IS NOT NULL) AND is_active_team_member(team_id)))));

ALTER POLICY "Reporters can read their own reports" ON public.user_reports
  USING ((reporter_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can delete their own topic preferences" ON public.user_topic_preferences
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can insert their own topic preferences" ON public.user_topic_preferences
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can read their own topic preferences" ON public.user_topic_preferences
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can update their own topic preferences" ON public.user_topic_preferences
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users can delete their own topics" ON public.user_topics
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = user_topics.user_id) AND (u.auth_user_id = ( SELECT auth.uid() AS uid))))));

ALTER POLICY "Users can insert their own topics" ON public.user_topics
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = user_topics.user_id) AND (u.auth_user_id = ( SELECT auth.uid() AS uid))))));

ALTER POLICY "Users can update their own topics" ON public.user_topics
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = user_topics.user_id) AND (u.auth_user_id = ( SELECT auth.uid() AS uid))))));

ALTER POLICY "Users can view their own topics" ON public.user_topics
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = user_topics.user_id) AND (u.auth_user_id = ( SELECT auth.uid() AS uid))))));

ALTER POLICY "Users can insert their own profile" ON public.users
  WITH CHECK (((( SELECT auth.uid() AS uid) = auth_user_id) AND (lower(email) = lower(auth.email()))));

ALTER POLICY "Users can update their own profile" ON public.users
  USING ((( SELECT auth.uid() AS uid) = auth_user_id));

ALTER POLICY "Users can view their own profile" ON public.users
  USING ((( SELECT auth.uid() AS uid) = auth_user_id));

ALTER POLICY "Readers delete their own avatar" ON storage.objects
  USING (((bucket_id = 'avatars'::text) AND (avatar_object_owner(name) = ( SELECT auth.uid() AS uid))));

ALTER POLICY "Readers replace their own avatar" ON storage.objects
  USING (((bucket_id = 'avatars'::text) AND (avatar_object_owner(name) = ( SELECT auth.uid() AS uid))))
  WITH CHECK (((bucket_id = 'avatars'::text) AND (avatar_object_owner(name) = ( SELECT auth.uid() AS uid))));

ALTER POLICY "Readers upload their own avatar" ON storage.objects
  WITH CHECK (((bucket_id = 'avatars'::text) AND (avatar_object_owner(name) = ( SELECT auth.uid() AS uid))));

ALTER POLICY "Team mates can read an avatar" ON storage.objects
  USING (((bucket_id = 'avatars'::text) AND ((avatar_object_owner(name) = ( SELECT auth.uid() AS uid)) OR shares_active_team_with(avatar_object_owner(name)))));

COMMIT;

NOTIFY pgrst, 'reload schema';
