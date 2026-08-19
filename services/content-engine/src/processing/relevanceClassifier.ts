import type { ArticleCandidate } from "../domain.js";
import {
  DEFAULT_CLASSIFIER_MODEL,
  DEFAULT_CLASSIFIER_REASONING_EFFORT,
  estimateCallCostUsd,
  hasVerifiedPricing
} from "../generation/modelRouting.js";
import type { LlmUsage } from "../generation/llmProvider.js";
import { OpenAiJsonProvider } from "../generation/openAiProvider.js";
import {
  applyRelevanceVerdicts,
  buildRelevanceClassificationPrompt,
  isTopicId,
  runDeterministicRelevanceGate,
  toRelevanceCandidate,
  type ClassifierVerdict,
  type RelevanceCandidate
} from "./topicRelevance.js";

/**
 * The semantic half of the source relevance gate.
 *
 * The deterministic stage decides most articles for free. What is left is
 * genuinely ambiguous — a sports item that might or might not carry a
 * commercial mechanism, a cultural item that might or might not be about the
 * media industry — and guessing on those is exactly how the murder story
 * reached a Tech slot. Those, and only those, are sent to one cheap batched
 * classification call.
 *
 * Two rules make this safe to run in production:
 *
 *  - only ambiguous candidates are sent. An accepted or rejected article never
 *    costs a token;
 *  - a classifier failure never promotes anything. If the call fails, times out
 *    or answers unusably, the ambiguous candidates stay out of the edition. No
 *    article is preferable to a wrong article.
 */

/** Structured output contract. The classifier decides, it never writes prose. */
const RELEVANCE_VERDICT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["article_id", "accepted", "topic", "confidence", "reason"],
        properties: {
          article_id: { type: "string" },
          accepted: { type: "boolean" },
          topic: { type: "string" },
          confidence: { type: "number" },
          reason: { type: "string" }
        }
      }
    }
  }
};

/** Ambiguous articles per request. Batched hard: this stage must stay cheap. */
export const RELEVANCE_BATCH_SIZE = 40;

export type RelevanceClassifier = {
  model: string;
  classify: (candidates: RelevanceCandidate[]) => Promise<{
    verdicts: ClassifierVerdict[];
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    costVerified: boolean;
  }>;
};

export type RelevanceGateDiagnostics = {
  deterministic_accepted: number;
  deterministic_rejected: number;
  ambiguous: number;
  llm_classified: number;
  llm_accepted: number;
  llm_rejected: number;
  classification_batches: number;
  classifier_model: string | null;
  classifier_input_tokens: number | null;
  classifier_output_tokens: number | null;
  classifier_cost_usd: number | null;
  classifier_cost_verified: boolean;
  /** Set when the classifier could not answer; ambiguous stayed rejected. */
  classifier_error: string | null;
};

export function emptyRelevanceGateDiagnostics(): RelevanceGateDiagnostics {
  return {
    deterministic_accepted: 0,
    deterministic_rejected: 0,
    ambiguous: 0,
    llm_classified: 0,
    llm_accepted: 0,
    llm_rejected: 0,
    classification_batches: 0,
    classifier_model: null,
    classifier_input_tokens: null,
    classifier_output_tokens: null,
    classifier_cost_usd: null,
    classifier_cost_verified: false,
    classifier_error: null
  };
}

/** The production classifier: one cheap model, structured output, no prose. */
export function createLunaRelevanceClassifier(options: {
  model?: string;
  maxOutputTokens?: number;
} = {}): RelevanceClassifier {
  const model = options.model ?? DEFAULT_CLASSIFIER_MODEL;
  let lastCompletion: { model: string; usage: LlmUsage } | null = null;
  const provider = new OpenAiJsonProvider({
    model,
    reasoningEffort: DEFAULT_CLASSIFIER_REASONING_EFFORT,
    disableFallback: true,
    // Usage is observed per request so the gate can report exactly what the
    // classification stage cost.
    onRequestCompletion: (completion) => {
      lastCompletion = { model: completion.model, usage: completion.usage };
    }
  });

  return {
    model,
    async classify(candidates) {
      lastCompletion = null;

      const payload = await provider.generateJson({
        systemPrompt:
          "You classify news articles into editorial topics. You never write article content.",
        userPrompt: buildRelevanceClassificationPrompt(candidates),
        jsonSchema: RELEVANCE_VERDICT_SCHEMA,
        schemaName: "relevance_verdicts",
        maxOutputTokens: options.maxOutputTokens ?? Math.min(4_000, 120 * candidates.length + 400)
      });
      const completion = lastCompletion as { model: string; usage: LlmUsage } | null;

      return {
        verdicts: parseVerdicts(payload),
        inputTokens: completion?.usage.inputTokens ?? null,
        outputTokens: completion?.usage.outputTokens ?? null,
        costUsd: completion ? estimateCallCostUsd(completion.model, completion.usage) : null,
        costVerified: hasVerifiedPricing(model)
      };
    }
  };
}

/** Defensive parse: a malformed answer must reject, never crash the run. */
export function parseVerdicts(payload: unknown): ClassifierVerdict[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const verdicts = (payload as { verdicts?: unknown }).verdicts;

  if (!Array.isArray(verdicts)) {
    return [];
  }

  return verdicts.flatMap((entry): ClassifierVerdict[] => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const articleId = record.article_id;
    const topic = record.topic;

    if (typeof articleId !== "string") {
      return [];
    }

    return [
      {
        article_id: articleId,
        accepted: record.accepted === true,
        topic: isTopicId(topic) ? topic : "reject",
        confidence: typeof record.confidence === "number" ? record.confidence : 0,
        reason: typeof record.reason === "string" ? record.reason : ""
      }
    ];
  });
}

export function chunkCandidates(
  candidates: RelevanceCandidate[],
  size = RELEVANCE_BATCH_SIZE
): RelevanceCandidate[][] {
  const batchSize = Math.max(1, Math.trunc(size));
  const batches: RelevanceCandidate[][] = [];

  for (let index = 0; index < candidates.length; index += batchSize) {
    batches.push(candidates.slice(index, index + batchSize));
  }

  return batches;
}

export type RelevanceGateOutcome = {
  /** Articles cleared for the edition, each carrying its canonical topic. */
  accepted: ArticleCandidate[];
  diagnostics: RelevanceGateDiagnostics;
};

/**
 * Run the full gate over a batch of prepared candidates.
 *
 * Returns the articles that may be published, each with `topic` set to the
 * canonical editorial topic the gate decided — the value the rest of the
 * pipeline treats as authoritative. `sourceTopic` is left untouched as feed
 * provenance for diagnostics, and never re-consulted as an authority.
 */
export async function applyRelevanceGate(input: {
  articles: ArticleCandidate[];
  classifier?: RelevanceClassifier | null;
  /**
   * What to do with candidates the deterministic stage could not decide.
   *
   * "reject" (the default, and the only production value): they stay out. This
   * is the rule that must hold when the classifier fails — a semantic outage
   * must never widen what reaches an edition.
   *
   * "keep" exists for runs that deliberately use no model at all (deterministic
   * dry-runs and fixtures). There is no semantic stage to fail in those, and
   * dropping every undecided article would leave them with nothing to work
   * from. It must never be set for a run that generates with an LLM.
   */
  onAmbiguous?: "reject" | "keep";
  onProgress?: (message: string, details: Record<string, unknown>) => void;
}): Promise<RelevanceGateOutcome> {
  const diagnostics = emptyRelevanceGateDiagnostics();
  const gate = runDeterministicRelevanceGate(input.articles);

  diagnostics.deterministic_accepted = gate.accepted.length;
  diagnostics.deterministic_rejected = gate.rejected.length;
  diagnostics.ambiguous = gate.ambiguous.length;

  const accepted: ArticleCandidate[] = gate.accepted.map((entry) =>
    withCanonicalTopic(entry.article, entry.topic)
  );

  for (const rejection of gate.rejected) {
    input.onProgress?.("relevance rejected", {
      stage: "deterministic",
      url: rejection.article.url,
      source_topic: rejection.article.sourceTopic ?? null,
      reason: rejection.reason
    });
  }

  if (gate.ambiguous.length === 0) {
    return { accepted, diagnostics };
  }

  if (!input.classifier) {
    // Deterministic run: no semantic stage exists, so undecided candidates keep
    // their feed hint rather than vanishing. Only ever reached when a caller
    // explicitly asked for it.
    if (input.onAmbiguous === "keep") {
      diagnostics.classifier_error = "deterministic run: classifier not used";

      for (const article of gate.ambiguous) {
        accepted.push(withCanonicalTopic(article, article.sourceTopic ?? null));
      }

      return { accepted, diagnostics };
    }

    // Ambiguous with no classifier configured: they stay out. This is the
    // production-safe default, not a degradation to accept.
    diagnostics.classifier_error = "no classifier configured";
    input.onProgress?.("relevance ambiguous dropped", {
      reason: "no classifier configured",
      count: gate.ambiguous.length
    });

    return { accepted, diagnostics };
  }

  diagnostics.classifier_model = input.classifier.model;
  const candidates = gate.ambiguous.map(toRelevanceCandidate);
  const byId = new Map(gate.ambiguous.map((article) => [article.url, article]));
  const batches = chunkCandidates(candidates);
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let costUnknown = false;
  let costVerified = true;

  for (const batch of batches) {
    try {
      const result = await input.classifier.classify(batch);

      diagnostics.classification_batches += 1;
      diagnostics.llm_classified += batch.length;
      inputTokens += result.inputTokens ?? 0;
      outputTokens += result.outputTokens ?? 0;

      if (result.costUsd === null || !result.costVerified) {
        costUnknown = result.costUsd === null;
        costVerified = costVerified && result.costVerified;
      } else {
        costUsd += result.costUsd;
      }

      const decisions = applyRelevanceVerdicts(batch, result.verdicts);

      for (const [id, decision] of decisions) {
        const article = byId.get(id);

        if (!article) {
          continue;
        }

        if (decision.status === "accepted") {
          diagnostics.llm_accepted += 1;
          accepted.push(withCanonicalTopic(article, decision.topic));
          continue;
        }

        diagnostics.llm_rejected += 1;
        input.onProgress?.("relevance rejected", {
          stage: "classifier",
          url: article.url,
          source_topic: article.sourceTopic ?? null,
          reason: decision.status === "rejected" ? decision.reason : "not accepted"
        });
      }
    } catch (error) {
      // A failed classification never promotes anything: the whole batch stays
      // out of the edition.
      const message = error instanceof Error ? error.message : String(error);

      diagnostics.classifier_error = message;
      diagnostics.llm_rejected += batch.length;
      input.onProgress?.("relevance classification failed", {
        batch_size: batch.length,
        error: message,
        outcome: "ambiguous candidates dropped"
      });
    }
  }

  diagnostics.classifier_input_tokens = inputTokens;
  diagnostics.classifier_output_tokens = outputTokens;
  diagnostics.classifier_cost_verified = costVerified && !costUnknown;
  // Only a cost computed from operator-supplied rates is reported as a number.
  diagnostics.classifier_cost_usd = diagnostics.classifier_cost_verified
    ? Number(costUsd.toFixed(6))
    : null;

  return { accepted, diagnostics };
}

/**
 * The canonical editorial topic, written where the pipeline reads it.
 *
 * `sourceTopic` keeps the feed's original category for diagnostics; it is not
 * overwritten, and after this point nothing treats it as an authority.
 */
function withCanonicalTopic(
  article: ArticleCandidate,
  topic: ArticleCandidate["canonicalTopic"]
): ArticleCandidate {
  return { ...article, canonicalTopic: topic ?? null } as ArticleCandidate;
}
