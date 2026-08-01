import type { Language } from "../domain.js";
import type { LearningAdaptationMode, LearningSessionStatus } from "./sessionLifecycle.js";

export type LearningCatalogStep = {
  key: string;
  domain_id: string;
  objective_ids: string[];
  stage: number;
  order: number;
  required: boolean;
  prerequisite_keys: string[];
  fallback_key: string | null;
  title_fr: string;
  title_en: string;
  summary_fr: string;
  summary_en: string;
  learning_goals_fr: string[];
  learning_goals_en: string[];
  tutor_focus_fr: string;
  tutor_focus_en: string;
  example_contexts_fr: string[];
  example_contexts_en: string[];
  safety_category: "standard" | "cyber_defensive" | "medical_educational" | "financial_educational";
};

export type LearningPathRecord = {
  id: string;
  user_id: string;
  domain_id: string;
  objective_id: string;
  current_level: number;
  target_level: number;
  language: Language;
};

export type LearningSessionRecord = {
  id: string;
  path_id: string;
  curriculum_step_key: string;
  session_number: number;
  adaptation_mode: LearningAdaptationMode;
  generation_status: "queued" | "generating" | "ready" | "failed";
  status: LearningSessionStatus;
  opened_at: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type LearningFeedbackRecord = {
  session_id: string;
  comprehension_rating: number;
  explainability_rating: number;
  interest_rating: number;
  difficulty_rating: number;
};

export type GeneratedLearningPrompt = {
  curriculum_step_key: string;
  title_fr: string;
  title_en: string;
  summary_fr: string;
  summary_en: string;
  objectives_fr: string[];
  objectives_en: string[];
  prompt_text: string;
  prompt_language: Language;
  adaptation_mode: LearningAdaptationMode;
};

export type LearningGenerationMetrics = {
  learning_paths_considered: number;
  learning_paths_disabled: number;
  learning_sessions_blocked_available: number;
  learning_sessions_blocked_opened: number;
  learning_sessions_generation_claimed: number;
  learning_sessions_generated: number;
  learning_sessions_reused: number;
  learning_sessions_failed: number;
  learning_paths_completed: number;
  learning_api_calls: number;
};

export type LearningGenerationResult = LearningGenerationMetrics & {
  status: "disabled" | "blocked" | "generated" | "reused" | "failed" | "no_path";
  reason: string;
  sessionId: string | null;
};

export function emptyLearningGenerationMetrics(): LearningGenerationMetrics {
  return {
    learning_paths_considered: 0,
    learning_paths_disabled: 0,
    learning_sessions_blocked_available: 0,
    learning_sessions_blocked_opened: 0,
    learning_sessions_generation_claimed: 0,
    learning_sessions_generated: 0,
    learning_sessions_reused: 0,
    learning_sessions_failed: 0,
    learning_paths_completed: 0,
    learning_api_calls: 0
  };
}
