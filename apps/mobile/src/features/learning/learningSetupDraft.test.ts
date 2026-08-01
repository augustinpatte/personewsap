import { describe, expect, it } from "vitest";

import {
  getLearningSetupDraftKey,
  LEARNING_SETUP_DRAFT_KEY_V1,
  migrateLearningSetupDraftForUser,
  parseLearningSetupDraft,
  reconcileLearningSetupDraft,
  resolveLearningSetupStep
} from "./learningSetupDraft";
import type { LearningDomain, LearningObjective } from "./learningTypes";

const DOMAINS: LearningDomain[] = [
  domain("computer_science", 1),
  domain("mathematics", 2)
];
const OBJECTIVES: LearningObjective[] = [
  objective("cs_systems", "computer_science", 1),
  objective("cs_programming", "computer_science", 2),
  objective("math_foundations", "mathematics", 1)
];

describe("learning setup draft", () => {
  it("keeps a complete draft that still matches the live data", () => {
    const restored = reconcileLearningSetupDraft(
      {
        domainId: "computer_science",
        objectiveId: "cs_programming",
        currentLevel: 3,
        targetLevel: 4,
        currentStep: 4
      },
      { domains: DOMAINS, objectives: OBJECTIVES }
    );

    expect(restored).toEqual({
      domainId: "computer_science",
      objectiveId: "cs_programming",
      currentLevel: 3,
      targetLevel: 4,
      currentStep: 4
    });
  });

  it("drops a domain that no longer exists and returns to the domain step", () => {
    const restored = reconcileLearningSetupDraft(
      {
        domainId: "astrophysics",
        objectiveId: "cs_systems",
        currentLevel: 2,
        targetLevel: 3,
        currentStep: 4
      },
      { domains: DOMAINS, objectives: OBJECTIVES }
    );

    expect(restored.domainId).toBeNull();
    expect(restored.objectiveId).toBeNull();
    expect(restored.currentStep).toBe(0);
  });

  it("drops an orientation that no longer belongs to the domain and returns to the orientation step", () => {
    const restored = reconcileLearningSetupDraft(
      {
        domainId: "computer_science",
        objectiveId: "math_foundations",
        currentLevel: 2,
        targetLevel: 3,
        currentStep: 4
      },
      { domains: DOMAINS, objectives: OBJECTIVES }
    );

    expect(restored.domainId).toBe("computer_science");
    expect(restored.objectiveId).toBeNull();
    expect(restored.currentStep).toBe(3);
  });

  it("rejects levels outside the allowed ranges", () => {
    const restored = reconcileLearningSetupDraft(
      { domainId: "computer_science", currentLevel: 9, targetLevel: 8, currentStep: 3 } as never,
      { domains: DOMAINS, objectives: OBJECTIVES }
    );

    expect(restored.currentLevel).toBeNull();
    expect(restored.targetLevel).toBeNull();
    expect(restored.currentStep).toBe(1);
  });

  it("drops a target level below the selected current level floor", () => {
    const restored = reconcileLearningSetupDraft(
      { domainId: "computer_science", currentLevel: 6, targetLevel: 4, currentStep: 4 },
      { domains: DOMAINS, objectives: OBJECTIVES }
    );

    expect(restored.currentLevel).toBe(6);
    expect(restored.targetLevel).toBeNull();
    expect(restored.currentStep).toBe(2);
  });

  it("scopes setup drafts by user id", () => {
    expect(getLearningSetupDraftKey("user-1")).toBe("personewsap:learning-setup-draft:v2:user-1");
    expect(getLearningSetupDraftKey(null)).toBe("personewsap:learning-setup-draft:v2:anonymous");
  });

  it("ignores v1 when a user-scoped v2 draft already exists", async () => {
    const storage = memoryStorage({
      [getLearningSetupDraftKey("user-a")]: "draft-v2",
      [LEARNING_SETUP_DRAFT_KEY_V1]: "draft-v1"
    });

    await expect(migrateLearningSetupDraftForUser(storage, "user-a")).resolves.toBe("draft-v2");
    expect(storage.reads).toEqual([getLearningSetupDraftKey("user-a")]);
  });

  it("copies v1 to v2, verifies it, then deletes v1", async () => {
    const storage = memoryStorage({
      [LEARNING_SETUP_DRAFT_KEY_V1]: "draft-v1"
    });

    await expect(migrateLearningSetupDraftForUser(storage, "user-a")).resolves.toBe("draft-v1");
    await expect(storage.getItem(getLearningSetupDraftKey("user-a"))).resolves.toBe("draft-v1");
    await expect(storage.getItem(LEARNING_SETUP_DRAFT_KEY_V1)).resolves.toBeNull();
  });

  it("keeps v1 when the v2 write cannot be verified", async () => {
    const storage = memoryStorage(
      { [LEARNING_SETUP_DRAFT_KEY_V1]: "draft-v1" },
      { dropWrites: true }
    );

    await expect(migrateLearningSetupDraftForUser(storage, "user-a")).rejects.toThrow("verify");
    await expect(storage.getItem(LEARNING_SETUP_DRAFT_KEY_V1)).resolves.toBe("draft-v1");
  });

  it("does not restore user A's migrated draft for user B", async () => {
    const storage = memoryStorage({
      [LEARNING_SETUP_DRAFT_KEY_V1]: "draft-a"
    });

    await expect(migrateLearningSetupDraftForUser(storage, "user-a")).resolves.toBe("draft-a");
    await expect(migrateLearningSetupDraftForUser(storage, "user-b")).resolves.toBeNull();
  });

  it("returns an empty draft rather than throwing on corrupted storage", () => {
    expect(parseLearningSetupDraft("{not json")).toBeNull();
    expect(parseLearningSetupDraft(null)).toBeNull();
    expect(reconcileLearningSetupDraft(null, { domains: DOMAINS, objectives: OBJECTIVES })).toEqual({
      domainId: null,
      objectiveId: null,
      currentLevel: null,
      targetLevel: null,
      currentStep: 0
    });
  });

  it("never restores a step further than the answers it holds", () => {
    expect(
      resolveLearningSetupStep(4, {
        domainId: "computer_science",
        objectiveId: null,
        currentLevel: 2,
        targetLevel: null
      })
    ).toBe(2);
  });
});

function domain(id: string, position: number): LearningDomain {
  return {
    id,
    slug: id,
    label_fr: id,
    label_en: id,
    description_fr: id,
    description_en: id,
    position
  };
}

function objective(id: string, domainId: string, position: number): LearningObjective {
  return {
    id,
    domain_id: domainId,
    slug: id,
    label_fr: id,
    label_en: id,
    description_fr: id,
    description_en: id,
    position
  };
}

function memoryStorage(
  initial: Record<string, string> = {},
  options: { dropWrites?: boolean } = {}
) {
  const values = new Map(Object.entries(initial));
  const storage = {
    reads: [] as string[],
    async getItem(key: string) {
      storage.reads.push(key);
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      if (!options.dropWrites) {
        values.set(key, value);
      }
    },
    async removeItem(key: string) {
      values.delete(key);
    }
  };

  return storage;
}
