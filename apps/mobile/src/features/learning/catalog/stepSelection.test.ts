import { describe, expect, it } from "vitest";

import type { LearningCatalogStep } from "./catalogTypes";
import {
  countUsedStepKeys,
  pickNextLearningStep,
  resolveLearningAdaptationMode,
  resolveLearningMaxStage,
  resolveLearningStartStage
} from "./stepSelection";

function step(overrides: Partial<LearningCatalogStep> & { key: string; order: number }): LearningCatalogStep {
  return {
    domain_id: "computer_science",
    objective_ids: ["cs_systems"],
    stage: 1,
    required: true,
    prerequisite_keys: [],
    fallback_key: null,
    title_fr: `FR ${overrides.key}`,
    title_en: `EN ${overrides.key}`,
    summary_fr: "resume",
    summary_en: "summary",
    learning_goals_fr: ["a", "b"],
    learning_goals_en: ["a", "b"],
    tutor_focus_fr: "focus",
    tutor_focus_en: "focus",
    example_contexts_fr: ["un exemple", "un autre exemple"],
    example_contexts_en: ["an example", "another example"],
    safety_category: null,
    ...overrides
  };
}

const catalog: LearningCatalogStep[] = [
  step({ key: "s1", order: 1, stage: 1 }),
  step({ key: "s2", order: 2, stage: 1 }),
  step({ key: "s3", order: 3, stage: 2, prerequisite_keys: ["s1"] }),
  step({ key: "s4", order: 4, stage: 2, required: false }),
  step({ key: "s5", order: 5, stage: 5 })
];

function pick(
  used: Array<[string, number]>,
  overrides: Partial<Parameters<typeof pickNextLearningStep>[0]> = {}
) {
  return pickNextLearningStep({
    catalog,
    domainId: "computer_science",
    objectiveId: "cs_systems",
    currentLevel: 1,
    targetLevel: 5,
    usedStepKeys: new Map(used),
    adaptationMode: "normal",
    lastStepKey: null,
    ...overrides
  });
}

describe("self-paced curriculum walk", () => {
  it("gives a brand-new path its first step immediately", () => {
    const selection = pick([]);

    expect(selection.status).toBe("selected");
    expect(selection.step?.key).toBe("s1");
    expect(selection.repetitionIndex).toBe(0);
  });

  it("advances step by step with no calendar involved", () => {
    // Twelve consecutive advances only depend on what was already delivered:
    // no date, no edition, nothing to wait for.
    const used: Array<[string, number]> = [];
    const walked: string[] = [];

    for (let round = 0; round < 4; round += 1) {
      const selection = pick(used);

      if (selection.status !== "selected") {
        break;
      }

      walked.push(selection.step.key);
      used.push([selection.step.key, 1]);
    }

    expect(walked).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("reports completion once every step up to the target is delivered", () => {
    const selection = pick(
      [
        ["s1", 1],
        ["s2", 1],
        ["s3", 1],
        ["s4", 1],
        ["s5", 1]
      ]
    );

    expect(selection.status).toBe("completed");
    expect(selection.step).toBeNull();
  });

  it("stops at the target level rather than walking the whole catalog", () => {
    const selection = pick(
      [
        ["s1", 1],
        ["s2", 1],
        ["s3", 1],
        ["s4", 1]
      ],
      { targetLevel: 2 }
    );

    // s5 is stage 5, beyond a target level of 2.
    expect(selection.status).toBe("completed");
  });

  it("holds a step back until its required prerequisite has been delivered", () => {
    const selection = pick([["s2", 1]], { currentLevel: 3 });

    // Starting at stage 2, s3 needs s1 (stage 1) which is below the start
    // stage, so it counts as already known.
    expect(selection.step?.key).toBe("s3");
  });

  it("repeats the same step on reinforce, with a rising repetition index", () => {
    const selection = pick([["s1", 1]], {
      adaptationMode: "reinforce",
      lastStepKey: "s1"
    });

    expect(selection.step?.key).toBe("s1");
    expect(selection.repetitionIndex).toBe(1);
  });

  it("skips at most one optional step on accelerate", () => {
    const selection = pick(
      [
        ["s1", 1],
        ["s2", 1],
        ["s3", 1]
      ],
      { adaptationMode: "accelerate" }
    );

    // s4 is optional, so it can be skipped in favour of s5.
    expect(selection.step?.key).toBe("s5");
    expect(selection.skippedStepKey).toBe("s4");
  });

  it("never skips a required step on accelerate", () => {
    const selection = pick([], { adaptationMode: "accelerate" });

    expect(selection.step?.key).toBe("s1");
    expect(selection.skippedStepKey).toBeNull();
  });
});

describe("adaptation mode", () => {
  it("defaults to normal without feedback", () => {
    expect(resolveLearningAdaptationMode(null)).toBe("normal");
  });

  it("reinforces after weak comprehension, then falls back to a prerequisite", () => {
    const weak = {
      comprehensionRating: 2,
      explainabilityRating: 3,
      interestRating: 3,
      difficultyRating: 3
    };

    expect(resolveLearningAdaptationMode(weak)).toBe("reinforce");
    expect(resolveLearningAdaptationMode(weak, true)).toBe("prerequisite");
  });

  it("accelerates when everything was easy", () => {
    expect(
      resolveLearningAdaptationMode({
        comprehensionRating: 5,
        explainabilityRating: 4,
        interestRating: 4,
        difficultyRating: 1
      })
    ).toBe("accelerate");
  });
});

describe("level ranges", () => {
  it("maps declared levels onto catalog stages", () => {
    expect(resolveLearningStartStage(1)).toBe(1);
    expect(resolveLearningStartStage(7)).toBe(5);
    expect(resolveLearningMaxStage(3)).toBe(3);
  });
});

describe("countUsedStepKeys", () => {
  it("counts delivered and skipped steps, tolerating missing keys", () => {
    const used = countUsedStepKeys([
      { curriculum_step_key: "s1" },
      { curriculum_step_key: "s1" },
      { curriculum_step_key: "s2", skipped_step_key: "s3" },
      { curriculum_step_key: null }
    ]);

    expect(used.get("s1")).toBe(2);
    expect(used.get("s2")).toBe(1);
    expect(used.get("s3")).toBe(1);
    expect(used.size).toBe(3);
  });
});
