-- The edition as a first-class temporal unit — PRODUCTION project.
--
-- Everything Teams needs to be fair depends on one question having a single
-- server-side answer: *which edition are we in, and is it still open?*
--
-- Until now that answer only existed implicitly. `daily_drops` carries a
-- `drop_date` per reader, the publisher works from an `edition_date` computed in
-- Europe/Paris at 19:00, and the mobile client mirrors the Mon/Wed/Fri/Sun
-- cadence in TypeScript. That is enough to hand a reader their edition, and it
-- is not enough to close a leaderboard: closing needs a single row that says
-- when an edition became the current one, agreed on by every reader in a team
-- regardless of where their phone thinks it is.
--
-- So this registers editions, and only that. It does not schedule, publish,
-- generate or notify. It is additive in the strict sense: no existing table is
-- retyped, no existing function is redefined, no existing policy is loosened,
-- and the publication pipeline keeps working unchanged whether or not anything
-- ever reads these rows.
--
-- PRODUCT DECISION recorded here (Prompt 1, §15): an edition is open until the
-- NEXT edition publishes. Not "until local midnight" — that is precisely the
-- timezone bug that `resolveReaderEditionDate` was written to fix, and
-- reintroducing it for scoring would let two members of the same team have
-- different deadlines for the same question.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The cadence, in SQL
-- ---------------------------------------------------------------------------
-- Mirrors services/content-engine/src/scheduler/editionCadence.ts and
-- apps/mobile/src/features/today/editionCadence.ts. Kept as its own function so
-- the three copies can be diffed, and so nothing below hardcodes a weekday.
--
-- Deliberately NOT named resolve_staging_edition_kind: that one lives in the
-- staging project and answers about the staging batch pipeline. This one is
-- about the production calendar and must be free to diverge.

CREATE OR REPLACE FUNCTION public.resolve_edition_kind(p_edition_date DATE)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE EXTRACT(DOW FROM p_edition_date)::INT
    WHEN 1 THEN 'daily'          -- Monday
    WHEN 3 THEN 'daily'          -- Wednesday
    WHEN 5 THEN 'daily'          -- Friday
    WHEN 0 THEN 'weekly_digest'  -- Sunday
    ELSE NULL                    -- Tue / Thu / Sat are quiet days
  END;
$$;

COMMENT ON FUNCTION public.resolve_edition_kind(DATE) IS
  'The editorial kind of a publication date, or NULL on a quiet day. Mirrors the Mon/Wed/Fri daily + Sunday weekly_digest cadence held in the content engine and the mobile client.';

-- The next date the calendar would publish on, strictly after the given one.
-- Used to work out which edition a mid-edition joiner becomes eligible for,
-- before that edition exists as a row.
CREATE OR REPLACE FUNCTION public.next_edition_date_after(p_edition_date DATE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT candidate
  FROM generate_series(p_edition_date + 1, p_edition_date + 7, INTERVAL '1 day') AS candidate
  WHERE public.resolve_edition_kind(candidate::DATE) IS NOT NULL
  ORDER BY candidate
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.next_edition_date_after(DATE) IS
  'The first cadence publication date strictly after the argument. Always resolves within 7 days because the cadence has at least one publication per week.';

-- ---------------------------------------------------------------------------
-- 2. The registry
-- ---------------------------------------------------------------------------
-- One row per edition that actually published. `published_at` is the instant
-- the first reader''s drop for that date went live, which is the only honest
-- definition available server-side and the one that makes ordering total.
--
-- There is no `closes_at` column on purpose. A stored closing time would have
-- to be written by a second process and could drift from reality; the closing
-- time of an edition simply *is* the publication time of the next one, and
-- `public.edition_closes_at()` below derives it. Nothing to backfill, nothing
-- to keep in step.

CREATE TABLE IF NOT EXISTS public.editions (
  edition_date DATE PRIMARY KEY,
  edition_kind TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT editions_edition_kind_check CHECK (edition_kind IN ('daily', 'weekly_digest'))
);

-- Ordering is by publication instant, never by date: two editions can only be
-- compared by when they went live.
CREATE UNIQUE INDEX IF NOT EXISTS idx_editions_published_at
  ON public.editions(published_at, edition_date);

COMMENT ON TABLE public.editions IS
  'One row per PersoNewsAP edition that has published. The unit of time for Team scoring, streaks and leaderboard closing. An edition is open from its published_at until the next edition''s published_at.';

-- ---------------------------------------------------------------------------
-- 3. Resolution
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_edition_date(p_at TIMESTAMPTZ DEFAULT now())
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT e.edition_date
  FROM public.editions e
  WHERE e.published_at <= p_at
  ORDER BY e.published_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_edition_date(TIMESTAMPTZ) IS
  'The edition open at the given instant: the most recently published one. NULL before the first edition has ever published.';

CREATE OR REPLACE FUNCTION public.edition_closes_at(p_edition_date DATE)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT MIN(next_edition.published_at)
  FROM public.editions AS next_edition
  WHERE next_edition.published_at > (
    SELECT this_edition.published_at
    FROM public.editions AS this_edition
    WHERE this_edition.edition_date = p_edition_date
  );
$$;

COMMENT ON FUNCTION public.edition_closes_at(DATE) IS
  'When an edition stopped counting for Team scoring: the publication instant of the following edition, or NULL while it is still the current one.';

CREATE OR REPLACE FUNCTION public.is_edition_open(
  p_edition_date DATE,
  p_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.editions e WHERE e.edition_date = p_edition_date
  )
  AND COALESCE(public.edition_closes_at(p_edition_date) > p_at, TRUE);
$$;

COMMENT ON FUNCTION public.is_edition_open(DATE, TIMESTAMPTZ) IS
  'True while an edition still accepts scoring. False for an unregistered edition and for one the next edition has already replaced.';

-- The edition a reader who joins right now should first be scored in.
-- Falls back to the calendar when nothing has published yet, so a brand-new
-- database still answers.
CREATE OR REPLACE FUNCTION public.next_scoring_edition_date(p_at TIMESTAMPTZ DEFAULT now())
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.next_edition_date_after(
    COALESCE(
      public.current_edition_date(p_at),
      (p_at AT TIME ZONE 'Europe/Paris')::DATE - 1
    )
  );
$$;

COMMENT ON FUNCTION public.next_scoring_edition_date(TIMESTAMPTZ) IS
  'The first edition after the one currently open. Used as team_members.eligible_from_edition so that joining mid-edition never lets someone score on questions they may already have seen.';

-- ---------------------------------------------------------------------------
-- 4. Registration
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_edition(
  p_edition_date DATE,
  p_published_at TIMESTAMPTZ DEFAULT now(),
  p_edition_kind TEXT DEFAULT NULL
)
RETURNS public.editions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_edition public.editions;
BEGIN
  INSERT INTO public.editions (edition_date, edition_kind, published_at)
  VALUES (
    p_edition_date,
    -- A date outside the cadence can still have published (a manual catch-up
    -- run, historic test data). It is registered as 'daily' rather than
    -- refused: if readers received it, it is an edition, and the sequence must
    -- reflect what happened rather than what the calendar expected.
    COALESCE(p_edition_kind, public.resolve_edition_kind(p_edition_date), 'daily'),
    p_published_at
  )
  ON CONFLICT (edition_date) DO NOTHING;

  SELECT * INTO v_edition FROM public.editions WHERE edition_date = p_edition_date;

  RETURN v_edition;
END;
$$;

REVOKE ALL ON FUNCTION public.register_edition(DATE, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_edition(DATE, TIMESTAMPTZ, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.register_edition(DATE, TIMESTAMPTZ, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_edition(DATE, TIMESTAMPTZ, TEXT) TO service_role;

COMMENT ON FUNCTION public.register_edition(DATE, TIMESTAMPTZ, TEXT) IS
  'Server-only. Records that an edition published. Idempotent: the first registration of a date wins, so a re-run of the publisher cannot move an edition''s closing time and rewrite a settled leaderboard.';

-- The publisher does not call register_edition yet, and nothing in this pass
-- changes it. This trigger is what keeps the registry true in the meantime: the
-- moment a reader's drop is published, the edition it belongs to exists.
--
-- ON CONFLICT DO NOTHING against a primary key, so the cost per drop is one
-- index probe and the *first* drop of the edition is the one that sets
-- published_at. That is deliberate — it makes the registered instant the moment
-- the edition became readable by anyone, which is the instant the previous
-- edition stopped counting.
CREATE OR REPLACE FUNCTION public.register_edition_from_daily_drop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.editions (edition_date, edition_kind, published_at)
  VALUES (
    NEW.drop_date,
    COALESCE(public.resolve_edition_kind(NEW.drop_date), 'daily'),
    COALESCE(NEW.published_at, now())
  )
  ON CONFLICT (edition_date) DO NOTHING;

  RETURN NULL;
END;
$$;

-- A trigger function has no business being callable as an RPC. It takes no
-- arguments, so a direct call would fail on the unset NEW record anyway — but
-- "fails confusingly" is not an access control decision, and SECURITY DEFINER
-- routines reachable from a client key are exactly what the 20260825150000
-- hardening pass had to go back and clean up.
REVOKE ALL ON FUNCTION public.register_edition_from_daily_drop() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_edition_from_daily_drop() FROM anon;
REVOKE ALL ON FUNCTION public.register_edition_from_daily_drop() FROM authenticated;

DROP TRIGGER IF EXISTS trg_daily_drops_register_edition ON public.daily_drops;

CREATE TRIGGER trg_daily_drops_register_edition
AFTER INSERT OR UPDATE OF status ON public.daily_drops
FOR EACH ROW
WHEN (NEW.status = 'published')
EXECUTE FUNCTION public.register_edition_from_daily_drop();

COMMENT ON FUNCTION public.register_edition_from_daily_drop() IS
  'AFTER trigger on daily_drops. Registers the edition the moment its first drop publishes. Writes nothing else and never blocks the publication: the INSERT is a no-op once the edition exists.';

-- ---------------------------------------------------------------------------
-- 5. Backfill
-- ---------------------------------------------------------------------------
-- Every edition readers already hold, so streaks and archive scoring have a
-- complete sequence from day one rather than starting at the next publication.

INSERT INTO public.editions (edition_date, edition_kind, published_at)
SELECT
  dd.drop_date,
  COALESCE(public.resolve_edition_kind(dd.drop_date), 'daily'),
  MIN(COALESCE(dd.published_at, dd.generated_at, dd.created_at))
FROM public.daily_drops dd
WHERE dd.status IN ('published', 'read', 'archived')
GROUP BY dd.drop_date
ON CONFLICT (edition_date) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Access
-- ---------------------------------------------------------------------------
-- The edition calendar is not reader-specific and carries nothing private: a
-- signed-in reader may read it (the mobile client needs the closing time to
-- show "this edition closes when the next one drops"). Nobody writes it from
-- the client.

ALTER TABLE public.editions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read the edition calendar" ON public.editions;

CREATE POLICY "Authenticated users can read the edition calendar"
ON public.editions
FOR SELECT
USING (auth.role() = 'authenticated');

REVOKE ALL ON TABLE public.editions FROM PUBLIC;
REVOKE ALL ON TABLE public.editions FROM anon;
GRANT SELECT ON TABLE public.editions TO authenticated;
GRANT ALL ON TABLE public.editions TO service_role;

REVOKE ALL ON FUNCTION public.resolve_edition_kind(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_edition_date_after(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_edition_date(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edition_closes_at(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_edition_open(DATE, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_scoring_edition_date(TIMESTAMPTZ) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_edition_kind(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_edition_date_after(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_edition_date(TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.edition_closes_at(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_edition_open(DATE, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_scoring_edition_date(TIMESTAMPTZ) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
