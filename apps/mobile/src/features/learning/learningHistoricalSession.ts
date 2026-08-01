import type { LearningSession } from "./learningTypes";

export type HistoricalLearningSessionResult =
  | { status: "found"; session: LearningSession }
  | { status: "not_found"; session: null };

export function selectHistoricalLearningSession(input: {
  pathId: string;
  sessionId: string;
  sessions: LearningSession[];
}): HistoricalLearningSessionResult {
  const session =
    input.sessions.find(
      (candidate) => candidate.path_id === input.pathId && candidate.id === input.sessionId
    ) ?? null;

  return session ? { status: "found", session } : { status: "not_found", session: null };
}

export async function loadHistoricalLearningSession(input: {
  pathId: string;
  sessionId: string;
  loadSessionsForPath: (pathId: string) => Promise<LearningSession[]>;
}): Promise<HistoricalLearningSessionResult> {
  const sessions = await input.loadSessionsForPath(input.pathId);
  return selectHistoricalLearningSession({
    pathId: input.pathId,
    sessionId: input.sessionId,
    sessions
  });
}
