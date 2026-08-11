import type { OpenAiRequestAttempt } from "../generation/openAiProvider.js";
import type { LlmJsonRequest } from "../generation/llmProvider.js";
import { isReclaimableLearningSession } from "./generationLock.js";
import type { LearningPromptProvider } from "./learningPromptGenerator.js";
import type { LearningSessionRepository } from "./learningSessionOrchestrator.js";
import type {
  LearningFeedbackRecord,
  LearningPathRecord,
  LearningSessionRecord
} from "./learningTypes.js";
import type { LearningAdaptationMode } from "./sessionLifecycle.js";
import type { TeachingPlanV2 } from "./learningTeachingPlanSchemaV2.js";

/**
 * A provider that counts the HTTP requests it would really send. It mimics the
 * OpenAI provider contract, including the optional fallback model, so a test can
 * prove that learning generation never issues a second request.
 */
export class CountingLearningPromptProvider implements LearningPromptProvider {
  readonly name = "fake-openai";
  httpRequests = 0;
  readonly requestedModels: string[] = [];

  private readonly observers = new Set<(attempt: OpenAiRequestAttempt) => void>();
  private readonly models: string[];
  private readonly failWith: Error | null;
  private readonly buildPrompt: (request: LlmJsonRequest) => unknown;

  constructor(options: {
    model?: string;
    fallbackModel?: string;
    disableFallback?: boolean;
    failWith?: Error | null;
    buildPrompt?: (request: LlmJsonRequest) => unknown;
  } = {}) {
    const primary = options.model ?? "fake-model-primary";
    const fallback = options.disableFallback ? undefined : options.fallbackModel;
    this.models = [primary, ...(fallback ? [fallback] : [])];
    this.failWith = options.failWith ?? null;
    this.buildPrompt = options.buildPrompt ?? ((request) => JSON.parse(request.userPrompt).__echo);
  }

  observeRequestAttempts(observer: (attempt: OpenAiRequestAttempt) => void): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    let lastError: Error | null = null;
    let attempt = 0;

    for (const model of this.models) {
      attempt += 1;
      this.httpRequests += 1;
      this.requestedModels.push(model);
      for (const observer of this.observers) {
        observer({ provider: this.name, model, attempt, schemaName: request.schemaName ?? "personewsap_learning_prompt" });
      }

      if (this.failWith) {
        lastError = this.failWith;
        continue;
      }

      return this.buildPrompt(request);
    }

    throw lastError ?? new Error("fake provider exhausted its models");
  }
}

/** Builds a valid V2 teaching-plan payload for the fake provider. */
export function fakeLearningPromptResponse(request: LlmJsonRequest): TeachingPlanV2 {
  const payload = JSON.parse(request.userPrompt) as {
    context: {
      language: "fr" | "en";
      session: {
        curriculum_step: { key: string; title: string };
        adaptation_mode: LearningAdaptationMode;
        selected_example_context: string;
      };
    };
  };
  const language = payload.context.language;
  const step = payload.context.session.curriculum_step;
  const context = payload.context.session.selected_example_context;

  return {
    curriculum_step_key: step.key,
    adaptation_mode: payload.context.session.adaptation_mode,
    teaching_angle:
      language === "fr"
        ? `Expliquer ${step.title} par un mécanisme concret.`
        : `Explain ${step.title} through a concrete mechanism.`,
    hook: language === "fr" ? `Commence avec ${context}.` : `Start with ${context}.`,
    core_points:
      language === "fr"
        ? ["Isoler le mécanisme.", "Relier l'exemple au concept."]
        : ["Isolate the mechanism.", "Connect the example to the concept."],
    example: context,
    first_check_goal:
      language === "fr" ? "Faire reformuler le mécanisme." : "Have the learner restate the mechanism.",
    application_goal:
      language === "fr" ? "Appliquer le concept à une situation proche." : "Apply the concept to a nearby situation.",
    transfer_goal:
      language === "fr" ? "Prédire ce qui change dans un autre contexte." : "Predict what changes in another context.",
    common_misconception:
      language === "fr" ? "Confondre vocabulaire et mécanisme." : "Confusing vocabulary with mechanism.",
    recap_target:
      language === "fr" ? "le mécanisme à retenir" : "the mechanism to remember"
  };
}

type StoredLearningSession = LearningSessionRecord & {
  generation_attempts: number;
  generation_locked_at: string | null;
  model_name: string | null;
  input_hash: string | null;
};

/**
 * In-memory repository reproducing the Supabase claim semantics: unique
 * (path_id, session_number), stale-lock takeover and compare-and-set guards.
 */
export class InMemoryLearningRepository implements LearningSessionRepository {
  sessions: StoredLearningSession[] = [];
  feedback: LearningFeedbackRecord[] = [];
  maxAttempts = 3;
  lockTimeoutMinutes = 15;
  now = () => Date.now();

  constructor(public path: LearningPathRecord) {}

  async getActiveLearningPathForUser(userId: string): Promise<LearningPathRecord | null> {
    return userId === this.path.user_id && this.pathStatus === "active" ? this.path : null;
  }

  pathStatus: "active" | "completed" = "active";

  async listLearningSessions(): Promise<LearningSessionRecord[]> {
    return this.sessions;
  }

  async listLearningFeedback(): Promise<LearningFeedbackRecord[]> {
    return this.feedback;
  }

  async insertLearningSessionClaim(
    input: Parameters<LearningSessionRepository["insertLearningSessionClaim"]>[0]
  ): Promise<{ claimed: boolean; sessionId: string; exhausted?: boolean }> {
    const existing = this.sessions.find(
      (session) => session.path_id === input.pathId && session.session_number === input.sessionNumber
    );

    if (!existing) {
      const session: StoredLearningSession = {
        id: `session-${input.sessionNumber}`,
        path_id: input.pathId,
        daily_drop_id: input.dailyDropId,
        curriculum_step_key: input.curriculumStepKey,
        skipped_step_key: input.skippedStepKey,
        session_number: input.sessionNumber,
        repetition_index: input.repetitionIndex,
        adaptation_mode: input.adaptationMode,
        language: input.language === "fr" ? "fr" : "en",
        generation_status: "generating",
        generation_attempts: 1,
        generation_locked_at: new Date(this.now()).toISOString(),
        model_name: null,
        input_hash: input.inputHash,
        status: "available",
        available_on: input.dropDate,
        opened_at: null,
        started_at: null,
        completed_at: null
      };
      this.sessions.push(session);
      return { claimed: true, sessionId: session.id };
    }

    // Snapshot read, exactly like the Supabase implementation.
    const snapshot = {
      generation_status: existing.generation_status,
      generation_attempts: existing.generation_attempts,
      generation_locked_at: existing.generation_locked_at
    };

    if (
      !isReclaimableLearningSession(snapshot, {
        nowMs: this.now(),
        lockTimeoutMinutes: this.lockTimeoutMinutes
      })
    ) {
      return { claimed: false, sessionId: existing.id };
    }

    const nextAttempt = snapshot.generation_attempts + 1;
    if (nextAttempt > this.maxAttempts) {
      return { claimed: false, sessionId: existing.id, exhausted: true };
    }

    if (existing.input_hash && existing.input_hash !== input.inputHash) {
      return { claimed: false, sessionId: existing.id };
    }

    // Conditional update: another worker that already moved the row wins.
    if (
      existing.generation_status !== snapshot.generation_status ||
      existing.generation_attempts !== snapshot.generation_attempts ||
      existing.generation_locked_at !== snapshot.generation_locked_at
    ) {
      return { claimed: false, sessionId: existing.id };
    }

    existing.curriculum_step_key = input.curriculumStepKey;
    existing.skipped_step_key = input.skippedStepKey;
    existing.daily_drop_id = input.dailyDropId;
    existing.repetition_index = input.repetitionIndex;
    existing.adaptation_mode = input.adaptationMode;
    existing.generation_status = "generating";
    existing.generation_attempts = nextAttempt;
    existing.generation_locked_at = new Date(this.now()).toISOString();
    existing.input_hash = input.inputHash;
    return { claimed: true, sessionId: existing.id };
  }

  async markLearningSessionReady(
    input: Parameters<LearningSessionRepository["markLearningSessionReady"]>[0]
  ): Promise<void> {
    const session = this.sessions.find((candidate) => candidate.id === input.sessionId);
    if (session) {
      session.generation_status = "ready";
      session.model_name = input.modelName;
      session.generation_locked_at = null;
      session.curriculum_step_key = input.prompt.curriculum_step_key;
      session.adaptation_mode = input.prompt.adaptation_mode;
      session.daily_drop_id = input.dailyDropId;
    }
  }

  async markLearningSessionFailed(
    input: Parameters<LearningSessionRepository["markLearningSessionFailed"]>[0]
  ): Promise<void> {
    const session = this.sessions.find((candidate) => candidate.id === input.sessionId);
    if (session) {
      session.generation_status = "failed";
      session.generation_locked_at = null;
    }
  }

  async markLearningPathCompleted(): Promise<void> {
    this.pathStatus = "completed";
  }

  async attachLearningSessionToDailyDrop(
    input: Parameters<LearningSessionRepository["attachLearningSessionToDailyDrop"]>[0]
  ): Promise<void> {
    const session = this.sessions.find((candidate) => candidate.id === input.sessionId);
    if (session) {
      session.daily_drop_id = input.dailyDropId;
    }
  }
}
