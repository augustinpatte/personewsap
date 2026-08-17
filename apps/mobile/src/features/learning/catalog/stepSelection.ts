import type {
  LearningAdaptationMode,
  LearningCatalogStep,
  LearningStepSelection
} from "./catalogTypes";

/**
 * Curriculum walk for the mobile app.
 *
 * Ported from services/content-engine/src/learning/catalogLoader.ts so a reader
 * can advance their path on demand instead of waiting for the daily job to run.
 * Behaviour is deliberately identical to the engine: both sides walk the same
 * catalog the same way, so a session created in the app and one created by the
 * engine are interchangeable.
 */

/** current_level (1-7, declared by the learner) decides where the path starts. */
export const LEARNING_START_STAGE_BY_CURRENT_LEVEL: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 5
};

/** target_level (1-5) is the highest stage the path is allowed to reach. */
export const LEARNING_MAX_STAGE_BY_TARGET_LEVEL: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5
};

export class InvalidLearningLevelRangeError extends Error {
  constructor(currentLevel: number, targetLevel: number) {
    super(
      `Invalid learning level range: current_level=${currentLevel} target_level=${targetLevel}.`
    );
    this.name = "InvalidLearningLevelRangeError";
  }
}

function clampLevel(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

export function resolveLearningStartStage(currentLevel: number): number {
  return LEARNING_START_STAGE_BY_CURRENT_LEVEL[clampLevel(currentLevel, 1, 7)] ?? 1;
}

export function resolveLearningMaxStage(targetLevel: number): number {
  return LEARNING_MAX_STAGE_BY_TARGET_LEVEL[clampLevel(targetLevel, 1, 5)] ?? 1;
}

export function pickNextLearningStep(input: {
  catalog: LearningCatalogStep[];
  domainId: string;
  objectiveId: string;
  currentLevel: number;
  targetLevel: number;
  /** How many sessions already used each curriculum step key. */
  usedStepKeys: ReadonlyMap<string, number>;
  adaptationMode: LearningAdaptationMode;
  /** Step of the session the adaptation decision was made on. */
  lastStepKey: string | null;
}): LearningStepSelection {
  const startStage = resolveLearningStartStage(input.currentLevel);
  const maxStage = resolveLearningMaxStage(input.targetLevel);

  if (maxStage < startStage) {
    throw new InvalidLearningLevelRangeError(input.currentLevel, input.targetLevel);
  }

  const orientationSteps = input.catalog
    .filter((step) => step.domain_id === input.domainId)
    .filter((step) => step.objective_ids.includes(input.objectiveId))
    .sort((left, right) => left.order - right.order);
  const pathSteps = orientationSteps.filter(
    (step) => step.stage >= startStage && step.stage <= maxStage
  );
  const stepByKey = new Map(input.catalog.map((step) => [step.key, step]));
  const lastStep = input.lastStepKey ? stepByKey.get(input.lastStepKey) ?? null : null;

  // reinforce and context_shift stay on the concept that was just rated: the
  // repetition index is what makes the new session distinguishable.
  if (
    (input.adaptationMode === "reinforce" || input.adaptationMode === "context_shift") &&
    lastStep
  ) {
    return selected(lastStep, input.usedStepKeys, null);
  }

  if (input.adaptationMode === "prerequisite" && lastStep) {
    return selected(
      resolveSimplerStep(lastStep, stepByKey) ?? lastStep,
      input.usedStepKeys,
      null
    );
  }

  const available = pathSteps.filter(
    (step) =>
      !input.usedStepKeys.has(step.key) &&
      hasSatisfiedRequiredPrerequisites(step, stepByKey, input.usedStepKeys, startStage)
  );

  if (available.length === 0) {
    return { status: "completed", step: null, repetitionIndex: 0, skippedStepKey: null };
  }

  // accelerate skips at most one step, and never a required one.
  if (input.adaptationMode === "accelerate" && available.length > 1 && !available[0].required) {
    return selected(available[1], input.usedStepKeys, available[0].key);
  }

  return selected(available[0], input.usedStepKeys, null);
}

function selected(
  step: LearningCatalogStep,
  usedStepKeys: ReadonlyMap<string, number>,
  skippedStepKey: string | null
): LearningStepSelection {
  return {
    status: "selected",
    step,
    repetitionIndex: usedStepKeys.get(step.key) ?? 0,
    skippedStepKey
  };
}

// Optional steps may be skipped, so only a required prerequisite blocks a step.
// Anything below the learner's starting stage is assumed already known.
function hasSatisfiedRequiredPrerequisites(
  step: LearningCatalogStep,
  stepByKey: Map<string, LearningCatalogStep>,
  usedStepKeys: ReadonlyMap<string, number>,
  startStage: number
): boolean {
  return step.prerequisite_keys.every((key) => {
    const prerequisite = stepByKey.get(key);

    if (!prerequisite || !prerequisite.required || prerequisite.stage < startStage) {
      return true;
    }

    return usedStepKeys.has(key);
  });
}

function resolveSimplerStep(
  step: LearningCatalogStep,
  stepByKey: Map<string, LearningCatalogStep>
): LearningCatalogStep | null {
  const fallback = step.fallback_key ? stepByKey.get(step.fallback_key) ?? null : null;

  if (fallback) {
    return fallback;
  }

  return (
    step.prerequisite_keys
      .map((key) => stepByKey.get(key))
      .find((candidate): candidate is LearningCatalogStep => Boolean(candidate)) ?? null
  );
}

/**
 * Which adaptation mode the next session should use, from the feedback given on
 * the session that just finished. Mirrors the engine's scheduler.
 */
export function resolveLearningAdaptationMode(
  feedback: {
    comprehensionRating: number;
    explainabilityRating: number;
    interestRating: number;
    difficultyRating: number;
  } | null,
  weakAfterReinforcement = false
): LearningAdaptationMode {
  if (!feedback) {
    return "normal";
  }

  if (
    feedback.comprehensionRating <= 2 ||
    feedback.explainabilityRating <= 2 ||
    feedback.difficultyRating === 5
  ) {
    return weakAfterReinforcement ? "prerequisite" : "reinforce";
  }

  if (
    feedback.comprehensionRating >= 4 &&
    feedback.explainabilityRating >= 4 &&
    feedback.difficultyRating <= 2
  ) {
    return "accelerate";
  }

  if (feedback.interestRating <= 2) {
    return "context_shift";
  }

  return "normal";
}

/** Count how many times each curriculum step has already been delivered. */
export function countUsedStepKeys(
  sessions: Array<{
    curriculum_step_key?: string | null;
    skipped_step_key?: string | null;
  }>
): Map<string, number> {
  const used = new Map<string, number>();

  for (const session of sessions) {
    if (session.curriculum_step_key) {
      used.set(session.curriculum_step_key, (used.get(session.curriculum_step_key) ?? 0) + 1);
    }

    if (session.skipped_step_key) {
      used.set(session.skipped_step_key, (used.get(session.skipped_step_key) ?? 0) + 1);
    }
  }

  return used;
}
