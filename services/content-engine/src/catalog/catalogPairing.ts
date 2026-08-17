import type { GeneratedContentItem, Language } from "../domain.js";
import {
  stripCitationAndLinks,
  userFacingLanguageFields,
  validateLanguageConsistency,
  type ValidationIssue
} from "../generation/validation.js";

/**
 * FR/EN parity rules for ONE catalog entry.
 *
 * PersoNewsAP treats FR and EN as two equivalent editorial versions of the same
 * entry, not as source text and translation. That means two obligations pull in
 * opposite directions and both must hold:
 *
 *  1. Same editorial substance: same sources, same dates, same taxonomy, same
 *     difficulty, same reasoning, same correct answer. A user who switches
 *     language must get the same case with the same right answer.
 *  2. Naturally written in each language: never a literal word-by-word
 *     translation, and never untranslated text passed through from the other
 *     language.
 *
 * This module enforces (1) as structural invariants and (2) as a passthrough
 * check on top of the existing per-item language-consistency validator.
 */

export type CatalogLanguageVersion = {
  language: Language;
  item: GeneratedContentItem;
};

/**
 * Minimum word count before two identical strings across languages count as an
 * untranslated passthrough. Short strings (a company name, a ticker, a metric
 * label) are legitimately identical in FR and EN.
 */
const MIN_PASSTHROUGH_WORDS = 5;

export function validateCatalogLanguagePair(
  reference: CatalogLanguageVersion,
  counterpart: CatalogLanguageVersion,
  path: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (reference.language === counterpart.language) {
    issues.push(pairIssue(path, "pair_same_language", `Both versions are in ${reference.language}. A pair needs one version per language.`));
    return issues;
  }

  if (reference.item.language !== reference.language || counterpart.item.language !== counterpart.language) {
    issues.push(pairIssue(path, "pair_language_mismatch", "Each version's item.language must match the version language."));
  }

  if (reference.item.content_type !== counterpart.item.content_type) {
    issues.push(
      pairIssue(
        path,
        "pair_content_type_mismatch",
        `Paired versions must share a content type (${reference.item.content_type} vs ${counterpart.item.content_type}).`
      )
    );
    return issues;
  }

  // Each version must independently be 100% in its own language.
  issues.push(...validateLanguageConsistency(reference.item, `${path}.${reference.language}`));
  issues.push(...validateLanguageConsistency(counterpart.item, `${path}.${counterpart.language}`));

  issues.push(...validateSharedSources(reference, counterpart, path));
  issues.push(...validateSharedLogic(reference, counterpart, path));
  issues.push(...validateNotUntranslatedPassthrough(reference, counterpart, path));

  return issues;
}

function validateSharedSources(
  reference: CatalogLanguageVersion,
  counterpart: CatalogLanguageVersion,
  path: string
): ValidationIssue[] {
  const left = normalizedUrlSet(reference.item.source_urls);
  const right = normalizedUrlSet(counterpart.item.source_urls);

  if (left.size === 0 || right.size === 0) {
    return [pairIssue(path, "pair_missing_sources", "Both language versions of a catalog entry must cite at least one source.")];
  }

  const sameSources = left.size === right.size && [...left].every((url) => right.has(url));
  if (!sameSources) {
    return [
      pairIssue(
        path,
        "pair_source_mismatch",
        `FR and EN versions must cite the same sources. ${reference.language}: ${[...left].join(", ")} / ${counterpart.language}: ${[...right].join(", ")}.`
      )
    ];
  }

  return [];
}

/**
 * Structural invariants that must be byte-identical across the two languages.
 * These are the fields a reader would notice diverging: which concept is being
 * tested, how hard the case is, and which answer is correct.
 */
function validateSharedLogic(
  reference: CatalogLanguageVersion,
  counterpart: CatalogLanguageVersion,
  path: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const left = reference.item;
  const right = counterpart.item;

  if (left.content_type === "business_story" && right.content_type === "business_story") {
    compareField(issues, path, "story_date", left.story_date, right.story_date);
    compareField(issues, path, "company_or_market", left.company_or_market, right.company_or_market);
    compareField(issues, path, "editorial_memory.entity_type", left.editorial_memory?.entity_type, right.editorial_memory?.entity_type);
    compareField(issues, path, "editorial_memory.industry", left.editorial_memory?.industry, right.editorial_memory?.industry);
    compareField(issues, path, "editorial_memory.key_mechanism", left.editorial_memory?.key_mechanism, right.editorial_memory?.key_mechanism);
    compareField(issues, path, "editorial_memory.year_period", left.editorial_memory?.year_period, right.editorial_memory?.year_period);
    return issues;
  }

  if (left.content_type === "mini_case" && right.content_type === "mini_case") {
    compareField(issues, path, "product_topic", left.product_topic, right.product_topic);
    compareField(issues, path, "scenario_type", left.scenario_type, right.scenario_type);
    compareField(issues, path, "decision_type", left.decision_type, right.decision_type);
    compareField(issues, path, "concept_tested", left.concept_tested, right.concept_tested);
    compareField(issues, path, "question_pattern", left.question_pattern, right.question_pattern);
    compareField(issues, path, "correct_answer_pattern", left.correct_answer_pattern, right.correct_answer_pattern);
    compareField(issues, path, "difficulty", left.difficulty, right.difficulty);
    compareField(issues, path, "score_max", left.score_max, right.score_max);

    const leftQuestions = Array.isArray(left.questions) ? left.questions : [];
    const rightQuestions = Array.isArray(right.questions) ? right.questions : [];

    if (leftQuestions.length !== rightQuestions.length) {
      issues.push(
        pairIssue(
          path,
          "pair_question_count_mismatch",
          `Mini-case versions must have the same number of questions (${leftQuestions.length} vs ${rightQuestions.length}).`
        )
      );
      return issues;
    }

    leftQuestions.forEach((leftQuestion, index) => {
      const rightQuestion = rightQuestions[index];
      compareField(issues, `${path}.questions.${index}`, "role", leftQuestion.role, rightQuestion.role);

      const leftOptionIds = leftQuestion.options.map((option) => option.id);
      const rightOptionIds = rightQuestion.options.map((option) => option.id);
      if (leftOptionIds.join("|") !== rightOptionIds.join("|")) {
        issues.push(
          pairIssue(
            `${path}.questions.${index}`,
            "pair_option_id_mismatch",
            `Option ids must match across languages (${leftOptionIds.join(",")} vs ${rightOptionIds.join(",")}).`
          )
        );
      }

      const leftCorrect = leftQuestion.options.filter((option) => option.is_correct).map((option) => option.id);
      const rightCorrect = rightQuestion.options.filter((option) => option.is_correct).map((option) => option.id);

      if (leftCorrect.length !== 1 || rightCorrect.length !== 1) {
        issues.push(
          pairIssue(
            `${path}.questions.${index}`,
            "pair_correct_answer_count",
            `Each question must have exactly one correct option in both languages (${leftCorrect.length} vs ${rightCorrect.length}).`
          )
        );
        return;
      }

      if (leftCorrect[0] !== rightCorrect[0]) {
        issues.push(
          pairIssue(
            `${path}.questions.${index}`,
            "pair_correct_answer_mismatch",
            `The correct option must be the same in both languages (${reference.language}=${leftCorrect[0]}, ${counterpart.language}=${rightCorrect[0]}).`
          )
        );
      }
    });
  }

  return issues;
}

/**
 * Catches the failure mode where one language is "generated" by shipping the
 * other language's text untouched. Compares every user-facing prose field and
 * flags identical normalized text above a short-string threshold.
 */
function validateNotUntranslatedPassthrough(
  reference: CatalogLanguageVersion,
  counterpart: CatalogLanguageVersion,
  path: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rightByField = new Map(userFacingLanguageFields(counterpart.item).map((entry) => [entry.field, entry.text]));

  for (const { field, text } of userFacingLanguageFields(reference.item)) {
    const counterpartText = rightByField.get(field);
    if (counterpartText === undefined) {
      continue;
    }

    const left = normalizeProse(text);
    const right = normalizeProse(counterpartText);

    if (left.length === 0 || right.length === 0) {
      continue;
    }

    if (left === right && countWords(left) >= MIN_PASSTHROUGH_WORDS) {
      issues.push(
        pairIssue(
          path,
          "pair_untranslated_passthrough",
          `${field} is identical in ${reference.language} and ${counterpart.language}. Each language version must be written natively, not passed through untranslated.`
        )
      );
    }
  }

  return issues;
}

function compareField(
  issues: ValidationIssue[],
  path: string,
  field: string,
  left: unknown,
  right: unknown
): void {
  if (left === right) {
    return;
  }

  issues.push(
    pairIssue(
      path,
      "pair_logic_mismatch",
      `${field} must be identical across languages (${String(left)} vs ${String(right)}).`
    )
  );
}

function pairIssue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message, severity: "error" };
}

function normalizedUrlSet(urls: string[]): Set<string> {
  return new Set((urls ?? []).map((url) => url.trim()).filter(Boolean));
}

/**
 * Accent-insensitive, punctuation-insensitive prose comparison. Citation lines,
 * URLs, and ISO dates are stripped first because they stay identical in both
 * languages by design and would otherwise mask or fake a match.
 */
function normalizeProse(value: string): string {
  return stripCitationAndLinks(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countWords(value: string): number {
  return value.split(" ").filter(Boolean).length;
}
