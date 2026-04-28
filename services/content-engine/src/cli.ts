#!/usr/bin/env node
import { parseAssignTestUsersOptions, runAssignTestUsers } from "./cli/assignTestUsers.js";
import { parseCleanupTestOptions, runCleanupTest } from "./cli/cleanupTest.js";
import { parseDailyJobOptions, runDailyJob } from "./cli/dailyJob.js";
import { parseDailyJobTestOptions, runDailyJobTest } from "./cli/dailyJobTest.js";
import { parseDebugUsersOptions, runDebugUsers } from "./cli/debugUsers.js";
import { parseDryRunOptions, runDryRun } from "./cli/dryRun.js";
import { parseLlmRunOptions, runLlmRun } from "./cli/llmRun.js";
import { parsePersonalizeTestOptions, runPersonalizeTest } from "./cli/personalizeTest.js";
import { parsePersistTestOptions, runPersistTest } from "./cli/persistTest.js";
import { formatPersistenceError } from "./storage/persistenceError.js";

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

  if (command === "persist-test") {
    const output = await runPersistTest(parsePersistTestOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "cleanup-test") {
    const output = await runCleanupTest(parseCleanupTestOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "assign-test-users") {
    const output = await runAssignTestUsers(parseAssignTestUsersOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "personalize-test") {
    const output = await runPersonalizeTest(parsePersonalizeTestOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "daily-job") {
    const output = await runDailyJob(parseDailyJobOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "daily-job-test") {
    const output = await runDailyJobTest(parseDailyJobTestOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "debug-users") {
    const output = await runDebugUsers(parseDebugUsersOptions(args));
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
  llm-run                 Run the same pipeline with OpenAI structured LLM generation.
  persist-test            Persist one limited test drop after explicit env confirmation.
  cleanup-test            Delete draft persist-test content for one test_run_id.
  assign-test-users       Assign existing published test content to app users.
  daily-job               Production daily scheduler command. Supports DRY_RUN=true.
  daily-job-test          Generate, publish, and assign a limited marked test daily drop.
  debug-users             Read-only daily-job-test user eligibility diagnostic.
  personalize-test        Assign already-published content from app user preferences.

Options:
  --date YYYY-MM-DD       Drop date. Defaults to today.
  --language en           Single language. Defaults to fr,en for daily jobs.
  --languages fr,en       Comma-separated languages.
  --topics a,b            Approved topic IDs. Defaults to core dry-run topics.
  --newsletter-count 4    Newsletter article count. Defaults to 4.
  --live-rss              Also try live RSS feeds. No API key required.

Daily job env:
  DRY_RUN=true            Generate and validate without Supabase writes.
  USER_LIMIT=5            Max app users assigned per language. Omit for all users in daily-job.
  LANGUAGES=fr,en         Languages for daily-job and daily-job-test.
  TOPIC_LIMIT=3           Limit approved topics after --topics/env defaults.
  USE_LLM=true            Use OpenAI generation for daily-job-test.
  LIVE_RSS=true           Add live RSS to daily-job-test sources.
  CONTENT_STATUS=published Store draft, review, or published test content.

Examples:
  npm run dry-run
  npm run dry-run -- --languages en,fr --newsletter-count 3
  OPENAI_API_KEY=... npm run llm-run -- --language en
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_PERSIST_TEST=true npm run persist-test
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_PERSIST_TEST=true TEST_USER_ID=... npm run persist-test
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_CLEANUP_TEST=true npm run cleanup-test -- --test-run-id persist-test-abc123
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_ASSIGN_TEST=true npm run assign-test-users -- --limit 5
  DRY_RUN=true LANGUAGES=fr,en npm run daily-job
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... USE_LLM=true OPENAI_API_KEY=... LIVE_RSS=true npm run daily-job
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_DAILY_JOB_TEST=true npm run daily-job-test
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_DAILY_JOB_TEST=true LANGUAGES=fr,en USER_LIMIT=5 CONTENT_STATUS=published npm run daily-job-test
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run debug-users -- --language en --date 2026-04-26
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM_PERSONALIZE_TEST=true npm run personalize-test
`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${formatPersistenceError(error)}\n`);
  process.exitCode = 1;
});
