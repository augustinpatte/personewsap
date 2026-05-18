# PersoNewsAP

PersoNewsAP is a premium daily learning app for ambitious students and early-career users. The product principle is one focused daily drop, not an infinite feed.

The current repo contains:

- Expo mobile app in `apps/mobile`
- Content generation and persistence service in `services/content-engine`
- Supabase migrations in `supabase/migrations`
- Local/tester release documentation at the repo root

## Current Release Status

| Area | Status | What this means |
| --- | --- | --- |
| Backend sample mode | validated | `npm run smoke` passes and `content:dry-run` generates a no-write daily drop from sample articles. |
| Backend real RSS mode | validated for internal testing | `LIVE_RSS=true npm run content:dry-run` completes with source health logs; RSS/source rights are not production-approved. |
| LLM generation | not release-validated | `llm-run` exists and validates structure, but this release pass did not validate prompt quality or production editorial safety. |
| Mobile live data | implemented, proof required per tester wave | Auth, onboarding, assigned daily-drop reads, Library reads, and interaction writes exist; each tester Supabase project still needs a live proof run. |
| TestFlight | not ready | Signing, App Store Connect, privacy text, tester support, and a device proof run are still required. |
| Production | not ready | Daily-job metrics and health CLI exist, but editorial review, source licensing, scheduler ownership, incident response, and cleanup ownership are not complete. |

## Start Here

For a small tester handoff, read these in order:

1. [MVP_STATUS.md](MVP_STATUS.md) - what works, what is real, what is mocked, and what is unsafe for production.
2. [TESTING.md](TESTING.md) - local setup, Supabase setup, daily-drop generation, manual QA, and troubleshooting.
3. [SUPABASE_CHECKLIST.md](SUPABASE_CHECKLIST.md) - schema/RLS verification before testers use the mobile app.
4. [BACKEND_OPERATIONS.md](BACKEND_OPERATIONS.md) - daily backend operator check, job health, and stored metrics.
5. [TESTFLIGHT_READINESS.md](TESTFLIGHT_READINESS.md) - checklist for moving from local QA to TestFlight.
6. [TESTER_SCRIPT_15_MIN.md](TESTER_SCRIPT_15_MIN.md) - step-by-step script for a short tester session.
7. [KNOWN_ISSUES.md](KNOWN_ISSUES.md) - current limitations and tester risks.

Product and editorial context:

- [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md)
- [CONTENT_SYSTEM.md](CONTENT_SYSTEM.md)
- [TECH_PLAN.md](TECH_PLAN.md)

## Quick Local Setup

Install dependencies:

```sh
npm install
npm --prefix apps/mobile install
npm --prefix services/content-engine install
```

Run the smoke check:

```sh
npm run smoke
```

This runs mobile TypeScript, content-engine build, and content-engine dry-run.

## Exact Commands

Smoke test:

```sh
cd ~/personewsap
npm run smoke
```

Backend E2E proof for a disposable or staging Supabase project:

```sh
cd ~/personewsap
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_DAILY_JOB_TEST=true \
LANGUAGES=en \
USER_LIMIT=3 \
npm run backend:e2e
```

Debug app-user eligibility:

```sh
cd ~/personewsap
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
LANGUAGES=fr,en \
npm run content:debug-users
```

Daily job test:

```sh
cd ~/personewsap
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_DAILY_JOB_TEST=true \
LANGUAGES=fr,en \
USER_LIMIT=5 \
npm run content:daily-job-test
```

Daily backend health check:

```sh
cd ~/personewsap
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run content:job-health -- --date "$(date +%F)"
```

Live RSS no-write test:

```sh
cd ~/personewsap
LIVE_RSS=true npm run content:dry-run
```

Mobile start:

```sh
cd ~/personewsap
cp apps/mobile/.env.example apps/mobile/.env
npm --prefix apps/mobile run start
```

Cleanup draft persist-test data:

```sh
cd ~/personewsap
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_CLEANUP_TEST=true \
npm run content:cleanup-test -- --test-run-id persist-test-...
```

## Mobile App

Use public Supabase client keys only:

```sh
cp apps/mobile/.env.example apps/mobile/.env
npm --prefix apps/mobile run ios
```

Other useful commands:

```sh
npm --prefix apps/mobile run start
npm --prefix apps/mobile run android
npm run mobile:typecheck
```

Never put a Supabase service role key, OpenAI key, Resend key, or generation secret in the mobile app.

## Content Engine

Safe no-write test commands:

```sh
npm run content:dry-run
LIVE_RSS=true OPENAI_API_KEY=... npm run content:llm-run
npm run supabase:doctor
```

`content:llm-run` requires `OPENAI_API_KEY` and still does not write to Supabase. It uses live RSS by default in the safe command above; add `ALLOW_SAMPLE_CONTENT=true` only for an intentional sample-content LLM rehearsal. `supabase:doctor` reads local migrations by default.

For a no-write daily-job run with samples disabled:

```sh
DRY_RUN=true LIVE_RSS=true LIVE_RSS_ONLY=true USE_LLM=false RSS_ARTICLES_PER_SOURCE=1 npm run content:daily-job
```

Build command:

```sh
npm run content:build
```

Production-shaped command:

```sh
DRY_RUN=true npm run content:daily-job
```

Run without `DRY_RUN=true` only from a server-side environment with production Supabase credentials, source/legal approval, and an editorial review workflow. Non-dry production writes require `PRODUCTION_DAILY_JOB=true DRY_RUN=false LIVE_RSS=true LIVE_RSS_ONLY=true USE_LLM=true`, plus `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY`.

Read-only diagnostic commands:

```sh
npm run supabase:doctor -- --live
npm run content:debug-users
```

Local-only write commands for disposable/staging projects:

```sh
npm run content:persist-test
npm run content:cleanup-test
npm run content:assign-test-users
npm run content:personalize-test
npm run content:daily-job-test
npm run backend:e2e
```

Dangerous write commands require explicit confirmation flags and server-side env vars:

- `content:persist-test`
- `content:assign-test-users`
- `content:personalize-test`
- `content:daily-job-test`
- `content:cleanup-test`
- `backend:e2e`
- `backend:e2e:live-rss`
- `backend:e2e:llm`

Use [TESTING.md](TESTING.md) before running them. `content:daily-job` is production-shaped and stores non-dry run summaries for `content:job-health`, but unattended scheduling and operational ownership still need a production owner.

## Supabase

Migrations live in `supabase/migrations`.

For tester prep:

- use a disposable or staging Supabase project
- apply migrations in order
- keep service-role access server-side only
- verify schema/RLS with [SUPABASE_CHECKLIST.md](SUPABASE_CHECKLIST.md)

## Release Safety

Before inviting testers:

- `npm run smoke` passes
- a tester can sign up and complete onboarding
- a marked test daily drop can be assigned to the tester
- Today shows `Live daily drop`
- complete/save/rating interactions work
- Library loads the assigned drop
- logout/login works
- [KNOWN_ISSUES.md](KNOWN_ISSUES.md) is reviewed with the tester coordinator

PersoNewsAP is not production-ready until TestFlight setup, privacy review, editorial review, source licensing, and production operations are completed.

## Production Readiness Snapshot

| Area | Status | Notes |
| --- | --- | --- |
| Env file ignores | done | Root, mobile, content-engine env files and Supabase temp state are ignored. |
| Root smoke workflow | done | `npm run smoke` runs mobile typecheck plus content build and no-write dry-run. |
| Backend sample mode | validated | Sample/dry-run pipeline is the current MVP-ready backend mode. |
| Backend real RSS mode | internal-test validated | Live RSS dry-run is safe and observable; source rights remain unapproved for production. |
| LLM generation | unvalidated for release | Command exists, but prompt quality and editorial safety are next-phase work. |
| Supabase schema/RLS verification | done | `npm run supabase:doctor` and [SUPABASE_CHECKLIST.md](SUPABASE_CHECKLIST.md) cover local/static and live read-only checks. |
| Backend persistence safety | done | Write commands fail closed behind confirmation flags and service-role env vars. |
| Mobile live-data path | implemented, wave proof required | Supported through marked test persistence and assignment; still needs a selected tester Supabase project and manual proof run. |
| TestFlight | not ready | Build/signing/privacy/tester operations are not complete. |
| Production scheduler | partial | `content:daily-job` exists and writes `job_runs` monitoring summaries; unattended scheduling and operational ownership are not wired. |
| Editorial production workflow | missing | LLM output still needs human review before production publication. |
| Source licensing | missing | RSS/source terms need review before production use. |
