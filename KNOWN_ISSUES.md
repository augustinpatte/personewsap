# Known Issues

Last reviewed: 2026-04-27

Use this list when preparing a small tester group. Keep it practical: what testers may hit, what the coordinator should watch, and what is not production-safe yet.

## Active Issues

### Preview Mode Appears When No Drop Is Assigned

Status: expected limitation.

If a tester has no published daily drop assigned for the current date, Today falls back to preview content. This is useful for local development but can confuse testers unless they are told what `Preview mode` means.

Workaround: assign a marked test drop with `persist-test` after onboarding.

### Live Proof Depends On Console Logs

Status: test tooling limitation.

The strongest proof of live onboarding, Today, Library, and interaction writes currently appears in Metro logs:

- `[Profile proof]`
- `[Onboarding proof]`
- `[Today data proof]`
- `[Library data proof]`
- `[Content interaction proof]`

There is no tester-facing diagnostics screen.

Workaround: coordinator watches logs during local QA or validates rows in Supabase.

### Proof Mode Is For Internal QA Only

Status: expected limitation.

`EXPO_PUBLIC_LIVE_DATA_PROOF_MODE=true` escalates Today/Library mock fallback logs to console errors. That is useful during a proof run but too noisy for normal testers.

Workaround: enable proof mode for coordinator-run QA, then disable it for broader TestFlight builds unless testers are explicitly part of technical validation.

### Test Content Cleanup Is Conservative

Status: safety tradeoff.

`cleanup-test` removes draft marked persist-test content only. It does not delete published assigned test drops, users, preferences, sources, or daily-drop links.

Workaround: manually inspect published test rows before deleting them.

### Interaction Writes Are Event-Based

Status: product decision pending.

Complete and Save run a client preflight to skip obvious duplicate writes, but there is no database uniqueness constraint. Fast concurrent taps or multi-device races can still create duplicate rows. Ratings are append-only; the app treats the latest feedback row as the visible rating.

Workaround: treat interaction rows as events during tester analysis. Add database-level uniqueness or idempotent mutation endpoints before production analytics depend on exact counts.

### FR Coverage Needs Manual Attention

Status: content readiness gap.

The app supports FR/EN, but the default smoke flow and sample persistence path are easier to verify in EN. FR tester drops need deliberate generation/assignment and editorial review.

Workaround: run content-engine commands with `--language fr` and verify FR copy manually.

### RSS Sources Are Not Production-Licensed By Default

Status: legal/editorial review needed.

The source ingestion layer reads RSS/feed metadata only. Publisher terms and commercial reuse rights still need review before production content operations.

Workaround: use RSS for internal test source discovery only until licensing and editorial policy are confirmed.

### LLM Output Requires Editorial Review

Status: production blocker.

LLM generation can create valid structured payloads, but output is not automatically production-safe, especially for law, medicine, and finance.

Workaround: use marked test content for QA; add human review before production publication.

### Password Reset And Account Lifecycle Need More QA

Status: release risk.

Signup, login, logout, and onboarding are the main tested paths. Password reset, expired sessions, account deletion, and edge auth states need broader testing.

Workaround: avoid promising full account lifecycle support in the first small test.

### TestFlight Build Process Is Not Yet Documented End-To-End

Status: release operations gap.

The repo has readiness criteria, but signing, App Store Connect setup, EAS/build choice, and final TestFlight upload steps still need owner decisions.

Workaround: complete [TESTFLIGHT_READINESS.md](TESTFLIGHT_READINESS.md) before inviting external testers.

## Resolved Or Accepted For MVP

### No Infinite Feed

Status: accepted behavior.

The Today experience remains one finite daily drop. Library is for past drops and saved content, not endless scrolling.

### Dry Run Does Not Write To Supabase

Status: accepted behavior.

`npm run content:dry-run` prints JSON and keeps `persisted: false`. Persistence requires explicit confirmation flags.

## Add A New Known Issue

Use this format:

```md
### Short Title

Status: open | expected limitation | release blocker | resolved.

What happens and why it matters.

Workaround: practical next step or "none yet".
```
