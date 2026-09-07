/**
 * The third pass, made checkable.
 *
 * `questionRevisionScope.decideReview` already says WHEN the Reviewer may repair
 * a question itself: attempt 3, the content passed, and every remaining finding
 * is a shape defect with a mechanical remedy. What it cannot say is whether the
 * repair the Reviewer actually performed was a repair.
 *
 * That gap matters more than it looks. "Fix Q2 and approve" is an instruction to
 * an agent holding the whole output, and the cheapest way for any model to make
 * a validator pass is to rewrite more than it was asked to. A Reviewer that
 * quietly tightened a paragraph while fixing a distractor would produce an
 * edition that passes every downstream check and is no longer the article that
 * was reviewed and approved at the content scope.
 *
 * So the repair is applied through an envelope rather than trusted:
 *
 *   1. everything that is not the repaired questions must be BYTE-IDENTICAL —
 *      body, title, summary, sources, editorial memory, the lot;
 *   2. the questions that were not in scope must be byte-identical too;
 *   3. the repaired questions must pass the same deterministic validator that
 *      produced the findings in the first place;
 *   4. FR/EN parity must still hold, because a repair applied to one language
 *      and not the other is how two team-mates end up playing different games.
 *
 * Only then is the verdict `approved`. Anything else is `failed`, and there is
 * no attempt 4 — which is the point: the pipeline would rather publish nothing
 * than publish an article nobody reviewed.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *
 * It does not write the repair. Swapping a towering distractor for a shorter one
 * that is still wrong for an interesting reason is an editorial act, and a
 * function that generated replacement prose would be inventing the judgement the
 * Reviewer exists to supply. This checks the edit; it does not make it.
 */

import {
  MINI_CASE_QUESTION_ROLES,
  READING_QUESTION_ROLES,
  compareQuestionParity,
  validateQuestionSet,
  type QuestionRole
} from "./gradedQuestions.js";
import {
  MAX_GENERATION_ATTEMPTS,
  isQuestionScope,
  questionScope,
  type ReviewScope
} from "./questionRevisionScope.js";

/** The roles a content type's question set must carry, in order. */
export function expectedRolesForContentType(contentType: string): readonly QuestionRole[] {
  return contentType === "mini_case" ? MINI_CASE_QUESTION_ROLES : READING_QUESTION_ROLES;
}

/**
 * One language half of a generation output.
 *
 * Typed as an open record on purpose: this module compares halves, it does not
 * interpret them, and naming the twenty-odd editorial fields here would mean
 * updating this file every time the schema gains one.
 */
export type OutputHalf = Record<string, unknown> & { questions?: unknown };

export type GenerationOutput = {
  fr: OutputHalf;
  en: OutputHalf;
};

export type RepairViolation = {
  code:
    | "content_mutated"
    | "untouched_question_mutated"
    | "question_still_invalid"
    | "parity_broken"
    | "repair_out_of_scope"
    | "question_count_changed"
    | "not_final_attempt";
  scope: ReviewScope | null;
  message: string;
};

export type RepairOutcome = {
  verdict: "approved" | "failed";
  violations: RepairViolation[];
  /** The output to publish. The repaired one when approved, never otherwise. */
  output: GenerationOutput | null;
  reason: string;
};

/** Stable, key-order-independent equality for two editorial values. */
function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * JSON with object keys sorted, recursively.
 *
 * `JSON.stringify` preserves insertion order, so a round trip through a model
 * that re-emitted the same object with its keys in a different order would read
 * as a mutation. Key order is not content; the values are.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function questionsOf(half: OutputHalf): unknown[] {
  return Array.isArray(half.questions) ? (half.questions as unknown[]) : [];
}

/** Everything except the questions — the part a repair may not touch. */
function withoutQuestions(half: OutputHalf): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...half };
  delete copy.questions;
  return copy;
}

/**
 * Check and apply a third-pass Reviewer repair.
 *
 * `repairScopes` is the decision's `repairTargets`, so a Reviewer that edited a
 * question nobody asked it to edit is caught by scope rather than by luck.
 */
export function applyReviewerQuestionRepair(input: {
  attempt: number;
  contentType: string;
  original: GenerationOutput;
  repaired: GenerationOutput;
  repairScopes: ReviewScope[];
}): RepairOutcome {
  const { contentType, original, repaired } = input;
  const violations: RepairViolation[] = [];
  const expectedRoles = expectedRolesForContentType(contentType);

  // The rule this whole mechanism exists to serve. A "repair" offered at attempt
  // 1 is a revision, and revisions go back to the Generator with a scope.
  if (input.attempt !== MAX_GENERATION_ATTEMPTS) {
    violations.push({
      code: "not_final_attempt",
      scope: null,
      message: `a reviewer repair is only available at attempt ${MAX_GENERATION_ATTEMPTS}, not ${input.attempt}`
    });
  }

  const repairScopes = input.repairScopes.filter(isQuestionScope);

  if (repairScopes.length !== input.repairScopes.length) {
    violations.push({
      code: "repair_out_of_scope",
      scope: "content",
      message: "a reviewer repair may never target the content scope"
    });
  }

  for (const language of ["fr", "en"] as const) {
    const before = original[language] ?? {};
    const after = repaired[language] ?? {};

    // (1) Everything that is not a question. This is the assertion that keeps a
    // good article good.
    if (!sameValue(withoutQuestions(before), withoutQuestions(after))) {
      violations.push({
        code: "content_mutated",
        scope: "content",
        message: `${language}: the repair changed something outside the questions`
      });
    }

    const beforeQuestions = questionsOf(before);
    const afterQuestions = questionsOf(after);

    if (beforeQuestions.length !== afterQuestions.length) {
      violations.push({
        code: "question_count_changed",
        scope: null,
        message: `${language}: question count went from ${beforeQuestions.length} to ${afterQuestions.length}`
      });
      continue;
    }

    // (2) The questions nobody asked about. A repair to Q2 that also "improved"
    // Q1 is a rewrite wearing a repair's clothes.
    beforeQuestions.forEach((question, index) => {
      const scope = questionScope(index);
      if (repairScopes.includes(scope)) {
        return;
      }

      if (!sameValue(question, afterQuestions[index])) {
        violations.push({
          code: "untouched_question_mutated",
          scope,
          message: `${language}: ${scope} was not in scope but changed`
        });
      }
    });

    // (3) The same validator that found the defect, run again on the fix.
    const issues = validateQuestionSet(afterQuestions, expectedRoles);

    for (const issue of issues) {
      violations.push({
        code: "question_still_invalid",
        scope: issue.questionIndex >= 0 ? questionScope(issue.questionIndex) : null,
        message: `${language}: ${issue.code} — ${issue.message}`
      });
    }
  }

  // (4) Parity, last, because it is only meaningful once both halves are valid
  // on their own.
  for (const problem of compareQuestionParity(
    questionsOf(repaired.fr ?? {}),
    questionsOf(repaired.en ?? {})
  )) {
    violations.push({ code: "parity_broken", scope: null, message: problem });
  }

  if (violations.length > 0) {
    return {
      verdict: "failed",
      violations,
      output: null,
      reason: `reviewer repair rejected: ${violations.map((violation) => violation.code).join(", ")}`
    };
  }

  return {
    verdict: "approved",
    violations: [],
    output: repaired,
    reason: `reviewer repaired ${repairScopes.join(", ") || "nothing"} at the final attempt; content byte-identical`
  };
}

/**
 * Did a question-only revision leave the reading alone?
 *
 * The same property as above, applied to a Generator's `revision_required`
 * resubmission rather than to a Reviewer's own edit. Both paths have the same
 * failure mode — a model handed the whole output and asked to change part of it
 * — so both are checked the same way rather than one being trusted.
 */
export function contentSurvivedRevision(input: {
  before: GenerationOutput;
  after: GenerationOutput;
}): { unchanged: boolean; changedLanguages: string[] } {
  const changedLanguages: string[] = [];

  for (const language of ["fr", "en"] as const) {
    const before = withoutQuestions(input.before[language] ?? {});
    const after = withoutQuestions(input.after[language] ?? {});

    if (!sameValue(before, after)) {
      changedLanguages.push(language);
    }
  }

  return { unchanged: changedLanguages.length === 0, changedLanguages };
}
