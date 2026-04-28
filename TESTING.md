# PersoNewsAP Testing Guide

This guide is for local development, disposable Supabase testing, and small tester handoff. The safe default is no production writes.

## 1. Environment Setup

Install:

- Node.js 20+
- npm
- Expo tooling through `npx expo` or the project scripts
- Xcode + iOS Simulator for iOS testing, or Android Studio + emulator for Android testing
- Optional: Supabase CLI for applying migrations from the terminal

Install dependencies from the repo root:

```sh
npm install
npm --prefix apps/mobile install
npm --prefix services/content-engine install
```

Run the repo smoke check:

```sh
npm run smoke
```

This runs:

```sh
npm run mobile:typecheck
npm run content:build
npm run content:dry-run
```

Run the backend E2E proof after Supabase env is configured:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_DAILY_JOB_TEST=true \
LANGUAGES=en \
USER_LIMIT=3 \
npm run backend:e2e
```

This proof writes marked test content through `daily-job-test`. Use a local, staging, or disposable Supabase project unless you intentionally want marked test rows in the target project.

## Command Safety Map

| Category | Commands | Writes data? | Intended use |
| --- | --- | --- | --- |
| Test commands | `npm run smoke`, `npm run mobile:typecheck`, `npm run content:build`, `npm run content:dry-run` | No | Routine local validation before handoff. |
| Local no-write commands | `npm run content:llm-run`, `npm run supabase:doctor`, `npm run content:debug-users` | No | LLM inspection, static/live read-only schema checks, and user eligibility diagnostics. |
| Local-only dangerous write commands | `npm run backend:e2e`, `npm run backend:e2e:live-rss`, `npm run backend:e2e:llm`, `npm run content:persist-test`, `npm run content:assign-test-users`, `npm run content:personalize-test`, `npm run content:daily-job-test`, `npm run content:cleanup-test` | Yes | Disposable or staging Supabase testing with explicit confirmation flags. |
| Production commands | `npm run content:daily-job` | Yes unless `DRY_RUN=true` | Production-shaped scheduler command. It is not wired to unattended scheduling or monitoring yet. |

Dangerous write commands require `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the command-specific `CONFIRM_*` flag. Treat them as staging/test tools unless a production owner intentionally accepts test rows in production. `content:daily-job` does not use a test confirmation flag, so run it with `DRY_RUN=true` until the production environment, scheduler, monitoring, source rights, and editorial review workflow are explicitly approved.

## 2. Environment Safety

Local env files are ignored. Confirm with:

```sh
git check-ignore -v --no-index .env apps/mobile/.env services/content-engine/.env supabase/.temp
```

Use `apps/mobile/.env` only for public client keys:

```sh
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_LIVE_DATA_PROOF_MODE=false
```

Use `services/content-engine/.env` or a local shell only for server-side keys:

```sh
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
OPENAI_API_KEY=...
```

Never put service role keys, OpenAI keys, Resend keys, generation secrets, or production credentials in Expo, Vite, checked-in files, logs, screenshots, or issue comments.

## 3. Supabase Setup

Use a local, disposable, or explicitly selected staging Supabase project for tester prep.

1. Create or select a Supabase project.
2. Apply migrations in `supabase/migrations` in filename order.
3. In Supabase Auth, enable email/password auth.
4. For a small tester group, decide whether to disable email confirmation temporarily or manually confirm tester accounts in the dashboard.
5. Copy the project URL and anon key into `apps/mobile/.env`.
6. Keep the service role key only in `services/content-engine/.env` or a server-side shell.

With Supabase CLI, the usual remote flow is:

```sh
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

If not using the CLI, paste and run each SQL migration in the Supabase SQL editor in order.

Run the production-beta SQL verification after migrations are applied and two tester users exist:

```sh
cd ~/personewsap
export DATABASE_URL="postgresql://postgres:...@db.YOUR_PROJECT_REF.supabase.co:5432/postgres"
export SUPABASE_VERIFY_USER_A="tester-a-auth-user-id"
export SUPABASE_VERIFY_USER_A_EMAIL="tester-a@example.com"
export SUPABASE_VERIFY_USER_B="tester-b-auth-user-id"
export SUPABASE_VERIFY_PUBLISHED_CONTENT_ID="published-content-item-id"
./scripts/run-supabase-verification.sh
```

Expected output:

- the schema doctor reports required tables, RLS, policies, and topics
- the constraint audit reports no duplicate daily drops, drop items, complete rows, or save rows
- the RLS matrix reports PASS for anon isolation, authenticated own-row access, and client-side daily-drop write blocking
- the rollbacked service-role probe reports PASS for content and daily-drop writes

If `constraints_and_duplicates.sql` reports duplicate complete/save interactions, clean or archive those duplicate test rows before applying the beta hardening migration. Rating feedback remains append-only by design.

## 4. Mobile Setup

From the repo root:

```sh
cp apps/mobile/.env.example apps/mobile/.env
npm --prefix apps/mobile run ios
```

Use Android or Expo launcher when needed:

```sh
npm --prefix apps/mobile run android
npm --prefix apps/mobile run start
```

Local mobile checks:

- Sign up or log in.
- Complete onboarding: language, goal, topics, article count, frequency.
- Open Account and confirm the tester user id is visible.
- Open Today and Library.
- Confirm the app clearly labels live data versus preview/mock mode.

## 5. Content-Engine Setup

From the repo root:

```sh
npm run content:build
npm run content:dry-run
npm run supabase:doctor
```

`content:dry-run` uses local sample articles and prints JSON. It does not need Supabase, API keys, LLM calls, or production data.

Optional live RSS smoke check:

```sh
npm --prefix services/content-engine run dry-run -- --live-rss
LIVE_RSS=true npm --prefix services/content-engine run dry-run
```

The live RSS check is read-only and may show source failures from remote feeds. That is acceptable when the command still completes and logs per-source health. Look for `rss_connector_health`, `rss_source_health`, and stale-item diagnostics in stderr. Useful diagnostic controls:

```sh
LIVE_RSS=true RSS_TIMEOUT_MS=10000 RSS_ARTICLES_PER_SOURCE=3 npm --prefix services/content-engine run dry-run
LIVE_RSS=true RSS_ALLOW_STALE=true npm --prefix services/content-engine run dry-run
```

Use `RSS_ALLOW_STALE=true` only to inspect slow-moving feeds; keep it unset for normal test runs.

Optional LLM generation, still without Supabase writes:

```sh
OPENAI_API_KEY=... npm run content:llm-run -- --language en
```

Read-only live schema/RLS check against a selected Supabase project:

```sh
SUPABASE_URL=... \
SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run supabase:doctor -- --live
```

## 6. Backend E2E Proof

Use this when you want to say the backend is ready except prompts/content quality.

Exact command sequence:

```sh
cd ~/personewsap
npm run smoke

SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_DAILY_JOB_TEST=true \
LANGUAGES=en \
USER_LIMIT=3 \
npm run backend:e2e
```

`npm run backend:e2e` runs:

- mobile typecheck
- content-engine build
- content-engine dry-run
- `debug-users`
- `daily-job-test`
- `daily-job-test` again on the same date to verify idempotent daily-drop updates

Pass criteria printed by the command:

- required server env is present and explicit confirmation is true
- mobile typecheck passes
- content-engine builds
- dry-run generates content and has no language mismatch
- `debug-users` can read eligible app-user state
- `daily-job-test` generates and stores content
- if eligible users exist, at least one user is assigned
- second `daily-job-test` run updates an existing daily drop when eligible users exist

Optional live RSS proof:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_DAILY_JOB_TEST=true \
LANGUAGES=en \
USER_LIMIT=3 \
npm run backend:e2e:live-rss
```

Optional LLM proof:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_DAILY_JOB_TEST=true \
OPENAI_API_KEY="<openai-key>" \
LANGUAGES=en \
USER_LIMIT=3 \
npm run backend:e2e:llm
```

The LLM proof is not required for smoke readiness.

## 7. Daily Drop Generation For Testers

### No-write dry run

Use this before every tester handoff:

```sh
npm run content:dry-run
```

Confirm the output contains:

- `persisted: false`
- one or more daily drops
- newsletter, business story, mini-case, and concept slots
- source URLs and dates

### Assign one real tester

1. Start the mobile app.
2. Create/sign in as the tester.
3. Complete onboarding.
4. Open Account and copy the tester user id.
5. In a separate terminal, run:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_PERSIST_TEST=true \
TEST_USER_ID="00000000-0000-0000-0000-000000000000" \
npm --prefix services/content-engine run persist-test -- --date "$(date +%F)" --language en
```

Save the JSON output, especially:

- `testRunId`
- `mobileProof.daily_drop_id`
- `mobileProof.expected_today_event`
- `mobileProof.expected_library_event`
- `mobileProof.expected_interaction_event`

Expected proof events in the Metro terminal:

- `[Profile proof]` with `event: "profile_saved"` or `event: "profile_exists"`
- `[Onboarding proof]` with `event: "profile_saved"`
- `[Onboarding proof]` with `event: "user_preferences_saved"`
- `[Onboarding proof]` with `event: "onboarding_saved"`
- `[Onboarding proof]` with `event: "daily_job_test_eligible"`
- `[Today data proof]` with `event: "live_daily_drop"`
- `[Library data proof]` with `event: "live_library_drops"`
- `[Content interaction proof]` with `event: "interaction_write_success"`

For a stricter proof run, set this in `apps/mobile/.env`, restart Expo, and treat any mock fallback console error as proof failure:

```sh
EXPO_PUBLIC_LIVE_DATA_PROOF_MODE=true
```

In proof mode, Today and Library still render fallback content to keep the app usable, but `[Today data proof]` or `[Library data proof]` with `event: "mock_fallback"` is emitted as `console.error` and must not be accepted as live proof.

The `persist-test` output proves the assignment layer when:

- `drop.user_daily_drops_created` is `1`, or `drop.user_daily_drops_updated` is `1` for a rerun on the same user/date.
- `mobileProof.daily_drop_id` is not `null`.
- `drop.stale_daily_drop_items_removed` and `drop.duplicate_daily_drop_items_skipped` are recorded for reruns.

### Assign a small tester group

Use this only after testers have created accounts and completed onboarding.

First create a published, marked test content set:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_PERSIST_TEST=true \
TEST_USER_ID="first-tested-user-id" \
npm --prefix services/content-engine run persist-test -- --date "$(date +%F)" --language en
```

Then assign that marked content to up to five app users with preferences:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_ASSIGN_TEST=true \
npm --prefix services/content-engine run assign-test-users -- --limit 5
```

To assign already-published, non-test content by app preferences during a controlled staging rehearsal, use `personalize-test`. This is a dangerous write command and should not be used as the default tester flow:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_PERSONALIZE_TEST=true \
npm run content:personalize-test -- --date "$(date +%F)" --limit 3
```

For a larger rehearsal, `daily-job-test` can generate, persist, and assign marked test drops, but treat it as a staging-only operation:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_DAILY_JOB_TEST=true \
USER_LIMIT=5 \
LANGUAGES=fr,en \
npm --prefix services/content-engine run daily-job-test
```

From `services/content-engine`, the same language coverage commands are:

```sh
LANGUAGES=fr,en npm run daily-job-test
LANGUAGES=fr,en npm run debug-users
```

For the production scheduler command, prove the no-write path first:

```sh
cd services/content-engine
DRY_RUN=true LANGUAGES=fr,en CONTENT_STATUS=published USE_LLM=false LIVE_RSS=false npm run daily-job
```

Cron or GitHub Actions should later use the same `npm run daily-job` command without `DRY_RUN=true`, with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and, when `USE_LLM=true`, `OPENAI_API_KEY` supplied as server-side secrets.

## 8. App Manual Test Flow

Use this as the core QA path:

1. Install or open the Expo build.
2. Create a new account with a tester email.
3. Complete onboarding.
4. Copy the user id from Account.
5. Assign a test daily drop to that user.
6. Reload Today.
7. Confirm Today says `Live daily drop`, not `Preview mode`.
8. Read each daily-drop module.
9. Tap Complete on at least one item.
10. Tap Save on at least one item.
11. Rate one item Good, Average, or Bad.
12. Open Library.
13. Confirm the assigned drop appears.
14. Confirm saved/completed state is reflected where applicable.
15. Log out and log back in.
16. Confirm Today and Library still load.

For the tester-facing version, use [TESTER_SCRIPT_15_MIN.md](TESTER_SCRIPT_15_MIN.md).

## 8. Real Data Path Audit

Use this audit during the live proof run. Each row should have one positive signal before the proof is considered complete.

| Layer | Table or feature | Proof signal |
| --- | --- | --- |
| Signup/profile | `profiles` | `[Profile proof]` logs `profile_saved` or `profile_exists` for the tester. |
| Onboarding | `profiles` | `[Onboarding proof]` logs `profile_saved` with the selected language. |
| Preferences | `user_preferences` | `[Onboarding proof]` logs `user_preferences_saved` with goal, frequency, and article count. |
| Topics | `user_topic_preferences` | `[Onboarding proof]` logs `onboarding_saved` with enabled topic count. |
| Assignment eligibility | `profiles` + `user_preferences` + `user_topic_preferences` | `[Onboarding proof]` logs `daily_job_test_eligible`. |
| Content | `content_items` | `persist-test` returns marked `storedContentItems` for newsletter, business story, mini-case, and concept. |
| Assignment | `daily_drops` | `persist-test` returns `mobileProof.daily_drop_id`. |
| Assignment links | `daily_drop_items` | `persist-test` returns stored item count and assignment counters without throwing. |
| Today | Supabase fetch | `[Today data proof]` logs `live_daily_drop`. |
| Library | Supabase fetch | `[Library data proof]` logs `live_library_drops`. |
| Interactions | `content_interactions` | `[Content interaction proof]` logs `interaction_write_success`. |

Interaction write behavior:

- Complete and Save run a preflight read and skip duplicate writes with `event: "interaction_write_skipped"` and `outcome: "already_exists"`.
- Repeating the same rating skips with `outcome: "unchanged"`.
- Changing the rating writes a new feedback event; Today reads feedback by `created_at` order, so the latest rating is the visible rating.

## 9. Troubleshooting

### App shows Preview mode

Check the Metro terminal proof log:

- `missing_auth_session`: tester is not signed in.
- `missing_supabase_config`: `apps/mobile/.env` is missing public Supabase keys.
- `no_supabase_data`: no published daily drop is assigned to this user/date.
- `daily_drop_has_no_displayable_items`: daily drop exists but linked items are incomplete.
- `supabase_error`: inspect the logged Supabase error.

### Tester cannot save or complete content

Check:

- The app is using live data, not mock fallback.
- The tester is signed in.
- `content_interactions` RLS policies are applied.
- The Metro terminal prints `[Content interaction proof]`.

### Onboarding does not persist

Check:

- Auth session exists.
- Migrations are applied.
- `profiles`, `user_preferences`, and `user_topic_preferences` allow the authenticated user to write their own rows.
- The app was restarted after changing env vars.

### Content engine refuses to write

This is usually expected. Persistence commands fail closed unless the required confirmation flag and server-side env vars are set:

- `CONFIRM_PERSIST_TEST=true`
- `CONFIRM_ASSIGN_TEST=true`
- `CONFIRM_DAILY_JOB_TEST=true`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Cleanup

For draft persist-test content:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_CLEANUP_TEST=true \
npm --prefix services/content-engine run cleanup-test -- --test-run-id persist-test-...
```

Cleanup intentionally does not delete published assigned drops, users, preferences, sources, or production-like content. Inspect published test rows manually before deleting anything else.

## 10. Release Readiness Gate

Before inviting testers:

- `npm run smoke` passes.
- Env files are ignored and no real keys are committed.
- Supabase migrations are applied to the tester project.
- At least one account can sign up, complete onboarding, receive a live daily drop, save/complete/rate content, see Library, log out, and log back in.
- Known issues are documented in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- TestFlight gaps are reviewed in [TESTFLIGHT_READINESS.md](TESTFLIGHT_READINESS.md).
