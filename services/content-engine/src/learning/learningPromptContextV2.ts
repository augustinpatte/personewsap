import type { LearningAdaptationMode } from "./sessionLifecycle.js";
import type {
  LearningCatalogStep,
  LearningFeedbackRecord,
  LearningPathRecord,
  LearningSessionRecord
} from "./learningTypes.js";

export type LearningPromptContextV2 = {
  language: LearningPathRecord["language"];
  learner: {
    current_level: number;
    target_level: number;
    objective_id: string;
  };
  session: {
    session_number: number;
    curriculum_step: {
      key: string;
      stage: number;
      required: boolean;
      title_fr: string;
      title_en: string;
      summary_fr: string;
      summary_en: string;
      learning_goals_fr: string[];
      learning_goals_en: string[];
      tutor_focus_fr: string;
      tutor_focus_en: string;
      prerequisite_keys: string[];
      safety_category: LearningCatalogStep["safety_category"];
    };
    adaptation_mode: LearningAdaptationMode;
    repetition_index: number;
    selected_example_context: string;
  };
  history: {
    total_sessions: number;
    completed_sessions: number;
    recent_step_keys: string[];
    recent_adaptation_modes: LearningAdaptationMode[];
    current_step_seen_count: number;
  };
  feedback_profile: {
    feedback_count: number;
    latest: FeedbackRatingsV2 | null;
    recent_average: FeedbackRatingsV2 | null;
  };
  safety_rules: string[];
};

export type FeedbackRatingsV2 = {
  comprehension: number;
  explainability: number;
  interest: number;
  difficulty: number;
};

export function buildLearningPromptContextV2(input: {
  path: LearningPathRecord;
  step: LearningCatalogStep;
  sessions: LearningSessionRecord[];
  feedbackRows: LearningFeedbackRecord[];
  sessionNumber: number;
  adaptationMode: LearningAdaptationMode;
  repetitionIndex: number;
  selectedExampleContext: string;
  safetyRules: string[];
}): LearningPromptContextV2 {
  const orderedSessions = [...input.sessions].sort((left, right) => left.session_number - right.session_number);
  const feedbackBySessionId = new Map(input.feedbackRows.map((feedback) => [feedback.session_id, feedback]));
  const orderedFeedback = orderedSessions
    .map((session) => feedbackBySessionId.get(session.id) ?? null)
    .filter((feedback): feedback is LearningFeedbackRecord => Boolean(feedback));
  const recentFeedback = orderedFeedback.slice(-3).map(toFeedbackRatings);

  return {
    language: input.path.language,
    learner: {
      current_level: input.path.current_level,
      target_level: input.path.target_level,
      objective_id: input.path.objective_id
    },
    session: {
      session_number: input.sessionNumber,
      curriculum_step: {
        key: input.step.key,
        stage: input.step.stage,
        required: input.step.required,
        title_fr: input.step.title_fr,
        title_en: input.step.title_en,
        summary_fr: input.step.summary_fr,
        summary_en: input.step.summary_en,
        learning_goals_fr: input.step.learning_goals_fr,
        learning_goals_en: input.step.learning_goals_en,
        tutor_focus_fr: input.step.tutor_focus_fr,
        tutor_focus_en: input.step.tutor_focus_en,
        prerequisite_keys: input.step.prerequisite_keys,
        safety_category: input.step.safety_category
      },
      adaptation_mode: input.adaptationMode,
      repetition_index: input.repetitionIndex,
      selected_example_context: input.selectedExampleContext
    },
    history: {
      total_sessions: orderedSessions.length,
      completed_sessions: orderedSessions.filter((session) => session.status === "completed" || session.completed_at)
        .length,
      recent_step_keys: orderedSessions.map((session) => session.curriculum_step_key).slice(-5),
      recent_adaptation_modes: orderedSessions.map((session) => session.adaptation_mode).slice(-5),
      current_step_seen_count: orderedSessions.filter((session) => session.curriculum_step_key === input.step.key)
        .length
    },
    feedback_profile: {
      feedback_count: orderedFeedback.length,
      latest: orderedFeedback.length > 0 ? toFeedbackRatings(orderedFeedback[orderedFeedback.length - 1]) : null,
      recent_average: recentFeedback.length > 0 ? averageRatings(recentFeedback) : null
    },
    safety_rules: input.safetyRules
  };
}

function toFeedbackRatings(feedback: LearningFeedbackRecord): FeedbackRatingsV2 {
  return {
    comprehension: feedback.comprehension_rating,
    explainability: feedback.explainability_rating,
    interest: feedback.interest_rating,
    difficulty: feedback.difficulty_rating
  };
}

function averageRatings(feedback: FeedbackRatingsV2[]): FeedbackRatingsV2 {
  return {
    comprehension: average(feedback.map((row) => row.comprehension)),
    explainability: average(feedback.map((row) => row.explainability)),
    interest: average(feedback.map((row) => row.interest)),
    difficulty: average(feedback.map((row) => row.difficulty))
  };
}

function average(values: number[]): number {
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}
