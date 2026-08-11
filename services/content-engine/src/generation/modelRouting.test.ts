import { describe, expect, it } from "vitest";

import {
  MINI_CASE_TOPIC_IDS,
  NEWSLETTER_ITEMS_PER_TOPIC,
  TOPIC_IDS,
  type Language,
  type RankedArticle,
  type TopicId
} from "../domain.js";
import { LlmContentGenerator } from "./llmGenerator.js";
import { LlmGenerationError } from "./llmErrors.js";
import type { LlmJsonRequest, LlmProvider } from "./llmProvider.js";
import { createRoutedProviderFactory, resolveContentModelRouting, type SectionProviderContext } from "./modelRouting.js";
import { StructuredContentGenerator } from "./structuredGenerator.js";

function rankedArticle(topic: TopicId, language: Language = "en"): RankedArticle {
  return {
    url: `https://example.org/${topic}/story`,
    title: `Source story about ${topic}`,
    publisher: `Publisher ${topic}`,
    author: null,
    published_at: "2026-06-22T08:00:00.000Z",
    retrieved_at: "2026-06-22T09:00:00.000Z",
    language,
    summary: `A sourced development in ${topic} with a concrete mechanism and one measurable signal.`,
    body: `Detailed body about ${topic}.`,
    sourceTopic: topic,
    credibility_score: 0.9,
    content_hash: `hash-${topic}`,
    normalized_url: `https://example.org/${topic}/story`,
    topic,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

describe("content model routing", () => {
  it("uses separate production defaults for each generated module", () => {
    const routing = resolveContentModelRouting({} as NodeJS.ProcessEnv);

    expect(routing.newsletter_article).toMatchObject({
      provider: "openai",
      model: "gpt-5-mini-2025-08-07",
      reasoningEffort: "none",
      fallbackProvider: "openai",
      fallbackModel: "gpt-5.4-mini-2026-03-17"
    });
    expect(routing.mini_case).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-mini-2026-03-17",
      reasoningEffort: "low",
      fallbackProvider: "openai",
      fallbackModel: "gpt-5.4-2026-03-05"
    });
    expect(routing.business_story).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      fallbackProvider: "openai",
      fallbackModel: "gpt-5.4-2026-03-05"
    });
    expect(routing.learning_path).toMatchObject({
      provider: "deterministic",
      model: "deterministic-learning-v1"
    });
  });

  it("keeps OPENAI_MODEL compatibility without forcing every module to one model", () => {
    const routing = resolveContentModelRouting({
      OPENAI_MODEL: "legacy-model",
      BUSINESS_STORY_PROVIDER: "anthropic"
    } as NodeJS.ProcessEnv);

    expect(routing.newsletter_article.model).toBe("legacy-model");
    expect(routing.mini_case.model).toBe("legacy-model");
    expect(routing.business_story.model).toBe("claude-sonnet-4-6");
    expect(routing.business_story.fallbackModel).toBe("legacy-model");
  });

  it("uses Anthropic first for Business Story and OpenAI only on the fallback attempt", () => {
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.OPENAI_API_KEY = "openai-test-key";

    try {
      const factory = createRoutedProviderFactory();
      const first = factory({
        section: "business_story",
        language: "en",
        attempt: 1,
        maxAttempts: 3
      });
      const fallback = factory({
        section: "business_story",
        language: "en",
        attempt: 3,
        maxAttempts: 3
      });

      expect(first.name).toBe("anthropic");
      expect(fallback.name).toBe("openai");
    } finally {
      restoreEnv("ANTHROPIC_API_KEY", previousAnthropicKey);
      restoreEnv("OPENAI_API_KEY", previousOpenAiKey);
    }
  });

  it("generates the normal editorial catalog with exactly 30 logical calls for two languages", async () => {
    const contexts: SectionProviderContext[] = [];
    const generator = new LlmContentGenerator({
      providerForSection: (context) => {
        contexts.push(context);
        return new FakeSectionProvider(context);
      },
      maxAttempts: 1
    });
    const enArticles = TOPIC_IDS.map((topic) => rankedArticle(topic, "en"));
    const frArticles = TOPIC_IDS.map((topic) => rankedArticle(topic, "fr"));

    await generator.generateDailyDrop({
      dropDate: "2026-06-22",
      language: "en",
      articles: enArticles,
      newsletterTopics: [...TOPIC_IDS],
      newsletterArticleCount: TOPIC_IDS.length * NEWSLETTER_ITEMS_PER_TOPIC,
      miniCaseProductTopics: [...MINI_CASE_TOPIC_IDS]
    });
    await generator.generateDailyDrop({
      dropDate: "2026-06-22",
      language: "fr",
      articles: frArticles,
      newsletterTopics: [...TOPIC_IDS],
      newsletterArticleCount: TOPIC_IDS.length * NEWSLETTER_ITEMS_PER_TOPIC,
      miniCaseProductTopics: [...MINI_CASE_TOPIC_IDS]
    });

    expect(contexts.filter((context) => context.section === "newsletter_article")).toHaveLength(16);
    expect(contexts.filter((context) => context.section === "mini_case")).toHaveLength(12);
    expect(contexts.filter((context) => context.section === "business_story")).toHaveLength(2);
    expect(contexts).toHaveLength(30);
  });

  it("retries only the invalid mini-case topic and keeps successful sections", async () => {
    const contexts: string[] = [];
    const failures = new Map<string, number>([["mini_case:health_pharma", 1]]);
    const generator = new LlmContentGenerator({
      providerForSection: (context) => {
        contexts.push(`${context.section}:${context.newsletterTopic ?? context.miniCaseTopic ?? "story"}:${context.attempt}`);
        return new FakeSectionProvider(context, failures);
      },
      maxAttempts: 2
    });

    await generator.generateDailyDrop({
      dropDate: "2026-06-22",
      language: "en",
      articles: TOPIC_IDS.map((topic) => rankedArticle(topic, "en")),
      newsletterTopics: [...TOPIC_IDS],
      newsletterArticleCount: TOPIC_IDS.length * NEWSLETTER_ITEMS_PER_TOPIC,
      miniCaseProductTopics: [...MINI_CASE_TOPIC_IDS]
    });

    expect(contexts.filter((entry) => entry.startsWith("newsletter_article:business"))).toEqual([
      "newsletter_article:business:1"
    ]);
    expect(contexts.filter((entry) => entry.startsWith("mini_case:health_pharma"))).toEqual([
      "mini_case:health_pharma:1",
      "mini_case:health_pharma:2"
    ]);
  });
});

class FakeSectionProvider implements LlmProvider {
  readonly name = "fake";

  constructor(
    private readonly context: SectionProviderContext,
    private readonly failures: Map<string, number> = new Map()
  ) {}

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    const key = `${this.context.section}:${this.context.newsletterTopic ?? this.context.miniCaseTopic ?? "story"}`;
    const remainingFailures = this.failures.get(key) ?? 0;
    if (remainingFailures > 0) {
      this.failures.set(key, remainingFailures - 1);
      throw new LlmGenerationError("validation_error", `forced failure for ${key}`);
    }

    const prompt = JSON.parse(request.userPrompt) as {
      request: {
        drop_date: string;
        language: Language;
        newsletter_topics?: TopicId[];
        newsletter_article_count?: number;
        mini_case_product_topics?: (typeof MINI_CASE_TOPIC_IDS)[number][];
      };
      source_material: Array<{
        topic: TopicId;
        language: Language;
        title: string;
        publisher: string;
        author: string | null;
        url: string;
        published_at: string | null;
        retrieved_at: string;
        summary: string | null;
        body_excerpt: string | null;
        importance_score: number;
        rank_reasons: string[];
      }>;
    };
    const articles = prompt.source_material.map((source, index) => ({
      ...rankedArticle(source.topic, source.language),
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      published_at: source.published_at,
      retrieved_at: source.retrieved_at,
      summary: source.summary ?? source.title,
      body: source.body_excerpt ?? source.title,
      content_hash: `hash-${source.topic}-${index}`,
      normalized_url: source.url
    }));
    const payload = await new StructuredContentGenerator().generateDailyDrop({
      dropDate: prompt.request.drop_date,
      language: prompt.request.language,
      articles,
      newsletterTopics: prompt.request.newsletter_topics ?? ["business"],
      newsletterArticleCount: prompt.request.newsletter_article_count ?? 1,
      miniCaseProductTopics: prompt.request.mini_case_product_topics ?? ["finance_economy"]
    });

    return {
      items: payload.items.filter((item) => item.content_type === this.context.section)
    };
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
