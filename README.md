# PersoNewsAP

PersoNewsAP is a premium daily learning app for ambitious students and early-career users. The product principle is one focused daily drop, not an infinite feed.

The current repo contains:

- Expo mobile app in `apps/mobile`
- Content generation and persistence service in `services/content-engine`
- Supabase migrations in `supabase/migrations`
- Local/tester release documentation at the repo root

## Branches

`main` is the production branch and contains the complete product. It was
brought level with `feat/final-product-pass` on 2026-08-25.

The other branches are kept for history and are fully absorbed into `main`:
`feat/final-product-pass`, `feat/chatgpt-content-orchestration`,
`feature/editorial-memory`, `fix/learning-session-progression` and the local
`feature/learning-*` and `codex/*` branches. The learning-path prototypes on
`feature/learning-catalog` / `-backend` / `-supabase` were superseded by a
rewritten implementation; their still-relevant documentation was recovered into
`docs/learning-paths/`.

## Current Release Status

Last verified 2026-08-25.

| Area | Status | What this means |
| --- | --- | --- |
| Repository checks | green | 1262 tests pass, mobile `tsc --noEmit` clean, `eslint` 0 errors, web build succeeds, `expo-doctor` 20/20, `expo install --check` clean. |
| Supabase schema | validated against production | `supabase:doctor --live` reports 157 pass / 0 fail. All 32 migrations match local↔remote. |
| Account deletion | deployed | `delete-account` is ACTIVE on the production project and matches the checked-in source. Endpoint env vars and CORS origins are still unset — see KNOWN_ISSUES.md. |
| Content catalog | generated | 20 FR + 20 EN Business Stories and 120 FR + 120 EN Mini Cases exist in production. |
| Editorial pipeline | ChatGPT staging → CI publish | Generation happens in ChatGPT Scheduled Tasks with human approval; CI only publishes approved batches. |
| Scheduled automation | on `main`, not yet functional | The workflows are on the default branch so the schedules are live, but the repository has no secrets configured, so every run fails until they are set. |
| Secrets | **action required** | The live Supabase service-role and Resend keys are in this public repository's git history and must be rotated. See KNOWN_ISSUES.md. |
| EAS / builds | blocked on account | `eas whoami` is not logged in and `app.json` has no `extra.eas.projectId`. No build can start until the Expo account holder runs `eas login && eas init`. |
| Backend real RSS mode | validated for internal testing | `LIVE_RSS=true npm run content:dry-run` completes with source health logs; RSS/source rights are not production-approved. |
| Editorial review | required | Structural validation is not editorial validation, especially for law, medicine and finance. |

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
npm --prefix apps/mobile run config:public
npm run mobile:typecheck
```

Never put a Supabase service role key, OpenAI key, Resend key, or generation secret in the mobile app.

Expo Go is not a TestFlight proof. Use it for UI/auth iteration only; push
notification registration must be tested in a development build or TestFlight
build with EAS project metadata and native notification credentials.

## Content Engine

### How the scheduled edition is produced

Editorial generation runs in **ChatGPT Scheduled Tasks** against a separate
Supabase staging project. A human approves a batch there. Only then does
`.github/workflows/content-daily-job.yml` (Mon/Wed/Fri/Sun, 09:17 Europe/Paris)
read the approved batch, revalidate it through the same validators the LLM path
used, persist it to production, assign the daily drops and send the edition
push.

That workflow sets **no** `USE_LLM`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.
There is deliberately no automatic fallback to a paid API, and no approved batch
means a clean no-op with a warning rather than an unreviewed edition.

The four CI secrets it needs are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY`. See the
environment matrix in [BACKEND_OPERATIONS.md](BACKEND_OPERATIONS.md).

### Legacy direct-API path

Everything below drives the older pipeline that calls OpenAI/Anthropic
directly. It still works and is still tested, but it is a manual operator tool
now (`npm run content:legacy-api-run`), not how the product publishes. It is the
only path that needs provider keys, and they belong on an operator machine —
never in CI.

Safe no-write test commands:

```sh
npm run content:dry-run
npm run content:quality-proof
LIVE_RSS=true OPENAI_API_KEY=... ANTHROPIC_API_KEY=... npm run content:llm-run
npm run supabase:doctor
```

`content:llm-run` requires the provider keys used by the configured routes (`OPENAI_API_KEY` and, by default for Business Story, `ANTHROPIC_API_KEY`) and still does not write to Supabase. It uses live RSS by default in the safe command above; add `ALLOW_SAMPLE_CONTENT=true` only for an intentional sample-content LLM rehearsal. `supabase:doctor` reads local migrations by default.

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
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... npm run content:prod-dry-run
```

Run without `DRY_RUN=true` only from a server-side environment with production Supabase credentials, source/legal approval, and an editorial review workflow. Non-dry production writes require `PRODUCTION_DAILY_JOB=true DRY_RUN=false LIVE_RSS=true LIVE_RSS_ONLY=true USE_LLM=true LEARNING_GENERATION_MODE=deterministic`, plus `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` for the default routes. The guarded wrapper is `npm run content:legacy-api-run`.

Read-only diagnostic commands:

```sh
npm run supabase:doctor -- --live
npm run content:health
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

Use [TESTING.md](TESTING.md) before running them. `content:daily-job` is production-shaped and stores non-dry run summaries for `content:health` / `content:job-health`; use [BACKEND_OPERATIONS.md](BACKEND_OPERATIONS.md) for the production runbook, rollback plan, and partial-language playbook.

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
| Env file ignores | done | Root, mobile, content-engine env files and Supabase temp state are ignored, plus PEM/key/p8/p12/jks/keystore, credentials.json and service-account JSON. `.env.example` stays tracked at any depth. |
| Secrets in git history | **action required** | Live service-role and Resend keys were committed in `d91aee1`/`56045d0` and remain in the published history. Rotate them. |
| Audit archive | done | `scripts/create-audit-archive.sh` zips the repo without secrets and verifies the finished archive. |
| Root smoke workflow | done | `npm run smoke` runs mobile typecheck plus content build and no-write dry-run. |
| Backend sample mode | validated | Sample/dry-run pipeline is the current MVP-ready backend mode. |
| Backend real RSS mode | internal-test validated | Live RSS dry-run is safe and observable; source rights remain unapproved for production. |
| LLM generation | unvalidated for release | Command exists, but prompt quality and editorial safety are next-phase work. |
| Supabase schema/RLS verification | done | `npm run supabase:doctor` and [SUPABASE_CHECKLIST.md](SUPABASE_CHECKLIST.md) cover local/static and live read-only checks. |
| Backend persistence safety | done | Write commands fail closed behind confirmation flags and service-role env vars. |
| Mobile live-data path | implemented, wave proof required | Supported through marked test persistence and assignment; still needs a selected tester Supabase project and manual proof run. |
| TestFlight | partial | Expo config, icons/splash, iOS build number, and EAS profiles exist; Apple signing, App Store Connect setup, final privacy/support copy, and device proof are still required. |
| Production scheduler | on `main`, needs secrets | `content-daily-job.yml` publishes the human-approved ChatGPT staging batch Mon/Wed/Fri/Sun and `job_runs` records monitoring summaries. The workflows are on the default branch, so the schedules are live; they fail until the four CI secrets are set. `content:legacy-api-run` remains the manual direct-API fallback. |
| Editorial production workflow | missing | LLM output still needs human review before production publication. |
| Source licensing | missing | RSS/source terms need review before production use. |
