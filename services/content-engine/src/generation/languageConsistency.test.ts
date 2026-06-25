import { describe, expect, it } from "vitest";

import type { GeneratedContentItem } from "../domain.js";
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
});
