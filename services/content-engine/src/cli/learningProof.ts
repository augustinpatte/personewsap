import type { LlmJsonRequest } from "../generation/llmProvider.js";
import {
  InvalidLearningLevelRangeError,
  loadLearningCatalog,
  pickNextLearningStep,
  resolveLearningMaxStage,
  resolveLearningStartStage
} from "../learning/catalogLoader.js";
import { resolveLearningProvider } from "../learning/learningProviderResolver.js";
import { generateLearningSessionForUser } from "../learning/learningSessionOrchestrator.js";
import {
  CountingLearningPromptProvider,
  fakeLearningPromptResponse,
  InMemoryLearningRepository
} from "../learning/learningTestDoubles.js";
import type { LearningCatalogStep, LearningPathRecord } from "../learning/learningTypes.js";

const BASE_PATH: LearningPathRecord = {
  id: "path-1",
  user_id: "user-1",
  domain_id: "computer_science",
  objective_id: "cs_systems",
  current_level: 2,
  target_level: 4,
  language: "en"
};

type ProofSection = Record<string, unknown>;

export async function runLearningProof(_options: Record<string, never> = {}): Promise<Record<string, unknown>> {
  if (process.env.CONFIRM_LEARNING_LLM_PROOF === "true") {
    throw new Error("Live LLM proof is intentionally disabled here. This proof must not call OpenAI.");
  }

  const proof = {
    provider_isolation: await proveProviderIsolation(),
    privacy: await proveFeedbackPrivacy(),
    api_budget: await proveApiBudget(),
    acceleration: await proveAcceleration(),
    carryover: await proveEditionCarryover(),
    lifecycle: await proveLifecycle(),
    stale_lock: await proveStaleLockRecovery(),
    levels: await proveLevels(),
    completion: await proveCompletion()
  };

  if (!allProofBooleansPass(proof)) {
    process.exitCode = 1;
  }

  return proof;
}

export function parseLearningProofOptions(): Record<string, never> {
  return {};
}

async function proveProviderIsolation(): Promise<ProofSection> {
  const unavailable = resolveLearningProvider({ useLlm: true, env: {} });
  const blockedRepository = new InMemoryLearningRepository({ ...BASE_PATH });
  const blocked = await generateLearningSessionForUser({
    repository: blockedRepository,
    userId: "user-1",
    dailyDropId: "drop-1",
    dropDate: "2026-08-01",
    providerResolution: unavailable
  });

  const readyRepository = new InMemoryLearningRepository({ ...BASE_PATH });
  const provider = fakeProvider();
  const generated = await generateLearningSessionForUser({
    repository: readyRepository,
    userId: "user-1",
    dailyDropId: "drop-1",
    dropDate: "2026-08-01",
    providerResolution: { status: "ready", provider }
  });

  return {
    unavailable_provider_does_not_claim_session:
      blocked.status === "failed" &&
      blocked.reason === "learning_provider_unavailable" &&
      blocked.learning_api_calls === 0 &&
      blockedRepository.sessions.length === 0,
    next_user_with_ready_provider_generates:
      generated.status === "generated" && provider.httpRequests === 1 && readyRepository.sessions.length === 1,
    failed_metric_is_recorded: blocked.learning_sessions_failed === 1
  };
}

async function proveFeedbackPrivacy(): Promise<ProofSection> {
  let capturedPrompt: unknown = null;
  const repository = new InMemoryLearningRepository({
    ...BASE_PATH,
    id: "7d9ab0a0-4f9e-4c88-9288-7540ee15bd59",
    user_id: "6e0d2262-ff92-4d7f-91a9-36b2a7499491"
  });
  repository.sessions.push(
    readySession({
      id: "3f4ce661-44af-412a-8c8c-6187a94a0b0f",
      sessionNumber: 1,
      stepKey: "computer_science.machine_layers",
      status: "completed",
      completedAt: "2026-07-30T09:00:00Z"
    }),
    readySession({
      id: "9bb1b803-d8a3-44a5-99f7-a20fd119f157",
      sessionNumber: 2,
      stepKey: "computer_science.binary_data",
      status: "completed",
      completedAt: "2026-07-31T09:00:00Z"
    })
  );
  repository.feedback.push(
    {
      session_id: "3f4ce661-44af-412a-8c8c-6187a94a0b0f",
      comprehension_rating: 1,
      explainability_rating: 1,
      interest_rating: 1,
      difficulty_rating: 5
    },
    {
      session_id: "9bb1b803-d8a3-44a5-99f7-a20fd119f157",
      comprehension_rating: 4,
      explainability_rating: 5,
      interest_rating: 3,
      difficulty_rating: 2
    }
  );

  const provider = fakeProvider((request) => {
    capturedPrompt = JSON.parse(request.userPrompt);
    return fakeLearningPromptResponse(request);
  });
  const result = await generateLearningSessionForUser({
    repository,
    userId: "6e0d2262-ff92-4d7f-91a9-36b2a7499491",
    dailyDropId: "74f7cdfa-f9f1-4e59-a101-700b2228aa3c",
    dropDate: "2026-08-01",
    providerResolution: { status: "ready", provider }
  });
  const serialized = JSON.stringify(capturedPrompt);

  return {
    generated_with_fake_provider: result.status === "generated",
    last_feedback_has_only_latest_ratings:
      isObject(capturedPrompt) &&
      JSON.stringify(capturedPrompt.context?.feedback_profile?.latest) ===
        JSON.stringify({
          comprehension: 4,
          explainability: 5,
          interest: 3,
          difficulty: 2
        }),
    recent_average_uses_pedagogical_feedback_order:
      isObject(capturedPrompt) &&
      JSON.stringify(capturedPrompt.context?.feedback_profile?.recent_average) ===
        JSON.stringify({
          comprehension: 2.5,
          explainability: 3,
          interest: 2,
          difficulty: 3.5
        }),
    no_supabase_identifiers_sent:
      !serialized.includes("session_id") &&
      !serialized.includes("path_id") &&
      !serialized.includes("daily_drop_id") &&
      !serialized.includes("user_id") &&
      !serialized.includes("6e0d2262-ff92-4d7f-91a9-36b2a7499491") &&
      !serialized.includes("7d9ab0a0-4f9e-4c88-9288-7540ee15bd59") &&
      !serialized.includes("74f7cdfa-f9f1-4e59-a101-700b2228aa3c"),
    captured_provider_json: capturedPrompt
  };
}

async function proveApiBudget(): Promise<ProofSection> {
  const repository = new InMemoryLearningRepository({ ...BASE_PATH });
  const provider = fakeProvider();
  const generated = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-1",
    dropDate: "2026-08-01",
    providerResolution: { status: "ready", provider }
  });

  const blockedProvider = fakeProvider();
  const blocked = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-2",
    dropDate: "2026-08-02",
    providerResolution: { status: "ready", provider: blockedProvider }
  });

  repository.sessions[0].status = "started";
  repository.sessions[0].started_at = "2026-08-01T09:01:00Z";
  const secondProvider = fakeProvider();
  const second = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-3",
    dropDate: "2026-08-03",
    providerResolution: { status: "ready", provider: secondProvider }
  });

  const failingRepository = new InMemoryLearningRepository({ ...BASE_PATH });
  const failingProvider = new CountingLearningPromptProvider({
    model: "gpt-fake-primary",
    disableFallback: true,
    failWith: new Error("simulated OpenAI outage")
  });
  const failed = await generateLearningSessionForUser({
    repository: failingRepository,
    userId: "user-1",
    dailyDropId: "drop-1",
    dropDate: "2026-08-01",
    providerResolution: { status: "ready", provider: failingProvider }
  });

  return {
    generated_single_http_request: provider.httpRequests === 1 && generated.learning_api_calls === 1,
    available_blocks_without_http: blocked.status === "blocked" && blockedProvider.httpRequests === 0,
    started_unlocks_with_single_http: second.status === "generated" && secondProvider.httpRequests === 1,
    failed_generation_costs_one_request:
      failed.status === "failed" && failed.learning_api_calls === 1 && failingProvider.httpRequests === 1,
    no_fallback_model_requested: failingProvider.requestedModels.length === 1,
    model_name_recorded: repository.sessions[0].model_name === "fake-model-primary"
  };
}

async function proveAcceleration(): Promise<ProofSection> {
  const catalog = accelerationCatalog();
  const first = pickNextLearningStep({
    catalog,
    domainId: "computer_science",
    objectiveId: "cs_systems",
    currentLevel: 1,
    targetLevel: 2,
    usedStepKeys: new Map([["cs.required.1", 1]]),
    adaptationMode: "accelerate",
    lastStepKey: "cs.required.1"
  });
  const used = new Map<string, number>();
  if (first.status === "selected") {
    used.set(first.step.key, 1);
    if (first.skippedStepKey) used.set(first.skippedStepKey, 1);
  }
  const second = pickNextLearningStep({
    catalog,
    domainId: "computer_science",
    objectiveId: "cs_systems",
    currentLevel: 1,
    targetLevel: 2,
    usedStepKeys: used,
    adaptationMode: "normal",
    lastStepKey: first.status === "selected" ? first.step.key : null
  });

  return {
    accelerated_session_records_one_skipped_step:
      first.status === "selected" && first.step.key === "cs.required.2" && first.skippedStepKey === "cs.optional.1",
    skipped_step_is_never_returned_later:
      second.status === "selected" ? second.step.key !== "cs.optional.1" : second.status === "completed",
    skipped_step_is_not_selected_step:
      first.status === "selected" && first.skippedStepKey !== null && first.skippedStepKey !== first.step.key
  };
}

async function proveEditionCarryover(): Promise<ProofSection> {
  const repository = new InMemoryLearningRepository({ ...BASE_PATH });
  const first = await generate(repository, "drop-1", "2026-08-01");
  const carried = await generate(repository, "drop-2", "2026-08-02");
  const availableDrop = repository.sessions[0]?.daily_drop_id;

  repository.sessions[0].status = "opened";
  repository.sessions[0].opened_at = "2026-08-02T09:00:00Z";
  const openedCarried = await generate(repository, "drop-3", "2026-08-03");

  return {
    initial_session_available_on_edition_date:
      first.status === "generated" && repository.sessions[0]?.available_on === "2026-08-01",
    available_session_attached_to_new_drop:
      carried.status === "blocked" &&
      carried.learning_sessions_carried_forward === 1 &&
      availableDrop === "drop-2" &&
      carried.learning_api_calls === 0,
    opened_session_attached_to_new_drop:
      openedCarried.status === "blocked" &&
      openedCarried.learning_sessions_carried_forward === 1 &&
      repository.sessions[0]?.daily_drop_id === "drop-3" &&
      openedCarried.learning_api_calls === 0,
    no_duplicate_sessions: repository.sessions.length === 1
  };
}

async function proveLifecycle(): Promise<ProofSection> {
  const repository = new InMemoryLearningRepository({ ...BASE_PATH });
  const first = await generate(repository, "drop-1", "2026-08-01");
  const availableBlocks = await generate(repository, "drop-2", "2026-08-02");

  repository.sessions[0].status = "opened";
  repository.sessions[0].opened_at = "2026-08-02T09:00:00Z";
  const openedBlocks = await generate(repository, "drop-3", "2026-08-03");

  repository.sessions[0].status = "started";
  repository.sessions[0].started_at = "2026-08-02T09:01:00Z";
  const second = await generate(repository, "drop-4", "2026-08-04");
  const secondMode = repository.sessions[1]?.adaptation_mode;

  repository.sessions[1].status = "completed";
  repository.sessions[1].completed_at = "2026-08-04T09:04:00Z";
  repository.feedback.push({
    session_id: repository.sessions[1].id,
    comprehension_rating: 2,
    explainability_rating: 4,
    interest_rating: 4,
    difficulty_rating: 3
  });
  const reinforced = await generate(repository, "drop-5", "2026-08-05");

  return {
    first_session_generated: first.status === "generated",
    available_blocks_next_generation: availableBlocks.status === "blocked" && availableBlocks.learning_api_calls === 0,
    opened_blocks_next_generation: openedBlocks.status === "blocked" && openedBlocks.learning_api_calls === 0,
    started_unlocks_without_feedback: second.status === "generated" && secondMode === "normal",
    completed_with_feedback_adapts:
      reinforced.status === "generated" && repository.sessions[2]?.adaptation_mode === "reinforce"
  };
}

async function proveStaleLockRecovery(): Promise<ProofSection> {
  const repository = new InMemoryLearningRepository({ ...BASE_PATH });
  let clock = Date.parse("2026-08-01T08:00:00.000Z");
  repository.now = () => clock;

  const workerA = await repository.insertLearningSessionClaim(baseClaim("drop-1", "2026-08-01", "hash-a"));
  const freshLockAttempt = await repository.insertLearningSessionClaim(baseClaim("drop-2", "2026-08-02", "hash-a"));

  clock += 16 * 60_000;
  const [workerB, workerC] = await Promise.all([
    repository.insertLearningSessionClaim(baseClaim("drop-3", "2026-08-03", "hash-a")),
    repository.insertLearningSessionClaim(baseClaim("drop-4", "2026-08-04", "hash-a"))
  ]);

  return {
    worker_a_claimed: workerA.claimed,
    fresh_lock_is_not_stolen: freshLockAttempt.claimed === false,
    exactly_one_worker_recovers_stale_lock: [workerB, workerC].filter((claim) => claim.claimed).length === 1,
    generation_attempts_incremented: repository.sessions[0]?.generation_attempts === 2,
    no_parallel_duplicate_session: repository.sessions.length === 1
  };
}

async function proveLevels(): Promise<ProofSection> {
  const catalog = await loadLearningCatalog();
  const beginner = walkPath(catalog, { ...BASE_PATH, current_level: 1, target_level: 1 });
  const advanced = walkPath(catalog, { ...BASE_PATH, current_level: 6, target_level: 5 });
  const mid = walkPath(catalog, { ...BASE_PATH, current_level: 3, target_level: 3 });
  let invalidRangeThrows = false;

  try {
    pickNextLearningStep({
      catalog,
      domainId: BASE_PATH.domain_id,
      objectiveId: BASE_PATH.objective_id,
      currentLevel: 6,
      targetLevel: 4,
      usedStepKeys: new Map(),
      adaptationMode: "normal",
      lastStepKey: null
    });
  } catch (error) {
    invalidRangeThrows = error instanceof InvalidLearningLevelRangeError;
  }

  return {
    start_stage_by_current_level: [1, 2, 3, 4, 5, 6, 7].map(resolveLearningStartStage),
    max_stage_by_target_level: [1, 2, 3, 4, 5].map(resolveLearningMaxStage),
    beginner_starts_at_stage_1: beginner.stages[0] === 1,
    beginner_never_exceeds_target: Math.max(...beginner.stages) === 1,
    advanced_starts_at_stage_5: advanced.stages[0] === 5,
    mid_starts_at_stage_2_and_stops_at_3: mid.stages[0] === 2 && Math.max(...mid.stages) === 3,
    invalid_target_below_current_stage_is_rejected: invalidRangeThrows,
    paths_complete: beginner.completed && mid.completed && advanced.completed
  };
}

async function proveCompletion(): Promise<ProofSection> {
  const repository = new InMemoryLearningRepository({ ...BASE_PATH, current_level: 6, target_level: 5 });
  let guard = 0;
  let last = await generate(repository, "drop-1", "2026-08-01");

  while (last.status === "generated" && guard < 30) {
    const session = repository.sessions.at(-1);
    if (!session) break;
    session.status = "started";
    session.started_at = "2026-08-01T09:00:00Z";
    last = await generate(repository, `drop-${guard + 2}`, `2026-08-${String(guard + 2).padStart(2, "0")}`);
    guard += 1;
  }

  const afterCompletionProvider = fakeProvider();
  const afterCompletion = await generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: "drop-after",
    dropDate: "2026-09-01",
    providerResolution: { status: "ready", provider: afterCompletionProvider }
  });

  return {
    path_marked_completed: repository.pathStatus === "completed",
    target_completion_does_not_call_provider: last.status === "completed" && last.learning_api_calls === 0,
    completed_path_has_no_active_generation:
      afterCompletion.status === "no_path" && afterCompletionProvider.httpRequests === 0
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
    if (selection.skippedStepKey) {
      usedStepKeys.set(selection.skippedStepKey, (usedStepKeys.get(selection.skippedStepKey) ?? 0) + 1);
    }
    lastStepKey = selection.step.key;
  }

  return { stages, completed: false };
}

async function generate(repository: InMemoryLearningRepository, dailyDropId: string, dropDate: string) {
  return generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId,
    dropDate,
    providerResolution: { status: "ready", provider: "deterministic" }
  });
}

function fakeProvider(buildPrompt?: (request: LlmJsonRequest) => unknown): CountingLearningPromptProvider {
  return new CountingLearningPromptProvider({
    model: "fake-model-primary",
    disableFallback: true,
    buildPrompt: buildPrompt ?? fakeLearningPromptResponse
  });
}

function readySession(input: {
  id: string;
  sessionNumber: number;
  stepKey: string;
  status: "available" | "opened" | "started" | "completed";
  completedAt?: string | null;
}) {
  return {
    id: input.id,
    path_id: BASE_PATH.id,
    daily_drop_id: `drop-${input.sessionNumber}`,
    curriculum_step_key: input.stepKey,
    skipped_step_key: null,
    session_number: input.sessionNumber,
    repetition_index: 0,
    adaptation_mode: "normal" as const,
    language: BASE_PATH.language,
    generation_status: "ready" as const,
    generation_attempts: 1,
    generation_locked_at: null,
    model_name: "fake-model-primary",
    input_hash: `hash-${input.sessionNumber}`,
    status: input.status,
    available_on: "2026-08-01",
    opened_at: input.status === "opened" ? "2026-08-01T09:00:00Z" : null,
    started_at:
      input.status === "started" || input.status === "completed" ? "2026-08-01T09:01:00Z" : null,
    completed_at: input.completedAt ?? null
  };
}

function baseClaim(dailyDropId: string, dropDate: string, inputHash: string) {
  return {
    pathId: BASE_PATH.id,
    dailyDropId,
    dropDate,
    curriculumStepKey: "computer_science.machine_layers",
    skippedStepKey: null,
    sessionNumber: 1,
    repetitionIndex: 0,
    adaptationMode: "normal" as const,
    language: "en",
    inputHash
  };
}

function accelerationCatalog(): LearningCatalogStep[] {
  return [
    catalogStep({ key: "cs.required.1", stage: 1, order: 1, title: "Required base", required: true }),
    catalogStep({
      key: "cs.optional.1",
      stage: 1,
      order: 2,
      title: "Optional",
      required: false,
      prerequisiteKeys: ["cs.required.1"]
    }),
    catalogStep({
      key: "cs.required.2",
      stage: 2,
      order: 3,
      title: "Next required",
      required: true,
      prerequisiteKeys: ["cs.required.1"]
    })
  ];
}

function catalogStep(input: {
  key: string;
  stage: number;
  order: number;
  title: string;
  required: boolean;
  prerequisiteKeys?: string[];
}): LearningCatalogStep {
  return {
    domain_id: "computer_science",
    objective_ids: ["cs_systems"],
    key: input.key,
    stage: input.stage,
    order: input.order,
    title_fr: input.title,
    title_en: input.title,
    summary_fr: `${input.title}.`,
    summary_en: `${input.title}.`,
    learning_goals_fr: ["Comprendre le concept."],
    learning_goals_en: ["Understand the concept."],
    tutor_focus_fr: "Expliquer simplement.",
    tutor_focus_en: "Explain simply.",
    example_contexts_fr: ["un ordinateur personnel"],
    example_contexts_en: ["a personal computer"],
    safety_category: "standard",
    required: input.required,
    prerequisite_keys: input.prerequisiteKeys ?? [],
    fallback_key: null
  };
}

function isObject(value: unknown): value is {
  context?: {
    feedback_profile?: {
      latest?: unknown;
      recent_average?: unknown;
    };
  };
} {
  return typeof value === "object" && value !== null;
}

function allProofBooleansPass(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.every(allProofBooleansPass);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).every(([key, nested]) => {
      if (key === "captured_provider_json") return true;
      return allProofBooleansPass(nested);
    });
  }
  return true;
}
