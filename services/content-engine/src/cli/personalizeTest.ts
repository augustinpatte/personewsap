import type { DailyDropSlot, Language, TopicId, UserDailyDropPreference } from "../domain.js";
import { isTopicId } from "../domain.js";
import {
  ContentRepository,
  type PublishedContentItem
} from "../storage/contentRepository.js";
import { serializePersistenceError } from "../storage/persistenceError.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";
import { toDateOnly } from "../utils/date.js";

const DEFAULT_PERSONALIZE_LIMIT = 3;
const REQUIRED_SLOTS = ["newsletter", "business_story", "mini_case", "concept"] as const;

type PersonalizeTestOptions = {
  dropDate: string;
  limit: number;
};

type AssignablePublishedContentItem = {
  contentItemId: string;
  contentType: string;
  createdAt: string;
  language: Language;
  publicationDate: string;
  slot: DailyDropSlot;
  title: string;
  topic: TopicId | null;
};

export type PersonalizeTestOutput = {
  mode: "personalize-test";
  confirmation: "CONFIRM_PERSONALIZE_TEST=true";
  persisted: true;
  dropDate: string;
  limit: number;
  usersRead: number;
  usersSelected: number;
  assignedDropCount: number;
  skippedUserCount: number;
  skippedUsers: Array<{
    user_id: string;
    reason: string;
  }>;
  assignedDrops: Array<{
    daily_drop_id: string;
    user_id: string;
    language: Language;
    linked_items: number;
  }>;
};

export async function runPersonalizeTest(options: PersonalizeTestOptions): Promise<PersonalizeTestOutput> {
  assertPersonalizeTestEnvironment();

  logProgress("personalize-test started", {
    drop_date: options.dropDate,
    limit: options.limit
  });

  const repository = new ContentRepository(
    createServiceRoleSupabaseClient({
      requireCredentials: true
    })
  );

  const allPreferences = [
    ...(await repository.listUserDailyDropPreferences("en")),
    ...(await repository.listUserDailyDropPreferences("fr"))
  ];
  const appUserPreferences = allPreferences.filter((preference) => preference.topics.length > 0);
  const selectedPreferences = appUserPreferences.slice(0, options.limit);
  const languages = [...new Set(selectedPreferences.map((preference) => preference.language))];
  const contentRows = await repository.listPublishedContentItems({
    languages,
    publicationDateLte: options.dropDate
  });
  const contentItems = contentRows.flatMap(toAssignablePublishedContentItem);
  const existingDrops = await repository.listDailyDropsForUsersOnDate({
    userIds: selectedPreferences.map((preference) => preference.user_id),
    dropDate: options.dropDate
  });
  const skippedUsers: PersonalizeTestOutput["skippedUsers"] = [];
  const assignedDrops: PersonalizeTestOutput["assignedDrops"] = [];

  logProgress("users and content loaded", {
    users_read: allPreferences.length,
    app_users_with_topics: appUserPreferences.length,
    selected_users: selectedPreferences.length,
    published_content_items: contentItems.length
  });

  for (const preference of selectedPreferences) {
    if (existingDrops.has(preference.user_id)) {
      skippedUsers.push({
        user_id: preference.user_id,
        reason: "daily drop already exists for date"
      });
      continue;
    }

    const itemIds = selectPublishedContentForPreference(preference, contentItems);

    if (!hasRequiredSlots(itemIds)) {
      skippedUsers.push({
        user_id: preference.user_id,
        reason: "not enough published content for selected language/topics"
      });
      continue;
    }

    try {
      const dailyDropId = await repository.createDailyDropForUser({
        userId: preference.user_id,
        dropDate: options.dropDate,
        language: preference.language,
        status: "published",
        itemIds
      });

      assignedDrops.push({
        daily_drop_id: dailyDropId,
        user_id: preference.user_id,
        language: preference.language,
        linked_items: itemIds.length
      });
    } catch (error) {
      logProgress("assignment failed", {
        user_id: preference.user_id,
        error: serializePersistenceError(error)
      });
      throw error;
    }
  }

  logProgress("personalize-test completed", {
    users_read: allPreferences.length,
    selected_users: selectedPreferences.length,
    assigned_drop_count: assignedDrops.length,
    skipped_user_count: skippedUsers.length,
    skipped_users: skippedUsers
  });

  return {
    mode: "personalize-test",
    confirmation: "CONFIRM_PERSONALIZE_TEST=true",
    persisted: true,
    dropDate: options.dropDate,
    limit: options.limit,
    usersRead: allPreferences.length,
    usersSelected: selectedPreferences.length,
    assignedDropCount: assignedDrops.length,
    skippedUserCount: skippedUsers.length,
    skippedUsers,
    assignedDrops
  };
}

export function parsePersonalizeTestOptions(args: string[]): PersonalizeTestOptions {
  return {
    dropDate: readStringOption(args, "date") ?? toDateOnly(new Date()),
    limit: readPositiveIntegerOption(args, "limit") ?? DEFAULT_PERSONALIZE_LIMIT
  };
}

function assertPersonalizeTestEnvironment(): void {
  const missing = [
    process.env.SUPABASE_URL ? null : "SUPABASE_URL",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? null : "SUPABASE_SERVICE_ROLE_KEY",
    process.env.CONFIRM_PERSONALIZE_TEST === "true" ? null : "CONFIRM_PERSONALIZE_TEST=true"
  ].filter((value): value is string => value !== null);

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `personalize-test refused to write because the following required setting(s) are missing: ${missing.join(", ")}.`,
      "This command assigns already-published content to app users from profiles, user_preferences, and user_topic_preferences.",
      "It never reads newsletter-only users from legacy newsletter tables.",
      "To run it intentionally, set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CONFIRM_PERSONALIZE_TEST=true."
    ].join(" ")
  );
}

function toAssignablePublishedContentItem(row: PublishedContentItem): AssignablePublishedContentItem[] {
  const slot = readSlot(row);

  if (!slot) {
    return [];
  }

  return [
    {
      contentItemId: row.id,
      contentType: row.content_type,
      createdAt: row.created_at,
      language: row.language,
      publicationDate: row.publication_date,
      slot,
      title: row.title,
      topic: isTopicId(row.topic_id ?? "") ? row.topic_id : null
    }
  ];
}

function readSlot(row: PublishedContentItem): DailyDropSlot | null {
  const metadata = isRecord(row.metadata) ? row.metadata : {};

  if (isDailyDropSlot(metadata.slot)) {
    return metadata.slot;
  }

  if (row.content_type === "newsletter_article") {
    return "newsletter";
  }

  if (row.content_type === "business_story" || row.content_type === "mini_case" || row.content_type === "concept") {
    return row.content_type;
  }

  return null;
}

function selectPublishedContentForPreference(
  preference: UserDailyDropPreference,
  contentItems: AssignablePublishedContentItem[]
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
  const matchingLanguageItems = contentItems.filter((item) => item.language === preference.language);
  const sortedTopics = [...preference.topics].sort((left, right) => (left.position ?? 99) - (right.position ?? 99));
  let newsletterPosition = 0;

  for (const topic of sortedTopics) {
    const matches = matchingLanguageItems.filter((item) => {
      return item.slot === "newsletter" && item.topic === topic.topic_id;
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

  addFirstSlot(selected, matchingLanguageItems, "business_story", sortedTopics);
  addFirstSlot(selected, matchingLanguageItems, "mini_case", sortedTopics);
  addFirstSlot(selected, matchingLanguageItems, "concept", sortedTopics);

  return selected;
}

function addFirstSlot(
  selected: Array<{
    contentItemId: string;
    slot: DailyDropSlot;
    position: number;
  }>,
  contentItems: AssignablePublishedContentItem[],
  slot: Exclude<DailyDropSlot, "newsletter">,
  topicPreferences: UserDailyDropPreference["topics"]
): void {
  const preferredTopics = new Set(topicPreferences.map((topic) => topic.topic_id));
  const preferredMatch = contentItems.find((item) => item.slot === slot && item.topic && preferredTopics.has(item.topic));
  const fallbackMatch = contentItems.find((item) => item.slot === slot);
  const match = preferredMatch ?? fallbackMatch;

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
  return REQUIRED_SLOTS.every((slot) => slots.has(slot));
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
  process.stderr.write(`[personalize-test] ${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
}
