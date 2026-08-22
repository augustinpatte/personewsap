import {
  isLanguage,
  isMiniCaseTopicId,
  isTopicId,
  type GeneratedContentItem,
  type Language,
  type TopicId
} from "../domain.js";
import { validateGeneratedItem } from "../generation/validation.js";
import { StagingBatchRejectedError } from "./stagingBatch.js";

/**
 * `unknown` in, `GeneratedContentItem` out — or a refusal.
 *
 * The staging validator already checked these payloads before the reviewer saw
 * them, and this checks them again. That is deliberate: staging is a separate
 * project written by a separate system, so its guarantees are a claim, not a
 * proof. Nothing crosses into production on a claim.
 *
 * There is no `as GeneratedContentItem` anywhere in this file. Every field a
 * mobile reader will render is read individually and the whole item is then put
 * through `validateGeneratedItem`, the same function the LLM path used.
 */

type Issue = string;

export function parseStagingPair(input: {
  jobId: string;
  contentType: "newsletter_article" | "business_story" | "mini_case";
  expectedTopic: TopicId | null;
  expectedMiniCaseTopic: string | null;
  outputJson: unknown;
}): Record<Language, GeneratedContentItem> {
  const issues: Issue[] = [];

  if (typeof input.outputJson !== "object" || input.outputJson === null) {
    throw new StagingBatchRejectedError("output_not_an_object", [`${input.jobId}: output_json is not an object`]);
  }

  const envelope = input.outputJson as Record<string, unknown>;
  const parsed: Partial<Record<Language, GeneratedContentItem>> = {};

  // The bilingual envelope is the contract. A job that produced only one
  // language is not half an edition, it is a refused job: FR and EN are two
  // renderings of one concept and neither is publishable alone.
  for (const language of ["fr", "en"] as const) {
    const side = envelope[language];

    if (typeof side !== "object" || side === null) {
      issues.push(`${input.jobId}: output_json.${language} is missing`);
      continue;
    }

    const item = parseItem({
      jobId: input.jobId,
      language,
      contentType: input.contentType,
      expectedTopic: input.expectedTopic,
      expectedMiniCaseTopic: input.expectedMiniCaseTopic,
      value: side as Record<string, unknown>,
      issues
    });

    if (item) {
      parsed[language] = item;
    }
  }

  if (issues.length > 0) {
    throw new StagingBatchRejectedError("output_schema_invalid", issues);
  }

  const fr = parsed.fr;
  const en = parsed.en;

  if (!fr || !en) {
    throw new StagingBatchRejectedError("output_pair_incomplete", [
      `${input.jobId}: both fr and en versions are required`
    ]);
  }

  return { fr, en };
}

function parseItem(input: {
  jobId: string;
  language: Language;
  contentType: "newsletter_article" | "business_story" | "mini_case";
  expectedTopic: TopicId | null;
  expectedMiniCaseTopic: string | null;
  value: Record<string, unknown>;
  issues: Issue[];
}): GeneratedContentItem | null {
  const { issues, jobId, language, value } = input;
  const where = `${jobId}.${language}`;
  const before = issues.length;

  if (value.content_type !== input.contentType) {
    issues.push(`${where}: content_type is ${String(value.content_type)}, expected ${input.contentType}`);
  }

  if (value.language !== language) {
    issues.push(`${where}: language is ${String(value.language)}, expected ${language}`);
  }

  if (!isLanguage(String(value.language))) {
    issues.push(`${where}: language is not a supported language`);
  }

  const topic = value.topic;
  if (typeof topic !== "string" || !isTopicId(topic)) {
    issues.push(`${where}: topic ${String(topic)} is not an editorial topic`);
  } else if (input.expectedTopic && topic !== input.expectedTopic) {
    // The job says which topic it was commissioned for. Content that came back
    // on a different topic would silently displace the one the edition needs.
    issues.push(`${where}: topic is ${topic}, but the job was commissioned for ${input.expectedTopic}`);
  }

  requireString(value.title, `${where}.title`, issues);
  requireString(value.body_md, `${where}.body_md`, issues);
  requireUrlArray(value.source_urls, `${where}.source_urls`, issues);

  if (input.contentType === "newsletter_article") {
    requireString(value.summary, `${where}.summary`, issues);
    requireString(value.why_it_matters, `${where}.why_it_matters`, issues);
    requireString(value.published_date, `${where}.published_date`, issues);
  }

  if (input.contentType === "business_story") {
    for (const field of ["company_or_market", "story_date", "setup", "tension", "decision", "outcome", "lesson"]) {
      requireString(value[field], `${where}.${field}`, issues);
    }
  }

  if (input.contentType === "mini_case") {
    parseMiniCaseFields({ where, value, expected: input.expectedMiniCaseTopic, issues });
  }

  if (issues.length > before) {
    return null;
  }

  // The same structural validator the LLM path ran. Anything it refuses here
  // would have been refused there.
  const structural = validateGeneratedItem(value as unknown as GeneratedContentItem, where);

  if (structural.length > 0) {
    issues.push(...structural.map((issue) => `${issue.path}: ${issue.message}`));
    return null;
  }

  return value as unknown as GeneratedContentItem;
}

/**
 * The Mini Case shape the mobile reader depends on.
 *
 * Three questions, four options each, exactly one correct, stable ids and a
 * feedback string on every option. The reader resolves a stored answer by option
 * id, so an id that is missing or duplicated is not a cosmetic problem: it
 * breaks grading for a case a reader has already answered.
 */
function parseMiniCaseFields(input: {
  where: string;
  value: Record<string, unknown>;
  expected: string | null;
  issues: Issue[];
}): void {
  const { issues, value, where } = input;

  const productTopic = value.product_topic;
  if (typeof productTopic !== "string" || !isMiniCaseTopicId(productTopic)) {
    issues.push(`${where}.product_topic: ${String(productTopic)} is not a Mini Case topic`);
  } else if (input.expected && productTopic !== input.expected) {
    issues.push(`${where}.product_topic: is ${productTopic}, but the job was commissioned for ${input.expected}`);
  }

  for (const field of [
    "scenario_type",
    "decision_type",
    "concept_tested",
    "mechanism",
    "question_pattern",
    "correct_answer_pattern",
    "core_takeaway",
    "difficulty",
    "context",
    "challenge",
    "question",
    "sample_answer",
    "conclusion",
    "final_takeaway"
  ]) {
    requireString(value[field], `${where}.${field}`, issues);
  }

  if (value.score_max !== 3) {
    issues.push(`${where}.score_max: is ${String(value.score_max)}, expected 3`);
  }

  if (!Array.isArray(value.constraints)) {
    issues.push(`${where}.constraints: must be an array`);
  }

  if (!Array.isArray(value.expected_reasoning) || value.expected_reasoning.length === 0) {
    issues.push(`${where}.expected_reasoning: must be a non-empty array`);
  }

  const questions = value.questions;

  if (!Array.isArray(questions) || questions.length !== 3) {
    issues.push(`${where}.questions: expected exactly 3 questions, received ${Array.isArray(questions) ? questions.length : "none"}`);
    return;
  }

  const seenQuestionIds = new Set<string>();

  questions.forEach((entry, index) => {
    const at = `${where}.questions.${index}`;

    if (typeof entry !== "object" || entry === null) {
      issues.push(`${at}: is not an object`);
      return;
    }

    const question = entry as Record<string, unknown>;
    const id = question.id;

    if (typeof id !== "string" || id.trim().length === 0) {
      issues.push(`${at}.id: a stable question id is required`);
    } else if (seenQuestionIds.has(id)) {
      issues.push(`${at}.id: duplicate question id ${id}`);
    } else {
      seenQuestionIds.add(id);
    }

    requireString(question.question, `${at}.question`, issues);
    requireString(question.role, `${at}.role`, issues);

    const options = question.options;

    if (!Array.isArray(options) || options.length !== 4) {
      issues.push(`${at}.options: expected exactly 4 options, received ${Array.isArray(options) ? options.length : "none"}`);
      return;
    }

    const seenOptionIds = new Set<string>();
    let correct = 0;

    options.forEach((optionEntry, optionIndex) => {
      const optionAt = `${at}.options.${optionIndex}`;

      if (typeof optionEntry !== "object" || optionEntry === null) {
        issues.push(`${optionAt}: is not an object`);
        return;
      }

      const option = optionEntry as Record<string, unknown>;
      const optionId = option.id;

      if (typeof optionId !== "string" || optionId.trim().length === 0) {
        issues.push(`${optionAt}.id: a stable option id is required`);
      } else if (seenOptionIds.has(optionId)) {
        issues.push(`${optionAt}.id: duplicate option id ${optionId}`);
      } else {
        seenOptionIds.add(optionId);
      }

      requireString(option.text, `${optionAt}.text`, issues);
      requireString(option.feedback, `${optionAt}.feedback`, issues);

      if (option.is_correct === true) {
        correct += 1;
      }
    });

    if (correct !== 1) {
      issues.push(`${at}.options: expected exactly 1 correct option, found ${correct}`);
    }
  });
}

function requireString(value: unknown, path: string, issues: Issue[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${path}: a non-empty string is required`);
  }
}

function requireUrlArray(value: unknown, path: string, issues: Issue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${path}: at least one source URL is required`);
    return;
  }

  value.forEach((url, index) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      issues.push(`${path}.${index}: must be an http(s) URL`);
    }
  });
}

/**
 * Every cited URL must have a source record behind it.
 *
 * The same closed-set rule the catalog uses: content may cite what it was given
 * and nothing else. A URL with no metadata cannot be persisted — `sources` has
 * nowhere to put it — and inventing a row for it would be inventing provenance.
 */
export function assertPairSourcesAreCovered(input: {
  jobId: string;
  items: Record<Language, GeneratedContentItem>;
  sourceUrls: Set<string>;
}): void {
  const missing: string[] = [];

  for (const [language, item] of Object.entries(input.items)) {
    for (const url of item.source_urls) {
      if (!input.sourceUrls.has(url)) {
        missing.push(`${input.jobId}.${language}: ${url} has no source record`);
      }
    }
  }

  if (missing.length > 0) {
    throw new StagingBatchRejectedError("source_record_missing", missing);
  }
}
