import { describe, expect, it } from "vitest";

import {
  MINI_CASE_TOPIC_IDS,
  type Language,
  type MiniCaseChallenge,
  type RankedArticle,
  type TopicId
} from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator, GenerationRequest } from "../generation/types.js";
import {
  DEFAULT_BUSINESS_STORY_COUNT,
  DEFAULT_MINI_CASE_COUNT_PER_TOPIC,
  editorialIdentities,
  rotateSourceWindow,
  runBootstrapCatalog,
  validateEntryTitle,
  type BootstrapCatalogOptions
} from "./bootstrapCatalog.js";

const DROP_DATE = "2026-08-17";

// A pool wide enough that ten distinct Business Stories and thirty distinct Mini
// Cases are actually possible: the bootstrap refuses rather than duplicating, so
// a thin pool would show up as rejections instead of a passing test.
const SOURCE_TOPICS: TopicId[] = ["business", "finance", "tech_ai", "law", "medicine", "engineering"];

function rankedArticle(topic: TopicId, language: Language, index: number): RankedArticle {
  return {
    url: `https://sources.test/${language}/${topic}/${index}`,
    title: `${topic} development ${index} (${language})`,
    publisher: `${topic} desk ${index}`,
    author: null,
    published_at: `${DROP_DATE}T08:00:00.000Z`,
    retrieved_at: `${DROP_DATE}T09:00:00.000Z`,
    language,
    summary: `A concrete ${topic} development number ${index} a reader can reuse.`,
    body: `Body about ${topic} ${index}.`,
    sourceTopic: topic,
    credibility_score: 0.9,
    content_hash: `hash-${language}-${topic}-${index}`,
    normalized_url: `https://sources.test/${language}/${topic}/${index}`,
    topic,
    importance_score: 0.9 - index / 100,
    rank_reasons: ["test"]
  };
}

function sourcePool(language: Language): RankedArticle[] {
  return SOURCE_TOPICS.flatMap((topic) =>
    Array.from({ length: 6 }, (_, index) => rankedArticle(topic, language, index + 1))
  );
}

function options(overrides: Partial<BootstrapCatalogOptions> = {}): BootstrapCatalogOptions {
  return {
    dropDate: DROP_DATE,
    languages: ["en", "fr"],
    businessStoryCount: DEFAULT_BUSINESS_STORY_COUNT,
    miniCaseCountPerTopic: DEFAULT_MINI_CASE_COUNT_PER_TOPIC,
    miniCaseTopics: [...MINI_CASE_TOPIC_IDS],
    persist: false,
    contentStatus: "review",
    runId: "bootstrap-test",
    useLlm: false,
    productionStrict: false,
    ...overrides
  };
}

function dependencies(generator: ContentGenerator = new StructuredContentGenerator()) {
  return {
    generator,
    loadArticles: async (language: Language) => sourcePool(language)
  };
}

describe("bootstrap catalog quantities", () => {
  it("builds 10 Business Stories and 5 Mini Cases per topic, each in FR and EN", async () => {
    const output = await runBootstrapCatalog(options(), dependencies());

    expect(output.rejected).toEqual([]);
    expect(output.counts.businessStoryEntries).toBe(10);
    expect(output.counts.miniCaseEntries).toBe(30);
    expect(output.counts.totalEntries).toBe(40);

    expect(output.counts.versionsByContentTypeAndLanguage).toEqual({
      "business_story.en": 10,
      "business_story.fr": 10,
      "mini_case.en": 30,
      "mini_case.fr": 30
    });

    for (const topic of MINI_CASE_TOPIC_IDS) {
      expect(output.counts.miniCaseEntriesByTopic[topic]).toBe(5);
      expect(output.counts.miniCaseVersionsByTopicAndLanguage[`${topic}.en`]).toBe(5);
      expect(output.counts.miniCaseVersionsByTopicAndLanguage[`${topic}.fr`]).toBe(5);
    }

    // 40 unique editorial entries, 80 language versions.
    const versions = output.entries.flatMap((entry) => entry.versions);
    expect(versions).toHaveLength(80);
  });

  it("gives every entry exactly one version per requested language", async () => {
    const output = await runBootstrapCatalog(options(), dependencies());

    for (const entry of output.entries) {
      expect(entry.versions.map((version) => version.language).sort()).toEqual(["en", "fr"]);
    }
  });
});

describe("bootstrap catalog diversity", () => {
  it("never repeats a Business Story title or source", async () => {
    const output = await runBootstrapCatalog(
      options({ miniCaseCountPerTopic: 0 }),
      dependencies()
    );

    const stories = output.entries.flatMap((entry) =>
      entry.versions.filter((version) => version.language === "en").map((version) => version.item)
    );

    expect(new Set(stories.map((story) => story.title)).size).toBe(stories.length);
    expect(new Set(stories.map((story) => story.source_urls.join("|"))).size).toBe(stories.length);
  });

  it("varies scenario, decision, concept, question pattern, correct-answer pattern and difficulty inside a topic", async () => {
    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 0, miniCaseTopics: ["finance_economy"] }),
      dependencies()
    );

    const cases = output.entries.map(
      (entry) => entry.versions.find((version) => version.language === "en")!.item as MiniCaseChallenge
    );
    expect(cases).toHaveLength(5);

    const read = <Field extends keyof MiniCaseChallenge>(field: Field) =>
      new Set(cases.map((item) => item[field]));

    // Five different scenarios, decisions, concepts and question patterns.
    expect(read("scenario_type").size).toBe(5);
    expect(read("decision_type").size).toBe(5);
    expect(read("concept_tested").size).toBe(5);
    expect(read("question_pattern").size).toBe(5);
    // Correct-answer pattern and difficulty rotate across at least two values.
    expect(read("correct_answer_pattern").size).toBeGreaterThan(1);
    expect(read("difficulty").size).toBeGreaterThan(1);
    // And no two cases share a title.
    expect(read("title").size).toBe(5);
  });

  it("keeps every mini-case title distinct across all six topics", async () => {
    const output = await runBootstrapCatalog(options({ businessStoryCount: 0 }), dependencies());

    const titles = output.entries.flatMap((entry) => entry.versions.map((version) => version.item.title));
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("bootstrap catalog FR/EN parity", () => {
  it("keeps the same sources, taxonomy, difficulty and correct answer in both languages", async () => {
    const output = await runBootstrapCatalog(options({ businessStoryCount: 0 }), dependencies());

    for (const entry of output.entries) {
      const en = entry.versions.find((version) => version.language === "en")!.item as MiniCaseChallenge;
      const fr = entry.versions.find((version) => version.language === "fr")!.item as MiniCaseChallenge;

      expect(fr.source_urls).toEqual(en.source_urls);
      expect(fr.product_topic).toBe(en.product_topic);
      expect(fr.scenario_type).toBe(en.scenario_type);
      expect(fr.decision_type).toBe(en.decision_type);
      expect(fr.concept_tested).toBe(en.concept_tested);
      expect(fr.question_pattern).toBe(en.question_pattern);
      expect(fr.correct_answer_pattern).toBe(en.correct_answer_pattern);
      expect(fr.difficulty).toBe(en.difficulty);
      expect(fr.score_max).toBe(en.score_max);

      expect(fr.questions).toHaveLength(3);
      expect(en.questions).toHaveLength(3);

      fr.questions.forEach((frQuestion, index) => {
        const enQuestion = en.questions[index];
        expect(frQuestion.role).toBe(enQuestion.role);
        expect(frQuestion.options).toHaveLength(4);
        expect(enQuestion.options).toHaveLength(4);

        const frCorrect = frQuestion.options.filter((option) => option.is_correct);
        const enCorrect = enQuestion.options.filter((option) => option.is_correct);
        expect(frCorrect).toHaveLength(1);
        expect(enCorrect).toHaveLength(1);
        expect(frCorrect[0].id).toBe(enCorrect[0].id);

        // Every option carries teaching feedback in its own language.
        for (const option of [...frQuestion.options, ...enQuestion.options]) {
          expect(option.feedback.trim().length).toBeGreaterThan(0);
        }
      });
    }
  });

  it("refuses an entry whose counterpart diverges on the correct answer", async () => {
    // A generator that flips the correct option when producing the pair.
    const divergingGenerator: ContentGenerator = {
      async generateDailyDrop(request: GenerationRequest) {
        const payload = await new StructuredContentGenerator().generateDailyDrop(request);
        if (!request.languagePair) {
          return payload;
        }

        return {
          ...payload,
          items: payload.items.map((item) =>
            item.content_type === "mini_case"
              ? {
                  ...item,
                  questions: item.questions.map((question) => ({
                    ...question,
                    options: question.options.map((option, index) => ({
                      ...option,
                      is_correct: index === question.options.length - 1
                    }))
                  }))
                }
              : item
          )
        };
      }
    };

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 0, miniCaseCountPerTopic: 1, miniCaseTopics: ["ai"] }),
      dependencies(divergingGenerator)
    );

    expect(output.entries).toEqual([]);
    expect(output.rejected).toHaveLength(1);
    expect(output.rejected[0].reason).toBe("language_pair_failed");
    expect(output.rejected[0].details.join(" ")).toContain("correct option must be the same");
  });
});

describe("bootstrap catalog safety", () => {
  it("writes nothing and creates no daily drop in the default no-write mode", async () => {
    const output = await runBootstrapCatalog(options(), dependencies());

    expect(output.persisted).toBe(false);
    expect(output.dryRun).toBe(true);
    expect(output.confirmation).toBeNull();
    expect(output.dailyDropsCreated).toBe(0);
    expect(output.counts.persistedContentItems).toBe(0);

    for (const entry of output.entries) {
      for (const version of entry.versions) {
        expect(version.contentItemId).toBeNull();
      }
    }
  });

  it("refuses persist mode without a server-side repository", async () => {
    await expect(runBootstrapCatalog(options({ persist: true }), dependencies())).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/
    );
  });

  it("rejects duplicate entries instead of writing them twice", async () => {
    // One usable source per topic forces collisions after the first entry.
    const thinPool = (language: Language) => [rankedArticle("business", language, 1)];
    const output = await runBootstrapCatalog(options({ businessStoryCount: 3, miniCaseCountPerTopic: 0 }), {
      generator: new StructuredContentGenerator(),
      loadArticles: async (language) => thinPool(language)
    });

    expect(output.counts.businessStoryEntries).toBe(1);
    expect(output.rejected).toHaveLength(2);
    for (const rejection of output.rejected) {
      expect(rejection.reason).toBe("duplicate_editorial_identity");
    }
  });

  it("reports requested versus produced counts so a short catalog is visible", async () => {
    const output = await runBootstrapCatalog(options({ businessStoryCount: 3, miniCaseCountPerTopic: 0 }), {
      generator: new StructuredContentGenerator(),
      loadArticles: async (language) => [rankedArticle("business", language, 1)]
    });

    expect(output.requested.totalEntries).toBe(3);
    expect(output.requested.totalVersions).toBe(6);
    expect(output.counts.totalEntries).toBe(1);
    expect(output.counts.rejectedEntries).toBe(2);
  });

  it("refuses an entry whose title carries raw feed debris", async () => {
    // A malformed upstream feed can hand the generator a "title" that is really a
    // block of concatenated headlines and URLs. That must not reach the catalog.
    const debris = `${"Headline block ".repeat(20)} https://feed.test/item`;
    const output = await runBootstrapCatalog(options({ businessStoryCount: 1, miniCaseCountPerTopic: 0 }), {
      generator: new StructuredContentGenerator(),
      loadArticles: async (language) => [{ ...rankedArticle("business", language, 1), title: debris }]
    });

    expect(output.entries).toEqual([]);
    expect(output.rejected).toHaveLength(1);
    expect(output.rejected[0].reason).toBe("validation_failed");
    expect(output.rejected[0].details.join(" ")).toMatch(/catalog limit|contains a URL/);
  });

  it("rejects rather than fabricates when there is no source material", async () => {
    const output = await runBootstrapCatalog(options({ businessStoryCount: 2, miniCaseCountPerTopic: 0 }), {
      generator: new StructuredContentGenerator(),
      loadArticles: async () => []
    });

    expect(output.entries).toEqual([]);
    expect(output.rejected).toHaveLength(2);
    expect(output.rejected.every((entry) => entry.reason === "no_source_material")).toBe(true);
  });

  it("validates its option inputs", async () => {
    await expect(runBootstrapCatalog(options({ languages: [] }), dependencies())).rejects.toThrow(/at least one language/);
    await expect(runBootstrapCatalog(options({ languages: ["fr", "fr"] }), dependencies())).rejects.toThrow(/unique/);
    await expect(runBootstrapCatalog(options({ businessStoryCount: -1 }), dependencies())).rejects.toThrow(
      /BUSINESS_STORY_COUNT/
    );
  });
});

describe("bootstrap catalog helpers", () => {
  it("gives every entry a stable, reusable id so a rerun can deduplicate", async () => {
    const first = await runBootstrapCatalog(options({ businessStoryCount: 2, miniCaseCountPerTopic: 1, miniCaseTopics: ["ai"] }), dependencies());
    const second = await runBootstrapCatalog(options({ businessStoryCount: 2, miniCaseCountPerTopic: 1, miniCaseTopics: ["ai"] }), dependencies());

    expect(second.entries.map((entry) => entry.entryId)).toEqual(first.entries.map((entry) => entry.entryId));
    expect(first.entries.map((entry) => entry.entryId)).toEqual([
      "bootstrap-test-business-story-01",
      "bootstrap-test-business-story-02",
      "bootstrap-test-mini-case-ai-01"
    ]);
  });

  it("puts topic-relevant sources first and advances the head per entry", () => {
    const pool = [
      rankedArticle("medicine", "en", 1),
      rankedArticle("business", "en", 1),
      rankedArticle("business", "en", 2)
    ];

    expect(rotateSourceWindow(pool, ["business"], 0)[0].url).toContain("/business/1");
    expect(rotateSourceWindow(pool, ["business"], 1)[0].url).toContain("/business/2");
    // Nothing is dropped: non-matching topics stay available as fallback.
    expect(rotateSourceWindow(pool, ["business"], 0)).toHaveLength(3);
    // A topic with no source falls back to the untouched pool.
    expect(rotateSourceWindow(pool, ["law"], 0)).toEqual(pool);
  });

  it("accepts a normal title and rejects unusable ones", async () => {
    const payload = await new StructuredContentGenerator().generateDailyDrop({
      dropDate: DROP_DATE,
      language: "en",
      articles: sourcePool("en"),
      newsletterTopics: ["business"],
      newsletterArticleCount: 0,
      sections: ["business_story"]
    });
    const story = payload.items[0];

    expect(validateEntryTitle(story, "en", "entry")).toEqual([]);
    expect(validateEntryTitle({ ...story, title: "Too short" }, "en", "entry")).toHaveLength(1);
    expect(validateEntryTitle({ ...story, title: "A".repeat(200) }, "en", "entry")).toHaveLength(1);
    expect(validateEntryTitle({ ...story, title: "A title with https://feed.test/x inside" }, "en", "entry")).toHaveLength(1);
    expect(validateEntryTitle({ ...story, title: "A title with\na line break" }, "en", "entry")).toHaveLength(1);
  });

  it("treats two Business Stories built on the same source as the same story", async () => {
    const payload = await new StructuredContentGenerator().generateDailyDrop({
      dropDate: DROP_DATE,
      language: "en",
      articles: sourcePool("en"),
      newsletterTopics: ["business"],
      newsletterArticleCount: 0,
      sections: ["business_story"]
    });

    const story = payload.items[0];
    const [titleKey, sourceKey] = editorialIdentities(story, null);
    expect(titleKey).toContain("business_story|title|");
    expect(sourceKey).toBe(`business_story|source|${story.source_urls.join(",")}`);
  });
});
