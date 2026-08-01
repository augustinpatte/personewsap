#!/usr/bin/env node
// Builds content/learning-paths/v1/*.json from the authored concept sources in
// scripts/learning-catalog/. The sources hold the pedagogical content; the
// builder derives only the mechanical fields (order, prerequisites, fallback,
// required, safety category) so they stay consistent across 7 domains.
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCE_DIR = path.join(HERE, "learning-catalog");
const OUTPUT_DIR = path.join(ROOT, "content", "learning-paths", "v1");

const DOMAIN_ORDER = [
  "computer_science",
  "artificial_intelligence",
  "blockchain",
  "quantum_physics",
  "mathematics",
  "cybersecurity",
  "human_biology_medicine"
];

const SAFETY_BY_DOMAIN = {
  cybersecurity: "cyber_defensive",
  human_biology_medicine: "medical_educational"
};

const sourceFiles = (await readdir(SOURCE_DIR)).filter((file) => file.endsWith(".mjs"));
const domains = [];

for (const domainId of DOMAIN_ORDER) {
  const file = `${domainId}.mjs`;
  if (!sourceFiles.includes(file)) {
    throw new Error(`Missing learning catalog source for ${domainId} (expected scripts/learning-catalog/${file}).`);
  }
  const module = await import(pathToFileURL(path.join(SOURCE_DIR, file)).href);
  domains.push(module.domain);
}

const indexDomains = [];

for (const domain of domains) {
  const steps = buildDomainSteps(domain);
  await writeFile(
    path.join(OUTPUT_DIR, `${domain.id}.json`),
    `${JSON.stringify({ domain_id: domain.id, version: "v1", steps }, null, 2)}\n`,
    "utf8"
  );
  indexDomains.push({
    id: domain.id,
    file: `${domain.id}.json`,
    objective_ids: domain.objectives
  });
  process.stdout.write(`${domain.id}: ${steps.length} steps\n`);
}

await writeFile(
  path.join(OUTPUT_DIR, "catalog-index.json"),
  `${JSON.stringify({ version: "v1", min_steps: 245, domains: indexDomains }, null, 2)}\n`,
  "utf8"
);

function buildDomainSteps(domain) {
  const ordered = orderSteps(domain);
  const built = [];

  for (const [index, step] of ordered.entries()) {
    const objectiveIds = resolveObjectives(domain, step);
    const earlierSharing = built.filter((candidate) =>
      candidate.objective_ids.some((objectiveId) => objectiveIds.includes(objectiveId))
    );
    const covers = (candidate) => objectiveIds.every((id) => candidate.objective_ids.includes(id));
    const earlier = earlierSharing.filter((candidate) => candidate.stage <= step.stage);
    const prerequisite = earlier.filter(covers).at(-1) ?? earlier.at(-1) ?? null;
    const simpler = earlierSharing.filter((candidate) => candidate.stage < step.stage);
    // Prefer a simpler step that stays valid for every orientation this step
    // belongs to, so a fallback never drags the learner off their track.
    const fallback = simpler.filter(covers).at(-1) ?? simpler.at(-1) ?? null;

    built.push({
      key: `${domain.id}.${step.key}`,
      domain_id: domain.id,
      objective_ids: objectiveIds,
      stage: step.stage,
      order: index + 1,
      required: isRequired(step, ordered),
      prerequisite_keys: prerequisite ? [prerequisite.key] : [],
      fallback_key: fallback ? fallback.key : null,
      title_fr: step.fr.title,
      title_en: step.en.title,
      summary_fr: step.fr.summary,
      summary_en: step.en.summary,
      learning_goals_fr: step.fr.goals,
      learning_goals_en: step.en.goals,
      tutor_focus_fr: step.fr.tutor,
      tutor_focus_en: step.en.tutor,
      example_contexts_fr: step.fr.contexts,
      example_contexts_en: step.en.contexts,
      safety_category: step.safety ?? SAFETY_BY_DOMAIN[domain.id] ?? "standard"
    });
  }

  return built;
}

// Steps are grouped stage by stage, and inside a stage the shared base comes
// first, then each orientation in catalog order. That ordering is what makes the
// derived prerequisite chain pedagogically correct.
function orderSteps(domain) {
  const groupIndex = (step) =>
    step.objectives === "*" ? -1 : domain.objectives.indexOf(step.objectives[0]);

  return [...domain.steps]
    .map((step, index) => ({ step, index }))
    .sort(
      (left, right) =>
        left.step.stage - right.step.stage ||
        groupIndex(left.step) - groupIndex(right.step) ||
        left.index - right.index
    )
    .map((entry) => entry.step);
}

function resolveObjectives(domain, step) {
  if (step.objectives === "*") {
    return [...domain.objectives];
  }
  for (const objectiveId of step.objectives) {
    if (!domain.objectives.includes(objectiveId)) {
      throw new Error(`${domain.id}.${step.key} references unknown objective ${objectiveId}.`);
    }
  }
  return [...step.objectives];
}

// The shared base is always required, and so is the first orientation-specific
// step of each stage: a learner can never skip past the entry point of a stage.
function isRequired(step, ordered) {
  if (step.required !== undefined) {
    return step.required;
  }
  if (step.objectives === "*") {
    return true;
  }
  const first = ordered.find(
    (candidate) =>
      candidate.stage === step.stage &&
      candidate.objectives !== "*" &&
      candidate.objectives[0] === step.objectives[0]
  );
  return first === step;
}
