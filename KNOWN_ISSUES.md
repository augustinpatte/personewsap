# Known Issues

Last reviewed: 2026-08-18

What a tester may hit, what the coordinator should watch, and what is not
production-safe yet. Items are removed only when they are genuinely fixed —
never to make this document read better.

## Release Blockers Remaining

| Blocker | Status | Why it matters |
| --- | --- | --- |
| Initial catalog not generated | open | The reuse path is built and tested, but the 10 Business Stories and 30 Mini Cases (FR + EN) have not been produced yet. Until they exist, every edition is generated from scratch. |
| `delete-account` Edge Function not deployed | open | The function and both clients are written; it needs `supabase functions deploy delete-account` and the endpoint env vars. Account deletion is a store requirement, so this blocks submission. |
| Support address not configured | open | `VITE_SUPPORT_EMAIL` is unset, so /support says so instead of showing an address. Both stores require a working support contact. |
| Scheduled content workflow not on `main` | open | `.github/workflows/content-daily-job.yml` is complete but lives on a feature branch. GitHub only runs a schedule from the default branch. |
| Push delivery not validated on a real device | open | The sender, idempotency and tap routing are covered by tests; Expo Go cannot fully exercise remote notifications. Needs a development build or TestFlight. |
| Editorial review gate missing | open | LLM output can be structurally valid and still not be publishable, especially for law, medicine and finance. There is no human review step before production publication. |
| Source licensing review missing | open | The ingestion layer reads RSS/feed metadata only. Publisher terms and commercial reuse rights are still unreviewed. Treat sources as internal-test-only until that is settled. |
| TestFlight operations incomplete | open | Signing, App Store Connect setup, privacy answers and the invite process still need an owner. |

## Active Issues

### LLM Output Requires Editorial Review

Status: production blocker.

Generation produces valid structured payloads, and the quality proof rejects
duplicated angles, cooldown violations and repeated template phrasing. None of
that is a substitute for a human reading law, medicine and finance items before
they are published.

Workaround: keep a human review step before production publication.

### RSS Sources Are Not Production-Licensed By Default

Status: legal/editorial review needed.

Unchanged and still open. The source layer reads feed metadata only, but reuse
rights have not been confirmed.

Workaround: internal test source discovery only until licensing and editorial
policy are confirmed.

### Live Proof Depends On Console Logs

Status: test tooling limitation.

The strongest proof of live onboarding, edition assignment, archive and
interaction writes still appears in Metro logs (`[Profile proof]`,
`[Onboarding proof]`, `[Today data proof]`, `[Library data proof]`,
`[Content interaction proof]`, `[content-engine] catalog reuse`). There is no
tester-facing diagnostics screen.

Workaround: the coordinator watches logs during QA, or checks rows in Supabase.

### Proof Mode Is For Internal QA Only

Status: expected limitation.

`EXPO_PUBLIC_LIVE_DATA_PROOF_MODE=true` escalates fallback logs to console
errors. Useful during a proof run, too noisy for ordinary testers.

Workaround: enable it for coordinator-run QA only.

### Test Content Cleanup Is Conservative

Status: safety tradeoff.

`cleanup-test` removes draft, marked persist-test content only. It does not
delete published assigned test editions, users, preferences, sources or edition
links.

Workaround: inspect published test rows manually before deleting them.

### Interaction Writes Are Event-Based

Status: product decision pending.

Complete and Save run a client preflight that skips obvious duplicates, and a
sample/demo item is now refused before any request. Ratings remain append-only
by design; the app treats the latest feedback row as the visible rating. Fast
concurrent taps from two devices can still create duplicate rows unless the
database-level uniqueness migration is applied to the target project.

Workaround: treat rating rows as events in analysis; add idempotent mutation
endpoints before production analytics depend on exact counts.

### Archive Search Results Are Not Cursor-Paginated By Relevance

Status: accepted for launch.

Search covers the whole history with keyset pagination on
`(drop_date, content_item_id)`, so there is no result cap. Results are strictly
newest-first: there is no relevance ranking, and a very generic query returns a
lot of pages in date order.

Workaround: none needed. Revisit only if readers ask for relevance ordering.

### Password Reset And Session Edge Cases Need More QA

Status: release risk.

Signup, login, logout, onboarding and account deletion are implemented and
covered by tests. Password reset over a real email round trip, expired sessions
and multi-device auth states still need broader manual testing.

Workaround: exercise them explicitly in the TestFlight pass.

### TestFlight Build Process Is Not Yet Documented End-To-End

Status: release operations gap.

Readiness criteria exist, but signing, App Store Connect setup, the EAS project
id and the final upload steps still need owner decisions and credentials.

Workaround: complete [TESTFLIGHT_READINESS.md](TESTFLIGHT_READINESS.md) and
[STORE_RELEASE_CHECKLIST.md](STORE_RELEASE_CHECKLIST.md) before inviting
external testers.

## Resolved

### Sample Content Could Replace A Real Edition

Status: resolved (2026-08-18).

Mock content used to appear whenever `__DEV__` was true, so a brief network drop
could replace a signed-in reader's real edition with samples — and interactions
on that sample content then tried to write to production. Sample content is now
refused whenever the build points at a real Supabase project; a network failure
produces an offline/error state with a retry.

### Mobile Build Metadata Incomplete

Status: resolved.

`app.json` now carries the iOS build number and bundle identifier, the Android
package and version code, icon, splash and adaptive icon, and the notification
plugin configuration.

### Unattended Scheduling Missing

Status: resolved in code, pending merge to `main`.

`.github/workflows/content-daily-job.yml` runs the four editorial days in the
product timezone, with preflight, schema doctor, production run, push
notifications and strict job health. It only becomes active once it is on the
default branch — tracked as a blocker above.

### No Infinite Feed

Status: accepted behaviour.

An edition is finite, the archive pages on an explicit tap, and search pages on
an explicit tap. Nothing in the app loads more by scrolling.

### Dry Run Does Not Write To Supabase

Status: accepted behaviour.

`npm run content:dry-run` prints JSON and keeps `persisted: false`. Persistence
requires explicit confirmation flags.

## Add A New Known Issue

```md
### Short Title

Status: open | expected limitation | release blocker | resolved.

What happens and why it matters.

Workaround: practical next step or "none yet".
```
