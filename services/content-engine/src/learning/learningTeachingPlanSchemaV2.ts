import { LEARNING_ADAPTATION_MODES, type LearningAdaptationMode } from "./sessionLifecycle.js";

export type TeachingPlanV2 = {
  curriculum_step_key: string;
  adaptation_mode: LearningAdaptationMode;
  teaching_angle: string;
  hook: string;
  core_points: string[];
  example: string;
  first_check_goal: string;
  application_goal: string;
  transfer_goal: string;
  common_misconception: string;
  recap_target: string;
};

export const LEARNING_TEACHING_PLAN_SCHEMA_V2 = {
  type: "object",
  additionalProperties: false,
  required: [
    "curriculum_step_key",
    "adaptation_mode",
    "teaching_angle",
    "hook",
    "core_points",
    "example",
    "first_check_goal",
    "application_goal",
    "transfer_goal",
    "common_misconception",
    "recap_target"
  ],
  properties: {
    curriculum_step_key: { type: "string" },
    adaptation_mode: { enum: LEARNING_ADAPTATION_MODES },
    teaching_angle: { type: "string" },
    hook: { type: "string" },
    core_points: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
    example: { type: "string" },
    first_check_goal: { type: "string" },
    application_goal: { type: "string" },
    transfer_goal: { type: "string" },
    common_misconception: { type: "string" },
    recap_target: { type: "string" }
  }
} as const;

export function validateTeachingPlanV2(
  value: unknown,
  expected: { curriculumStepKey: string; adaptationMode: LearningAdaptationMode }
): TeachingPlanV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Learning teaching plan output is not an object.");
  }

  const plan = value as Partial<TeachingPlanV2>;
  const issues: string[] = [];
  const allowedKeys = new Set(Object.keys(LEARNING_TEACHING_PLAN_SCHEMA_V2.properties));
  for (const key of Object.keys(plan)) {
    if (!allowedKeys.has(key)) {
      issues.push(`unexpected field ${key}`);
    }
  }

  if (plan.curriculum_step_key !== expected.curriculumStepKey) {
    issues.push("curriculum_step_key mismatch");
  }
  if (plan.adaptation_mode !== expected.adaptationMode) {
    issues.push("adaptation_mode mismatch");
  }

  for (const field of [
    "teaching_angle",
    "hook",
    "example",
    "first_check_goal",
    "application_goal",
    "transfer_goal",
    "common_misconception",
    "recap_target"
  ] as const) {
    if (!isNonEmptyString(plan[field])) {
      issues.push(`${field} empty`);
    }
  }

  if (!Array.isArray(plan.core_points) || plan.core_points.length < 2 || plan.core_points.length > 4) {
    issues.push("core_points must have 2-4 items");
  } else {
    for (const [index, point] of plan.core_points.entries()) {
      if (!isNonEmptyString(point)) {
        issues.push(`core_points.${index} empty`);
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(`Invalid learning teaching plan output: ${issues.join("; ")}.`);
  }

  return {
    curriculum_step_key: plan.curriculum_step_key!,
    adaptation_mode: plan.adaptation_mode!,
    teaching_angle: plan.teaching_angle!.trim(),
    hook: plan.hook!.trim(),
    core_points: plan.core_points!.map((point) => point.trim()),
    example: plan.example!.trim(),
    first_check_goal: plan.first_check_goal!.trim(),
    application_goal: plan.application_goal!.trim(),
    transfer_goal: plan.transfer_goal!.trim(),
    common_misconception: plan.common_misconception!.trim(),
    recap_target: plan.recap_target!.trim()
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
