import type { DailyDropSlot, Language, TopicId, UserDailyDropPreference } from "../domain.js";
import { isTopicId } from "../domain.js";
import {
  ContentRepository,
  type PublishedPersistTestContentItem
} from "../storage/contentRepository.js";
import { serializePersistenceError } from "../storage/persistenceError.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";

const DEFAULT_ASSIGN_LIMIT = 5;
const requiredSlots = ["newsletter", "business_story", "mini_case", "concept"] as const;

type AssignTestUsersOptions = {
  limit: number;
  testRunId: string | null;
};

type AssignableTestContentItem = {
  contentItemId: string;
  contentType: string;
  createdAt: string;
  language: Language;
  publicationDate: string;
  slot: DailyDropSlot;
  testRunId: string;
  title: string;
  topic: TopicId | null;
};

type AssignableTestContentGroup = {
  contentItems: AssignableTestContentItem[];
  dropDate: string;
  language: Language;
  testRunId: string;
};

export type AssignTestUsersOutput = {
  mode: "assign-test-users";
  confirmation: "CONFIRM_ASSIGN_TEST=true";
  persisted: true;
  testRunId: string;
  dropDate: string;
  language: Language;
  limit: number;
  usersConsidered: number;
  usersEligible: number;
  usersAssigned: number;
  usersSkippedExistingDrop: number;
  usersSkippedIncompleteSelection: number;
  assignedDrops: Array<{
    daily_drop_id: string;
    user_id: string;
    linked_items: number;
  }>;
};

export async function runAssignTestUsers(
  options: AssignTestUsersOptions
): Promise<AssignTestUsersOutput> {
  assertAssignTestEnvironment();

  logProgress("assignment started", {
    limit: options.limit,
    test_run_id: options.testRunId
  });

  const repository = new ContentRepository(
    createServiceRoleSupabaseClient({
      requireCredentials: true
    })
  );

  const contentRows = await repository.listPublishedPersistTestContent(options.testRunId ?? undefined);
  const contentGroup = selectLatestCompleteContentGroup(contentRows, options.testRunId);

  if (!contentGroup) {
    throw new Error(
      options.testRunId
        ? `assign-test-users found no complete published persist-test content for ${options.testRunId}. Run persist-test with TEST_USER_ID or publish the test content before assigning.`
        : "assign-test-users found no complete published persist-test content. Run persist-test with TEST_USER_ID or publish a marked persist-test content set before assigning."
    );
  }

  logProgress("published test content selected", {
    test_run_id: contentGroup.testRunId,
    drop_date: contentGroup.dropDate,
    language: contentGroup.language,
    content_items: contentGroup.contentItems.length
  });

  const preferences = await repository.listUserDailyDropPreferences(contentGroup.language);
  const candidates = preferences.slice(0, Math.max(options.limit, 0));
  const existingDrops = await repository.listDailyDropsForUsersOnDate({
    userIds: candidates.map((preference) => preference.user_id),
    dropDate: contentGroup.dropDate
  });
  const assignedDrops: AssignTestUsersOutput["assignedDrops"] = [];
  let usersSkippedExistingDrop = 0;
  let usersSkippedIncompleteSelection = 0;

  for (const preference of candidates) {
    const existingDrop = existingDrops.get(preference.user_id);

    if (existingDrop) {
      usersSkippedExistingDrop += 1;
      logProgress("assignment skipped existing drop", {
        user_id: preference.user_id,
        daily_drop_id: existingDrop.id,
        status: existingDrop.status,
        drop_date: contentGroup.dropDate
      });
      continue;
    }

    const itemIds = selectTestContentForPreference(preference, contentGroup.contentItems);

    if (!hasRequiredSlots(itemIds)) {
      usersSkippedIncompleteSelection += 1;
      logProgress("assignment skipped incomplete selection", {
        user_id: preference.user_id,
        drop_date: contentGroup.dropDate,
        selected_items: itemIds.length
      });
      continue;
    }

    try {
      const assignment = await repository.createDailyDropForUserWithResult({
        userId: preference.user_id,
        dropDate: contentGroup.dropDate,
        language: contentGroup.language,
        status: "published",
        itemIds
      });

      assignedDrops.push({
        daily_drop_id: assignment.dailyDropId,
        user_id: preference.user_id,
        linked_items: assignment.linkedItems
      });

      logProgress("assignment user completed", {
        user_id: preference.user_id,
        daily_drop_id: assignment.dailyDropId,
        linked_items: assignment.linkedItems,
        stale_daily_drop_items_removed: assignment.staleItemsRemoved,
        duplicate_daily_drop_items_skipped: assignment.duplicateInputItemsSkipped
      });
    } catch (error) {
      logProgress("assignment failed", {
        user_id: preference.user_id,
        error: serializePersistenceError(error)
      });
      throw error;
    }
  }

  logProgress("assignment completed", {
    test_run_id: contentGroup.testRunId,
    users_considered: candidates.length,
    users_assigned: assignedDrops.length,
    users_skipped_existing_drop: usersSkippedExistingDrop,
    users_skipped_incomplete_selection: usersSkippedIncompleteSelection
  });

  return {
    mode: "assign-test-users",
    confirmation: "CONFIRM_ASSIGN_TEST=true",
    persisted: true,
    testRunId: contentGroup.testRunId,
    dropDate: contentGroup.dropDate,
    language: contentGroup.language,
    limit: options.limit,
    usersConsidered: candidates.length,
    usersEligible: candidates.length - usersSkippedExistingDrop,
    usersAssigned: assignedDrops.length,
    usersSkippedExistingDrop,
    usersSkippedIncompleteSelection,
    assignedDrops
  };
}

export function parseAssignTestUsersOptions(args: string[]): AssignTestUsersOptions {
  return {
    limit: readPositiveIntegerOption(args, "limit") ?? DEFAULT_ASSIGN_LIMIT,
    testRunId: readStringOption(args, "test-run-id") ?? readStringOption(args, "testRunId")
  };
}

function assertAssignTestEnvironment(): void {
  const missing = [
    process.env.SUPABASE_URL ? null : "SUPABASE_URL",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? null : "SUPABASE_SERVICE_ROLE_KEY",
    process.env.CONFIRM_ASSIGN_TEST === "true" ? null : "CONFIRM_ASSIGN_TEST=true"
  ].filter((value): value is string => value !== null);

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `assign-test-users refused to write because the following required setting(s) are missing: ${missing.join(", ")}.`,
      "This command assigns existing published persist-test content to app users from profiles with user_preferences.",
      "It never reads newsletter-only users from legacy newsletter tables.",
      "To run it intentionally, set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CONFIRM_ASSIGN_TEST=true."
    ].join(" ")
  );
}

function selectLatestCompleteContentGroup(
  rows: PublishedPersistTestContentItem[],
  requestedTestRunId: string | null
): AssignableTestContentGroup | null {
  const groups = new Map<string, AssignableTestContentGroup>();

  for (const row of rows) {
    const item = toAssignableTestContentItem(row);

    if (!item) {
      continue;
    }

    const groupKey = [item.testRunId, item.publicationDate, item.language].join("|");
    const group = groups.get(groupKey) ?? {
      contentItems: [],
      dropDate: item.publicationDate,
      language: item.language,
      testRunId: item.testRunId
    };

    group.contentItems.push(item);
    groups.set(groupKey, group);
  }

  const completeGroups = Array.from(groups.values())
    .filter((group) => {
      return (
        (!requestedTestRunId || group.testRunId === requestedTestRunId) &&
        hasRequiredSlots(
          group.contentItems.map((item) => ({
            contentItemId: item.contentItemId,
            slot: item.slot,
            position: 0
          }))
        )
      );
    })
    .sort((left, right) => {
      return latestCreatedAt(right.contentItems).localeCompare(latestCreatedAt(left.contentItems));
    });

  return completeGroups[0] ?? null;
}

function toAssignableTestContentItem(row: PublishedPersistTestContentItem): AssignableTestContentItem | null {
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const testRunId = typeof metadata.test_run_id === "string" ? metadata.test_run_id : null;
  const slot = readSlot(row, metadata);

  if (!testRunId || !slot) {
    return null;
  }

  return {
    contentItemId: row.id,
    contentType: row.content_type,
    createdAt: row.created_at,
    language: row.language,
    publicationDate: row.publication_date,
    slot,
    testRunId,
    title: row.title,
    topic: isTopicId(row.topic_id ?? "") ? row.topic_id : null
  };
}

function readSlot(
  row: PublishedPersistTestContentItem,
  metadata: Record<string, unknown>
): DailyDropSlot | null {
  if (isDailyDropSlot(metadata.slot)) {
    return metadata.slot;
  }

  if (row.content_type === "newsletter_article") {
    return "newsletter";
  }

  if (isDailyDropSlot(row.content_type)) {
    return row.content_type;
  }

  if (row.content_type === "concept") {
    return "concept";
  }

  return null;
}

function selectTestContentForPreference(
  preference: UserDailyDropPreference,
  contentItems: AssignableTestContentItem[]
): Array<{
  contentItemId: string;
  slot: DailyDropSlot;
  position: number;
}> {
  const selected: Array<{
    contentItemId: string;
    slot: DailyDropSlot;
    position: number;
  }> = [];
  const sortedTopics = [...preference.topics].sort((left, right) => (left.position ?? 99) - (right.position ?? 99));
  const topicPlan = sortedTopics.length > 0 ? sortedTopics : [{ topic_id: null, articles_count: 1 }];
  let newsletterPosition = 0;

  for (const topic of topicPlan) {
    const matches = contentItems.filter((item) => {
      return (
        item.slot === "newsletter" &&
        (topic.topic_id === null || item.topic === topic.topic_id)
      );
    });

    for (const match of matches.slice(0, topic.articles_count)) {
      if (newsletterPosition >= preference.newsletter_article_count) {
        break;
      }

      selected.push({
        contentItemId: match.contentItemId,
        slot: "newsletter",
        position: newsletterPosition
      });
      newsletterPosition += 1;
    }
  }

  addFirstSlot(selected, contentItems, "business_story");
  addFirstSlot(selected, contentItems, "mini_case");
  addFirstSlot(selected, contentItems, "concept");

  return selected;
}

function addFirstSlot(
  selected: Array<{
    contentItemId: string;
    slot: DailyDropSlot;
    position: number;
  }>,
  contentItems: AssignableTestContentItem[],
  slot: Exclude<DailyDropSlot, "newsletter">
): void {
  const match = contentItems.find((item) => item.slot === slot);

  if (!match) {
    return;
  }

  selected.push({
    contentItemId: match.contentItemId,
    slot,
    position: 0
  });
}

function hasRequiredSlots(
  itemIds: Array<{
    slot: DailyDropSlot;
  }>
): boolean {
  const slots = new Set(itemIds.map((item) => item.slot));
  return requiredSlots.every((slot) => slots.has(slot));
}

function latestCreatedAt(items: AssignableTestContentItem[]): string {
  return items.map((item) => item.createdAt).sort().at(-1) ?? "";
}

function readPositiveIntegerOption(args: string[], name: string): number | null {
  const value = readStringOption(args, name);

  if (!value) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  return parsed;
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

function isDailyDropSlot(value: unknown): value is DailyDropSlot {
  return (
    value === "newsletter" ||
    value === "business_story" ||
    value === "mini_case" ||
    value === "concept"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logProgress(message: string, details: Record<string, unknown>): void {
  process.stderr.write(`[assign-test-users] ${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
}
