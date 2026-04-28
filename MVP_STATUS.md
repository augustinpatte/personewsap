# PersoNewsAP MVP Status

Last reviewed: 2026-04-28

PersoNewsAP is close to a small controlled tester build, not production launch. The core product principle is intact: one finite daily drop, sourced content, no infinite feed.

## What Works

- Expo mobile app has auth, onboarding, Today, Library, Account, and public Supabase client configuration.
- Mobile app can fall back to readable preview content when live Supabase data is missing.
- Today can display a four-slot daily drop: newsletter, business story, mini-case, and concept.
- Today supports content interactions: complete, save, and feedback rating.
- Library can show archived daily drops and saved/completed state when live data is available.
- Account screen exposes the tester user id needed for assignment.
- Root smoke workflow runs mobile TypeScript, content-engine build, and content-engine dry-run.
- Root backend E2E proof runs mobile TypeScript, content-engine build, dry-run, read-only user diagnostics, and two marked daily-job-test passes.
- Content engine can build, dry-run from sample sources, try curated RSS feeds, run LLM generation when configured, persist marked test drops with explicit confirmation flags, and run the production-shaped `daily-job` scheduler command.
- Persistence test commands are guarded and mark generated test content.
- Local env files are ignored for root, mobile, content engine, and Supabase temp state.

## What Is Real

- Supabase auth/session integration in the mobile app.
- Onboarding preference persistence for authenticated users.
- Daily drop read path from Supabase when a published drop is assigned to the user.
- Library read path from Supabase for assigned published drops.
- `content_interactions` writes for live content.
- Supabase migrations for mobile foundation tables and RLS policies.
- Additive Supabase beta-hardening migration and SQL verification files cover duplicate prevention, RLS access proofs, and rollbacked service-role write probes.
- Content-engine source processing pipeline: source fetch, dedupe, categorization, ranking, generation payload validation.
- Curated source registry and RSS ingestion foundation for real source metadata, with per-source health logs, feed failure isolation, URL/title/date dedupe, and stale-item diagnostics.
- Server-side Supabase persistence through the content engine when service role env vars are explicitly provided.
- Marked daily-job-test content can be generated, stored, assigned to eligible app users, and updated idempotently on rerun.

## What Is Mocked Or Local-Only

- Preview Today and Library content are mock fallback data.
- Default `content:dry-run` uses bundled sample articles and does not publish content.
- Some daily content generation paths use structured placeholder generation unless `OPENAI_API_KEY` is configured for `llm-run`, `daily-job-test`, or `daily-job`.
- Small tester daily drops can still be created through marked test commands; production-shaped daily drops now use `daily-job`, but unattended scheduling and monitoring are not wired in this repo.
- Editorial review is manual. There is no review dashboard yet.
- Push notifications are not validated for testers.
- App Store/TestFlight distribution has not been completed in this repo.

## Unsafe For Production

- Do not point tester persistence commands at production unless deliberately accepting test rows there.
- Do not put `SUPABASE_SERVICE_ROLE_KEY`, OpenAI keys, Resend keys, or generation secrets in `apps/mobile/.env`, Vite env, screenshots, logs, docs, or issue comments.
- Generated LLM output is not production-safe without editorial review, especially for law, medicine, and finance.
- RSS ingestion reads feed metadata only; feed licensing and publisher terms still need review before production use. Remote feed outages, malformed XML, or stale feeds are logged and skipped, but production monitoring is still missing.
- Cleanup commands intentionally avoid deleting published assigned drops, users, preferences, and sources. Published test content may need manual cleanup.
- There is no production monitoring, incident response, App Store privacy review, or tester support process yet.

## Production Readiness Checklist

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Backend smoke commands | done | Root `smoke`, `content:build`, and `content:dry-run` scripts are present. |
| Backend E2E proof command | done | Root `backend:e2e` verifies build, dry-run, debug-users, generated/stored content, assignment when users exist, language match, and second-run idempotency. |
| Content-engine command map | done | Service scripts cover build/check, no-write runs, guarded writes, assignment diagnostics, and cleanup. |
| Env and secret hygiene | done | `.env`, `.env.*`, mobile/content-engine `.env`, and `supabase/.temp` are ignored; service role keys stay server-side. |
| Supabase schema/RLS verification | done | `supabase:doctor`, `scripts/run-supabase-verification.sh`, and `SUPABASE_CHECKLIST.md` verify migrations, topics, RLS, policies, duplicate audits, and rollbacked service-role writes. |
| Mobile live-data backend path | done | Auth, onboarding persistence, daily-drop reads, Library reads, and interaction writes have implemented Supabase paths. |
| Tester content assignment | partial | Marked test drops can be persisted, assigned, and rerun idempotently; a tester project and live proof run must be selected per wave. |
| Production daily job | partial | `content:daily-job` exists with dry-run/write safety, per-language isolation, retries, and assignment summaries; unattended scheduling, monitoring, and operational ownership are not wired. |
| Production content quality gate | missing | Generated LLM content still needs editorial review before production publication. |
| Production source/legal review | missing | RSS/source licensing and reuse policy are not approved. |
| Production operations | missing | Monitoring, incident response, cleanup policy, and support workflow are not established. |

## Current Known Limitations

- A tester may see Preview mode if no live daily drop is assigned for that account/date.
- Live proof depends on Metro terminal logs; there is no in-app diagnostics panel.
- Complete/save interaction writes have client preflight protection and beta database uniqueness indexes once the hardening migration is applied.
- Rating writes are append-only by design: the app treats the latest feedback row as the visible rating.
- FR live content depends on available generated/persisted FR drops; default smoke flow is mostly EN sample content.
- Password reset and account lifecycle flows need full manual QA before broad testing.
- Offline, flaky network, and cold-start behavior need more device coverage.

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for the maintained issue list.

## Backend Blockers Remaining After This Wave

These are the backend blockers that remain before beta can be treated as production-like:

1. Pick the tester Supabase environment and run the live `supabase:doctor`/SQL checks against it.
2. Apply the additive beta hardening migration after `constraints_and_duplicates.sql` reports no duplicate groups.
3. Run `npm run backend:e2e` against the selected Supabase project.
4. Run one real live-data proof: signup, onboarding, marked drop assignment, Today, Library, and interactions.
5. Decide the beta content production path: manual `persist-test`, `assign-test-users`, guarded `daily-job-test`, or production-shaped `daily-job`.
6. Wire `content:daily-job` to an approved scheduler only after the editorial review path is decided.
7. Review source licensing before using RSS-derived content beyond internal testing, especially feeds whose terms restrict non-personal or collective reuse.

## Next Non-Backend Blockers

1. Prepare TestFlight credentials, bundle identifiers, signing, privacy text, and App Store Connect metadata.
2. Add a tester feedback collection path outside the app if in-app feedback is not enough.
3. Complete broader account lifecycle, offline, flaky network, and device coverage QA.

## Manual Verification Snapshot

Before saying the MVP is ready for a small tester group:

- `npm run smoke` passes.
- `npm run backend:e2e` passes against the selected local/staging/disposable Supabase project.
- A new account can sign up and complete onboarding.
- A marked test daily drop can be assigned to that account.
- Today shows `Live daily drop`.
- Complete, save, and rating actions write successfully.
- Library shows the assigned drop.
- Logout/login preserves access to Today and Library.
- Known limitations are shared with testers and the test coordinator.

## Live Proof Checklist

Use this checklist for the real end-to-end proof:

- `apps/mobile/.env` has public Supabase URL, anon key, and `EXPO_PUBLIC_LIVE_DATA_PROOF_MODE=true`.
- `services/content-engine` commands use server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only.
- `./scripts/run-supabase-verification.sh` reports PASS for duplicate audits, RLS isolation, and rollbacked service-role writes.
- `npm run backend:e2e` prints PASS for content generated, content stored, language match, and idempotent second-run update when eligible users exist.
- New tester signs up and `[Profile proof]` logs `profile_saved` or `profile_exists`.
- Onboarding completes and `[Onboarding proof]` logs `user_preferences_saved` plus `onboarding_saved`.
- `persist-test` returns `mobileProof.daily_drop_id`.
- Today logs `[Today data proof]` with `event: "live_daily_drop"` and no proof-mode mock fallback error.
- Library logs `[Library data proof]` with `event: "live_library_drops"` and no proof-mode mock fallback error.
- Completing, saving, and rating live content logs `[Content interaction proof]` with `interaction_write_success`; repeated complete/save should log `interaction_write_skipped`.
- The tester can log out, log back in, and still see the assigned daily drop and Library entry.
