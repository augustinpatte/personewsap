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

export type MiniCaseTopicId =
  | "finance_economy"
  | "stock_market"
  | "ai"
  | "law_compliance"
  | "health_pharma"
  | "engineering_operations";

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
export type LearningCurrentLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type LearningTargetLevel = 1 | 2 | 3 | 4 | 5;
export type LearningPathStatus = "active" | "archived" | "completed";
export type LearningSessionStatus =
  | "available"
  | "opened"
  | "started"
  | "completed";

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
          language: Language;
          timezone: string;
          created_at: string;
          updated_at: string;
        },
        {
          id: string;
          email: string;
          legacy_user_id?: string | null;
          language?: Language;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          legacy_user_id?: string | null;
          email?: string;
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
          newsletter_enabled: boolean;
          business_stories_enabled: boolean;
          mini_cases_enabled: boolean;
          learning_path_enabled: boolean;
          learning_path_choice_completed: boolean;
          newsletter_article_count: number;
          mini_case_topic_id: TopicId | null;
          notifications_enabled: boolean;
          email_enabled: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          user_id: string;
          goal?: GoalId;
          frequency?: PreferenceFrequency;
          newsletter_enabled?: boolean;
          business_stories_enabled?: boolean;
          mini_cases_enabled?: boolean;
          learning_path_enabled?: boolean;
          learning_path_choice_completed?: boolean;
          newsletter_article_count?: number;
          mini_case_topic_id?: TopicId | null;
          notifications_enabled?: boolean;
          email_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          user_id?: string;
          goal?: GoalId;
          frequency?: PreferenceFrequency;
          newsletter_enabled?: boolean;
          business_stories_enabled?: boolean;
          mini_cases_enabled?: boolean;
          learning_path_enabled?: boolean;
          learning_path_choice_completed?: boolean;
          newsletter_article_count?: number;
          mini_case_topic_id?: TopicId | null;
          notifications_enabled?: boolean;
          email_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      push_tokens: TableDefinition<
        {
          id: string;
          user_id: string;
          expo_push_token: string;
          platform: "ios" | "android" | "web" | "unknown";
          enabled: boolean;
          last_registered_at: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          expo_push_token: string;
          platform?: "ios" | "android" | "web" | "unknown";
          enabled?: boolean;
          last_registered_at?: string;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          expo_push_token?: string;
          platform?: "ios" | "android" | "web" | "unknown";
          enabled?: boolean;
          last_registered_at?: string;
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
      user_mini_case_topic_preferences: TableDefinition<
        {
          user_id: string;
          topic_id: MiniCaseTopicId;
          enabled: boolean;
          position: number | null;
          created_at: string;
          updated_at: string;
        },
        {
          user_id: string;
          topic_id: MiniCaseTopicId;
          enabled?: boolean;
          position?: number | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          user_id?: string;
          topic_id?: MiniCaseTopicId;
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
      sources: TableDefinition<
        {
          id: string;
          url: string;
          title: string | null;
          publisher: string | null;
          author: string | null;
          published_at: string | null;
          retrieved_at: string;
          language: Language | null;
          credibility_score: number | null;
          content_hash: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          url: string;
          title?: string | null;
          publisher?: string | null;
          author?: string | null;
          published_at?: string | null;
          retrieved_at?: string;
          language?: Language | null;
          credibility_score?: number | null;
          content_hash?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          url?: string;
          title?: string | null;
          publisher?: string | null;
          author?: string | null;
          published_at?: string | null;
          retrieved_at?: string;
          language?: Language | null;
          credibility_score?: number | null;
          content_hash?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      content_item_sources: TableDefinition<
        {
          content_item_id: string;
          source_id: string;
          claim: string | null;
          source_order: number;
          created_at: string;
        },
        {
          content_item_id: string;
          source_id: string;
          claim?: string | null;
          source_order?: number;
          created_at?: string;
        },
        {
          content_item_id?: string;
          source_id?: string;
          claim?: string | null;
          source_order?: number;
          created_at?: string;
        }
      >;
      daily_drops: TableDefinition<
        {
          id: string;
          user_id: string;
          drop_date: string;
          language: Language;
          status: DailyDropStatus;
          /** Display-only: render this edition without its calendar date. */
          hide_display_date: boolean;
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
          hide_display_date?: boolean;
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
          hide_display_date?: boolean;
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
      /**
       * Teams. Read-only for a client: every one of these is granted SELECT and
       * nothing else, except user_blocks and user_reports, which are the two
       * things a reader genuinely owns. Insert/Update shapes are `never` where
       * the client must not write, so an accidental `.insert()` is a compile
       * error rather than a runtime 42501.
       */
      logical_questions: TableDefinition<
        {
          id: string;
          content_logical_key: string;
          content_type: string;
          question_sequence: number;
          question_role: string | null;
          time_limit_seconds: number;
        },
        never,
        never
      >;
      team_question_assignments: TableDefinition<
        {
          id: string;
          team_id: string;
          edition_date: string;
          logical_question_id: string;
          content_type: string;
          position: number;
        },
        never,
        never
      >;
      /**
       * What a Team is reading this edition. Keyed on the LOGICAL content, not
       * on a content_items row: the FR and EN renderings of one article are one
       * assignment, and the language is resolved when it is displayed.
       *
       * Prefer the `get_my_team_edition_content` RPC over reading this table —
       * it resolves the rendering, deduplicates content two Teams both assigned,
       * and returns the Team names in one round trip.
       */
      team_content_assignments: TableDefinition<
        {
          id: string;
          team_id: string;
          edition_date: string;
          content_logical_key: string;
          content_type: string;
          topic_id: string | null;
          product_topic: string | null;
          position: number;
        },
        never,
        never
      >;
      /**
       * The member-safe projection of `public.teams`.
       *
       * The table itself is NOT readable by a client: it carries the invite
       * code, the owner id and the raw name, and row-level security cannot hide
       * a column. `display_name` is already resolved through moderation — null
       * when hidden — so a screen cannot forget to check `name_status`.
       */
      team_directory: TableDefinition<
        {
          id: string;
          display_name: string | null;
          name_status: string;
          status: string;
          archived_at: string | null;
          is_owner: boolean;
          invite_open: boolean;
          created_at: string;
          updated_at: string;
        },
        never,
        never
      >;
      team_members: TableDefinition<
        {
          id: string;
          team_id: string;
          user_id: string;
          role: string;
          joined_at: string;
          left_at: string | null;
          eligible_from_edition: string;
        },
        never,
        never
      >;
      team_member_edition_scores: TableDefinition<
        {
          team_id: string;
          user_id: string;
          edition_date: string;
          score_milli: number;
          answered_count: number;
          assigned_count: number;
          completed: boolean;
          updated_at: string;
        },
        never,
        never
      >;
      user_blocks: TableDefinition<
        { blocker_id: string; blocked_id: string; created_at: string },
        { blocker_id: string; blocked_id: string },
        never
      >;
      user_reports: TableDefinition<
        {
          id: string;
          reporter_id: string;
          reported_user_id: string | null;
          team_id: string | null;
          reason: string;
          details: string | null;
          status: string;
          created_at: string;
        },
        {
          reporter_id: string;
          reported_user_id?: string | null;
          team_id?: string | null;
          reason: string;
          details?: string | null;
        },
        // No update: a reporter cannot reopen or reclassify their own report.
        never
      >;
      mini_case_responses: TableDefinition<
        {
          id: string;
          user_id: string;
          content_item_id: string;
          answer_md: string;
          ai_feedback_md: string | null;
          score: number | null;
          score_max: number | null;
          selections: Record<string, string> | null;
          completed_at: string | null;
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
          score_max?: number | null;
          selections?: Record<string, string> | null;
          completed_at?: string | null;
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
          score_max?: number | null;
          selections?: Record<string, string> | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      learning_domains: TableDefinition<
        {
          id: string;
          slug: string;
          label_fr: string;
          label_en: string;
          description_fr: string;
          description_en: string;
          position: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          slug: string;
          label_fr: string;
          label_en: string;
          description_fr: string;
          description_en: string;
          position?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          slug?: string;
          label_fr?: string;
          label_en?: string;
          description_fr?: string;
          description_en?: string;
          position?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      learning_objectives: TableDefinition<
        {
          id: string;
          domain_id: string;
          slug: string;
          label_fr: string;
          label_en: string;
          description_fr: string;
          description_en: string;
          position: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          domain_id: string;
          slug: string;
          label_fr: string;
          label_en: string;
          description_fr: string;
          description_en: string;
          position?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          domain_id?: string;
          slug?: string;
          label_fr?: string;
          label_en?: string;
          description_fr?: string;
          description_en?: string;
          position?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      user_learning_paths: TableDefinition<
        {
          id: string;
          user_id: string;
          domain_id: string;
          objective_id: string;
          current_level: LearningCurrentLevel;
          target_level: LearningTargetLevel;
          language: Language;
          status: LearningPathStatus;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
          completed_at: string | null;
        },
        {
          id?: string;
          user_id: string;
          domain_id: string;
          objective_id: string;
          current_level: LearningCurrentLevel;
          target_level: LearningTargetLevel;
          language?: Language;
          status?: LearningPathStatus;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
          completed_at?: string | null;
        },
        {
          id?: string;
          user_id?: string;
          domain_id?: string;
          objective_id?: string;
          current_level?: LearningCurrentLevel;
          target_level?: LearningTargetLevel;
          language?: Language;
          status?: LearningPathStatus;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
          completed_at?: string | null;
        }
      >;
      learning_sessions: TableDefinition<
        {
          id: string;
          path_id: string;
          daily_drop_id: string | null;
          curriculum_step_key: string;
          skipped_step_key: string | null;
          session_number: number;
          adaptation_mode: "normal" | "reinforce" | "accelerate" | "context_shift" | "prerequisite";
          language: Language;
          title_fr: string;
          title_en: string;
          summary_fr: string;
          summary_en: string;
          objectives_fr: string[];
          objectives_en: string[];
          prompt_text: string;
          generation_status: "queued" | "generating" | "ready" | "failed";
          status: LearningSessionStatus;
          available_on: string | null;
          opened_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          path_id: string;
          daily_drop_id?: string | null;
          curriculum_step_key: string;
          skipped_step_key?: string | null;
          session_number: number;
          adaptation_mode?: "normal" | "reinforce" | "accelerate" | "context_shift" | "prerequisite";
          language?: Language;
          title_fr: string;
          title_en: string;
          summary_fr: string;
          summary_en: string;
          objectives_fr?: string[];
          objectives_en?: string[];
          prompt_text: string;
          generation_status?: "queued" | "generating" | "ready" | "failed";
          status?: LearningSessionStatus;
          available_on?: string | null;
          opened_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          path_id?: string;
          daily_drop_id?: string | null;
          curriculum_step_key?: string;
          skipped_step_key?: string | null;
          session_number?: number;
          adaptation_mode?: "normal" | "reinforce" | "accelerate" | "context_shift" | "prerequisite";
          language?: Language;
          title_fr?: string;
          title_en?: string;
          summary_fr?: string;
          summary_en?: string;
          objectives_fr?: string[];
          objectives_en?: string[];
          prompt_text?: string;
          generation_status?: "queued" | "generating" | "ready" | "failed";
          status?: LearningSessionStatus;
          available_on?: string | null;
          opened_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      learning_session_feedback: TableDefinition<
        {
          id: string;
          session_id: string;
          user_id: string;
          comprehension_rating: number;
          explainability_rating: number;
          interest_rating: number;
          difficulty_rating: number;
          created_at: string;
        },
        {
          id?: string;
          session_id: string;
          user_id: string;
          comprehension_rating: number;
          explainability_rating: number;
          interest_rating: number;
          difficulty_rating: number;
          created_at?: string;
        },
        {
          id?: string;
          session_id?: string;
          user_id?: string;
          comprehension_rating?: number;
          explainability_rating?: number;
          interest_rating?: number;
          difficulty_rating?: number;
          created_at?: string;
        }
      >;
      learning_catalog_domains: TableDefinition<
        {
          domain_id: string;
          version: string;
          payload: unknown;
          created_at: string;
          updated_at: string;
        },
        {
          domain_id: string;
          version: string;
          payload: unknown;
          created_at?: string;
          updated_at?: string;
        },
        {
          domain_id?: string;
          version?: string;
          payload?: unknown;
          created_at?: string;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      /**
       * Scored questions. The client sends a question id, then an option id —
       * and nothing else. There is deliberately no score, no timestamp and no
       * duration in any of these signatures: the deadline and the grade are
       * decided by Postgres, and a client that could send either would be able
       * to decide its own result.
       */
      /**
       * Teams. Every one of these is server-authoritative: the client sends a
       * name, a code or an id, and the server decides the invite code, the
       * eligibility date, the version number and the rank. There is no argument
       * here through which a score or a standing could be set.
       */
      set_player_identity: {
        Args: {
          p_username: string | null;
          p_country_code: string | null;
          p_avatar_path: string | null;
        };
        Returns: {
          id: string;
          username: string | null;
          country_code: string | null;
          avatar_path: string | null;
        } | null;
      };
      is_username_available: {
        Args: { p_username: string };
        Returns: boolean | null;
      };
      create_team: {
        Args: { p_name: string };
        Returns: {
          team_id: string;
          name: string;
          invite_code: string;
          config_version_id: string;
          effective_from_edition: string;
        } | null;
      };
      join_team_with_invite: {
        Args: { p_invite_code: string };
        Returns: {
          team_id: string;
          name: string;
          role: string;
          eligible_from_edition: string;
          already_member: boolean;
        } | null;
      };
      leave_team: {
        Args: { p_team_id: string };
        Returns: { team_id: string; departed_at: string } | null;
      };
      rename_team: {
        Args: { p_team_id: string; p_name: string };
        Returns: string | null;
      };
      rotate_team_invite_code: {
        Args: { p_team_id: string };
        Returns: string | null;
      };
      /** Owner-only: the single route to the invite code. */
      get_team_invite_code: {
        Args: { p_team_id: string };
        Returns: {
          invite_code: string;
          rotated_at: string | null;
          invite_open: boolean;
        } | null;
      };
      /** Owner-only: close or reopen the invite without rotating it. */
      set_team_invite_open: {
        Args: { p_team_id: string; p_open: boolean };
        Returns: boolean | null;
      };
      get_team_detail: {
        Args: { p_team_id: string };
        Returns: {
          team_id: string;
          display_name: string | null;
          name_hidden: boolean;
          team_status: string;
          is_owner: boolean;
          member_count: number;
          my_role: string;
          my_eligible_from_edition: string;
          invite_open: boolean;
        } | null;
      };
      /** Team badges for an edition's questions, already moderated. */
      get_my_team_refs_for_questions: {
        Args: { p_edition_date: string; p_logical_question_ids: string[] };
        Returns: Array<{
          logical_question_id: string;
          team_id: string;
          display_name: string | null;
        }> | null;
      };
      update_team_config: {
        Args: {
          p_team_id: string;
          p_newsletter_topics: unknown;
          p_mini_case_topics: string[];
        };
        Returns: {
          config_version_id: string;
          version: number;
          effective_from_edition: string;
        } | null;
      };
      /**
       * The caller's Team content for an edition, one row per logical content.
       *
       * `teams` carries every Team that assigned it, so an article both Teams
       * chose arrives once with two badges rather than twice. The language comes
       * from the profile; passing `p_language` only overrides it with 'fr' or
       * 'en' and is validated server-side.
       */
      get_my_team_edition_content: {
        Args: { p_edition_date?: string | null; p_language?: string | null };
        Returns: Array<{
          content_logical_key: string;
          content_type: string;
          display_content_item_id: string;
          display_language: string;
          topic_id: string | null;
          product_topic: string | null;
          title: string;
          summary: string | null;
          edition_date: string;
          assignment_position: number;
          teams: Array<{ id: string; name: string | null }>;
        }> | null;
      };
      get_team_roster: {
        Args: { p_team_id: string };
        Returns: Array<{
          user_id: string;
          username: string | null;
          country_code: string | null;
          avatar_path: string | null;
          role: string;
          joined_at: string;
          eligible_from_edition: string;
        }> | null;
      };
      get_team_leaderboard: {
        Args: { p_team_id: string; p_scope: string; p_edition_date: string | null };
        Returns: Array<{
          user_id: string;
          username: string | null;
          country_code: string | null;
          avatar_path: string | null;
          /** Ties share a rank (dense_rank): two on 1800 are both 2nd. */
          rank: number;
          score_milli: number;
          answered_count: number;
          assigned_count: number;
          editions_completed: number;
          /**
           * Why this row is where it is. Every active member appears, so a zero
           * needs to say which kind of zero it is.
           */
          status: "not_started" | "in_progress" | "completed" | "starts_next_edition";
        }> | null;
      };
      team_member_edition_streak: {
        Args: { p_team_id: string; p_user_id: string };
        Returns: number | null;
      };
      current_edition_date: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      start_question_attempt: {
        Args: { p_logical_question_id: string };
        Returns: {
          attempt_id: string;
          server_now: string;
          started_at: string;
          deadline_at: string;
          time_limit_seconds: number;
          already_submitted: boolean;
          language: string;
          prompt: string | null;
          question_role: string | null;
          question_sequence: number;
          /** [{ option_id, label }] in the attempt's fixed order. Never a score. */
          options: unknown;
        } | null;
      };
      submit_question_answer: {
        /** A null option is an explicit skip, worth zero. */
        Args: { p_attempt_id: string; p_selected_option_id: string | null };
        Returns: {
          attempt_id: string;
          submitted_at: string;
          server_now: string;
          expired: boolean;
          skipped: boolean;
          score_milli: number;
          grade_band: string;
          selected_option_id: string | null;
          teams_scored: number;
        } | null;
      };
      get_question_feedback: {
        /** Refused unless the caller has already submitted: before that it is the answer key. */
        Args: { p_logical_question_id: string };
        Returns:
          | Array<{
              option_id: string;
              is_selected: boolean;
              score_milli: number;
              grade_band: string;
              feedback_md: string | null;
            }>
          | null;
      };
      start_learning_path: {
        Args: {
          p_domain_id: string;
          p_objective_id: string;
          p_current_level: LearningCurrentLevel;
          p_target_level: LearningTargetLevel;
        };
        Returns: string | null;
      };
      disable_learning_path: {
        Args: Record<string, never>;
        Returns: boolean | null;
      };
      learning_paths_healthcheck: {
        Args: Record<string, never>;
        Returns: Json;
      };
      update_profile_language: {
        Args: {
          p_language: Language;
        };
        Returns: {
          id: string;
          language: Language;
          updated_at: string;
        } | null;
      };
      open_learning_session: {
        Args: {
          p_session_id: string;
        };
        Returns: {
          id: string;
          path_id: string;
          session_number: number;
          language: Language;
          title_fr: string;
          title_en: string;
          summary_fr: string;
          summary_en: string;
          objectives_fr: string[];
          objectives_en: string[];
          prompt_text: string;
          status: LearningSessionStatus;
          available_on: string | null;
          opened_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        } | null;
      };
      start_learning_session: {
        Args: {
          p_session_id: string;
        };
        Returns: {
          id: string;
          path_id: string;
          session_number: number;
          language: Language;
          title_fr: string;
          title_en: string;
          summary_fr: string;
          summary_en: string;
          objectives_fr: string[];
          objectives_en: string[];
          prompt_text: string;
          status: LearningSessionStatus;
          available_on: string | null;
          opened_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        } | null;
      };
      create_next_learning_session: {
        Args: {
          p_curriculum_step_key: string;
          p_skipped_step_key: string | null;
          p_adaptation_mode: string;
          p_title_fr: string;
          p_title_en: string;
          p_summary_fr: string;
          p_summary_en: string;
          p_objectives_fr: string[];
          p_objectives_en: string[];
          p_prompt_text: string;
        };
        Returns: {
          id: string;
          path_id: string;
          daily_drop_id: string | null;
          curriculum_step_key: string;
          skipped_step_key: string | null;
          session_number: number;
          adaptation_mode: "normal" | "reinforce" | "accelerate" | "context_shift" | "prerequisite";
          language: Language;
          title_fr: string;
          title_en: string;
          summary_fr: string;
          summary_en: string;
          objectives_fr: string[];
          objectives_en: string[];
          prompt_text: string;
          generation_status: "queued" | "generating" | "ready" | "failed";
          status: LearningSessionStatus;
          available_on: string | null;
          opened_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        } | null;
      };
      submit_learning_session_feedback: {
        Args: {
          p_session_id: string;
          p_comprehension_rating: number;
          p_explainability_rating: number;
          p_interest_rating: number;
          p_difficulty_rating: number;
        };
        Returns: boolean | null;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
