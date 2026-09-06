/**
 * What a review verdict costs.
 *
 * The Reviewer already had three attempts and a rule about the third one: at the
 * last pass it fixes a local sentence itself rather than asking for a fourth
 * generation that will not happen. This extends that rule to the questions, and
 * — more importantly — stops a bad question from costing a good article.
 *
 * THE PROBLEM THIS SOLVES
 *
 * A newsletter article is now three separable things in one job: the article,
 * question 1 and question 2. Before this, a review was one verdict over the
 * whole output, so "Q2's distractors are too easy" meant `revision_required` on
 * the job, and the Generator rewrote the article too. The article was fine. The
 * pipeline currently produces the 16 newsletters correctly on the first try, and
 * regenerating good prose to fix a question is exactly how that stops being
 * true.
 *
 * So findings carry a scope, and the response is decided from the set of scopes
 * that failed:
 *
 *   attempt 1  any failure          -> revision_required, targeted at the
 *                                      failing scopes only
 *   attempt 2  same
 *   attempt 3  content still failing -> failed. There is no attempt 4, and a
 *                                      Reviewer must not rewrite an article.
 *   attempt 3  only questions failing-> the Reviewer repairs the options itself,
 *                                      revalidates, and approves if the repair
 *                                      holds.
 *
 * The asymmetry at attempt 3 is deliberate and is the whole point. Repairing an
 * option is a bounded, checkable edit against a written decision criterion:
 * swap a distractor, shorten the option that towers, restore the missing tier.
 * Rewriting an article at the last pass is not bounded and not checkable, which
 * is why it stays out of scope and the job simply fails.
 */

export const MAX_GENERATION_ATTEMPTS = 3;

/**
 * The separable parts of one generation job.
 *
 * `question_3` exists only for Mini Cases; nothing here has to know that,
 * because the scopes a job can report are derived from its own questions.
 */
export const REVIEW_SCOPES = [
  "content",
  "question_1",
  "question_2",
  "question_3"
] as const;

export type ReviewScope = (typeof REVIEW_SCOPES)[number];

export function questionScope(questionIndex: number): ReviewScope {
  return `question_${questionIndex + 1}` as ReviewScope;
}

export function isQuestionScope(scope: ReviewScope): boolean {
  return scope !== "content";
}

export type ReviewFinding = {
  scope: ReviewScope;
  code: string;
  message: string;
  /**
   * Whether this specific finding is one a Reviewer may fix itself at the last
   * attempt. Structural question defects are; anything touching the editorial
   * substance of the reading is not.
   */
  repairable: boolean;
};

/**
 * Which question defects a Reviewer may repair directly at attempt 3.
 *
 * Every code here describes a *shape* failure with a mechanical remedy that can
 * be re-checked by the same deterministic validator afterwards. Codes describing
 * a judgement failure are deliberately absent: if the ranking itself is
 * indefensible, no minimal edit fixes it and approving it would be worse than
 * publishing nothing.
 */
const REVIEWER_REPAIRABLE_CODES = new Set([
  "question_option_text_duplicated",
  "question_option_id_duplicated",
  "question_option_id_missing",
  "question_score_tier_set_invalid",
  "question_score_tier_invalid",
  "question_feedback_missing",
  "question_feedback_too_long",
  "question_option_length_asymmetric",
  "question_best_option_only_numeric",
  "question_best_option_only_conditional"
]);

export function isReviewerRepairableCode(code: string): boolean {
  return REVIEWER_REPAIRABLE_CODES.has(code);
}

export function reviewFinding(input: {
  scope: ReviewScope;
  code: string;
  message: string;
}): ReviewFinding {
  return {
    ...input,
    // Content is never reviewer-repairable, whatever the code says. A rewrite is
    // not a repair.
    repairable: isQuestionScope(input.scope) && isReviewerRepairableCode(input.code)
  };
}

export type ReviewVerdict = "approved" | "revision_required" | "reviewer_repair" | "failed";

export type ReviewDecision = {
  verdict: ReviewVerdict;
  /** The scopes the Generator (or the Reviewer) must act on. Empty when approved. */
  targets: ReviewScope[];
  /** True only for `reviewer_repair`: the Reviewer edits these itself. */
  repairTargets: ReviewScope[];
  /** True when the content itself must be regenerated. */
  regenerateContent: boolean;
  reason: string;
};

/**
 * The decision, from the findings and the attempt number.
 *
 * Pure, and deliberately so: this is the rule the prompts describe in prose, and
 * having it as a function means the prose and the pipeline can be checked
 * against each other instead of drifting.
 */
export function decideReview(input: {
  attempt: number;
  findings: ReviewFinding[];
}): ReviewDecision {
  const attempt = Math.max(1, Math.trunc(input.attempt));
  const findings = input.findings ?? [];

  if (findings.length === 0) {
    return {
      verdict: "approved",
      targets: [],
      repairTargets: [],
      regenerateContent: false,
      reason: "every scope passed"
    };
  }

  const failingScopes = orderScopes(new Set(findings.map((finding) => finding.scope)));
  const contentFailed = failingScopes.includes("content");
  const questionScopes = failingScopes.filter(isQuestionScope);

  if (attempt < MAX_GENERATION_ATTEMPTS) {
    // Targeted, always. Handing back "the article and both questions" when only
    // Q2 failed is what makes a good article get rewritten.
    return {
      verdict: "revision_required",
      targets: failingScopes,
      repairTargets: [],
      regenerateContent: contentFailed,
      reason: `attempt ${attempt}: ${failingScopes.join(", ")} need revision`
    };
  }

  if (contentFailed) {
    // Last attempt, and the reading itself is not publishable. There is no
    // attempt 4 and a Reviewer does not write articles.
    return {
      verdict: "failed",
      targets: failingScopes,
      repairTargets: [],
      regenerateContent: false,
      reason: "final attempt: content still fails and a reviewer may not rewrite it"
    };
  }

  const unrepairable = findings.filter((finding) => !finding.repairable);

  if (unrepairable.length > 0) {
    return {
      verdict: "failed",
      targets: failingScopes,
      repairTargets: [],
      regenerateContent: false,
      reason: `final attempt: ${unrepairable
        .map((finding) => `${finding.scope}/${finding.code}`)
        .join(", ")} cannot be repaired by a minimal edit`
    };
  }

  return {
    verdict: "reviewer_repair",
    targets: questionScopes,
    repairTargets: questionScopes,
    regenerateContent: false,
    reason: `final attempt: repairing ${questionScopes.join(", ")} in place rather than requesting a fourth generation`
  };
}

function orderScopes(scopes: Set<ReviewScope>): ReviewScope[] {
  return REVIEW_SCOPES.filter((scope) => scopes.has(scope));
}

/**
 * The instruction the Generator receives on a `revision_required`.
 *
 * Explicit about what NOT to touch, because "fix Q2" and "here is the whole
 * output again" read the same way to a model unless the untouched scopes are
 * named. The existing rubric already demands WHAT / WHERE / WHY / HOW TO VERIFY;
 * this adds the fifth line the scoped model needs: WHAT TO LEAVE ALONE.
 */
export function formatRevisionInstruction(input: {
  decision: ReviewDecision;
  allScopes: ReviewScope[];
  findings: ReviewFinding[];
}): string {
  const { decision, findings } = input;
  const untouched = input.allScopes.filter((scope) => !decision.targets.includes(scope));

  const lines: string[] = [];
  lines.push(`VERDICT: ${decision.verdict}`);
  lines.push(`SCOPES TO FIX: ${decision.targets.join(", ") || "none"}`);
  lines.push(
    `DO NOT REGENERATE: ${untouched.join(", ") || "none"}${
      untouched.length > 0 ? " — resubmit these byte-for-byte" : ""
    }`
  );

  for (const scope of decision.targets) {
    const scopeFindings = findings.filter((finding) => finding.scope === scope);
    lines.push(`  ${scope}:`);
    for (const finding of scopeFindings) {
      lines.push(`    - [${finding.code}] ${finding.message}`);
    }
  }

  return lines.join("\n");
}

/**
 * The scopes a job of a given content type has, so a decision can name the ones
 * it is leaving alone.
 */
export function scopesForQuestionCount(questionCount: number): ReviewScope[] {
  const scopes: ReviewScope[] = ["content"];
  for (let index = 0; index < questionCount; index += 1) {
    scopes.push(questionScope(index));
  }
  return scopes;
}
