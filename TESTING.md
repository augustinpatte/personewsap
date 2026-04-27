# PersoNewsAP Testing

This is the lightweight MVP test flow for local development and tester handoff. It avoids production writes by default.

## Install

```sh
npm install
npm --prefix apps/mobile install
npm --prefix services/content-engine install
```

## Smoke Test

Run the main smoke flow from the repo root:

```sh
npm run smoke
```

This runs:

```sh
npm run mobile:typecheck
npm run content:build
npm run content:dry-run
```

## Environment Safety

Local env files are ignored:

```sh
git check-ignore -v --no-index .env apps/mobile/.env services/content-engine/.env supabase/.temp
```

Use `apps/mobile/.env` only for public Expo variables:

```sh
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Use `services/content-engine/.env` or a local shell for server-only keys:

```sh
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=your-openai-key
```

Never put service role keys, OpenAI keys, Resend keys, or generation secrets in Expo, Vite, checked-in files, logs, screenshots, or issue comments.

## Supabase Setup

1. Create or select a local/disposable Supabase project.
2. Apply the SQL migrations in `supabase/migrations`.
3. Copy the project URL and anon key into `apps/mobile/.env`.
4. Keep the service role key only in a server-side shell or `services/content-engine/.env`.
5. Create at least one test user and complete preferences before testing assigned daily drops.

Do not run persistence commands against production unless you deliberately intend to write test rows there.

## Mobile Simulator

From the repo root:

```sh
cd apps/mobile
npm run ios
```

Manual checks:

- Sign in or create a tester account.
- Complete onboarding and preferences.
- Confirm Today loads either live content or a readable empty/mock state.
- Open Library and Account.
- Verify back navigation, loading states, and error messages are readable.

## Content Engine

From the repo root:

```sh
npm run content:build
npm run content:dry-run
```

Optional LLM check, with a server-side OpenAI key:

```sh
OPENAI_API_KEY=... npm --prefix services/content-engine run llm-run
```

## Persistence Test

First verify the guard fails closed when env is missing:

```sh
env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY -u CONFIRM_PERSIST_TEST npm --prefix services/content-engine run persist-test
```

To write test content to a local/disposable Supabase project:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_PERSIST_TEST=true \
npm --prefix services/content-engine run persist-test
```

To assign the test drop to one known test user:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_PERSIST_TEST=true \
TEST_USER_ID=00000000-0000-0000-0000-000000000000 \
npm --prefix services/content-engine run persist-test
```

Save the returned `test_run_id`, then clean up draft test content when finished:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_CLEANUP_TEST=true \
npm --prefix services/content-engine run cleanup-test -- --test-run-id persist-test-...
```

## Live Data Proof Harness

Use this flow when a new tester needs to prove the mobile app is reading a real assigned Supabase daily drop, not the built-in mock preview. Run it only against a local or disposable Supabase project unless you deliberately intend to write test rows.

### 1. Configure Mobile Env

Create `apps/mobile/.env` with public Expo keys only:

```sh
cat apps/mobile/.env.example
```

`apps/mobile/.env` must contain:

```sh
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Do not put the service role key in `apps/mobile/.env`.

### 2. Sign Up And Complete Onboarding

Start the app from the repo root:

```sh
npm --prefix apps/mobile run ios
```

In the simulator:

- Create a tester account or sign in.
- Complete onboarding: language, goal, topics, article count, and frequency.
- Open Supabase Dashboard -> Authentication -> Users and copy the tester auth user id.

### 3. Persist And Assign A Test Drop

In a separate terminal from the repo root, set server-only env vars in that shell:

```sh
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export TEST_USER_ID="00000000-0000-0000-0000-000000000000"
export DROP_DATE="$(date +%F)"
```

Persist marked test content and assign it directly to the tester:

```sh
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
CONFIRM_PERSIST_TEST=true \
TEST_USER_ID="$TEST_USER_ID" \
npm --prefix services/content-engine run persist-test -- --date "$DROP_DATE" --language en
```

Save the JSON output fields:

- `testRunId`
- `mobileProof.daily_drop_id`
- `mobileProof.test_user_id`
- `mobileProof.expected_today_log_prefix`
- `mobileProof.expected_today_event`
- `mobileProof.expected_library_log_prefix`
- `mobileProof.expected_library_event`
- `mobileProof.expected_interaction_log_prefix`
- `mobileProof.expected_interaction_event`

For a valid live-data proof, `drop.user_daily_drops_created` must be `1` and `mobileProof.daily_drop_id` must not be `null`.

### 4. Prove Today Fetches Live Data

Restart the mobile app if it was already open:

```sh
npm --prefix apps/mobile run ios
```

Open Today while signed in as the same tester. The app UI should show the live state, and the Metro/Expo terminal should print:

```text
[Today data proof] ... event: "live_daily_drop" ...
```

The log should include the assigned `daily_drop_id`, `drop_date`, `language`, and `item_count`. If the terminal prints this instead, the app is not in live proof mode:

```text
[Today data proof] ... event: "mock_fallback" ...
```

Mock fallback reasons are explicit: `missing_auth_session`, `missing_supabase_config`, `no_supabase_data`, `daily_drop_has_no_displayable_items`, or `supabase_error`.

### 5. Prove Library Fetches Live Data

Open the Library tab. The Metro/Expo terminal should print:

```text
[Library data proof] ... event: "live_library_drops" ...
```

The log should include `drop_count`, `latest_drop_date`, and a redacted `user_id`. If it prints `event: "mock_fallback"`, inspect the logged `reason` before treating the Library result as live.

### 6. Prove Interaction Writes

On Today, tap one real content item interaction:

- `Complete`
- `Save`
- `Good`, `Average`, or `Bad`

The app should update visible state immediately. The Metro/Expo terminal should print:

```text
[Content interaction proof] ... event: "interaction_write_success" ...
```

That proves the mobile app inserted a row into `content_interactions` for the authenticated user and real `content_item_id`. If the terminal prints `interaction_write_failed`, the app should show a readable error and stay usable.

### 7. Clean Up Draft Test Content

If the test run created draft content, clean it up with the saved `testRunId`:

```sh
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
CONFIRM_CLEANUP_TEST=true \
npm --prefix services/content-engine run cleanup-test -- --test-run-id persist-test-...
```

When `TEST_USER_ID` is set, `persist-test` publishes the assigned test content so Today can read it. Cleanup only removes draft persist-test content; inspect assigned published test rows manually before deleting anything else.

## Release Readiness Checklist

- `npm run smoke` passes.
- Env files are ignored and no real keys are committed.
- Mobile simulator can reach auth, onboarding, Today, Library, and Account.
- Content dry-run prints valid JSON with sources and dates.
- Any persisted test content is labeled `[TEST persist-test]`.
- Any persistence test has a recorded `test_run_id` and cleanup plan.
- Live data proof logs show `live_daily_drop`, `live_library_drops`, and `interaction_write_success` before declaring Supabase integration verified.
