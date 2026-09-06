/**
 * The graded question model, and the part of it a machine can check.
 *
 * PersoNews questions used to be binary: one option carried `is_correct: true`
 * and the other three were simply wrong. That is a comprehension check. What the
 * product now needs is a judgement check — four defensible answers ranked by how
 * good the reasoning behind them is:
 *
 *     bad        0
 *     average    300
 *     good       600
 *     excellent  1000
 *
 * Integers in milli-points, never floats. `0.3` in a score column is how a
 * leaderboard ends up disagreeing with itself, and the tier set is small and
 * closed precisely so that no arithmetic is ever needed to decide what an answer
 * was worth.
 *
 * WHAT THIS FILE IS AND IS NOT
 *
 * It is the deterministic half of the contract. Whether the "excellent" answer is
 * genuinely better reasoning than the "good" one is an editorial judgement and
 * belongs to the prompt and the Reviewer. What belongs here is everything a
 * regex can settle honestly:
 *
 *   - exactly four options, one per tier, unique ids, no duplicated text;
 *   - a decision criterion and one stated reason per tier, so the Reviewer has
 *     something to disagree with;
 *   - the answer is not identifiable from its shape.
 *
 * That last one is the reason this file exists at all. A reader who notices that
 * the best answer is always the longest, or the only one with a number in it, or
 * the only one that hedges, stops reasoning and starts pattern-matching — the
 * same failure `optionOrder.ts` was written for when the correct answer turned
 * out to be B twenty-five times out of thirty. Position was fixed in code because
 * a model asked for randomness produces its own bias; shape has to be fixed the
 * same way, by measuring it rather than by asking nicely.
 *
 * Deliberately NOT checked here: whether a distractor is wrong for an
 * interesting reason. A regex pretending to measure that would only teach the
 * model to dodge the regex.
 */

/** The four tiers, in milli-points. Closed set, integers, no arithmetic. */
export const QUESTION_SCORE_TIERS = [0, 300, 600, 1000] as const;
export type QuestionScoreTier = (typeof QUESTION_SCORE_TIERS)[number];

export const QUESTION_GRADE_BANDS = ["bad", "average", "good", "excellent"] as const;
export type QuestionGradeBand = (typeof QUESTION_GRADE_BANDS)[number];

/** The band is the score, named. One is derived from the other, never stored twice. */
const TIER_BY_BAND: Record<QuestionGradeBand, QuestionScoreTier> = {
  bad: 0,
  average: 300,
  good: 600,
  excellent: 1000
};

const BAND_BY_TIER = new Map<number, QuestionGradeBand>(
  (Object.entries(TIER_BY_BAND) as Array<[QuestionGradeBand, QuestionScoreTier]>).map(
    ([band, tier]) => [tier, band]
  )
);

export function gradeBandForTier(tier: number): QuestionGradeBand | null {
  return BAND_BY_TIER.get(tier) ?? null;
}

export function tierForGradeBand(band: string): QuestionScoreTier | null {
  return TIER_BY_BAND[band as QuestionGradeBand] ?? null;
}

export function isQuestionScoreTier(value: unknown): value is QuestionScoreTier {
  return typeof value === "number" && (QUESTION_SCORE_TIERS as readonly number[]).includes(value);
}

/**
 * Question roles.
 *
 * Newsletter and Business Story ask two: what the mechanism is, then what to do
 * with it. Mini Cases keep the three-step pedagogical progression they already
 * have — that sequence IS the exercise and is not up for renegotiation here.
 */
export const READING_QUESTION_ROLES = ["interpretation", "application_decision"] as const;
export const MINI_CASE_QUESTION_ROLES = [
  "method_framework",
  "technical_application",
  "conclusion_decision"
] as const;

export type ReadingQuestionRole = (typeof READING_QUESTION_ROLES)[number];
export type MiniCaseQuestionRole = (typeof MINI_CASE_QUESTION_ROLES)[number];
export type QuestionRole = ReadingQuestionRole | MiniCaseQuestionRole;

/** How many questions each surface carries. Fixed, and asserted by validation. */
export const QUESTION_COUNT_BY_CONTENT_TYPE = {
  newsletter_article: 2,
  business_story: 2,
  mini_case: 3
} as const;

export const OPTIONS_PER_QUESTION = 4;

/** The 20-second product answer, carried alongside the question. */
export const QUESTION_TIME_LIMIT_SECONDS = 20;

export type GradedQuestionOption = {
  id: string;
  text: string;
  /** 0 | 300 | 600 | 1000. Never a float, never a ratio. */
  score_milli: QuestionScoreTier;
  /** Shown AFTER answering. Never reaches a client before submission. */
  feedback: string;
};

/**
 * What the Reviewer needs in order to disagree.
 *
 * Without a stated decision criterion, "is the excellent answer really better
 * than the good one" is unanswerable, and a question whose ranking cannot be
 * defended is a question that will feel arbitrary to whoever loses points on it.
 * These fields are internal: they go to the Reviewer and are never shipped to a
 * client, before or after answering.
 */
export type QuestionRationale = {
  /** The single axis that separates the four answers. */
  decision_criterion: string;
  excellent_reason: string;
  good_limitation: string;
  average_limitation: string;
  bad_failure: string;
};

export type GradedQuestion = {
  id: string;
  role: QuestionRole;
  question: string;
  options: GradedQuestionOption[];
  rationale: QuestionRationale;
};

export type QuestionIssue = {
  /** Index of the offending option, or -1 when the whole question is at fault. */
  optionIndex: number;
  code: QuestionIssueCode;
  message: string;
};

export type QuestionIssueCode =
  | "question_prompt_missing"
  | "question_role_invalid"
  | "question_option_count_invalid"
  | "question_option_id_duplicated"
  | "question_option_id_missing"
  | "question_option_text_missing"
  | "question_option_text_duplicated"
  | "question_score_tier_invalid"
  | "question_score_tier_set_invalid"
  | "question_feedback_missing"
  | "question_feedback_too_long"
  | "question_rationale_incomplete"
  | "question_rationale_criterion_vague"
  | "question_option_length_asymmetric"
  | "question_best_option_only_numeric"
  | "question_best_option_only_conditional";

const FEEDBACK_MAX_CHARS = 320;
const QUESTION_MIN_CHARS = 12;
const OPTION_MIN_CHARS = 3;
const RATIONALE_MIN_CHARS = 12;

/**
 * How far the longest option may exceed the shortest.
 *
 * Four answers to the same question are four sentences about the same decision;
 * one of them being two and a half times another is not a stylistic accident,
 * it is the tell. The threshold is deliberately loose — it is looking for the
 * option that towers, not for uniform prose.
 */
const OPTION_LENGTH_RATIO_MAX = 2.5;

/**
 * The best answer must not be the only one that mentions a number, or the only
 * one that hedges. Both are shape tells a reader learns in three editions.
 */
const NUMERIC_PATTERN = /\d/;
const CONDITIONAL_PATTERN =
  /\b(if|unless|provided|when|only if|si\b|sauf si|à condition|lorsque|dès lors)\b/i;

function normalizeOptionText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Read a question written in any shape this pipeline has ever produced.
 *
 * Three generations of options exist in the catalog:
 *
 *   `score_milli: 1000`          the graded model
 *   `is_correct: true`           the binary model, ~2 months of approved content
 *   `outcome: "best"|"viable"|"weak"`  the shape the mobile reader renders
 *
 * Legacy rows are read, never rewritten in place: a binary option genuinely
 * carries no information about whether a wrong answer was nearly right or
 * hopeless, so mapping `is_correct: false` to 300 or 600 would be inventing an
 * editorial judgement nobody made. Correct becomes 1000, everything else 0, and
 * `graded` reports false so a caller can tell a converted question from an
 * authored one — that flag is what the backfill selects on.
 */
export type NormalizedQuestion = GradedQuestion & {
  /** False when the tiers were derived from a legacy binary/outcome shape. */
  graded: boolean;
};

const OUTCOME_TIERS: Record<string, QuestionScoreTier> = {
  best: 1000,
  viable: 600,
  weak: 0
};

export function normalizeQuestionOptions(
  rawOptions: unknown
): { options: GradedQuestionOption[]; graded: boolean } {
  const list = Array.isArray(rawOptions) ? rawOptions : [];
  let graded = list.length > 0;

  const options = list.map((raw, index) => {
    const option = (raw ?? {}) as Record<string, unknown>;
    const id = text(option.id) || `option-${index + 1}`;
    const optionText = text(option.text) || text(option.label);
    const feedback = text(option.feedback);

    if (isQuestionScoreTier(option.score_milli)) {
      return { id, text: optionText, score_milli: option.score_milli, feedback };
    }

    // A `score_milli` that is present but off-scale (750, "600", 0.3) is a
    // BROKEN GRADED option, not a legacy one. Falling through to the legacy
    // branch here would quietly rescore it to 0 and mark the whole question
    // ungraded, which sends it down the lenient path written for the binary
    // catalog — so a malformed new question would validate as an old one.
    // Keep the bad value and let validateGradedQuestion report it.
    if (option.score_milli !== undefined && option.score_milli !== null) {
      return {
        id,
        text: optionText,
        score_milli: option.score_milli as QuestionScoreTier,
        feedback
      };
    }

    graded = false;

    const outcome = text(option.outcome);
    if (outcome && outcome in OUTCOME_TIERS) {
      return { id, text: optionText, score_milli: OUTCOME_TIERS[outcome], feedback };
    }

    const tier: QuestionScoreTier = option.is_correct === true ? 1000 : 0;
    return { id, text: optionText, score_milli: tier, feedback };
  });

  return { options, graded };
}

export function normalizeQuestion(raw: unknown, index: number): NormalizedQuestion {
  const question = (raw ?? {}) as Record<string, unknown>;
  const { options, graded } = normalizeQuestionOptions(question.options);
  const rationale = (question.rationale ?? {}) as Record<string, unknown>;

  return {
    id: text(question.id) || `question-${index + 1}`,
    role: (text(question.role) || "interpretation") as QuestionRole,
    question: text(question.question) || text(question.prompt),
    options,
    rationale: {
      decision_criterion: text(rationale.decision_criterion),
      excellent_reason: text(rationale.excellent_reason),
      good_limitation: text(rationale.good_limitation),
      average_limitation: text(rationale.average_limitation),
      bad_failure: text(rationale.bad_failure)
    },
    graded
  };
}

export function normalizeQuestions(raw: unknown): NormalizedQuestion[] {
  return (Array.isArray(raw) ? raw : []).map(normalizeQuestion);
}

/**
 * Does this question have exactly one of each tier?
 *
 * Separated out because it is the single most load-bearing structural rule: two
 * options worth 1000 makes the question unanswerable, and no option worth 1000
 * makes it unwinnable.
 */
export function hasExactTierSet(options: GradedQuestionOption[]): boolean {
  if (options.length !== OPTIONS_PER_QUESTION) {
    return false;
  }

  const tiers = options.map((option) => option.score_milli).sort((a, b) => a - b);
  return QUESTION_SCORE_TIERS.every((tier, index) => tiers[index] === tier);
}

export function bestOption(options: GradedQuestionOption[]): GradedQuestionOption | undefined {
  return options.find((option) => option.score_milli === 1000);
}

/**
 * Every deterministic rule, for one question.
 *
 * Structural failures return early: once there are not four options there is no
 * meaningful shape analysis to do, and reporting six derived findings for one
 * cause makes reviewer feedback harder to act on rather than easier.
 */
export function validateGradedQuestion(
  question: NormalizedQuestion,
  expectedRole: QuestionRole
): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const add = (code: QuestionIssueCode, message: string, optionIndex = -1) => {
    issues.push({ optionIndex, code, message });
  };

  if (question.role !== expectedRole) {
    add("question_role_invalid", `Question role must be ${expectedRole}, got ${question.role || "none"}.`);
  }

  if (question.question.length < QUESTION_MIN_CHARS) {
    add("question_prompt_missing", "Each question needs a concrete prompt.");
  }

  if (question.options.length !== OPTIONS_PER_QUESTION) {
    add(
      "question_option_count_invalid",
      `Each question needs exactly ${OPTIONS_PER_QUESTION} options, got ${question.options.length}.`
    );
    return issues;
  }

  const seenIds = new Set<string>();
  const seenText = new Map<string, number>();

  question.options.forEach((option, index) => {
    if (!option.id) {
      add("question_option_id_missing", "Every option needs a stable id.", index);
    } else if (seenIds.has(option.id)) {
      add("question_option_id_duplicated", `Option id "${option.id}" is used twice.`, index);
    } else {
      seenIds.add(option.id);
    }

    if (option.text.length < OPTION_MIN_CHARS) {
      add("question_option_text_missing", "Every option needs answer text.", index);
      return;
    }

    const normalized = normalizeOptionText(option.text);
    const firstIndex = seenText.get(normalized);
    if (firstIndex !== undefined) {
      add(
        "question_option_text_duplicated",
        `Option ${index + 1} repeats option ${firstIndex + 1}; four answers must be four decisions.`,
        index
      );
    } else {
      seenText.set(normalized, index);
    }

    if (!isQuestionScoreTier(option.score_milli)) {
      add(
        "question_score_tier_invalid",
        `Option score must be one of ${QUESTION_SCORE_TIERS.join(", ")} (integer milli-points).`,
        index
      );
    }

    if (!option.feedback) {
      add("question_feedback_missing", "Every option needs a post-answer explanation.", index);
    } else if (option.feedback.length > FEEDBACK_MAX_CHARS) {
      add(
        "question_feedback_too_long",
        `Option feedback must stay under ${FEEDBACK_MAX_CHARS} characters.`,
        index
      );
    }
  });

  if (!hasExactTierSet(question.options)) {
    add(
      "question_score_tier_set_invalid",
      "A question needs exactly one option at each of 0 / 300 / 600 / 1000."
    );
  }

  issues.push(...validateQuestionRationale(question));
  issues.push(...validateOptionShapeNeutrality(question.options));

  return issues;
}

/**
 * The Reviewer's raw material.
 *
 * A missing criterion is not a formatting problem: it means nobody wrote down
 * why one answer beats another, so nobody can check that it does.
 */
export function validateQuestionRationale(question: GradedQuestion): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const fields: Array<keyof QuestionRationale> = [
    "decision_criterion",
    "excellent_reason",
    "good_limitation",
    "average_limitation",
    "bad_failure"
  ];

  const missing = fields.filter((field) => question.rationale[field].length < RATIONALE_MIN_CHARS);

  if (missing.length > 0) {
    issues.push({
      optionIndex: -1,
      code: "question_rationale_incomplete",
      message: `The Reviewer cannot check this ranking: ${missing.join(", ")} missing or too short.`
    });
  }

  // A criterion that only restates the question separates nothing. Short and
  // generic is the shape that gets written when there is no real axis.
  const criterion = question.rationale.decision_criterion.toLowerCase();
  if (
    criterion.length >= RATIONALE_MIN_CHARS &&
    /^(the best answer|choose the best|pick the right|la meilleure réponse|choisir la bonne)/.test(
      criterion
    )
  ) {
    issues.push({
      optionIndex: -1,
      code: "question_rationale_criterion_vague",
      message:
        "decision_criterion restates the task instead of naming the axis that separates the four answers."
    });
  }

  return issues;
}

/**
 * The answer must not be findable from the shape of the options.
 *
 * Three tells, all of which a reader picks up within a few editions and none of
 * which require understanding the subject:
 *
 *   - the best answer is much longer than the rest;
 *   - it is the only one carrying a number;
 *   - it is the only one that states a condition.
 *
 * All three are checked only when there IS a distinct best option, and the
 * numeric and conditional checks fire only when the tell is exclusive — a
 * question where every option carries a figure is fine, and one where none does
 * is fine too.
 */
export function validateOptionShapeNeutrality(
  options: GradedQuestionOption[]
): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const best = bestOption(options);

  if (!best || options.some((option) => option.text.length < OPTION_MIN_CHARS)) {
    return issues;
  }

  const lengths = options.map((option) => option.text.length);
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);

  if (shortest > 0 && longest / shortest > OPTION_LENGTH_RATIO_MAX) {
    issues.push({
      optionIndex: lengths.indexOf(longest),
      code: "question_option_length_asymmetric",
      message: `Options run ${shortest}-${longest} characters; the four answers must not be told apart by length.`
    });
  }

  const numeric = options.filter((option) => NUMERIC_PATTERN.test(option.text));
  if (numeric.length === 1 && numeric[0] === best) {
    issues.push({
      optionIndex: options.indexOf(best),
      code: "question_best_option_only_numeric",
      message: "The best answer is the only option containing a figure, which gives it away."
    });
  }

  const conditional = options.filter((option) => CONDITIONAL_PATTERN.test(option.text));
  if (conditional.length === 1 && conditional[0] === best) {
    issues.push({
      optionIndex: options.indexOf(best),
      code: "question_best_option_only_conditional",
      message: "The best answer is the only option stating a condition, which gives it away."
    });
  }

  return issues;
}

/**
 * The questions of one content item, checked as a set.
 *
 * `expectedRoles` carries the whole per-surface contract: its length is the
 * required question count and its order is the required progression. That is why
 * a Mini Case cannot silently become a two-question quiz — the caller passes
 * three roles or it does not pass at all.
 */
export function validateQuestionSet(
  rawQuestions: unknown,
  expectedRoles: readonly QuestionRole[]
): Array<QuestionIssue & { questionIndex: number }> {
  const questions = normalizeQuestions(rawQuestions);
  const issues: Array<QuestionIssue & { questionIndex: number }> = [];

  if (questions.length !== expectedRoles.length) {
    issues.push({
      questionIndex: -1,
      optionIndex: -1,
      code: "question_option_count_invalid",
      message: `Expected exactly ${expectedRoles.length} questions, got ${questions.length}.`
    });
  }

  questions.forEach((question, questionIndex) => {
    const expectedRole = expectedRoles[questionIndex];
    if (!expectedRole) {
      return;
    }

    for (const issue of validateGradedQuestion(question, expectedRole)) {
      issues.push({ ...issue, questionIndex });
    }
  });

  return issues;
}

/**
 * Do two language renderings describe the same question?
 *
 * FR and EN are generated separately, so nothing but a check makes them the same
 * game. Parity is structural, never textual: same question ids in the same
 * order, same option ids, and the same id carrying the same tier in both. The
 * wording must differ — a French question that reads as a translation of the
 * English one is a different failure, and an editorial one.
 */
export function compareQuestionParity(
  frQuestions: unknown,
  enQuestions: unknown
): string[] {
  const fr = normalizeQuestions(frQuestions);
  const en = normalizeQuestions(enQuestions);
  const problems: string[] = [];

  if (fr.length !== en.length) {
    problems.push(`question count differs: fr=${fr.length}, en=${en.length}`);
    return problems;
  }

  fr.forEach((frQuestion, index) => {
    const enQuestion = en[index];

    if (frQuestion.id !== enQuestion.id) {
      problems.push(`question ${index + 1} id differs: fr=${frQuestion.id}, en=${enQuestion.id}`);
    }

    if (frQuestion.role !== enQuestion.role) {
      problems.push(
        `question ${index + 1} role differs: fr=${frQuestion.role}, en=${enQuestion.role}`
      );
    }

    const frTiers = new Map(frQuestion.options.map((option) => [option.id, option.score_milli]));
    const enTiers = new Map(enQuestion.options.map((option) => [option.id, option.score_milli]));

    if (frTiers.size !== enTiers.size) {
      problems.push(`question ${index + 1} option count differs`);
      return;
    }

    for (const [optionId, tier] of frTiers) {
      if (!enTiers.has(optionId)) {
        problems.push(`question ${index + 1} option ${optionId} is missing in en`);
        continue;
      }

      if (enTiers.get(optionId) !== tier) {
        problems.push(
          `question ${index + 1} option ${optionId} scores ${tier} in fr and ${enTiers.get(optionId)} in en`
        );
      }
    }

    // Identical option text across languages means one side was not written, it
    // was copied — which is the parity failure that looks like parity.
    frQuestion.options.forEach((frOption) => {
      const enOption = enQuestion.options.find((candidate) => candidate.id === frOption.id);
      if (
        enOption &&
        frOption.text.length > 0 &&
        normalizeOptionText(frOption.text) === normalizeOptionText(enOption.text)
      ) {
        problems.push(
          `question ${index + 1} option ${frOption.id} has identical fr and en text`
        );
      }
    });
  });

  return problems;
}
