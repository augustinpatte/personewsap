-- Security hardening: RPC execute privileges and the archive view.
--
-- Three findings from the Supabase Security Advisor, fixed here. Everything in
-- this migration only removes privileges or narrows how a view runs; no
-- function body, table or policy is changed, and RLS is never disabled.
--
-- Written to be re-runnable: privileges are set by loop over pg_proc rather
-- than by hand-written signature, so overloads and future argument changes are
-- covered, and re-applying is a no-op.

-- ---------------------------------------------------------------------------
-- 1. public.user_archive_search_items ran as its owner (advisor ERROR)
-- ---------------------------------------------------------------------------
-- 20260818090000 created this view with security_invoker and granted SELECT to
-- authenticated only. 20260820090000 then added hide_display_date with a plain
-- CREATE OR REPLACE VIEW, which resets both: reloptions came back empty (so the
-- view ran as postgres, bypassing RLS on daily_drops / daily_drop_items /
-- content_items) and the schema default grants reapplied, handing anon SELECT.
--
-- Only the view's own `dd.user_id = auth.uid()` predicate was still scoping
-- readers. That is one predicate away from a cross-reader leak, so the view is
-- put back on the caller's own RLS. Verified on the live database before
-- writing this: under security_invoker a reader still sees exactly their own
-- rows (77 for the sampled reader, unchanged from definer mode) and zero rows
-- belonging to another reader.
--
-- No extra SELECT is granted on the underlying tables: authenticated already
-- has SELECT plus a self-scoping policy on all three, which is what makes
-- invoker mode return the same rows.
ALTER VIEW public.user_archive_search_items SET (security_invoker = true);

REVOKE ALL ON public.user_archive_search_items FROM PUBLIC;
REVOKE ALL ON public.user_archive_search_items FROM anon;
GRANT SELECT ON public.user_archive_search_items TO authenticated;
GRANT SELECT ON public.user_archive_search_items TO service_role;

COMMENT ON VIEW public.user_archive_search_items IS
  'Flat, de-duplicated archive of the calling reader''s assigned content items (one row per content item, carrying its most recent edition). Runs security_invoker so the reader''s own RLS on daily_drops, daily_drop_items and content_items applies; the auth.uid() predicate is defence in depth, not the only guard. Any future CREATE OR REPLACE VIEW must re-apply the option and these grants.';

-- ---------------------------------------------------------------------------
-- 2. Server-only SECURITY DEFINER functions reachable from the client
-- ---------------------------------------------------------------------------
-- Both are SECURITY DEFINER, neither consults auth.uid(), and both were
-- executable by anon and authenticated through the schema default grants —
-- meaning any holder of the publishable key could call them over
-- /rest/v1/rpc/. claim_push_notification_deliveries writes
-- push_notification_deliveries across all readers (it is the idempotency claim
-- for push fan-out, called by the content engine with the service role);
-- cleanup_expired_pending_registrations is a maintenance sweep. Neither has a
-- client caller: the only in-repo call site is
-- services/content-engine/src/notifications/supabasePushStore.ts, server-side.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'claim_push_notification_deliveries',
        'cleanup_expired_pending_registrations'
      )
  LOOP
    -- PUBLIC first: EXECUTE defaults to PUBLIC, so revoking only the two
    -- Supabase roles would leave the privilege reachable by inheritance.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. User-facing RPCs were callable by anon
-- ---------------------------------------------------------------------------
-- These eight are the Parcours and language RPCs the mobile app calls, all
-- SECURITY DEFINER and all already scoped by auth.uid() with a RAISE on a
-- missing or foreign caller. anon EXECUTE has no functional reason to exist:
-- every call site runs behind an authenticated session, so an anonymous caller
-- reaching them can only ever be rejected after the fact. Removing the
-- privilege turns that into a refusal at the door.
--
-- learning_paths_healthcheck is included deliberately. It reads as an ops
-- diagnostic, but apps/mobile/src/features/learning/LearningPathContext.tsx
-- calls it on every authenticated boot, so it keeps authenticated EXECUTE and
-- loses only anon.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'start_learning_path',
        'disable_learning_path',
        'create_next_learning_session',
        'open_learning_session',
        'start_learning_session',
        'submit_learning_session_feedback',
        'update_profile_language',
        'learning_paths_healthcheck'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS policy helpers are deliberately left alone
-- ---------------------------------------------------------------------------
-- is_published_content, public_archive_enabled, published_content_has_source,
-- user_has_assigned_content and user_has_assigned_source are also SECURITY
-- DEFINER and also executable by anon, and the advisor flags them the same way.
-- They are NOT revoked here, because all five are called from inside RLS
-- policies on content_items, content_item_sources, content_interactions,
-- mini_case_responses and sources.
--
-- PostgreSQL evaluates a policy expression as the querying role and enforces
-- EXECUTE on functions it calls. This was confirmed against this database on a
-- throwaway table: after revoking EXECUTE from authenticated, a SELECT under a
-- policy calling that helper failed with 42501 "permission denied for function"
-- instead of returning rows. Revoking here would therefore not tighten these
-- helpers, it would break every reader's access to their own content.
--
-- The exposure is small and bounded: each returns a boolean, the two that
-- answer per-reader questions (user_has_assigned_*) scope themselves with
-- auth.uid(), and the other three only answer whether content is published.
-- They stay as they are, on purpose.

-- ---------------------------------------------------------------------------
-- 5. Server-only tables: RLS on, no policies, and no client grants
-- ---------------------------------------------------------------------------
-- The advisor reports these five as "RLS enabled, no policies". That is the
-- intended state, not an oversight: they are engine bookkeeping
-- (generation_runs, job_runs), editorial memory (business_story_history,
-- mini_case_history) and push fan-out state (push_notification_deliveries).
-- No client reads them — the only in-repo mention outside the engine is a test
-- listing tables that account deletion must purge. RLS with zero policies is
-- deny-all for anon and authenticated, while service_role bypasses RLS, so the
-- server keeps working. No policy is invented to silence the warning.
--
-- What is removed is the leftover table-level grant: anon and authenticated
-- still held SELECT/INSERT/UPDATE/DELETE from the schema defaults. RLS makes
-- those inert today, which is exactly why they are worth dropping — they are a
-- loaded gun for the day someone adds a permissive policy.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'business_story_history',
    'generation_runs',
    'job_runs',
    'mini_case_history',
    'push_notification_deliveries'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      -- Only anon and authenticated are touched. service_role holds its own
      -- explicit grants and bypasses RLS, so the engine is unaffected and
      -- nothing needs re-granting here.
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
