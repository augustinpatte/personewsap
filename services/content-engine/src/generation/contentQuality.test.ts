import { describe, expect, it } from "vitest";
import type { DailyDropPayload, GeneratedContentItem, RankedArticle } from "../domain.js";
import { sanitizeLlmDailyDropPayload } from "./llmSanitizer.js";
import { assertValidDailyDropPayload, validateDailyDropQuality } from "./validation.js";

const SOURCE_DATE = "2026-04-29";
const RETRIEVED_DATE = "2026-04-29";
const SOURCE_URL = "https://www.reputable-publisher.test/markets/oil-price-risk";

const SOURCE: RankedArticle = {
  url: SOURCE_URL,
  title: "Oil prices jump as supply risk changes market expectations",
  publisher: "Reputable Markets Desk",
  author: null,
  published_at: `${SOURCE_DATE}T08:00:00.000Z`,
  retrieved_at: `${RETRIEVED_DATE}T09:00:00.000Z`,
  language: "en",
  summary: "Oil prices rose after a supply disruption changed inflation and market risk expectations.",
  sourceTopic: "finance",
  credibility_score: 0.85,
  content_hash: "finance-source",
  normalized_url: SOURCE_URL,
  topic: "finance",
  importance_score: 0.81,
  rank_reasons: ["market risk", "funding impact"]
};

describe("content quality validation", () => {
  it("rejects source URLs that were not supplied to generation", () => {
    const payload = payloadWithItem(newsletterItem("https://www.other-publisher.test/story"));
    const diagnostics = validateDailyDropQuality(payload, {
      articles: [SOURCE],
      rssOnly: true,
      productionStrict: true
    });

    expect(diagnostics.issues.map((issue) => issue.code)).toContain("unsupported_source_url");
    expect(() => assertValidDailyDropPayload(payload, {
      articles: [SOURCE],
      rssOnly: true,
      productionStrict: true
    })).toThrow(/Source URL must come from the supplied ranked article material/);
  });

  it("accepts supplied URLs after safe tracking-parameter normalization", () => {
    const payload = payloadWithItem(newsletterItem(`${SOURCE_URL}/?utm_source=llm#summary`, exactSourceBody(SOURCE_URL)));

    const diagnostics = validateDailyDropQuality(payload, {
      articles: [SOURCE],
      rssOnly: true,
      productionStrict: true
    });

    expect(diagnostics.issues.map((issue) => issue.code)).not.toContain("unsupported_source_url");
    expect(diagnostics.issues.map((issue) => issue.code)).not.toContain("source_url_not_cited");
  });

  it("rejects empty generic filler and titles detached from topic/source", () => {
    const payload = payloadWithItem({
      ...newsletterItem(SOURCE_URL),
      title: "Generic update",
      summary: "Placeholder content for a finance article.",
      body_md: [
        "Placeholder content says very little about the actual finance mechanism, market risk, source fact, or decision owner.",
        `Source: Reputable Markets Desk, published ${SOURCE_DATE}, retrieved ${RETRIEVED_DATE}. ${SOURCE_URL}`
      ].join("\n\n")
    });
    const diagnostics = validateDailyDropQuality(payload, {
      articles: [SOURCE],
      rssOnly: true,
      productionStrict: true
    });
    const codes = diagnostics.issues.map((issue) => issue.code);

    expect(codes).toContain("generic_filler");
    expect(codes).toContain("title_topic_mismatch");
  });

  it("rejects sample source material in production-strict validation", () => {
    const sampleSource: RankedArticle = {
      ...SOURCE,
      url: "https://internal.test/finance/sample-source",
      normalized_url: "https://internal.test/finance/sample-source",
      publisher: "PersoNewsAP Sample Desk"
    };
    const payload = payloadWithItem(newsletterItem(sampleSource.url));
    const diagnostics = validateDailyDropQuality(payload, {
      articles: [sampleSource],
      rssOnly: true,
      productionStrict: true
    });

    expect(diagnostics.issues.map((issue) => issue.code)).toContain("sample_source_material");
  });
});

describe("LLM sanitizer", () => {
  it("canonicalizes supplied source URLs and appends the exact source/date line", () => {
    const payload = payloadWithItem(newsletterItem(`${SOURCE_URL}/?utm_medium=llm#draft`, [
      "Oil prices rose after a supply disruption changed inflation expectations.",
      "The finance signal is market risk and funding cost pressure for operators."
    ].join("\n\n")));

    const sanitized = sanitizeLlmDailyDropPayload(payload, [SOURCE]);
    const item = sanitized.items[0];

    expect(item.source_urls).toEqual([SOURCE_URL]);
    expect(item.body_md).toContain(SOURCE_URL);
    expect(item.body_md).toContain(`published ${SOURCE_DATE}`);
    expect(() => assertValidDailyDropPayload(sanitized, {
      articles: [SOURCE],
      rssOnly: true,
      productionStrict: true
    })).not.toThrow();
  });

  it("repairs FR concept category anchors with the same production structure", () => {
    const payload: DailyDropPayload = {
      drop_date: SOURCE_DATE,
      language: "fr",
      prompt_version: "test",
      generator_version: "test",
      items: [{
        content_type: "concept",
        slot: "concept",
        topic: "finance",
        language: "fr",
        title: "Lecture de decision",
        category: "business",
        definition: "Le risque de marche mesure comment une nouvelle information change une decision de capital.",
        plain_english: "On regarde si le fait source modifie le cout, le risque ou le calendrier.",
        example: "La hausse du petrole change les attentes d'inflation et les risques de financement.",
        why_it_matters: "Le concept aide a relier une information sourcee a une decision testable.",
        how_to_use_it: "Associe la date sourcee, le signal de marche et le proprietaire de la decision.",
        common_mistake: "Transformer le sujet en opinion generale au lieu de nommer le signal.",
        body_md: "La hausse du petrole change les attentes d'inflation et les risques de financement.",
        source_urls: [],
        version: 1
      }]
    };

    const sanitized = sanitizeLlmDailyDropPayload(payload, [SOURCE]);
    const concept = sanitized.items[0];

    expect(concept.source_urls).toEqual([SOURCE_URL]);
    expect(concept.body_md).toContain(SOURCE_URL);
    expect(concept.body_md).toContain(SOURCE_DATE);
    expect(concept.content_type === "concept" ? concept.category : null).toBe("finance");
    expect(concept.title.toLowerCase()).toContain("risk");
  });
});

function payloadWithItem(item: GeneratedContentItem): DailyDropPayload {
  return {
    drop_date: SOURCE_DATE,
    language: item.language,
    prompt_version: "test",
    generator_version: "test",
    items: [item]
  };
}

function newsletterItem(sourceUrl: string, body = exactSourceBody(sourceUrl)): GeneratedContentItem {
  return {
    content_type: "newsletter_article",
    slot: "newsletter",
    topic: "finance",
    language: "en",
    title: "Oil price risk changes finance budgets",
    published_date: SOURCE_DATE,
    summary: "Oil prices rose after a supply disruption changed inflation and market risk expectations.",
    body_md: body,
    why_it_matters: "Finance teams need the market signal before changing capital and budget decisions.",
    source_urls: [sourceUrl],
    version: 1
  };
}

function exactSourceBody(sourceUrl: string): string {
  return [
    "Oil prices rose after a supply disruption changed inflation and market risk expectations.",
    "The finance mechanism is risk repricing: higher uncertainty changes funding costs, budget buffers, and the timing of capital decisions.",
    "The observable signal is whether funding costs, inflation expectations, or budget guidance move again after the initial shock.",
    `Source: Reputable Markets Desk, published ${SOURCE_DATE}, retrieved ${RETRIEVED_DATE}. ${sourceUrl}`
  ].join("\n\n");
}
