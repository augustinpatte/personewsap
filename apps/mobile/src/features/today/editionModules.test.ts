import { describe, expect, it } from "vitest";

import { summarizeEditionModules } from "./editionModules";

const EMPTY = {
  newsletterArticleCount: 0,
  newsletterCompleted: false,
  hasBusinessStory: false,
  businessStoryCompleted: false,
  hasMiniCase: false,
  miniCaseCompleted: false,
  learningPathEnabled: false,
  hasReadyLearningSession: false,
  learningSessionCompleted: false
};

describe("edition module total", () => {
  it("counts three modules for a full editorial edition without a learning path", () => {
    const summary = summarizeEditionModules({
      ...EMPTY,
      newsletterArticleCount: 3,
      hasBusinessStory: true,
      hasMiniCase: true
    });

    expect(summary.total).toBe(3);
  });

  it("counts four modules when the learning path adds a ready session", () => {
    const summary = summarizeEditionModules({
      ...EMPTY,
      newsletterArticleCount: 3,
      hasBusinessStory: true,
      hasMiniCase: true,
      learningPathEnabled: true,
      hasReadyLearningSession: true
    });

    expect(summary.total).toBe(4);
  });

  it("counts two modules for a business story plus a learning session", () => {
    const summary = summarizeEditionModules({
      ...EMPTY,
      hasBusinessStory: true,
      learningPathEnabled: true,
      hasReadyLearningSession: true
    });

    expect(summary.total).toBe(2);
  });

  it("counts one module for a newsletter-only edition", () => {
    expect(summarizeEditionModules({ ...EMPTY, newsletterArticleCount: 2 }).total).toBe(1);
  });

  it("counts nothing when the edition is empty", () => {
    const summary = summarizeEditionModules(EMPTY);

    expect(summary.total).toBe(0);
    expect(summary.progress).toBe(0);
    expect(summary.isComplete).toBe(false);
  });

  it("ignores an empty newsletter slot", () => {
    expect(
      summarizeEditionModules({ ...EMPTY, newsletterArticleCount: 0, hasMiniCase: true }).total
    ).toBe(1);
  });

  it("ignores the learning path when it is enabled but has no ready session", () => {
    expect(
      summarizeEditionModules({
        ...EMPTY,
        hasBusinessStory: true,
        learningPathEnabled: true,
        hasReadyLearningSession: false
      }).total
    ).toBe(1);
  });

  it("reports progress and completion over the available modules only", () => {
    const summary = summarizeEditionModules({
      ...EMPTY,
      hasBusinessStory: true,
      businessStoryCompleted: true,
      learningPathEnabled: true,
      hasReadyLearningSession: true,
      learningSessionCompleted: true
    });

    expect(summary.completed).toBe(2);
    expect(summary.progress).toBe(1);
    expect(summary.isComplete).toBe(true);
  });
});
