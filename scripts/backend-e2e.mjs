#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_CLI = path.join(ROOT, "services/content-engine/dist/cli.js");
const DEFAULT_LANGUAGES = "en";
const DEFAULT_USER_LIMIT = "3";
const DEFAULT_NEWSLETTER_COUNT = "4";

const args = new Set(process.argv.slice(2));
const liveRss = args.has("--live-rss") || process.env.LIVE_RSS === "true";
const useLlm = args.has("--llm") || process.env.USE_LLM === "true";
const languages = process.env.LANGUAGES || process.env.LANGUAGE || DEFAULT_LANGUAGES;
const userLimit = process.env.USER_LIMIT || DEFAULT_USER_LIMIT;
const newsletterCount = process.env.NEWSLETTER_COUNT || DEFAULT_NEWSLETTER_COUNT;
const dropDate = process.env.DROP_DATE || todayDate();

const childEnv = {
  ...process.env,
  LANGUAGES: languages,
  USER_LIMIT: userLimit,
  NEWSLETTER_COUNT: newsletterCount,
  LIVE_RSS: liveRss ? "true" : "false",
  USE_LLM: useLlm ? "true" : "false"
};

const checks = [];

main().catch((error) => {
  fail("backend:e2e failed", error instanceof Error ? error.message : String(error));
  printSummary();
  process.exitCode = 1;
});

async function main() {
  printHeader();
  assertEnvironment();
  pass("required env present", "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONFIRM_DAILY_JOB_TEST=true");

  await runStep("mobile typecheck", "npm", ["run", "mobile:typecheck"]);
  await runStep("content-engine build", "npm", ["--prefix", "services/content-engine", "run", "build"]);

  const dryRun = await runJsonStep("content dry-run", "node", [
    CONTENT_CLI,
    "dry-run",
    "--languages",
    languages,
    "--newsletter-count",
    newsletterCount,
    ...(liveRss ? ["--live-rss"] : [])
  ]);
  assertDryRun(dryRun);

  const debugBefore = await runJsonStep("debug-users", "node", [
    CONTENT_CLI,
    "debug-users",
    "--languages",
    languages,
    "--date",
    dropDate,
    "--limit",
    userLimit
  ]);
  assertDebugUsers(debugBefore);

  const firstDailyJob = await runJsonStep("daily-job-test first run", "node", [
    CONTENT_CLI,
    "daily-job-test",
    "--languages",
    languages,
    "--date",
    dropDate,
    "--newsletter-count",
    newsletterCount,
    ...(liveRss ? ["--live-rss"] : [])
  ]);
  assertDailyJob(firstDailyJob, "first run", debugBefore);

  const secondDailyJob = await runJsonStep("daily-job-test second run", "node", [
    CONTENT_CLI,
    "daily-job-test",
    "--languages",
    languages,
    "--date",
    dropDate,
    "--newsletter-count",
    newsletterCount,
    ...(liveRss ? ["--live-rss"] : [])
  ]);
  assertDailyJob(secondDailyJob, "second run", debugBefore);
  assertIdempotentUpdate(secondDailyJob, debugBefore);

  printSummary();
  process.stdout.write("\nBackend E2E proof passed.\n");
}

function printHeader() {
  process.stdout.write(`Backend E2E proof\n`);
  process.stdout.write(`Date: ${dropDate}\n`);
  process.stdout.write(`Languages: ${languages}\n`);
  process.stdout.write(`User limit: ${userLimit}\n`);
  process.stdout.write(`Live RSS: ${liveRss ? "true" : "false"}\n`);
  process.stdout.write(`LLM: ${useLlm ? "true" : "false"}\n\n`);
  process.stdout.write(`Pass/fail criteria:\n`);
  process.stdout.write(`- required server env is present and explicit confirmation is true\n`);
  process.stdout.write(`- mobile typecheck passes\n`);
  process.stdout.write(`- content-engine builds\n`);
  process.stdout.write(`- dry-run produces at least one generated item and no language mismatch\n`);
  process.stdout.write(`- debug-users can read eligible app-user state\n`);
  process.stdout.write(`- daily-job-test generates and stores content\n`);
  process.stdout.write(`- if eligible users exist, at least one user is assigned\n`);
  process.stdout.write(`- second daily-job-test run updates an existing daily drop when eligible users exist\n\n`);
}

function assertEnvironment() {
  const missing = [
    process.env.SUPABASE_URL ? null : "SUPABASE_URL",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? null : "SUPABASE_SERVICE_ROLE_KEY",
    process.env.CONFIRM_DAILY_JOB_TEST === "true" ? null : "CONFIRM_DAILY_JOB_TEST=true",
    useLlm && !process.env.OPENAI_API_KEY ? "OPENAI_API_KEY when USE_LLM=true or --llm" : null
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      [
        `Missing required backend E2E setting(s): ${missing.join(", ")}.`,
        "This proof writes marked test content and assigns limited app-user daily drops.",
        "Use a local, staging, or disposable Supabase project; do not put service-role keys in mobile env files."
      ].join(" ")
    );
  }
}

async function runStep(label, command, args) {
  process.stdout.write(`\n== ${label} ==\n`);
  const result = await run(command, args);
  if (result.code !== 0) {
    fail(label, `exit ${result.code}`);
    throw new Error(`${label} failed with exit ${result.code}`);
  }
  pass(label, "command exited 0");
  return result;
}

async function runJsonStep(label, command, args) {
  const result = await runStep(label, command, args);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`${label} JSON`, "stdout was not valid JSON");
    throw error;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const value = chunk.toString();
      stdout += value;
      process.stdout.write(value);
    });

    child.stderr.on("data", (chunk) => {
      const value = chunk.toString();
      stderr += value;
      process.stderr.write(value);
    });

    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function assertDryRun(output) {
  assert(output?.mode === "dry-run", "dry-run mode", `expected dry-run, got ${output?.mode}`);
  const generatedItems = sum(output.diagnostics ?? [], "generated_items");
  assert(generatedItems > 0, "content generated in dry-run", `generated_items=${generatedItems}`);
  assertLanguagesMatch(
    (output.drops ?? []).map((drop) => drop.language),
    requestedLanguages(),
    "dry-run language match"
  );
}

function assertDebugUsers(output) {
  assert(output?.mode === "debug-users", "debug-users mode", `expected debug-users, got ${output?.mode}`);
  assert(output?.readOnly === true, "debug-users read-only", "readOnly=true");
  assertLanguagesMatch(
    extractLanguageResults(output.languages ?? []),
    requestedLanguages(),
    "debug-users language match"
  );
  pass(
    "eligible user scan",
    `considered_after_limit=${output.summary?.totalDailyJobConsideredAfterLimit ?? 0}, eligible_new=${output.summary?.totalEligibleNewAssignments ?? 0}, would_update=${output.summary?.totalWouldUpdateExistingDrop ?? 0}`
  );
}

function assertDailyJob(output, label, debugBefore) {
  assert(output?.mode === "daily-job-test", `${label} mode`, `expected daily-job-test, got ${output?.mode}`);
  assert(output?.status === "completed", `${label} completed`, `status=${output?.status}`);
  assert(output?.summary?.totalGeneratedItems > 0, `${label} content generated`, `generated=${output?.summary?.totalGeneratedItems}`);
  assert(output?.summary?.totalStoredItems > 0, `${label} content stored`, `stored=${output?.summary?.totalStoredItems}`);
  assertLanguagesMatch(
    extractLanguageResults(output.languages ?? []),
    requestedLanguages(),
    `${label} language match`
  );

  if (hasEligibleUsers(debugBefore)) {
    assert(output.summary.totalUsersAssigned > 0, `${label} eligible user assigned`, `assigned=${output.summary.totalUsersAssigned}`);
  } else {
    pass(`${label} eligible user assigned`, "skipped: no eligible app users found by debug-users");
  }
}

function assertIdempotentUpdate(secondDailyJob, debugBefore) {
  if (!hasEligibleUsers(debugBefore)) {
    pass("idempotent second run", "skipped: no eligible app users found by debug-users");
    return;
  }

  assert(
    secondDailyJob.summary.totalUsersUpdatedExistingDrop > 0,
    "idempotent second run",
    `updated_existing_drop=${secondDailyJob.summary.totalUsersUpdatedExistingDrop}`
  );
}

function assertLanguagesMatch(actualLanguages, expectedLanguages, label) {
  const actual = [...new Set(actualLanguages)].sort();
  const expected = [...expectedLanguages].sort();
  assert(
    actual.length === expected.length && actual.every((language, index) => language === expected[index]),
    label,
    `expected=${expected.join(",")} actual=${actual.join(",") || "none"}`
  );
}

function extractLanguageResults(results) {
  return results.map((result) => result?.language ?? result?.target?.language).filter((language) => typeof language === "string" && language.length > 0);
}

function hasEligibleUsers(debugOutput) {
  return (debugOutput.summary?.totalDailyJobConsideredAfterLimit ?? 0) > 0;
}

function requestedLanguages() {
  return [...new Set(languages.split(",").map((language) => language.trim()).filter(Boolean))];
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

function assert(condition, label, details) {
  if (!condition) {
    fail(label, details);
    throw new Error(`${label} failed: ${details}`);
  }

  pass(label, details);
}

function pass(label, details) {
  checks.push({ label, details, status: "PASS" });
  process.stdout.write(`PASS ${label}: ${details}\n`);
}

function fail(label, details) {
  checks.push({ label, details, status: "FAIL" });
  process.stderr.write(`FAIL ${label}: ${details}\n`);
}

function printSummary() {
  process.stdout.write(`\nBackend E2E summary:\n`);
  for (const check of checks) {
    process.stdout.write(`- ${check.status} ${check.label}: ${check.details}\n`);
  }
}

function todayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
