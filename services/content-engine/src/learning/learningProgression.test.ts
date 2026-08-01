import { describe, expect, it } from "vitest";

import {
  pickNextLearningStep,
  resolveLearningMaxStage,
  resolveLearningStartStage
} from "./catalogLoader.js";
import type { LearningCatalogStep } from "./learningTypes.js";
import type { LearningAdaptationMode } from "./sessionLifecycle.js";

const DOMAIN = "demo_domain";
const TRACK = "demo_track";
const OTHER_TRACK = "other_track";

// A miniature catalog with the same shape as the real one: a shared base, a
// track-specific chain over five stages, and one step from another orientation.
const CATALOG: LearningCatalogStep[] = [
  step({ key: "base_1", stage: 1, order: 1, required: true, objectives: [TRACK, OTHER_TRACK] }),
  step({ key: "track_s1", stage: 1, order: 2, required: true, prerequisites: ["base_1"] }),
  step({ key: "track_s2_a", stage: 2, order: 3, required: true, prerequisites: ["track_s1"], fallback: "track_s1" }),
  step({ key: "track_s2_b", stage: 2, order: 4, required: false, prerequisites: ["track_s2_a"], fallback: "track_s1" }),
  step({ key: "track_s3_a", stage: 3, order: 5, required: true, prerequisites: ["track_s2_b"], fallback: "track_s2_a" }),
  step({ key: "track_s3_b", stage: 3, order: 6, required: false, prerequisites: ["track_s3_a"], fallback: "track_s2_a" }),
  step({ key: "track_s4", stage: 4, order: 7, required: true, prerequisites: ["track_s3_b"], fallback: "track_s3_a" }),
  step({ key: "track_s5", stage: 5, order: 8, required: true, prerequisites: ["track_s4"], fallback: "track_s4" }),
  step({ key: "other_s1", stage: 1, order: 9, required: true, objectives: [OTHER_TRACK] })
];

describe("learning level mapping", () => {
  it("maps every current level to its starting stage", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(resolveLearningStartStage)).toEqual([1, 1, 2, 3, 4, 5, 5]);
  });

  it("maps every target level to its maximum stage", () => {
    expect([1, 2, 3, 4, 5].map(resolveLearningMaxStage)).toEqual([1, 2, 3, 4, 5]);
  });

  it("starts the first session at the stage matching the current level", () => {
    expect(pick({ currentLevel: 4, targetLevel: 5 })).toMatchObject({
      status: "selected",
      step: expect.objectContaining({ key: "track_s3_a" })
    });
  });

  it("never proposes a step above the target level", () => {
    const stages = walk({ currentLevel: 1, targetLevel: 2 });

    expect(stages.every((stage) => stage <= 2)).toBe(true);
    expect(Math.max(...stages)).toBe(2);
  });

  it("only proposes steps of the chosen orientation", () => {
    const keys = walkKeys({ currentLevel: 1, targetLevel: 5 });

    expect(keys).not.toContain("other_s1");
    expect(keys).toContain("track_s5");
  });

  it("completes the path once every step up to the target level is delivered", () => {
    const used = new Map(
      CATALOG.filter((entry) => entry.objective_ids.includes(TRACK) && entry.stage <= 2).map((entry) => [entry.key, 1])
    );

    expect(pick({ currentLevel: 1, targetLevel: 2, used })).toMatchObject({ status: "completed", step: null });
  });
});

describe("learning adaptation behaviours", () => {
  it("normal picks the next unused step in order", () => {
    expect(
      pick({ currentLevel: 1, targetLevel: 5, used: new Map([["base_1", 1]]), lastStepKey: "base_1" })
    ).toMatchObject({ step: expect.objectContaining({ key: "track_s1" }) });
  });

  it("reinforce repeats the same concept with a new repetition index", () => {
    const selection = pick({
      currentLevel: 1,
      targetLevel: 5,
      adaptationMode: "reinforce",
      used: new Map([["base_1", 1], ["track_s1", 1]]),
      lastStepKey: "track_s1"
    });

    expect(selection).toMatchObject({
      status: "selected",
      step: expect.objectContaining({ key: "track_s1" }),
      repetitionIndex: 1
    });
  });

  it("prerequisite falls back to a simpler step than the one that stayed unclear", () => {
    const selection = pick({
      currentLevel: 1,
      targetLevel: 5,
      adaptationMode: "prerequisite",
      used: new Map([["base_1", 1], ["track_s1", 1], ["track_s2_a", 2]]),
      lastStepKey: "track_s2_a"
    });

    expect(selection.step?.key).toBe("track_s1");
    expect(selection.step!.stage).toBeLessThan(2);
  });

  it("accelerate skips at most one optional step and never a required one", () => {
    const skippingOptional = pick({
      currentLevel: 1,
      targetLevel: 5,
      adaptationMode: "accelerate",
      used: new Map([["base_1", 1], ["track_s1", 1], ["track_s2_a", 1]]),
      lastStepKey: "track_s2_a"
    });

    expect(skippingOptional).toMatchObject({
      step: expect.objectContaining({ key: "track_s3_a" }),
      skippedStepKey: "track_s2_b"
    });

    const requiredNext = pick({
      currentLevel: 1,
      targetLevel: 5,
      adaptationMode: "accelerate",
      used: new Map([["base_1", 1]]),
      lastStepKey: "base_1"
    });

    expect(requiredNext).toMatchObject({
      step: expect.objectContaining({ key: "track_s1", required: true }),
      skippedStepKey: null
    });
  });

  it("context shift keeps the concept and only changes the example", () => {
    const selection = pick({
      currentLevel: 1,
      targetLevel: 5,
      adaptationMode: "context_shift",
      used: new Map([["base_1", 1], ["track_s1", 1]]),
      lastStepKey: "track_s1"
    });

    expect(selection).toMatchObject({
      step: expect.objectContaining({ key: "track_s1" }),
      repetitionIndex: 1
    });
  });

  it("keeps a required step reachable after an accelerated skip", () => {
    const used = new Map([["base_1", 1], ["track_s1", 1], ["track_s2_a", 1], ["track_s3_a", 1]]);

    // track_s2_b was skipped: the next required step must still be offered.
    expect(pick({ currentLevel: 1, targetLevel: 5, used, lastStepKey: "track_s3_a" }).step?.key).toBe("track_s2_b");
  });
});

function pick(options: {
  currentLevel: number;
  targetLevel: number;
  used?: Map<string, number>;
  adaptationMode?: LearningAdaptationMode;
  lastStepKey?: string | null;
}) {
  return pickNextLearningStep({
    catalog: CATALOG,
    domainId: DOMAIN,
    objectiveId: TRACK,
    currentLevel: options.currentLevel,
    targetLevel: options.targetLevel,
    usedStepKeys: options.used ?? new Map(),
    adaptationMode: options.adaptationMode ?? "normal",
    lastStepKey: options.lastStepKey ?? null
  });
}

function walkKeys(options: { currentLevel: number; targetLevel: number }): string[] {
  const used = new Map<string, number>();
  const keys: string[] = [];

  for (let index = 0; index < 50; index += 1) {
    const selection = pick({ ...options, used, lastStepKey: keys.at(-1) ?? null });
    if (selection.status === "completed") {
      break;
    }
    keys.push(selection.step.key);
    used.set(selection.step.key, 1);
  }

  return keys;
}

function walk(options: { currentLevel: number; targetLevel: number }): number[] {
  const byKey = new Map(CATALOG.map((entry) => [entry.key, entry]));
  return walkKeys(options).map((key) => byKey.get(key)!.stage);
}

function step(input: {
  key: string;
  stage: number;
  order: number;
  required: boolean;
  objectives?: string[];
  prerequisites?: string[];
  fallback?: string;
}): LearningCatalogStep {
  return {
    key: input.key,
    domain_id: DOMAIN,
    objective_ids: input.objectives ?? [TRACK],
    stage: input.stage,
    order: input.order,
    required: input.required,
    prerequisite_keys: input.prerequisites ?? [],
    fallback_key: input.fallback ?? null,
    title_fr: `Titre ${input.key}`,
    title_en: `Title ${input.key}`,
    summary_fr: `Résumé de ${input.key}`,
    summary_en: `Summary of ${input.key}`,
    learning_goals_fr: ["Objectif un", "Objectif deux"],
    learning_goals_en: ["Goal one", "Goal two"],
    tutor_focus_fr: `Focus ${input.key}`,
    tutor_focus_en: `Focus ${input.key}`,
    example_contexts_fr: ["contexte un", "contexte deux", "contexte trois"],
    example_contexts_en: ["context one", "context two", "context three"],
    safety_category: "standard"
  };
}
