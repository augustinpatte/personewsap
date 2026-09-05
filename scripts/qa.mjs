#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "local";
const steps = [];
const qaEnv = loadQaEnv();

const modes = {
  local: runLocalQa,
  "backend-live": runBackendLiveQa,
  "content-prod": runContentProdQa
};

if (!modes[mode]) {
  process.stderr.write(`Unknown QA mode: ${mode}\n`);
  process.stderr.write("Usage: node scripts/qa.mjs local|backend-live|content-prod\n");
  process.exit(1);
}

printHeader();

try {
  await modes[mode]();
} catch (error) {
  if (!steps.some((step) => step.status === "FAIL")) {
    record("FAIL", "qa runner", error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
} finally {
  printSummary();
}

async function runLocalQa() {
  await runRequired("mobile typecheck", "npm", ["run", "mobile:typecheck"]);
  await runRequired("content build", "npm", ["run", "content:build"]);
  await runRequired("lint", "npm", ["run", "lint"]);
  await runRequired("smoke", "npm", ["run", "smoke"]);
  await runRequired("quality proof", "npm", ["run", "content:quality-proof"]);
  await runRequired("production scale diagnostics", "npm", ["run", "qa:scale"]);
  await runRequired("static supabase doctor", "npm", ["run", "supabase:doctor"]);

  // The check that would have caught the language bug. A reviewed migration
  // that is never pushed leaves production running the old function while
  // every local test passes, which is exactly how `update_profile_language`
  // stayed broken for readers. It needs a token, so it can only be advisory
  // here — but it is no longer invisible.
  if (hasEnv(["SUPABASE_ACCESS_TOKEN"])) {
    // Advisory, not required: the same check also reports staging's 30
    // pre-existing orphaned migrations, so failing the run on it would leave
    // local QA permanently red and therefore ignored. It prints what is
    // pending; acting on it is a deliberate decision, never an automatic one.
    await runAdvisory("remote migration drift", "npm", ["run", "supabase:migration-check"]);
    return;
  }

  record(
    "SKIP",
    "remote migration drift",
    "SUPABASE_ACCESS_TOKEN is not set; skipped the check for local migrations that were never pushed."
  );
}

async function runBackendLiveQa() {
  requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], {
    reason: "backend live QA needs read-only live checks plus content-engine service-role diagnostics."
  });

  await runRequired("live supabase doctor", "npm", ["run", "supabase:doctor", "--", "--live"]);
  await runRequired("content job health", "npm", ["run", "content:job-health"]);

  if (qaEnv.CONFIRM_DAILY_JOB_TEST === "true") {
    await runRequired("backend e2e", "npm", ["run", "backend:e2e"]);
    return;
  }

  record(
    "SKIP",
    "backend e2e",
    "CONFIRM_DAILY_JOB_TEST is not true; skipped the write-capable daily-job-test proof."
  );
}

async function runContentProdQa() {
  await runRequired("content build", "npm", ["run", "content:build"]);
  await runRequired("content production dry-run", "npm", ["run", "content:prod-dry-run"]);
  await runRequired("quality proof", "npm", ["run", "content:quality-proof"]);

  if (hasEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])) {
    await runRequired("content job health", "npm", ["run", "content:job-health"]);
    return;
  }

  record(
    "SKIP",
    "content job health",
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set; skipped read-only production job health."
  );
}

async function runRequired(label, command, args) {
  const prettyCommand = [command, ...args].join(" ");
  process.stdout.write(`\n== ${label} ==\n`);
  process.stdout.write(`$ ${prettyCommand}\n`);

  const code = await run(command, args);

  if (code !== 0) {
    record("FAIL", label, `${prettyCommand} exited ${code}`);
    throw new Error(`${label} failed`);
  }

  record("PASS", label, prettyCommand);
}

/**
 * Runs a check whose failure is information rather than a verdict.
 *
 * Reserved for checks about REMOTE state, which a local run can observe but
 * cannot fix. They must be visible — the language bug survived because nobody
 * looked at exactly this — without making an unrelated remote condition able
 * to fail someone's local QA.
 */
async function runAdvisory(label, command, args) {
  const prettyCommand = [command, ...args].join(" ");
  process.stdout.write(`\n== ${label} (advisory) ==\n`);
  process.stdout.write(`$ ${prettyCommand}\n`);

  const code = await run(command, args);

  if (code !== 0) {
    record("WARN", label, `${prettyCommand} exited ${code} — read the output above`);
    return;
  }

  record("PASS", label, prettyCommand);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: qaEnv,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function requireEnv(names, { reason }) {
  const missing = names.filter((name) => !qaEnv[name]?.trim());

  if (missing.length === 0) {
    record("PASS", "required env", `${names.join(", ")} present`);
    return;
  }

  const message = [
    `Missing required setting(s): ${missing.join(", ")}.`,
    reason,
    "Set them in your shell or services/content-engine/.env.",
    "Never put service-role keys in apps/mobile/.env or client-side env files."
  ].join(" ");

  record("FAIL", "required env", message);
  throw new Error(message);
}

function hasEnv(names) {
  return names.every((name) => Boolean(qaEnv[name]?.trim()));
}

function loadQaEnv() {
  const env = { ...process.env };

  if (env.QA_IGNORE_ENV_FILES === "true") {
    return env;
  }

  for (const relativePath of [".env", "services/content-engine/.env"]) {
    const absolutePath = path.join(ROOT, relativePath);

    if (!existsSync(absolutePath)) {
      continue;
    }

    const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/);

    for (const line of lines) {
      const parsed = parseEnvLine(line);

      if (!parsed) {
        continue;
      }

      const [key, value] = parsed;

      if (!env[key]) {
        env[key] = value;
      }
    }
  }

  return env;
}

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const separatorIndex = assignment.indexOf("=");

  if (separatorIndex === -1) {
    return null;
  }

  const key = assignment.slice(0, separatorIndex).trim();
  let value = assignment.slice(separatorIndex + 1).trim();

  if (!key) {
    return null;
  }

  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

function record(status, label, detail) {
  steps.push({ status, label, detail });
}

function printHeader() {
  process.stdout.write(`PersoNewsAP QA: ${mode}\n`);
  process.stdout.write(`Working directory: ${ROOT}\n`);
  process.stdout.write(
    "Policy: required command failures stop the run; optional checks are marked SKIP, and advisory checks about remote state are marked WARN.\n"
  );
}

function printSummary() {
  const failed = steps.filter((step) => step.status === "FAIL").length;
  const skipped = steps.filter((step) => step.status === "SKIP").length;
  const warned = steps.filter((step) => step.status === "WARN").length;
  const passed = steps.filter((step) => step.status === "PASS").length;

  process.stdout.write("\nQA summary\n");
  process.stdout.write("==========\n");

  for (const step of steps) {
    process.stdout.write(`${step.status} ${step.label}: ${step.detail}\n`);
  }

  process.stdout.write(
    `\nTotals: ${passed} pass, ${skipped} skip, ${warned} warn, ${failed} fail\n`
  );
  process.stdout.write(failed > 0 ? "FAIL\n" : "PASS\n");
}
