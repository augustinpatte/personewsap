-- Production RLS hardening for personalized daily drops.
-- Default behavior: authenticated users can read only content assigned through
-- their own published/read/archived daily_drops.
--
-- Optional public archive:
--   ALTER DATABASE postgres SET app.public_archive_enabled = 'true';
-- or set the same custom GUC for the authenticated role/session.

CREATE OR REPLACE FUNCTION public.public_archive_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(coalesce(current_setting('app.public_archive_enabled', true), 'false')) = 'true';
$$;

CREATE OR REPLACE FUNCTION public.user_has_assigned_content(target_content_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_drops dd
    JOIN public.daily_drop_items ddi
      ON ddi.daily_drop_id = dd.id
    JOIN public.content_items ci
      ON ci.id = ddi.content_item_id
    WHERE dd.user_id = auth.uid()
      AND dd.status IN ('published', 'read', 'archived')
      AND ddi.content_item_id = target_content_item_id
      AND ci.status = 'published'
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_assigned_source(target_source_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_drops dd
    JOIN public.daily_drop_items ddi
      ON ddi.daily_drop_id = dd.id
    JOIN public.content_items ci
      ON ci.id = ddi.content_item_id
    JOIN public.content_item_sources cis
      ON cis.content_item_id = ci.id
    WHERE dd.user_id = auth.uid()
      AND dd.status IN ('published', 'read', 'archived')
      AND ci.status = 'published'
      AND cis.source_id = target_source_id
  );
$$;

CREATE OR REPLACE FUNCTION public.published_content_has_source(target_source_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_item_sources cis
    JOIN public.content_items ci
      ON ci.id = cis.content_item_id
    WHERE cis.source_id = target_source_id
      AND ci.status = 'published'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_published_content(
  target_content_item_id uuid,
  target_content_type text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_items ci
    WHERE ci.id = target_content_item_id
      AND ci.status = 'published'
      AND (
        target_content_type IS NULL
        OR ci.content_type = target_content_type
      )
  );
$$;

REVOKE ALL ON FUNCTION public.public_archive_enabled() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_assigned_content(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_assigned_source(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.published_content_has_source(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_published_content(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_archive_enabled() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_assigned_content(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_assigned_source(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.published_content_has_source(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_published_content(uuid, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated users can read published content" ON public.content_items;
DROP POLICY IF EXISTS "Users can read assigned published content" ON public.content_items;

CREATE POLICY "Users can read assigned published content"
ON public.content_items
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND status = 'published'
  AND (
    public.public_archive_enabled()
    OR public.user_has_assigned_content(id)
  )
);

DROP POLICY IF EXISTS "Authenticated users can read source links for published content" ON public.content_item_sources;
DROP POLICY IF EXISTS "Users can read source links for assigned content" ON public.content_item_sources;

CREATE POLICY "Users can read source links for assigned content"
ON public.content_item_sources
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND (
    public.user_has_assigned_content(content_item_id)
    OR (
      public.public_archive_enabled()
      AND public.is_published_content(content_item_id)
    )
  )
);

DROP POLICY IF EXISTS "Authenticated users can read sources for published content" ON public.sources;
DROP POLICY IF EXISTS "Users can read sources for assigned content" ON public.sources;

CREATE POLICY "Users can read sources for assigned content"
ON public.sources
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND (
    public.user_has_assigned_source(id)
    OR (
      public.public_archive_enabled()
      AND public.published_content_has_source(id)
    )
  )
);

DROP POLICY IF EXISTS "Users can read their own interactions" ON public.content_interactions;
DROP POLICY IF EXISTS "Users can insert their own interactions" ON public.content_interactions;
DROP POLICY IF EXISTS "Users can read own interactions for assigned content" ON public.content_interactions;
DROP POLICY IF EXISTS "Users can insert own interactions for assigned content" ON public.content_interactions;

CREATE POLICY "Users can read own interactions for assigned content"
ON public.content_interactions
FOR SELECT
USING (
  user_id = auth.uid()
  AND public.user_has_assigned_content(content_item_id)
);

CREATE POLICY "Users can insert own interactions for assigned content"
ON public.content_interactions
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND public.user_has_assigned_content(content_item_id)
);

DROP POLICY IF EXISTS "Users can read their own mini-case responses" ON public.mini_case_responses;
DROP POLICY IF EXISTS "Users can insert their own mini-case responses" ON public.mini_case_responses;
DROP POLICY IF EXISTS "Users can update their own mini-case responses" ON public.mini_case_responses;
DROP POLICY IF EXISTS "Users can read own mini-case responses for assigned content" ON public.mini_case_responses;
DROP POLICY IF EXISTS "Users can insert own mini-case responses for assigned content" ON public.mini_case_responses;
DROP POLICY IF EXISTS "Users can update own mini-case responses for assigned content" ON public.mini_case_responses;

CREATE POLICY "Users can read own mini-case responses for assigned content"
ON public.mini_case_responses
FOR SELECT
USING (
  user_id = auth.uid()
  AND public.user_has_assigned_content(content_item_id)
);

CREATE POLICY "Users can insert own mini-case responses for assigned content"
ON public.mini_case_responses
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND public.user_has_assigned_content(content_item_id)
  AND public.is_published_content(content_item_id, 'mini_case')
);

CREATE POLICY "Users can update own mini-case responses for assigned content"
ON public.mini_case_responses
FOR UPDATE
USING (
  user_id = auth.uid()
  AND public.user_has_assigned_content(content_item_id)
)
WITH CHECK (
  user_id = auth.uid()
  AND public.user_has_assigned_content(content_item_id)
);

DROP POLICY IF EXISTS "Anyone can update pending registrations" ON public.pending_registrations;
DROP POLICY IF EXISTS "Users can update their pending registration" ON public.pending_registrations;

CREATE POLICY "Users can update their pending registration"
ON public.pending_registrations
FOR UPDATE
USING (
  lower(email) = lower(auth.email())
)
WITH CHECK (
  lower(email) = lower(auth.email())
);
