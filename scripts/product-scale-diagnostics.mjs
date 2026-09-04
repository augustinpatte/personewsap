#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

check("archive search uses flat keyset view", () => {
  const libraryData = read("apps/mobile/src/features/library/libraryData.ts");
  const migration = read("supabase/migrations/20260818090000_archive_search_keyset.sql");

  assertIncludes(libraryData, "user_archive_search_items");
  assertIncludes(libraryData, ".order(\"drop_date\", { ascending: false })");
  assertIncludes(libraryData, ".order(\"content_item_id\", { ascending: false })");
  assertIncludes(migration, "CREATE OR REPLACE VIEW public.user_archive_search_items");
  assertIncludes(migration, "security_invoker");
});

check("archive scale regression test covers 5,000 rows", () => {
  const test = read("apps/mobile/src/features/archive/archiveSearchPaging.test.ts");

  assertIncludes(test, "walks 5 000 results");
  assertIncludes(test, "expect(items).toHaveLength(5000)");
});

check("reader item cache is scoped by user and language", () => {
  const dailyDropData = read("apps/mobile/src/features/today/dailyDropData.ts");
  const readerProvider = read("apps/mobile/src/features/today/ReaderItemProvider.tsx");
  const regressionTest = read("apps/mobile/src/features/today/dailyDropData.accountIsolation.test.ts");

  assertIncludes(dailyDropData, "options.userId ?? \"anonymous\"");
  assertIncludes(dailyDropData, "options.language ?? \"any\"");
  assertIncludes(dailyDropData, "isContentItemAssignedToUser");
  assertIncludes(readerProvider, "userId: user?.id ?? null");
  assertIncludes(regressionTest, "does not serve account A's cached reader item to account B");
});

check("daily-drop and interaction idempotency constraints exist", () => {
  const migrations = readMigrations();

  assertIncludes(migrations, "daily_drops_user_drop_date_unique");
  assertIncludes(migrations, "daily_drop_items_drop_content_unique");
  assertIncludes(migrations, "daily_drop_items_drop_slot_position_unique");
  assertIncludes(migrations, "content_interactions_complete_once_per_user_content");
  assertIncludes(migrations, "content_interactions_save_once_per_user_content");
});

check("mini-case, learning and push retry idempotency constraints exist", () => {
  const migrations = readMigrations();

  assertIncludes(migrations, "mini_case_responses_user_content_unique");
  assertIncludes(migrations, "learning_sessions_one_unstarted_per_path");
  assertIncludes(migrations, "learning_session_feedback_session_unique");
  assertIncludes(migrations, "push_notification_deliveries_identity_unique");
  assertIncludes(migrations, "claim_push_notification_deliveries");
  assertIncludes(migrations, "idx_push_notification_deliveries_awaiting_receipt");
});

check("backend assignment queries batch large user lists", () => {
  const repository = read("services/content-engine/src/storage/contentRepository.ts");

  assertIncludes(repository, "USER_ID_FILTER_BATCH_SIZE");
  assertIncludes(repository, "SUPABASE_PAGE_SIZE");
  assertIncludes(repository, "for (const batch of chunk(userIds, USER_ID_FILTER_BATCH_SIZE))");
  assertIncludes(repository, "content_items!inner(content_type)");
});

check("push notification backend batches large readership queries", () => {
  const store = read("services/content-engine/src/notifications/supabasePushStore.ts");

  assertIncludes(store, "SUPABASE_PAGE_SIZE");
  assertIncludes(store, "USER_ID_FILTER_BATCH_SIZE");
  assertIncludes(store, "for (const batch of chunk([...new Set(userIds)], USER_ID_FILTER_BATCH_SIZE))");
  assertIncludes(store, "claim_push_notification_deliveries");
});

check("push delivery scale guards cover provider limits and retries", () => {
  const sender = read("services/content-engine/src/notifications/pushSender.ts");
  const tests = read("services/content-engine/src/notifications/pushSender.test.ts");

  assertIncludes(sender, "EXPO_PUSH_MESSAGES_PER_SECOND");
  assertIncludes(sender, "EXPO_RECEIPT_CHUNK_SIZE");
  assertIncludes(sender, "createPushRateLimiter");
  assertIncludes(sender, "withRetry");
  assertIncludes(tests, "sends 10,000 recipients without exceeding 500 messages per second");
  assertIncludes(tests, "drains 10,000 awaiting receipts without exceeding Expo receipt request size");
});

check("push workflows use Europe/Paris edition, retry and receipt schedules", () => {
  const editionWorkflow = read(".github/workflows/content-daily-job.yml");
  const retryWorkflow = read(".github/workflows/push-notification-retry.yml");
  const receiptWorkflow = read(".github/workflows/push-receipts.yml");

  assertIncludes(editionWorkflow, 'timezone: "Europe/Paris"');
  assertIncludes(editionWorkflow, 'cron: "10 19 * * 1,3,5,0"');
  assertIncludes(retryWorkflow, 'timezone: "Europe/Paris"');
  assertIncludes(retryWorkflow, "content:push-notifications");
  assertIncludes(receiptWorkflow, 'timezone: "Europe/Paris"');
  assertIncludes(receiptWorkflow, "content:push-receipts");
});

check("production scale model fixture is present", () => {
  const fixture = read("src/test/productionScaleModel.test.ts");

  assertIncludes(fixture, "10, 100, 1000, 10000");
  assertIncludes(fixture, "100, 1000, 5000");
  assertIncludes(fixture, "EDITIONS_PER_WEEK * WEEKS_PER_YEAR");
  assertIncludes(fixture, "makeIds(\"case-response-a\", 5000)");
});

warn("account data export currently reads full user-owned histories", () => {
  const privacyData = read("apps/mobile/src/features/account/privacyData.ts");

  assertIncludes(privacyData, ".from(\"content_interactions\")");
  assertIncludes(privacyData, ".from(\"mini_case_responses\")");
  assertIncludes(privacyData, ".from(\"daily_drops\")");
});

warn("debug-users diagnostics intentionally scan full tables", () => {
  const repository = read("services/content-engine/src/storage/contentRepository.ts");

  assertIncludes(repository, "listDebugProfiles");
  assertIncludes(repository, "listDebugUserPreferences");
  assertIncludes(repository, "listDebugDailyDrops");
});

printSummary();

function check(label, fn) {
  runCheck("PASS", "FAIL", label, fn);
}

function warn(label, fn) {
  runCheck("WARN", "WARN", label, fn);
}

function runCheck(passStatus, failStatus, label, fn) {
  try {
    fn();
    checks.push({ status: passStatus, label });
  } catch (error) {
    checks.push({
      status: failStatus,
      label,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

function read(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`${relativePath} is missing`);
  }

  return readFileSync(absolutePath, "utf8");
}

function readMigrations() {
  return [
    "supabase/migrations/20260426120000_mobile_app_foundation.sql",
    "supabase/migrations/20260428120000_beta_data_integrity_hardening.sql",
    "supabase/migrations/20260429120000_assigned_content_rls_hardening.sql",
    "supabase/migrations/20260731170000_learning_session_lifecycle.sql",
    "supabase/migrations/20260817120000_mini_case_response_sync.sql",
    "supabase/migrations/20260818100000_push_notification_deliveries.sql",
    "supabase/migrations/20260818123000_push_receipts_and_atomic_claims.sql"
  ]
    .map(read)
    .join("\n");
}

function assertIncludes(source, pattern) {
  if (!source.includes(pattern)) {
    throw new Error(`missing pattern: ${pattern}`);
  }
}

function printSummary() {
  console.log("PersoNewsAP Production Scale Diagnostics");
  console.log("=======================================");
  console.log("Scale model: 10/100/1,000/10,000 users; 100/1,000/5,000 archive rows; one year of 4x/week editions; 100+ learning sessions; 5,000 mini-case responses.");
  console.log("");

  for (const item of checks) {
    console.log(`${item.status} ${item.label}${item.detail ? `: ${item.detail}` : ""}`);
  }

  const failures = checks.filter((item) => item.status === "FAIL");
  const warnings = checks.filter((item) => item.status === "WARN");

  console.log("");
  console.log(`Totals: ${checks.length - failures.length - warnings.length} pass, ${warnings.length} warn, ${failures.length} fail`);

  if (failures.length > 0) {
    process.exitCode = 1;
    console.log("FAIL");
    return;
  }

  console.log("PASS");
}
