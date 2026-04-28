import { isLanguage, type Language } from "../domain.js";
import { ContentRepository, type DailyJobUserDebugResult } from "../storage/contentRepository.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";
import { toDateOnly } from "../utils/date.js";

const DEFAULT_USER_LIMIT = 5;
const MAX_USER_LIMIT = 25;
const DEFAULT_LANGUAGES = "fr,en";

export type DebugUsersOptions = {
  dropDate: string;
  languages: Language[];
  userLimit: number;
};

export type DebugUsersOutput = {
  mode: "debug-users";
  readOnly: true;
  summary: {
    languagesRequested: number;
    totalDailyJobConsideredBeforeLimit: number;
    totalDailyJobConsideredAfterLimit: number;
    totalEligibleNewAssignments: number;
    totalWouldUpdateExistingDrop: number;
  };
  languages: DailyJobUserDebugResult[];
};

export async function runDebugUsers(options: DebugUsersOptions): Promise<DebugUsersOutput> {
  assertDebugUsersEnvironment();

  const repository = new ContentRepository(
    createServiceRoleSupabaseClient({
      requireCredentials: true
    })
  );

  const languages = await Promise.all(
    options.languages.map((language) =>
      repository.debugDailyJobUsers({
        dropDate: options.dropDate,
        language,
        userLimit: options.userLimit
      })
    )
  );

  return {
    mode: "debug-users",
    readOnly: true,
    summary: summarizeDebugResults(languages),
    languages
  };
}

export function parseDebugUsersOptions(args: string[]): DebugUsersOptions {
  const flags = readFlags(args);
  const languages = parseLanguages(
    flags.get("languages") ?? flags.get("language") ?? process.env.LANGUAGES ?? process.env.LANGUAGE ?? DEFAULT_LANGUAGES
  );

  return {
    dropDate: flags.get("date") ?? toDateOnly(new Date()),
    languages,
    userLimit: parseUserLimit(flags.get("limit") ?? process.env.USER_LIMIT)
  };
}

function assertDebugUsersEnvironment(): void {
  const missing = [
    process.env.SUPABASE_URL ? null : "SUPABASE_URL",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? null : "SUPABASE_SERVICE_ROLE_KEY"
  ].filter((value): value is string => value !== null);

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `debug-users refused to run because the following required setting(s) are missing: ${missing.join(", ")}.`,
      "This command is read-only, but it uses service-role access to inspect app profile and preference tables.",
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in a server-side shell."
    ].join(" ")
  );
}

function parseLanguages(value: string): Language[] {
  const languages = [...new Set(value.split(",").map((language) => language.trim()).filter(Boolean))];
  if (languages.length === 0 || languages.some((language) => !isLanguage(language))) {
    throw new Error("--languages, --language, LANGUAGES, or LANGUAGE must contain fr, en, or both as a comma-separated list.");
  }

  return languages as Language[];
}

function summarizeDebugResults(results: DailyJobUserDebugResult[]): DebugUsersOutput["summary"] {
  return {
    languagesRequested: results.length,
    totalDailyJobConsideredBeforeLimit: sumCounts(results, "dailyJobConsideredBeforeLimit"),
    totalDailyJobConsideredAfterLimit: sumCounts(results, "dailyJobConsideredAfterLimit"),
    totalEligibleNewAssignments: sumCounts(results, "eligibleNewAssignments"),
    totalWouldUpdateExistingDrop: sumCounts(results, "wouldUpdateExistingDrop")
  };
}

function sumCounts(results: DailyJobUserDebugResult[], key: keyof DailyJobUserDebugResult["counts"]): number {
  return results.reduce((total, result) => total + result.counts[key], 0);
}

function parseUserLimit(value: string | undefined): number {
  if (!value) {
    return DEFAULT_USER_LIMIT;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--limit or USER_LIMIT must be a positive integer.");
  }

  return Math.max(1, Math.min(parsed, MAX_USER_LIMIT));
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
