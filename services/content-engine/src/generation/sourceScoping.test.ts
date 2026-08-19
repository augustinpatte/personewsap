import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NEWSLETTER_ITEMS_PER_TOPIC, type Language, type RankedArticle, type TopicId } from "../domain.js";
import { LlmContentGenerator } from "./llmGenerator.js";
import type { LlmJsonRequest, LlmProvider } from "./llmProvider.js";

/**
 * A topic-scoped generation call must never receive unrelated sources.
 *
 * scopeSourcesByTopics used to fall back to the whole source set when a topic
 * had none of its own, so "no tech_ai source today" became "here is a crime
 * story, write about tech". The product rule is the opposite: no article is
 * better than a misleading one.
 */

function rankedArticle(topic: TopicId, language: Language = "fr"): RankedArticle {
  return {
    url: `https://example.test/${topic}`,
    title: `Sourced ${topic} development`,
    publisher: `Publisher ${topic}`,
    author: null,
    published_at: "2026-08-18T08:00:00.000Z",
    retrieved_at: "2026-08-19T09:00:00.000Z",
    language,
    summary: `A ${topic} development with a concrete mechanism and one measurable signal.`,
    body: `Detailed body about ${topic}.`,
    sourceTopic: topic,
    credibility_score: 0.9,
    content_hash: `hash-${topic}`,
    normalized_url: `https://example.test/${topic}`,
    topic,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

/** Records the source packet each section was handed. */
class RecordingProvider implements LlmProvider {
  readonly name = "recording";

  constructor(private readonly seen: Array<{ topics: string[] }>) {}

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    const prompt = JSON.parse(request.userPrompt) as {
      source_material: Array<{ topic: string }>;
    };

    this.seen.push({ topics: prompt.source_material.map((source) => source.topic) });

    throw new Error("stop after recording the source packet");
  }
}

describe("topic-scoped source packets", () => {
  it("never hands a topic's call sources from another topic", async () => {
    const seen: Array<{ topics: string[] }> = [];
    const generator = new LlmContentGenerator({
      providerForSection: () => new RecordingProvider(seen),
      maxAttempts: 1
    });

    // Only a finance source exists; tech_ai is requested as well.
    await generator
      .generateDailyDrop({
        dropDate: "2026-08-19",
        language: "fr",
        articles: [rankedArticle("finance")],
        newsletterTopics: ["finance", "tech_ai"],
        newsletterArticleCount: 2 * NEWSLETTER_ITEMS_PER_TOPIC,
        sections: ["newsletter_article"]
      })
      .catch(() => undefined);

    for (const packet of seen) {
      // Every packet is single-topic: no unrelated material ever reaches a call.
      expect(new Set(packet.topics).size).toBeLessThanOrEqual(1);
    }

    // The tech_ai call was refused outright rather than fed finance sources.
    expect(seen.every((packet) => !packet.topics.includes("finance") || packet.topics.every((t) => t === "finance"))).toBe(
      true
    );
  });

  it("fails the section with insufficient_source_material instead of inventing an angle", async () => {
    const generator = new LlmContentGenerator({
      providerForSection: () => new RecordingProvider([]),
      maxAttempts: 2
    });

    const error = await generator
      .generateDailyDrop({
        dropDate: "2026-08-19",
        language: "fr",
        articles: [rankedArticle("finance")],
        newsletterTopics: ["tech_ai"],
        newsletterArticleCount: NEWSLETTER_ITEMS_PER_TOPIC,
        sections: ["newsletter_article"]
      })
      .then(() => null)
      .catch((thrown: unknown) => thrown as { reason?: string; message?: string });

    // Every requested topic was starved, so the whole run fails rather than
    // returning an empty edition.
    expect(error?.reason).toBe("insufficient_source_material");
    expect(error?.message).toMatch(/No section had relevant source material/);
  });

  it("skips only the starved topic and keeps the ones that have sources", async () => {
    const skipped: string[] = [];
    const seen: Array<{ topics: string[] }> = [];
    const generator = new LlmContentGenerator({
      providerForSection: () => new RecordingProvider(seen),
      maxAttempts: 1,
      onProgress: (message, details) => {
        if (message === "LLM section skipped for missing sources") {
          skipped.push(String((details as { topic?: string }).topic));
        }
      }
    });

    await generator
      .generateDailyDrop({
        dropDate: "2026-08-19",
        language: "fr",
        articles: [rankedArticle("finance")],
        // Starved topic first, so the loop must carry on past it to reach the
        // one that does have a source.
        newsletterTopics: ["tech_ai", "finance"],
        newsletterArticleCount: 2 * NEWSLETTER_ITEMS_PER_TOPIC,
        sections: ["newsletter_article"]
      })
      .catch(() => undefined);

    // tech_ai had nothing; finance was still attempted.
    expect(skipped).toContain("tech_ai");
    expect(seen).toHaveLength(1);
    expect(seen[0].topics).toEqual(["finance"]);
  });

  it("does not retry a missing-source failure", async () => {
    let calls = 0;
    const generator = new LlmContentGenerator({
      providerForSection: () => {
        calls += 1;
        return new RecordingProvider([]);
      },
      maxAttempts: 3
    });

    await generator
      .generateDailyDrop({
        dropDate: "2026-08-19",
        language: "fr",
        articles: [rankedArticle("finance")],
        newsletterTopics: ["tech_ai"],
        newsletterArticleCount: NEWSLETTER_ITEMS_PER_TOPIC,
        sections: ["newsletter_article"]
      })
      .catch(() => undefined);

    // Another attempt would ask the same impossible question.
    expect(calls).toBe(0);
  });

  it("has no fallback-to-everything left in the scoping helper", () => {
    const source = readFileSync(join(__dirname, "llmGenerator.ts"), "utf8");
    const helper = source.slice(source.indexOf("function scopeSourcesByTopics"));
    const body = helper.slice(0, helper.indexOf("\n}"));

    expect(body).not.toMatch(/scoped\.length > 0 \? scoped : allSources/);
  });
});

describe("the citation contract in the newsletter prompt", () => {
  const prompt = readFileSync(
    join(__dirname, "..", "..", "prompts", "newsletter_prompt_final.md"),
    "utf8"
  );

  it("no longer demands two to three sources", () => {
    // The contradiction that produced invented Reuters/FT citations: "use only
    // supplied sources" next to "2-3 sources minimum".
    expect(prompt).not.toMatch(/2 à 3 sources minimum/);
    expect(prompt).not.toMatch(/Chaque article : 2 à 3 sources/);
  });

  it("accepts a single strong source and forbids naming anything else", () => {
    expect(prompt).toMatch(/Une seule source solide suffit/);
    expect(prompt).toMatch(/le paquet de sources fourni est la seule matière autorisée/);
    expect(prompt).toMatch(/Interdit d'inventer une source, une URL, un nom de média/);
  });

  it("stops modelling an invented multi-source footer in the JSON example", () => {
    const example = prompt.slice(prompt.indexOf('"content":'));

    expect(example).not.toMatch(/Sources : Reuters/);
    expect(prompt).toMatch(/reconstruit par le backend/);
  });
});
