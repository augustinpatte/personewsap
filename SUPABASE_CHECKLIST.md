# Supabase Verification Checklist

This checklist validates the PersoNewsAP MVP schema and RLS setup before testers use the mobile app. It does not apply migrations automatically.

## What The Current Migration Should Create

The app-facing schema is defined in `supabase/migrations/20260426120000_mobile_app_foundation.sql`. It should create these app tables:

- `profiles`
- `user_preferences`
- `user_topic_preferences`
- `topics`
- `content_items`
- `sources`
- `daily_drops`
- `daily_drop_items`
- `content_interactions`

Supporting content-engine tables include `generation_runs`, `content_item_sources`, `mini_case_responses`, plus the legacy newsletter tables kept for compatibility.

The same migration enables RLS on the app-facing tables and defines policies for own-profile/preferences access, active topic reads, published content reads, own daily drop reads, and own interaction writes.

Expected seeded topics:

- `business`
- `finance`
- `tech_ai`
- `law`
- `medicine`
- `engineering`
- `sport_business`
- `culture_media`

## Apply Migrations Manually

Local Supabase:

```sh
supabase start
supabase db reset
```

Linked remote project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Do not run these against production unless you intentionally mean to migrate production.

## Repair Migration History

If the remote database already has schema changes but Supabase migration history is out of sync, inspect first:

```sh
supabase migration list
supabase db diff --linked
```

Repair only after confirming which migration was actually applied:

```sh
supabase migration repair --status applied 20260426120000
supabase migration list
```

Use `reverted` instead of `applied` only when you are certain the migration was not applied. Do not guess; a wrong repair can hide real drift.

## Static Schema Doctor

Run this without any keys. It reads local migration files only.

```sh
node scripts/supabase-schema-doctor.mjs
```

Strict mode exits non-zero on warnings:

```sh
node scripts/supabase-schema-doctor.mjs --strict
```

## Live Read-Only Checks

Run against a local or disposable project first. The doctor does not write data and does not print keys.

```sh
SUPABASE_URL=... \
SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/supabase-schema-doctor.mjs --live
```

For authenticated RLS checks, add a short-lived tester access token. `OTHER_USER_ID` should be a real second tester id that has or can receive a daily drop; a random id only proves that nonexistent rows are hidden.

```sh
SUPABASE_URL=... \
SUPABASE_ANON_KEY=... \
TEST_USER_ACCESS_TOKEN=... \
OTHER_USER_ID=00000000-0000-0000-0000-000000000000 \
node scripts/supabase-schema-doctor.mjs --live
```

The authenticated check verifies:

- active topics are visible
- published `content_items` are readable by an authenticated user
- `daily_drops` returned to the tester belong only to that tester
- querying another user id returns no daily drops

## SQL Doctor

For catalog-level RLS and policy checks, run:

```sql
-- Supabase SQL editor:
-- paste supabase/verification/schema_doctor.sql
```

Or with psql:

```sh
psql "$SUPABASE_DB_URL" -f supabase/verification/schema_doctor.sql
```

The SQL doctor checks:

- required tables exist
- topics are seeded and active
- RLS is enabled on app-facing tables
- expected policy names exist
- there is published content/daily drop data available for app-read tests

## Verify One Test User Receives One Drop

1. Create or choose one test auth user.
2. Complete mobile onboarding so the user has:
   - one `profiles` row
   - one `user_preferences` row
   - at least one `user_topic_preferences` row
3. Persist a tiny test drop with explicit confirmation. This is the service-role write verification path; the schema doctor stays read-only by design.

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_PERSIST_TEST=true \
TEST_USER_ID=00000000-0000-0000-0000-000000000000 \
npm --prefix services/content-engine run persist-test
```

4. Confirm the output reports `user_daily_drops_created: 1`.
5. Open the mobile app as that user and confirm Today says `Live daily drop`.
6. Record the returned `test_run_id`.

Cleanup draft test content when applicable:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_CLEANUP_TEST=true \
npm --prefix services/content-engine run cleanup-test -- --test-run-id persist-test-...
```

Note: `cleanup-test` intentionally deletes only draft persist-test content. If you created a published test drop for a real test user, inspect and clean it manually only after confirming the rows are test data.

## What Is Still Manual

- Applying migrations to a remote project.
- Repairing migration history after drift.
- Creating tester users and collecting short-lived access tokens.
- Proving service-role writes end to end with `persist-test`.
- Cleaning up published test assignments created for a real tester.
