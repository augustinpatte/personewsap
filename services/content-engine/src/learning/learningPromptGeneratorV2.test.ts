import { describe, expect, it } from "vitest";

import { loadLearningCatalog } from "./catalogLoader.js";
import {
  DETERMINISTIC_LEARNING_MODEL,
  generateLearningPrompt,
  pickExampleContext
} from "./learningPromptGenerator.js";
import {
  CountingLearningPromptProvider,
  fakeLearningPromptResponse
} from "./learningTestDoubles.js";
import type {
  LearningCatalogStep,
  LearningFeedbackRecord,
  LearningPathRecord,
  LearningSessionRecord
} from "./learningTypes.js";
import type { LearningAdaptationMode } from "./sessionLifecycle.js";

describe("learning prompt generator v2", () => {
  it("sends compact FR and EN teaching-plan requests with current levels 1, 4 and 7", async () => {
    const step = await catalogStep();
    const cases = [
      { language: "fr" as const, currentLevel: 1 },
      { language: "en" as const, currentLevel: 4 },
      { language: "en" as const, currentLevel: 7 }
    ];

    for (const scenario of cases) {
      const captured = await captureProviderRequest({
        path: path({ language: scenario.language, current_level: scenario.currentLevel }),
        step,
        adaptationMode: "normal",
        sessions: [],
        feedbackRows: []
      });

      expect(captured.request.schemaName).toBe("personewsap_learning_teaching_plan_v2");
      expect(captured.request.maxOutputTokens).toBeLessThanOrEqual(1000);
      expect(captured.payload.context.language).toBe(scenario.language);
      expect(captured.payload.context.learner.current_level).toBe(scenario.currentLevel);
      expect(captured.payload.context.session.curriculum_step.key).toBe(step.key);
      expect(captured.payload.context.session.curriculum_step).not.toHaveProperty("title_fr");
      expect(captured.payload.context.session.curriculum_step).not.toHaveProperty("title_en");
      expect(captured.payload.context.session.curriculum_step).not.toHaveProperty("summary_fr");
      expect(captured.payload.context.session.curriculum_step).not.toHaveProperty("summary_en");
      expect(captured.payload.context.session.adaptation_mode).toBe("normal");
      expect(captured.result.prompt.title_en).toBe(step.title_en);
      expect(captured.result.prompt.summary_en).toBe(step.summary_en);
      expect(captured.result.prompt.objectives_en).toEqual(step.learning_goals_en.slice(0, 3));
    }
  });

  it("sends only the requested language content to the provider", async () => {
    const step = await catalogStep();
    const fr = await captureProviderRequest({
      path: path({ language: "fr" }),
      step,
      adaptationMode: "normal",
      sessions: [],
      feedbackRows: []
    });
    const en = await captureProviderRequest({
      path: path({ language: "en" }),
      step,
      adaptationMode: "normal",
      sessions: [],
      feedbackRows: []
    });

    expect(fr.payload.context.session.curriculum_step.title).toBe(step.title_fr);
    expect(fr.payload.context.session.curriculum_step.summary).toBe(step.summary_fr);
    expect(fr.payload.context.session.curriculum_step.learning_goals).toEqual(step.learning_goals_fr);
    expect(fr.payload.context.session.curriculum_step.tutor_focus).toBe(step.tutor_focus_fr);
    expect(JSON.stringify(fr.payload.context.session.curriculum_step)).not.toContain(step.title_en);

    expect(en.payload.context.session.curriculum_step.title).toBe(step.title_en);
    expect(en.payload.context.session.curriculum_step.summary).toBe(step.summary_en);
    expect(en.payload.context.session.curriculum_step.learning_goals).toEqual(step.learning_goals_en);
    expect(en.payload.context.session.curriculum_step.tutor_focus).toBe(step.tutor_focus_en);
    expect(JSON.stringify(en.payload.context.session.curriculum_step)).not.toContain(step.title_fr);
  });

  it.each<LearningAdaptationMode>(["normal", "reinforce", "prerequisite", "accelerate", "context_shift"])(
    "keeps adaptation mode %s imposed by backend",
    async (adaptationMode) => {
      const step = await catalogStep();
      const captured = await captureProviderRequest({
        path: path(),
        step,
        adaptationMode,
        sessions: [session({ id: "session-1", sessionNumber: 1, status: "completed", stepKey: step.key })],
        feedbackRows: [feedback("session-1", 4, 4, 4, 3)]
      });

      expect(captured.payload.context.session.adaptation_mode).toBe(adaptationMode);
      expect(captured.result.prompt.adaptation_mode).toBe(adaptationMode);
      expect(captured.result.prompt.curriculum_step_key).toBe(step.key);
    }
  );

  it("builds no-feedback, latest-feedback and recent-average profiles in pedagogical order", async () => {
    const step = await catalogStep();
    const noFeedback = await captureProviderRequest({
      path: path(),
      step,
      adaptationMode: "normal",
      sessions: [],
      feedbackRows: []
    });

    expect(noFeedback.payload.context.feedback_profile).toEqual({
      feedback_count: 0,
      latest: null,
      recent_average: null
    });

    const oneFeedback = await captureProviderRequest({
      path: path(),
      step,
      adaptationMode: "normal",
      sessions: [session({ id: "session-one", sessionNumber: 1, status: "completed", stepKey: "step-one" })],
      feedbackRows: [feedback("session-one", 2, 3, 4, 5)]
    });

    expect(oneFeedback.payload.context.feedback_profile).toMatchObject({
      feedback_count: 1,
      latest: { comprehension: 2, explainability: 3, interest: 4, difficulty: 5 },
      recent_average: { comprehension: 2, explainability: 3, interest: 4, difficulty: 5 }
    });

    const sessions = [
      session({ id: "session-1", sessionNumber: 1, status: "completed", stepKey: "step-1" }),
      session({ id: "session-2", sessionNumber: 2, status: "completed", stepKey: "step-2" }),
      session({ id: "session-3", sessionNumber: 3, status: "completed", stepKey: "step-3" }),
      session({ id: "session-4", sessionNumber: 4, status: "completed", stepKey: "step-4" })
    ];
    const feedbackRows = [
      feedback("session-4", 5, 5, 2, 1),
      feedback("session-1", 1, 1, 5, 5),
      feedback("session-3", 4, 3, 3, 2),
      feedback("session-2", 3, 2, 4, 3)
    ];
    const withFeedback = await captureProviderRequest({
      path: path(),
      step,
      adaptationMode: "reinforce",
      sessions,
      feedbackRows
    });

    expect(withFeedback.payload.context.feedback_profile.feedback_count).toBe(4);
    expect(withFeedback.payload.context.feedback_profile.latest).toEqual({
      comprehension: 5,
      explainability: 5,
      interest: 2,
      difficulty: 1
    });
    expect(withFeedback.payload.context.feedback_profile.recent_average).toEqual({
      comprehension: 4,
      explainability: 3.3,
      interest: 3,
      difficulty: 2
    });
  });

  it("uses a different authored example context for repeated concepts", async () => {
    const step = await catalogStep();
    expect(pickExampleContext(step, "en", 0)).not.toBe(pickExampleContext(step, "en", 1));
  });

  it("rejects invalid teaching plans, wrong curriculum steps and wrong adaptation modes", async () => {
    const step = await catalogStep();
    await expect(
      generateWithPlan(step, {
        curriculum_step_key: step.key,
        adaptation_mode: "normal",
        teaching_angle: "",
        hook: "hook",
        core_points: ["one"],
        example: "example",
        first_check_goal: "check",
        application_goal: "apply",
        transfer_goal: "transfer",
        common_misconception: "misconception",
        recap_target: "recap"
      })
    ).rejects.toThrow(/Invalid learning teaching plan output/);

    await expect(
      generateWithPlan(step, {
        ...validPlan(step, "normal"),
        curriculum_step_key: "another.step"
      })
    ).rejects.toThrow(/curriculum_step_key mismatch/);

    await expect(
      generateWithPlan(step, {
        ...validPlan(step, "normal"),
        adaptation_mode: "accelerate"
      })
    ).rejects.toThrow(/adaptation_mode mismatch/);
  });

  it("rejects teaching plans written in the wrong language with one HTTP request", async () => {
    const step = await catalogStep();
    const frenchProvider = new CountingLearningPromptProvider({
      disableFallback: true,
      buildPrompt: () => validPlan(step, "normal", "en")
    });
    await expect(
      generateLearningPrompt({
        provider: frenchProvider,
        path: path({ language: "fr" }),
        step,
        adaptationMode: "normal",
        repetitionIndex: 0,
        sessions: [],
        feedbackRows: [],
        sessionNumber: 1
      })
    ).rejects.toThrow(/language mismatch/);
    expect(frenchProvider.httpRequests).toBe(1);

    const englishProvider = new CountingLearningPromptProvider({
      disableFallback: true,
      buildPrompt: () => validPlan(step, "normal", "fr")
    });
    await expect(
      generateLearningPrompt({
        provider: englishProvider,
        path: path({ language: "en" }),
        step,
        adaptationMode: "normal",
        repetitionIndex: 0,
        sessions: [],
        feedbackRows: [],
        sessionNumber: 1
      })
    ).rejects.toThrow(/language mismatch/);
    expect(englishProvider.httpRequests).toBe(1);
  });

  it("localizes safety rules in the rendered tutor prompt", async () => {
    const catalog = await loadLearningCatalog();
    const medicalStep = catalog.find((candidate) => candidate.safety_category === "medical_educational");
    if (!medicalStep) {
      throw new Error("No medical learning step found.");
    }

    const fr = await captureProviderRequest({
      path: path({ language: "fr", domain_id: medicalStep.domain_id }),
      step: medicalStep,
      adaptationMode: "normal",
      sessions: [],
      feedbackRows: []
    });
    const en = await captureProviderRequest({
      path: path({ language: "en", domain_id: medicalStep.domain_id }),
      step: medicalStep,
      adaptationMode: "normal",
      sessions: [],
      feedbackRows: []
    });

    expect(fr.result.prompt.prompt_text).toContain("Le contenu reste éducatif et général.");
    expect(fr.result.prompt.prompt_text).not.toContain("Content remains educational and general.");
    expect(en.result.prompt.prompt_text).toContain("Content remains educational and general.");
    expect(en.result.prompt.prompt_text).not.toContain("Le contenu reste éducatif et général.");
  });

  it("makes no network request in deterministic mode and renders the final prompt locally", async () => {
    const step = await catalogStep();
    const result = await generateLearningPrompt({
      provider: "deterministic",
      path: path({ language: "en" }),
      step,
      adaptationMode: "context_shift",
      repetitionIndex: 1,
      sessions: [],
      feedbackRows: [],
      sessionNumber: 1
    });

    expect(result.apiCalls).toBe(0);
    expect(result.modelName).toBe(DETERMINISTIC_LEARNING_MODEL);
    expect(result.prompt.prompt_text).toContain("You are my personal tutor");
    expect(result.prompt.prompt_text).toContain("Conduct the entire session in English.");
    expect(result.prompt.prompt_text).not.toContain("{{");
  });
});

async function captureProviderRequest(input: {
  path: LearningPathRecord;
  step: LearningCatalogStep;
  adaptationMode: LearningAdaptationMode;
  sessions: LearningSessionRecord[];
  feedbackRows: LearningFeedbackRecord[];
}) {
  let requestPayload = "";
  let requestRecord: Parameters<CountingLearningPromptProvider["generateJson"]>[0] | null = null;
  const provider = new CountingLearningPromptProvider({
    model: "gpt-learning-test",
    disableFallback: true,
    buildPrompt: (request) => {
      requestRecord = request;
      requestPayload = request.userPrompt;
      return fakeLearningPromptResponse(request);
    }
  });
  const result = await generateLearningPrompt({
    provider,
    path: input.path,
    step: input.step,
    adaptationMode: input.adaptationMode,
    repetitionIndex: 0,
    sessions: input.sessions,
    feedbackRows: input.feedbackRows,
    sessionNumber: input.sessions.length + 1
  });

  expect(provider.httpRequests).toBe(1);
  return {
    request: requestRecord!,
    payload: JSON.parse(requestPayload) as {
      task: string;
      context: {
        language: "fr" | "en";
        learner: { current_level: number };
        session: {
          curriculum_step: {
            key: string;
            title: string;
            summary: string;
            learning_goals: string[];
            tutor_focus: string;
          };
          adaptation_mode: LearningAdaptationMode;
        };
        feedback_profile: {
          feedback_count: number;
          latest: Record<string, number> | null;
          recent_average: Record<string, number> | null;
        };
      };
    },
    result
  };
}

async function generateWithPlan(step: LearningCatalogStep, plan: unknown) {
  return generateLearningPrompt({
    provider: new CountingLearningPromptProvider({
      disableFallback: true,
      buildPrompt: () => plan
    }),
    path: path(),
    step,
    adaptationMode: "normal",
    repetitionIndex: 0,
    sessions: [],
    feedbackRows: [],
    sessionNumber: 1
  });
}

function validPlan(step: LearningCatalogStep, adaptationMode: LearningAdaptationMode, language: "en" | "fr" = "en") {
  return language === "fr" ? {
    curriculum_step_key: step.key,
    adaptation_mode: adaptationMode,
    teaching_angle: "Expliquer le mécanisme avec un exemple concret.",
    hook: "Commencer par une situation simple et proche.",
    core_points: ["Un mécanisme central compte.", "L'apprenant doit l'appliquer."],
    example: "Un exemple concret.",
    first_check_goal: "Vérifier la compréhension du mécanisme.",
    application_goal: "Appliquer le mécanisme.",
    transfer_goal: "Transférer le mécanisme.",
    common_misconception: "Confondre vocabulaire et mécanisme.",
    recap_target: "le modèle mental réutilisable"
  } : {
    curriculum_step_key: step.key,
    adaptation_mode: adaptationMode,
    teaching_angle: "Teach the mechanism directly.",
    hook: "Start from a concrete situation.",
    core_points: ["One mechanism matters.", "The learner should apply it."],
    example: "A concrete example.",
    first_check_goal: "Check the mechanism.",
    application_goal: "Apply the mechanism.",
    transfer_goal: "Transfer the mechanism.",
    common_misconception: "Confusing vocabulary with mechanism.",
    recap_target: "the reusable mental model"
  };
}

async function catalogStep() {
  const catalog = await loadLearningCatalog();
  const step =
    catalog.find((candidate) => candidate.key === "computer_science.machine_layers") ??
    catalog.find((candidate) => candidate.example_contexts_en.length > 1);
  if (!step) {
    throw new Error("No testable catalog step found.");
  }
  return step;
}

function path(patch: Partial<LearningPathRecord> = {}): LearningPathRecord {
  return {
    id: "path-1",
    user_id: "user-1",
    domain_id: "computer_science",
    objective_id: "cs_systems",
    current_level: 4,
    target_level: 5,
    language: "en",
    ...patch
  };
}

function session(input: {
  id: string;
  sessionNumber: number;
  status: "available" | "opened" | "started" | "completed";
  stepKey: string;
}): LearningSessionRecord {
  return {
    id: input.id,
    path_id: "path-1",
    curriculum_step_key: input.stepKey,
    skipped_step_key: null,
    session_number: input.sessionNumber,
    repetition_index: 0,
    adaptation_mode: "normal",
    language: "en",
    generation_status: "ready",
    status: input.status,
    available_on: "2026-08-01",
    opened_at: "2026-08-01T08:00:00.000Z",
    started_at: input.status === "available" || input.status === "opened" ? null : "2026-08-01T08:01:00.000Z",
    completed_at: input.status === "completed" ? "2026-08-01T08:04:00.000Z" : null
  };
}

function feedback(
  sessionId: string,
  comprehension: number,
  explainability: number,
  interest: number,
  difficulty: number
): LearningFeedbackRecord {
  return {
    session_id: sessionId,
    comprehension_rating: comprehension,
    explainability_rating: explainability,
    interest_rating: interest,
    difficulty_rating: difficulty
  };
}
