#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REQUIRED_TABLES = [
  "profiles",
  "user_preferences",
  "user_topic_preferences",
  "topics",
  "content_items",
  "sources",
  "daily_drops",
  "daily_drop_items",
  "content_interactions"
];

const SUPPORTING_TABLES = [
  "generation_runs",
  "content_item_sources",
  "mini_case_responses"
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
  topics: ["Anyone can read active topics"],
  content_items: ["Authenticated users can read published content"],
  sources: ["Authenticated users can read sources for published content"],
  content_item_sources: ["Authenticated users can read source links for published content"],
  daily_drops: ["Users can read their own published daily drops"],
  daily_drop_items: ["Users can read items for their own published daily drops"],
  content_interactions: [
    "Users can read their own interactions",
    "Users can insert their own interactions"
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
        .select("*", { count: "exact", head: true });

      if (error) {
        addCheck("fail", `service role can read public.${table}`, sanitizeError(error));
      } else {
        addCheck("pass", `service role can read public.${table}`, "Table exists and is reachable.");
      }
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

    const { data: publishedContent, error: contentError } = await userClient
      .from("content_items")
      .select("id,status")
      .eq("status", "published")
      .limit(1);

    if (contentError) {
      addCheck("fail", "authenticated users can read published content", sanitizeError(contentError));
    } else if ((publishedContent ?? []).length > 0) {
      addCheck("pass", "authenticated users can read published content", "At least one published content item is visible.");
    } else {
      addCheck("warn", "authenticated users can read published content", "No published content exists, so the policy could not be proven with data.");
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
  TEST_USER_ACCESS_TOKEN should be a short-lived access token from a tester session.
  OTHER_USER_ID should be a different profile/auth user id used only to prove isolation.
`);
}
