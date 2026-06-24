import type { ContentType, DailyDropSlot, Language } from "../domain.js";
import { redactIdentifier, redactLogIdentifiers } from "../utils/redactIdentifier.js";
import {
  parseDailyJobTestOptions,
  runDailyJobTest,
  type DailyJobTestOptions,
  type DailyJobTestOutput
} from "./dailyJobTest.js";

/**
 * content:app-preview-test
 *
 * A thin, intentionally explicit wrapper around the existing, safe
 * daily-job-test pipeline. Its only job is to make "generate -> persist ->
 * assign to ONE test user -> tell me how to open it in the app" a single,
 * hard-to-misfire command.
 *
 * It deliberately reuses runDailyJobTest verbatim so it shares every existing
 * safety guard (service-role credentials required, test-marked content, no
 * production write path, idempotent upserts). It only narrows two things:
 *   - USER_LIMIT defaults to 1 and is clamped to at most 5, so a preview can
 *     never fan out to every user.
 *   - It requires its own CONFIRM_APP_PREVIEW_TEST=true confirmation on top of
 *     the daily-job-test confirmation.
 */

const DEFAULT_PREVIEW_USER_LIMIT = 1;
const MAX_PREVIEW_USER_LIMIT = 5;

export type AppPreviewTestOptions = DailyJobTestOptions;

export type AppPreviewAssignedUser = {
  userIdRedacted: string | null;
  dailyDropId: string;
  language: Language;
  items: Array<{
    slot: DailyDropSlot;
    contentType: ContentType;
    contentItemId: string;
  }>;
};

export type AppPreviewTestOutput = {
  mode: "app-preview-test";
  confirmation: "CONFIRM_APP_PREVIEW_TEST=true";
  persisted: true;
  status: DailyJobTestOutput["status"];
  runId: string;
  dropDate: string;
  languages: Language[];
  userLimit: number;
  contentStatus: DailyJobTestOutput["contentStatus"];
  appPreview: {
    ready: boolean;
    dropDate: string;
    assignedUserCount: number;
    assignedUsers: AppPreviewAssignedUser[];
    contentTypes: ContentType[];
    contentItemIds: string[];
    howToOpenInApp: string[];
    note: string;
  };
  // Full daily-job-test output for debugging. Identifiers are redacted here so
  // the clear content_item ids only live under appPreview.
  job: unknown;
};

export function parseAppPreviewTestOptions(args: string[]): AppPreviewTestOptions {
  const base = parseDailyJobTestOptions(args);
  return {
    ...base,
    userLimit: parsePreviewUserLimit(process.env.USER_LIMIT)
  };
}

export async function runAppPreviewTest(options: AppPreviewTestOptions): Promise<AppPreviewTestOutput> {
  assertAppPreviewEnvironment();

  // The app-preview confirmation has been verified above. daily-job-test guards
  // on its own CONFIRM_DAILY_JOB_TEST flag, so satisfy it here rather than asking
  // the operator to set two confirmations for one intent.
  if (process.env.CONFIRM_DAILY_JOB_TEST !== "true") {
    process.env.CONFIRM_DAILY_JOB_TEST = "true";
  }

  const result = await runDailyJobTest(options);

  const previews = result.languages.flatMap((language) => language.assignedPreviews);
  const assignedUsers: AppPreviewAssignedUser[] = previews.map((preview) => ({
    userIdRedacted: redactIdentifier(preview.userId),
    dailyDropId: preview.dailyDropId,
    language: preview.language,
    items: preview.items
  }));
  const contentTypes = Array.from(
    new Set(previews.flatMap((preview) => preview.items.map((item) => item.contentType)))
  );
  const contentItemIds = Array.from(
    new Set(previews.flatMap((preview) => preview.items.map((item) => item.contentItemId)))
  );
  const ready = assignedUsers.length > 0;

  return {
    mode: "app-preview-test",
    confirmation: "CONFIRM_APP_PREVIEW_TEST=true",
    persisted: true,
    status: result.status,
    runId: result.runId,
    dropDate: options.dropDate,
    languages: options.languages,
    userLimit: options.userLimit,
    contentStatus: result.contentStatus,
    appPreview: {
      ready,
      dropDate: options.dropDate,
      assignedUserCount: assignedUsers.length,
      assignedUsers,
      contentTypes,
      contentItemIds,
      howToOpenInApp: buildHowToOpenInApp({
        ready,
        dropDate: options.dropDate,
        languages: options.languages
      }),
      note: ready
        ? "Test content is title-prefixed [TEST daily-job-test] and tagged is_test_data:true. Remove it with content:cleanup-test when finished."
        : "No user received content. The most common cause is that no eligible test user has matching language + topic + mini-case preferences. Create/enable a test user, then rerun."
    },
    // Redact the embedded job so raw user ids never appear in clear; the clear
    // content_item ids the operator needs stay under appPreview above.
    job: redactLogIdentifiers(result)
  };
}

function buildHowToOpenInApp(input: {
  ready: boolean;
  dropDate: string;
  languages: Language[];
}): string[] {
  if (!input.ready) {
    return [
      "Nothing to open yet: no daily drop was assigned to a test user.",
      "Run SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run content:debug-users -- --language en to see why users were skipped.",
      "Enable a test user's newsletter + mini-case topic preferences, then rerun content:app-preview-test."
    ];
  }

  return [
    `Sign in to the mobile app as the assigned test user (see assignedUsers[].userIdRedacted to match it in Supabase auth).`,
    `The drop is published for drop_date ${input.dropDate} in language(s) ${input.languages.join(", ")}. Open the Today tab on that date and pull to refresh.`,
    "Items are title-prefixed [TEST daily-job-test] so the preview content is obvious in the app.",
    "If Today shows 'No edition', confirm the signed-in user matches the assigned user_id and that the app date equals the drop_date above."
  ];
}

function parsePreviewUserLimit(value: string | undefined): number {
  if (!value) {
    return DEFAULT_PREVIEW_USER_LIMIT;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("USER_LIMIT must be a positive integer.");
  }

  // A preview must never fan out widely, even if a large USER_LIMIT is passed.
  return Math.min(parsed, MAX_PREVIEW_USER_LIMIT);
}

function assertAppPreviewEnvironment(): void {
  const missing = [
    !process.env.SUPABASE_URL ? "SUPABASE_URL" : null,
    !process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : null,
    process.env.CONFIRM_APP_PREVIEW_TEST !== "true" ? "CONFIRM_APP_PREVIEW_TEST=true" : null
  ].filter((value): value is string => value !== null);

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `content:app-preview-test refused to run because the following required setting(s) are missing: ${missing.join(", ")}.`,
      "This command persists test-marked published content and assigns ONE daily drop (USER_LIMIT=1 by default, max 5) to a test user so you can see engine output in the app.",
      "To run it intentionally, set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CONFIRM_APP_PREVIEW_TEST=true.",
      "Use a local or disposable Supabase project. Never put SUPABASE_SERVICE_ROLE_KEY in apps/mobile/.env or any client-side env file.",
      "Clean up afterwards with content:cleanup-test."
    ].join(" ")
  );
}
