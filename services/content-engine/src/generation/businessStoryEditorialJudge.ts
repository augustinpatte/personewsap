import type { BusinessStory, Language } from "../domain.js";
import {
  DEFAULT_CLASSIFIER_MODEL,
  DEFAULT_CLASSIFIER_REASONING_EFFORT,
  estimateCallCostUsd,
  hasVerifiedPricing
} from "./modelRouting.js";
import type { LlmUsage } from "./llmProvider.js";
import { OpenAiJsonProvider } from "./openAiProvider.js";

/**
 * The semantic half of Business Story QA.
 *
 * `businessStorySubstance` catches a story that says in so many words that it
 * has nothing to say. The latest replace batch produced two candidates it could
 * not catch:
 *
 *   BS-04  said the source does not describe the Treasury measure, that no
 *          amount, duration or channel is known, and that the operational
 *          trade-off cannot be established — none of it in the phrasings the
 *          regexes knew.
 *   BS-02  was a competent, well-sourced piece about US–Canada trade
 *          negotiations, 50% tariffs and dollar-for-dollar retaliation. Nothing
 *          about it was self-refuting. It simply must not be in this product.
 *
 * Neither is reachable by adding more phrases. The first is a paraphrase away
 * from any blocklist; the second is not a wording problem at all — it is a
 * subject-matter judgement about whether a piece is economics or politics.
 *
 * So the same cheap model that judges Mini Cases judges these, with the same
 * three properties: one call per finished pair, no reasoning and strict JSON,
 * and fail closed — an unavailable judge is a refusal, never a pass.
 *
 * The deterministic gates stay in front. Richness refuses a thin packet before
 * generation, substance refuses a self-refuting draft after it, and this
 * catches what neither can see.
 */

export type BusinessStoryJudgeVerdict = {
  pass: boolean;
  /** A real mechanism is explained, not merely an event reported. */
  business_mechanism_substantive: boolean;
  /** The sources carry what the story claims. */
  source_support_sufficient: boolean;
  /** The piece is really a note asking for more evidence. */
  editorial_self_refusal: boolean;
  /** Absent a counterpart, reported true: there is no second version to differ from. */
  fr_en_semantic_parity: boolean;
  /** True when the piece stays out of political and geopolitical subject matter. */
  political_geopolitical_exclusion_pass: boolean;
  topic_promise_fit: boolean;
  reasons: string[];
};

export type BusinessStoryJudgeRequest = {
  reference: { language: Language; item: BusinessStory };
  /**
   * The other half of the pair.
   *
   * Present for a catalog repair, which builds FR and EN together. Absent in
   * the daily job, which generates each language as its own independent run —
   * there is no pair there, and parity is not a question that can be asked.
   */
  counterpart?: { language: Language; item: BusinessStory };
};

export type BusinessStoryJudgeResult = {
  verdict: BusinessStoryJudgeVerdict;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costVerified: boolean;
};

export type BusinessStoryEditorialJudge = {
  model: string;
  judge: (input: BusinessStoryJudgeRequest) => Promise<BusinessStoryJudgeResult>;
};

const JUDGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "pass",
    "business_mechanism_substantive",
    "source_support_sufficient",
    "editorial_self_refusal",
    "fr_en_semantic_parity",
    "political_geopolitical_exclusion_pass",
    "topic_promise_fit",
    "reasons"
  ],
  properties: {
    pass: { type: "boolean" },
    business_mechanism_substantive: { type: "boolean" },
    source_support_sufficient: { type: "boolean" },
    editorial_self_refusal: { type: "boolean" },
    fr_en_semantic_parity: { type: "boolean" },
    political_geopolitical_exclusion_pass: { type: "boolean" },
    topic_promise_fit: { type: "boolean" },
    reasons: { type: "array", items: { type: "string" } }
  }
};

const JUDGE_SYSTEM_PROMPT =
  "You are an editorial QA reviewer for short business-education stories. You judge whether a story explains a real business mechanism, whether its sources support what it claims, whether it is really a note asking for more evidence, whether its two language versions match, and whether its subject matter belongs in a business-education product rather than a political one. You return verdicts only. You never write, rewrite or suggest content.";

/**
 * The exclusion, stated as the editorial policy rather than as a topic list.
 *
 * The distinction that matters is not the vocabulary but what the piece is
 * ABOUT. A tariff can be the input to a margin problem; a tariff war between two
 * governments is a political story with business words in it. The first belongs
 * here, the second does not, and only reading the piece can tell them apart.
 */
const POLITICAL_EXCLUSION_RULE = [
  "Set political_geopolitical_exclusion_pass FALSE when the story's subject is domestic politics, partisan politics, election politics, geopolitical confrontation, diplomatic conflict, war, culture-war content, or tariffs and trade retaliation framed as a conflict between governments.",
  "Set it TRUE for neutral macroeconomics, markets, interest rates, sovereign debt, central-bank and Federal Reserve actions, commercial regulation and company regulation — whenever the lesson the reader takes away is economic or managerial rather than political.",
  "The test is what the piece is ABOUT, not which words it contains. A tariff that is an input to a company's margin decision is economics. A negotiation between two governments trading retaliatory tariffs is politics, however carefully it is written."
].join(" ");

export function createLunaBusinessStoryEditorialJudge(
  options: { model?: string; maxOutputTokens?: number } = {}
): BusinessStoryEditorialJudge {
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
        userPrompt: buildBusinessStoryJudgePrompt(request),
        jsonSchema: JUDGE_SCHEMA,
        schemaName: "business_story_editorial_qa",
        maxOutputTokens: options.maxOutputTokens ?? 900
      });
      const completion = lastCompletion as { model: string; usage: LlmUsage } | null;

      return {
        verdict: parseBusinessStoryJudgeVerdict(payload, { paired: Boolean(request.counterpart) }),
        inputTokens: completion?.usage.inputTokens ?? null,
        outputTokens: completion?.usage.outputTokens ?? null,
        costUsd: completion ? estimateCallCostUsd(completion.model, completion.usage) : null,
        costVerified: hasVerifiedPricing(model)
      };
    }
  };
}

export function buildBusinessStoryJudgePrompt(request: BusinessStoryJudgeRequest): string {
  const versions = [request.reference, ...(request.counterpart ? [request.counterpart] : [])];

  return JSON.stringify(
    {
      task: "Judge this Business Story. Return verdicts only.",
      rules: [
        "Set business_mechanism_substantive false when the piece reports that something happened without explaining a pricing, cost, capacity, distribution, competitive, contractual, financing or regulatory mechanism behind it.",
        "Set source_support_sufficient false when the story cannot establish the trade-off, mechanism or outcome it is about — for example when it states that the amount, duration, channel, counterparty or commercial effect is unknown.",
        "Set editorial_self_refusal true when the piece is effectively a note asking for more evidence: when its main lesson is that the evidence is insufficient, that the mechanism remains to be documented, or that another source is needed before anything can be concluded.",
        request.counterpart
          ? "Set fr_en_semantic_parity false when the two language versions differ materially in facts, mechanism, decision or conclusion. Idiomatic rewording is expected and fine."
          : "There is only one language version here. Set fr_en_semantic_parity true.",
        POLITICAL_EXCLUSION_RULE,
        "Set topic_promise_fit false when the piece does not teach a business lesson an ambitious young professional could reuse.",
        "pass must be false if any of the boolean checks fails or editorial_self_refusal is true.",
        "Put a short sentence in reasons for every check you failed."
      ],
      versions: versions.map((version) => ({
        language: version.language,
        title: version.item.title,
        company_or_market: version.item.company_or_market,
        key_mechanism: version.item.editorial_memory?.key_mechanism ?? null,
        setup: version.item.setup,
        tension: version.item.tension,
        decision: version.item.decision,
        outcome: version.item.outcome,
        lesson: version.item.lesson,
        body: version.item.body_md
      }))
    },
    null,
    1
  );
}

/**
 * Defensive parse. A malformed answer is a failed judgement, not a pass.
 *
 * Every boolean defaults to the REFUSING value when absent, so a truncated or
 * partial answer cannot let a story through by omission.
 */
export function parseBusinessStoryJudgeVerdict(
  payload: unknown,
  options: { paired: boolean } = { paired: false }
): BusinessStoryJudgeVerdict {
  const rejected = (reason: string): BusinessStoryJudgeVerdict => ({
    pass: false,
    business_mechanism_substantive: false,
    source_support_sufficient: false,
    editorial_self_refusal: true,
    fr_en_semantic_parity: false,
    political_geopolitical_exclusion_pass: false,
    topic_promise_fit: false,
    reasons: [reason]
  });

  if (typeof payload !== "object" || payload === null) {
    return rejected("business story editorial judge returned no object");
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.pass !== "boolean") {
    return rejected("business story editorial judge returned no verdict");
  }

  return {
    pass: record.pass,
    business_mechanism_substantive: record.business_mechanism_substantive === true,
    source_support_sufficient: record.source_support_sufficient === true,
    editorial_self_refusal: record.editorial_self_refusal === true,
    // Unpaired generation has no second version, so parity cannot be judged and
    // must not be able to fail the story on its own.
    fr_en_semantic_parity: options.paired ? record.fr_en_semantic_parity === true : true,
    political_geopolitical_exclusion_pass: record.political_geopolitical_exclusion_pass === true,
    topic_promise_fit: record.topic_promise_fit === true,
    reasons: Array.isArray(record.reasons)
      ? record.reasons.filter((value): value is string => typeof value === "string")
      : []
  };
}

/**
 * Turn a verdict into the reasons a story is refused.
 *
 * Read from the individual checks rather than from `pass`, so a model that
 * reports a failed check while claiming to pass has contradicted itself and is
 * not believed.
 */
export function businessStoryJudgeRejectionReasons(verdict: BusinessStoryJudgeVerdict): string[] {
  const reasons: string[] = [];

  if (!verdict.political_geopolitical_exclusion_pass) {
    reasons.push(
      "The subject is political or geopolitical rather than economic. PersoNewsAP teaches business mechanisms; a conflict between governments is not one, however well sourced."
    );
  }

  if (verdict.editorial_self_refusal) {
    reasons.push(
      "The piece is effectively a note asking for more evidence rather than a story. Choose an event the sources can actually support."
    );
  }

  if (!verdict.source_support_sufficient) {
    reasons.push("The sources do not establish the trade-off, mechanism or outcome the story is about.");
  }

  if (!verdict.business_mechanism_substantive) {
    reasons.push("The piece reports an event without explaining a business mechanism behind it.");
  }

  if (!verdict.fr_en_semantic_parity) {
    reasons.push("The two language versions differ materially, so they are not one story told twice.");
  }

  if (!verdict.topic_promise_fit) {
    reasons.push("The piece does not teach a business lesson a reader could reuse.");
  }

  if (reasons.length === 0 && !verdict.pass) {
    reasons.push(
      ...(verdict.reasons.length > 0 ? verdict.reasons : ["business story editorial judge refused the story"])
    );
  }

  return reasons;
}
