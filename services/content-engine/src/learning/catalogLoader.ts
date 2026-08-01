import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LearningCatalogStep } from "./learningTypes.js";

const CATALOG_ROOT = resolveCatalogRoot();

export async function loadLearningCatalog(): Promise<LearningCatalogStep[]> {
  const index = JSON.parse(await readFile(path.join(CATALOG_ROOT, "catalog-index.json"), "utf8")) as {
    domains: Array<{ file: string }>;
  };
  const catalogs = await Promise.all(
    index.domains.map(async (domain) => {
      const payload = JSON.parse(await readFile(path.join(CATALOG_ROOT, domain.file), "utf8")) as {
        steps: LearningCatalogStep[];
      };
      return payload.steps;
    })
  );

  return catalogs.flat().sort((left, right) => left.domain_id.localeCompare(right.domain_id) || left.order - right.order);
}

export function pickNextLearningStep(input: {
  catalog: LearningCatalogStep[];
  domainId: string;
  objectiveId: string;
  usedStepKeys: Set<string>;
  adaptationMode: string;
}): LearningCatalogStep {
  const eligible = input.catalog
    .filter((step) => step.domain_id === input.domainId)
    .filter((step) => step.objective_ids.includes(input.objectiveId))
    .filter((step) => !input.usedStepKeys.has(step.key))
    .sort((left, right) => left.order - right.order);

  if (eligible.length === 0) {
    throw new Error(`No unused learning catalog step for ${input.domainId}/${input.objectiveId}.`);
  }

  if (input.adaptationMode === "prerequisite") {
    const fallbackKey = [...input.usedStepKeys]
      .map((key) => input.catalog.find((step) => step.key === key)?.fallback_key)
      .find((key): key is string => Boolean(key));
    const fallback = fallbackKey ? input.catalog.find((step) => step.key === fallbackKey) : null;
    if (fallback) {
      return fallback;
    }
  }

  return eligible[0];
}

function resolveCatalogRoot(): string {
  const candidates: string[] = [];

  if (import.meta.url.startsWith("file:")) {
    candidates.push(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content/learning-paths/v1"));
  }

  candidates.push(
    path.resolve(process.cwd(), "content/learning-paths/v1"),
    path.resolve(process.cwd(), "../../content/learning-paths/v1")
  );

  const match = candidates.find((candidate) => existsSync(path.join(candidate, "catalog-index.json")));

  if (!match) {
    throw new Error(`Learning catalog not found. Checked: ${candidates.join(", ")}`);
  }

  return match;
}
