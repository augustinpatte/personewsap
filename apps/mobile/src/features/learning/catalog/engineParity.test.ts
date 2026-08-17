import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  pickNextLearningStep as enginePickNextLearningStep
} from "../../../../../../services/content-engine/src/learning/catalogLoader";
import { generateLearningPrompt } from "../../../../../../services/content-engine/src/learning/learningPromptGenerator";
import type { LearningCatalogStep } from "./catalogTypes";
import { prepareLearningSession, renderLearningTutorPrompt } from "./sessionPrompt";
import { countUsedStepKeys, pickNextLearningStep } from "./stepSelection";

/**
 * The app now walks the curriculum itself so a reader can advance on demand,
 * which means the same algorithm exists twice: here and in the content engine.
 * These tests pin the two together against the real catalog, so a change to one
 * side that is not mirrored fails the build instead of silently producing
 * different lessons for the same reader.
 */

const CATALOG_DIR = path.join(process.cwd(), "content", "learning-paths", "v1");

function loadCatalog(): LearningCatalogStep[] {
  return readdirSync(CATALOG_DIR)
    .filter((file) => file.endsWith(".json") && file !== "catalog-index.json")
    .flatMap(
      (file) =>
        JSON.parse(readFileSync(path.join(CATALOG_DIR, file), "utf8"))
          .steps as LearningCatalogStep[]
    )
    .sort(
      (left, right) =>
        left.domain_id.localeCompare(right.domain_id) || left.order - right.order
    );
}

const catalog = loadCatalog();

describe("curriculum walk parity with the content engine", () => {
  it("loads the real catalog", () => {
    expect(catalog.length).toBeGreaterThan(300);
  });

  it("walks a whole path identically on both sides", () => {
    const domainId = "computer_science";
    const objectiveId = catalog.find((step) => step.domain_id === domainId)
      ?.objective_ids[0] as string;
    const delivered: Array<{ curriculum_step_key: string; skipped_step_key: string | null }> =
      [];

    for (let session = 0; session < 30; session += 1) {
      const usedStepKeys = countUsedStepKeys(delivered);
      const lastStepKey = delivered.at(-1)?.curriculum_step_key ?? null;
      const shared = {
        domainId,
        objectiveId,
        currentLevel: 1,
        targetLevel: 5,
        usedStepKeys,
        adaptationMode: "normal" as const,
        lastStepKey
      };

      const mine = pickNextLearningStep({ catalog, ...shared });
      const theirs = enginePickNextLearningStep({
        catalog: catalog as never,
        ...shared
      });

      expect(mine.status).toBe(theirs.status);
      expect(mine.step?.key ?? null).toBe(theirs.step?.key ?? null);
      expect(mine.repetitionIndex).toBe(theirs.repetitionIndex);
      expect(mine.skippedStepKey).toBe(theirs.skippedStepKey);

      if (mine.status !== "selected") {
        break;
      }

      delivered.push({
        curriculum_step_key: mine.step.key,
        skipped_step_key: mine.skippedStepKey
      });
    }

    expect(delivered.length).toBeGreaterThan(5);
  });

  it.each(["reinforce", "accelerate", "context_shift", "prerequisite"] as const)(
    "agrees on the %s adaptation mode",
    (adaptationMode) => {
      const domainId = "mathematics";
      const objectiveId = catalog.find((step) => step.domain_id === domainId)
        ?.objective_ids[0] as string;
      const first = catalog.find(
        (step) => step.domain_id === domainId && step.objective_ids.includes(objectiveId)
      ) as LearningCatalogStep;
      const shared = {
        domainId,
        objectiveId,
        currentLevel: 2,
        targetLevel: 4,
        usedStepKeys: new Map([[first.key, 1]]),
        adaptationMode,
        lastStepKey: first.key
      };

      const mine = pickNextLearningStep({ catalog, ...shared });
      const theirs = enginePickNextLearningStep({ catalog: catalog as never, ...shared });

      expect(mine.step?.key ?? null).toBe(theirs.step?.key ?? null);
      expect(mine.repetitionIndex).toBe(theirs.repetitionIndex);
    }
  );
});

describe("tutor prompt parity with the content engine", () => {
  it.each([
    ["fr", 0],
    ["en", 0],
    ["fr", 1],
    ["en", 2]
  ] as const)("renders the same %s prompt (repetition %i)", async (language, repetitionIndex) => {
    const step = catalog.find(
      (candidate) => candidate.example_contexts_en.length > 1
    ) as LearningCatalogStep;

    const engineResult = await generateLearningPrompt({
      provider: "deterministic",
      path: {
        id: "path-1",
        user_id: "user-1",
        domain_id: step.domain_id,
        objective_id: step.objective_ids[0],
        current_level: 2,
        target_level: 4,
        language
      } as never,
      step: step as never,
      adaptationMode: "normal",
      repetitionIndex,
      sessions: [],
      feedbackRows: [],
      sessionNumber: 1
    });

    expect(engineResult.apiCalls).toBe(0);
    expect(renderLearningTutorPrompt({ step, language, repetitionIndex })).toBe(
      engineResult.prompt.prompt_text.trim()
    );
  });

  it("carries both language variants so a past session keeps its own language", () => {
    const step = catalog[0];
    const prepared = prepareLearningSession({
      step,
      language: "fr",
      repetitionIndex: 0,
      adaptationMode: "normal",
      skippedStepKey: null
    });

    expect(prepared.titleFr).toBe(step.title_fr);
    expect(prepared.titleEn).toBe(step.title_en);
    expect(prepared.objectivesFr.length).toBeLessThanOrEqual(3);
    // A French path renders its tutor prompt in French.
    expect(prepared.promptText.startsWith("Tu es mon tuteur")).toBe(true);
  });

  it("renders an English prompt for an English path", () => {
    const prepared = prepareLearningSession({
      step: catalog[0],
      language: "en",
      repetitionIndex: 0,
      adaptationMode: "normal",
      skippedStepKey: null
    });

    expect(prepared.promptText.startsWith("You are my personal tutor")).toBe(true);
  });
});
