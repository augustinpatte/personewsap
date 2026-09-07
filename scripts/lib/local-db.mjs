/**
 * Run SQL against the LOCAL Supabase stack. Never against a remote project.
 *
 * There is no psql on the host and no node-postgres in this repo, so the client
 * used is the one that is guaranteed to exist whenever the stack is up: the
 * psql inside the database container the Supabase CLI already started.
 *
 * Everything here is addressed by container name, derived from
 * supabase/config.toml's project_id. No connection string, no host, no port —
 * so there is no shape of environment variable that could point this file at
 * production, whatever SUPABASE_ACCESS_TOKEN or SUPABASE_DB_URL happen to hold.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

/** Field separator for -A output. 0x1f is the ASCII unit separator: it cannot
 *  occur in a SQL identifier or in a jsonb rendering, unlike `|` or `,`. */
export const FIELD_SEPARATOR = "";

async function projectId(configPath) {
  const config = await readFile(configPath, "utf8");
  const match = config.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`${configPath} has no project_id`);
  return match[1];
}

export async function dbContainer(configPath = "supabase/config.toml") {
  return `supabase_db_${await projectId(configPath)}`;
}

function run(command, args, stdin) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

export async function containerIsUp(container) {
  const { stdout } = await run("docker", ["ps", "--format", "{{.Names}}"]);
  return stdout.split("\n").map((line) => line.trim()).includes(container);
}

/**
 * Execute `sql` and return { ok, rows, stdout, stderr }.
 *
 * ON_ERROR_STOP is always on: a suite that half-runs and still prints
 * "0 failures" is worse than one that stops, because it looks like a pass.
 */
export async function runSql(
  sql,
  { container, database = "postgres", user = "postgres", variables = {} } = {},
) {
  const target = container ?? (await dbContainer());

  if (!(await containerIsUp(target))) {
    return {
      ok: false,
      rows: [],
      stdout: "",
      stderr:
        `The local database container ${target} is not running.\n` +
        `Start the stack first:\n    supabase start\n`,
    };
  }

  const { code, stdout, stderr } = await run(
    "docker",
    [
      "exec", "-i", target,
      "psql",
      "-v", "ON_ERROR_STOP=1",
      // psql variables, so a value the caller computed reaches SQL as a value
      // (:'name') rather than through string concatenation into the script.
      ...Object.entries(variables).flatMap(([key, value]) => ["-v", `${key}=${value}`]),
      "-q", "-t", "-A", "-X",
      "--field-separator", FIELD_SEPARATOR,
      "-U", user,
      "-d", database,
      "-f", "-",
    ],
    sql,
  );

  const rows = stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.split(FIELD_SEPARATOR));

  return { ok: code === 0, rows, stdout, stderr };
}

export async function runSqlFile(path, options) {
  return runSql(await readFile(path, "utf8"), options);
}

/** Several files as ONE psql session, which is what pg_temp fixtures require. */
export async function runSqlFiles(paths, options) {
  const bodies = [];
  for (const path of paths) bodies.push(await readFile(path, "utf8"));
  return runSql(bodies.join("\n"), options);
}

/**
 * The connection details of a local stack, read from the CLI rather than
 * assumed. Returns { API_URL, ANON_KEY, SERVICE_ROLE_KEY, ... }.
 */
export async function stackEnv(workdir) {
  const args = ["status", "-o", "env"];
  if (workdir) args.push("--workdir", workdir);

  const { code, stdout, stderr } = await run("supabase", args);

  if (code !== 0) {
    throw new Error(`supabase ${args.join(" ")} failed:\n${stderr}`);
  }

  return Object.fromEntries(
    stdout
      .split("\n")
      .map((line) => line.match(/^([A-Z0-9_]+)="(.*)"$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
}
