# PersoNewsAP

PersoNewsAP is a premium daily learning app for ambitious students and early-career users. The product principle is one focused daily drop, not an infinite feed.

The current repo contains:

- Expo mobile app in `apps/mobile`
- Content generation and persistence service in `services/content-engine`
- Supabase migrations in `supabase/migrations`
- Local/tester release documentation at the repo root

## Start Here

For a small tester handoff, read these in order:

1. [MVP_STATUS.md](MVP_STATUS.md) - what works, what is real, what is mocked, and what is unsafe for production.
2. [TESTING.md](TESTING.md) - local setup, Supabase setup, daily-drop generation, manual QA, and troubleshooting.
3. [SUPABASE_CHECKLIST.md](SUPABASE_CHECKLIST.md) - schema/RLS verification before testers use the mobile app.
4. [TESTFLIGHT_READINESS.md](TESTFLIGHT_READINESS.md) - checklist for moving from local QA to TestFlight.
5. [TESTER_SCRIPT_15_MIN.md](TESTER_SCRIPT_15_MIN.md) - step-by-step script for a short tester session.
6. [KNOWN_ISSUES.md](KNOWN_ISSUES.md) - current limitations and tester risks.

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
npm run content:llm-run
npm run supabase:doctor
```

`content:llm-run` requires `OPENAI_API_KEY` and still does not write to Supabase. `supabase:doctor` reads local migrations by default.

Build command:

```sh
npm run content:build
```

Production-shaped command:

```sh
DRY_RUN=true npm run content:daily-job
```

Run without `DRY_RUN=true` only from a server-side environment with production Supabase credentials, source/legal approval, and an editorial review workflow.

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

Use [TESTING.md](TESTING.md) before running them. `content:daily-job` is production-shaped but is not wired to unattended scheduling or monitoring yet.

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
| Supabase schema/RLS verification | done | `npm run supabase:doctor` and [SUPABASE_CHECKLIST.md](SUPABASE_CHECKLIST.md) cover local/static and live read-only checks. |
| Backend persistence safety | done | Write commands fail closed behind confirmation flags and service-role env vars. |
| Tester live-data path | partial | Supported through marked test persistence and assignment; still needs a selected tester Supabase project and manual proof run. |
| Production scheduler | partial | `content:daily-job` exists, but unattended scheduling, monitoring, and operational ownership are not wired. |
| Editorial production workflow | missing | LLM output still needs human review before production publication. |
| Source licensing | missing | RSS/source terms need review before production use. |
