# Backend Operations

Daily operator guide for the PersoNewsAP content backend.

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

## Daily Operator Check

1. Confirm the scheduler ran for today's date.
2. Check the latest job health:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run content:job-health -- --date "$(date +%F)" --limit 5
```

3. Treat `status: "ok"` as healthy.
4. Treat `status: "warning"` as requiring review before the next run.
5. Treat `status: "critical"` as a page/manual intervention.

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

## Stop Conditions

Stop the release run and investigate when:

- `job-health` is `critical`
- all RSS feeds fail
- generated/stored item count is zero
- assigned user count is unexpectedly zero
- validation failures appear in production
- LLM timeout count is nonzero for multiple runs
- cost estimate jumps unexpectedly
