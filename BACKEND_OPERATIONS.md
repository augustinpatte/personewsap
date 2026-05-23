# Backend Operations

Daily operator guide for the PersoNewsAP content backend.

## Production Env Contract

Non-dry production writes must have all of these set:

- `PRODUCTION_DAILY_JOB=true`
- `DRY_RUN=false`
- `LIVE_RSS=true`
- `LIVE_RSS_ONLY=true`
- `USE_LLM=true`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

Recommended operator env:

- `LANGUAGES=fr,en`
- `CONTENT_STATUS=published`
- `OPENAI_REQUEST_TIMEOUT_MS=120000`
- `OPENAI_INPUT_COST_PER_1M_TOKENS`
- `OPENAI_OUTPUT_COST_PER_1M_TOKENS`

Optional controls:

- `RUN_ID=...` to make an operator-selected id visible in `job_runs`.
- `STRICT_ALL_LANGUAGES=true` to fail the whole command if either FR or EN fails.
- `USER_LIMIT=...` only for staging or controlled rollout.

Never put service-role or OpenAI keys in Expo, Vite, or mobile env files.

## Operator Workflow

1. Prove schema and RLS before touching content:

```sh
npm run supabase:doctor -- --live
```

2. Prove production-shaped generation without writes:

```sh
OPENAI_API_KEY="..." \
LANGUAGES=fr,en \
npm run content:prod-dry-run -- --topics business,finance,tech_ai,law,medicine,engineering,sport_business,culture_media
```

3. Confirm the dry-run JSON has:

- `dryRun: true`
- `sourceMode: "rss"`
- `sampleContentEnabled: false`
- `status: "completed"` or an understood `partial_failed`
- nonzero `operatorSummary.generated`
- zero `operatorSummary.stored`
- zero `operatorSummary.assigned`

4. Run the production write only from a server-side terminal:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
OPENAI_API_KEY="<openai-key>" \
LANGUAGES=fr,en \
npm run content:prod-run
```

5. Check health without reading the full job logs:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run content:health -- --date "$(date +%F)" --limit 3
```

6. Treat the run as complete only when `content:health` reports `status: "ok"` or a reviewed `status: "warning"` with an accepted reason.

## Stored Metrics

Production-shaped `daily-job` and `daily-job-test` runs write one row to `public.job_runs`.

`generation_runs` remains item-level. It still tracks each generated content item. `job_runs` is job-level and stores the cross-language operational summary.

Stored in `job_runs.metrics`:

- `rss_attempted`
- `rss_succeeded`
- `rss_failed`
- `articles_by_topic`
- `stale_fallback_used`
- `stale_fallback_used_by_topic`
- `llm_latency_ms`
- `llm_timeout_count`
- `validation_failures_by_rule`
- `generated_items_by_language`
- `stored_items`
- `content_items_deduplicated`
- `assigned_users`
- `estimated_input_tokens`
- `estimated_output_tokens`
- `estimated_cost_usd`
- `estimated_cost_available`
- `estimated_cost_reason`

Stored in `job_runs.operator_summary`:

- run status
- generated/stored/assigned totals
- failed languages/topics
- cost estimate availability
- idempotency notes
- content item deduplication reuse count
- rerun recommendation and recovery hints
- mini-case generated topics, assignment fallback reasons, and selected-topic counts

## Mini-Case Editorial Rotation

Mini-cases use `public.mini_case_history` as persistent editorial memory. The table is service-role only and stores the generated case title/slug, product topic, scenario type, decision type, concept tested, mechanism, question pattern, answer pattern, takeaway, language, and published date.

Production generation must avoid:

- same `scenario_type` within 10 days
- same `concept_tested` within 7 days
- same `decision_type` within 5 days
- same `question_pattern` within 14 days
- same title/slug ever

Mini-case product topics are exactly:

- `finance_economy`
- `stock_market`
- `ai`
- `law_compliance`
- `health_pharma`
- `engineering_operations`

Assignment uses `user_mini_case_topic_preferences` only. Newsletter topics must not influence mini-case selection. For users with multiple mini-case topics, assignment rotates deterministically from `user_id + drop_date`, then falls back only within the user's enabled mini-case topics. If no valid case exists for those topics, the mini-case slot is skipped and logged.

Operator output to inspect:

- `operatorSummary.miniCase.generatedTopics`
- `operatorSummary.miniCase.fallbackReasons`
- `operatorSummary.miniCase.selectedTopicCounts`
- `latestRun.operator_summary.mini_case` from `content:job-health`

## Daily Operator Check

1. Confirm the scheduler ran for today's date.
2. Check the latest job health:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run content:job-health -- --date "$(date +%F)" --limit 5 --stale-minutes 90
```

3. Treat `status: "ok"` as healthy.
4. Treat `status: "warning"` as requiring review before the next run.
5. Treat `status: "critical"` as a page/manual intervention.
6. If `latestRun.status` is `partial_failed`, read `latestRun.operator_summary.failed_languages` and follow the language failure playbook below.

For unattended automation, add `--strict` so warning states also exit nonzero:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run content:job-health -- --date "$(date +%F)" --limit 5 --strict
```

Use non-strict health for manual review dashboards; use strict health for cron/launchd alerting.

`job-health` marks a `job_runs.status = 'running'` row as critical when its `updated_at` age is older than `--stale-minutes`. A non-stale running row is only a warning because a production job may legitimately still be active.

## Mac Mini Daily Automation

The Mac Mini should run from one server-side shell profile or launchd plist that exports secrets outside the repo. Do not store secrets in checked-in files, Expo env, Vite env, screenshots, or command transcripts.

Minimum reliable loop:

1. `cd /Users/<operator>/personewsap`
2. Pull or deploy the already-reviewed release.
3. Run a no-write production proof:

```sh
OPENAI_API_KEY="<openai-key>" \
LANGUAGES=fr,en \
npm run content:prod-dry-run -- --topics business,finance,tech_ai,law,medicine,engineering,sport_business,culture_media
```

4. Run one production write:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
OPENAI_API_KEY="<openai-key>" \
LANGUAGES=fr,en \
RUN_ID="daily-job-$(date +%F)" \
npm run content:prod-run
```

5. Immediately run strict health:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run content:job-health -- --date "$(date +%F)" --limit 5 --strict
```

Automation assumptions:

- Run at most once per calendar date unless the operator chooses a language-specific rerun id.
- Keep stdout/stderr logs for at least 14 days; redact logs before sharing.
- Alert on any nonzero exit code from `content:prod-run` or strict `content:job-health`.
- Alert if no `job_runs` row exists for the current date by the expected local time.
- Prefer `STRICT_ALL_LANGUAGES=true` only when a partial FR/EN daily drop is worse than holding the day.
- Keep `USER_LIMIT` unset in real production; use it only for staged rollouts.

## Example Health Output

```json
{
  "mode": "job-health",
  "status": "warning",
  "runDate": "2026-04-29",
  "latestRun": {
    "run_id": "daily-job-a1b2c3d4e5f6",
    "status": "completed",
    "generator": "llm",
    "source_mode": "rss",
    "metrics": {
      "rss_attempted": 48,
      "rss_succeeded": 45,
      "rss_failed": 3,
      "stale_fallback_used": true,
      "llm_timeout_count": 0,
      "validation_failure_count": 0,
      "stored_items": 8,
      "content_items_deduplicated": 2,
      "assigned_users": 123,
      "estimated_cost_usd": 0.0142
    }
  }
}
```

## Warning Review

Check these first:

- RSS warnings: inspect `rss_source_failed`, `rss_connector_health`, and `job_runs.metrics.rss_failed`.
- Stale fallback: inspect `job_runs.metrics.stale_fallback_used_by_topic`; FR sources may need more current coverage.
- LLM timeouts: inspect `job_runs.metrics.llm_timeout_count`, `OPENAI_REQUEST_TIMEOUT_MS`, and model/provider status.
- Validation failures: inspect `job_runs.metrics.validation_failures_by_rule` and the failed language entry in command output.
- Assignment warnings: inspect `assigned_users`, skipped users, and whether users have completed onboarding preferences.
- Deduplication warnings: inspect `job_runs.metrics.content_items_deduplicated`. Reused content is expected when rerunning the same stable `RUN_ID`; unexpected growth means the dedup metadata/index is missing.

## Stale Job Recovery

A stale job is a `job_runs` row stuck in `running` after the operator is confident no process is still active.

1. Check health and note stale run ids:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run content:job-health -- --date "$(date +%F)" --limit 10 --stale-minutes 90
```

2. Confirm no local scheduler or shell process is still running the same `RUN_ID`.
3. Review whether content was stored and whether users were assigned:

```sql
select run_id, status, metrics, operator_summary, started_at, updated_at
from public.job_runs
where run_id = '<stale-run-id>';
```

4. If the process is gone, mark only that job row as failed. Do not delete content or daily drops during recovery:

```sql
update public.job_runs
set
  status = 'failed',
  error = coalesce(error, 'Marked failed manually after stale running recovery.'),
  completed_at = now(),
  updated_at = now()
where run_id = '<stale-run-id>'
  and status = 'running';
```

5. Run `content:prod-dry-run` before any retry. If users already received content, rerun only the missing/failed language and keep the same date.

## Idempotency And Duplicate Guards

- `daily_drops` is unique by `(user_id, drop_date)` and production assignment upserts by that key.
- `daily_drop_items` is unique by `(daily_drop_id, slot, position)` and `(daily_drop_id, content_item_id)`.
- Assignment validates required slots before writing a user drop.
- Existing daily-drop links are upserted before non-conflicting stale links are removed, reducing the chance that an item-link failure empties an existing drop.
- New content-engine writes include `content_items.metadata.dedup_key`.
- The migration `20260522120000_content_item_dedup_key.sql` adds a partial unique index for active content rows that have a dedup key.
- Rerunning the same production command for the same date and stable `RUN_ID` should reuse existing content items and update daily-drop links rather than growing unbounded duplicates.

## FR/EN Failure Playbook

If FR fails and EN succeeds, or EN fails and FR succeeds:

1. Do not rerun both languages immediately.
2. Check `content:health` for `operator_summary.failed_languages`, `operator_summary.failed_topics`, `metrics.rss_failed`, and `metrics.validation_failures_by_rule`.
3. If RSS coverage failed for one language, run a no-write proof for that language and fewer topics:

```sh
OPENAI_API_KEY="..." \
LANGUAGES=fr \
npm run content:prod-dry-run -- --topics business,finance --newsletter-count 1
```

4. If the proof passes and the successful language already assigned users, rerun only the failed language with a new run id:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
OPENAI_API_KEY="<openai-key>" \
RUN_ID="daily-job-$(date +%F)-fr-rerun-1" \
LANGUAGES=fr \
npm run content:prod-run -- --topics business,finance,tech_ai,law,medicine,engineering,sport_business,culture_media
```

5. If the failure is validation quality, do not publish a workaround. Fix prompts/validation or hold that language's daily drop.
6. If `STRICT_ALL_LANGUAGES=true` is set, any language failure exits as `failed`; use it when operations prefer no partial daily drop.

`partial_failed` is a warning state. It means at least one language completed and at least one language failed. The command may still exit successfully, so monitoring must check `job_runs.status` or `content:health`, not only process exit code.

## Production Run Command

Production writes require explicit flags and server-side secrets:

```sh
PRODUCTION_DAILY_JOB=true \
DRY_RUN=false \
LIVE_RSS=true \
LIVE_RSS_ONLY=true \
USE_LLM=true \
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
OPENAI_API_KEY="<openai-key>" \
LANGUAGES=fr,en \
CONTENT_STATUS=published \
npm run content:daily-job
```

Optional cost estimate config:

```sh
OPENAI_INPUT_COST_PER_1M_TOKENS=0.40
OPENAI_OUTPUT_COST_PER_1M_TOKENS=1.60
```

The token counts are character-based estimates, not provider billing truth. If the provider later exposes token usage, replace the estimate with actual usage.

## Verify Job Runs

Preferred command:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run content:health -- --date "$(date +%F)" --limit 5
```

Read the compact fields first:

- `latestRun.run_id`
- `latestRun.status`
- `latestRun.operator_summary.generated`
- `latestRun.operator_summary.stored`
- `latestRun.operator_summary.assigned`
- `latestRun.operator_summary.failed_languages`
- `latestRun.operator_summary.failed_topics`
- `latestRun.metrics.validation_failures_by_rule`
- `latestRun.metrics.estimated_cost_reason`

If SQL access is needed, use a read-only select:

```sql
select
  run_id,
  status,
  run_date,
  languages,
  topics,
  operator_summary,
  metrics,
  completed_at
from public.job_runs
where run_date = current_date
order by created_at desc
limit 5;
```

## Verify Assigned Daily Drops

Use a read-only count after a production run:

```sql
select
  language,
  status,
  count(*) as drops
from public.daily_drops
where drop_date = current_date
group by language, status
order by language, status;
```

Then verify every assigned drop has the required slots:

```sql
select
  d.language,
  d.status,
  count(distinct d.id) as drops,
  count(i.*) filter (where i.slot = 'newsletter') as newsletter_links,
  count(i.*) filter (where i.slot = 'business_story') as business_story_links,
  count(i.*) filter (where i.slot = 'mini_case') as mini_case_links,
  count(i.*) filter (where i.slot = 'concept') as concept_links
from public.daily_drops d
left join public.daily_drop_items i on i.daily_drop_id = d.id
where d.drop_date = current_date
group by d.language, d.status
order by d.language, d.status;
```

## Rollback Plan

If a production run is bad:

1. Pause the scheduler or remove the cron trigger.
2. Save the bad `run_id` from `content:health`.
3. Do not delete rows first. Deletion makes diagnosis harder.
4. Mark affected `daily_drops` as `archived` for the run date/language, or restore the previous known-good drop if one exists.
5. Mark affected `content_items` as `archived` only after confirming they came from the bad `scheduler_run_id`.
6. Re-run `content:health` and the assigned-drop SQL checks.
7. Re-enable the scheduler only after a no-write `content:prod-dry-run` passes.

Example archive shape, to adapt manually in Supabase SQL editor:

```sql
-- Review ids first.
select id, user_id, language, status
from public.daily_drops
where drop_date = current_date and language = 'fr';

-- Only after review.
update public.daily_drops
set status = 'archived'
where drop_date = current_date and language = 'fr';
```

## Stop Conditions

Stop the release run and investigate when:

- `job-health` is `critical`
- all RSS feeds fail
- generated/stored item count is zero
- assigned user count is unexpectedly zero
- validation failures appear in production
- LLM timeout count is nonzero for multiple runs
- cost estimate jumps unexpectedly
