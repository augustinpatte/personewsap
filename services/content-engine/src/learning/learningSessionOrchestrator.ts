import { sha256 } from "../utils/hash.js";
import { loadLearningCatalog, pickNextLearningStep } from "./catalogLoader.js";
import { createLearningRequestMeter, generateLearningPrompt } from "./learningPromptGenerator.js";
import type { LearningProviderResolution } from "./learningProviderResolver.js";
import type {
  LearningFeedbackRecord,
  LearningGenerationResult,
  LearningPathRecord,
  LearningSessionRecord
} from "./learningTypes.js";
import { emptyLearningGenerationMetrics } from "./learningTypes.js";
import {
  planNextLearningSession,
  type LearningAdaptationMode,
  type LearningSchedulerDecision
} from "./sessionLifecycle.js";

export type LearningSessionRepository = {
  getActiveLearningPathForUser(userId: string): Promise<LearningPathRecord | null>;
  listLearningSessions(pathId: string): Promise<LearningSessionRecord[]>;
  listLearningFeedback(pathId: string): Promise<LearningFeedbackRecord[]>;
  insertLearningSessionClaim(input: {
    pathId: string;
    dailyDropId: string;
    dropDate: string;
    curriculumStepKey: string;
    skippedStepKey: string | null;
    sessionNumber: number;
    repetitionIndex: number;
    adaptationMode: LearningAdaptationMode;
    language: string;
    inputHash: string;
  }): Promise<{ claimed: boolean; sessionId: string; exhausted?: boolean }>;
  markLearningSessionReady(input: {
    sessionId: string;
    dailyDropId: string;
    modelName: string;
    promptVersion: string;
    prompt: Awaited<ReturnType<typeof generateLearningPrompt>>["prompt"];
  }): Promise<void>;
  markLearningSessionFailed(input: { sessionId: string; error: string }): Promise<void>;
  markLearningPathCompleted(input: { pathId: string }): Promise<void>;
  attachLearningSessionToDailyDrop(input: { sessionId: string; dailyDropId: string }): Promise<void>;
};

export async function generateLearningSessionForUser(input: {
  repository: LearningSessionRepository;
  userId: string;
  dailyDropId: string;
  dropDate: string;
  providerResolution: LearningProviderResolution;
}): Promise<LearningGenerationResult> {
  const result: LearningGenerationResult = {
    ...emptyLearningGenerationMetrics(),
    status: "no_path",
    reason: "no_path",
    sessionId: null
  };
  const path = await input.repository.getActiveLearningPathForUser(input.userId);

  if (!path) {
    result.learning_paths_disabled = 1;
    return result;
  }

  result.learning_paths_considered = 1;
  const [sessions, feedbackRows] = await Promise.all([
    input.repository.listLearningSessions(path.id),
    input.repository.listLearningFeedback(path.id)
  ]);
  const orderedReadySessions = sessions
    .filter((session) => session.generation_status === "ready")
    .sort((left, right) => left.session_number - right.session_number);
  const latestReadySession = orderedReadySessions.at(-1) ?? null;
  const feedbackBySessionId = new Map(
    feedbackRows.map((feedback) => [
      feedback.session_id,
      {
        comprehensionRating: feedback.comprehension_rating,
        explainabilityRating: feedback.explainability_rating,
        interestRating: feedback.interest_rating,
        difficultyRating: feedback.difficulty_rating
      }
    ])
  );
  const decision = planNextLearningSession({
    activePathId: path.id,
    sessions: orderedReadySessions.map((session) => ({
      id: session.id,
      sequenceNumber: session.session_number,
      status: session.status,
      openedAt: session.opened_at,
      startedAt: session.started_at,
      completedAt: session.completed_at,
      adaptationMode: session.adaptation_mode,
      curriculumStepKey: session.curriculum_step_key
    })),
    feedbackBySessionId
  });

  if (decision.action === "skip") {
    if (decision.reason === "blocked_by_available_session") result.learning_sessions_blocked_available = 1;
    if (decision.reason === "blocked_by_opened_session") result.learning_sessions_blocked_opened = 1;
    if (
      latestReadySession &&
      (decision.reason === "blocked_by_available_session" || decision.reason === "blocked_by_opened_session")
    ) {
      await input.repository.attachLearningSessionToDailyDrop({
        sessionId: latestReadySession.id,
        dailyDropId: input.dailyDropId
      });
      result.learning_sessions_carried_forward = 1;
    }
    return { ...result, status: "blocked", reason: decision.reason, sessionId: latestReadySession?.id ?? null };
  }

  return createNextSession({ ...input, path, sessions: orderedReadySessions, feedbackRows, decision });
}

async function createNextSession(input: {
  repository: LearningSessionRepository;
  userId: string;
  dailyDropId: string;
  dropDate: string;
  providerResolution: LearningProviderResolution;
  path: LearningPathRecord;
  sessions: LearningSessionRecord[];
  feedbackRows: LearningFeedbackRecord[];
  decision: Extract<LearningSchedulerDecision, { action: "create" }>;
}): Promise<LearningGenerationResult> {
  const result: LearningGenerationResult = {
    ...emptyLearningGenerationMetrics(),
    learning_paths_considered: 1,
    status: "failed",
    reason: "unknown",
    sessionId: null
  };
  const catalog = await loadLearningCatalog();
  const orderedSessions = [...input.sessions].sort((left, right) => left.session_number - right.session_number);
  const usedStepKeys = new Map<string, number>();
  for (const session of orderedSessions) {
    usedStepKeys.set(session.curriculum_step_key, (usedStepKeys.get(session.curriculum_step_key) ?? 0) + 1);
    if (session.skipped_step_key) {
      usedStepKeys.set(session.skipped_step_key, (usedStepKeys.get(session.skipped_step_key) ?? 0) + 1);
    }
  }

  const selection = pickNextLearningStep({
    catalog,
    domainId: input.path.domain_id,
    objectiveId: input.path.objective_id,
    currentLevel: input.path.current_level,
    targetLevel: input.path.target_level,
    usedStepKeys,
    adaptationMode: input.decision.adaptationMode,
    lastStepKey: orderedSessions.at(-1)?.curriculum_step_key ?? null
  });

  // Every step up to the target level has been delivered: close the path and
  // stop here, so no further generation attempt is ever made for this user.
  if (selection.status === "completed") {
    await input.repository.markLearningPathCompleted({ pathId: input.path.id });
    result.learning_paths_completed = 1;
    return { ...result, status: "completed", reason: "target_level_reached" };
  }

  if (input.providerResolution.status === "unavailable") {
    result.learning_sessions_failed = 1;
    return {
      ...result,
      status: "failed",
      reason: "learning_provider_unavailable",
      sessionId: null
    };
  }

  const step = selection.step;
  const inputHash = sha256(JSON.stringify({
    path: {
      domain_id: input.path.domain_id,
      objective_id: input.path.objective_id,
      current_level: input.path.current_level,
      target_level: input.path.target_level,
      language: input.path.language
    },
    step: step.key,
    skipped_step_key: selection.skippedStepKey,
    session_number: input.decision.nextSequenceNumber,
    repetition_index: selection.repetitionIndex,
    adaptation_mode: input.decision.adaptationMode
  }));
  const claim = await input.repository.insertLearningSessionClaim({
    pathId: input.path.id,
    dailyDropId: input.dailyDropId,
    dropDate: input.dropDate,
    curriculumStepKey: step.key,
    skippedStepKey: selection.skippedStepKey,
    sessionNumber: input.decision.nextSequenceNumber,
    repetitionIndex: selection.repetitionIndex,
    adaptationMode: input.decision.adaptationMode,
    language: input.path.language,
    inputHash
  });

  result.sessionId = claim.sessionId;
  if (!claim.claimed) {
    result.learning_sessions_reused = 1;
    return {
      ...result,
      status: "reused",
      reason: claim.exhausted ? "generation_attempts_exhausted" : "session_already_claimed"
    };
  }

  result.learning_sessions_generation_claimed = 1;

  // The meter counts real HTTP requests, so a failure still reports what it cost.
  const meter = createLearningRequestMeter();

  try {
    const generated = await generateLearningPrompt({
      provider: input.providerResolution.provider,
      path: input.path,
      step,
      adaptationMode: input.decision.adaptationMode,
      repetitionIndex: selection.repetitionIndex,
      sessions: orderedSessions,
      feedbackRows: input.feedbackRows,
      sessionNumber: input.decision.nextSequenceNumber,
      meter
    });
    result.learning_api_calls = meter.httpRequests;
    await input.repository.markLearningSessionReady({
      sessionId: claim.sessionId,
      dailyDropId: input.dailyDropId,
      modelName: generated.modelName,
      promptVersion: "learning_v2",
      prompt: generated.prompt
    });
    result.learning_sessions_generated = 1;
    return { ...result, status: "generated", reason: "session_generated" };
  } catch (error) {
    result.learning_api_calls = meter.httpRequests;
    result.learning_sessions_failed = 1;
    await input.repository.markLearningSessionFailed({
      sessionId: claim.sessionId,
      error: error instanceof Error ? error.message : String(error)
    });
    return { ...result, status: "failed", reason: "generation_failed" };
  }
}
