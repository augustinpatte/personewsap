import { generateLearningSessionForUser, type LearningSessionRepository } from "../learning/learningSessionOrchestrator.js";
import type { LearningFeedbackRecord, LearningPathRecord, LearningSessionRecord } from "../learning/learningTypes.js";

export async function runLearningProof(_options: Record<string, never> = {}): Promise<Record<string, unknown>> {
  if (process.env.CONFIRM_LEARNING_LLM_PROOF === "true") {
    throw new Error("Live LLM proof is intentionally not implemented in the smoke proof. Run daily-job with USE_LLM=true after a production dry-run.");
  }

  const repository = new InMemoryLearningRepository();
  const first = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-1",
    dropDate: "2026-07-31",
    provider: "deterministic"
  });
  const availableBlocks = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-2",
    dropDate: "2026-08-02",
    provider: "deterministic"
  });
  repository.sessions[0].status = "opened";
  repository.sessions[0].opened_at = "2026-07-31T09:00:00Z";
  const openedBlocks = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-3",
    dropDate: "2026-08-03",
    provider: "deterministic"
  });
  repository.sessions[0].status = "started";
  repository.sessions[0].started_at = "2026-07-31T09:01:00Z";
  const second = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-4",
    dropDate: "2026-08-05",
    provider: "deterministic"
  });
  const rerun = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-4",
    dropDate: "2026-08-05",
    provider: "deterministic"
  });
  repository.sessions[1].status = "completed";
  repository.sessions[1].completed_at = "2026-08-05T09:04:00Z";
  repository.feedback.push({
    session_id: repository.sessions[1].id,
    comprehension_rating: 2,
    explainability_rating: 4,
    interest_rating: 4,
    difficulty_rating: 3
  });
  const adapted = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-5",
    dropDate: "2026-08-07",
    provider: "deterministic"
  });

  return {
    path_created: Boolean(repository.path),
    session_1_generated: first.status === "generated",
    api_calls_after_session_1: first.learning_api_calls,
    session_available_blocks_next_generation: availableBlocks.learning_api_calls === 0,
    session_opened_blocks_next_generation: openedBlocks.learning_api_calls === 0,
    session_started_unlocks_session_2: second.status === "generated",
    api_calls_total_after_session_2: first.learning_api_calls + second.learning_api_calls,
    feedback_absent_gives_normal: repository.sessions[1].adaptation_mode === "normal",
    feedback_present_changes_adaptation: repository.sessions[2].adaptation_mode === "reinforce",
    rerun_creates_no_duplicate: rerun.learning_api_calls === 0 && repository.sessions.length === 3,
    results: { first, availableBlocks, openedBlocks, second, rerun, adapted }
  };
}

export function parseLearningProofOptions(): Record<string, never> {
  return {};
}

class InMemoryLearningRepository implements LearningSessionRepository {
  path: LearningPathRecord = {
    id: "path-1",
    user_id: "user-1",
    domain_id: "computer_science",
    objective_id: "cs_systems",
    current_level: 2,
    target_level: 4,
    language: "en"
  };
  sessions: LearningSessionRecord[] = [];
  feedback: LearningFeedbackRecord[] = [];

  async getActiveLearningPathForUser(userId: string): Promise<LearningPathRecord | null> {
    return userId === this.path.user_id ? this.path : null;
  }

  async listLearningSessions(): Promise<LearningSessionRecord[]> {
    return this.sessions;
  }

  async listLearningFeedback(): Promise<LearningFeedbackRecord[]> {
    return this.feedback;
  }

  async insertLearningSessionClaim(input: Parameters<LearningSessionRepository["insertLearningSessionClaim"]>[0]) {
    const existing = this.sessions.find(
      (session) => session.path_id === input.pathId && session.session_number === input.sessionNumber
    );
    if (existing) {
      return { claimed: false, sessionId: existing.id };
    }
    const session: LearningSessionRecord = {
      id: `session-${input.sessionNumber}`,
      path_id: input.pathId,
      curriculum_step_key: input.curriculumStepKey,
      session_number: input.sessionNumber,
      adaptation_mode: input.adaptationMode,
      generation_status: "generating",
      status: "available",
      opened_at: null,
      started_at: null,
      completed_at: null
    };
    this.sessions.push(session);
    return { claimed: true, sessionId: session.id };
  }

  async markLearningSessionReady(input: Parameters<LearningSessionRepository["markLearningSessionReady"]>[0]) {
    const session = this.sessions.find((candidate) => candidate.id === input.sessionId);
    if (session) {
      session.generation_status = "ready";
    }
  }

  async markLearningSessionFailed(input: Parameters<LearningSessionRepository["markLearningSessionFailed"]>[0]) {
    const session = this.sessions.find((candidate) => candidate.id === input.sessionId);
    if (session) {
      session.generation_status = "failed";
    }
  }
}
