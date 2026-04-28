# PersoNewsAP MVP Status

Last reviewed: 2026-04-27

PersoNewsAP is close to a small controlled tester build, not production launch. The core product principle is intact: one finite daily drop, sourced content, no infinite feed.

## What Works

- Expo mobile app has auth, onboarding, Today, Library, Account, and public Supabase client configuration.
- Mobile app can fall back to readable preview content when live Supabase data is missing.
- Today can display a four-slot daily drop: newsletter, business story, mini-case, and concept.
- Today supports content interactions: complete, save, and feedback rating.
- Library can show archived daily drops and saved/completed state when live data is available.
- Account screen exposes the tester user id needed for assignment.
- Root smoke workflow runs mobile TypeScript, content-engine build, and content-engine dry-run.
- Content engine can build, dry-run from sample sources, try curated RSS feeds, run LLM generation when configured, and persist marked test drops with explicit confirmation flags.
- Persistence test commands are guarded and mark generated test content.
- Local env files are ignored for root, mobile, content engine, and Supabase temp state.

## What Is Real

- Supabase auth/session integration in the mobile app.
- Onboarding preference persistence for authenticated users.
- Daily drop read path from Supabase when a published drop is assigned to the user.
- Library read path from Supabase for assigned published drops.
- `content_interactions` writes for live content.
- Supabase migrations for mobile foundation tables and RLS policies.
- Content-engine source processing pipeline: source fetch, dedupe, categorization, ranking, generation payload validation.
- Curated source registry and RSS ingestion foundation for real source metadata.
- Server-side Supabase persistence through the content engine when service role env vars are explicitly provided.

## What Is Mocked Or Local-Only

- Preview Today and Library content are mock fallback data.
- Default `content:dry-run` uses bundled sample articles and does not publish content.
- Some daily content generation paths use structured placeholder generation unless `OPENAI_API_KEY` is configured for `llm-run` or `daily-job-test --llm`.
- Small tester daily drops are currently created through marked test commands, not an automated production scheduler.
- Editorial review is manual. There is no review dashboard yet.
- Push notifications are not validated for testers.
- App Store/TestFlight distribution has not been completed in this repo.

## Unsafe For Production

- Do not point tester persistence commands at production unless deliberately accepting test rows there.
- Do not put `SUPABASE_SERVICE_ROLE_KEY`, OpenAI keys, Resend keys, or generation secrets in `apps/mobile/.env`, Vite env, screenshots, logs, docs, or issue comments.
- Generated LLM output is not production-safe without editorial review, especially for law, medicine, and finance.
- RSS ingestion reads feed metadata only; feed licensing and publisher terms still need review before production use.
- Cleanup commands intentionally avoid deleting published assigned drops, users, preferences, and sources. Published test content may need manual cleanup.
- There is no production monitoring, incident response, App Store privacy review, or tester support process yet.

## Current Known Limitations

- A tester may see Preview mode if no live daily drop is assigned for that account/date.
- Live proof depends on Metro terminal logs; there is no in-app diagnostics panel.
- Complete/save interaction writes now run a client preflight to suppress obvious duplicates, but there is no database uniqueness constraint, so fast concurrent taps or multi-device races can still create duplicate rows.
- Rating writes are append-only: the app treats the latest feedback row as the visible rating.
- FR live content depends on available generated/persisted FR drops; default smoke flow is mostly EN sample content.
- Password reset and account lifecycle flows need full manual QA before broad testing.
- Offline, flaky network, and cold-start behavior need more device coverage.

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for the maintained issue list.

## Next Blockers

1. Decide the tester Supabase environment: disposable project, staging project, or production-like project.
2. Apply migrations and confirm auth settings for tester signups.
3. Run one full live-data proof on a real device or simulator.
4. Prepare TestFlight credentials, bundle identifiers, signing, privacy text, and App Store Connect metadata.
5. Decide how daily tester drops will be produced during the test: manual `persist-test`, `assign-test-users`, or `daily-job-test`.
6. Review source licensing and editorial workflow before any production content claim.
7. Add a tester feedback collection path outside the app if in-app feedback is not enough.

## Manual Verification Snapshot

Before saying the MVP is ready for a small tester group:

- `npm run smoke` passes.
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
- New tester signs up and `[Profile proof]` logs `profile_saved` or `profile_exists`.
- Onboarding completes and `[Onboarding proof]` logs `user_preferences_saved` plus `onboarding_saved`.
- `persist-test` returns `mobileProof.daily_drop_id`.
- Today logs `[Today data proof]` with `event: "live_daily_drop"` and no proof-mode mock fallback error.
- Library logs `[Library data proof]` with `event: "live_library_drops"` and no proof-mode mock fallback error.
- Completing, saving, and rating live content logs `[Content interaction proof]` with `interaction_write_success`; repeated complete/save should log `interaction_write_skipped`.
- The tester can log out, log back in, and still see the assigned daily drop and Library entry.
