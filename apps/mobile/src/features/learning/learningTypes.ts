import type { Language } from "../../types/domain";

export type LearningCurrentLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type LearningTargetLevel = 1 | 2 | 3 | 4 | 5;

export type LearningDomain = {
  id: string;
  slug: string;
  label_fr: string;
  label_en: string;
  description_fr: string;
  description_en: string;
  position: number;
};

export type LearningObjective = {
  id: string;
  domain_id: string;
  slug: string;
  label_fr: string;
  label_en: string;
  description_fr: string;
  description_en: string;
  position: number;
};

export type LearningPathStatus = "active" | "archived" | "completed" | string;

export type LearningPath = {
  id: string;
  user_id: string | null;
  domain_id: string;
  objective_id: string;
  current_level: LearningCurrentLevel;
  target_level: LearningTargetLevel;
  status: LearningPathStatus;
  created_at: string | null;
  updated_at: string | null;
  archived_at: string | null;
};

export type LearningSessionStatus =
  | "available"
  | "started"
  | "in_progress"
  | "completed"
  | "scheduled"
  | string;

export type LearningSession = {
  id: string;
  path_id: string;
  session_number: number;
  title_fr: string;
  title_en: string;
  summary_fr: string;
  summary_en: string;
  objectives_fr: string[];
  objectives_en: string[];
  prompt_text: string;
  status: LearningSessionStatus;
  available_on: string | null;
  completed_at: string | null;
  created_at: string | null;
};

export type LearningPathBundle = {
  domains: LearningDomain[];
  objectives: LearningObjective[];
  activePath: LearningPath | null;
  activeDomain: LearningDomain | null;
  activeObjective: LearningObjective | null;
  availableSession: LearningSession | null;
  completedSessions: LearningSession[];
  sessions: LearningSession[];
  nextAvailableAt: string | null;
};

export type LearningProviderId = "chatgpt" | "claude" | "gemini";

export type LearningFeedbackRatings = {
  comprehension: number | null;
  explainability: number | null;
  interest: number | null;
  difficulty: number | null;
};

type LocalizedLabelValue = {
  label_fr: string;
  label_en: string;
};

type LocalizedDescriptionValue = {
  description_fr: string;
  description_en: string;
};

export function localizeLearningField(
  value: LocalizedLabelValue,
  language: Language | null | undefined
): string {
  return language === "fr" ? value.label_fr : value.label_en;
}

export function localizeLearningDescription(
  value: LocalizedDescriptionValue,
  language: Language | null | undefined
): string {
  return language === "fr" ? value.description_fr : value.description_en;
}

export function localizeSessionTitle(
  session: LearningSession,
  language: Language | null | undefined
): string {
  return language === "fr" ? session.title_fr : session.title_en;
}

export function localizeSessionSummary(
  session: LearningSession,
  language: Language | null | undefined
): string {
  return language === "fr" ? session.summary_fr : session.summary_en;
}

export function localizeSessionObjectives(
  session: LearningSession,
  language: Language | null | undefined
): string[] {
  return language === "fr" ? session.objectives_fr : session.objectives_en;
}
