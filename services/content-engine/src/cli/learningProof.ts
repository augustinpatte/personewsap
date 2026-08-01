import {
  loadLearningCatalog,
  pickNextLearningStep,
  resolveLearningMaxStage,
  resolveLearningStartStage
} from "../learning/catalogLoader.js";
import { generateLearningSessionForUser } from "../learning/learningSessionOrchestrator.js";
import {
  CountingLearningPromptProvider,
  fakeLearningPromptResponse,
  InMemoryLearningRepository
} from "../learning/learningTestDoubles.js";
import type { LearningPathRecord } from "../learning/learningTypes.js";

const BASE_PATH: LearningPathRecord = {
  id: "path-1",
  user_id: "user-1",
  domain_id: "computer_science",
  objective_id: "cs_systems",
  current_level: 2,
  target_level: 4,
  language: "en"
};

export async function runLearningProof(_options: Record<string, never> = {}): Promise<Record<string, unknown>> {
  if (process.env.CONFIRM_LEARNING_LLM_PROOF === "true") {
    throw new Error("Live LLM proof is intentionally not implemented in the smoke proof. Run daily-job with USE_LLM=true after a production dry-run.");
  }

  return {
    lifecycle: await proveLifecycle(),
    api_budget: await proveApiBudget(),
    stale_lock: await proveStaleLockRecovery(),
    levels: await proveLevels()
  };
}

export function parseLearningProofOptions(): Record<string, never> {
  return {};
}

async function proveLifecycle() {
  const repository = new InMemoryLearningRepository({ ...BASE_PATH });
  const first = await generate(repository, "drop-1");
  const availableBlocks = await generate(repository, "drop-2");

  repository.sessions[0].status = "opened";
  repository.sessions[0].opened_at = "2026-07-31T09:00:00Z";
  const openedBlocks = await generate(repository, "drop-3");

  repository.sessions[0].status = "started";
  repository.sessions[0].started_at = "2026-07-31T09:01:00Z";
  const second = await generate(repository, "drop-4");
  const rerun = await generate(repository, "drop-4");
  const sessionsAfterRerun = repository.sessions.length;

  repository.sessions[1].status = "completed";
  repository.sessions[1].completed_at = "2026-08-05T09:04:00Z";
  repository.feedback.push({
    session_id: repository.sessions[1].id,
    comprehension_rating: 2,
    explainability_rating: 4,
    interest_rating: 4,
    difficulty_rating: 3
  });
  const reinforced = await generate(repository, "drop-5");

  repository.sessions[2].status = "completed";
  repository.sessions[2].completed_at = "2026-08-07T09:04:00Z";
  repository.feedback.push({
    session_id: repository.sessions[2].id,
    comprehension_rating: 2,
    explainability_rating: 2,
    interest_rating: 4,
    difficulty_rating: 5
  });
  const prerequisite = await generate(repository, "drop-6");

  return {
    session_1_generated: first.status === "generated",
    deterministic_api_calls: first.learning_api_calls === 0,
    session_available_blocks_next_generation: availableBlocks.learning_api_calls === 0 && availableBlocks.status === "blocked",
    session_opened_blocks_next_generation: openedBlocks.learning_api_calls === 0 && openedBlocks.status === "blocked",
    session_started_unlocks_session_2: second.status === "generated",
    rerun_creates_no_duplicate: rerun.learning_api_calls === 0 && sessionsAfterRerun === 2,
    weak_feedback_reinforces_same_concept:
      repository.sessions[2].adaptation_mode === "reinforce" &&
      repository.sessions[2].curriculum_step_key === repository.sessions[1].curriculum_step_key &&
      repository.sessions[2].repetition_index === 1,
    weak_after_reinforce_falls_back_to_prerequisite:
      repository.sessions[3].adaptation_mode === "prerequisite" &&
      repository.sessions[3].curriculum_step_key !== repository.sessions[2].curriculum_step_key,
    statuses: [first, availableBlocks, openedBlocks, second, rerun, reinforced, prerequisite].map(
      (result) => `${result.status}:${result.learning_api_calls}`
    )
  };
}

async function proveApiBudget() {
  const repository = new InMemoryLearningRepository({ ...BASE_PATH });
  const provider = new CountingLearningPromptProvider({
    model: "gpt-fake-primary",
    fallbackModel: "gpt-fake-fallback",
    disableFallback: true,
    buildPrompt: fakeLearningPromptResponse
  });
  const generated = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-1",
    dropDate: "2026-07-31",
    provider
  });

  const failingRepository = new InMemoryLearningRepository({ ...BASE_PATH });
  const failingProvider = new CountingLearningPromptProvider({
    model: "gpt-fake-primary",
    fallbackModel: "gpt-fake-fallback",
    disableFallback: true,
    failWith: new Error("simulated OpenAI outage")
  });
  const failed = await generateLearningSessionForUser({
    repository: failingRepository,
    userId: "user-1",
    dailyDropId: "drop-1",
    dropDate: "2026-07-31",
    provider: failingProvider
  });

  return {
    real_provider_http_requests: provider.httpRequests,
    real_provider_single_request: provider.httpRequests === 1 && generated.learning_api_calls === 1,
    model_name_recorded: failingRepository.sessions.length === 1 && repository.sessions[0].model_name === "gpt-fake-primary",
    error_costs_one_request_not_two: failingProvider.httpRequests === 1 && failed.learning_api_calls === 1,
    error_marks_session_failed:
      failed.status === "failed" && failingRepository.sessions[0].generation_status === "failed",
    models_requested: provider.requestedModels
  };
}

async function proveStaleLockRecovery() {
  const repository = new InMemoryLearningRepository({ ...BASE_PATH });
  let clock = Date.parse("2026-08-01T08:00:00.000Z");
  repository.now = () => clock;

  // Worker A reserves the session and dies before finishing.
  const workerA = await repository.insertLearningSessionClaim({
    pathId: BASE_PATH.id,
    dailyDropId: "drop-1",
    curriculumStepKey: "computer_science.machine_layers",
    sessionNumber: 1,
    repetitionIndex: 0,
    adaptationMode: "normal",
    language: "en",
    inputHash: "hash-a"
  });

  const freshLockAttempt = await repository.insertLearningSessionClaim({
    pathId: BASE_PATH.id,
    dailyDropId: "drop-2",
    curriculumStepKey: "computer_science.machine_layers",
    sessionNumber: 1,
    repetitionIndex: 0,
    adaptationMode: "normal",
    language: "en",
    inputHash: "hash-b"
  });

  // The lock becomes older than LEARNING_GENERATION_LOCK_TIMEOUT_MINUTES.
  clock += 16 * 60_000;
  const [workerB, workerC] = await Promise.all([
    repository.insertLearningSessionClaim({
      pathId: BASE_PATH.id,
      dailyDropId: "drop-3",
      curriculumStepKey: "computer_science.machine_layers",
      sessionNumber: 1,
      repetitionIndex: 0,
      adaptationMode: "normal",
      language: "en",
      inputHash: "hash-c"
    }),
    repository.insertLearningSessionClaim({
      pathId: BASE_PATH.id,
      dailyDropId: "drop-4",
      curriculumStepKey: "computer_science.machine_layers",
      sessionNumber: 1,
      repetitionIndex: 0,
      adaptationMode: "normal",
      language: "en",
      inputHash: "hash-d"
    })
  ]);

  return {
    worker_a_claimed: workerA.claimed,
    fresh_lock_is_not_stolen: freshLockAttempt.claimed === false,
    exactly_one_worker_recovers_stale_lock: [workerB, workerC].filter((claim) => claim.claimed).length === 1,
    generation_attempts_incremented: repository.sessions[0].generation_attempts === 2,
    sessions_created: repository.sessions.length
  };
}

async function proveLevels() {
  const catalog = await loadLearningCatalog();
  const beginner = walkPath(catalog, { ...BASE_PATH, current_level: 1, target_level: 1 });
  const advanced = walkPath(catalog, { ...BASE_PATH, current_level: 6, target_level: 5 });
  const mid = walkPath(catalog, { ...BASE_PATH, current_level: 3, target_level: 3 });

  return {
    start_stage_by_current_level: [1, 2, 3, 4, 5, 6, 7].map(resolveLearningStartStage),
    max_stage_by_target_level: [1, 2, 3, 4, 5].map(resolveLearningMaxStage),
    beginner_starts_at_stage_1: beginner.stages[0] === 1,
    beginner_never_exceeds_target: Math.max(...beginner.stages) === 1,
    advanced_starts_at_stage_5: advanced.stages[0] === 5,
    mid_starts_at_stage_2_and_stops_at_3: mid.stages[0] === 2 && Math.max(...mid.stages) === 3,
    beginner_steps: beginner.stages.length,
    mid_steps: mid.stages.length,
    advanced_steps: advanced.stages.length,
    paths_complete: beginner.completed && mid.completed && advanced.completed
  };
}

function walkPath(catalog: Awaited<ReturnType<typeof loadLearningCatalog>>, path: LearningPathRecord) {
  const usedStepKeys = new Map<string, number>();
  const stages: number[] = [];
  let lastStepKey: string | null = null;

  for (let index = 0; index < 200; index += 1) {
    const selection = pickNextLearningStep({
      catalog,
      domainId: path.domain_id,
      objectiveId: path.objective_id,
      currentLevel: path.current_level,
      targetLevel: path.target_level,
      usedStepKeys,
      adaptationMode: "normal",
      lastStepKey
    });

    if (selection.status === "completed") {
      return { stages, completed: true };
    }

    stages.push(selection.step.stage);
    usedStepKeys.set(selection.step.key, (usedStepKeys.get(selection.step.key) ?? 0) + 1);
    lastStepKey = selection.step.key;
  }

  return { stages, completed: false };
}

async function generate(repository: InMemoryLearningRepository, dailyDropId: string) {
  return generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId,
    dropDate: "2026-07-31",
    provider: "deterministic"
  });
}
