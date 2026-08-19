import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { GeneratedContentItem, RankedArticle, TopicId } from "../domain.js";
import {
  buildSourceIndex,
  validateDailyDropQuality,
  validateGeneratedItem
} from "./validation.js";

/**
 * The last three strict-validation failures from the live proof.
 *
 *  - two mini-case titles rejected for carrying no topic vocabulary, although
 *    both were strong scenario titles;
 *  - a newsletter that turned "next week" into "2026-08-26".
 *
 * The title rule is now shaped per content type rather than relaxed, and the
 * date rule is unchanged — what changed is that it now runs early enough to be
 * retried.
 */

function source(input: {
  url: string;
  title: string;
  summary: string;
  topic: TopicId;
}): RankedArticle {
  return {
    url: input.url,
    title: input.title,
    publisher: "Test Publisher",
    author: null,
    published_at: "2026-08-18T08:00:00.000Z",
    retrieved_at: "2026-08-19T09:00:00.000Z",
    language: "fr",
    summary: input.summary,
    body: input.summary,
    sourceTopic: input.topic,
    canonicalTopic: input.topic,
    credibility_score: 0.9,
    content_hash: `hash-${input.url}`,
    normalized_url: input.url,
    topic: input.topic,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

function miniCase(overrides: Record<string, unknown>, topic: TopicId): GeneratedContentItem {
  return {
    content_type: "mini_case",
    slot: "mini_case",
    language: "fr",
    topic,
    source_urls: ["https://example.test/a"],
    version: 1,
    product_topic: "law_compliance",
    score_max: 3,
    questions: [],
    ...overrides
  } as unknown as GeneratedContentItem;
}

/** Only the title/claim issues, so unrelated mini-case rules stay out of the way. */
function issuesFor(
  item: GeneratedContentItem,
  sources: RankedArticle[],
  codes: string[]
): string[] {
  const quality = validateDailyDropQuality(
    {
      drop_date: "2026-08-19",
      language: "fr",
      prompt_version: "test",
      generator_version: "test",
      items: [item]
    },
    { articles: sources, productionStrict: true, rssOnly: true }
  );

  return quality.issues
    .filter((issue) => codes.includes(issue.code ?? ""))
    .map((issue) => issue.code ?? "");
}

const LAW_SOURCE = source({
  url: "https://example.test/a",
  title: "Réforme des marchés publics : la procédure accélérée étendue",
  summary:
    "Le seuil de la procédure accélérée passe à 140 000 euros pour les marchés publics de fournitures.",
  topic: "law"
});

const MEDICINE_SOURCE = source({
  url: "https://example.test/a",
  title: "FDA authorizes a new diagnostic test",
  summary:
    "The authorization covers emergency use; hospitals must still decide whether to buy the test before procurement budgets close.",
  topic: "medicine"
});

describe("mini-case titles are validated against their own scenario", () => {
  it("accepts the FR law scenario title the proof rejected", () => {
    const item = miniCase(
      {
        title: "Le marché accéléré à 140 000 €",
        context:
          "Votre direction achats doit lancer un marché public de fournitures dont le montant atteint 140 000 euros.",
        challenge:
          "La procédure accélérée est possible mais réduit le délai de réponse des candidats.",
        question: "Lancez-vous la procédure accélérée ?",
        body_md:
          "Le marché porte sur 140 000 euros. La procédure accélérée réduit les délais mais expose à un recours."
      },
      "law"
    );

    // No topic vocabulary in the title, and it must still pass.
    expect(issuesFor(item, [LAW_SOURCE], ["mini_case_title_ungrounded"])).toEqual([]);
  });

  it("accepts the EN medicine scenario title the proof rejected", () => {
    const item = miniCase(
      {
        title: "Authorized Is Not Ready to Buy",
        language: "en",
        context:
          "The diagnostic test has just been authorized, and your hospital network must decide whether to buy it now.",
        challenge: "Authorization is not the same as a procurement decision.",
        question: "Do you buy before the budget closes?",
        body_md:
          "The test is authorized. Buying it now commits budget the network cannot recover."
      },
      "medicine"
    );

    expect(issuesFor(item, [MEDICINE_SOURCE], ["mini_case_title_ungrounded"])).toEqual([]);
  });

  it("accepts a narrative title grounded by a figure alone", () => {
    const item = miniCase(
      {
        title: "Un seuil à 140 000 €",
        context: "Le seuil applicable est de 140 000 euros.",
        challenge: "Le dépassement change la procédure.",
        question: "Que faites-vous ?",
        body_md: "Le seuil de 140 000 euros décide de la procédure."
      },
      "law"
    );

    expect(issuesFor(item, [LAW_SOURCE], ["mini_case_title_ungrounded"])).toEqual([]);
  });

  it.each([
    "A Difficult Decision",
    "Think Carefully",
    "The Big Opportunity",
    "Une décision difficile"
  ])("rejects the generic title %s", (title) => {
    const item = miniCase(
      {
        title,
        context:
          "Votre direction achats doit lancer un marché public de fournitures à 140 000 euros.",
        challenge: "La procédure accélérée réduit le délai de réponse.",
        question: "Lancez-vous la procédure accélérée ?",
        body_md: "Le marché porte sur 140 000 euros."
      },
      "law"
    );

    expect(issuesFor(item, [LAW_SOURCE], ["mini_case_title_ungrounded"])).toEqual([
      "mini_case_title_ungrounded"
    ]);
  });

  it("rejects a title unrelated to the scenario", () => {
    const item = miniCase(
      {
        title: "La tournée européenne du groupe islandais",
        context: "Votre direction achats doit lancer un marché public à 140 000 euros.",
        challenge: "La procédure accélérée réduit le délai.",
        question: "Lancez-vous la procédure accélérée ?",
        body_md: "Le marché porte sur 140 000 euros."
      },
      "law"
    );

    expect(issuesFor(item, [LAW_SOURCE], ["mini_case_title_ungrounded"])).toEqual([
      "mini_case_title_ungrounded"
    ]);
  });
});

describe("the other content types keep the strict topic rule", () => {
  const newsletter = (title: string): GeneratedContentItem =>
    ({
      content_type: "newsletter_article",
      slot: "newsletter",
      language: "fr",
      title,
      topic: "law",
      source_urls: ["https://example.test/a"],
      version: 1,
      summary: "Résumé.",
      why_it_matters: "Pourquoi.",
      published_date: "2026-08-18",
      body_md: "Corps de l'article."
    }) as unknown as GeneratedContentItem;

  it("still rejects a newsletter title that reflects neither topic nor source", () => {
    expect(
      issuesFor(newsletter("La tournée du groupe islandais"), [LAW_SOURCE], [
        "title_topic_mismatch"
      ])
    ).toEqual(["title_topic_mismatch"]);
  });

  it("still accepts a newsletter title that overlaps its source", () => {
    expect(
      issuesFor(newsletter("Marchés publics : la procédure accélérée étendue"), [LAW_SOURCE], [
        "title_topic_mismatch"
      ])
    ).toEqual([]);
  });

  it("still rejects a business story title that reflects neither topic nor source", () => {
    const story = {
      content_type: "business_story",
      slot: "business_story",
      language: "fr",
      title: "La tournée du groupe islandais",
      topic: "law",
      source_urls: ["https://example.test/a"],
      version: 1,
      company_or_market: "Marchés publics",
      story_date: "2026-08-18",
      setup: "s",
      tension: "t",
      decision: "d",
      outcome: "o",
      lesson: "l",
      body_md: "Corps."
    } as unknown as GeneratedContentItem;

    expect(issuesFor(story, [LAW_SOURCE], ["title_topic_mismatch"])).toEqual([
      "title_topic_mismatch"
    ]);
  });

  it("applies the mini-case rule only to mini cases", () => {
    // A scenario-style title on a newsletter is still judged by the strict rule.
    expect(
      issuesFor(newsletter("Authorized Is Not Ready to Buy"), [LAW_SOURCE], [
        "title_topic_mismatch",
        "mini_case_title_ungrounded"
      ])
    ).toEqual(["title_topic_mismatch"]);
  });
});

describe("dates must be supported by the source", () => {
  const relativeSource = source({
    url: "https://example.test/a",
    title: "Le régulateur publiera sa décision",
    summary: "La décision du tribunal est attendue la semaine prochaine, selon le régulateur.",
    topic: "law"
  });
  const explicitSource = source({
    url: "https://example.test/a",
    title: "Le régulateur publiera sa décision le 2026-08-26",
    summary: "La décision du tribunal est attendue le 2026-08-26, selon le régulateur.",
    topic: "law"
  });

  const article = (body: string): GeneratedContentItem =>
    ({
      content_type: "newsletter_article",
      slot: "newsletter",
      language: "fr",
      title: "Le régulateur publiera sa décision",
      topic: "law",
      source_urls: ["https://example.test/a"],
      version: 1,
      summary: "Résumé.",
      why_it_matters: "Pourquoi.",
      published_date: "2026-08-18",
      body_md: body
    }) as unknown as GeneratedContentItem;

  it("rejects a precise date invented from relative timing", () => {
    // Exactly the live failure: the source said "next week".
    expect(
      issuesFor(article("La décision est attendue le 2026-08-26."), [relativeSource], [
        "unsupported_specific_claim"
      ])
    ).toEqual(["unsupported_specific_claim"]);
  });

  it("accepts the relative wording preserved", () => {
    expect(
      issuesFor(article("La décision est attendue la semaine prochaine."), [relativeSource], [
        "unsupported_specific_claim"
      ])
    ).toEqual([]);
  });

  it("accepts a date the source states explicitly", () => {
    expect(
      issuesFor(article("La décision est attendue le 2026-08-26."), [explicitSource], [
        "unsupported_specific_claim"
      ])
    ).toEqual([]);
  });
});

describe("the contracts that prevent invented dates and feed the retry", () => {
  const generator = readFileSync(join(__dirname, "llmGenerator.ts"), "utf8");
  const validation = readFileSync(join(__dirname, "validation.ts"), "utf8");

  it("tells the model to preserve relative timing", () => {
    expect(generator).toMatch(/DATES: write a calendar date only when the supplied source/);
    expect(generator).toMatch(/keep the relative wording/i);
    expect(generator).toMatch(/never compute one from the publication date/i);
  });

  it("runs claim grounding per section, where a retry can still fix it", () => {
    expect(generator).toMatch(/validateSectionQuality/);
    // Inside validateSectionItems, which is what produces retry feedback.
    const sectionValidator = generator.slice(generator.indexOf("function validateSectionItems"));
    expect(sectionValidator.slice(0, sectionValidator.indexOf("\n}"))).toMatch(
      /validateSectionQuality/
    );
  });

  it("gives the retry an instruction, not just a complaint", () => {
    expect(validation).toMatch(/Remove them or replace them with wording the source actually supports/);
    expect(validation).toMatch(/keep that relative wording instead of naming a date/);
  });
});

describe("a title may be grounded in the source summary, not only its headline", () => {
  const summarySource = source({
    url: "https://example.test/a",
    title: "Marché : la cotation du jour",
    summary:
      "Unitree, spécialiste de la robotique humanoïde, lève des fonds en Bourse pour financer sa production.",
    topic: "engineering"
  });

  const article = (title: string): GeneratedContentItem =>
    ({
      content_type: "newsletter_article",
      slot: "newsletter",
      language: "fr",
      title,
      topic: "engineering",
      source_urls: ["https://example.test/a"],
      version: 1,
      summary: "Résumé.",
      why_it_matters: "Pourquoi.",
      published_date: "2026-08-18",
      body_md: "Corps."
    }) as unknown as GeneratedContentItem;

  it("accepts a headline drawn from the summary", () => {
    // The live proof rejected exactly this shape: the company was named in the
    // source summary, not in its headline.
    expect(
      issuesFor(article("Unitree : la Bourse finance la robotique humanoïde"), [summarySource], [
        "title_topic_mismatch"
      ])
    ).toEqual([]);
  });

  it("still rejects a headline grounded in neither topic nor packet", () => {
    expect(
      issuesFor(article("La tournée du groupe islandais"), [summarySource], [
        "title_topic_mismatch"
      ])
    ).toEqual(["title_topic_mismatch"]);
  });
});

describe("a title grounded in an inflected form of its source's words", () => {
  const innovationSource = source({
    url: "https://example.test/a",
    title: "Gaining Leadership Backing for Your Innovations",
    summary: "Research on how innovators secure an executive sponsor inside large firms.",
    topic: "business"
  });

  const article = (title: string): GeneratedContentItem =>
    ({
      content_type: "newsletter_article",
      slot: "newsletter",
      language: "en",
      title,
      topic: "business",
      source_urls: ["https://example.test/a"],
      version: 1,
      summary: "Summary.",
      why_it_matters: "Why.",
      published_date: "2026-08-18",
      body_md: "Body."
    }) as unknown as GeneratedContentItem;

  it("accepts a headline that inflects the source's own words", () => {
    // The live failure: "innovation"/"innovations" and "leader"/"leadership"
    // were read as unrelated words.
    expect(
      issuesFor(article("Innovation stalls when no leader owns it"), [innovationSource], [
        "title_topic_mismatch"
      ])
    ).toEqual([]);
  });

  it("does not treat a merely similar prefix as grounding", () => {
    expect(
      issuesFor(article("La tournée du groupe islandais"), [innovationSource], [
        "title_topic_mismatch"
      ])
    ).toEqual(["title_topic_mismatch"]);
  });
});

describe("a weak title is retried instead of failing the edition", () => {
  const generator = readFileSync(join(__dirname, "llmGenerator.ts"), "utf8");

  it("checks titles per section, where an attempt is still left", () => {
    const helper = generator.slice(generator.indexOf("function validateSectionQuality"));

    expect(helper.slice(0, helper.indexOf("\n}\n"))).toMatch(/validateDailyDropQuality/);
  });

  it("hands the retry the source vocabulary instead of a bare complaint", () => {
    const rejected = validateDailyDropQuality(
      {
        drop_date: "2026-08-19",
        language: "fr",
        prompt_version: "test",
        generator_version: "test",
        items: [
          {
            content_type: "newsletter_article",
            slot: "newsletter",
            language: "fr",
            title: "La tournée du groupe islandais",
            topic: "law",
            source_urls: ["https://example.test/a"],
            version: 1,
            summary: "Résumé.",
            why_it_matters: "Pourquoi.",
            published_date: "2026-08-18",
            body_md: "Corps."
          } as unknown as GeneratedContentItem
        ]
      },
      { articles: [LAW_SOURCE], productionStrict: true, rssOnly: true }
    );
    const issue = rejected.issues.find((entry) => entry.code === "title_topic_mismatch");

    expect(issue?.message).toMatch(/Rewrite it around the concrete subject of the source/);
    // Words the packet actually offers, so the model has something to use.
    expect(issue?.message).toMatch(/marches|marchés|procedure|procédure/i);
  });

  it("tells the model a newsletter title must name its subject", () => {
    const prompts = readFileSync(join(__dirname, "prompts.ts"), "utf8");

    expect(prompts).toMatch(/TITLE: name the concrete subject of the source/);
  });
});

describe("the section-level source index matches how items cite sources", () => {
  const generator = readFileSync(join(__dirname, "llmGenerator.ts"), "utf8");

  it("builds the index through the shared normalizing helper", () => {
    // Keying by raw URL made every lookup miss, so the section checks compared
    // each item against an empty packet and always passed.
    const helper = generator.slice(generator.indexOf("function validateSectionQuality"));
    const body = helper.slice(0, helper.indexOf("\n}\n"));

    expect(body).toMatch(/validateDailyDropQuality/);
    expect(body).not.toMatch(/\[article\.url, article\]/);
  });

  it("finds a source cited with a tracking parameter", () => {
    const index = buildSourceIndex([LAW_SOURCE]);

    expect(index.size).toBe(1);
    expect(
      issuesFor(
        {
          content_type: "newsletter_article",
          slot: "newsletter",
          language: "fr",
          title: "Marchés publics : la procédure accélérée étendue",
          topic: "law",
          source_urls: ["https://example.test/a"],
          version: 1,
          summary: "Résumé.",
          why_it_matters: "Pourquoi.",
          published_date: "2026-08-18",
          body_md: "Corps."
        } as unknown as GeneratedContentItem,
        [LAW_SOURCE],
        ["title_topic_mismatch"]
      )
    ).toEqual([]);
  });
});

describe("the personal-advice guard", () => {
  const advisingItem = {
    content_type: "mini_case",
    slot: "mini_case",
    language: "en",
    title: "The Robot Draw",
    topic: "medicine",
    product_topic: "law_compliance",
    source_urls: ["https://example.test/a"],
    version: 1,
    score_max: 3,
    questions: [],
    context: "A hospital network weighs the device.",
    body_md: "Patients diagnosed with anemia are drawn twice a week."
  } as unknown as GeneratedContentItem;

  it("names the offending wording so a retry can rewrite it", () => {
    const issue = validateGeneratedItem(advisingItem, "items.0").find(
      (entry) => entry.code === "high_stakes_personal_advice"
    );

    expect(issue?.message).toMatch(/diagnosed with/);
    expect(issue?.message).toMatch(/institutional analysis/);
  });

  it("still rejects the item", () => {
    expect(
      validateGeneratedItem(advisingItem, "items.0").some(
        (entry) => entry.code === "high_stakes_personal_advice"
      )
    ).toBe(true);
  });

  it("runs per section, where an attempt is still left", () => {
    const generator = readFileSync(join(__dirname, "llmGenerator.ts"), "utf8");
    const helper = generator.slice(generator.indexOf("function validateSectionQuality"));

    expect(helper.slice(0, helper.indexOf("\n}\n"))).toMatch(/validateGeneratedItem/);
  });
});

describe("a rejected mini-case title tells the retry what to use", () => {
  it("offers the scenario's own vocabulary", () => {
    const item = miniCase(
      {
        title: "La tournée du groupe islandais",
        context:
          "Votre direction achats doit lancer un marché public de fournitures à 140 000 euros.",
        challenge: "La procédure accélérée réduit le délai de réponse.",
        question: "Lancez-vous la procédure accélérée ?",
        body_md: "Le marché porte sur 140 000 euros."
      },
      "law"
    );

    const quality = validateDailyDropQuality(
      {
        drop_date: "2026-08-19",
        language: "fr",
        prompt_version: "test",
        generator_version: "test",
        items: [item]
      },
      { articles: [LAW_SOURCE], productionStrict: true, rssOnly: true }
    );
    const issue = quality.issues.find((entry) => entry.code === "mini_case_title_ungrounded");

    expect(issue?.message).toMatch(/Rewrite it around something the case itself names/);
    expect(issue?.message).toMatch(/marche|marché|fournitures|procedure|procédure/i);
  });

  it("accepts a title that inflects a scenario term", () => {
    const item = miniCase(
      {
        // "fourniture" against the scenario's "fournitures".
        title: "La fourniture qui change de procédure",
        context:
          "Votre direction achats doit lancer un marché public de fournitures à 140 000 euros.",
        challenge: "La procédure accélérée réduit le délai de réponse.",
        question: "Lancez-vous la procédure accélérée ?",
        body_md: "Le marché porte sur 140 000 euros."
      },
      "law"
    );

    expect(issuesFor(item, [LAW_SOURCE], ["mini_case_title_ungrounded"])).toEqual([]);
  });
});
