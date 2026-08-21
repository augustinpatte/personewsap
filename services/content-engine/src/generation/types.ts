import type {
  BusinessStoryMemoryContext,
  DailyDropPayload,
  GeneratedContentItem,
  Language,
  MiniCaseTopicId,
  RankedArticle,
  TopicId
} from "../domain.js";
import type { MiniCaseMemoryContext } from "../miniCase/editorialMemory.js";
import type { EditorialSection } from "./modelRouting.js";

/**
 * Reference version of an already-generated editorial item, used to produce its
 * counterpart in the other language. FR and EN versions of one catalog entry must
 * carry the same facts, sources, taxonomy, difficulty, reasoning, and correct
 * answer, while each is written naturally in its own language (never a literal
 * word-by-word translation). Only the catalog bootstrap sets this; the daily job
 * leaves it undefined and keeps its current independent per-language behaviour.
 */
export type LanguagePairReference = {
  referenceLanguage: Language;
  referenceItems: GeneratedContentItem[];
};

export type GenerationRequest = {
  dropDate: string;
  language: Language;
  articles: RankedArticle[];
  newsletterTopics: TopicId[];
  newsletterArticleCount: number;
  /**
   * Editorial sections to generate. Defaults to every active daily-drop section
   * (newsletter_article, business_story, mini_case) so daily-drop behaviour is
   * unchanged. The catalog bootstrap narrows it to generate inventory one
   * content type at a time.
   */
  sections?: EditorialSection[];
  /** Set only when generating the second language of an existing catalog entry. */
  languagePair?: LanguagePairReference;
  /**
   * Position of this entry inside a multi-entry catalog batch. Deterministic
   * template generation uses it to rotate taxonomy variants that editorial memory
   * does not already cover (difficulty, correct_answer_pattern). LLM generation
   * ignores it and relies on the injected editorial memory instead.
   */
  catalogVariantIndex?: number;
  // Number of newsletter articles generated PER editorial topic. Defaults to
  // NEWSLETTER_ITEMS_PER_TOPIC (2) when omitted. The total newsletter catalog is
  // always newsletterTopics.length * newsletterItemsPerTopic.
  newsletterItemsPerTopic?: number;
  /**
   * Allow the source packet to hold material in any language.
   *
   * Normal generation only shows an item sources written in its own language,
   * which is right for the Newsletter: a French edition reporting from an
   * English wire it cannot quote verbatim is a translation problem, not a
   * sourcing one.
   *
   * Reusable catalog content is different. A pair is one factual basis rendered
   * in two languages, so the basis should be the best available event, not the
   * best event that happens to have been written up in the language generated
   * first. Set only by the catalog bootstrap; the Newsletter never sets it.
   */
  crossLanguageSources?: boolean;
  miniCaseProductTopics?: MiniCaseTopicId[];
  miniCaseMemory?: MiniCaseMemoryContext;
  businessStoryMemory?: BusinessStoryMemoryContext;
  productionStrict?: boolean;
};

export type ContentGenerator = {
  generateDailyDrop(request: GenerationRequest): Promise<DailyDropPayload>;
};

/** Canonical generation order of the active daily-drop editorial sections. */
export const EDITORIAL_SECTION_ORDER: EditorialSection[] = [
  "newsletter_article",
  "business_story",
  "mini_case"
];

/**
 * Sections to generate for one request. Defaults to the full active daily drop so
 * the daily job keeps its current behaviour; the catalog bootstrap narrows it to
 * one content type per call. Order is always EDITORIAL_SECTION_ORDER.
 */
export function requestedSections(request: GenerationRequest): EditorialSection[] {
  const requested = request.sections;
  if (!requested || requested.length === 0) {
    return EDITORIAL_SECTION_ORDER;
  }

  const allowed = new Set(requested);
  return EDITORIAL_SECTION_ORDER.filter((section) => allowed.has(section));
}
