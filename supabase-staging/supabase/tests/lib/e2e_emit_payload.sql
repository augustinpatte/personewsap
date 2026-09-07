-- Build one real edition in the local STAGING database and emit the validated
-- payload the production publisher would receive.
--
-- Concatenated after tests/lib/edition_fixture.sql by scripts/teams-e2e-local.mjs.
--
-- COMMITTED, not rolled back. This is the source half of a two-database E2E:
-- the payload has to survive the connection so the driver can carry it to the
-- production stack. The staging stack is a disposable local container rebuilt
-- by `supabase db reset --workdir supabase-staging`, so leaving a batch behind
-- costs nothing; the production side is where the assertions live.
--
-- The date is passed in as :edition_date. It has to be a Monday, Wednesday,
-- Friday or Sunday or resolve_staging_edition_kind returns NULL and the gate
-- correctly answers "no edition is due".

-- The batch, exactly as the gate suite builds it: 23 jobs, 16/1/6, FR+EN,
-- scored questions, approved reviews.
select pg_temp.mk_edition(:'edition_date'::date, 'daily') as batch_id \gset

-- The single entry point the scheduled publisher uses. Anything less than a
-- passing gate here means the payload below is not one production would ever
-- have been offered.
select public.get_scheduled_edition_publish_plan(:'edition_date'::date)::text;
