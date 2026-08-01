import type { LlmProvider } from "../generation/llmProvider.js";
import type { LearningAdaptationMode } from "./sessionLifecycle.js";
import { LEARNING_PROMPT_SCHEMA } from "./learningPromptSchema.js";
import type { GeneratedLearningPrompt, LearningCatalogStep, LearningPathRecord } from "./learningTypes.js";

export type LearningPromptProvider = LlmProvider & {
  apiCalls?: number;
};

export class DeterministicLearningPromptProvider implements LearningPromptProvider {
  readonly name = "deterministic-learning-proof";
  apiCalls = 0;

  async generateJson(): Promise<unknown> {
    this.apiCalls += 1;
    throw new Error("DeterministicLearningPromptProvider requires generateLearningPrompt fallback context.");
  }
}

export async function generateLearningPrompt(input: {
  provider: LlmProvider | "deterministic";
  path: LearningPathRecord;
  step: LearningCatalogStep;
  adaptationMode: LearningAdaptationMode;
  previousStepKeys: string[];
  feedback: Record<string, unknown> | null;
}): Promise<{ prompt: GeneratedLearningPrompt; apiCalls: number; modelName: string }> {
  if (input.provider === "deterministic") {
    return {
      apiCalls: 1,
      modelName: "deterministic-learning-proof",
      prompt: deterministicPrompt(input)
    };
  }

  const result = await input.provider.generateJson({
    schemaName: "personewsap_learning_prompt",
    jsonSchema: LEARNING_PROMPT_SCHEMA,
    maxOutputTokens: 1800,
    systemPrompt:
      "You generate safe five-minute PersoNewsAP learning prompts. Return only JSON matching the schema.",
    userPrompt: JSON.stringify({
      language: input.path.language,
      domain_id: input.path.domain_id,
      objective_id: input.path.objective_id,
      current_level: input.path.current_level,
      target_level: input.path.target_level,
      curriculum_step: input.step,
      previous_step_keys: input.previousStepKeys.slice(-5),
      last_feedback: input.feedback,
      adaptation_mode: input.adaptationMode,
      safety_rules: safetyRules(input.step.safety_category)
    })
  });
  const prompt = validateGeneratedLearningPrompt(result, input);
  return { prompt, apiCalls: 1, modelName: input.provider.name };
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
  if (/copy.*PersoNewsAP|copie.*PersoNewsAP|final report|rapport final/i.test(prompt.prompt_text)) {
    issues.push("prompt_text must not ask for a final report back to PersoNewsAP");
  }
  if (prompt.prompt_text.length > 2400) issues.push("prompt_text too long");
  if (issues.length > 0) {
    throw new Error(`Invalid learning prompt output: ${issues.join("; ")}.`);
  }
  return prompt;
}

function deterministicPrompt(input: {
  path: LearningPathRecord;
  step: LearningCatalogStep;
  adaptationMode: LearningAdaptationMode;
}): GeneratedLearningPrompt {
  const languageLine =
    input.path.language === "fr"
      ? `Agis comme mon tuteur PersoNewsAP. Reste en français. Termine toute la session en cinq minutes maximum. Commence par une explication de 120 mots maximum, limite l'explication principale à 220 mots, pose au maximum trois questions une par une, attends ma réponse avant de continuer, corrige brièvement les erreurs, termine par un rappel de moins de 60 mots, ne propose pas de deuxième leçon et ne demande aucun rapport final. Sujet: ${input.step.title_fr}. ${safetyRules(input.step.safety_category).join(" ")}`
      : `Act as my PersoNewsAP tutor. Stay in English. Complete the whole session in five minutes maximum. Start with an explanation of 120 words maximum, keep the main explanation under 220 words, ask at most three questions one at a time, wait for my answer before continuing, correct mistakes briefly, end with a recap under 60 words, do not offer a second lesson and do not ask for any final report. Topic: ${input.step.title_en}. ${safetyRules(input.step.safety_category).join(" ")}`;

  return {
    curriculum_step_key: input.step.key,
    title_fr: input.step.title_fr,
    title_en: input.step.title_en,
    summary_fr: input.step.summary_fr,
    summary_en: input.step.summary_en,
    objectives_fr: input.step.learning_goals_fr.slice(0, 3),
    objectives_en: input.step.learning_goals_en.slice(0, 3),
    prompt_text: languageLine,
    prompt_language: input.path.language,
    adaptation_mode: input.adaptationMode
  };
}

function safetyRules(category: LearningCatalogStep["safety_category"]): string[] {
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
  return ["Stay educational, concise, and bounded to the requested step."];
}
