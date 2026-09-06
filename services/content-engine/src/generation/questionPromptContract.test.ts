import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MINI_CASE_ITEM_SCHEMA,
  NEWSLETTER_ITEM_SCHEMA,
  BUSINESS_STORY_ITEM_SCHEMA,
  READING_QUESTIONS_SCHEMA
} from "./dailyDropSchema.js";
import {
  MINI_CASE_QUESTION_ROLES,
  QUESTION_SCORE_TIERS,
  READING_QUESTION_ROLES
} from "./gradedQuestions.js";
import { REVIEW_SCOPES } from "./questionRevisionScope.js";

/**
 * The prompts and the code have to agree.
 *
 * The Generator and the Reviewer are ChatGPT Scheduled Tasks: they live outside
 * this repository and the only thing this repository controls about them is the
 * prompt text in `prompts/`. So the tier set, the question counts, the roles and
 * the attempt policy exist twice — once as TypeScript that validates the output,
 * once as prose that produces it — and the failure mode is silent drift: a
 * prompt saying `is_correct` while the validator demands `score_milli` produces
 * a generator that fails every time, and a rubric that has not heard of scopes
 * produces a reviewer that regenerates good articles.
 *
 * These cases pin the two together. They are text assertions on purpose: what is
 * being checked is that the instruction is present and says the same thing as
 * the constant.
 */

const promptsDir = join(__dirname, "..", "..", "prompts");
const read = (name: string) => readFileSync(join(promptsDir, name), "utf8");

const CONTENT_PROMPTS = [
  "newsletter_prompt_final.md",
  "business_story_prompt_final.md",
  "mini_case_prompt_final.md"
] as const;

const REVIEWER_RUBRICS = [
  "newsletter_reviewer_rubric_v2.md",
  "business_story_reviewer_rubric_v2.md",
  "mini_case_reviewer_rubric_v2.md"
] as const;

const preflight = read("work_generator_preflight_v2.md");

describe("every content prompt teaches the same question model", () => {
  it.each(CONTENT_PROMPTS)("%s states the four tiers as integers", (name) => {
    const prompt = read(name);

    for (const tier of QUESTION_SCORE_TIERS) {
      expect(prompt, `${name} must mention tier ${tier}`).toContain(`score_milli: ${tier}`);
    }

    // The float that would break a leaderboard, named explicitly so a generator
    // cannot arrive at it by analogy.
    expect(prompt).toContain("Jamais 0.3");
  });

  it.each(CONTENT_PROMPTS)("%s names the roles the validator expects", (name) => {
    const prompt = read(name);

    for (const role of [...READING_QUESTION_ROLES, ...MINI_CASE_QUESTION_ROLES]) {
      expect(prompt, `${name} must name role ${role}`).toContain(role);
    }
  });

  it.each(CONTENT_PROMPTS)("%s fixes the question counts", (name) => {
    const prompt = read(name);

    expect(prompt).toContain("EXACTEMENT 2 questions");
    // The rule with the most to lose: a Mini Case is three questions.
    expect(prompt).toContain("EXACTEMENT 3 questions");
    expect(prompt).toContain("Ne jamais réduire un Mini Case à deux questions");
  });

  it.each(CONTENT_PROMPTS)("%s carries the facts/reasoning principle", (name) => {
    const prompt = read(name);

    expect(prompt).toContain("LE CONTENU FOURNIT LES FAITS");
    expect(prompt).toContain("LA QUESTION EXIGE LE RAISONNEMENT");
  });

  it.each(CONTENT_PROMPTS)("%s bans the four forbidden question shapes", (name) => {
    const prompt = read(name);

    for (const banned of ["pourcentage", "Qui a annoncé", "À quelle date", "Selon l'article"]) {
      expect(prompt, `${name} must ban "${banned}"`).toContain(banned);
    }
  });

  it.each(CONTENT_PROMPTS)("%s forbids requiring outside knowledge", (name) => {
    const prompt = read(name);

    // The other half of the rule. Without it, "require reasoning" drifts into a
    // general-knowledge quiz.
    expect(prompt).toContain("concours de");
    expect(prompt).toContain("INTERDIT : connaissance préalable");
  });

  it.each(CONTENT_PROMPTS)("%s lists every visual tell the validator checks", (name) => {
    const prompt = read(name);

    for (const tell of [
      "la plus longue",
      "la seule à contenir un chiffre",
      "la seule à poser une condition",
      "la plus nuancée"
    ]) {
      expect(prompt, `${name} must warn about "${tell}"`).toContain(tell);
    }
  });

  it.each(CONTENT_PROMPTS)("%s requires the full internal rationale", (name) => {
    const prompt = read(name);

    for (const field of [
      "decision_criterion",
      "excellent_reason",
      "good_limitation",
      "average_limitation",
      "bad_failure"
    ]) {
      expect(prompt, `${name} must require ${field}`).toContain(field);
    }

    // The two failures the rationale exists to catch.
    expect(prompt).toContain("deux options peuvent honnêtement valoir 1000");
    expect(prompt).toContain("ne suffit pas à départager");
  });

  it.each(CONTENT_PROMPTS)("%s requires logical parity across languages", (name) => {
    const prompt = read(name);

    expect(prompt).toContain("PARITÉ FR / EN");
    expect(prompt).toContain("Jamais une traduction littérale");
  });

  it.each(CONTENT_PROMPTS)("%s presents questions as additive to the editorial gates", (name) => {
    const prompt = read(name);

    // The regression this whole pass has to avoid: questions are an extension,
    // not a reason to loosen the gates that got the newsletter to first-try.
    expect(prompt).toContain("Cette section est");
    expect(prompt).toContain("ADDITIVE");
    expect(prompt).toContain("Le contenu se rédige d'abord");
  });
});

describe("the mini case keeps what it had", () => {
  const prompt = read("mini_case_prompt_final.md");

  it("says explicitly that the binary model is superseded", () => {
    // The prompt still contains a full worked example written with is_correct.
    // Leaving that ambiguous would produce a generator that emits both shapes.
    expect(prompt).toContain("REMPLACE le modèle binaire `is_correct`");
    expect(prompt).toContain("y compris dans l'exemple JSON complet");
  });

  it("says explicitly what must not be rewritten", () => {
    expect(prompt).toContain("Le reste du Mini Case est INCHANGÉ");

    for (const preserved of ["contexte", "challenge", "contraintes", "mécanisme", "concept_tested"]) {
      expect(prompt, preserved).toContain(preserved);
    }
  });

  it("keeps the pedagogical progression in the prompt and in the schema", () => {
    expect(prompt).toContain("ordre pédagogique inchangé");

    const roles = MINI_CASE_ITEM_SCHEMA.properties.questions.items.properties.role.enum;
    expect(roles).toEqual(MINI_CASE_QUESTION_ROLES);
    expect(MINI_CASE_ITEM_SCHEMA.properties.questions.minItems).toBe(3);
    expect(MINI_CASE_ITEM_SCHEMA.properties.questions.maxItems).toBe(3);
  });
});

describe("the schema the generator is handed", () => {
  it("requires two questions on a newsletter and on a story", () => {
    expect(NEWSLETTER_ITEM_SCHEMA.required).toContain("questions");
    expect(BUSINESS_STORY_ITEM_SCHEMA.required).toContain("questions");
    expect(READING_QUESTIONS_SCHEMA.minItems).toBe(2);
    expect(READING_QUESTIONS_SCHEMA.maxItems).toBe(2);
  });

  it("closes the score to the four tiers rather than to an integer range", () => {
    const scoreSchema =
      READING_QUESTIONS_SCHEMA.items.properties.options.items.properties.score_milli;

    // An integer with a range would let the model emit 750 and leave someone
    // deciding later what that meant.
    expect(scoreSchema.type).toBe("integer");
    expect(scoreSchema.enum).toEqual([...QUESTION_SCORE_TIERS]);
  });

  it("requires exactly four options and the full rationale", () => {
    const questionSchema = READING_QUESTIONS_SCHEMA.items;

    expect(questionSchema.properties.options.minItems).toBe(4);
    expect(questionSchema.properties.options.maxItems).toBe(4);
    expect(questionSchema.required).toContain("rationale");
    expect(questionSchema.properties.role.enum).toEqual([...READING_QUESTION_ROLES]);
  });
});

describe("the reviewer rubrics carry the scoped-revision rule", () => {
  it.each(REVIEWER_RUBRICS)("%s names the review scopes", (name) => {
    const rubric = read(name);

    for (const scope of REVIEW_SCOPES) {
      expect(rubric, `${name} must name ${scope}`).toContain(scope);
    }
  });

  it.each(REVIEWER_RUBRICS)("%s forbids regenerating a good article for a bad question", (name) => {
    const rubric = read(name);

    // The single most important sentence added to the rubrics.
    expect(rubric).toContain("NE PAS demander la régénération de l'article");
    expect(rubric).toContain("DO NOT REGENERATE");
    expect(rubric).toContain("resubmit these byte-for-byte");
  });

  it.each(REVIEWER_RUBRICS)("%s describes attempts 1 and 2 as targeted revisions", (name) => {
    const rubric = read(name);

    expect(rubric).toContain("TENTATIVES 1 ET 2");
    expect(rubric).toContain("revision_required");
  });

  it.each(REVIEWER_RUBRICS)("%s describes the attempt-3 direct repair", (name) => {
    const rubric = read(name);

    expect(rubric).toContain("TENTATIVE 3");
    expect(rubric).toContain("LE REVIEWER CORRIGE LUI-MÊME");
    expect(rubric).toContain("Il n'y a pas de quatrième tentative");
  });

  it.each(REVIEWER_RUBRICS)("%s refuses to let a reviewer rewrite content", (name) => {
    const rubric = read(name);

    expect(rubric).toContain("Le Reviewer ne réécrit JAMAIS un article");
  });

  it.each(REVIEWER_RUBRICS)("%s refuses a minimal edit on a judgement defect", (name) => {
    const rubric = read(name);

    // Case C. A minimal edit cannot rescue an indefensible ranking, and
    // approving one would be worse than publishing nothing.
    expect(rubric).toContain("Aucune édition minimale ne répare un classement indéfendable");
  });

  it.each(REVIEWER_RUBRICS)("%s keeps the editorial gates untouched", (name) => {
    const rubric = read(name);

    expect(rubric).toContain("Aucun critère éditorial ci-dessus n'est assoupli");
  });
});

describe("the generator preflight", () => {
  it("checks the tier set for every surface before submit", () => {
    expect(preflight).toContain("exactement un `score_milli` 0, un 300, un 600 et un 1000");
    expect(preflight).toContain("exactement 3 questions");
    expect(preflight).toContain("exactement 2 questions");
  });

  it("no longer asks for exactly one is_correct", () => {
    // Leaving the old rule in the preflight would have the generator satisfying
    // a contract the validator no longer accepts.
    expect(preflight).not.toContain("exactement 1 is_correct");
  });

  it("tells the generator to resubmit untouched scopes byte-for-byte", () => {
    expect(preflight).toContain("RÈGLE DE SCOPE");
    expect(preflight).toContain("DO NOT REGENERATE");
    expect(preflight).toContain("octet pour octet");
  });

  it("still forbids fixing one thing and leaving another broken", () => {
    // The pre-existing rule, deliberately preserved: scoping the revision must
    // not become an excuse for a partial fix within a scope.
    expect(preflight).toContain("ne jamais corriger uniquement la longueur en laissant Q3 cassée");
  });

  it("keeps the first-try quality objective", () => {
    expect(preflight).toContain("FIRST SUBMISSION = PUBLISHABLE");
  });
});
