import { describe, expect, it, vi } from "vitest";

import type { ArticleCandidate, RawArticle, TopicId } from "../domain.js";
import { processArticlesWithRelevanceGate } from "./pipeline.js";
import {
  applyRelevanceGate,
  chunkCandidates,
  parseVerdicts,
  RELEVANCE_BATCH_SIZE,
  type RelevanceClassifier
} from "./relevanceClassifier.js";
import { toRelevanceCandidate } from "./topicRelevance.js";

/**
 * The gate as it runs in production: deterministic first, one batched cheap
 * call for the ambiguous remainder, and nothing ambiguous published when that
 * call cannot answer.
 *
 * The rule that matters most is the failure mode. A classifier outage must not
 * quietly widen what reaches an edition — no article is preferable to a wrong
 * article.
 */

function raw(input: {
  title: string;
  summary?: string;
  sourceTopic?: TopicId;
  url?: string;
}): RawArticle {
  return {
    url: input.url ?? `https://example.test/${encodeURIComponent(input.title)}`,
    title: input.title,
    publisher: "Test Publisher",
    author: null,
    published_at: new Date().toISOString(),
    retrieved_at: new Date().toISOString(),
    language: "fr",
    summary: input.summary ?? "",
    body: "",
    sourceTopic: input.sourceTopic
  };
}

const ACCEPTED = raw({
  title: "Nvidia dévoile une puce pour l'inférence",
  summary: "Le semi-conducteur vise les centres de données.",
  sourceTopic: "tech_ai"
});
const REJECTED = raw({
  title: "Meurtre d'une influenceuse : un suspect interpellé",
  summary: "Un suspect a été interpellé.",
  sourceTopic: "tech_ai"
});
const AMBIGUOUS = raw({
  title: "Le tournoi déménage dans une nouvelle ville",
  summary: "L'épreuve change de site la saison prochaine.",
  sourceTopic: "sport_business"
});

function candidate(article: RawArticle): ArticleCandidate {
  return { ...article, content_hash: article.url, normalized_url: article.url };
}

function classifierReturning(
  verdicts: Array<{ id: string; topic: TopicId | "reject"; accepted: boolean; confidence?: number }>,
  spy = vi.fn()
): RelevanceClassifier {
  return {
    model: "gpt-5.6-luna",
    classify: async (candidates) => {
      spy(candidates);

      return {
        verdicts: verdicts.map((verdict) => ({
          article_id: verdict.id,
          accepted: verdict.accepted,
          topic: verdict.topic,
          confidence: verdict.confidence ?? 0.9,
          reason: "test"
        })),
        inputTokens: 120,
        outputTokens: 40,
        costUsd: null,
        costVerified: false
      };
    }
  };
}

describe("only ambiguous candidates reach the classifier", () => {
  it("never sends a deterministically accepted or rejected article", async () => {
    const seen = vi.fn();
    const classifier = classifierReturning(
      [{ id: AMBIGUOUS.url, topic: "sport_business", accepted: true }],
      seen
    );

    const result = await applyRelevanceGate({
      articles: [ACCEPTED, REJECTED, AMBIGUOUS].map(candidate),
      classifier
    });

    expect(seen).toHaveBeenCalledOnce();
    const sent = (seen.mock.calls[0][0] as Array<{ id: string }>).map((c) => c.id);

    expect(sent).toEqual([AMBIGUOUS.url]);
    expect(result.diagnostics.deterministic_accepted).toBe(1);
    expect(result.diagnostics.deterministic_rejected).toBe(1);
    expect(result.diagnostics.ambiguous).toBe(1);
    expect(result.diagnostics.llm_classified).toBe(1);
  });

  it("does not call the classifier at all when nothing is ambiguous", async () => {
    const seen = vi.fn();

    const result = await applyRelevanceGate({
      articles: [ACCEPTED, REJECTED].map(candidate),
      classifier: classifierReturning([], seen)
    });

    expect(seen).not.toHaveBeenCalled();
    expect(result.diagnostics.classification_batches).toBe(0);
    expect(result.diagnostics.classifier_model).toBeNull();
  });
});

describe("a classifier failure never promotes anything", () => {
  it("drops ambiguous candidates when the call throws", async () => {
    const result = await applyRelevanceGate({
      articles: [ACCEPTED, AMBIGUOUS].map(candidate),
      classifier: {
        model: "gpt-5.6-luna",
        classify: async () => {
          throw new Error("classifier unavailable");
        }
      }
    });

    // The accepted article survives; the ambiguous one does not.
    expect(result.accepted.map((a) => a.url)).toEqual([ACCEPTED.url]);
    expect(result.diagnostics.llm_rejected).toBe(1);
    expect(result.diagnostics.classifier_error).toMatch(/classifier unavailable/);
  });

  it("drops ambiguous candidates when no classifier is configured", async () => {
    const result = await applyRelevanceGate({
      articles: [ACCEPTED, AMBIGUOUS].map(candidate),
      classifier: null
    });

    expect(result.accepted.map((a) => a.url)).toEqual([ACCEPTED.url]);
    expect(result.diagnostics.classifier_error).toBe("no classifier configured");
  });

  it("drops a candidate the classifier simply did not answer for", async () => {
    const result = await applyRelevanceGate({
      articles: [AMBIGUOUS].map(candidate),
      classifier: classifierReturning([])
    });

    expect(result.accepted).toHaveLength(0);
    expect(result.diagnostics.llm_rejected).toBe(1);
  });
});

describe("verdicts decide the canonical topic", () => {
  it("accepts with the classifier's topic, not the feed hint", async () => {
    const result = await applyRelevanceGate({
      articles: [AMBIGUOUS].map(candidate),
      // Feed said sport_business; the classifier says culture_media.
      classifier: classifierReturning([
        { id: AMBIGUOUS.url, topic: "culture_media", accepted: true }
      ])
    });

    expect(result.accepted[0].canonicalTopic).toBe("culture_media");
    // Feed provenance is preserved, not overwritten.
    expect(result.accepted[0].sourceTopic).toBe("sport_business");
    expect(result.diagnostics.llm_accepted).toBe(1);
  });

  it("rejects a low-confidence acceptance", async () => {
    const result = await applyRelevanceGate({
      articles: [AMBIGUOUS].map(candidate),
      classifier: classifierReturning([
        { id: AMBIGUOUS.url, topic: "sport_business", accepted: true, confidence: 0.2 }
      ])
    });

    expect(result.accepted).toHaveLength(0);
  });
});

describe("batching", () => {
  it("packs many candidates into few calls", () => {
    const candidates = Array.from({ length: 95 }, (_, index) =>
      toRelevanceCandidate(candidate(raw({ title: `Item ${index}` })))
    );

    expect(chunkCandidates(candidates).map((b) => b.length)).toEqual([
      RELEVANCE_BATCH_SIZE,
      RELEVANCE_BATCH_SIZE,
      15
    ]);
  });

  it("classifies a realistic ambiguous pool in one call", async () => {
    const seen = vi.fn();
    const articles = Array.from({ length: 30 }, (_, index) =>
      candidate(
        raw({
          title: `Le tournoi ${index} déménage`,
          sourceTopic: "sport_business",
          url: `https://example.test/amb-${index}`
        })
      )
    );

    await applyRelevanceGate({ articles, classifier: classifierReturning([], seen) });

    expect(seen).toHaveBeenCalledOnce();
  });
});

describe("malformed classifier output", () => {
  it.each([null, {}, { verdicts: "nope" }, { verdicts: [1, "x"] }])(
    "parses %s into no verdicts rather than crashing",
    (payload) => {
      expect(parseVerdicts(payload)).toEqual([]);
    }
  );

  it("downgrades an unknown topic to reject", () => {
    expect(
      parseVerdicts({
        verdicts: [{ article_id: "a", accepted: true, topic: "sports", confidence: 1, reason: "" }]
      })
    ).toEqual([
      { article_id: "a", accepted: true, topic: "reject", confidence: 1, reason: "" }
    ]);
  });
});

describe("the canonical topic flows through the pipeline", () => {
  it("ranking reports the classifier's topic, not the feed's", async () => {
    const processed = await processArticlesWithRelevanceGate({
      articles: [AMBIGUOUS],
      classifier: classifierReturning([
        { id: AMBIGUOUS.url, topic: "culture_media", accepted: true }
      ])
    });

    expect(processed.articles).toHaveLength(1);
    // RankedArticle.topic is the single canonical editorial topic.
    expect(processed.articles[0].topic).toBe("culture_media");
    expect(processed.articles[0].sourceTopic).toBe("sport_business");
    expect(processed.relevanceGate.llm_accepted).toBe(1);
  });

  it("keeps a rejected article out of the ranked set entirely", async () => {
    const processed = await processArticlesWithRelevanceGate({
      articles: [ACCEPTED, REJECTED],
      classifier: null
    });

    expect(processed.articles.map((a) => a.url)).toEqual([ACCEPTED.url]);
    expect(processed.articles[0].topic).toBe("tech_ai");
  });

  it("reports usage even when the dollar cost is unknown", async () => {
    const processed = await processArticlesWithRelevanceGate({
      articles: [AMBIGUOUS],
      classifier: classifierReturning([
        { id: AMBIGUOUS.url, topic: "sport_business", accepted: true }
      ])
    });

    expect(processed.relevanceGate.classifier_input_tokens).toBe(120);
    expect(processed.relevanceGate.classifier_output_tokens).toBe(40);
    // Placeholder pricing must never be reported as a real cost.
    expect(processed.relevanceGate.classifier_cost_usd).toBeNull();
    expect(processed.relevanceGate.classifier_cost_verified).toBe(false);
  });
});
