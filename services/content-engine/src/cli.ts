#!/usr/bin/env node
import { parseAppPreviewTestOptions, runAppPreviewTest } from "./cli/appPreviewTest.js";
import { parseAssignTestUsersOptions, runAssignTestUsers } from "./cli/assignTestUsers.js";
import { parseBusinessStoryMemoryOptions, runBusinessStoryMemory } from "./cli/businessStoryMemory.js";
import { parseCleanupTestOptions, runCleanupTest } from "./cli/cleanupTest.js";
import { parseDailyJobOptions, runDailyJob } from "./cli/dailyJob.js";
import { parseDailyJobTestOptions, runDailyJobTest } from "./cli/dailyJobTest.js";
import { parseDebugUsersOptions, runDebugUsers } from "./cli/debugUsers.js";
import { parseDryRunOptions, runDryRun } from "./cli/dryRun.js";
import { parseJobHealthOptions, runJobHealth } from "./cli/jobHealth.js";
import { parseLlmRunOptions, runLlmRun } from "./cli/llmRun.js";
import { parseLlmProofOptions, runLlmProof } from "./cli/llmProof.js";
import { parsePersonalizeTestOptions, runPersonalizeTest } from "./cli/personalizeTest.js";
import { parsePersistTestOptions, runPersistTest } from "./cli/persistTest.js";
import { runQualityProof } from "./cli/qualityProof.js";
import { parseRssCheckOptions, runRssCheck } from "./cli/rssCheck.js";
import { formatPersistenceError } from "./storage/persistenceError.js";
import { redactLogIdentifiers } from "./utils/redactIdentifier.js";

async function main(): Promise<void> {
  const [command = "dry-run", ...args] = process.argv.slice(2);

  if (command === "dry-run") {
    const output = await runDryRun(parseDryRunOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "llm-run") {
    const output = await runLlmRun(parseLlmRunOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "llm-proof") {
    const output = await runLlmProof(parseLlmProofOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "persist-test") {
    const output = await runPersistTest(parsePersistTestOptions(args));
    writeJson(output, { redactIdentifiers: true });
    return;
  }

  if (command === "cleanup-test") {
    const output = await runCleanupTest(parseCleanupTestOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "assign-test-users") {
    const output = await runAssignTestUsers(parseAssignTestUsersOptions(args));
    writeJson(output, { redactIdentifiers: true });
    return;
  }

  if (command === "personalize-test") {
    const output = await runPersonalizeTest(parsePersonalizeTestOptions(args));
    writeJson(output, { redactIdentifiers: true });
    return;
  }

  if (command === "daily-job") {
    const output = await runDailyJob(parseDailyJobOptions(args));
    writeJson(output, { redactIdentifiers: true });
    return;
  }

  if (command === "daily-job-test") {
    const output = await runDailyJobTest(parseDailyJobTestOptions(args));
    writeJson(output, { redactIdentifiers: true });
    return;
  }

  if (command === "app-preview-test") {
    // runAppPreviewTest already redacts user identifiers in its output while
    // keeping content_item ids clear, so write it without the blanket redactor.
    const output = await runAppPreviewTest(parseAppPreviewTestOptions(args));
    writeJson(output);
    return;
  }

  if (command === "job-health") {
    const output = await runJobHealth(parseJobHealthOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "business-story-memory") {
    const output = await runBusinessStoryMemory(parseBusinessStoryMemoryOptions(args));
    writeJson(output, { redactIdentifiers: true });
    return;
  }

  if (command === "debug-users") {
    const output = await runDebugUsers(parseDebugUsersOptions(args));
    writeJson(output, { redactIdentifiers: true });
    return;
  }

  if (command === "rss-check") {
    const output = await runRssCheck(parseRssCheckOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "quality-proof") {
    const output = runQualityProof();
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp(): void {
  process.stdout.write(`PersoNewsAP content engine

Commands:
  dry-run                 Run local sample source -> processing -> generation pipeline.
  llm-run                 Run no-write OpenAI structured generation with explicit live/sample sources.
  llm-proof               Safe RSS-only, dry-run OpenAI proof with aggressive limits.
  persist-test            Persist one limited test drop after explicit env confirmation.
  cleanup-test            Delete draft persist-test content for one test_run_id.
  assign-test-users       Assign existing published test content to app users.
  daily-job               Production daily scheduler command. Writes require explicit production env confirmation.
  daily-job-test          Generate, publish, and assign a limited marked test daily drop.
  app-preview-test        Generate + persist + assign ONE test drop (USER_LIMIT=1) so engine output is visible in the app.
  job-health              Read production job_runs health summary with service-role credentials.
  business-story-memory   Read-only editorial memory report for Business Stories.
  debug-users             Read-only daily-job-test user eligibility diagnostic.
  personalize-test        Assign already-published content from app user preferences.
  rss-check               Fetch live RSS only, without LLM or Supabase persistence.
  quality-proof           Prove production-strict editorial validation rejects bad generated content.

Options:
  --date YYYY-MM-DD       Drop date. Defaults to today.
  --language en           Single language. Defaults to fr,en for daily jobs.
  --languages fr,en       Comma-separated languages.
  --topics a,b            Approved topic IDs. Defaults to core dry-run topics.
  --newsletter-count 4    Newsletter article count. Defaults to 4.
  --live-rss              Also try live RSS feeds. No API key required.
  --since YYYY-MM-DD      For rss-check, reject older dated feed items.
  --limit-per-source 5    For rss-check/RSS, cap items kept from each feed.
  --limit 5               For job-health, max recent job_runs rows to read.
  --limit 180             For business-story-memory, max memory rows to inspect.
  --strict                For job-health, make warning states fail automation.
  --stale-minutes 90      For job-health, mark running job_runs older than this critical.
  --source-article-limit 6 For llm-proof, cap ranked articles sent to the LLM.
  --max-attempts 1        For llm-proof, cap LLM validation retry attempts.
  --max-output-tokens 4500 For llm-proof, cap OpenAI response tokens.

Daily job env:
  DRY_RUN=true            Generate and validate without Supabase writes.
  PRODUCTION_DAILY_JOB=true Required for non-dry daily-job writes.
  DRY_RUN=false           Required explicitly for non-dry production writes.
  USER_LIMIT=5            Max app users assigned per language. Omit for all users in daily-job.
  LANGUAGES=fr,en         Languages for daily-job and daily-job-test.
  TOPIC_LIMIT=3           Limit approved topics after --topics/env defaults.
  RUN_ID=...              Optional stable operator run id. Defaults to a deterministic run id.
  STRICT_ALL_LANGUAGES=true Fail the full job if any requested language fails.
  USE_LLM=true            Use OpenAI generation for daily-job and daily-job-test.
  OPENAI_REQUEST_TIMEOUT_MS=120000 Override OpenAI request timeout.
  OPENAI_FALLBACK_MODEL=... Try fallback model after primary request failures.
  LIVE_RSS=true           Enable live RSS sources.
  LIVE_RSS_ONLY=true      Enable live RSS and disable sample_articles.
  ALLOW_SAMPLE_CONTENT=true Allow sample_articles only in dry-run/test-shaped commands.
  CONTENT_STATUS=published Store draft, review, or published test content.

Examples:
  npm run dry-run
  npm run dry-run -- --languages en,fr --newsletter-count 3
  OPENAI_API_KEY=... LIVE_RSS=true npm run llm-run -- --language en
  OPENAI_API_KEY=... ALLOW_SAMPLE_CONTENT=true npm run llm-run -- --language en
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_PERSIST_TEST=true npm run persist-test
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_PERSIST_TEST=true TEST_USER_ID=... npm run persist-test
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_CLEANUP_TEST=true npm run cleanup-test -- --test-run-id persist-test-abc123
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_ASSIGN_TEST=true npm run assign-test-users -- --limit 5
  DRY_RUN=true LANGUAGES=fr,en npm run daily-job
  DRY_RUN=true LIVE_RSS_ONLY=true RSS_ARTICLES_PER_SOURCE=1 npm run daily-job
  PRODUCTION_DAILY_JOB=true DRY_RUN=false LIVE_RSS=true LIVE_RSS_ONLY=true USE_LLM=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... npm run daily-job
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_DAILY_JOB_TEST=true npm run daily-job-test
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_DAILY_JOB_TEST=true LANGUAGES=fr,en USER_LIMIT=5 CONTENT_STATUS=published npm run daily-job-test
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_APP_PREVIEW_TEST=true USER_LIMIT=1 npm run app-preview-test -- --language en
  OPENAI_API_KEY=... USE_LLM=true LIVE_RSS_ONLY=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_APP_PREVIEW_TEST=true npm run app-preview-test -- --language en
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run job-health -- --date 2026-04-26 --strict
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run debug-users -- --language en --date 2026-04-26
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_PERSONALIZE_TEST=true npm run personalize-test
  npm run rss-check -- --languages en --topics business,finance --limit-per-source 3
  npm run quality-proof
  OPENAI_API_KEY=... npm run llm-proof -- --languages en --topics business,finance
  OPENAI_API_KEY=... OPENAI_REQUEST_TIMEOUT_MS=120000 npm run llm-proof -- --languages fr,en --topics business,finance,tech_ai,law,medicine,engineering,sport_business,culture_media --max-attempts 2
`);
}

function writeJson(output: unknown, options: { redactIdentifiers?: boolean } = {}): void {
  const safeOutput = options.redactIdentifiers ? redactLogIdentifiers(output) : output;
  process.stdout.write(`${JSON.stringify(safeOutput, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${formatPersistenceError(error)}\n`);
  process.exitCode = 1;
});
