import { describe, expect, it } from "vitest";

import { shouldRedirectToLearningSetup } from "./learningPathRouting";
import type { LearningPath } from "./learningTypes";

const BASE = {
  authStatus: "ready" as const,
  learningStatus: "ready" as const,
  source: "supabase" as const,
  learningPathChoiceCompleted: true,
  learningPathEnabled: true,
  activePath: null,
  latestCompletedPath: null
};

describe("learning path routing", () => {
  it("redirects only when the learner opted in and has no active or completed path", () => {
    expect(shouldRedirectToLearningSetup(BASE)).toBe(true);
  });

  it("does not redirect while auth or learning state is not ready", () => {
    expect(shouldRedirectToLearningSetup({ ...BASE, authStatus: "loading" })).toBe(false);
    expect(shouldRedirectToLearningSetup({ ...BASE, learningStatus: "loading" })).toBe(false);
  });

  it("does not redirect after an explicit refusal", () => {
    expect(
      shouldRedirectToLearningSetup({
        ...BASE,
        learningPathChoiceCompleted: true,
        learningPathEnabled: false
      })
    ).toBe(false);
  });

  it("does not redirect when the latest path is completed", () => {
    expect(
      shouldRedirectToLearningSetup({
        ...BASE,
        latestCompletedPath: { id: "completed-path", status: "completed" } as LearningPath
      })
    ).toBe(false);
  });
});
