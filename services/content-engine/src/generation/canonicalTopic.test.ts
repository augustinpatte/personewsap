import { describe, expect, it } from "vitest";

import type { GeneratedContentItem, TopicId } from "../domain.js";
import { applyCanonicalSectionTopic } from "./llmGenerator.js";
import { validateMiniCaseOptionDistinctness } from "./validation.js";

/**
 * Two former live-validation failures, fixed at their source.
 *
 *  - "Item topic X must match at least one cited source topic": the model was
 *    free to emit its own `topic`, so a topic-scoped call could return an item
 *    filed elsewhere. The engine already knows the topic; it now imposes it.
 *  - "A: 23%  B: 30%  C: 23%  D: 23%": three identical MCQ options made a
 *    question unanswerable and its score meaningless.
 */

function item(topic: TopicId | null, contentType = "newsletter_article"): GeneratedContentItem {
  return {
    content_type: contentType,
    slot: contentType === "newsletter_article" ? "newsletter" : contentType,
    language: "fr",
    title: "Un titre",
    topic,
    source_urls: ["https://example.test/a"],
    version: 1,
    body_md: "Corps."
  } as unknown as GeneratedContentItem;
}

describe("the engine owns a topic-scoped section's topic", () => {
  it("overrides whatever topic the model emitted", () => {
    // The model drifted to law inside the tech_ai call.
    const [result] = applyCanonicalSectionTopic(
      [item("law")],
      "newsletter_article",
      { newsletterTopic: "tech_ai" },
      [{ topic: "tech_ai" }]
    );

    expect(result.topic).toBe("tech_ai");
  });

  it("fills a missing topic rather than leaving it null", () => {
    const [result] = applyCanonicalSectionTopic(
      [item(null)],
      "newsletter_article",
      { newsletterTopic: "finance" },
      [{ topic: "finance" }]
    );

    expect(result.topic).toBe("finance");
  });
});

describe("an unscoped section is pinned to its own sources", () => {
  it("keeps the model's topic when its packet supports it", () => {
    const [result] = applyCanonicalSectionTopic(
      [item("business", "business_story")],
      "business_story",
      {},
      [{ topic: "finance" }, { topic: "business" }]
    );

    expect(result.topic).toBe("business");
  });

  it("repins a topic no cited source supports", () => {
    // This is the exact shape of the live failure: item said finance, the
    // packet only held business.
    const [result] = applyCanonicalSectionTopic(
      [item("finance", "business_story")],
      "business_story",
      {},
      [{ topic: "business" }]
    );

    expect(result.topic).toBe("business");
  });
});

describe("MCQ options must be four different answers", () => {
  const option = (text: string, is_correct = false) => ({ text, is_correct, feedback: "f" });

  it("rejects the duplicated-percentage defect", () => {
    const issues = validateMiniCaseOptionDistinctness(
      [option("23%"), option("30%", true), option("23%"), option("23%")],
      "items.0.questions.0",
      true
    );

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.code === "mini_case_mcq_duplicate_option")).toBe(true);
  });

  it("catches the same value written differently", () => {
    const issues = validateMiniCaseOptionDistinctness(
      [option("23%"), option("23 %"), option("30%", true), option("41%")],
      "items.0.questions.0",
      true
    );

    expect(
      issues.some(
        (issue) =>
          issue.code === "mini_case_mcq_duplicate_option" ||
          issue.code === "mini_case_mcq_indistinguishable_numeric_option"
      )
    ).toBe(true);
  });

  it("catches the correct answer repeated as a distractor", () => {
    const issues = validateMiniCaseOptionDistinctness(
      [
        option("Renégocier le contrat", true),
        option("renegocier le contrat"),
        option("Attendre"),
        option("Résilier")
      ],
      "items.0.questions.0",
      true
    );

    expect(
      issues.some((issue) => issue.code === "mini_case_mcq_correct_option_duplicated")
    ).toBe(true);
  });

  it("accepts four genuinely distinct options", () => {
    expect(
      validateMiniCaseOptionDistinctness(
        [option("23%"), option("30%", true), option("41%"), option("52%")],
        "items.0.questions.0",
        true
      )
    ).toEqual([]);
  });

  it("ignores case, accents and punctuation when comparing", () => {
    const issues = validateMiniCaseOptionDistinctness(
      [option("Réduire la marge."), option("reduire la marge"), option("A"), option("B", true)],
      "items.0.questions.0",
      true
    );

    expect(issues.some((issue) => issue.code === "mini_case_mcq_duplicate_option")).toBe(true);
  });
});
