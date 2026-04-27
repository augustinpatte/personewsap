# PersoNewsAP MVP Status

## What Works

- Mobile app package has Expo scripts for local simulator work and a TypeScript check.
- Root smoke workflow checks mobile TypeScript, content-engine build, and content-engine dry-run.
- Content engine can build, dry-run from sample input, run LLM generation when configured, and run explicit persistence test commands.
- Persistence test content is intentionally marked as test content and can be cleaned up by test run id.
- Local `.env` files are ignored for the root app, mobile app, and content engine.

## What Is Mocked

- Mobile screens can fall back to mock daily content when live Supabase data or a session is unavailable.
- Content-engine dry-run uses bundled sample source data and does not publish content.
- LLM generation and persistence require real server-side environment variables and are outside the default smoke flow.
- Some production operations, scheduling, and editorial review steps are still manual.

## What Needs Real Data

- Mobile auth and user-specific daily drops need a Supabase project with the current migrations applied.
- Today and Library need generated `content_items`, `daily_drops`, and `daily_drop_items` rows to validate the complete live-data path.
- `llm-run` needs `OPENAI_API_KEY` configured in a server-side shell or `services/content-engine/.env`.
- `persist-test`, `cleanup-test`, and user assignment commands need server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- End-to-end tester validation needs at least one test user with preferences and one daily drop assigned to that user.

## Not Production-Ready

- Never put Supabase service role keys in Expo, Vite, or other client-side environments.
- Run `persist-test` only against local, disposable, or deliberately selected Supabase projects.
- Real LLM output still needs editorial review before publication.
- Production scheduling, monitoring, push-notification QA, account lifecycle flows, and release hardening need more validation.

## How To Test Manually

- Run `npm run smoke` from the repo root before sharing with testers.
- Run the mobile app with `cd apps/mobile && npm run ios`, then check auth, onboarding, Today, Library, and Account.
- Run `npm run content:dry-run` and inspect the printed JSON for sourced items, dates, and expected content slots.
- If testing writes, use a local or disposable Supabase project and run `persist-test` only with `CONFIRM_PERSIST_TEST=true`.
- After a persistence test, record the `test_run_id` and run `cleanup-test` for that id when finished.
