import type { Language } from "../../../types/domain";

/**
 * Shape of one curriculum step, mirroring content/learning-paths/v1 (served
 * from public.learning_catalog_domains). Only the fields the app needs to pick
 * the next step and render its tutor prompt are typed here.
 */
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
  safety_category: string | null;
};

export type LearningAdaptationMode =
  | "normal"
  | "reinforce"
  | "accelerate"
  | "context_shift"
  | "prerequisite";

export type LearningStepSelection =
  | { status: "completed"; step: null; repetitionIndex: 0; skippedStepKey: null }
  | {
      status: "selected";
      step: LearningCatalogStep;
      repetitionIndex: number;
      skippedStepKey: string | null;
    };

/** The session payload handed to create_next_learning_session. */
export type PreparedLearningSession = {
  curriculumStepKey: string;
  skippedStepKey: string | null;
  adaptationMode: LearningAdaptationMode;
  titleFr: string;
  titleEn: string;
  summaryFr: string;
  summaryEn: string;
  objectivesFr: string[];
  objectivesEn: string[];
  promptText: string;
  language: Language;
};
