-- Teams — PRODUCTION project.
--
-- A Team is a private league between friends. There is no public division, no
-- Bronze/Silver/Gold, and no discovery: the only way in is an invite code from
-- someone already inside. A reader may belong to as many Teams as they like.
--
-- Three product rules are load-bearing and are enforced here rather than in the
-- app, because the app cannot be trusted with any of them:
--
--   1. Changing the config never changes an edition already under way
--      (§4). Configuration is versioned and each version declares the first
--      edition it applies to.
--
--   2. Joining mid-edition gets you the team and its leaderboard immediately,
--      but scoring starts at the NEXT edition (§5). Otherwise someone could
--      read the questions, then join, then answer.
--
--   3. Leaving revokes future access without erasing history (§6). Membership
--      is historised with left_at; scores already earned stay attached to the
--      editions they were earned in.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Teams
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  name_status TEXT NOT NULL DEFAULT 'active',
  -- The invite mechanism. A short, unguessable, rotatable code — not the team
  -- id, so revoking an invite never invalidates a link a member already has to
  -- the team itself.
  invite_code TEXT NOT NULL,
  invite_code_rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teams_name_length_check CHECK (length(btrim(name)) BETWEEN 2 AND 40),
  CONSTRAINT teams_name_status_check CHECK (name_status IN ('active', 'hidden')),
  CONSTRAINT teams_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT teams_invite_code_format_check CHECK (invite_code ~ '^[A-Z0-9]{8}$'),
  CONSTRAINT teams_archived_at_check CHECK (
    (status = 'archived') = (archived_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_invite_code_unique
  ON public.teams (invite_code);

CREATE INDEX IF NOT EXISTS idx_teams_owner ON public.teams(owner_id);

COMMENT ON TABLE public.teams IS
  'A private league between friends, reachable only by invite code. Archived rather than deleted (status/archived_at) so past leaderboards stay reconstructible.';
COMMENT ON COLUMN public.teams.name_status IS
  'Moderation flag. ''hidden'' suppresses the name without deleting the team or any score earned in it.';

-- ---------------------------------------------------------------------------
-- 2. Membership, historised
-- ---------------------------------------------------------------------------
-- A row per *stint*. Leaving sets left_at; rejoining later opens a new row with
-- a new eligibility date. A DELETE would take the stint with it, and with it
-- the answer to "was this person in the team when that edition was scored".

CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  -- The first edition this stint may be scored in. Written server-side at join
  -- time and never updated: it is the record of what the joiner could not
  -- already have seen.
  eligible_from_edition DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_members_role_check CHECK (role IN ('owner', 'member')),
  CONSTRAINT team_members_left_after_joined_check CHECK (
    left_at IS NULL OR left_at >= joined_at
  )
);

-- One live stint per person per team. Partial, so the history of past stints is
-- unbounded while the present is unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_active_unique
  ON public.team_members (team_id, user_id)
  WHERE left_at IS NULL;

-- Both directions are RLS predicates and both are hot: "the teams I am in" and
-- "who is in this team".
CREATE INDEX IF NOT EXISTS idx_team_members_user_active
  ON public.team_members (user_id, team_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_team_members_team_active
  ON public.team_members (team_id, user_id)
  WHERE left_at IS NULL;

-- Scoring asks "was this user eligible for this team on this edition", which
-- reads the historic rows too.
CREATE INDEX IF NOT EXISTS idx_team_members_team_user_eligibility
  ON public.team_members (team_id, user_id, eligible_from_edition);

COMMENT ON TABLE public.team_members IS
  'One row per membership stint. left_at closes a stint instead of deleting it, so historic leaderboards stay reconstructible and a rejoin cannot inherit the old eligibility date.';
COMMENT ON COLUMN public.team_members.eligible_from_edition IS
  'First edition this stint may be scored in. Set server-side to the edition after the one open at join time (Prompt 1 §5) so a mid-edition joiner cannot answer questions they may already have read.';

-- ---------------------------------------------------------------------------
-- 3. Membership predicates
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because they are used inside RLS policies on the very tables
-- they read: a plain subquery there would recurse through team_members' own
-- policy. Each one takes auth.uid() itself rather than a caller-supplied user
-- id, so there is no argument that can be pointed at somebody else.

CREATE OR REPLACE FUNCTION public.is_active_team_member(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members m
    WHERE m.team_id = p_team_id
      AND m.user_id = auth.uid()
      AND m.left_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_team_owner(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = p_team_id
      AND t.owner_id = auth.uid()
      AND t.status = 'active'
  );
$$;

-- "Is this other reader someone I currently share a team with?" — the only
-- reason one reader may see another reader's public identity.
CREATE OR REPLACE FUNCTION public.shares_active_team_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members mine
    JOIN public.team_members theirs
      ON theirs.team_id = mine.team_id
     AND theirs.left_at IS NULL
    WHERE mine.user_id = auth.uid()
      AND mine.left_at IS NULL
      AND theirs.user_id = p_user_id
  );
$$;

-- Was the user in this team, and eligible, for that edition? Historic stints
-- count: leaving in March must not rewrite February's leaderboard.
CREATE OR REPLACE FUNCTION public.was_team_member_eligible_for_edition(
  p_team_id UUID,
  p_user_id UUID,
  p_edition_date DATE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members m
    JOIN public.editions e ON e.edition_date = p_edition_date
    WHERE m.team_id = p_team_id
      AND m.user_id = p_user_id
      AND m.eligible_from_edition <= p_edition_date
      AND m.joined_at <= e.published_at
      -- An open stint, or one that was still open when the edition published.
      AND (m.left_at IS NULL OR m.left_at >= e.published_at)
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_team_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_team_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_active_team_with(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.was_team_member_eligible_for_edition(UUID, UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_team_member(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.is_team_owner(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.shares_active_team_with(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.was_team_member_eligible_for_edition(UUID, UUID, DATE) FROM anon;

GRANT EXECUTE ON FUNCTION public.is_active_team_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_team_owner(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shares_active_team_with(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.was_team_member_eligible_for_edition(UUID, UUID, DATE) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Versioned configuration
-- ---------------------------------------------------------------------------
-- The owner picks one configuration for everybody. Editing it must not touch
-- the edition already in flight, so a config is a *version* that declares the
-- first edition it governs:
--
--   Finance + Business, effective from edition E1
--   owner adds Tech AI at 15:00 during E1
--   -> new version, effective from E2
--   -> E1 still resolves to Finance + Business
--   -> E2 resolves to Finance + Business + Tech AI
--
-- Relational rather than a JSON blob: the topics are foreign keys, they are
-- queried by the assignment job ("which teams want tech_ai this edition"), and
-- a blob would be neither indexable nor referentially checked.

CREATE TABLE IF NOT EXISTS public.team_config_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  effective_from_edition DATE NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_config_versions_version_check CHECK (version >= 1),
  CONSTRAINT team_config_versions_team_version_unique UNIQUE (team_id, version)
);

-- One version per team per effective edition: editing twice before the next
-- edition amends the pending version rather than stacking two.
CREATE UNIQUE INDEX IF NOT EXISTS team_config_versions_team_effective_unique
  ON public.team_config_versions (team_id, effective_from_edition);

CREATE INDEX IF NOT EXISTS idx_team_config_versions_lookup
  ON public.team_config_versions (team_id, effective_from_edition DESC);

-- Newsletter: which topics, and how many articles of each. Reuses the newsletter
-- topic vocabulary (public.topics) and the same 1..3 depth as
-- user_topic_preferences.articles_count, so a Team config and a solo config are
-- the same shape of thing.
CREATE TABLE IF NOT EXISTS public.team_config_newsletter_topics (
  config_version_id UUID NOT NULL REFERENCES public.team_config_versions(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES public.topics(id) ON DELETE RESTRICT,
  articles_count INTEGER NOT NULL DEFAULT 1,
  position INTEGER,
  PRIMARY KEY (config_version_id, topic_id),
  CONSTRAINT team_config_newsletter_topics_count_check CHECK (articles_count BETWEEN 1 AND 3)
);

-- Mini cases: the six product topics, exactly as
-- user_mini_case_topic_preferences constrains them. Same vocabulary, so a
-- future change has one list to update in each place rather than two lists to
-- reconcile.
CREATE TABLE IF NOT EXISTS public.team_config_mini_case_topics (
  config_version_id UUID NOT NULL REFERENCES public.team_config_versions(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  position INTEGER,
  PRIMARY KEY (config_version_id, topic_id),
  CONSTRAINT team_config_mini_case_topics_topic_check CHECK (topic_id IN (
    'finance_economy',
    'stock_market',
    'ai',
    'law_compliance',
    'health_pharma',
    'engineering_operations'
  ))
);

COMMENT ON TABLE public.team_config_versions IS
  'Immutable configuration snapshots. A version governs every edition from effective_from_edition until a later version takes over, which is what makes an in-flight edition immune to a config change.';
COMMENT ON TABLE public.team_config_newsletter_topics IS
  'Newsletter topics of one config version, with the same 1-3 articles_count depth the solo newsletter preference uses.';
COMMENT ON TABLE public.team_config_mini_case_topics IS
  'Mini-case topics of one config version, drawn from the same six product topics as user_mini_case_topic_preferences. Business Stories and Learning Path are never team-configurable.';

-- The version governing a given edition: the latest one that had taken effect
-- by then. This single function is what every reader of a config must use —
-- assignment, the mobile client, and the tests.
CREATE OR REPLACE FUNCTION public.team_effective_config_version(
  p_team_id UUID,
  p_edition_date DATE
)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT v.id
  FROM public.team_config_versions v
  WHERE v.team_id = p_team_id
    AND v.effective_from_edition <= p_edition_date
  ORDER BY v.effective_from_edition DESC, v.version DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.team_effective_config_version(UUID, DATE) IS
  'The config version that governs an edition: the newest one effective on or before it. Editing during an edition creates a version effective from the next one, so this keeps returning the old version for the edition in flight.';

REVOKE ALL ON FUNCTION public.team_effective_config_version(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_effective_config_version(UUID, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.team_effective_config_version(UUID, DATE) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_config_newsletter_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_config_mini_case_topics ENABLE ROW LEVEL SECURITY;

-- Teams: members see their own teams. A non-member sees nothing at all — not
-- the name, not the existence. Joining is done through an RPC that reads the
-- invite code with definer rights, so no read policy has to be opened for it.
DROP POLICY IF EXISTS "Members can read their teams" ON public.teams;
CREATE POLICY "Members can read their teams"
ON public.teams
FOR SELECT
USING (public.is_active_team_member(id));

-- There is deliberately no INSERT, UPDATE or DELETE policy on teams, and no
-- write privilege below. Every mutation goes through an RPC:
--
--   create_team / rename_team / rotate_team_invite_code / update_team_config
--
-- A direct owner UPDATE would look harmless and would not be: the same
-- statement that renames a team can also clear `name_status`, undoing a
-- moderation decision, or rewrite `owner_id`. Naming the allowed mutations one
-- by one costs four small functions and removes that whole class of edit.

-- Members: everyone in a team can see who else is in it (that is the
-- leaderboard). Nobody writes this table directly — join and leave are RPCs, so
-- eligible_from_edition can never be chosen by the client.
DROP POLICY IF EXISTS "Members can read the roster of their teams" ON public.team_members;
CREATE POLICY "Members can read the roster of their teams"
ON public.team_members
FOR SELECT
USING (
  user_id = auth.uid()
  OR public.is_active_team_member(team_id)
);

-- Config: readable by members (the app shows what the team is playing),
-- writable by nobody directly — update_team_config() owns the versioning rule.
DROP POLICY IF EXISTS "Members can read their team config versions" ON public.team_config_versions;
CREATE POLICY "Members can read their team config versions"
ON public.team_config_versions
FOR SELECT
USING (public.is_active_team_member(team_id));

DROP POLICY IF EXISTS "Members can read their team newsletter topics" ON public.team_config_newsletter_topics;
CREATE POLICY "Members can read their team newsletter topics"
ON public.team_config_newsletter_topics
FOR SELECT
USING (EXISTS (
  SELECT 1
  FROM public.team_config_versions v
  WHERE v.id = config_version_id
    AND public.is_active_team_member(v.team_id)
));

DROP POLICY IF EXISTS "Members can read their team mini case topics" ON public.team_config_mini_case_topics;
CREATE POLICY "Members can read their team mini case topics"
ON public.team_config_mini_case_topics
FOR SELECT
USING (EXISTS (
  SELECT 1
  FROM public.team_config_versions v
  WHERE v.id = config_version_id
    AND public.is_active_team_member(v.team_id)
));

-- Profiles are deliberately NOT touched.
--
-- A leaderboard has to render team-mates' names, and the obvious way to allow
-- that is a second SELECT policy on public.profiles saying "or we share a
-- team". That was rejected: profiles carries `email`, and a row-level policy
-- makes the whole row readable. Narrowing it with column privileges would mean
-- REVOKE SELECT ON profiles FROM authenticated, which instantly breaks the
-- `select id, language` the app runs on every cold start.
--
-- So the existing policy stays exactly as it is — `auth.uid() = id`, nobody
-- reads anybody else's profile row — and team-mate identity is served by
-- public.get_team_roster() in the scoring migration, which returns four
-- columns and no email at all.

REVOKE ALL ON TABLE public.teams FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.team_members FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.team_config_versions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.team_config_newsletter_topics FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.team_config_mini_case_topics FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.teams TO authenticated;
GRANT SELECT ON TABLE public.team_members TO authenticated;
GRANT SELECT ON TABLE public.team_config_versions TO authenticated;
GRANT SELECT ON TABLE public.team_config_newsletter_topics TO authenticated;
GRANT SELECT ON TABLE public.team_config_mini_case_topics TO authenticated;

GRANT ALL ON TABLE public.teams TO service_role;
GRANT ALL ON TABLE public.team_members TO service_role;
GRANT ALL ON TABLE public.team_config_versions TO service_role;
GRANT ALL ON TABLE public.team_config_newsletter_topics TO service_role;
GRANT ALL ON TABLE public.team_config_mini_case_topics TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Team lifecycle RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_team_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  -- No I, O, 0 or 1: the code gets read aloud and retyped.
  c_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
  v_attempt INT := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    v_code := '';

    FOR i IN 1..8 LOOP
      v_code := v_code || substr(c_alphabet, 1 + floor(random() * length(c_alphabet))::INT, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.invite_code = v_code);

    IF v_attempt >= 20 THEN
      RAISE EXCEPTION 'Could not allocate a unique invite code'
        USING ERRCODE = '53400';
    END IF;
  END LOOP;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_team_invite_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_team_invite_code() FROM anon;
REVOKE ALL ON FUNCTION public.generate_team_invite_code() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_team_invite_code() TO service_role;

CREATE OR REPLACE FUNCTION public.create_team(p_name TEXT)
RETURNS TABLE (
  team_id UUID,
  name TEXT,
  invite_code TEXT,
  config_version_id UUID,
  effective_from_edition DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_name TEXT := nullif(btrim(p_name), '');
  v_team public.teams;
  v_config_id UUID;
  -- The founder is not joining an edition already in progress; there is nothing
  -- for them to have peeked at. Their first config takes effect immediately, so
  -- the team is playable from the edition that is open right now.
  v_effective DATE := COALESCE(public.current_edition_date(), CURRENT_DATE);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to create a team'
      USING ERRCODE = '28000';
  END IF;

  IF v_name IS NULL OR length(v_name) < 2 OR length(v_name) > 40 THEN
    RAISE EXCEPTION 'Team name must be between 2 and 40 characters'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.teams (owner_id, name, invite_code)
  VALUES (v_user_id, v_name, public.generate_team_invite_code())
  RETURNING * INTO v_team;

  -- The owner is eligible from the currently open edition: they created the
  -- team, so there is no earlier edition they could be scored in.
  INSERT INTO public.team_members (team_id, user_id, role, eligible_from_edition)
  VALUES (v_team.id, v_user_id, 'owner', v_effective);

  INSERT INTO public.team_config_versions (team_id, version, effective_from_edition, created_by)
  VALUES (v_team.id, 1, v_effective, v_user_id)
  RETURNING id INTO v_config_id;

  RETURN QUERY SELECT v_team.id, v_team.name, v_team.invite_code, v_config_id, v_effective;
END;
$$;

REVOKE ALL ON FUNCTION public.create_team(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_team(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_team(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_team(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.join_team_with_invite(p_invite_code TEXT)
RETURNS TABLE (
  team_id UUID,
  name TEXT,
  role TEXT,
  eligible_from_edition DATE,
  already_member BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_code TEXT := nullif(btrim(upper(p_invite_code)), '');
  v_team public.teams;
  v_existing public.team_members;
  v_eligible DATE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to join a team'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_team
  FROM public.teams t
  WHERE t.invite_code = v_code
    AND t.status = 'active';

  IF NOT FOUND THEN
    -- One message for "no such code" and "archived team" alike: distinguishing
    -- them would turn this into a code oracle.
    RAISE EXCEPTION 'Invite code not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
  FROM public.team_members m
  WHERE m.team_id = v_team.id
    AND m.user_id = v_user_id
    AND m.left_at IS NULL;

  IF FOUND THEN
    RETURN QUERY SELECT v_team.id, v_team.name, v_existing.role, v_existing.eligible_from_edition, TRUE;
    RETURN;
  END IF;

  -- THE RULE (§5): the joiner sees the team and its leaderboard now, and starts
  -- being scored at the next edition. Computed here, from Postgres' own clock
  -- and the editions table — never sent by the client.
  v_eligible := public.next_scoring_edition_date();

  INSERT INTO public.team_members (team_id, user_id, role, eligible_from_edition)
  VALUES (v_team.id, v_user_id, 'member', v_eligible);

  RETURN QUERY SELECT v_team.id, v_team.name, 'member'::TEXT, v_eligible, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.join_team_with_invite(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_team_with_invite(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_team_with_invite(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_team_with_invite(TEXT) TO service_role;

COMMENT ON FUNCTION public.join_team_with_invite(TEXT) IS
  'Joins by invite code. Eligibility starts at the NEXT edition (public.next_scoring_edition_date), computed server-side, so joining after reading an edition''s questions cannot score in it.';

CREATE OR REPLACE FUNCTION public.leave_team(p_team_id UUID)
-- The output is deliberately NOT called left_at. Every output column of a
-- RETURNS TABLE is also a PL/pgSQL variable, and this body writes a column of
-- that name; an unqualified reference to it would raise 42702 at plan time.
-- That is exactly the bug 20260904120000 had to fix in update_profile_language,
-- so the name is kept out of the way rather than relied on to stay qualified.
RETURNS TABLE (
  team_id UUID,
  departed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_left_at TIMESTAMPTZ := now();
  v_is_owner BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to leave a team'
      USING ERRCODE = '28000';
  END IF;

  SELECT (t.owner_id = v_user_id) INTO v_is_owner
  FROM public.teams t
  WHERE t.id = p_team_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- The owner leaving archives the team rather than orphaning it. Archiving is
  -- a soft delete on purpose: every past leaderboard, score and streak stays
  -- reconstructible, and the invite code stops working immediately.
  IF v_is_owner THEN
    UPDATE public.teams
    SET status = 'archived', archived_at = v_left_at, updated_at = v_left_at
    WHERE id = p_team_id AND status = 'active';

    UPDATE public.team_members m
    SET left_at = v_left_at
    WHERE m.team_id = p_team_id AND m.left_at IS NULL;
  ELSE
    UPDATE public.team_members m
    SET left_at = v_left_at
    WHERE m.team_id = p_team_id
      AND m.user_id = v_user_id
      AND m.left_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not a member of this team'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN QUERY SELECT p_team_id, v_left_at;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_team(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leave_team(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.leave_team(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_team(UUID) TO service_role;

COMMENT ON FUNCTION public.leave_team(UUID) IS
  'Closes the caller''s membership stint (left_at), revoking future access immediately while leaving every score already earned attached to its edition. An owner leaving archives the team instead of deleting it.';

-- ---------------------------------------------------------------------------
-- 7. Configuration RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_team_config(
  p_team_id UUID,
  p_newsletter_topics JSONB DEFAULT '[]'::JSONB,
  p_mini_case_topics TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS TABLE (
  config_version_id UUID,
  version INTEGER,
  effective_from_edition DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_effective DATE;
  v_version INTEGER;
  v_config_id UUID;
  v_topic JSONB;
  v_topic_id TEXT;
  v_count INTEGER;
  v_position INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to change a team configuration'
      USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_team_owner(p_team_id) THEN
    RAISE EXCEPTION 'Only the team owner can change the configuration'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_newsletter_topics) <> 'array' THEN
    RAISE EXCEPTION 'Newsletter topics must be a JSON array of {topic_id, articles_count}'
      USING ERRCODE = '22023';
  END IF;

  -- THE RULE (§4): a change never touches the edition in flight. The new
  -- version takes effect at the next edition, so whatever is being read right
  -- now keeps resolving to the previous version.
  v_effective := public.next_scoring_edition_date();

  -- Editing twice before that edition amends the pending version rather than
  -- stacking two versions on the same effective date.
  SELECT v.id, v.version INTO v_config_id, v_version
  FROM public.team_config_versions v
  WHERE v.team_id = p_team_id
    AND v.effective_from_edition = v_effective;

  IF NOT FOUND THEN
    SELECT COALESCE(MAX(v.version), 0) + 1 INTO v_version
    FROM public.team_config_versions v
    WHERE v.team_id = p_team_id;

    INSERT INTO public.team_config_versions (team_id, version, effective_from_edition, created_by)
    VALUES (p_team_id, v_version, v_effective, v_user_id)
    RETURNING id INTO v_config_id;
  ELSE
    -- Aliased: config_version_id is also a RETURNS TABLE output variable here.
    DELETE FROM public.team_config_newsletter_topics AS n WHERE n.config_version_id = v_config_id;
    DELETE FROM public.team_config_mini_case_topics AS c WHERE c.config_version_id = v_config_id;
  END IF;

  FOR v_topic IN SELECT * FROM jsonb_array_elements(p_newsletter_topics)
  LOOP
    v_topic_id := v_topic->>'topic_id';
    v_count := COALESCE((v_topic->>'articles_count')::INTEGER, 1);
    v_position := v_position + 1;

    IF v_topic_id IS NULL THEN
      RAISE EXCEPTION 'Each newsletter topic needs a topic_id'
        USING ERRCODE = '22023';
    END IF;

    IF v_count NOT BETWEEN 1 AND 3 THEN
      RAISE EXCEPTION 'articles_count must be between 1 and 3'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.team_config_newsletter_topics (
      config_version_id, topic_id, articles_count, position
    )
    VALUES (v_config_id, v_topic_id, v_count, v_position)
    -- BY CONSTRAINT NAME, NOT BY COLUMN LIST. `config_version_id` is also a
    -- RETURNS TABLE output of this function and therefore a PL/pgSQL variable,
    -- and an ON CONFLICT inference list is an expression context, so a bare
    -- column list here raises 42702 on every call. That is exactly the bug that
    -- stopped every edition notification this product ever published
    -- (20260906099000); it is not repeated here.
    ON CONFLICT ON CONSTRAINT team_config_newsletter_topics_pkey
    DO UPDATE SET articles_count = EXCLUDED.articles_count;
  END LOOP;

  v_position := 0;

  FOREACH v_topic_id IN ARRAY p_mini_case_topics
  LOOP
    v_position := v_position + 1;

    INSERT INTO public.team_config_mini_case_topics (config_version_id, topic_id, position)
    VALUES (v_config_id, v_topic_id, v_position)
    ON CONFLICT ON CONSTRAINT team_config_mini_case_topics_pkey DO NOTHING;
  END LOOP;

  UPDATE public.teams SET updated_at = now() WHERE id = p_team_id;

  RETURN QUERY SELECT v_config_id, v_version, v_effective;
END;
$$;

REVOKE ALL ON FUNCTION public.update_team_config(UUID, JSONB, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_team_config(UUID, JSONB, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_team_config(UUID, JSONB, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_team_config(UUID, JSONB, TEXT[]) TO service_role;

COMMENT ON FUNCTION public.update_team_config(UUID, JSONB, TEXT[]) IS
  'Owner-only. Writes a configuration version effective from the NEXT edition, so the edition currently being read keeps the configuration it started with. Repeated edits before that edition amend the pending version.';

CREATE OR REPLACE FUNCTION public.rename_team(p_team_id UUID, p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name TEXT := nullif(btrim(p_name), '');
BEGIN
  IF NOT public.is_team_owner(p_team_id) THEN
    RAISE EXCEPTION 'Only the team owner can rename the team'
      USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR length(v_name) < 2 OR length(v_name) > 40 THEN
    RAISE EXCEPTION 'Team name must be between 2 and 40 characters'
      USING ERRCODE = '22023';
  END IF;

  -- name only. name_status is not in this statement, so renaming can never be
  -- used to lift a moderation decision.
  UPDATE public.teams
  SET name = v_name, updated_at = now()
  WHERE id = p_team_id;

  RETURN v_name;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_team(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_team(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.rename_team(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_team(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.rotate_team_invite_code(p_team_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF NOT public.is_team_owner(p_team_id) THEN
    RAISE EXCEPTION 'Only the team owner can rotate the invite code'
      USING ERRCODE = '42501';
  END IF;

  v_code := public.generate_team_invite_code();

  UPDATE public.teams
  SET invite_code = v_code, invite_code_rotated_at = now(), updated_at = now()
  WHERE id = p_team_id;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_team_invite_code(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_team_invite_code(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.rotate_team_invite_code(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_team_invite_code(UUID) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
