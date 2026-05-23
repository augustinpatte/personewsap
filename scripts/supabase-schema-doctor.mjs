#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REQUIRED_TABLES = [
  "profiles",
  "user_preferences",
  "user_topic_preferences",
  "user_mini_case_topic_preferences",
  "topics",
  "content_items",
  "sources",
  "daily_drops",
  "daily_drop_items",
  "content_interactions"
];

const SUPPORTING_TABLES = [
  "generation_runs",
  "job_runs",
  "content_item_sources",
  "business_story_history",
  "mini_case_history",
  "mini_case_responses",
  "push_tokens"
];

const EXPECTED_TOPICS = [
  "business",
  "finance",
  "tech_ai",
  "law",
  "medicine",
  "engineering",
  "sport_business",
  "culture_media"
];

const EXPECTED_POLICIES = {
  profiles: [
    "Users can insert their own mobile profile",
    "Users can read their own mobile profile",
    "Users can update their own mobile profile"
  ],
  user_preferences: [
    "Users can insert their own preferences",
    "Users can read their own preferences",
    "Users can update their own preferences"
  ],
  user_topic_preferences: [
    "Users can insert their own topic preferences",
    "Users can read their own topic preferences",
    "Users can update their own topic preferences",
    "Users can delete their own topic preferences"
  ],
  user_mini_case_topic_preferences: [
    "Users can insert their own mini-case topic preferences",
    "Users can read their own mini-case topic preferences",
    "Users can update their own mini-case topic preferences",
    "Users can delete their own mini-case topic preferences"
  ],
  topics: ["Anyone can read active topics"],
  content_items: ["Users can read assigned published content"],
  sources: ["Users can read sources for assigned content"],
  content_item_sources: ["Users can read source links for assigned content"],
  daily_drops: ["Users can read their own published daily drops"],
  daily_drop_items: ["Users can read items for their own published daily drops"],
  content_interactions: [
    "Users can read own interactions for assigned content",
    "Users can insert own interactions for assigned content",
    "Users can delete their own interactions"
  ],
  mini_case_responses: [
    "Users can read own mini-case responses for assigned content",
    "Users can insert own mini-case responses for assigned content",
    "Users can update own mini-case responses for assigned content",
    "Users can delete their own mini-case responses"
  ],
  pending_registrations: [
    "Users can update their pending registration"
  ],
  push_tokens: [
    "Users can read their own push tokens",
    "Users can insert their own push tokens",
    "Users can update their own push tokens",
    "Users can delete their own push tokens"
  ]
};

const EXPECTED_UNIQUE_INDEXES = [
  "content_interactions_complete_once_per_user_content",
  "content_interactions_save_once_per_user_content"
];

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const live = args.has("--live");
const strict = args.has("--strict");
const rootDir = process.cwd();
const migrationDir = path.join(rootDir, "supabase", "migrations");
const checks = [];

await loadDefaultEnvFiles();
await runStaticMigrationAudit();

if (live) {
  await runLiveReadOnlyChecks();
} else {
  addCheck(
    "warn",
    "live read-only checks skipped",
    "Run with --live and local Supabase env vars to check the configured database."
  );
}

printReport();

const hasFailures = checks.some((check) => check.status === "fail");
const hasWarnings = checks.some((check) => check.status === "warn");

if (hasFailures || (strict && hasWarnings)) {
  process.exitCode = 1;
}

async function runStaticMigrationAudit() {
  const files = (await readdir(migrationDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const sqlParts = await Promise.all(
    files.map(async (file) => readFile(path.join(migrationDir, file), "utf8"))
  );
  const sql = sqlParts.join("\n\n");

  addCheck("pass", "migration files found", `${files.length} SQL migration file(s) found.`);

  for (const table of REQUIRED_TABLES) {
    assertRegex(
      sql,
      new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?public\\.${table}\\b`, "i"),
      `migration creates public.${table}`
    );
  }

  for (const table of SUPPORTING_TABLES) {
    assertRegex(
      sql,
      new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?public\\.${table}\\b`, "i"),
      `migration creates supporting table public.${table}`
    );
  }

  for (const table of [...REQUIRED_TABLES, ...SUPPORTING_TABLES]) {
    assertRegex(
      sql,
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
      `migration enables RLS on public.${table}`
    );
  }

  for (const [table, policies] of Object.entries(EXPECTED_POLICIES)) {
    for (const policy of policies) {
      assertRegex(
        sql,
        new RegExp(`create\\s+policy\\s+"${escapeRegExp(policy)}"\\s+on\\s+public\\.${table}\\b`, "i"),
        `migration defines policy "${policy}" on public.${table}`
      );
    }
  }

  for (const topic of EXPECTED_TOPICS) {
    assertRegex(
      sql,
      new RegExp(`['"]${escapeRegExp(topic)}['"]`, "i"),
      `migration seeds topic ${topic}`
    );
  }

  assertRegex(
    sql,
    /status\s*=\s*'published'|status\s+in\s*\('published',\s*'read',\s*'archived'\)/i,
    "migration restricts app reads to published/read/archive content paths"
  );

  assertRegex(
    sql,
    /unique\s*\(\s*user_id\s*,\s*drop_date\s*\)|add\s+constraint\s+\w+\s+unique\s*\(\s*user_id\s*,\s*drop_date\s*\)/i,
    "migration enforces one daily_drop per user/date"
  );

  assertRegex(
    sql,
    /primary\s+key\s*\(\s*daily_drop_id\s*,\s*content_item_id\s*\)|unique\s*\(\s*daily_drop_id\s*,\s*content_item_id\s*\)|add\s+constraint\s+\w+\s+unique\s*\(\s*daily_drop_id\s*,\s*content_item_id\s*\)/i,
    "migration prevents duplicate daily_drop/content_item links"
  );

  assertRegex(
    sql,
    /unique\s*\(\s*daily_drop_id\s*,\s*slot\s*,\s*position\s*\)|add\s+constraint\s+\w+\s+unique\s*\(\s*daily_drop_id\s*,\s*slot\s*,\s*position\s*\)/i,
    "migration prevents duplicate daily_drop slot positions"
  );

  for (const indexName of EXPECTED_UNIQUE_INDEXES) {
    assertRegex(
      sql,
      new RegExp(`create\\s+unique\\s+index\\s+(if\\s+not\\s+exists\\s+)?${escapeRegExp(indexName)}\\b`, "i"),
      `migration defines idempotency index ${indexName}`
    );
  }

  assertRegex(
    sql,
    /create\s+or\s+replace\s+function\s+public\.user_has_assigned_content\s*\(\s*target_content_item_id\s+uuid\s*\)/i,
    "migration defines assigned content RLS helper"
  );

  assertRegex(
    sql,
    /create\s+or\s+replace\s+function\s+public\.public_archive_enabled\s*\(\s*\)/i,
    "migration defines public archive feature flag helper"
  );

  assertRegex(
    sql,
    /create\s+or\s+replace\s+function\s+public\.is_published_content\s*\(/i,
    "migration defines published content RLS helper"
  );

  assertRegex(
    sql,
    /drop\s+policy\s+if\s+exists\s+"Authenticated users can read published content"\s+on\s+public\.content_items/i,
    "migration removes broad published content read policy"
  );

  assertRegex(
    sql,
    /drop\s+policy\s+if\s+exists\s+"Anyone can update pending registrations"\s+on\s+public\.pending_registrations/i,
    "migration removes broad pending registration update policy"
  );

  const sqlWithoutLineComments = sql.replace(/--[^\n]*/g, "");
  const publicArchiveEnabledByDb = /alter\s+database\s+\S+\s+set\s+app\.public_archive_enabled\s*=\s*'true'/i.test(sqlWithoutLineComments);
  addCheck(
    publicArchiveEnabledByDb ? "fail" : "pass",
    "public archive feature flag not enabled in migrations",
    publicArchiveEnabledByDb
      ? "A migration sets app.public_archive_enabled = 'true', which bypasses assigned-content RLS for all authenticated users."
      : "No migration enables the public archive bypass. Default is off."
  );

  assertRegex(
    sql,
    /unique\s*\(\s*user_id\s*,\s*expo_push_token\s*\)/i,
    "migration prevents duplicate push token rows per user"
  );

  assertRegex(
    sql,
    /alter\s+table\s+public\.user_preferences[\s\S]+add\s+column\s+(if\s+not\s+exists\s+)?mini_case_topic_id\s+text\s+references\s+public\.topics\s*\(\s*id\s*\)/i,
    "migration preserves legacy explicit mini-case topic preference"
  );

  assertRegex(
    sql,
    /create\s+table\s+if\s+not\s+exists\s+public\.user_mini_case_topic_preferences/i,
    "migration stores mini-case preferences separately from newsletter topic preferences"
  );

  assertRegex(
    sql,
    /user_mini_case_topic_preferences_topic_id_check[\s\S]+finance_economy[\s\S]+stock_market[\s\S]+ai[\s\S]+law_compliance[\s\S]+health_pharma[\s\S]+engineering_operations/i,
    "migration constrains mini-case preferences to six product mini-case topic IDs"
  );

  assertRegex(
    sql,
    /alter\s+table\s+public\.user_preferences[\s\S]+add\s+column\s+(if\s+not\s+exists\s+)?newsletter_enabled\s+boolean[\s\S]+add\s+column\s+(if\s+not\s+exists\s+)?business_stories_enabled\s+boolean[\s\S]+add\s+column\s+(if\s+not\s+exists\s+)?mini_cases_enabled\s+boolean/i,
    "migration stores enabled daily modules on user_preferences"
  );

  assertRegex(
    sql,
    /alter\s+table\s+public\.profiles[\s\S]+drop\s+column\s+if\s+exists\s+first_name[\s\S]+drop\s+column\s+if\s+exists\s+last_name[\s\S]+drop\s+column\s+if\s+exists\s+birth_year/i,
    "migration removes unused profile name and birth-year fields"
  );

  assertRegex(
    sql,
    /create\s+table\s+if\s+not\s+exists\s+public\.business_story_history[\s\S]+entity_name[\s\S]+entity_type[\s\S]+key_mechanism[\s\S]+strategic_angle[\s\S]+core_takeaway/i,
    "migration creates business-story editorial memory"
  );

  assertRegex(
    sql,
    /business_story_history_entity_type_check[\s\S]+founder[\s\S]+ceo[\s\S]+investor[\s\S]+company[\s\S]+product[\s\S]+crisis[\s\S]+acquisition[\s\S]+strategy[\s\S]+other/i,
    "migration constrains business-story entity types"
  );

  assertRegex(
    sql,
    /create\s+unique\s+index\s+if\s+not\s+exists\s+business_story_history_slug_unique[\s\S]+on\s+public\.business_story_history\s*\(\s*slug\s*\)/i,
    "migration prevents duplicate business-story slugs"
  );

  assertRegex(
    sql,
    /create\s+table\s+if\s+not\s+exists\s+public\.mini_case_history[\s\S]+scenario_type[\s\S]+decision_type[\s\S]+concept_tested[\s\S]+question_pattern[\s\S]+core_takeaway/i,
    "migration creates mini-case editorial memory"
  );

  assertRegex(
    sql,
    /mini_case_history_topic_check[\s\S]+finance_economy[\s\S]+stock_market[\s\S]+ai[\s\S]+law_compliance[\s\S]+health_pharma[\s\S]+engineering_operations/i,
    "migration constrains mini-case product topics"
  );

  assertRegex(
    sql,
    /create\s+unique\s+index\s+if\s+not\s+exists\s+mini_case_history_slug_unique[\s\S]+on\s+public\.mini_case_history\s*\(\s*slug\s*\)/i,
    "migration prevents duplicate mini-case slugs"
  );

  assertRegex(
    sql,
    /alter\s+table\s+public\.pending_registrations[\s\S]+add\s+column\s+if\s+not\s+exists\s+expires_at\s+timestamptz/i,
    "migration adds pending registration expiry"
  );

  assertRegex(
    sql,
    /create\s+or\s+replace\s+function\s+public\.cleanup_expired_pending_registrations\s*\(\s*\)/i,
    "migration defines pending registration cleanup function"
  );
}

async function runLiveReadOnlyChecks() {
  const supabaseUrl =
    readEnv("SUPABASE_URL") ??
    readEnv("EXPO_PUBLIC_SUPABASE_URL") ??
    readEnv("VITE_SUPABASE_URL");
  const anonKey =
    readEnv("SUPABASE_ANON_KEY") ??
    readEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY") ??
    readEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const testUserAccessToken = readEnv("TEST_USER_ACCESS_TOKEN");
  const otherUserId = readEnv("OTHER_USER_ID");

  if (!supabaseUrl) {
    addCheck("warn", "SUPABASE_URL missing", "Live checks need SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL.");
    return;
  }

  if (!anonKey && !serviceRoleKey) {
    addCheck("warn", "Supabase key missing", "Live checks need SUPABASE_ANON_KEY and/or SUPABASE_SERVICE_ROLE_KEY.");
    return;
  }

  if (serviceRoleKey) {
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    for (const table of [...REQUIRED_TABLES, ...SUPPORTING_TABLES]) {
      const { error } = await serviceClient
        .from(table)
        .select("*")
        .limit(1);

      if (error) {
        addCheck("fail", `service role can read public.${table}`, sanitizeError(error));
      } else {
        addCheck("pass", `service role can read public.${table}`, "Table exists and is reachable.");
      }
    }

    const { error: miniCaseColumnError } = await serviceClient
      .from("user_preferences")
      .select("mini_case_topic_id")
      .limit(1);

    if (miniCaseColumnError) {
      addCheck(
        "fail",
        "service role can read public.user_preferences.mini_case_topic_id",
        sanitizeError(miniCaseColumnError)
      );
    } else {
      addCheck(
        "pass",
        "service role can read public.user_preferences.mini_case_topic_id",
        "Compatibility column exists and is reachable."
      );
    }
  } else {
    addCheck("warn", "service role checks skipped", "Set SUPABASE_SERVICE_ROLE_KEY to check service-role table reachability.");
  }

  if (anonKey) {
    const anonClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false }
    });

    const { data: topics, error: topicsError } = await anonClient
      .from("topics")
      .select("id")
      .eq("active", true);

    if (topicsError) {
      addCheck("fail", "active topics are visible", sanitizeError(topicsError));
    } else {
      const foundTopics = new Set((topics ?? []).map((topic) => topic.id));
      const missingTopics = EXPECTED_TOPICS.filter((topic) => !foundTopics.has(topic));

      if (missingTopics.length === 0) {
        addCheck("pass", "topics are seeded", `${foundTopics.size} expected active topic(s) visible.`);
      } else {
        addCheck("fail", "topics are seeded", `Missing active topic(s): ${missingTopics.join(", ")}.`);
      }
    }
  }

  if (anonKey && testUserAccessToken) {
    const userId = decodeJwtSubject(testUserAccessToken);
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${testUserAccessToken}`
        }
      }
    });

    const { data: assignedContent, error: contentError } = await userClient
      .from("content_items")
      .select("id,status")
      .eq("status", "published")
      .limit(1);

    if (contentError) {
      addCheck("fail", "authenticated users can query assigned published content", sanitizeError(contentError));
    } else if ((assignedContent ?? []).length > 0) {
      addCheck("pass", "authenticated users can query assigned published content", "At least one assigned published content item is visible.");
    } else {
      addCheck("warn", "authenticated users can query assigned published content", "No assigned published content is visible for TEST_USER_ACCESS_TOKEN.");
    }

    const { data: ownDrops, error: ownDropsError } = await userClient
      .from("daily_drops")
      .select("id,user_id,status")
      .limit(20);

    if (ownDropsError) {
      addCheck("fail", "authenticated user can query daily drops", sanitizeError(ownDropsError));
    } else if (!userId) {
      addCheck("warn", "authenticated user can query daily drops", "Could not decode TEST_USER_ACCESS_TOKEN subject.");
    } else if ((ownDrops ?? []).every((drop) => drop.user_id === userId)) {
      addCheck("pass", "authenticated user only sees own daily drops", `${ownDrops?.length ?? 0} row(s) returned for token subject.`);
    } else {
      addCheck("fail", "authenticated user only sees own daily drops", "Query returned a daily_drop for another user.");
    }

    if (otherUserId) {
      const { data: otherDrops, error: otherDropsError } = await userClient
        .from("daily_drops")
        .select("id,user_id,status")
        .eq("user_id", otherUserId)
        .limit(5);

      if (otherDropsError) {
        addCheck("fail", "app user cannot read another user's daily drops", sanitizeError(otherDropsError));
      } else if ((otherDrops ?? []).length === 0) {
        addCheck("pass", "app user cannot read another user's daily drops", "No rows returned for OTHER_USER_ID.");
      } else {
        addCheck("fail", "app user cannot read another user's daily drops", `${otherDrops.length} row(s) leaked for OTHER_USER_ID.`);
      }
    } else {
      addCheck("warn", "cross-user daily_drop check skipped", "Set OTHER_USER_ID to prove one tester cannot read another user's drop.");
    }
  } else {
    addCheck(
      "warn",
      "authenticated RLS checks skipped",
      "Set SUPABASE_ANON_KEY and TEST_USER_ACCESS_TOKEN to check published-content and daily_drops RLS."
    );
  }

  addCheck(
    "warn",
    "pending_registrations INSERT is open to unauthenticated users",
    "By design for cross-device registration, but an attacker who knows a target email can pre-insert a row and block that user's registration (UNIQUE constraint collision). Acceptable for current flow; revisit if registration DoS becomes a concern."
  );

  if (serviceRoleKey) {
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    const { data: archiveFlag, error: archiveFlagError } = await serviceClient.rpc(
      "public_archive_enabled"
    );

    if (archiveFlagError) {
      addCheck(
        "warn",
        "public_archive_enabled() RPC check skipped",
        sanitizeError(archiveFlagError)
      );
    } else if (archiveFlag === true) {
      addCheck(
        "fail",
        "public archive feature flag is OFF in live database",
        "public_archive_enabled() returned true — all authenticated users can read ALL published content, bypassing assigned-content RLS. Disable with: ALTER DATABASE postgres RESET app.public_archive_enabled;"
      );
    } else {
      addCheck(
        "pass",
        "public archive feature flag is OFF in live database",
        "public_archive_enabled() returned false. Assigned-content RLS is the enforced path."
      );
    }
  }

  addCheck(
    "warn",
    "service role write persistence is manual",
    "Run npm --prefix services/content-engine run persist-test with explicit confirmation against a local/disposable project."
  );
}

function assertRegex(sql, regex, label) {
  const ok = regex.test(sql);
  addCheck(ok ? "pass" : "fail", label, ok ? "Found in migrations." : "Missing from migrations.");
}

function addCheck(status, label, detail) {
  checks.push({ status, label, detail });
}

function printReport() {
  const statusLabel = {
    pass: "PASS",
    warn: "WARN",
    fail: "FAIL"
  };

  process.stdout.write("\nSupabase schema doctor\n");
  process.stdout.write("======================\n\n");

  for (const check of checks) {
    process.stdout.write(`${statusLabel[check.status]} ${check.label}\n`);
    if (check.detail) {
      process.stdout.write(`     ${check.detail}\n`);
    }
  }

  const totals = checks.reduce(
    (summary, check) => ({
      ...summary,
      [check.status]: summary[check.status] + 1
    }),
    { pass: 0, warn: 0, fail: 0 }
  );

  process.stdout.write(`\nSummary: ${totals.pass} pass, ${totals.warn} warn, ${totals.fail} fail\n`);
  process.stdout.write("This tool is read-only. It does not apply migrations or write production data.\n");
}

function readEnv(name) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

async function loadDefaultEnvFiles() {
  const envFiles = [
    path.join(rootDir, ".env"),
    path.join(rootDir, "apps", "mobile", ".env"),
    path.join(rootDir, "services", "content-engine", ".env")
  ];

  for (const envFile of envFiles) {
    try {
      const content = await readFile(envFile, "utf8");
      loadEnvContent(content);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        addCheck("warn", `could not read ${path.relative(rootDir, envFile)}`, error.message);
      }
    }
  }
}

function loadEnvContent(content) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);

    if (!match || process.env[match[1]]) {
      continue;
    }

    process.env[match[1]] = parseEnvValue(match[2]);
  }
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function sanitizeError(error) {
  const parts = [
    typeof error?.code === "string" ? `code=${error.code}` : null,
    typeof error?.message === "string" ? error.message : null,
    typeof error?.hint === "string" ? `hint=${error.hint}` : null
  ].filter(Boolean);

  return parts.join(" ");
}

function decodeJwtSubject(token) {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printHelp() {
  process.stdout.write(`Supabase schema doctor

Usage:
  node scripts/supabase-schema-doctor.mjs
  node scripts/supabase-schema-doctor.mjs --live
  node scripts/supabase-schema-doctor.mjs --live --strict

Default mode:
  Reads local migration files only.

Live mode:
  Runs read-only checks against Supabase. It never applies migrations and never writes data.

Optional env vars for live mode:
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  TEST_USER_ACCESS_TOKEN
  OTHER_USER_ID

Notes:
  The doctor loads .env, apps/mobile/.env, and services/content-engine/.env when present.
  TEST_USER_ACCESS_TOKEN should be a short-lived access token from a tester session.
  OTHER_USER_ID should be a different profile/auth user id used only to prove isolation.
`);
}
