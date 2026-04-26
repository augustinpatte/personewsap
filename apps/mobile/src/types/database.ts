export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Language = "fr" | "en";

export type TopicId =
  | "business"
  | "finance"
  | "tech_ai"
  | "law"
  | "medicine"
  | "engineering"
  | "sport_business"
  | "culture_media";

export type GoalId =
  | "understand_world"
  | "prepare_career"
  | "learn_business"
  | "explore_stem"
  | "become_sharper_daily";

export type PreferenceFrequency = "daily" | "weekdays" | "weekly";

export type ContentType =
  | "newsletter_article"
  | "business_story"
  | "mini_case"
  | "concept"
  | "quick_quiz";

export type ContentDifficulty = "easy" | "medium" | "hard";
export type ContentStatus = "draft" | "review" | "published" | "archived";
export type DailyDropStatus = "generated" | "published" | "read" | "archived";
export type DailyDropSlot = "newsletter" | "business_story" | "mini_case" | "concept";
export type InteractionType = "view" | "complete" | "save" | "share" | "feedback";
export type ContentRating = "good" | "average" | "bad";

type TableDefinition<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: TableDefinition<
        {
          id: string;
          legacy_user_id: string | null;
          email: string;
          first_name: string | null;
          last_name: string | null;
          birth_year: number | null;
          language: Language;
          timezone: string;
          created_at: string;
          updated_at: string;
        },
        {
          id: string;
          email: string;
          legacy_user_id?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          birth_year?: number | null;
          language?: Language;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          legacy_user_id?: string | null;
          email?: string;
          first_name?: string | null;
          last_name?: string | null;
          birth_year?: number | null;
          language?: Language;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      user_preferences: TableDefinition<
        {
          user_id: string;
          goal: GoalId;
          frequency: PreferenceFrequency;
          newsletter_article_count: number;
          notifications_enabled: boolean;
          email_enabled: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          user_id: string;
          goal?: GoalId;
          frequency?: PreferenceFrequency;
          newsletter_article_count?: number;
          notifications_enabled?: boolean;
          email_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          user_id?: string;
          goal?: GoalId;
          frequency?: PreferenceFrequency;
          newsletter_article_count?: number;
          notifications_enabled?: boolean;
          email_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      topics: TableDefinition<
        {
          id: TopicId;
          position: number;
          label_fr: string;
          label_en: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id: TopicId;
          position: number;
          label_fr: string;
          label_en: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: TopicId;
          position?: number;
          label_fr?: string;
          label_en?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      user_topic_preferences: TableDefinition<
        {
          user_id: string;
          topic_id: TopicId;
          articles_count: number;
          enabled: boolean;
          position: number | null;
          created_at: string;
          updated_at: string;
        },
        {
          user_id: string;
          topic_id: TopicId;
          articles_count?: number;
          enabled?: boolean;
          position?: number | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          user_id?: string;
          topic_id?: TopicId;
          articles_count?: number;
          enabled?: boolean;
          position?: number | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      content_items: TableDefinition<
        {
          id: string;
          content_type: ContentType;
          topic_id: TopicId | null;
          language: Language;
          title: string;
          summary: string | null;
          body_md: string;
          difficulty: ContentDifficulty | null;
          estimated_read_seconds: number | null;
          publication_date: string;
          version: number;
          status: ContentStatus;
          generation_run_id: string | null;
          source_count: number;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          content_type: ContentType;
          topic_id?: TopicId | null;
          language: Language;
          title: string;
          summary?: string | null;
          body_md: string;
          difficulty?: ContentDifficulty | null;
          estimated_read_seconds?: number | null;
          publication_date: string;
          version?: number;
          status?: ContentStatus;
          generation_run_id?: string | null;
          source_count?: number;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          content_type?: ContentType;
          topic_id?: TopicId | null;
          language?: Language;
          title?: string;
          summary?: string | null;
          body_md?: string;
          difficulty?: ContentDifficulty | null;
          estimated_read_seconds?: number | null;
          publication_date?: string;
          version?: number;
          status?: ContentStatus;
          generation_run_id?: string | null;
          source_count?: number;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      daily_drops: TableDefinition<
        {
          id: string;
          user_id: string;
          drop_date: string;
          language: Language;
          status: DailyDropStatus;
          generated_at: string;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          drop_date: string;
          language: Language;
          status?: DailyDropStatus;
          generated_at?: string;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          drop_date?: string;
          language?: Language;
          status?: DailyDropStatus;
          generated_at?: string;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      daily_drop_items: TableDefinition<
        {
          daily_drop_id: string;
          content_item_id: string;
          slot: DailyDropSlot;
          position: number;
          created_at: string;
        },
        {
          daily_drop_id: string;
          content_item_id: string;
          slot: DailyDropSlot;
          position?: number;
          created_at?: string;
        },
        {
          daily_drop_id?: string;
          content_item_id?: string;
          slot?: DailyDropSlot;
          position?: number;
          created_at?: string;
        }
      >;
      content_interactions: TableDefinition<
        {
          id: string;
          user_id: string;
          content_item_id: string;
          interaction_type: InteractionType;
          rating: ContentRating | null;
          message: string | null;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          content_item_id: string;
          interaction_type: InteractionType;
          rating?: ContentRating | null;
          message?: string | null;
          created_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          content_item_id?: string;
          interaction_type?: InteractionType;
          rating?: ContentRating | null;
          message?: string | null;
          created_at?: string;
        }
      >;
      mini_case_responses: TableDefinition<
        {
          id: string;
          user_id: string;
          content_item_id: string;
          answer_md: string;
          ai_feedback_md: string | null;
          score: number | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          content_item_id: string;
          answer_md: string;
          ai_feedback_md?: string | null;
          score?: number | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          content_item_id?: string;
          answer_md?: string;
          ai_feedback_md?: string | null;
          score?: number | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
