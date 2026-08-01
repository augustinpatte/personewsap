import type { LearningPath, LearningSession } from "./learningTypes";

export function selectLatestLearningSessionForDrop(
  sessions: LearningSession[],
  dropId: string | null | undefined
): LearningSession | null {
  if (!dropId) {
    return null;
  }

  return (
    [...sessions]
      .filter(
        (session) =>
          session.daily_drop_id === dropId &&
          (session.generation_status === undefined || session.generation_status === "ready") &&
          ["available", "opened", "started", "completed"].includes(session.status)
      )
      .sort((left, right) => right.session_number - left.session_number)[0] ?? null
  );
}

export function getHistoricalLearningPaths(
  learningPaths: LearningPath[],
  displayPath: LearningPath | null | undefined
): LearningPath[] {
  return [...learningPaths]
    .filter(
      (path) =>
        path.id !== displayPath?.id && (path.status === "completed" || path.status === "archived")
    )
    .sort((left, right) => getPathSortDate(right).localeCompare(getPathSortDate(left)));
}

export function getLearningSessionsForPath(
  sessions: LearningSession[],
  pathId: string
): LearningSession[] {
  return sessions.filter((session) => session.path_id === pathId);
}

function getPathSortDate(path: LearningPath): string {
  return path.completed_at ?? path.archived_at ?? path.updated_at ?? path.created_at ?? "";
}
