import { describe, expect, it } from "vitest";

import { resolveLearningFeedbackSubmitDecision } from "./learningFeedbackUi";

describe("learning feedback UI decision", () => {
  it("routes a synced success to the normal success path", () => {
    expect(resolveLearningFeedbackSubmitDecision({ ok: true, syncPending: false })).toBe("success");
  });

  it("shows a sync message for local pending feedback", () => {
    expect(resolveLearningFeedbackSubmitDecision({ ok: true, syncPending: true })).toBe("syncPending");
  });

  it("stays on the screen when feedback fails", () => {
    expect(resolveLearningFeedbackSubmitDecision({ ok: false, syncPending: false })).toBe("error");
  });
});
