import { ContentRepository, type PersistTestCleanupResult } from "../storage/contentRepository.js";
import { serializePersistenceError } from "../storage/persistenceError.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";

export type CleanupTestOptions = {
  testRunId: string;
};

export type CleanupTestOutput = {
  mode: "cleanup-test";
  confirmation: "CONFIRM_CLEANUP_TEST=true";
  persisted: false;
  cleanup: PersistTestCleanupResult;
};

export async function runCleanupTest(options: CleanupTestOptions): Promise<CleanupTestOutput> {
  assertCleanupTestEnvironment(options.testRunId);

  logProgress("cleanup started", {
    test_run_id: options.testRunId
  });

  const repository = new ContentRepository(
    createServiceRoleSupabaseClient({
      requireCredentials: true
    })
  );

  let cleanup: PersistTestCleanupResult;

  try {
    cleanup = await repository.cleanupPersistTestContent(options.testRunId);
  } catch (error) {
    logProgress("cleanup failed", {
      test_run_id: options.testRunId,
      error: serializePersistenceError(error)
    });
    throw error;
  }

  logProgress("cleanup completed", {
    test_run_id: options.testRunId,
    deleted_content_items: cleanup.deletedContentItems,
    deleted_content_item_sources: cleanup.deletedContentItemSources,
    deleted_generation_runs: cleanup.deletedGenerationRuns,
    skipped_content_items: cleanup.skippedContentItems.length
  });

  return {
    mode: "cleanup-test",
    confirmation: "CONFIRM_CLEANUP_TEST=true",
    persisted: false,
    cleanup
  };
}

export function parseCleanupTestOptions(args: string[]): CleanupTestOptions {
  const testRunId = readStringOption(args, "test-run-id") ?? readStringOption(args, "testRunId");

  if (!testRunId) {
    throw new Error("cleanup-test requires --test-run-id persist-test-...");
  }

  return { testRunId };
}

function assertCleanupTestEnvironment(testRunId: string): void {
  const missing = [
    process.env.SUPABASE_URL ? null : "SUPABASE_URL",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? null : "SUPABASE_SERVICE_ROLE_KEY",
    process.env.CONFIRM_CLEANUP_TEST === "true" ? null : "CONFIRM_CLEANUP_TEST=true"
  ].filter((value): value is string => value !== null);

  if (!testRunId.startsWith("persist-test-")) {
    throw new Error("cleanup-test refused to run because --test-run-id must start with persist-test-.");
  }

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `cleanup-test refused to delete because the following required setting(s) are missing: ${missing.join(", ")}.`,
      "This command deletes only draft content_items with persist-test safety metadata for the supplied test_run_id.",
      "It does not delete sources, daily drops, user data, or content without the persist-test markers.",
      "To run it intentionally, set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONFIRM_CLEANUP_TEST=true, and pass --test-run-id."
    ].join(" ")
  );
}

function readStringOption(args: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));

  if (inline) {
    return inline.slice(prefix.length).trim() || null;
  }

  const index = args.indexOf(`--${name}`);
  if (index === -1) {
    return null;
  }

  return args[index + 1]?.trim() || null;
}

function logProgress(message: string, details: Record<string, unknown>): void {
  process.stderr.write(`[cleanup-test] ${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
}
