import { ContentRepository, type JobRunRow } from "../storage/contentRepository.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";
import { toDateOnly } from "../utils/date.js";

type JobHealthStatus = "ok" | "warning" | "critical";

export type JobHealthOptions = {
  runDate: string;
  limit: number;
};

export type JobHealthOutput = {
  mode: "job-health";
  checkedAt: string;
  status: JobHealthStatus;
  runDate: string;
  latestRun: JobHealthRunSummary | null;
  checks: Array<{
    name: string;
    status: JobHealthStatus;
    detail: string;
  }>;
  runs: JobHealthRunSummary[];
};

type JobHealthRunSummary = {
  run_id: string;
  job_type: string;
  run_date: string;
  status: string;
  dry_run: boolean;
  generator: string;
  source_mode: string;
  languages: string[];
  topics: string[];
  completed_at: string | null;
  metrics: {
    rss_attempted: number | null;
    rss_succeeded: number | null;
    rss_failed: number | null;
    stale_fallback_used: boolean | null;
    llm_timeout_count: number | null;
    validation_failures_by_rule: Record<string, number>;
    validation_failure_count: number;
    generated_items_by_language: Record<string, number>;
    stored_items: number | null;
    assigned_users: number | null;
    estimated_cost_usd: number | null;
    estimated_cost_available: boolean | null;
    estimated_cost_reason: string | null;
  };
  operator_summary: {
    generated: number | null;
    stored: number | null;
    assigned: number | null;
    failed_languages: string[];
    failed_topics: string[];
    cost_estimate_available: boolean | null;
    cost_estimate_usd: number | null;
    cost_estimate_reason: string | null;
  };
};

export async function runJobHealth(options: JobHealthOptions): Promise<JobHealthOutput> {
  const repository = new ContentRepository(
    createServiceRoleSupabaseClient({
      requireCredentials: true
    })
  );
  const rows = await repository.listJobRuns({
    runDate: options.runDate,
    limit: options.limit
  });
  const runs = rows.map(toRunSummary);
  const latestRun = runs[0] ?? null;
  const checks = buildChecks(latestRun);
  const status = worstStatus(checks.map((check) => check.status));

  if (status === "critical") {
    process.exitCode = 1;
  }

  return {
    mode: "job-health",
    checkedAt: new Date().toISOString(),
    status,
    runDate: options.runDate,
    latestRun,
    checks,
    runs
  };
}

export function parseJobHealthOptions(args: string[]): JobHealthOptions {
  const flags = readFlags(args);
  const limit = Number(flags.get("limit") ?? "5");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("--limit must be an integer from 1 to 50.");
  }

  return {
    runDate: flags.get("date") ?? toDateOnly(new Date()),
    limit
  };
}

function buildChecks(latestRun: JobHealthRunSummary | null): JobHealthOutput["checks"] {
  if (!latestRun) {
    return [
      {
        name: "latest_job_run",
        status: "critical",
        detail: "No job_runs row found for the requested date."
      }
    ];
  }

  const checks: JobHealthOutput["checks"] = [
    {
      name: "latest_job_run",
      status: latestRun.status === "completed" ? "ok" : latestRun.status === "partial_failed" || latestRun.status === "running" ? "warning" : "critical",
      detail:
        latestRun.operator_summary.failed_languages.length > 0
          ? `Latest run ${latestRun.run_id} finished with status ${latestRun.status}; failed languages=${latestRun.operator_summary.failed_languages.join(",")}.`
          : `Latest run ${latestRun.run_id} finished with status ${latestRun.status}.`
    },
    {
      name: "language_failures",
      status: latestRun.operator_summary.failed_languages.length > 0 ? "warning" : "ok",
      detail:
        latestRun.operator_summary.failed_languages.length > 0
          ? `Failed languages=${latestRun.operator_summary.failed_languages.join(",")} failed topics=${latestRun.operator_summary.failed_topics.join(",") || "n/a"}.`
          : "No failed languages reported."
    },
    {
      name: "rss_sources",
      status:
        latestRun.metrics.rss_attempted === null || latestRun.metrics.rss_attempted === 0
          ? "warning"
          : latestRun.metrics.rss_succeeded === 0
          ? "critical"
          : latestRun.metrics.rss_failed && latestRun.metrics.rss_failed > 0
          ? "warning"
          : "ok",
      detail: `RSS attempted=${latestRun.metrics.rss_attempted ?? "n/a"} succeeded=${latestRun.metrics.rss_succeeded ?? "n/a"} failed=${latestRun.metrics.rss_failed ?? "n/a"}.`
    },
    {
      name: "stale_fallback",
      status: latestRun.metrics.stale_fallback_used ? "warning" : "ok",
      detail: latestRun.metrics.stale_fallback_used ? "A stale RSS fallback window was used." : "No stale RSS fallback was used."
    },
    {
      name: "llm_timeouts",
      status: latestRun.metrics.llm_timeout_count && latestRun.metrics.llm_timeout_count > 0 ? "warning" : "ok",
      detail: `LLM timeout count=${latestRun.metrics.llm_timeout_count ?? 0}.`
    },
    {
      name: "validation_failures",
      status: latestRun.metrics.validation_failure_count > 0 ? "warning" : "ok",
      detail: `Validation failures=${latestRun.metrics.validation_failure_count}; by_rule=${JSON.stringify(latestRun.metrics.validation_failures_by_rule)}.`
    },
    {
      name: "cost_estimate",
      status: latestRun.metrics.estimated_cost_available === false ? "warning" : "ok",
      detail:
        latestRun.metrics.estimated_cost_available === false
          ? latestRun.metrics.estimated_cost_reason ?? "Cost estimate unavailable."
          : `Estimated cost USD=${latestRun.metrics.estimated_cost_usd ?? "n/a"}.`
    },
    {
      name: "persistence",
      status: latestRun.dry_run ? "warning" : latestRun.metrics.stored_items && latestRun.metrics.stored_items > 0 ? "ok" : "critical",
      detail: latestRun.dry_run
        ? "Latest run was dry-run and did not persist content."
        : `Stored items=${latestRun.metrics.stored_items ?? 0}.`
    },
    {
      name: "assignment",
      status: latestRun.dry_run ? "warning" : latestRun.metrics.assigned_users && latestRun.metrics.assigned_users > 0 ? "ok" : "warning",
      detail: latestRun.dry_run
        ? "Latest run was dry-run and did not assign users."
        : `Assigned users=${latestRun.metrics.assigned_users ?? 0}.`
    }
  ];

  return checks;
}

function toRunSummary(row: JobRunRow): JobHealthRunSummary {
  const metrics = row.metrics ?? {};
  const operatorSummary = row.operator_summary ?? {};
  const validationFailures = readRecord(metrics.validation_failures_by_rule);
  const validationFailureCount = Object.values(validationFailures).reduce<number>(
    (sum: number, value: unknown) => sum + (readNumber(value, 0) ?? 0),
    0
  );

  return {
    run_id: row.run_id,
    job_type: row.job_type,
    run_date: row.run_date,
    status: row.status,
    dry_run: row.dry_run,
    generator: row.generator,
    source_mode: row.source_mode,
    languages: row.languages,
    topics: row.topics,
    completed_at: row.completed_at,
    metrics: {
      rss_attempted: readNumber(metrics.rss_attempted),
      rss_succeeded: readNumber(metrics.rss_succeeded),
      rss_failed: readNumber(metrics.rss_failed),
      stale_fallback_used: readBoolean(metrics.stale_fallback_used),
      llm_timeout_count: readNumber(metrics.llm_timeout_count),
      validation_failures_by_rule: readNumberRecord(validationFailures),
      validation_failure_count: validationFailureCount,
      generated_items_by_language: readNumberRecord(readRecord(metrics.generated_items_by_language)),
      stored_items: readNumber(metrics.stored_items),
      assigned_users: readNumber(metrics.assigned_users),
      estimated_cost_usd: readNumber(metrics.estimated_cost_usd),
      estimated_cost_available: readBoolean(metrics.estimated_cost_available),
      estimated_cost_reason: readString(metrics.estimated_cost_reason)
    },
    operator_summary: {
      generated: readNumber(operatorSummary.generated),
      stored: readNumber(operatorSummary.stored),
      assigned: readNumber(operatorSummary.assigned),
      failed_languages: readStringArray(operatorSummary.failedLanguages),
      failed_topics: readStringArray(operatorSummary.failedTopics),
      cost_estimate_available: readBoolean(readRecord(operatorSummary.costEstimate).available),
      cost_estimate_usd: readNumber(readRecord(operatorSummary.costEstimate).estimatedUsd),
      cost_estimate_reason: readString(readRecord(operatorSummary.costEstimate).reason)
    }
  };
}

function worstStatus(statuses: JobHealthStatus[]): JobHealthStatus {
  if (statuses.includes("critical")) {
    return "critical";
  }
  if (statuses.includes("warning")) {
    return "warning";
  }
  return "ok";
}

function readFlags(args: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const nextValue = args[index + 1];
    if (inlineValue !== undefined) {
      values.set(rawKey, inlineValue);
      continue;
    }
    if (!nextValue || nextValue.startsWith("--")) {
      values.set(rawKey, "true");
      continue;
    }
    values.set(rawKey, nextValue);
    index += 1;
  }

  return values;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readNumberRecord(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, recordValue]) => [key, readNumber(recordValue)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== null)
  );
}

function readNumber(value: unknown, fallback: number | null = null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
