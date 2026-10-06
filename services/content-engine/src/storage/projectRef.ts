/**
 * Which Supabase project a URL points at, and refusals for pointing at the
 * wrong one.
 *
 * Every Node CLI here builds its client from whatever SUPABASE_URL happens to
 * be loaded. These helpers make the target explicit and checkable.
 */

export const PRODUCTION_PROJECT_REF = "wkbviidrbmehmjbhvpeh";
export const STAGING_PROJECT_REF = "kukyotcgbnchsoeriqoz";

/** `https://<ref>.supabase.co` -> `<ref>`; null for anything else (local, proxies, garbage). */
export function projectRefFromSupabaseUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  const match = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in|net)(\/|$)/i.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

export class ProjectTargetError extends Error {
  readonly code = "wrong_supabase_project";

  constructor(message: string) {
    super(message);
    this.name = "ProjectTargetError";
  }
}

/**
 * The break-glass staging publisher reads staging and writes production. Before
 * it writes anything: the production URL must be the project the batch was
 * built for, and must not be the staging project itself.
 */
export function assertBreakGlassTarget(input: {
  productionUrl: string | null | undefined;
  stagingUrl: string | null | undefined;
  batchTargetRef: string | null | undefined;
}): string {
  const productionRef = projectRefFromSupabaseUrl(input.productionUrl);
  const stagingRef = projectRefFromSupabaseUrl(input.stagingUrl);
  const targetRef = input.batchTargetRef?.trim().toLowerCase() || PRODUCTION_PROJECT_REF;

  if (!productionRef) {
    throw new ProjectTargetError(
      "SUPABASE_URL does not name a Supabase project (expected https://<ref>.supabase.co). Refusing to write."
    );
  }

  if (stagingRef && productionRef === stagingRef) {
    throw new ProjectTargetError(
      `SUPABASE_URL and STAGING_SUPABASE_URL both point at ${productionRef}. The write target must be production, not staging.`
    );
  }

  if (productionRef !== targetRef) {
    throw new ProjectTargetError(
      `SUPABASE_URL points at ${productionRef}, but the batch targets ${targetRef}. Refusing to publish into the wrong project.`
    );
  }

  return productionRef;
}

// ---------------------------------------------------------------------------
// Every CLI that writes declares where it writes
// ---------------------------------------------------------------------------

/**
 * What each engine command does to the database it is pointed at.
 *
 *   read             reads only; no target confirmation needed
 *   production-write writes on purpose to the project it is given (the daily
 *                    job, push sending, catalog publication, break-glass)
 *   test-write       writes fixtures, test drops or deletes test rows; never
 *                    meant for production
 *
 * Anything not listed is treated as a writer: an unclassified new command
 * has to be classified before it can run against a remote project.
 */
export type CommandTargetKind = "read" | "production-write" | "test-write";

export const COMMAND_TARGETS: Readonly<Record<string, CommandTargetKind>> = {
  "-h": "read",
  "--help": "read",
  help: "read",
  "dry-run": "read",
  "llm-proof": "read",
  "quality-proof": "read",
  "learning-proof": "read",
  "rss-check": "read",
  "debug-users": "read",
  "job-health": "read",
  "notification-health": "read",
  "catalog-report": "read",
  "daily-job": "production-write",
  "push-notifications": "production-write",
  "push-receipts": "production-write",
  "staging-publish": "production-write",
  "catalog-publish": "production-write",
  "catalog-repair": "production-write",
  "bootstrap-catalog": "production-write",
  "question-backfill": "production-write",
  "business-story-memory": "production-write",
  "llm-run": "test-write",
  "persist-test": "test-write",
  "cleanup-test": "test-write",
  "assign-test-users": "test-write",
  "personalize-test": "test-write",
  "daily-job-test": "test-write",
  "app-preview-test": "test-write"
};

/** Declares the project a writing command is meant for: a ref, or `local`. */
export const EXPECTED_REF_ENV = "EXPECTED_SUPABASE_REF";

/**
 * The one deliberate way to run a test/destructive command against
 * production: set this to the production ref itself, typed out.
 */
export const TEST_WRITES_TO_PRODUCTION_ENV = "PERSONEWS_TEST_WRITES_TO_PRODUCTION";

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:\d+)?(\/|$)/i;

/** The target a URL names: a project ref, `local` for a loopback stack, or null. */
export function resolveSupabaseTarget(url: string | null | undefined): string | null {
  if (url && LOOPBACK.test(url.trim())) {
    return "local";
  }

  return projectRefFromSupabaseUrl(url);
}

/**
 * Refuse to run a writing command against a project nobody confirmed.
 *
 * Returns the confirmed target, or null when the command only reads or has no
 * SUPABASE_URL at all (then nothing can be written anyway).
 */
export function assertCommandTarget(
  command: string,
  env: Record<string, string | undefined> = process.env
): { kind: CommandTargetKind; target: string | null } {
  const kind = COMMAND_TARGETS[command] ?? "production-write";
  const url = env.SUPABASE_URL?.trim();

  if (kind === "read" || !url) {
    return { kind, target: null };
  }

  const target = resolveSupabaseTarget(url);

  if (!target) {
    throw new ProjectTargetError(
      `${command}: SUPABASE_URL does not name a Supabase project or a local stack. Refusing to write.`
    );
  }

  const expected = env[EXPECTED_REF_ENV]?.trim().toLowerCase();

  if (!expected) {
    throw new ProjectTargetError(
      `${command} writes to ${target}. Confirm the target with ${EXPECTED_REF_ENV}=${target} ` +
        "(a project ref, or `local` for a loopback stack)."
    );
  }

  if (expected !== target) {
    throw new ProjectTargetError(
      `${command}: SUPABASE_URL points at ${target}, but ${EXPECTED_REF_ENV} is ${expected}. Refusing to write to the wrong project.`
    );
  }

  if (kind === "test-write" && target === PRODUCTION_PROJECT_REF) {
    if (env[TEST_WRITES_TO_PRODUCTION_ENV]?.trim().toLowerCase() !== PRODUCTION_PROJECT_REF) {
      throw new ProjectTargetError(
        `${command} is a test/destructive command and SUPABASE_URL is PRODUCTION (${PRODUCTION_PROJECT_REF}). ` +
          `Refused. If this is truly intended, set ${TEST_WRITES_TO_PRODUCTION_ENV}=${PRODUCTION_PROJECT_REF}.`
      );
    }
  }

  return { kind, target };
}
