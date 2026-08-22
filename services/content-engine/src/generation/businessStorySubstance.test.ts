import { describe, expect, it } from "vitest";

import type { BusinessStory } from "../domain.js";
import { validateBusinessStorySubstance } from "./businessStorySubstance.js";
import { assessBusinessStorySourceRichness } from "../catalog/businessStoryRichness.js";
import { allocateBusinessStorySourcePackets } from "../catalog/sourceEventAllocation.js";
import type { RankedArticle } from "../domain.js";

/**
 * Four real candidates from the first repair batch passed every validator and
 * were unpublishable on sight. Their titles were the tell:
 *
 *   "Brouillon non publiable : le mécanisme économique reste à documenter"
 *   "CVAE : une échéance réelle, mais pas encore une histoire d'entreprise démontrée"
 *   "Données fiscales compromises : le coût économique reste à documenter"
 *   "Budget de rentrée : les abonnements sont visibles, pas encore le mécanisme"
 *
 * The prompt taught the model not to invent and the model obeyed. Nothing
 * checked the other half: when the source could not carry a story, the refusal
 * became the story. These are those four, as regression tests.
 */

function story(overrides: Partial<BusinessStory> = {}): BusinessStory {
  return {
    content_type: "business_story",
    slot: "business_story",
    topic: "business",
    language: "fr",
    title: "Comment un distributeur a défendu sa marge en resserrant sa sélection",
    company_or_market: "Distributeur régional",
    story_date: "2026-08-20",
    setup: "Le distributeur voit ses coûts unitaires monter de 8% sur un trimestre.",
    tension: "Il doit choisir entre absorber la hausse et la répercuter sur ses clients fidèles.",
    decision: "La direction relève les tarifs sur les références les moins substituables.",
    outcome: "La marge brute se stabilise et le volume recule de 3% sur le segment concerné.",
    lesson: "La marge se défend par la sélection des références, pas par une hausse uniforme.",
    body_md:
      "Le distributeur a relevé ses prix sur 40 références. La marge brute est stabilisée à 22%.",
    editorial_memory: {
      entity_name: "Distributeur régional",
      entity_type: "company",
      main_company: "Distributeur régional",
      companies_mentioned: ["Distributeur régional"],
      industry: "retail",
      key_mechanism: "pouvoir de fixation des prix",
      secondary_mechanisms: [],
      strategic_angle: "sélectionner avant de repricer",
      core_takeaway: "La sélection défend la marge mieux qu'une hausse uniforme.",
      year_period: "2020s"
    },
    source_urls: ["https://sources.test/retail/1"],
    version: 1,
    ...overrides
  } as BusinessStory;
}

function article(input: { url: string; title: string; summary: string; body: string }): RankedArticle {
  return {
    url: input.url,
    title: input.title,
    publisher: "Desk",
    author: null,
    published_at: "2026-08-20T08:00:00.000Z",
    retrieved_at: "2026-08-20T09:00:00.000Z",
    language: "en",
    summary: input.summary,
    body: input.body,
    sourceTopic: "business",
    credibility_score: 0.9,
    content_hash: input.url,
    normalized_url: input.url,
    topic: "business",
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

describe("a Business Story may not be an article about there being no story", () => {
  it("refuses the unpublishable-draft title", () => {
    const issues = validateBusinessStorySubstance(
      story({ title: "Brouillon non publiable : le mécanisme économique reste à documenter" })
    );

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((issue) => issue.code)).toContain("business_story_self_refuting");
  });

  it("refuses a conclusion that the economic cost is undocumented", () => {
    const issues = validateBusinessStorySubstance(
      story({ title: "Données fiscales compromises : le coût économique reste à documenter" })
    );

    expect(issues.some((issue) => issue.field === "title")).toBe(true);
  });

  it("refuses a title saying it is not yet a demonstrated company story", () => {
    const issues = validateBusinessStorySubstance(
      story({
        title: "CVAE : une échéance réelle, mais pas encore une histoire d'entreprise démontrée"
      })
    );

    expect(issues.length).toBeGreaterThan(0);
  });

  it("refuses a title saying the subscriptions are visible but not the mechanism", () => {
    const issues = validateBusinessStorySubstance(
      story({ title: "Budget de rentrée : les abonnements sont visibles, pas encore le mécanisme" })
    );

    expect(issues.length).toBeGreaterThan(0);
  });

  it("refuses a body that opens by saying the evidence is insufficient", () => {
    const issues = validateBusinessStorySubstance(
      story({
        body_md:
          "Brouillon à valider — preuves insuffisantes pour une Business Story complète. La source fournie ne permet pas d'en faire une histoire business solide."
      })
    );

    expect(issues.map((issue) => issue.code)).toContain("business_story_self_refuting");
  });

  it("refuses a declared mechanism that is the absence of a mechanism", () => {
    const issues = validateBusinessStorySubstance(
      story({
        editorial_memory: {
          ...story().editorial_memory!,
          key_mechanism: "mécanisme économique non documenté"
        }
      })
    );

    expect(issues.map((issue) => issue.code)).toContain("business_story_mechanism_absent");
    expect(issues[0].field).toBe("editorial_memory.key_mechanism");
  });

  it("refuses a decision that is really: get another source", () => {
    const issues = validateBusinessStorySubstance(
      story({
        decision: "Le mécanisme économique n'est pas établi : une autre source est nécessaire.",
        outcome: "Aucun effet commercial ne peut être établi à ce stade."
      })
    );

    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts a real story", () => {
    expect(validateBusinessStorySubstance(story())).toEqual([]);
  });

  it("still allows honest hedging inside the narrative", () => {
    // A story is allowed to say the market has not reacted yet. What it may not
    // do is conclude that it has nothing to conclude.
    const issues = validateBusinessStorySubstance(
      story({
        body_md:
          "Le distributeur a relevé ses prix sur 40 références. L'effet sur le volume n'est pas encore visible dans les chiffres publiés, et la marge brute est stabilisée à 22%."
      })
    );

    expect(issues).toEqual([]);
  });
});

describe("a thin event never reaches generation in the first place", () => {
  const THIN = article({
    url: "https://gov.test/data-breach",
    title: "Tax data compromised in a supplier incident",
    summary: "The administration confirmed that some tax records were exposed after an incident at a supplier.",
    body:
      "The administration said an incident at one of its suppliers exposed a number of tax records. It did not name the supplier, did not say how many records were involved, and gave no timeline for the review. A statement is expected later in the year. Officials declined to comment further while the review is under way."
  });

  const RICH = article({
    url: "https://retail.test/reprice",
    title: "Retailer reprices 40 lines after unit costs rise",
    summary: "The chain raised prices on its least substitutable lines, holding gross margin at 22% as volumes fell 3%.",
    body:
      "The chain absorbed a rise in unit costs for two quarters before repricing 40 lines. Gross margin held at 22% while volume on the affected lines fell 3%, and the competitor has not matched the move. Management said the selection mattered more than the size of the increase, because the substitutable lines would have lost share."
  });

  it("skips the thin event and allocates the one that can carry a story", () => {
    expect(assessBusinessStorySourceRichness({ articles: [THIN] }).verdict).not.toBe("sufficient");

    const packets = allocateBusinessStorySourcePackets({
      articles: [THIN, RICH],
      topics: ["business"]
    });

    // The thin event is not merely ranked lower — it is not offered at all, so
    // there is no story to write about the absence of a story.
    expect(packets.map((packet) => packet.primary.url)).toEqual([RICH.url]);
  });

  it("fails the whole allocation rather than settle for the thin event", () => {
    expect(
      allocateBusinessStorySourcePackets({ articles: [THIN], topics: ["business"] })
    ).toEqual([]);
  });
});
