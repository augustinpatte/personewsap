#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CATALOG_DIR = path.join(ROOT, "content", "learning-paths", "v1");
const index = JSON.parse(await readFile(path.join(CATALOG_DIR, "catalog-index.json"), "utf8"));
const rows = [];
let totalSteps = 0;

for (const domain of index.domains) {
  const catalog = JSON.parse(await readFile(path.join(CATALOG_DIR, domain.file), "utf8"));
  const objectives = {};

  for (const objectiveId of domain.objective_ids) {
    const eligible = catalog.steps.filter((step) => step.objective_ids.includes(objectiveId));
    const specific = eligible.filter((step) => step.objective_ids.length === 1);
    objectives[objectiveId] = {
      eligible_steps: eligible.length,
      specific_steps: specific.length,
      specific_ratio: Number((specific.length / Math.max(eligible.length, 1)).toFixed(3)),
      required_steps: eligible.filter((step) => step.required).length,
      optional_steps: eligible.filter((step) => !step.required).length,
      eligible_by_stage: countByStage(eligible)
    };
  }

  totalSteps += catalog.steps.length;
  rows.push({
    domain_id: domain.id,
    steps: catalog.steps.length,
    shared_by_all_orientations: catalog.steps.filter(
      (step) => step.objective_ids.length === domain.objective_ids.length
    ).length,
    steps_by_stage: countByStage(catalog.steps),
    objectives
  });
}

process.stdout.write(
  `${JSON.stringify({ version: index.version, total_steps: totalSteps, domains: rows }, null, 2)}\n`
);

function countByStage(steps) {
  return steps.reduce((counts, step) => {
    counts[step.stage] = (counts[step.stage] ?? 0) + 1;
    return counts;
  }, {});
}
