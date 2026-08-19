import type { RankedArticle, RawArticle } from "../domain.js";
import { deduplicateArticles, prepareCandidates } from "./deduplicate.js";
import { rankArticles } from "./rank.js";
import {
  applyRelevanceGate,
  emptyRelevanceGateDiagnostics,
  type RelevanceClassifier,
  type RelevanceGateDiagnostics
} from "./relevanceClassifier.js";

/**
 * Raw feed items to ranked, publishable articles.
 *
 * The source relevance gate sits between preparation and ranking, which is the
 * only place it can sit: it needs de-duplicated candidates, and everything
 * downstream — ranking, source packets, generation scoping, grounding,
 * validation — must already be working with the canonical editorial topic it
 * decides.
 */

/** Deterministic-only pipeline. No network, no model call. */
export function processArticles(articles: RawArticle[], now = new Date()): RankedArticle[] {
  return rankArticles(deduplicateArticles(prepareCandidates(articles)), now);
}

export type ProcessedArticles = {
  articles: RankedArticle[];
  relevanceGate: RelevanceGateDiagnostics;
};

/**
 * The production pipeline: prepare, de-duplicate, gate for relevance (with the
 * cheap classifier for the ambiguous remainder), then rank what survived.
 *
 * Ranking runs *after* the gate on purpose. Ranking an article the gate is
 * about to drop wastes nothing, but ranking before classification would let a
 * rejected item influence topic diversity scoring.
 */
export async function processArticlesWithRelevanceGate(input: {
  articles: RawArticle[];
  classifier?: RelevanceClassifier | null;
  /** See applyRelevanceGate: "keep" is only for model-free runs. */
  onAmbiguous?: "reject" | "keep";
  now?: Date;
  onProgress?: (message: string, details: Record<string, unknown>) => void;
}): Promise<ProcessedArticles> {
  const candidates = deduplicateArticles(prepareCandidates(input.articles));

  if (candidates.length === 0) {
    return { articles: [], relevanceGate: emptyRelevanceGateDiagnostics() };
  }

  const gate = await applyRelevanceGate({
    articles: candidates,
    classifier: input.classifier,
    onAmbiguous: input.onAmbiguous,
    onProgress: input.onProgress
  });

  return {
    articles: rankArticles(gate.accepted, input.now ?? new Date()),
    relevanceGate: gate.diagnostics
  };
}
