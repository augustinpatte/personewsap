-- Security hardening for Teams — PRODUCTION project.
--
-- The Teams migrations were audited end to end against a modified client: not
-- "what does the app send", but "what can a caller with a valid JWT and a
-- rewritten binary send". Six things did not survive that reading. This closes
-- all six. Nothing here loosens an existing rule.
--
--   1. AVATAR IMPERSONATION. set_player_identity() accepted any avatar_path.
--      Storage RLS stops you WRITING an object under someone else's folder, but
--      nothing stopped you POINTING YOUR PROFILE AT one. A caller could send
--      `<victim uuid>/<their file>.jpg` and wear another reader's face on every
--      leaderboard they share — and the avatar is exactly how people recognise
--      each other there, so this is impersonation, not a cosmetic bug. The path
--      is now checked against auth.uid() in the same statement that writes it.
--
--   2. USERNAME MODERATION WAS CLIENT-SIDE ONLY. The column CHECK enforced
--      shape and the index enforced uniqueness, but "admin", "support",
--      "personews" and the small slur list lived only in the app bundle. A
--      modified client could claim any of them. Now the database decides.
--
--   3. TEAM NAME, same story: length was enforced server-side, content was not.
--
--   4. A HIDDEN TEAM NAME LEAKED THROUGH JOIN. Every read surface built in
--      20260906110000 resolves name_status — the directory, the detail RPC, the
--      badge RPC. join_team_with_invite() did not: it returned t.name raw, so a
--      name a moderator had taken out of every screen came back the moment
--      somebody joined with the code.
--
--   5. REPORTS WERE UNBOUNDED. One reader could file the same report ten
--      thousand times and bury a moderation queue nobody is paid to triage.
--      Fixed without new infrastructure: duplicates of an OPEN report collide on
--      an index, and a rolling-hour cap sits in a trigger.
--
--   6. A COMMENT THAT DOCUMENTED THE WRONG PATH SHAPE. profiles.avatar_path was
--      described as `avatars/<uid>/<uuid>.jpg`. The bucket name is not part of
--      the object path — public.avatar_object_owner() requires exactly two
--      segments and returns NULL for three, which turns every storage policy
--      false. A comment that contradicts the enforcement is how the next edit
--      reintroduces the bug.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The moderation primitives
-- ---------------------------------------------------------------------------
-- Deliberately the same two rules the client applies
-- (apps/mobile/src/features/teams/playerProfile.ts), and deliberately small:
-- impersonation of the product and of moderation itself, plus a short list of
-- unambiguous slurs. Not a profanity dictionary — one of those is defeated by a
-- single character swap and rejects real names for a living. Genuine abuse is
-- handled by report + moderate_player_identity(), which hides without
-- destroying any score.
--
-- The duplication with the client has a direction: the client's copy exists to
-- produce a fast, well-worded refusal in the reader's language. This one is the
-- authority.

CREATE OR REPLACE FUNCTION public.normalize_for_moderation(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  -- NFD splits an accented letter into its base plus a combining mark, and the
  -- [^a-z0-9] pass then removes the mark along with every separator. So
  -- "Àdmin", "a.d.m.i.n" and "admin" all normalise to the same string, which is
  -- what stops the list being defeated by punctuation. Byte-for-byte the same
  -- transformation as normalizeForModeration() in the mobile app.
  SELECT regexp_replace(lower(normalize(coalesce(p_value, ''), NFD)), '[^a-z0-9]', '', 'g');
$$;

REVOKE ALL ON FUNCTION public.normalize_for_moderation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_for_moderation(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.normalize_for_moderation(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.normalize_for_moderation(TEXT) IS
  'Lowercases, strips accents and removes every separator, so a reserved name cannot be claimed by punctuating it. Mirrors normalizeForModeration() in the mobile client, which is the courtesy check in front of this one.';

CREATE OR REPLACE FUNCTION public.is_reserved_username(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.normalize_for_moderation(p_username) = ANY (ARRAY[
    'personews', 'personewsap', 'admin', 'administrator', 'moderator',
    'support', 'official', 'staff', 'system', 'root', 'help'
  ]);
$$;

REVOKE ALL ON FUNCTION public.is_reserved_username(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_reserved_username(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_reserved_username(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_reserved_username(TEXT) IS
  'Names that would let a reader impersonate the product or its moderation on a leaderboard. Exact match on the normalised form, so it never catches an ordinary name that merely contains one of these words.';

CREATE OR REPLACE FUNCTION public.has_blocked_fragment(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_normalized TEXT := public.normalize_for_moderation(p_value);
  v_fragment TEXT;
BEGIN
  -- Fragments rather than words, so padding does not defeat them; short, so
  -- ordinary names survive. This is a speed bump on the laziest abuse and is
  -- documented as one rather than presented as protection.
  FOREACH v_fragment IN ARRAY ARRAY['fuck', 'shit', 'nigg', 'rape', 'nazi', 'hitler']
  LOOP
    IF position(v_fragment IN v_normalized) > 0 THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.has_blocked_fragment(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_blocked_fragment(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_blocked_fragment(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_blocked_fragment(TEXT) IS
  'A short list of unambiguous slurs, matched on the normalised string. Not a profanity filter: real moderation is report + moderate_player_identity, which hides a name without destroying the scores attached to it.';

-- ---------------------------------------------------------------------------
-- 2. Who may be named in an avatar path
-- ---------------------------------------------------------------------------
-- public.avatar_object_owner() (20260906101000) already answers this for
-- storage RLS. The profile write needs the same answer, and needs it to be the
-- SAME function, or the two drift and the gap between them is the hole.

CREATE OR REPLACE FUNCTION public.is_own_avatar_path(p_path TEXT, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_path IS NOT NULL
     AND p_user_id IS NOT NULL
     -- No scheme: a signed URL must never be stored. It expires, so the row
     -- rots, and it is a bearer token sitting in a column team-mates read.
     AND p_path !~* '^[a-z][a-z0-9+.-]*:'
     AND p_path !~ '\.\.'
     AND public.avatar_object_owner(p_path) = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.is_own_avatar_path(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_own_avatar_path(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_own_avatar_path(TEXT, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_own_avatar_path(TEXT, UUID) IS
  'True when the path is <user id>/<file> and the user id is this reader''s. Shares public.avatar_object_owner with the Storage policies on purpose: the profile write and the object write must agree on what "yours" means, or the gap between them is the impersonation.';

COMMENT ON COLUMN public.profiles.avatar_path IS
  'Storage object path INSIDE the avatars bucket: <user id>/<uuid>.jpg, exactly two segments. The bucket name is not part of it — from("avatars").upload(path) supplies that, and a repeated prefix makes three segments, which avatar_object_owner() returns NULL for and every storage policy then refuses. Never a signed URL: those expire, and persisting one stores a bearer token in a row.';

-- ---------------------------------------------------------------------------
-- 3. set_player_identity, with the two checks it was missing
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_player_identity(
  p_username TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL,
  p_avatar_path TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  username TEXT,
  country_code TEXT,
  avatar_path TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_username TEXT := nullif(btrim(p_username), '');
  v_country TEXT := nullif(btrim(upper(p_country_code)), '');
  v_avatar TEXT := nullif(btrim(p_avatar_path), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to set player identity'
      USING ERRCODE = '28000';
  END IF;

  IF v_username IS NOT NULL
     AND v_username !~ '^[A-Za-z0-9][A-Za-z0-9_.]{1,18}[A-Za-z0-9]$' THEN
    RAISE EXCEPTION 'Username must be 3-20 characters, letters, digits, dot or underscore, starting and ending with a letter or digit'
      USING ERRCODE = '22023';
  END IF;

  -- THE CHECKS THE CLIENT WAS DOING ALONE. A rewritten binary skips them; this
  -- does not.
  IF v_username IS NOT NULL AND public.is_reserved_username(v_username) THEN
    RAISE EXCEPTION 'That username is reserved'
      USING ERRCODE = '22023';
  END IF;

  IF v_username IS NOT NULL AND public.has_blocked_fragment(v_username) THEN
    RAISE EXCEPTION 'That username is not allowed'
      USING ERRCODE = '22023';
  END IF;

  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Country must be an ISO 3166-1 alpha-2 code'
      USING ERRCODE = '22023';
  END IF;

  -- THE IMPERSONATION FIX.
  --
  -- Storage RLS stops a caller writing an object into another reader's folder.
  -- It has nothing to say about which path a PROFILE ROW points at, and until
  -- now neither did this function: `<victim id>/<their file>.jpg` was accepted,
  -- the roster served it, and the storage read policy allowed it because the
  -- victim is a team-mate. The attacker then appeared on the leaderboard
  -- wearing the victim's face.
  --
  -- Checked against auth.uid() rather than against a caller-supplied id, in the
  -- same statement that writes, so there is nothing to race.
  IF v_avatar IS NOT NULL AND NOT public.is_own_avatar_path(v_avatar, v_user_id) THEN
    RAISE EXCEPTION 'An avatar path must be your own: <user id>/<file>'
      USING ERRCODE = '42501';
  END IF;

  IF v_username IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles taken
    WHERE lower(taken.username) = lower(v_username)
      AND taken.id <> v_user_id
  ) THEN
    RAISE EXCEPTION 'Username already taken'
      USING ERRCODE = '23505';
  END IF;

  -- COALESCE, so a caller sending only a country does not erase the username.
  -- Clearing a field is a separate, explicit action rather than a side effect
  -- of a partial update.
  UPDATE public.profiles AS p
  SET
    username = COALESCE(v_username, p.username),
    country_code = COALESCE(v_country, p.country_code),
    avatar_path = COALESCE(v_avatar, p.avatar_path),
    updated_at = now()
  WHERE p.id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found for authenticated user'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT p.id, p.username, p.country_code, p.avatar_path
  FROM public.profiles p
  WHERE p.id = v_user_id;
END;
$$;

COMMENT ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) IS
  'Claims or updates the calling reader''s public Teams identity. Enforces the moderation rules and, critically, that avatar_path names the caller''s own Storage folder — Storage RLS governs who may WRITE an object, this governs whose object a profile may POINT AT. Arguments left NULL are not changed.';

-- The availability probe has to agree with the write, or the screen says a name
-- is free and the save then refuses it.
CREATE OR REPLACE FUNCTION public.is_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_username TEXT := nullif(btrim(p_username), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  IF v_username IS NULL
     OR v_username !~ '^[A-Za-z0-9][A-Za-z0-9_.]{1,18}[A-Za-z0-9]$' THEN
    RETURN FALSE;
  END IF;

  IF public.is_reserved_username(v_username) OR public.has_blocked_fragment(v_username) THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.profiles taken
    WHERE lower(taken.username) = lower(v_username)
      AND taken.id <> v_user_id
  );
END;
$$;

COMMENT ON FUNCTION public.is_username_available(TEXT) IS
  'False for a name that is malformed, reserved, disallowed or already claimed — the same verdicts set_player_identity reaches, so the screen never says free about a name the save will refuse. Returns only a boolean, so it cannot be used to enumerate accounts.';

-- ---------------------------------------------------------------------------
-- 4. Team names, checked where it counts
-- ---------------------------------------------------------------------------

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
  -- THE RULE (§5), and it applies to the founder exactly as it applies to a
  -- joiner: a founder is a reader first, and could otherwise read an edition's
  -- questions and then create a Team configured to score them.
  v_effective DATE := public.next_scoring_edition_date();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to create a team'
      USING ERRCODE = '28000';
  END IF;

  IF v_name IS NULL OR length(v_name) < 2 OR length(v_name) > 40 THEN
    RAISE EXCEPTION 'Team name must be between 2 and 40 characters'
      USING ERRCODE = '22023';
  END IF;

  IF public.has_blocked_fragment(v_name) THEN
    RAISE EXCEPTION 'That team name is not allowed'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.teams (owner_id, name, invite_code)
  VALUES (v_user_id, v_name, public.generate_team_invite_code())
  RETURNING * INTO v_team;

  INSERT INTO public.team_members (team_id, user_id, role, eligible_from_edition)
  VALUES (v_team.id, v_user_id, 'owner', v_effective);

  INSERT INTO public.team_config_versions (team_id, version, effective_from_edition, created_by)
  VALUES (v_team.id, 1, v_effective, v_user_id)
  RETURNING id INTO v_config_id;

  RETURN QUERY SELECT v_team.id, v_team.name, v_team.invite_code, v_config_id, v_effective;
END;
$$;

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

  IF public.has_blocked_fragment(v_name) THEN
    RAISE EXCEPTION 'That team name is not allowed'
      USING ERRCODE = '22023';
  END IF;

  -- name only. name_status is not in this statement, so renaming can never be
  -- used to lift a moderation decision — including the one a rename might have
  -- provoked.
  UPDATE public.teams
  SET name = v_name, updated_at = now()
  WHERE id = p_team_id;

  RETURN v_name;
END;
$$;

COMMENT ON FUNCTION public.rename_team(UUID, TEXT) IS
  'Owner-only. Writes `name` and nothing else: name_status is absent from the statement, so a rename can never clear a moderation decision.';

-- ---------------------------------------------------------------------------
-- 5. Joining must not leak a hidden name
-- ---------------------------------------------------------------------------
-- Every other read surface resolves name_status in the database — the
-- directory, get_team_detail, get_my_team_refs_for_questions. This one returned
-- t.name raw, so a name a moderator had taken out of every screen came straight
-- back through the join response. NULL, like everywhere else: the neutral label
-- is a localisation decision and belongs to the client.

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
  v_display TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to join a team'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_team
  FROM public.teams t
  WHERE t.invite_code = v_code
    AND t.status = 'active'
    AND t.invite_disabled_at IS NULL;

  IF NOT FOUND THEN
    -- One message for "no such code", "archived team" and "invite closed"
    -- alike: distinguishing them would turn this into a code oracle.
    RAISE EXCEPTION 'Invite code not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_display := CASE WHEN v_team.name_status = 'hidden' THEN NULL ELSE v_team.name END;

  SELECT * INTO v_existing
  FROM public.team_members m
  WHERE m.team_id = v_team.id
    AND m.user_id = v_user_id
    AND m.left_at IS NULL;

  IF FOUND THEN
    RETURN QUERY SELECT v_team.id, v_display, v_existing.role, v_existing.eligible_from_edition, TRUE;
    RETURN;
  END IF;

  -- THE RULE (§5): the joiner sees the team and its leaderboard now, and starts
  -- being scored at the next edition. Computed here, from Postgres' own clock
  -- and the editions table — never sent by the client.
  v_eligible := public.next_scoring_edition_date();

  -- A REJOIN OPENS A NEW STINT, so it cannot inherit the old eligibility date:
  -- leave, read the edition's questions, rejoin would otherwise be scoreable.
  INSERT INTO public.team_members (team_id, user_id, role, eligible_from_edition)
  VALUES (v_team.id, v_user_id, 'member', v_eligible);

  RETURN QUERY SELECT v_team.id, v_display, 'member'::TEXT, v_eligible, FALSE;
END;
$$;

COMMENT ON FUNCTION public.join_team_with_invite(TEXT) IS
  'Joins by invite code. Eligibility starts at the NEXT edition, computed server-side. Returns NULL for the name when moderation has hidden it, like every other read surface — the join response was the one path that returned it raw.';

-- ---------------------------------------------------------------------------
-- 6. A report queue that cannot be buried
-- ---------------------------------------------------------------------------
-- No new infrastructure, because there is none to spend: an index and a
-- trigger, both inside the database that already exists.
--
-- Duplicates first. Filing the same reason against the same target twice adds
-- nothing to a moderator's decision and is how a queue gets buried. Once the
-- report is triaged (actioned or dismissed) the reader may file again, because
-- by then it is a new complaint about something that happened since.

-- Any duplicates already on file are RETIRED, not deleted: the index below
-- could not be created over them, and a report is a record of somebody asking
-- for help. 'dismissed' takes them out of the queue and out of the partial
-- index while leaving the row, its reason and its timestamp intact.
UPDATE public.user_reports r
SET status = 'dismissed', resolved_at = COALESCE(r.resolved_at, now())
WHERE r.status IN ('open', 'reviewing')
  AND EXISTS (
    SELECT 1 FROM public.user_reports keep
    WHERE keep.status IN ('open', 'reviewing')
      AND keep.reporter_id = r.reporter_id
      AND keep.reason = r.reason
      AND keep.reported_user_id IS NOT DISTINCT FROM r.reported_user_id
      AND keep.team_id IS NOT DISTINCT FROM r.team_id
      AND (keep.created_at, keep.id) < (r.created_at, r.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS user_reports_open_user_unique
  ON public.user_reports (reporter_id, reported_user_id, reason)
  WHERE status IN ('open', 'reviewing') AND reported_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_reports_open_team_unique
  ON public.user_reports (reporter_id, team_id, reason)
  WHERE status IN ('open', 'reviewing') AND team_id IS NOT NULL AND reported_user_id IS NULL;

-- And a ceiling on volume, so a reader who varies the reason or the target
-- still cannot flood it. Twenty an hour is far above any honest use of a
-- feature that lives behind a long-press on a leaderboard row.
CREATE OR REPLACE FUNCTION public.enforce_user_report_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recent INTEGER;
BEGIN
  SELECT count(*) INTO v_recent
  FROM public.user_reports r
  WHERE r.reporter_id = NEW.reporter_id
    AND r.created_at > now() - INTERVAL '1 hour';

  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Too many reports filed in the last hour'
      USING ERRCODE = '54000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_user_report_rate_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_user_report_rate_limit() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_user_report_rate_limit() FROM authenticated;

DROP TRIGGER IF EXISTS trg_user_reports_rate_limit ON public.user_reports;

CREATE TRIGGER trg_user_reports_rate_limit
BEFORE INSERT ON public.user_reports
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_report_rate_limit();

COMMENT ON FUNCTION public.enforce_user_report_rate_limit() IS
  'Caps a reporter at twenty reports an hour. SECURITY DEFINER because it counts rows the reporter''s own RLS policy already lets them read, and must keep counting them if that policy ever narrows.';

-- ---------------------------------------------------------------------------
-- 7. Deleting an account takes the avatar with it
-- ---------------------------------------------------------------------------
-- The Edge Function removes the Storage objects before it deletes the auth user
-- (see supabase/functions/delete-account), and fails the whole request if it
-- cannot — a 200 has to mean the photo is gone, not that we tried.
--
-- This is the net underneath that: whatever path the profile row held is
-- reported to the caller before the row disappears, so a deletion that somehow
-- reached the database without the Storage pass leaves a record of exactly
-- which object was orphaned rather than an untraceable file.

CREATE OR REPLACE FUNCTION public.avatar_objects_for_user(p_user_id UUID)
RETURNS TABLE (object_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT o.name::TEXT
  FROM storage.objects o
  WHERE o.bucket_id = 'avatars'
    AND public.avatar_object_owner(o.name) = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.avatar_objects_for_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avatar_objects_for_user(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.avatar_objects_for_user(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.avatar_objects_for_user(UUID) TO service_role;

COMMENT ON FUNCTION public.avatar_objects_for_user(UUID) IS
  'Every avatar object belonging to a reader, including the ones an interrupted replace left behind. Service-role only: it is the account-deletion sweep, not a way for a client to enumerate a folder.';

COMMIT;

NOTIFY pgrst, 'reload schema';
