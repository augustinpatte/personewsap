# Known Issues

Last reviewed: 2026-08-25 (Supabase security pass)

What a tester may hit, what the coordinator should watch, and what is not
production-safe yet. Items are removed only when they are genuinely fixed —
never to make this document read better.

## Release Blockers Remaining

| Blocker | Status | Why it matters |
| --- | --- | --- |
| **Leaked production credentials in git history** | **open — highest priority** | The live Supabase service-role key and Resend API key are reachable in the history of a public repository. A service-role key bypasses every RLS policy. The replacement keys already exist and the swap is verified against the live API — only the human rotation step is left. See the section below. |
| GitHub Actions secrets not configured | open | The repository has no secrets at all, at repository level or in the `Preview` / `Production` environments. The four scheduled workflows are now on `main` and will fail on every run until `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` exist. |
| EAS project not initialised | open | `eas whoami` reports "Not logged in" and `app.json` has no `extra.eas.projectId`. No build can start, and physical-device push tokens need the project id. Requires the Expo account holder. |
| Account deletion endpoint not wired into builds | open | The function is deployed and working, but `EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT` and `VITE_ACCOUNT_DELETION_ENDPOINT` are unset, so the app and web page both report deletion as unavailable. Store requirement. |
| `ACCOUNT_DELETION_ALLOWED_ORIGINS` not set | open | Without it the function returns an empty `Access-Control-Allow-Origin`, so the browser page cannot call it. Google Play requires the external web deletion URL to work. Mobile is unaffected. |
| Editorial pipeline has never published end-to-end | open | The ChatGPT staging project is provisioned and configured, but no batch has ever reached an approved state: 2 cancelled, 1 stuck in `generating` since 2026-08-22, 93 cancelled and 23 queued generation jobs, and **0 rows in `publication_receipts`**. The scheduled workflow will find no approved batch and no-op. Current editions were published by hand. |
| Support address not configured | open | `VITE_SUPPORT_EMAIL` is unset, so /support says so instead of showing an address. Both stores require a working support contact. |
| Push delivery not validated on a real device | open | The sender, idempotency and tap routing are covered by tests; Expo Go cannot fully exercise remote notifications. Needs a development build or TestFlight. |
| Editorial review gate missing | open | LLM output can be structurally valid and still not be publishable, especially for law, medicine and finance. There is no human review step before production publication. |
| Source licensing review missing | open | The ingestion layer reads RSS/feed metadata only. Publisher terms and commercial reuse rights are still unreviewed. Treat sources as internal-test-only until that is settled. |
| TestFlight operations incomplete | open | Signing, App Store Connect setup, privacy answers and the invite process still need an owner. |

## Resolved On 2026-08-25 — Supabase Permission Hardening

Migration `20260825150000_security_hardening_rpc_permissions.sql`, applied to
production and confirmed by re-running the advisors.

| Finding | Before | After |
| --- | --- | --- |
| `user_archive_search_items` ran as its owner (advisor ERROR) | `security_invoker` lost to a later `CREATE OR REPLACE VIEW`; RLS on the three underlying tables bypassed; `anon` held SELECT | runs `security_invoker`; `anon` revoked; reader sees only their own rows (verified: 77 own, 0 of another reader) |
| `claim_push_notification_deliveries` | `anon` + `authenticated` EXECUTE | `service_role` only |
| `cleanup_expired_pending_registrations` | `anon` + `authenticated` EXECUTE | `service_role` only |
| 8 Parcours/language RPCs | `anon` + `authenticated` EXECUTE | `authenticated` only |
| server-only tables (5) | leftover `anon`/`authenticated` table grants | revoked; RLS-on/no-policy kept as the intended deny-all |
| password minimum | 6 on the server, 8 in the app | 8 on both |

Advisor result: **0 ERROR**. The warnings that remain are deliberate — see
below.

### Advisor Warnings That Remain By Design

`anon_security_definer_function_executable` on `is_published_content`,
`public_archive_enabled`, `published_content_has_source`,
`user_has_assigned_content` and `user_has_assigned_source`: these five are
called from inside RLS policies, and PostgreSQL enforces EXECUTE on functions
a policy expression calls. Confirmed on a throwaway table — revoking made a
policy-guarded SELECT fail with `42501` instead of returning rows. Revoking
them would break every reader's access to their own content. Each returns a
boolean, and the two that answer per-reader questions scope themselves with
`auth.uid()`. **Safe.**

`authenticated_security_definer_function_executable` on the eight user-facing
RPCs: that is the intended access. Each is scoped by `auth.uid()` and raises
on a missing or foreign caller. **Safe.**

`rls_enabled_no_policy` (INFO) on `business_story_history`,
`generation_runs`, `job_runs`, `mini_case_history` and
`push_notification_deliveries`: intended. These are server-only; RLS with no
policy is deny-all for `anon` and `authenticated`, and `service_role`
bypasses RLS. No policy is invented to silence it. **Safe.**

`auth_leaked_password_protection`: **cannot be fixed on this plan.** The
Management API refuses it with HTTP 402 — "Configuring leaked password
protection via HaveIBeenPwned.org is available on Pro Plans and up". The
project is on Free. Raising the server password minimum from 6 to 8 (matching
what the app already enforces) was applied as the available compensating
control. **Unsafe only in the narrow sense that breached passwords are still
accepted; needs a Pro upgrade.**

## Active Issues

### Leaked Production Credentials In Git History

Status: production blocker, highest priority.

Real secrets were committed early in the project's life and later removed from
the working tree. Removing a file does not remove it from history, and this
repository is **public** on GitHub.

| Secret | Added in | Removed in | Still the value in use? |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` (production, `wkbviidrbmehmjbhvpeh`) | `d91aee1`, `56045d0` (`.env.python`, `.env.python.bak`) | `d273ae2` | **Yes** |
| `RESEND_API_KEY` (`re_Vg…`) | `56045d0` | `d273ae2` | **Yes** |

Both commits are ancestors of `origin/main`, so anyone who has ever cloned or
forked the repository already has them, as do GitHub's own fork and event
caches. A Supabase service-role key bypasses every RLS policy in the project:
it can read and write every reader's account data.

History was deliberately **not** rewritten. Rewriting would change every commit
hash, break every existing clone, and — because forks and caches keep the old
objects — would not actually make the leaked keys safe. Rotation is what makes
them safe.

Workaround: none. Rotate before launch.

The project already carries modern API keys beside the legacy pair, so the
rotation does not need new code. Verified against the live REST API on
2026-08-25: the publishable key reads as `anon` (200) and is refused on a
server-only RPC (401); the secret key reads server-only tables and calls
server-only RPCs (200). Nothing in the app or the engine parses a key as a
JWT, so a non-JWT `sb_…` key drops straight in — the one JWT decode in
`scripts/supabase-schema-doctor.mjs` decodes a *user* access token, which
stays a JWT after rotation.

| Consumer | Variable | New value |
| --- | --- | --- |
| mobile (`apps/mobile/.env`, EAS) | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_…` |
| web (`.env`) | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| content engine (`services/content-engine/.env`) | `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` |
| legacy script (`.env.python`) | `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` |
| GitHub Actions | `SUPABASE_SERVICE_ROLE_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` |

The variable *names* stay as they are. The compromised value is the problem,
not the naming, and renaming would churn EAS and workflow configuration for
nothing.

1. Migrate every consumer above to the modern keys, one at a time.
2. Only once all of them are moved, disable the legacy `anon` and
   `service_role` keys in Supabase → Project Settings → API Keys.
3. Resend → API Keys → revoke `re_Vg…`, issue a new one, update
   `.env.python` (the only runtime consumer, `dispatchnewsletter.py`), and
   send one test email before revoking the old key.
4. Re-run `npm run supabase:doctor -- --live` to confirm the new key works.
5. Decide whether the repository should stay public.

### Editorial Pipeline Has Never Published End-To-End

Status: production blocker.

The ChatGPT staging project (`kukyotcgbnchsoeriqoz`) exists and is configured —
`automation_config` holds the `chatgpt-staging-v1` pipeline definition, and the
tables the bridge reads (`automation_batches`, `generation_jobs`,
`generation_outputs`, `generation_reviews`, `publication_receipts`) are all
present. What has never happened is a successful run through it.

Observed on 2026-08-25:

| Table | State |
| --- | --- |
| `automation_batches` | 2 `cancelled`, 1 `generating` since 2026-08-22. None ever approved. |
| `generation_jobs` | 93 `cancelled`, 23 `queued`, 0 completed. |
| `publication_receipts` | **0 rows** |
| production `job_runs` | last entries are `daily-job-test` from June |

So `content-daily-job.yml` would find no approved batch and take its clean
no-op path with a warning annotation. Production does have current content —
editions exist through 2026-08-23 for all 9 profiles — but they were published
by hand, not by the pipeline.

Two consequences worth being explicit about: shipping the app does not by itself
start producing editions, and the automated path is unproven, so its first real
run will also be its first test.

Note also that the staging project's schema lives only in that project. It is
not in `supabase/migrations`, which targets production only. If the staging
project were lost it would have to be rebuilt by hand.

Workaround: keep publishing by hand until one batch has gone
generating → review → approved → published with a receipt, then let the schedule
take over.

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
Concretely: `eas whoami` reports "Not logged in", so `app.json` still has no
`extra.eas.projectId` and no build can be started from this repository.

Workaround: complete [TESTFLIGHT_READINESS.md](TESTFLIGHT_READINESS.md) and
[STORE_RELEASE_CHECKLIST.md](STORE_RELEASE_CHECKLIST.md) before inviting
external testers.

## Resolved

### Initial Catalog Not Generated

Status: resolved (2026-08-25).

This said the 10 Business Stories and 30 Mini Cases had never been produced.
They have. Counted directly in production (`content_items` where
`metadata->>'catalog_entry_id'` is set):

| Type | FR | EN |
| --- | --- | --- |
| Business Story | 20 | 20 |
| Mini Case | 120 | 120 |

Published inventory overall: 11 business stories, 66 mini cases, 21 (EN) / 18
(FR) newsletter articles, plus archived history. The curated launch catalog v2
was imported on 2026-08-22; the v1 editorial review that preceded it is checked
in as `catalog-quality-review.md` / `.json`.

### `delete-account` Edge Function Not Deployed

Status: resolved (2026-08-25).

It has been deployed since 2026-08-19. `delete-account` is ACTIVE on
`wkbviidrbmehmjbhvpeh` at version 2 with `verify_jwt: true`, and the deployed
bundle contains the same logic as `supabase/functions/delete-account/index.ts`.
Unauthenticated and malformed-JWT requests both answer 401.

Two follow-ups are still open and tracked as blockers above: the endpoint env
vars are not set in any build, and `ACCOUNT_DELETION_ALLOWED_ORIGINS` is not
configured.

### Scheduled Content Workflow Not On `main`

Status: resolved (2026-08-25).

`.github/workflows/` did not exist on `main` at all — not just
`content-daily-job.yml` but also `push-notification-retry.yml`,
`push-receipts.yml` and `learning-path-ci.yml`. All four are now on the default
branch and their schedules are live.

They will fail until the repository secrets exist, which is tracked as a
separate blocker above.

### Production Schema Drift

Status: resolved (2026-08-25).

Two migrations had been applied directly to production and were missing from
the repository (`20260822184440_curated_launch_mini_case_import_helper`,
`20260822184715_fix_curated_launch_import_digest_search_path`). The mismatch
made the Supabase CLI refuse `db pull` and `db push` outright, and a project
rebuilt from this repository would have lacked the import helper.

Both are now checked in, recovered verbatim from
`supabase_migrations.schema_migrations`. Local and remote histories match on all
32 migrations.

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

Status: resolved.

`.github/workflows/content-daily-job.yml` runs the four editorial days in the
product timezone, with preflight, schema doctor, staging publication, push
notifications and strict job health. It is now on the default branch — see
"Scheduled Content Workflow Not On `main`" above for what still gates it.

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
