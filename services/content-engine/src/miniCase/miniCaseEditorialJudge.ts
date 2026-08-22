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
  required: ["pass", "questions", "pair_semantic_parity", "taxonomy_semantic_fit", "reasons"],
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
    reasons: { type: "array", items: { type: "string" } }
  }
};

const JUDGE_SYSTEM_PROMPT =
  "You are an editorial QA reviewer for multiple-choice business cases. You judge whether wrong answers are credible professional mistakes, whether the correct answer can be found without reading the case, whether the two language versions represent the same reasoning exercise, and whether the taxonomy fits. You return verdicts only. You never write, rewrite or suggest content.";

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
        "pass must be false if any question has fewer than 3 plausible wrong options, any obviously_irrelevant_options is non-empty, any correct_answer_too_obvious is true, or either parity flag is false."
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

  if (reasons.length === 0 && !verdict.pass) {
    reasons.push(...(verdict.reasons.length > 0 ? verdict.reasons : ["editorial judge refused the case"]));
  }

  return reasons;
}
