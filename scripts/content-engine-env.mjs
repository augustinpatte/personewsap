#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const envPath = path.join(rootDir, "services", "content-engine", ".env");
const envExamplePath = path.join(rootDir, "services", "content-engine", ".env.example");
const mode = process.argv[2] ?? "check";
const passthroughArgs = process.argv[3] === "--" ? process.argv.slice(4) : process.argv.slice(3);

const supportedModes = new Set(["check", "debug-users", "daily-job-test"]);

if (!supportedModes.has(mode)) {
  printUsage();
  process.exit(1);
}

const env = loadContentEngineEnv();

if (mode === "check") {
  printEnvReport(env, true);
  process.exit(hasMissingBaseEnv(env) ? 1 : 0);
}

const missing = requiredSettingsFor(mode).filter((setting) => !setting.ok(env));

if (missing.length > 0) {
  printEnvReport(env, false);
  process.stderr.write("\ncontent-engine local bootstrap refused to run\n");
  process.stderr.write("============================================\n");
  process.stderr.write(`Missing required setting(s): ${missing.map((setting) => setting.label).join(", ")}\n\n`);
  process.stderr.write(`1. Copy ${relative(envExamplePath)} to ${relative(envPath)} if needed.\n`);
  process.stderr.write("2. Fill SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from a local/disposable/staging project.\n");
  process.stderr.write("3. For daily-job-test only, set CONFIRM_DAILY_JOB_TEST=true intentionally.\n");
  process.stderr.write("4. Never place SUPABASE_SERVICE_ROLE_KEY in apps/mobile/.env or any client bundle.\n\n");
  process.stderr.write("Try:\n");
  process.stderr.write("  npm run content:env:check\n");
  process.stderr.write("  npm run content:debug-users:local -- --language en\n");
  process.stderr.write("  npm run content:daily-job-test:local -- --language en --limit 3\n");
  process.exit(1);
}

printEnvReport(env, false);
runContentEngineCommand(mode, passthroughArgs, env);

function loadContentEngineEnv() {
  const env = { ...process.env };
  const loadedKeys = [];

  if (!existsSync(envPath)) {
    return {
      values: env,
      loadedKeys,
      envFileExists: false
    };
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseEnvLine(line);

    if (!parsed) {
      continue;
    }

    const [key, value] = parsed;

    if (!env[key]) {
      env[key] = value;
      loadedKeys.push(key);
    }
  }

  return {
    values: env,
    loadedKeys,
    envFileExists: true
  };
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
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

function requiredSettingsFor(selectedMode) {
  const base = [
    {
      label: "SUPABASE_URL",
      ok: (envState) => Boolean(envState.values.SUPABASE_URL?.trim())
    },
    {
      label: "SUPABASE_SERVICE_ROLE_KEY",
      ok: (envState) => Boolean(envState.values.SUPABASE_SERVICE_ROLE_KEY?.trim())
    }
  ];

  if (selectedMode === "daily-job-test") {
    return [
      ...base,
      {
        label: "CONFIRM_DAILY_JOB_TEST=true",
        ok: (envState) => envState.values.CONFIRM_DAILY_JOB_TEST === "true"
      }
    ];
  }

  return base;
}

function hasMissingBaseEnv(envState) {
  return requiredSettingsFor("debug-users").some((setting) => !setting.ok(envState));
}

function printEnvReport(envState, verbose) {
  const status = (value) => (value ? "set" : "missing");
  const serviceRoleStatus = envState.values.SUPABASE_SERVICE_ROLE_KEY ? "set (redacted)" : "missing";
  const confirmStatus = envState.values.CONFIRM_DAILY_JOB_TEST === "true" ? "true" : "not true";

  process.stdout.write("\ncontent-engine env bootstrap\n");
  process.stdout.write("============================\n");
  process.stdout.write(`env file: ${envState.envFileExists ? relative(envPath) : `${relative(envPath)} missing`}\n`);
  process.stdout.write(`SUPABASE_URL: ${status(envState.values.SUPABASE_URL)}\n`);
  process.stdout.write(`SUPABASE_SERVICE_ROLE_KEY: ${serviceRoleStatus}\n`);
  process.stdout.write(`CONFIRM_DAILY_JOB_TEST: ${confirmStatus}\n`);

  if (verbose && envState.loadedKeys.length > 0) {
    process.stdout.write(`loaded from .env: ${envState.loadedKeys.sort().join(", ")}\n`);
  }

  process.stdout.write("\n");
}

function runContentEngineCommand(scriptName, args, envState) {
  const child = spawn(
    "npm",
    ["--prefix", "services/content-engine", "run", scriptName, "--", ...args],
    {
      cwd: rootDir,
      env: envState.values,
      stdio: "inherit"
    }
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

function relative(value) {
  return path.relative(rootDir, value);
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/content-engine-env.mjs check
  node scripts/content-engine-env.mjs debug-users -- --language en
  node scripts/content-engine-env.mjs daily-job-test -- --language en --limit 3
`);
}
