# Known Issues

Last reviewed: 2026-09-07 (first build of both projects from an empty database)

What a tester may hit, what the coordinator should watch, and what is not
production-safe yet. Items are removed only when they are genuinely fixed —
never to make this document read better.

## Release Blockers Remaining

| Blocker | Status | Why it matters |
| --- | --- | --- |
| **Leaked production credentials in git history** | **open — highest priority** | The live Supabase service-role key and Resend API key are reachable in the history of a public repository. A service-role key bypasses every RLS policy. The replacement keys already exist and the swap is verified against the live API — only the human rotation step is left. See the section below. |
| GitHub Actions secrets not configured | open | The repository has no secrets at all, at repository level or in the `Preview` / `Production` environments. The four scheduled workflows are now on `main` and will fail on every run until `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` exist. |
| EAS project not initialised | open | `eas whoami` reports "Not logged in" and `app.json` has no `extra.eas.projectId`. No build can start, and physical-device push tokens need the project id. Requires the Expo account holder. |
| Account deletion endpoint not wired into builds | **mobile resolved 2026-08-25; web still open** | The mobile app now derives `<EXPO_PUBLIC_SUPABASE_URL>/functions/v1/delete-account` when the explicit variable is unset, so builds can delete accounts without extra configuration (the derived URL was checked against the live function: 401 without a token, not 404). The web page still needs `VITE_ACCOUNT_DELETION_ENDPOINT`. Store requirement. |
| `ACCOUNT_DELETION_ALLOWED_ORIGINS` not set | open | Without it the function returns an empty `Access-Control-Allow-Origin`, so the browser page cannot call it. Google Play requires the external web deletion URL to work. Mobile is unaffected. |
| Editorial pipeline has never published end-to-end | open | The ChatGPT staging project is provisioned and configured, but no batch has ever reached an approved state: 2 cancelled, 1 stuck in `generating` since 2026-08-22, 93 cancelled and 23 queued generation jobs, and **0 rows in `publication_receipts`**. The scheduled workflow will find no approved batch and no-op. Current editions were published by hand. |
| Support address not configured | open | `VITE_SUPPORT_EMAIL` is unset, so /support says so instead of showing an address. Both stores require a working support contact. |
| Push delivery not validated on a real device | open | The sender, idempotency and tap routing are covered by tests; Expo Go cannot fully exercise remote notifications. Needs a development build or TestFlight. |
| Editorial review gate missing | open | LLM output can be structurally valid and still not be publishable, especially for law, medicine and finance. There is no human review step before production publication. |
| Source licensing review missing | open | The ingestion layer reads RSS/feed metadata only. Publisher terms and commercial reuse rights are still unreviewed. Treat sources as internal-test-only until that is settled. |
| TestFlight operations incomplete | open | Signing, App Store Connect setup, privacy answers and the invite process still need an owner. |
| Teams assignment engine wired, not yet deployed | **code resolved 2026-09-07; deployment open** | `public.materialize_edition_assignments(edition_date)` is now publish stage 3 in `supabase/functions/personews-task-publisher/index.ts`, after content and questions, and `verify_scheduled_edition_game` fails the read-back if the assignments did not land — so a stage that silently wrote nothing cannot produce a receipt. Pinned by `supabase/tests/publisherQuestionContract.test.ts` and exercised end to end by `npm run teams:test:e2e:local`. What is left is purely operational: the production Edge Function has not been redeployed, so until `npm run edge:deploy:prod` runs, the live publisher is still the two-stage one and the assignment tables stay empty in production. |
| Teams migrations still pending everywhere | open | The nineteen `20260906090000`–`20260907170000` migrations have never been applied to staging or production. They replay cleanly from an empty database — `supabase db reset` applies all 63 production migrations and `npm run db:test:sql:local` passes against the result. Before pushing, re-validate against the real remote schema with `npm run teams:test:sql -- --with-migrations`, which inlines them into a transaction that rolls back. |
| Staging pipeline core is not in version control | open | `refresh_batch_status`, `get_ready_batch_payload`, `mark_batch_published`, `validate_generation_output` and the `trg_enforce_production_batch_mode` trigger exist only inside the staging project and were applied by hand. `supabase-staging/supabase/tests/local_harness.sql` supplies local stand-ins written from their callers so the gate can be run at all; they are NOT the remote definitions and the harness says so on every run. Recover them with `select pg_get_functiondef(oid) …` against staging, commit them as a migration, and delete the harness. |
| Scored-question preflight not applied to staging | open | `supabase-staging/.../20260906110000_scored_question_preflight.sql` adds the question contract, the legacy cutover and the gate that refuses a batch whose questions are wrong. Until it is applied, `get_scheduled_edition_publish_plan` is the pre-existing editorial gate only, and an edition with no questions still publishes. Validate with `npm run publisher:test:sql:dry`. Note the cutover default (`2026-09-09`): move it with `app.scored_question_cutover_edition` if the generators are not ready by then, or every edition from that date fails the gate. |
| Generators not yet emitting scored questions | open | The contract now reaches the Scheduled Tasks through the bridge manifest (`scored_question_contract`), and the prompts carry it, but no batch has been generated against it. The first batch after the cutover will fail the gate until the generators are re-run. |

## Resolved on 2026-09-07 — proven from an empty database

Everything below was found by building both projects from zero for the first
time (`supabase db reset`) and running the suites against the result. Each one
had been in the repository, unnoticed, because no suite had ever executed
against a schema that came from the migrations.

| Defect | Where | Fix |
| --- | --- | --- |
| A replay from zero died on migration 13 of 16 | `team_directory` renamed a view column through `CREATE OR REPLACE`, which Postgres refuses (42P16) | `20260906110000` drops and recreates the view; it also stops silently inheriting `security_invoker = true` from the earlier definition, which would have returned no rows to any member |
| One migration filename was not a timestamp | `20260906106000` — minute 60 | renamed to `20260906110000`; `supabase:migration-check` now audits filenames with no token, which is why it went unseen |
| `authenticated` held INSERT/UPDATE/DELETE/TRUNCATE on all 18 Teams tables | every migration revoked from `PUBLIC, anon` and never from `authenticated`; Supabase's default privileges grant ALL on each new table in `public` | `20260907150000_teams_privilege_hardening` takes them back and grants only what each client surface reads or writes. RLS meant no row was ever exposed, but the migrations' own claim that "`authenticated` holds nothing on `public.teams`" was false |
| The avatar impersonation guard accepted every malformed path | `is_own_avatar_path` returned NULL, not false, for a path that is not `<uuid>/<file>`, and `NOT NULL` is NULL | `20260907160000_avatar_path_guard_null_fix`: the predicate coalesces to false, and the caller uses `IS NOT TRUE` so an unexpected NULL fails closed |
| The scored-question preflight reported the wrong reason for a missing question set | four `jsonb_typeof(x) <> 'array'` comparisons went NULL when the key was absent, so the branch written to catch it was skipped | `20260906110000` coalesces all four. One of them let a payload carrying no `jobs` array at all pass the composition check |
| The Teams SQL suite had never run to completion | it inserted a `question_role` its own migration's CHECK constraint forbids, and stopped on statement 262 | suite corrected; it now runs 184 checks, all passing |
| The staging project could not be built at all | every staging migration reads `automation_batches`, `generation_jobs`, `generation_outputs`, `generation_reviews`, `publication_receipts`, `automation_health` and `automation_config`, and none of them creates any | `20260901080000_staging_pipeline_baseline` — idempotent, so it is a no-op against the real staging project |

## Resolved on 2026-09-07 — hostile product pass over the finished feature

Found by driving the product's own scenarios against the code rather than
re-running the suites that shipped with it. Both defects had full unit coverage
of the piece that was correct and none of the wiring that was not, so every
suite was green while the reader saw the bug.

| Defect | Where | Fix |
| --- | --- | --- |
| A question the reader had already answered came back blank and worth zero | `start_question_attempt` answered `already_submitted` and nothing else: no prompt, no options, no score, no record of what was chosen. `questionReducer` has always accepted an `answered` payload — `quizSession.test.ts` proves it — but nothing ever built one, so the reducer fabricated `0 / bad / no selection`. Every reopening path hit it: the app killed mid-reading, a second device, the archive, a language switch. A reading finished across two sessions reported a total short by every point earned in the first one | `20260907170000_resume_settled_question_attempt` returns the prompt, the options in their stored order, the chosen option, the score, the band and expired/skipped — populated only when `status = 'submitted'`, the same gate `get_question_feedback` opens on, so no grading is released any earlier than before. `quizData.ts` parses it, `useQuizFlow.ts` hands it to the reducer and loads the explanation. Proven by SQL checks B20a/B33–B33d and ten E2E checks through real JWTs |
| An article could be handed another content type's questions | `fetchQuestionsByContentItemIds` grouped `logical_questions` by `content_logical_key` alone. That column is not unique — the table's key is `(content_logical_key, content_type, question_sequence)` — so a mini case and a newsletter article sharing a staging batch each received all five questions. The three extra ones were never assigned to the reader, so `start_question_attempt` refuses each with 42501 and the flow stops on a Retry it can never pass: the question on screen is the first unsettled one, and a failed start never settles | grouped on content type and key together in `apps/mobile/src/features/today/dailyDropData.ts`; pinned by `teamEdition.test.ts`, which fails against the old grouping |
| The reading prompts told the generator the reader could re-read the article | `newsletter_prompt_final.md` and `business_story_prompt_final.md` both opened their question section with "Le lecteur a le contenu sous les yeux". `ReadingQuizScreen` replaces the article — that is why it is a screen and not a section — so the premise was false for both formats, and no downstream validator could catch a question that leans on a detail the reader can no longer see | both prompts now state that the text is gone and what follows from it in each direction; the Mini Case prompt keeps the opposite rule, because its case genuinely does stay on screen. The Reviewer rubrics gained the matching check, and `questionPromptContract.test.ts` pins all of it |

Commands: `docs/LOCAL_PROOF.md`.

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

### Teams Have No Size Cap, And Their Lists Are Not Virtualized

Status: open, not a defect today — a shape that becomes one at scale.

Nothing bounds how many members a team may have, or how many teams a reader may
join. `join_team_with_invite` checks the code and the team's status and stops
there, and `get_team_leaderboard` and `get_team_roster` return every row with no
`LIMIT`. On the client, Team Detail, Members and the Teams list all render with
`.map()` inside the shared `AppScreen` scroll view rather than a `FlatList`, so
a team of four hundred mounts four hundred rows — each of which resolves a
signed avatar URL.

Left alone on purpose. Choosing the cap is a product decision, not an
engineering one, and silently truncating a leaderboard would be a worse answer
than rendering a long one: the standing would then be wrong rather than slow.
For the invite-code league this ships as, tens of members is the realistic
shape and the current rendering is fine.

The remedy, when the number exists: enforce it in `join_team_with_invite` so the
bound is a server rule rather than a client hope, and convert the three screens
to `FlatList` with `ListHeaderComponent` for the chrome above each list.

### Archiving A Team Revokes Reading Access To Its Past Editions

Status: open question for the product, deliberate in the code.

`get_my_team_edition_content` and `get_my_team_archive_content` both require
`teams.status = 'active'`. When a team is archived — by its owner, or by the
last member leaving, or by an owner deleting their account with nobody to
inherit — its members immediately lose the ability to reopen Team articles they
read while it was live. Scores are untouched: archiving is a soft delete
precisely so the standings survive (`20260907130000`), and `question_attempts`
and `team_question_scores` keep every row.

That is the same revocation rule leaving a team follows, applied to the whole
team at once, and it is consistent. Whether it is what the product wants is a
separate question: an article somebody read is arguably theirs to reread, and
the alternative — keeping past editions readable to the roster as it stood on
the day — is a one-clause change to both RPCs.

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
