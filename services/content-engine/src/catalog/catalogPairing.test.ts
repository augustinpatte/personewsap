import { describe, expect, it } from "vitest";

import type { BusinessStory, GeneratedContentItem, Language, MiniCaseChallenge } from "../domain.js";
import { validateCatalogLanguagePair } from "./catalogPairing.js";

type MiniCaseQuestions = MiniCaseChallenge["questions"];

const SOURCE_URL = "https://sources.test/finance/rate-decision";

function questions(language: Language, correctOptionId = "A"): MiniCaseQuestions {
  const roles = ["method_framework", "technical_application", "conclusion_decision"] as const;
  const french = language === "fr";

  return roles.map((role, index) => ({
    id: `q${index + 1}`,
    role,
    question: french
      ? "Quelle lecture de cette décision tient le mieux ?"
      : "Which reading of this decision holds up best?",
    options: ["A", "B", "C", "D"].map((id, optionIndex) => ({
      id,
      text: french
        ? [
            "Séparer le fait sourcé du jugement, puis nommer le prochain signal.",
            "Transformer l'annonce en recommandation immédiate.",
            "Retenir la lecture la plus spectaculaire du titre.",
            "Repousser toute analyse jusqu'au trimestre suivant."
          ][optionIndex]
        : [
            "Split the sourced fact from the judgment, then name the next signal.",
            "Turn the announcement into an immediate recommendation.",
            "Keep the most spectacular reading of the headline.",
            "Push any analysis back to the following quarter."
          ][optionIndex],
      is_correct: id === correctOptionId,
      feedback:
        id === correctOptionId
          ? french
            ? "Exact : la décision reste adossée aux preuves disponibles."
            : "Right: the decision stays anchored to the available evidence."
          : french
            ? "Raté : cette voie saute l'étape de preuve que le cas évalue."
            : "Miss: that route skips the evidence step the case is measuring."
    }))
  }));
}

function miniCase(language: Language, overrides: Partial<MiniCaseChallenge> = {}): MiniCaseChallenge {
  const french = language === "fr";

  return {
    content_type: "mini_case",
    slot: "mini_case",
    topic: "finance",
    product_topic: "finance_economy",
    scenario_type: "portfolio_risk",
    decision_type: "choose_next_step",
    concept_tested: "risk_adjusted_return",
    mechanism: "risk_adjusted_return under a portfolio_risk constraint",
    question_pattern: "framework_then_apply_then_decide",
    correct_answer_pattern: "evidence_before_action",
    core_takeaway: "evidence before action",
    language,
    title: french
      ? "Mini-cas — Finance et économie : arbitrer un risque de portefeuille"
      : "Mini-case — Finance and economy: weigh a portfolio risk",
    difficulty: "medium",
    context: french
      ? "Les anticipations de baisse des taux modifient le calcul du crédit pour les prêteurs comme pour les emprunteurs."
      : "Rate-cut expectations reshape the credit maths for lenders and borrowers alike.",
    challenge: french
      ? "Tu prépares un point de cinq minutes sur l'arbitrage à trancher cette semaine."
      : "You are preparing a five-minute readout on the trade-off to settle this week.",
    constraints: french ? ["N'utilise que des faits sourcés."] : ["Use sourced facts only."],
    question: french
      ? "Faut-il agir tout de suite, patienter, ou resserrer le périmètre ?"
      : "Should you act right away, hold, or narrow the scope?",
    questions: questions(language),
    expected_reasoning: french
      ? ["Pose le fait sourcé.", "Désigne le signal à surveiller."]
      : ["State the sourced fact.", "Point at the signal to watch."],
    sample_answer: french
      ? "J'attendrais une confirmation chiffrée avant d'engager le budget."
      : "I would hold for one measured confirmation before committing the budget.",
    conclusion: french
      ? "À retenir : distingue le fait sourcé de la recommandation."
      : "Takeaway: keep the sourced fact apart from the recommendation.",
    final_takeaway: french
      ? "Distingue le fait sourcé de ta recommandation, puis laisse le signal trancher."
      : "Keep the sourced fact apart from your recommendation, then let the signal settle it.",
    score_max: 3,
    body_md: french ? "Un corps de mini-cas rédigé en français." : "A mini-case body written in English.",
    source_urls: [SOURCE_URL],
    version: 1,
    ...overrides
  };
}

function businessStory(language: Language, overrides: Partial<BusinessStory> = {}): BusinessStory {
  const french = language === "fr";

  return {
    content_type: "business_story",
    slot: "business_story",
    topic: "finance",
    language,
    title: french ? "Quand un prêteur régional resserre ses conditions" : "When a regional lender tightens its terms",
    company_or_market: "Regional Lending Market",
    story_date: "2026-08-17",
    setup: french
      ? "Un prêteur régional revoit ses conditions après un trimestre de dépôts instables."
      : "A regional lender reworks its terms after a quarter of unstable deposits.",
    tension: french
      ? "La direction veut protéger la marge sans faire fuir les emprunteurs fidèles."
      : "Management wants to protect margin without pushing loyal borrowers away.",
    decision: french
      ? "Il faut choisir quels dossiers restent prioritaires et lesquels attendent."
      : "It has to pick which files stay a priority and which ones wait.",
    outcome: french
      ? "Le signal à suivre reste le rythme des renouvellements de crédit."
      : "The signal to follow stays the pace of credit renewals.",
    lesson: french
      ? "La marge se défend par la sélection des dossiers, pas par l'affichage des taux."
      : "Margin is defended through file selection, not through headline rates.",
    body_md: french ? "Un corps de récit business en français." : "A business-story body in English.",
    editorial_memory: {
      entity_name: "Regional Lending Market",
      entity_type: "company",
      main_company: "Regional Lending Market",
      companies_mentioned: ["Regional Lending Market"],
      industry: "finance",
      key_mechanism: "pricing power",
      secondary_mechanisms: [],
      strategic_angle: "select files before repricing",
      core_takeaway: "margin is defended through selection",
      year_period: "2020s"
    },
    source_urls: [SOURCE_URL],
    version: 1,
    ...overrides
  };
}

function pair(reference: GeneratedContentItem, counterpart: GeneratedContentItem) {
  return validateCatalogLanguagePair(
    { language: reference.language, item: reference },
    { language: counterpart.language, item: counterpart },
    "entry.1"
  );
}

describe("catalog language pairing: valid pairs", () => {
  it("accepts an EN/FR mini-case pair that shares its logic and reads natively in each language", () => {
    expect(pair(miniCase("en"), miniCase("fr"))).toEqual([]);
  });

  it("accepts an EN/FR business-story pair built on the same source", () => {
    expect(pair(businessStory("en"), businessStory("fr"))).toEqual([]);
  });
});

describe("catalog language pairing: shared editorial substance", () => {
  it("rejects versions that cite different sources", () => {
    const issues = pair(miniCase("en"), miniCase("fr", { source_urls: ["https://sources.test/other"] }));
    expect(issues.some((issue) => issue.code === "pair_source_mismatch")).toBe(true);
  });

  it("rejects versions that test a different concept", () => {
    const issues = pair(miniCase("en"), miniCase("fr", { concept_tested: "cash_flow" }));
    expect(issues.some((issue) => issue.code === "pair_logic_mismatch")).toBe(true);
  });

  it("rejects versions with a different difficulty", () => {
    const issues = pair(miniCase("en"), miniCase("fr", { difficulty: "hard" }));
    expect(issues.some((issue) => issue.code === "pair_logic_mismatch")).toBe(true);
  });

  it("rejects versions whose correct answer moved to another option", () => {
    const issues = pair(miniCase("en"), miniCase("fr", { questions: questions("fr", "C") }));
    expect(issues.some((issue) => issue.code === "pair_correct_answer_mismatch")).toBe(true);
  });

  it("rejects a version with more than one correct option", () => {
    const broken = miniCase("fr");
    broken.questions[0].options[1].is_correct = true;
    const issues = pair(miniCase("en"), broken);
    expect(issues.some((issue) => issue.code === "pair_correct_answer_count")).toBe(true);
  });

  it("rejects a business-story pair whose story date or company diverges", () => {
    expect(pair(businessStory("en"), businessStory("fr", { story_date: "2026-08-10" })).some(
      (issue) => issue.code === "pair_logic_mismatch"
    )).toBe(true);
    expect(pair(businessStory("en"), businessStory("fr", { company_or_market: "Another Market" })).some(
      (issue) => issue.code === "pair_logic_mismatch"
    )).toBe(true);
  });

  it("rejects a pair whose two versions are the same language", () => {
    const issues = pair(miniCase("en"), miniCase("en"));
    expect(issues.some((issue) => issue.code === "pair_same_language")).toBe(true);
  });
});

describe("catalog language pairing: no untranslated passthrough", () => {
  it("rejects an EN version that ships the French text untouched", () => {
    const french = miniCase("fr");
    const fakeEnglish = miniCase("en", {
      context: french.context,
      sample_answer: french.sample_answer,
      final_takeaway: french.final_takeaway
    });

    const issues = pair(french, fakeEnglish);
    expect(issues.some((issue) => issue.code === "pair_untranslated_passthrough")).toBe(true);
    // The per-item language check catches it independently too.
    expect(issues.some((issue) => issue.code === "language_mixed")).toBe(true);
  });

  it("rejects a FR version that ships the English text untouched", () => {
    const english = miniCase("en");
    const fakeFrench = miniCase("fr", {
      questions: questions("en"),
      body_md: english.body_md
    });

    const issues = pair(english, fakeFrench);
    expect(issues.some((issue) => issue.code === "pair_untranslated_passthrough")).toBe(true);
  });

  it("rejects a business story whose lesson was copied across languages", () => {
    const english = businessStory("en");
    const issues = pair(english, businessStory("fr", { lesson: english.lesson }));
    expect(issues.some((issue) => issue.code === "pair_untranslated_passthrough")).toBe(true);
  });

  it("does not flag short strings that are legitimately identical in both languages", () => {
    // A four-word product name reads the same in FR and EN and must not trip the check.
    const identicalShortTitle = "Alpha Capital Markets Review";
    const issues = pair(
      businessStory("en", { title: identicalShortTitle }),
      businessStory("fr", { title: identicalShortTitle })
    );

    expect(issues.some((issue) => issue.code === "pair_untranslated_passthrough")).toBe(false);
  });

  it("does not flag the shared citation line, URLs, or ISO dates", () => {
    const citation = `\n\nSource: [Regional Desk](${SOURCE_URL}), published 2026-08-17, retrieved 2026-08-17.`;
    const issues = pair(
      businessStory("en", { body_md: `A business-story body in English.${citation}` }),
      businessStory("fr", { body_md: `Un corps de récit business en français.${citation}` })
    );

    expect(issues).toEqual([]);
  });
});
