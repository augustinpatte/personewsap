import type {
  ContentDifficulty,
  ContentRating,
  ContentStatus,
  ContentType,
  DailyDropSlot,
  DailyDropStatus,
  Database,
  GoalId,
  InteractionType,
  Language,
  PreferenceFrequency,
  TopicId
} from "./database";

type PublicTableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

export type {
  ContentDifficulty,
  ContentRating,
  ContentStatus,
  ContentType,
  DailyDropSlot,
  DailyDropStatus,
  GoalId,
  InteractionType,
  Language,
  PreferenceFrequency,
  TopicId
};

export type Profile = PublicTableRow<"profiles">;
export type UserPreferences = PublicTableRow<"user_preferences">;
export type Topic = PublicTableRow<"topics">;
export type UserTopicPreference = PublicTableRow<"user_topic_preferences">;
export type ContentItem = PublicTableRow<"content_items">;
export type Source = PublicTableRow<"sources">;
export type ContentItemSource = PublicTableRow<"content_item_sources">;
export type DailyDrop = PublicTableRow<"daily_drops">;
export type DailyDropItem = PublicTableRow<"daily_drop_items">;
export type ContentInteraction = PublicTableRow<"content_interactions">;
export type MiniCaseResponse = PublicTableRow<"mini_case_responses">;

export type DailyDropWithItems = DailyDrop & {
  items: Array<
    DailyDropItem & {
      contentItem: ContentItem;
    }
  >;
};
