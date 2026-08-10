import type { LlmProvider } from "../generation/llmProvider.js";
import type { OpenAiRequestAttempt } from "../generation/openAiProvider.js";
import type { LearningAdaptationMode } from "./sessionLifecycle.js";
import { buildLearningPromptContextV2 } from "./learningPromptContextV2.js";
import { LEARNING_META_SYSTEM_PROMPT_V2 } from "./learningPromptPolicyV2.js";
import {
  LEARNING_TEACHING_PLAN_SCHEMA_V2,
  validateTeachingPlanV2,
  type TeachingPlanV2
} from "./learningTeachingPlanSchemaV2.js";
import { renderLearningTutorPromptV2 } from "./learningTutorRendererV2.js";
import type {
  GeneratedLearningPrompt,
  LearningCatalogStep,
  LearningFeedbackRecord,
  LearningPathRecord,
  LearningSessionRecord
} from "./learningTypes.js";

export const DETERMINISTIC_LEARNING_MODEL = "deterministic-learning-v1";

/**
 * A provider usable for learning prompts. `observeRequestAttempts` is what makes
 * the "at most one HTTP request per generation attempt" guarantee measurable:
 * the meter counts real requests, never function calls.
 */
export type LearningPromptProvider = LlmProvider & {
  observeRequestAttempts?(observer: (attempt: OpenAiRequestAttempt) => void): () => void;
};

export type LearningRequestMeter = {
  httpRequests: number;
  modelName: string | null;
};

export function createLearningRequestMeter(): LearningRequestMeter {
  return { httpRequests: 0, modelName: null };
}

export async function generateLearningPrompt(input: {
  provider: LearningPromptProvider | "deterministic";
  path: LearningPathRecord;
  step: LearningCatalogStep;
  adaptationMode: LearningAdaptationMode;
  repetitionIndex: number;
  sessions: LearningSessionRecord[];
  feedbackRows: LearningFeedbackRecord[];
  sessionNumber: number;
  meter?: LearningRequestMeter;
}): Promise<{ prompt: GeneratedLearningPrompt; apiCalls: number; modelName: string }> {
  const meter = input.meter ?? createLearningRequestMeter();

  if (input.provider === "deterministic") {
    // Deterministic mode never touches the network, so it must never be billed.
    meter.modelName = DETERMINISTIC_LEARNING_MODEL;
    return {
      apiCalls: 0,
      modelName: DETERMINISTIC_LEARNING_MODEL,
      prompt: promptFromTeachingPlan({
        path: input.path,
        step: input.step,
        adaptationMode: input.adaptationMode,
        plan: deterministicTeachingPlan(input),
        safetyRules: safetyRules(input.step.safety_category)
      })
    };
  }

  const provider = input.provider;
  const unobserve =
    provider.observeRequestAttempts?.((attempt) => {
      meter.httpRequests += 1;
      meter.modelName = attempt.model;
    }) ?? null;

  let result: unknown;
  try {
    result = await provider.generateJson({
      schemaName: "personewsap_learning_teaching_plan_v2",
      jsonSchema: LEARNING_TEACHING_PLAN_SCHEMA_V2,
      maxOutputTokens: 1000,
      systemPrompt: LEARNING_META_SYSTEM_PROMPT_V2,
      userPrompt: JSON.stringify({
        task:
          "Create the teaching plan for the selected curriculum step. The backend has already chosen what must be taught. Do not change the curriculum decision.",
        context: buildLearningPromptContextV2({
          path: input.path,
          step: input.step,
          sessions: input.sessions,
          feedbackRows: input.feedbackRows,
          sessionNumber: input.sessionNumber,
          adaptationMode: input.adaptationMode,
          repetitionIndex: input.repetitionIndex,
          selectedExampleContext: pickExampleContext(input.step, input.path.language, input.repetitionIndex),
          safetyRules: safetyRules(input.step.safety_category)
        })
      })
    });
  } finally {
    unobserve?.();
  }

  const plan = validateTeachingPlanV2(result, {
    curriculumStepKey: input.step.key,
    adaptationMode: input.adaptationMode
  });
  const prompt = validateGeneratedLearningPrompt(
    promptFromTeachingPlan({
      path: input.path,
      step: input.step,
      adaptationMode: input.adaptationMode,
      plan,
      safetyRules: safetyRules(input.step.safety_category)
    }),
    input
  );
  return {
    prompt,
    apiCalls: meter.httpRequests,
    modelName: meter.modelName ?? provider.name
  };
}

export function validateGeneratedLearningPrompt(
  value: unknown,
  input: {
    path: LearningPathRecord;
    step: LearningCatalogStep;
    adaptationMode: LearningAdaptationMode;
  }
): GeneratedLearningPrompt {
  if (!value || typeof value !== "object") {
    throw new Error("Learning prompt output is not an object.");
  }
  const prompt = value as GeneratedLearningPrompt;
  const issues: string[] = [];
  if (prompt.curriculum_step_key !== input.step.key) issues.push("curriculum_step_key mismatch");
  if (prompt.prompt_language !== input.path.language) issues.push("prompt_language mismatch");
  if (prompt.adaptation_mode !== input.adaptationMode) issues.push("adaptation_mode mismatch");
  if (!Array.isArray(prompt.objectives_fr) || prompt.objectives_fr.length < 2 || prompt.objectives_fr.length > 3) issues.push("objectives_fr must have 2-3 items");
  if (!Array.isArray(prompt.objectives_en) || prompt.objectives_en.length < 2 || prompt.objectives_en.length > 3) issues.push("objectives_en must have 2-3 items");
  for (const field of ["title_fr", "title_en", "summary_fr", "summary_en", "prompt_text"] as const) {
    if (typeof prompt[field] !== "string" || prompt[field].trim().length === 0) issues.push(`${field} empty`);
  }
  if (!/tutor|tuteur|teach|apprendre|explain|explique/i.test(prompt.prompt_text)) {
    issues.push("prompt_text must instruct an external tutor");
  }
  if (/copy.*PersoNewsAP|copie.*PersoNewsAP/i.test(prompt.prompt_text)) {
    issues.push("prompt_text must not ask for a final report back to PersoNewsAP");
  }
  if (prompt.prompt_text.length > 6000) issues.push("prompt_text too long");
  if (issues.length > 0) {
    throw new Error(`Invalid learning prompt output: ${issues.join("; ")}.`);
  }
  return prompt;
}

function deterministicTeachingPlan(input: {
  path: LearningPathRecord;
  step: LearningCatalogStep;
  adaptationMode: LearningAdaptationMode;
  repetitionIndex: number;
}): TeachingPlanV2 {
  const context = pickExampleContext(input.step, input.path.language, input.repetitionIndex);
  const title = input.path.language === "fr" ? input.step.title_fr : input.step.title_en;
  const focus = input.path.language === "fr" ? input.step.tutor_focus_fr : input.step.tutor_focus_en;
  return {
    curriculum_step_key: input.step.key,
    adaptation_mode: input.adaptationMode,
    teaching_angle:
      input.path.language === "fr"
        ? `Faire comprendre ${title} par le mécanisme central.`
        : `Teach ${title} through the core mechanism.`,
    hook:
      input.path.language === "fr"
        ? `Imagine ${context}; nous allons l'utiliser pour comprendre le sujet.`
        : `Imagine ${context}; we will use it to understand the topic.`,
    core_points:
      input.path.language === "fr"
        ? [focus, "Relier l'exemple au mécanisme.", "Vérifier la compréhension par une application courte."]
        : [focus, "Connect the example to the mechanism.", "Check understanding with a short application."],
    example: context,
    first_check_goal:
      input.path.language === "fr"
        ? "Vérifier que l'apprenant peut expliquer le mécanisme avec ses mots."
        : "Check that the learner can explain the mechanism in their own words.",
    application_goal:
      input.path.language === "fr"
        ? "Faire appliquer le concept à une situation proche de l'exemple."
        : "Have the learner apply the concept to a situation close to the example.",
    transfer_goal:
      input.path.language === "fr"
        ? "Demander une prédiction courte dans un nouveau contexte."
        : "Ask for one short prediction in a new context.",
    common_misconception:
      input.path.language === "fr"
        ? "Confondre la définition du concept avec son mécanisme."
        : "Confusing the definition of the concept with its mechanism.",
    recap_target:
      input.path.language === "fr" ? "le modèle mental le plus réutilisable" : "the most reusable mental model"
  };
}

function promptFromTeachingPlan(input: {
  path: LearningPathRecord;
  step: LearningCatalogStep;
  adaptationMode: LearningAdaptationMode;
  plan: TeachingPlanV2;
  safetyRules: string[];
}): GeneratedLearningPrompt {
  return {
    curriculum_step_key: input.step.key,
    title_fr: input.step.title_fr,
    title_en: input.step.title_en,
    summary_fr: input.step.summary_fr,
    summary_en: input.step.summary_en,
    objectives_fr: input.step.learning_goals_fr.slice(0, 3),
    objectives_en: input.step.learning_goals_en.slice(0, 3),
    prompt_text: renderLearningTutorPromptV2({
      plan: input.plan,
      step: input.step,
      language: input.path.language,
      safetyRules: input.safetyRules
    }),
    prompt_language: input.path.language,
    adaptation_mode: input.adaptationMode
  };
}

/** Rotates through the authored contexts so a repeated concept is never told twice the same way. */
export function pickExampleContext(
  step: LearningCatalogStep,
  language: LearningPathRecord["language"],
  repetitionIndex: number
): string {
  const contexts = language === "fr" ? step.example_contexts_fr : step.example_contexts_en;
  if (contexts.length === 0) {
    return language === "fr" ? step.title_fr : step.title_en;
  }
  return contexts[Math.abs(repetitionIndex) % contexts.length];
}

export function safetyRules(category: LearningCatalogStep["safety_category"]): string[] {
  if (category === "medical_educational") {
    return [
      "Content remains educational and general.",
      "Do not diagnose the user.",
      "Do not propose personal treatment."
    ];
  }
  if (category === "cyber_defensive") {
    return [
      "Stay strictly defensive and authorized.",
      "Do not provide real intrusion, malicious persistence, or credential theft procedures."
    ];
  }
  if (category === "financial_educational") {
    return [
      "Stay educational and general.",
      "Do not give personal investment advice or price predictions."
    ];
  }
  return ["Stay educational, concise, and bounded to the requested step."];
}
