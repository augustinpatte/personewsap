import type {
  LearningCurrentLevel,
  LearningDomain,
  LearningObjective,
  LearningTargetLevel
} from "./learningTypes";

export const LEARNING_SETUP_DRAFT_KEY = "personewsap:learning-setup-draft:v1";

export type LearningSetupStep = 0 | 1 | 2 | 3 | 4;

export type LearningSetupDraft = {
  domainId: string | null;
  objectiveId: string | null;
  currentLevel: LearningCurrentLevel | null;
  targetLevel: LearningTargetLevel | null;
  currentStep: LearningSetupStep;
};

export function parseLearningSetupDraft(value: string | null): Partial<LearningSetupDraft> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Partial<LearningSetupDraft>) : null;
  } catch {
    return null;
  }
}

/**
 * Keeps only the parts of a draft that still exist in the live data. A domain or
 * orientation that disappeared is dropped, and the step is pulled back to the
 * first question the user has to answer again.
 */
export function reconcileLearningSetupDraft(
  draft: Partial<LearningSetupDraft> | null,
  data: { domains: LearningDomain[]; objectives: LearningObjective[] }
): LearningSetupDraft {
  const domainId =
    typeof draft?.domainId === "string" && data.domains.some((domain) => domain.id === draft.domainId)
      ? draft.domainId
      : null;
  const objectiveId =
    domainId && typeof draft?.objectiveId === "string" &&
    data.objectives.some(
      (objective) => objective.id === draft.objectiveId && objective.domain_id === domainId
    )
      ? draft.objectiveId
      : null;
  const currentLevel = isLearningCurrentLevel(draft?.currentLevel) ? draft.currentLevel : null;
  const targetLevel = isLearningTargetLevel(draft?.targetLevel) ? draft.targetLevel : null;

  return {
    domainId,
    objectiveId,
    currentLevel,
    targetLevel,
    currentStep: resolveLearningSetupStep(draft?.currentStep, {
      domainId,
      objectiveId,
      currentLevel,
      targetLevel
    })
  };
}

export function resolveLearningSetupStep(
  savedStep: unknown,
  selections: {
    domainId: string | null;
    objectiveId: string | null;
    currentLevel: LearningCurrentLevel | null;
    targetLevel: LearningTargetLevel | null;
  }
): LearningSetupStep {
  const firstIncompleteStep: LearningSetupStep = !selections.domainId
    ? 0
    : !selections.currentLevel
      ? 1
      : !selections.targetLevel
        ? 2
        : !selections.objectiveId
          ? 3
          : 4;
  const requestedStep =
    typeof savedStep === "number" && Number.isInteger(savedStep) && savedStep >= 0 && savedStep <= 4
      ? (savedStep as LearningSetupStep)
      : 0;

  return Math.min(requestedStep, firstIncompleteStep) as LearningSetupStep;
}

export function isLearningCurrentLevel(value: unknown): value is LearningCurrentLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}

export function isLearningTargetLevel(value: unknown): value is LearningTargetLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}
