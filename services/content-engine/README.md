# PersoNewsAP Content Engine

Server-side content generation pipeline for the PersoNewsAP daily drop.

The service keeps generation away from mobile clients and writes generated content through Supabase service-role access only.

## Layers

- `src/sources`: RSS, news API, and curated source connectors.
- `src/processing`: deduplication, topic categorization, and importance ranking.
- `src/generation`: structured daily content generation and validation.
- `src/storage`: Supabase persistence for sources, content items, generation runs, and daily drops.
- `src/scheduler`: daily job orchestration and user daily drop assembly.

## Environment

Required for persistence:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `NEWS_API_KEY`
- `NEWS_API_ENDPOINT`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` defaults to `gpt-4.1-mini`
- `OPENAI_REQUEST_TIMEOUT_MS` defaults to `60000`

## Commands

Test/no-write commands:

```sh
npm run check
npm run build
npm run dry-run
npm run llm-run
```

Read-only diagnostic:

```sh
npm run debug-users
```

Dangerous write commands for local/disposable/staging projects:

```sh
npm run persist-test
npm run cleanup-test
npm run assign-test-users
npm run personalize-test
npm run daily-job-test
```

Production scheduler command:

```sh
npm run daily-job
```

`dry-run` builds the service and runs the local executable without Supabase writes, migrations, API keys, or LLM calls.

`daily-job` is the production scheduler entrypoint. Use `DRY_RUN=true` for a no-write rehearsal; write mode requires server-side Supabase service-role credentials.

The default dry run uses bundled sample articles, including a duplicate URL variant, then runs the normal pipeline:

1. source collection
2. deduplication
3. topic categorization
4. importance ranking
5. placeholder structured generation
6. validation
7. JSON printing

```sh
npm run dry-run
```

Useful options:

```sh
npm run dry-run -- --date 2026-04-26
npm run dry-run -- --languages en,fr
npm run dry-run -- --topics business,finance,tech_ai
npm run dry-run -- --newsletter-count 3
```

Optional live RSS fetching can be added without API keys:

```sh
npm run dry-run -- --live-rss
LIVE_RSS=true npm run dry-run
```

The command prints a JSON object with diagnostics and one or more daily drop payloads. `persisted` is always `false` in dry-run mode.

Live RSS remains opt-in and read-only. Each feed is fetched independently, so one malformed XML document, timeout, or HTTP failure is logged and skipped without failing the whole run. Source logs are written to stderr and include:

- `source_connector_health` for each connector with `connector`, `attempted`, `succeeded`, `failed`, `article_count`, and `error`
- `rss_source_health` for each RSS source with source id, publisher, status, article count, skipped count, duration, and error when failed
- `rss_connector_health` with attempted/succeeded/failed feed counts and a short error list
- `rss_items_skipped_stale` and `rss_items_skipped_before_since` when recency filtering drops feed items

RSS tuning knobs:

```sh
LIVE_RSS=true RSS_TIMEOUT_MS=8000 RSS_ARTICLES_PER_SOURCE=5 RSS_MAX_AGE_DAYS=21 npm run dry-run
LIVE_RSS=true RSS_ALLOW_STALE=true npm run dry-run
```

Use `RSS_ALLOW_STALE=true` only for diagnostics against slow-moving feeds. The default rejects clearly stale articles and keeps sample mode unchanged when `LIVE_RSS` is unset.

## LLM Generation

`llm-run` uses the same source collection and processing pipeline, then asks OpenAI for the final structured daily drop. It still does not write to Supabase.

```sh
OPENAI_API_KEY=... npm run llm-run
```

For safe local testing, `llm-run` always limits the generated drop to:

1. one newsletter article
2. one business story
3. one mini-case
4. one concept

This keeps local OpenAI requests smaller and easier to inspect. `dry-run` is unchanged and still honors `--newsletter-count`.

Useful options mostly match `dry-run`:

```sh
OPENAI_API_KEY=... npm run llm-run -- --date 2026-04-26
OPENAI_API_KEY=... npm run llm-run -- --languages en,fr
OPENAI_API_KEY=... npm run llm-run -- --topics business,finance,tech_ai
```

`--newsletter-count` is intentionally ignored by `llm-run` local test mode and capped at one newsletter article.

The LLM path uses structured JSON output, validates the generated daily drop, and retries when required fields, source URLs, dates, reading time, slot/type consistency, or module counts are invalid. If `OPENAI_API_KEY` is missing, the command exits with a clear error before any generation request is attempted.

Progress logs are printed to stderr so stdout can remain valid JSON for scripts. A normal run shows:

- source fetch started/completed
- processing started/completed
- LLM generation started/completed for each planned/generated item
- validation started/completed

Use a shorter timeout when testing failure handling:

```sh
OPENAI_API_KEY=... OPENAI_REQUEST_TIMEOUT_MS=10000 npm run llm-run
```

If OpenAI fails, the command reports whether the failure was a timeout, network/endpoint problem, HTTP/API error, missing JSON output, or invalid JSON.

## Safe Persistence Test

`persist-test` is a local, explicit-confirmation command for checking that generated daily-drop content can be written through the Supabase persistence layer. It is fail-closed: it refuses to run unless all required environment variables are present.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CONFIRM_PERSIST_TEST=true`

Optional:

- `TEST_USER_ID` assigns the generated test drop to exactly one authenticated user.

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_PERSIST_TEST=true \
npm run persist-test
```

Safe defaults:

- uses bundled sample articles only
- generates one language only
- generates one newsletter article, one business story, one mini-case, and one concept
- stores content with `draft` status when `TEST_USER_ID` is not set
- does not create user daily drops when `TEST_USER_ID` is not set, and prints a clear stderr message explaining that no user drop was created
- adds test metadata to each persisted `content_items.metadata` object:
  - `is_test_data: true`
  - `test_mode: "persist-test"`
  - `test_run_id`
  - `test_label: "TEST CONTENT - safe to delete with npm run cleanup-test"`
  - `persisted_by`
- prefixes every persisted title with `[TEST persist-test]`

To assign the generated test content to one user, set `TEST_USER_ID` to that user's `auth.users.id` / `profiles.id`:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_PERSIST_TEST=true \
TEST_USER_ID=00000000-0000-0000-0000-000000000000 \
npm run persist-test
```

When `TEST_USER_ID` is provided, `persist-test` stores the test content as `published`, upserts one `daily_drops` row for that user and drop date with `status = published`, and replaces that drop's `daily_drop_items` links with the generated content items. It does not assign the test drop to any other users. On reruns, the JSON output reports whether the user drop was created or updated, plus stale link and duplicate-input counts.

Useful options:

```sh
npm run persist-test -- --date 2026-04-26
npm run persist-test -- --language fr
npm run persist-test -- --topics business,tech_ai
```

`persist-test` ignores `--newsletter-count` and `--live-rss` to keep the write small and local-test friendly. Use a local or disposable Supabase project by default. Do not point it at production unless you are deliberately testing production persistence and accept that test rows will be written.

### Cleaning Up Test Content

`cleanup-test` deletes draft test content for one explicit `test_run_id`.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CONFIRM_CLEANUP_TEST=true`
- `--test-run-id persist-test-...`

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_CLEANUP_TEST=true \
npm run cleanup-test -- --test-run-id persist-test-abc123
```

Safety limits:

- only matches `content_items.metadata.test_mode = "persist-test"`
- only deletes rows where `metadata.is_test_data = true`
- only deletes rows whose title starts with `[TEST persist-test]`
- only deletes `draft` content items
- deletes linked `content_item_sources` and matching `generation_runs`
- does not delete `sources`, `daily_drops`, `daily_drop_items`, profiles, preferences, or user data

If cleanup skips a row, inspect the JSON output and delete it manually only after confirming it is test content.

### Assigning Test Content To App Users

`assign-test-users` assigns existing published `persist-test` content to a small set of app users. It does not generate content. It only reads app `profiles` with `user_preferences`, so legacy newsletter-only users are never selected.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CONFIRM_ASSIGN_TEST=true`

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_ASSIGN_TEST=true \
npm run assign-test-users
```

Safety limits:

- default limit is 5 users
- selects only `content_items.status = published`
- selects only content with `metadata.test_mode = "persist-test"` and `metadata.is_test_data = true`
- requires the test content group to contain newsletter, business story, mini-case, and concept slots
- skips users who already have a `daily_drops` row for the selected test content date
- logs every skipped existing drop and incomplete selection
- skips users whose preferences cannot receive a complete test drop
- writes only `daily_drops` and `daily_drop_items` assignments

Useful options:

```sh
npm run assign-test-users -- --limit 5
npm run assign-test-users -- --test-run-id persist-test-abc123
```

The command logs how many users were considered, skipped, and assigned. Use this after publishing or creating a published persist-test content set, for example via `persist-test` with `TEST_USER_ID`.

### Assigning Published Content By Preferences

`personalize-test` assigns already-published content to app users from `profiles`, `user_preferences`, and `user_topic_preferences`. It does not generate content and never reads legacy newsletter-only users.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CONFIRM_PERSONALIZE_TEST=true`

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_PERSONALIZE_TEST=true \
npm run personalize-test -- --date 2026-04-26 --limit 3
```

Safety limits:

- default limit is 3 users
- skips users who already have a daily drop for the selected date
- requires enough published content for each selected user's language and topics
- writes only `daily_drops` and `daily_drop_items`
- intended for controlled staging rehearsal, not default tester setup

## Production Daily Job

`daily-job` is the production-safe scheduler command. It reuses the same fetch, processing, generation, validation, persistence, and assignment path as `daily-job-test`, but it does not mark titles as test content and it can assign all eligible app users when `USER_LIMIT` is absent.

Supported env:

- `LANGUAGES=fr,en` controls generated languages. Defaults to `fr,en`.
- `CONTENT_STATUS=published` stores generated content as `draft`, `review`, or `published`. Assignment only runs for `published`.
- `USE_LLM=true` uses OpenAI generation. Requires `OPENAI_API_KEY`, including in dry runs.
- `LIVE_RSS=true` enables curated RSS fetching.
- `USER_LIMIT=5` optionally limits assignments per language. Omit it to consider all eligible users.
- `DRY_RUN=true` fetches, processes, generates, validates, and prints summary JSON without Supabase writes.
- `TOPIC_LIMIT=3` can narrow the default topic set for local rehearsals.

Local no-write rehearsal:

```sh
DRY_RUN=true \
LANGUAGES=fr,en \
CONTENT_STATUS=published \
USE_LLM=false \
LIVE_RSS=false \
npm run daily-job
```

Production-like write run:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
LANGUAGES=fr,en \
CONTENT_STATUS=published \
USE_LLM=true \
OPENAI_API_KEY=... \
LIVE_RSS=true \
npm run daily-job
```

Limited staging write run:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
LANGUAGES=fr,en \
CONTENT_STATUS=published \
USE_LLM=false \
LIVE_RSS=true \
USER_LIMIT=5 \
npm run daily-job
```

Cron or GitHub Actions should call the same script from `services/content-engine`:

```sh
cd services/content-engine
LANGUAGES=fr,en CONTENT_STATUS=published USE_LLM=true LIVE_RSS=true npm run daily-job
```

For GitHub Actions, store `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` as repository or environment secrets. Start with `DRY_RUN=true` in the workflow until the JSON summary shows healthy fetched, processed, generated, and failure counts.

Safety behavior:

- `DRY_RUN=true` never creates `content_items`, `generation_runs`, `daily_drops`, or `daily_drop_items`.
- write mode refuses to run without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- `USE_LLM=true` refuses to run without `OPENAI_API_KEY`.
- source fetch and generation stages retry before failing a language.
- one language failure is reported in the JSON summary without hiding successful languages.
- assignment uses only app `profiles`, `user_preferences`, and enabled `user_topic_preferences`; newsletter-only users are not selected.
- assignment uses the generated drop matching the user's profile language.

The JSON summary reports fetched, processed, generated, stored, users considered, users assigned, failures, skipped users before assignment, incomplete selections, stale item links removed, and duplicate input links skipped.

## Daily Job Test

`daily-job-test` is the scheduler-shaped local workflow. It fetches sources, processes/ranks/categorizes them, generates one marked test daily drop per language, persists the generated content, and assigns published drops to a small number of onboarded mobile app users.

It is fail-closed: it refuses to write unless all required safety variables are present.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CONFIRM_DAILY_JOB_TEST=true`

Optional:

- `USE_LLM=true` uses OpenAI generation instead of the deterministic dry-run generator. Also set `OPENAI_API_KEY`.
- `LIVE_RSS=true` adds live RSS feeds to the bundled sample articles.
- `USER_LIMIT=5` controls the maximum number of app users assigned per language. Defaults to 5 and is capped at 25.
- `LANGUAGES=fr,en` sets the languages when `--language` or `--languages` is not provided. Defaults to `fr,en` so French and English app profiles are covered by default.
- `TOPIC_LIMIT=5` limits how many approved topics are used from the selected topic list.
- `CONTENT_STATUS=published` stores generated content as `draft`, `review`, or `published`. Assignment only runs for `published`.

Safe default run using sample articles and deterministic generation:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_DAILY_JOB_TEST=true \
USER_LIMIT=5 \
CONTENT_STATUS=published \
npm run daily-job-test
```

If your shell already has the required Supabase safety variables exported, the standard language-coverage run is:

```sh
LANGUAGES=fr,en npm run daily-job-test
```

LLM-backed run:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_DAILY_JOB_TEST=true \
USE_LLM=true \
OPENAI_API_KEY=... \
USER_LIMIT=5 \
npm run daily-job-test
```

Multi-language live RSS test with a smaller topic set:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_DAILY_JOB_TEST=true \
LIVE_RSS=true \
LANGUAGES=fr,en \
TOPIC_LIMIT=3 \
USER_LIMIT=3 \
npm run daily-job-test
```

Generate and store review content without assigning users:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_DAILY_JOB_TEST=true \
CONTENT_STATUS=review \
npm run daily-job-test
```

Useful command options:

```sh
npm run daily-job-test -- --date 2026-04-26
npm run daily-job-test -- --languages fr,en
npm run daily-job-test -- --languages en
npm run daily-job-test -- --topics business,finance,tech_ai
```

Safety behavior:

- no Supabase writes happen unless `CONFIRM_DAILY_JOB_TEST=true` and service-role credentials are present
- generated titles are prefixed with `[TEST daily-job-test]`
- `content_items.metadata` includes `is_test_data: true`, `test_mode: "daily-job-test"`, `test_run_id`, `use_llm`, `live_rss`, and `content_status`
- the `test_run_id` is stable for the same date, language, generation mode, RSS mode, and topic set
- assignments are limited by `USER_LIMIT` and run only when `CONTENT_STATUS=published`
- each user is assigned from the generated drop matching their `profiles.language`
- app users are selected only through mobile app tables: `profiles`, `user_preferences`, and enabled `user_topic_preferences`, sorted by `user_id`, not legacy newsletter-only tables
- selection matches the current mobile onboarding completion rule: matching profile language, a `user_preferences` row, and at least one enabled topic preference
- users skipped before assignment are logged with a reason such as language mismatch, missing preferences, or missing enabled topics
- users with an existing `daily_drops` row for the same date are updated predictably
- stale `daily_drop_items` links are removed when a rerun generates fewer or different items
- write stages are logged but not retried as a whole, to avoid duplicating partial writes

Progress logs are printed to stderr for each stage:

- source fetch
- processing
- generation
- validation
- persistence preflight
- persistence
- content stored
- assignment

Failure behavior:

- source connectors log failures individually
- source fetch only fails a language when every configured source returns no usable articles
- one language failure does not hide the other language diagnostics
- the JSON result includes a top-level `status`, `summary`, and per-language `status`/`error`
- the process exit code is set to failure when any language fails, after JSON is printed

The JSON result reports fetched, processed, generated, stored, considered, assigned, created, updated, stale-link, duplicate-link, and skipped counts per language plus totals.

### Debugging User Eligibility

`debug-users` is a read-only diagnostic for explaining why `daily-job-test` might report `users_considered: 0` or assign fewer users than expected. It requires service-role credentials to inspect app profile and preference tables, but it does not write to Supabase and does not select or print emails.

It checks `fr,en` by default. Set `LANGUAGES=en`, `LANGUAGES=fr,en`, `LANGUAGE=fr`, `--languages`, or `--language` to narrow or reorder the diagnostic.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run debug-users
```

If your shell already has the required Supabase credentials exported, check both app languages with:

```sh
LANGUAGES=fr,en npm run debug-users
```

Useful options:

```sh
npm run debug-users -- --languages fr,en
npm run debug-users -- --languages en
npm run debug-users -- --language en
npm run debug-users -- --date 2026-04-26
npm run debug-users -- --language fr --limit 10
```

The output reports:

- total `profiles`
- total `user_preferences`
- total `user_topic_preferences`
- enabled topic preference count
- profiles matching each target language
- users daily-job-test would consider before and after `USER_LIMIT`
- eligible new assignments
- users that would update an existing drop
- skip reason counts for `no_profile`, `no_preferences`, `no_topics`, `language_mismatch`, and `already_has_drop`
- a per-language result section plus a top-level summary across requested languages

No emails, service keys, or user secrets are printed.

## Daily Job

```ts
import { createContentEngine } from "@personewsap/content-engine";

const engine = createContentEngine();

await engine.runDailyContentJob({
  dropDate: "2026-04-26",
  languages: ["en", "fr"],
  publish: false
});
```

Generated items are stored as `review` content by default. Use `publish: true` only after an editorial review path exists.
