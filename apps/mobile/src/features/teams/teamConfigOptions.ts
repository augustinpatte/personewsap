import { MINI_CASE_TOPIC_IDS, TOPIC_OPTIONS, localizeOptions } from "../onboarding/options";
import type { ContentLanguage } from "../today/contentTypes";

/**
 * What a Team can be configured to play.
 *
 * The SAME topic catalogue the personal onboarding uses, deliberately: a Team is
 * the product's own content assigned to a group, not a second content system.
 * The labels and translations are read from `features/onboarding/options` rather
 * than retyped, so a topic renamed there is renamed here too.
 *
 * THE IDS ARE THE BACKEND ONES. `team_config_newsletter_topics.topic_id` is a
 * foreign key to `public.topics`, whose ids are the eight product topics
 * (business, finance, tech_ai, …) — not the eight onboarding-facing ids
 * (stock_market, ai, …) that map onto them. Sending an onboarding id would be a
 * foreign-key violation nobody could read, so the mapping is done here, once.
 */

export const NEWSLETTER_TOPIC_CHOICES = TOPIC_OPTIONS.map((option) => ({
  /** The value written to the database. */
  topicId: option.backendTopicId,
  /** The onboarding id, kept so the labels can be localised from one place. */
  optionId: option.id
}));

/** 1 or 2. Never 3: an edition publishes at most two articles per topic. */
export const ARTICLE_COUNT_CHOICES = [1, 2] as const;
export const MAX_ARTICLES_PER_TOPIC = 2;

export function newsletterTopicLabel(
  backendTopicId: string,
  language: ContentLanguage
): string {
  const option = localizeOptions(TOPIC_OPTIONS, language).find(
    (entry) => entry.backendTopicId === backendTopicId
  );

  return option?.label ?? backendTopicId;
}

export const MINI_CASE_TOPIC_CHOICES = [...MINI_CASE_TOPIC_IDS];

const MINI_CASE_LABELS: Record<ContentLanguage, Record<string, string>> = {
  en: {
    finance_economy: "Finance / Economy",
    stock_market: "Stock Market",
    ai: "Artificial Intelligence",
    law_compliance: "Law / Compliance",
    health_pharma: "Health / Pharma",
    engineering_operations: "Engineering / Operations"
  },
  fr: {
    finance_economy: "Finance / Économie",
    stock_market: "Marché actions",
    ai: "Intelligence artificielle",
    law_compliance: "Droit / Conformité",
    health_pharma: "Santé / Pharma",
    engineering_operations: "Ingénierie / Opérations"
  }
};

export function miniCaseTopicLabel(topicId: string, language: ContentLanguage): string {
  return MINI_CASE_LABELS[language]?.[topicId] ?? MINI_CASE_LABELS.en[topicId] ?? topicId;
}

export type TeamConfigDraft = {
  /** topicId -> 1 or 2. A topic absent from the map is not selected. */
  newsletter: Record<string, number>;
  miniCases: string[];
};

export const EMPTY_DRAFT: TeamConfigDraft = { newsletter: {}, miniCases: [] };

/**
 * A Team has to play something.
 *
 * Newsletter topics OR mini-case topics — at least one game overall, not one of
 * each. A Team that wants only mini cases is a coherent choice; a Team that
 * selected nothing would publish an empty edition and score everybody zero
 * forever, which is the configuration this guard exists to make unreachable.
 */
export function draftHasAGame(draft: TeamConfigDraft): boolean {
  return Object.keys(draft.newsletter).length > 0 || draft.miniCases.length > 0;
}

/** The count as the server wants it, clamped to the only two legal values. */
export function draftToNewsletterTopics(
  draft: TeamConfigDraft
): Array<{ topicId: string; articlesCount: number }> {
  return Object.entries(draft.newsletter).map(([topicId, count]) => ({
    topicId,
    articlesCount: Math.min(MAX_ARTICLES_PER_TOPIC, Math.max(1, count))
  }));
}

export function toggleNewsletterTopic(
  draft: TeamConfigDraft,
  topicId: string
): TeamConfigDraft {
  const next = { ...draft.newsletter };

  if (topicId in next) {
    delete next[topicId];
  } else {
    next[topicId] = 1;
  }

  return { ...draft, newsletter: next };
}

export function setNewsletterArticleCount(
  draft: TeamConfigDraft,
  topicId: string,
  count: number
): TeamConfigDraft {
  if (!(topicId in draft.newsletter)) {
    return draft;
  }

  return {
    ...draft,
    newsletter: {
      ...draft.newsletter,
      // Clamped here as well as at the write. Three is not a value this product
      // has, so there is no path — a stale preference, a future control, a typo
      // — by which one can be submitted.
      [topicId]: Math.min(MAX_ARTICLES_PER_TOPIC, Math.max(1, count))
    }
  };
}

export function toggleMiniCaseTopic(draft: TeamConfigDraft, topicId: string): TeamConfigDraft {
  return {
    ...draft,
    miniCases: draft.miniCases.includes(topicId)
      ? draft.miniCases.filter((entry) => entry !== topicId)
      : [...draft.miniCases, topicId]
  };
}

/** How much content an edition of this Team carries, for the review line. */
export function draftEditionShape(draft: TeamConfigDraft): {
  articles: number;
  miniCases: number;
} {
  return {
    articles: Object.values(draft.newsletter).reduce((total, count) => total + count, 0),
    miniCases: draft.miniCases.length
  };
}
