export type LearningFeedbackSubmitResult = {
  ok: boolean;
  syncPending: boolean;
};

export type LearningFeedbackSubmitDecision = "success" | "syncPending" | "error";

export function resolveLearningFeedbackSubmitDecision(
  result: LearningFeedbackSubmitResult
): LearningFeedbackSubmitDecision {
  if (!result.ok) {
    return "error";
  }

  return result.syncPending ? "syncPending" : "success";
}
