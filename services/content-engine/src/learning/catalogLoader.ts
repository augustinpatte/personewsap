import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LearningCatalogStep } from "./learningTypes.js";
import type { LearningAdaptationMode } from "./sessionLifecycle.js";

const CATALOG_ROOT = resolveCatalogRoot();

// current_level (1-7, declared by the learner) decides where the path starts.
export const LEARNING_START_STAGE_BY_CURRENT_LEVEL: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 5
};

// target_level (1-5) is the highest stage the path is allowed to reach.
export const LEARNING_MAX_STAGE_BY_TARGET_LEVEL: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5
};

export type LearningStepSelection =
  | {
      status: "completed";
      step: null;
      repetitionIndex: 0;
      skippedStepKey: null;
    }
  | {
      status: "selected";
      step: LearningCatalogStep;
      repetitionIndex: number;
      skippedStepKey: string | null;
    };

export class InvalidLearningLevelRangeError extends Error {
  constructor(currentLevel: number, targetLevel: number) {
    super(`Invalid learning level range: current_level=${currentLevel} target_level=${targetLevel}.`);
    this.name = "InvalidLearningLevelRangeError";
  }
}

export async function loadLearningCatalog(): Promise<LearningCatalogStep[]> {
  const index = JSON.parse(await readFile(path.join(CATALOG_ROOT, "catalog-index.json"), "utf8")) as {
    domains: Array<{ file: string }>;
  };
  const catalogs = await Promise.all(
    index.domains.map(async (domain) => {
      const payload = JSON.parse(await readFile(path.join(CATALOG_ROOT, domain.file), "utf8")) as {
        steps: LearningCatalogStep[];
      };
      return payload.steps;
    })
  );

  return catalogs.flat().sort((left, right) => left.domain_id.localeCompare(right.domain_id) || left.order - right.order);
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
  const pathSteps = orientationSteps.filter((step) => step.stage >= startStage && step.stage <= maxStage);
  const stepByKey = new Map(input.catalog.map((step) => [step.key, step]));
  const lastStep = input.lastStepKey ? stepByKey.get(input.lastStepKey) ?? null : null;

  // reinforce and context_shift stay on the concept that was just rated: the
  // repetition index is what makes the new session distinguishable.
  if ((input.adaptationMode === "reinforce" || input.adaptationMode === "context_shift") && lastStep) {
    return selected(lastStep, input.usedStepKeys, null);
  }

  if (input.adaptationMode === "prerequisite" && lastStep) {
    return selected(resolveSimplerStep(lastStep, orientationSteps, stepByKey) ?? lastStep, input.usedStepKeys, null);
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
    const skipped = validateSkippedStep({
      selectedStep: available[1],
      skippedStep: available[0],
      domainId: input.domainId,
      objectiveId: input.objectiveId
    });
    return selected(available[1], input.usedStepKeys, skipped.key);
  }

  return selected(available[0], input.usedStepKeys, null);
}

function validateSkippedStep(input: {
  selectedStep: LearningCatalogStep;
  skippedStep: LearningCatalogStep;
  domainId: string;
  objectiveId: string;
}): LearningCatalogStep {
  const { selectedStep, skippedStep } = input;
  if (
    skippedStep.key === selectedStep.key ||
    skippedStep.domain_id !== input.domainId ||
    skippedStep.domain_id !== selectedStep.domain_id ||
    !skippedStep.objective_ids.includes(input.objectiveId) ||
    skippedStep.required
  ) {
    throw new Error(`Invalid accelerated skip from ${skippedStep.key} to ${selectedStep.key}.`);
  }

  return skippedStep;
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
  orientationSteps: LearningCatalogStep[],
  stepByKey: Map<string, LearningCatalogStep>
): LearningCatalogStep | null {
  const fallback = step.fallback_key ? stepByKey.get(step.fallback_key) ?? null : null;
  if (fallback) {
    return fallback;
  }

  const prerequisite = step.prerequisite_keys
    .map((key) => stepByKey.get(key))
    .find((candidate): candidate is LearningCatalogStep => Boolean(candidate));
  if (prerequisite) {
    return prerequisite;
  }

  return orientationSteps.filter((candidate) => candidate.order < step.order).at(-1) ?? null;
}

function clampLevel(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}

function resolveCatalogRoot(): string {
  const candidates: string[] = [];

  if (import.meta.url.startsWith("file:")) {
    candidates.push(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content/learning-paths/v1"));
  }

  candidates.push(
    path.resolve(process.cwd(), "content/learning-paths/v1"),
    path.resolve(process.cwd(), "../../content/learning-paths/v1")
  );

  const match = candidates.find((candidate) => existsSync(path.join(candidate, "catalog-index.json")));

  if (!match) {
    throw new Error(`Learning catalog not found. Checked: ${candidates.join(", ")}`);
  }

  return match;
}
