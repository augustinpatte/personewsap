import { describe, expect, it } from "vitest";

import type { BusinessStory, GeneratedContentItem, NewsletterArticle } from "../domain.js";
import { validateLanguageConsistency } from "./validation.js";

type MiniCase = Extract<GeneratedContentItem, { content_type: "mini_case" }>;

function miniCaseOption(id: string, text: string, isCorrect: boolean, feedback: string): MiniCase["questions"][number]["options"][number] {
  return { id, text, is_correct: isCorrect, feedback };
}

function frQuestions(feedbackOverride?: { correct: string; wrong: string }): MiniCase["questions"] {
  const correct = feedbackOverride?.correct ?? "Correct : cela garde la décision reliée aux preuves.";
  const wrong = feedbackOverride?.wrong ?? "Pas tout à fait : cela ignore la discipline de preuve.";
  const roles = ["method_framework", "technical_application", "conclusion_decision"] as const;
  return roles.map((role, index) => ({
    id: `q${index + 1}`,
    role,
    question: "Quelle est la meilleure interprétation de cette décision ?",
    options: [
      miniCaseOption("A", "Séparer le fait source du jugement et nommer le prochain signal.", true, correct),
      miniCaseOption("B", "Transformer l'actualité en recommandation immédiate.", false, wrong),
      miniCaseOption("C", "Choisir l'interprétation la plus bruyante du titre.", false, wrong),
      miniCaseOption("D", "Attendre que le sujet disparaisse avant d'agir.", false, wrong)
    ]
  }));
}

function enQuestions(): MiniCase["questions"] {
  const roles = ["method_framework", "technical_application", "conclusion_decision"] as const;
  return roles.map((role, index) => ({
    id: `q${index + 1}`,
    role,
    question: "What is the strongest interpretation of this decision?",
    options: [
      miniCaseOption("A", "Separate the sourced fact from the judgment and name the next signal.", true, "Correct: this keeps the decision tied to evidence."),
      miniCaseOption("B", "Turn the update into an immediate recommendation.", false, "Not quite: this skips the evidence discipline."),
      miniCaseOption("C", "Pick the loudest interpretation of the headline.", false, "Not quite: this skips the evidence discipline."),
      miniCaseOption("D", "Wait for the story to disappear before acting.", false, "Not quite: this skips the evidence discipline.")
    ]
  }));
}

function baseMiniCase(language: "fr" | "en", questions: MiniCase["questions"], overrides: Partial<MiniCase> = {}): MiniCase {
  const fr = language === "fr";
  return {
    content_type: "mini_case",
    slot: "mini_case",
    topic: "finance",
    product_topic: "finance_economy",
    scenario_type: "portfolio_risk",
    decision_type: "choose_next_step",
    concept_tested: "risk_adjusted_return",
    mechanism: fr ? "Le mécanisme actif est le risque ajusté." : "The active mechanism is risk-adjusted return.",
    question_pattern: "framework_then_apply_then_decide",
    correct_answer_pattern: "evidence_before_action",
    core_takeaway: fr ? "Choisis l'étape fondée sur les preuves." : "Choose the evidence-backed step.",
    language,
    title: fr ? "Mini-cas : briefer le mouvement Finance" : "Mini-case: brief the Finance move",
    difficulty: "medium",
    context: fr
      ? "Les anticipations de baisse des taux changent le calcul du crédit pour les banques et les emprunteurs."
      : "Rate-cut expectations change the math for lenders and borrowers.",
    challenge: fr
      ? "Tu prépares un brief de cinq minutes sur la décision à prendre cette semaine."
      : "Prepare a five-minute brief on the decision to take this week.",
    constraints: fr ? ["Utilise seulement des faits sourcés."] : ["Use only sourced facts."],
    question: fr
      ? "Recommanderais-tu d'agir maintenant, d'attendre, ou de réduire le périmètre de la décision ?"
      : "Would you recommend acting now, waiting, or narrowing the decision?",
    questions,
    expected_reasoning: fr ? ["Énonce le fait source.", "Nomme le signal à suivre."] : ["State the sourced fact.", "Name the signal to watch."],
    sample_answer: fr
      ? "J'attendrais un signal de confirmation avant d'engager des ressources."
      : "I would wait for one confirming signal before committing resources.",
    conclusion: fr
      ? "À retenir : sépare le fait source de la recommandation."
      : "Final takeaway: separate the sourced fact from the recommendation.",
    final_takeaway: fr
      ? "Sépare le fait source de ta recommandation, puis laisse le signal décider."
      : "Separate the sourced fact from your recommendation, then let the signal decide.",
    score_max: 3,
    body_md: fr ? "Un court corps de mini-cas en français." : "A short mini-case body in English.",
    source_urls: ["https://example.com/finance/rate-cuts"],
    version: 1,
    ...overrides
  };
}

describe("validateLanguageConsistency", () => {
  it("accepts a fully French mini-case with accented questions, options, and feedback", () => {
    const issues = validateLanguageConsistency(baseMiniCase("fr", frQuestions()), "items.0");
    expect(issues).toEqual([]);
  });

  it("accepts a fully English mini-case", () => {
    const issues = validateLanguageConsistency(baseMiniCase("en", enQuestions()), "items.0");
    expect(issues).toEqual([]);
  });

  it("rejects a French mini-case whose option feedback is in English", () => {
    const item = baseMiniCase("fr", frQuestions({
      correct: "Correct: this keeps the decision tied to evidence.",
      wrong: "Not quite: this skips the evidence discipline that the case is testing."
    }));
    const issues = validateLanguageConsistency(item, "items.0");
    expect(issues.some((issue) => issue.code === "language_mixed")).toBe(true);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
  });

  it("rejects a French mini-case with accent-stripped French", () => {
    const item = baseMiniCase("fr", frQuestions(), {
      final_takeaway: "Separe le fait source de ta recommandation, puis prends la decision."
    });
    const issues = validateLanguageConsistency(item, "items.0");
    expect(issues.some((issue) => issue.code === "language_french_missing_accents")).toBe(true);
  });

  it("rejects an English mini-case that drifts into French", () => {
    const item = baseMiniCase("en", enQuestions(), {
      sample_answer: "Vous devez séparer le fait source de la décision avant de recommander une action."
    });
    const issues = validateLanguageConsistency(item, "items.0");
    expect(issues.some((issue) => issue.code === "language_mixed")).toBe(true);
  });

  // Every user-facing mini-case surface must be covered, not only the ones the
  // reader sees first. The app renders all of these.
  it.each([
    ["question", { question: "Would you act now, wait, or narrow the scope of the decision?" }],
    ["expected_reasoning", { expected_reasoning: ["State the sourced fact.", "Name the signal you would watch next."] }],
    ["sample_answer", { sample_answer: "I would wait for one confirming signal before I commit the budget." }],
    ["final_takeaway", { final_takeaway: "Keep the sourced fact apart from what you would recommend next." }],
    ["conclusion", { conclusion: "Final takeaway: separate what the source proves from what you would decide." }],
    ["title", { title: "Mini-case: what you should decide before the next update" }],
    ["context", { context: "The team would rather wait for the next update before they move." }],
    ["challenge", { challenge: "You should brief the owner before this decision moves forward." }]
  ] as const)("rejects English leaking into the French %s", (_field, override) => {
    const issues = validateLanguageConsistency(baseMiniCase("fr", frQuestions(), override), "items.0");
    expect(issues.some((issue) => issue.code === "language_mixed")).toBe(true);
  });

  it("rejects English option text inside a French mini-case", () => {
    const item = baseMiniCase("fr", frQuestions());
    item.questions[1].options[0].text = "You should keep the sourced fact apart from the next step.";
    const issues = validateLanguageConsistency(item, "items.0");
    expect(issues.some((issue) => issue.code === "language_mixed")).toBe(true);
  });
});

function baseBusinessStory(language: "fr" | "en", overrides: Partial<BusinessStory> = {}): BusinessStory {
  const fr = language === "fr";
  return {
    content_type: "business_story",
    slot: "business_story",
    topic: "finance",
    language,
    title: fr ? "Quand un prêteur régional resserre ses conditions" : "When a regional lender tightens its terms",
    company_or_market: "Regional Lending Market",
    story_date: "2026-08-17",
    setup: fr
      ? "Un prêteur régional revoit ses conditions après un trimestre de dépôts instables."
      : "A regional lender reworks its terms after a quarter of unstable deposits.",
    tension: fr
      ? "La direction veut protéger la marge sans faire fuir les emprunteurs fidèles."
      : "Management wants to protect margin without pushing loyal borrowers away.",
    decision: fr
      ? "Il faut choisir quels dossiers restent prioritaires et lesquels attendent."
      : "It has to pick which files stay a priority and which ones wait.",
    outcome: fr
      ? "Le signal à suivre reste le rythme des renouvellements de crédit."
      : "The signal to follow stays the pace of credit renewals.",
    lesson: fr
      ? "La marge se défend par la sélection des dossiers, pas par l'affichage des taux."
      : "Margin is defended through file selection, not through headline rates.",
    body_md: fr ? "Un corps de récit business rédigé en français." : "A business-story body written in English.",
    source_urls: ["https://sources.test/finance/lender"],
    version: 1,
    ...overrides
  };
}

describe("validateLanguageConsistency: business story", () => {
  it("accepts a fully French business story", () => {
    expect(validateLanguageConsistency(baseBusinessStory("fr"), "items.0")).toEqual([]);
  });

  it("accepts a fully English business story", () => {
    expect(validateLanguageConsistency(baseBusinessStory("en"), "items.0")).toEqual([]);
  });

  it.each(["setup", "tension", "decision", "outcome", "lesson", "body_md", "title"] as const)(
    "rejects English leaking into the French %s",
    (field) => {
      const item = baseBusinessStory("fr", {
        [field]: "The team should wait before you decide what the next move would be."
      } as Partial<BusinessStory>);
      const issues = validateLanguageConsistency(item, "items.0");
      expect(issues.some((issue) => issue.code === "language_mixed")).toBe(true);
    }
  );

  it("rejects accent-stripped French in a business story lesson", () => {
    const item = baseBusinessStory("fr", { lesson: "La strategie tient par la selection, pas par la decision." });
    const issues = validateLanguageConsistency(item, "items.0");
    expect(issues.some((issue) => issue.code === "language_french_missing_accents")).toBe(true);
  });

  it("keeps proper nouns, URLs, and ISO dates from producing false positives", () => {
    const item = baseBusinessStory("fr", {
      body_md: [
        "Un prêteur régional resserre ses conditions après un trimestre de dépôts instables.",
        "Source: [Regional Lending Desk](https://sources.test/finance/lender), published 2026-08-17, retrieved 2026-08-17."
      ].join("\n\n")
    });

    expect(validateLanguageConsistency(item, "items.0")).toEqual([]);
  });
});

function baseNewsletter(language: "fr" | "en", overrides: Partial<NewsletterArticle> = {}): NewsletterArticle {
  const fr = language === "fr";
  return {
    content_type: "newsletter_article",
    slot: "newsletter",
    topic: "finance",
    language,
    title: fr ? "Les dépôts instables changent le calcul du crédit" : "Unstable deposits reset the credit maths",
    published_date: "2026-08-17",
    summary: fr
      ? "Un trimestre de dépôts instables oblige les prêteurs régionaux à revoir leurs conditions."
      : "A quarter of unstable deposits pushes regional lenders to rework their terms.",
    body_md: fr
      ? "Un trimestre de dépôts instables oblige les prêteurs régionaux à revoir leurs conditions de crédit."
      : "A quarter of unstable deposits pushes regional lenders to rework their credit terms.",
    why_it_matters: fr
      ? "La sélection des dossiers devient le vrai levier de marge."
      : "File selection becomes the real margin lever.",
    source_urls: ["https://sources.test/finance/deposits"],
    version: 1,
    ...overrides
  };
}

describe("validateLanguageConsistency: newsletter article", () => {
  it("accepts a fully French newsletter article", () => {
    expect(validateLanguageConsistency(baseNewsletter("fr"), "items.0")).toEqual([]);
  });

  it("accepts a fully English newsletter article", () => {
    expect(validateLanguageConsistency(baseNewsletter("en"), "items.0")).toEqual([]);
  });

  it.each(["title", "summary", "body_md", "why_it_matters"] as const)(
    "rejects English leaking into the French %s",
    (field) => {
      const item = baseNewsletter("fr", {
        [field]: "The lenders would wait before they change what you should expect next."
      } as Partial<NewsletterArticle>);
      const issues = validateLanguageConsistency(item, "items.0");
      expect(issues.some((issue) => issue.code === "language_mixed")).toBe(true);
    }
  );

  it("rejects French leaking into an English newsletter article", () => {
    const item = baseNewsletter("en", {
      why_it_matters: "La sélection des dossiers devient le vrai levier de marge pour les prêteurs."
    });
    const issues = validateLanguageConsistency(item, "items.0");
    expect(issues.some((issue) => issue.code === "language_mixed")).toBe(true);
  });
});
