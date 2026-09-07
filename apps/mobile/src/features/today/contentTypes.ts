import type { TopicId } from "../../constants/product";

export type ContentLanguage = "fr" | "en";

export type ContentType =
  | "newsletter_article"
  | "business_story"
  | "mini_case"
  | "key_concept";

export type DailyDropSlot =
  | "newsletter"
  | "business_story"
  | "mini_case"
  | "concept";

export type ContentDifficulty = "intro" | "intermediate" | "advanced";

export type SourceMetadata = {
  id: string;
  url: string;
  // Nullable because the stored columns are: `public.sources.title` and
  // `.publisher` both allow NULL, and some cited records have no title. Neither
  // is ever stood in for — the reading experience shows less rather than
  // something the source never said.
  title: string | null;
  publisher: string | null;
  author: string | null;
  published_at: string | null;
  retrieved_at: string;
  language: ContentLanguage | "multi";
  content_hash: string;
};

/** A question this item carries, by its language-independent id. */
export type LogicalQuestionRef = {
  logical_question_id: string;
  /** 1-based, in the order the reader answers them. */
  question_sequence: number;
  question_role: string | null;
};

/** A Team this item reached the reader through. */
export type ContentTeamRef = {
  id: string;
  /** Null when moderation has hidden the name. */
  name: string | null;
};

type BaseContentItem = {
  id: string;
  content_type: ContentType;
  language: ContentLanguage;
  title: string;
  slot: DailyDropSlot;
  source_ids: string[];
  sources?: SourceMetadata[];
  version: number;
  /**
   * The identity the FR and EN renderings of one editorial job share.
   *
   * This is what deduplication is done on, never the row id: a reader whose own
   * edition holds the English rendering while their Team was assigned the
   * French one must see ONE article. Absent on content that predates the key,
   * and an item with no key is only ever itself.
   */
  content_logical_key?: string | null;
  /**
   * The other renderings of this same logical content, by row id.
   *
   * Only populated for Team content, which has no daily_drop_items row to pin
   * an id to — so the id can change under a language switch. Carrying the
   * siblings is what lets "read" survive one: completion is looked up across
   * all of them, and written to the one on screen.
   */
  translation_ids?: string[];
  /**
   * The scored questions attached to this item, or absent for the ~2 months of
   * approved content that predates them. Absent and empty mean the same thing
   * to every reader: no quiz, original behaviour.
   */
  logical_questions?: LogicalQuestionRef[];
  /**
   * The Teams that were assigned this content for the current edition. Empty
   * for a purely personal item.
   */
  teams?: ContentTeamRef[];
  /**
   * Where this item sits in the edition it was ordered by — the Team's own
   * position when a Team assigned it, the personal edition's otherwise. Read
   * by the Team-first merge and by nothing that renders.
   */
  assignment_position?: number;
};

export type NewsletterArticle = BaseContentItem & {
  content_type: "newsletter_article";
  slot: "newsletter";
  topic: TopicId;
  published_date: string;
  summary: string;
  body_md: string;
  why_it_matters: string;
};

export type BusinessStory = BaseContentItem & {
  content_type: "business_story";
  slot: "business_story";
  company_or_market: string;
  story_date: string;
  setup: string;
  tension: string;
  decision: string;
  outcome: string;
  lesson: string;
};

export type MiniCaseOptionOutcome = "best" | "viable" | "weak";

export type MiniCaseOption = {
  id: string;
  label: string;
  outcome: MiniCaseOptionOutcome;
  feedback: string;
};

export type MiniCaseQuestionRole = "method" | "application" | "conclusion";

export type MiniCaseQuestion = {
  id: string;
  role?: MiniCaseQuestionRole;
  prompt: string;
  options: MiniCaseOption[];
  explanation?: string;
};

export type MiniCaseChallenge = BaseContentItem & {
  content_type: "mini_case";
  slot: "mini_case";
  topic: TopicId;
  difficulty: ContentDifficulty;
  context: string;
  challenge: string;
  constraints: string[];
  question: string;
  options?: MiniCaseOption[];
  questions?: MiniCaseQuestion[];
  expected_reasoning: string[];
  sample_answer: string;
  final_takeaway?: string;
  // Max achievable score (engine sets this to the number of questions, i.e. 3).
  // Optional so legacy/mock single-question cases still type-check.
  score_max?: number;
  surprise_fact?: string;
};

export type KeyConcept = BaseContentItem & {
  content_type: "key_concept";
  slot: "concept";
  category: TopicId | "career";
  definition: string;
  plain_english: string;
  example: string;
  why_it_matters: string;
  how_to_use_it: string;
  common_mistake: string;
};

export type DailyDropContentItem =
  | NewsletterArticle
  | BusinessStory
  | MiniCaseChallenge
  | KeyConcept;

export type TodayDailyDrop = {
  id: string;
  drop_date: string;
  /**
   * Display-only: hide this edition's calendar date. Prelaunch seeded editions
   * set it; everything internal still runs on drop_date.
   */
  hide_display_date: boolean;
  language: ContentLanguage;
  title: string;
  prompt_version: string;
  generator_version: string;
  estimated_read_minutes: number;
  items: {
    newsletter: NewsletterArticle[];
    business_story?: BusinessStory;
    /**
     * Every mini case in this edition, Team-assigned first.
     *
     * PLURAL BECAUSE A READER'S EDITION IS PLURAL. One reader can be handed a
     * Finance case by one Team, an AI case by another, and their own Law case
     * the same morning. The old singular field could only ever show one of the
     * three, and which one it happened to be was an accident of iteration
     * order — so two of the reader's cases were silently unreachable.
     */
    mini_cases: MiniCaseChallenge[];
    /**
     * The first mini case, for callers written before there could be several.
     *
     * Kept so archive rendering, mocks and existing types keep working; it is
     * always `mini_cases[0]`, never a second source of truth. New code reads
     * `mini_cases`.
     *
     * @deprecated Read `mini_cases`.
     */
    mini_case?: MiniCaseChallenge;
    concept?: KeyConcept;
  };
};
