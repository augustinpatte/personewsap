import { EDITORIAL_MEMORY_LIMIT, type GeneratedContentItem, type Language, type MiniCaseTopicId } from "../domain.js";
import {
  MINI_CASE_ALLOWED_FRAMING,
  MINI_CASE_CONCEPTS,
  MINI_CASE_DECISION_TYPES,
  MINI_CASE_QUESTION_PATTERNS,
  MINI_CASE_SCENARIO_TYPES,
  type MiniCaseConcept,
  type MiniCaseDecisionType,
  type MiniCaseQuestionPattern,
  type MiniCaseScenarioType
} from "./taxonomy.js";

export type MiniCaseEditorialMemoryRecord = {
  id?: string;
  content_item_id: string | null;
  title: string;
  slug: string;
  topic: MiniCaseTopicId;
  scenario_type: MiniCaseScenarioType;
  decision_type: MiniCaseDecisionType;
  concept_tested: MiniCaseConcept;
  mechanism: string;
  difficulty: string;
  question_pattern: MiniCaseQuestionPattern;
  correct_answer_pattern: string;
  core_takeaway: string;
  published_date: string;
  language: Language;
  created_at?: string;
};

export type MiniCaseMemoryContext = {
  recentOverall: MiniCaseEditorialMemoryRecord[];
  bannedScenarioTypes: MiniCaseScenarioType[];
  bannedConcepts: MiniCaseConcept[];
  bannedDecisionTypes: MiniCaseDecisionType[];
  bannedQuestionPatterns: MiniCaseQuestionPattern[];
  recentTitles: string[];
  recentTopicStreak: MiniCaseTopicId[];
  allowedFraming: Record<MiniCaseTopicId, string>;
};

export function emptyMiniCaseMemoryContext(): MiniCaseMemoryContext {
  return {
    recentOverall: [],
    bannedScenarioTypes: [],
    bannedConcepts: [],
    bannedDecisionTypes: [],
    bannedQuestionPatterns: [],
    recentTitles: [],
    recentTopicStreak: [],
    allowedFraming: MINI_CASE_ALLOWED_FRAMING
  };
}

export function buildMiniCaseMemoryContext(input: {
  records: MiniCaseEditorialMemoryRecord[];
  dropDate: string;
}): MiniCaseMemoryContext {
  // Editorial memory is capped at the 50 most recent mini cases (EDITORIAL_MEMORY_LIMIT).
  const recentOverall = input.records.slice(0, EDITORIAL_MEMORY_LIMIT);
  return {
    recentOverall,
    bannedScenarioTypes: uniqueRecent(recentOverall, input.dropDate, 10, (record) => record.scenario_type),
    bannedConcepts: uniqueRecent(recentOverall, input.dropDate, 7, (record) => record.concept_tested),
    bannedDecisionTypes: uniqueRecent(recentOverall, input.dropDate, 5, (record) => record.decision_type),
    bannedQuestionPatterns: uniqueRecent(recentOverall, input.dropDate, 14, (record) => record.question_pattern),
    recentTitles: recentOverall.map((record) => record.title).filter(Boolean).slice(0, EDITORIAL_MEMORY_LIMIT),
    recentTopicStreak: recentOverall
      .filter((record) => daysBetween(record.published_date, input.dropDate) <= 2)
      .map((record) => record.topic),
    allowedFraming: MINI_CASE_ALLOWED_FRAMING
  };
}

/**
 * Compact, de-identified mini-case memory injected into the generation prompt.
 * Never includes full past content — only the fields needed to avoid repeating a
 * recent topic, sector, scenario_type, decision_type, concept_tested, mechanism,
 * hook (title), or one_line_summary. Capped at EDITORIAL_MEMORY_LIMIT items.
 */
export function compactMiniCaseMemoryForPrompt(context?: MiniCaseMemoryContext | null) {
  if (!context) {
    return {
      available: false,
      instruction: "No persisted mini-case memory was supplied for this run."
    };
  }

  return {
    available: true,
    hard_avoid: {
      banned_recent_scenario_types: context.bannedScenarioTypes,
      banned_recent_concepts: context.bannedConcepts,
      banned_recent_decision_types: context.bannedDecisionTypes,
      banned_recent_question_patterns: context.bannedQuestionPatterns,
      recent_titles_to_avoid: context.recentTitles
    },
    recent_case_sample: context.recentOverall
      .slice(0, EDITORIAL_MEMORY_LIMIT)
      .map((record) => ({
        title: record.title,
        topic: record.topic,
        sector: record.topic,
        scenario_type: record.scenario_type,
        decision_type: record.decision_type,
        concept_tested: record.concept_tested,
        mechanism: record.mechanism,
        question_pattern: record.question_pattern,
        one_line_summary: record.core_takeaway,
        published_date: record.published_date
      }))
  };
}

export function miniCaseMemoryFromItem(input: {
  item: GeneratedContentItem;
  contentItemId: string | null;
  publishedDate: string;
}): MiniCaseEditorialMemoryRecord | null {
  if (input.item.content_type !== "mini_case") {
    return null;
  }

  const productTopic = readString(input.item.product_topic);
  const scenarioType = readString(input.item.scenario_type);
  const decisionType = readString(input.item.decision_type);
  const conceptTested = readString(input.item.concept_tested);
  const questionPattern = readString(input.item.question_pattern);
  const correctAnswerPattern = readString(input.item.correct_answer_pattern);

  if (
    !productTopic ||
    !scenarioType ||
    !decisionType ||
    !conceptTested ||
    !questionPattern ||
    !correctAnswerPattern ||
    !MINI_CASE_SCENARIO_TYPES.includes(scenarioType as MiniCaseScenarioType) ||
    !MINI_CASE_DECISION_TYPES.includes(decisionType as MiniCaseDecisionType) ||
    !MINI_CASE_CONCEPTS.includes(conceptTested as MiniCaseConcept) ||
    !MINI_CASE_QUESTION_PATTERNS.includes(questionPattern as MiniCaseQuestionPattern)
  ) {
    return null;
  }

  return {
    content_item_id: input.contentItemId,
    title: input.item.title,
    slug: slugifyMiniCaseTitle(input.item.title),
    topic: productTopic as MiniCaseTopicId,
    scenario_type: scenarioType as MiniCaseScenarioType,
    decision_type: decisionType as MiniCaseDecisionType,
    concept_tested: conceptTested as MiniCaseConcept,
    mechanism: readString(input.item.mechanism) ?? "unspecified",
    difficulty: input.item.difficulty,
    question_pattern: questionPattern as MiniCaseQuestionPattern,
    correct_answer_pattern: correctAnswerPattern,
    core_takeaway: readString(input.item.core_takeaway) ?? readString(input.item.sample_answer) ?? "unspecified",
    published_date: input.publishedDate,
    language: input.item.language
  };
}

export function slugifyMiniCaseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function uniqueRecent<T extends string>(
  records: MiniCaseEditorialMemoryRecord[],
  dropDate: string,
  maxAgeDays: number,
  select: (record: MiniCaseEditorialMemoryRecord) => T
): T[] {
  return Array.from(
    new Set(
      records
        .filter((record) => daysBetween(record.published_date, dropDate) <= maxAgeDays)
        .map(select)
    )
  );
}

function daysBetween(leftDate: string, rightDate: string): number {
  const left = Date.parse(`${leftDate.slice(0, 10)}T00:00:00.000Z`);
  const right = Date.parse(`${rightDate.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.floor((right - left) / 86_400_000);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
