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

## Release Readiness Checklist

- `npm run smoke` passes.
- Env files are ignored and no real keys are committed.
- Mobile simulator can reach auth, onboarding, Today, Library, and Account.
- Content dry-run prints valid JSON with sources and dates.
- Any persisted test content is labeled `[TEST persist-test]`.
- Any persistence test has a recorded `test_run_id` and cleanup plan.
