import type { DataFetchSource } from "../../lib/dataState";
import type { LearningPath } from "./learningTypes";

export function shouldRedirectToLearningSetup(input: {
  authStatus: "loading" | "signedOut" | "needsOnboarding" | "ready";
  learningStatus: "loading" | "ready" | "error";
  source: DataFetchSource;
  learningPathChoiceCompleted: boolean;
  learningPathEnabled: boolean;
  activePath: LearningPath | null;
  latestCompletedPath: LearningPath | null;
}): boolean {
  return (
    input.authStatus === "ready" &&
    input.learningStatus === "ready" &&
    input.source === "supabase" &&
    input.learningPathChoiceCompleted &&
    input.learningPathEnabled &&
    !input.activePath &&
    !input.latestCompletedPath
  );
}
