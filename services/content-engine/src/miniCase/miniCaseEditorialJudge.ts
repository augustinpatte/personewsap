import type { Language, MiniCaseChallenge } from "../domain.js";
import {
  DEFAULT_CLASSIFIER_MODEL,
  DEFAULT_CLASSIFIER_REASONING_EFFORT,
  estimateCallCostUsd,
  hasVerifiedPricing
} from "../generation/modelRouting.js";
import type { LlmUsage } from "../generation/llmProvider.js";
import { OpenAiJsonProvider } from "../generation/openAiProvider.js";

/**
 * The semantic half of Mini Case QA.
 *
 * The deterministic guard is a list of families somebody thought of. It caught
 * "count news articles" and missed "packaging color", "brand age", "number of
 * countries where the brand is sold" and "debt levels of other countries" —
 * every miss for the same reason. Widening the list buys one more round; it
 * cannot answer the actual question, which is whether a wrong answer is a
 * mistake a competent junior would defend or a choice nobody would consider.
 *
 * That is a judgement, so it is judged — by the cheapest model in the routing
 * table, the same `gpt-5.6-luna` the source relevance gate already uses. Three
 * properties keep it affordable and safe:
 *
 *  - ONE call per Mini Case PAIR, not per question and not per language. Both
 *    language versions go in together, because FR/EN semantic parity is part of
 *    what has to be judged and cannot be seen one side at a time.
 *  - No reasoning, strict JSON schema, no prose. It returns verdicts; it never
 *    writes or rewrites content.
 *  - Fail closed. A call that errors, times out or answers unusably REJECTS the
 *    candidate. A judge that cannot judge must not wave things through — that is
 *    how the four unpublishable Business Stories reached a review file.
 *
 * The deterministic checks stay in front of it. An option this judge would have
 * caught anyway costs nothing when a regex catches it first.
 */

export type MiniCaseJudgeQuestionVerdict = {
  id: string;
  plausible_wrong_options: number;
  obviously_irrelevant_options: string[];
  correct_answer_too_obvious: boolean;
};

export type MiniCaseJudgeVerdict = {
  pass: boolean;
  questions: MiniCaseJudgeQuestionVerdict[];
  pair_semantic_parity: boolean;
  taxonomy_semantic_fit: boolean;
  /**
   * Whether the case teaches what its product topic promises.
   *
   * Distinct from `taxonomy_semantic_fit`, which asks whether the labels match
   * the case. This asks whether the case is worth being in that topic at all.
   *
   * The rejected "Le goulot d'étranglement des constitutions d'État" is why it
   * exists: sourced from a law article, filed with coherent law taxonomy, and
   * the decision it actually asked the reader to make was capacity planning. A
   * legal setting is not a legal lesson.
   */
  topic_promise_fit: boolean;
  topic_promise_reason: string;
  /** What the case genuinely makes the learner reason about. */
  tested_domain_mechanism: string;
  reasons: string[];
};

export type MiniCaseEditorialJudge = {
  model: string;
  judge: (input: MiniCaseJudgeRequest) => Promise<MiniCaseJudgeResult>;
};

export type MiniCaseJudgeRequest = {
  reference: { language: Language; item: MiniCaseChallenge };
  counterpart: { language: Language; item: MiniCaseChallenge };
};

export type MiniCaseJudgeResult = {
  verdict: MiniCaseJudgeVerdict;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costVerified: boolean;
};

const JUDGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "pass",
    "questions",
    "pair_semantic_parity",
    "taxonomy_semantic_fit",
    "topic_promise_fit",
    "topic_promise_reason",
    "tested_domain_mechanism",
    "reasons"
  ],
  properties: {
    pass: { type: "boolean" },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "plausible_wrong_options",
          "obviously_irrelevant_options",
          "correct_answer_too_obvious"
        ],
        properties: {
          id: { type: "string" },
          plausible_wrong_options: { type: "number" },
          obviously_irrelevant_options: { type: "array", items: { type: "string" } },
          correct_answer_too_obvious: { type: "boolean" }
        }
      }
    },
    pair_semantic_parity: { type: "boolean" },
    taxonomy_semantic_fit: { type: "boolean" },
    topic_promise_fit: { type: "boolean" },
    topic_promise_reason: { type: "string" },
    tested_domain_mechanism: { type: "string" },
    reasons: { type: "array", items: { type: "string" } }
  }
};

const JUDGE_SYSTEM_PROMPT =
  "You are an editorial QA reviewer for multiple-choice business cases. You judge whether wrong answers are credible professional mistakes, whether the correct answer can be found without reading the case, whether the two language versions represent the same reasoning exercise, whether the taxonomy fits, and whether the case teaches what its product topic promises. You return verdicts only. You never write, rewrite or suggest content.";

/**
 * What a topic has to make the learner actually reason about.
 *
 * Only `law_compliance` is specified here, because only it has a demonstrated
 * failure: a case sourced from a law article, filed with coherent law taxonomy,
 * whose decision was capacity planning. Every other topic gets the generic
 * question. Writing rules for all six on the strength of one incident would be
 * guessing.
 */
const TOPIC_PROMISE_RULES: Partial<Record<string, string>> = {
  law_compliance:
    "This is a Law & Compliance case. topic_promise_fit is true ONLY if the decision the learner makes requires practical legal or compliance reasoning: the applicability or scope of a rule, a legal, regulatory or contractual obligation, a documentation or evidence requirement, a procedural step, a filing, notice or authorization requirement, enforcement exposure, liability, a compliance control, the interpretation of a legal threshold, a conflict between legal constraints, or a decision under regulatory uncertainty. A legal SETTING is not a legal lesson: set topic_promise_fit false when the real lesson is generic capacity planning, generic operations, project management, productivity, public popularity, political ideology, constitutional philosophy, legal civics or abstract jurisprudential debate — even when the source is a court, a regulator or a statute. Operational constraints may be present; what matters is whether the decision turns on a legal or compliance rule."
};

/** The production judge: one cheap model, structured output, no reasoning. */
export function createLunaMiniCaseEditorialJudge(
  options: { model?: string; maxOutputTokens?: number } = {}
): MiniCaseEditorialJudge {
  const model = options.model ?? DEFAULT_CLASSIFIER_MODEL;
  let lastCompletion: { model: string; usage: LlmUsage } | null = null;
  const provider = new OpenAiJsonProvider({
    model,
    reasoningEffort: DEFAULT_CLASSIFIER_REASONING_EFFORT,
    disableFallback: true,
    onRequestCompletion: (completion) => {
      lastCompletion = { model: completion.model, usage: completion.usage };
    }
  });

  return {
    model,
    async judge(request) {
      lastCompletion = null;

      const payload = await provider.generateJson({
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        userPrompt: buildMiniCaseJudgePrompt(request),
        jsonSchema: JUDGE_SCHEMA,
        schemaName: "mini_case_editorial_qa",
        maxOutputTokens: options.maxOutputTokens ?? 1_200
      });
      const completion = lastCompletion as { model: string; usage: LlmUsage } | null;

      return {
        verdict: parseJudgeVerdict(payload),
        inputTokens: completion?.usage.inputTokens ?? null,
        outputTokens: completion?.usage.outputTokens ?? null,
        costUsd: completion ? estimateCallCostUsd(completion.model, completion.usage) : null,
        costVerified: hasVerifiedPricing(model)
      };
    }
  };
}

/**
 * Compact prompt: the case once, both languages' questions, the taxonomy.
 *
 * Option ids carry the whole FR/EN parity question — the reasoning mistake
 * behind id B must be the same mistake in both languages, however differently it
 * is worded — so they are shown side by side rather than as two separate cases.
 */
export function buildMiniCaseJudgePrompt(request: MiniCaseJudgeRequest): string {
  const { reference, counterpart } = request;
  const item = reference.item;

  return JSON.stringify(
    {
      task: "Judge this Mini Case pair. Return verdicts only.",
      rules: [
        "A wrong option must be a mistake a competent junior professional could defend in a meeting.",
        "List in obviously_irrelevant_options the id of any wrong option a reader could dismiss without reading the case, or that belongs to a different decision space than the question.",
        "Set correct_answer_too_obvious when the correct option is the only professionally plausible choice, or is identifiable by being the longest, most technical or most cautious.",
        "Set pair_semantic_parity false when option id B, C or D does not represent the SAME reasoning mistake in both languages. Idiomatic rewording is expected and fine; a different exercise is not.",
        "Set taxonomy_semantic_fit false when scenario_type or concept_tested names a mechanism the case does not contain.",
        "Set topic_promise_fit false when the case does not make the learner reason about what its product_topic promises. Being SET in a domain is not the same as TESTING that domain.",
        "Put in tested_domain_mechanism the mechanism the case genuinely makes the learner reason about, in a few words, whatever the labels claim.",
        "Put in topic_promise_reason one sentence explaining the topic_promise_fit verdict.",
        "pass must be false if any question has fewer than 3 plausible wrong options, any obviously_irrelevant_options is non-empty, any correct_answer_too_obvious is true, or any of the parity, taxonomy or topic-promise flags is false.",
        ...(TOPIC_PROMISE_RULES[String(item.product_topic)]
          ? [TOPIC_PROMISE_RULES[String(item.product_topic)] as string]
          : [])
      ],
      taxonomy: {
        product_topic: item.product_topic,
        scenario_type: item.scenario_type,
        decision_type: item.decision_type,
        concept_tested: item.concept_tested
      },
      case: {
        context: item.context,
        challenge: item.challenge
      },
      versions: [reference, counterpart].map((version) => ({
        language: version.language,
        questions: (Array.isArray(version.item.questions) ? version.item.questions : []).map(
          (question, index) => ({
            id: question.id || `q${index + 1}`,
            question: question.question,
            options: (Array.isArray(question.options) ? question.options : []).map((option) => ({
              id: option.id,
              text: option.text,
              is_correct: option.is_correct
            }))
          })
        )
      }))
    },
    null,
    1
  );
}

/**
 * Defensive parse.
 *
 * A malformed answer is a failed judgement, not a pass. Anything missing or the
 * wrong shape produces a rejecting verdict that says so.
 */
export function parseJudgeVerdict(payload: unknown): MiniCaseJudgeVerdict {
  const rejected = (reason: string): MiniCaseJudgeVerdict => ({
    pass: false,
    questions: [],
    pair_semantic_parity: false,
    taxonomy_semantic_fit: false,
    topic_promise_fit: false,
    topic_promise_reason: reason,
    tested_domain_mechanism: "",
    reasons: [reason]
  });

  if (typeof payload !== "object" || payload === null) {
    return rejected("editorial judge returned no object");
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.pass !== "boolean") {
    return rejected("editorial judge returned no verdict");
  }

  const questions = Array.isArray(record.questions)
    ? record.questions.flatMap((entry): MiniCaseJudgeQuestionVerdict[] => {
        if (typeof entry !== "object" || entry === null) {
          return [];
        }

        const question = entry as Record<string, unknown>;

        return [
          {
            id: typeof question.id === "string" ? question.id : "",
            plausible_wrong_options:
              typeof question.plausible_wrong_options === "number"
                ? question.plausible_wrong_options
                : 0,
            obviously_irrelevant_options: Array.isArray(question.obviously_irrelevant_options)
              ? question.obviously_irrelevant_options.filter(
                  (value): value is string => typeof value === "string"
                )
              : [],
            correct_answer_too_obvious: question.correct_answer_too_obvious === true
          }
        ];
      })
    : [];

  return {
    pass: record.pass,
    questions,
    pair_semantic_parity: record.pair_semantic_parity !== false,
    taxonomy_semantic_fit: record.taxonomy_semantic_fit !== false,
    topic_promise_fit: record.topic_promise_fit !== false,
    topic_promise_reason:
      typeof record.topic_promise_reason === "string" ? record.topic_promise_reason : "",
    tested_domain_mechanism:
      typeof record.tested_domain_mechanism === "string" ? record.tested_domain_mechanism : "",
    reasons: Array.isArray(record.reasons)
      ? record.reasons.filter((value): value is string => typeof value === "string")
      : []
  };
}

/**
 * Turn a verdict into the reasons a candidate is refused.
 *
 * Applied independently of the model's own `pass`, because the per-question
 * fields are the ones that carry the detail an operator can act on — and a model
 * that sets `pass: true` while reporting an irrelevant option has contradicted
 * itself and must not be believed.
 */
export function judgeRejectionReasons(verdict: MiniCaseJudgeVerdict): string[] {
  const reasons: string[] = [];

  for (const question of verdict.questions) {
    if (question.obviously_irrelevant_options.length > 0) {
      reasons.push(
        `${question.id}: option(s) ${question.obviously_irrelevant_options.join(", ")} can be dismissed without reading the case.`
      );
    }

    if (question.plausible_wrong_options < 3) {
      reasons.push(
        `${question.id}: only ${question.plausible_wrong_options} of the 3 wrong options are credible professional mistakes.`
      );
    }

    if (question.correct_answer_too_obvious) {
      reasons.push(`${question.id}: the correct answer is identifiable without the case.`);
    }
  }

  if (!verdict.pair_semantic_parity) {
    reasons.push(
      "The two language versions do not represent the same reasoning exercise: an option id stands for a different mistake in each language."
    );
  }

  if (!verdict.taxonomy_semantic_fit) {
    reasons.push("The taxonomy names a mechanism the case does not contain.");
  }

  if (!verdict.topic_promise_fit) {
    const detail = verdict.topic_promise_reason.trim();
    const tested = verdict.tested_domain_mechanism.trim();

    reasons.push(
      `The case does not teach what its topic promises${tested ? ` — it actually tests ${tested}` : ""}.${detail ? ` ${detail}` : ""}`
    );
  }

  if (reasons.length === 0 && !verdict.pass) {
    reasons.push(...(verdict.reasons.length > 0 ? verdict.reasons : ["editorial judge refused the case"]));
  }

  return reasons;
}
