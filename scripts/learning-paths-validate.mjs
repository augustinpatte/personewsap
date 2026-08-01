#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CATALOG_DIR = path.join(ROOT, "content", "learning-paths", "v1");
const EXPECTED_DOMAINS = [
  "computer_science",
  "artificial_intelligence",
  "blockchain",
  "quantum_physics",
  "mathematics",
  "cybersecurity",
  "human_biology_medicine"
];
const EXPECTED_OBJECTIVES = {
  computer_science: ["cs_systems", "cs_programming", "cs_software_data"],
  artificial_intelligence: ["ai_foundations", "ai_machine_learning", "ai_building"],
  blockchain: ["blockchain_foundations", "blockchain_ecosystem", "blockchain_building"],
  quantum_physics: ["quantum_intuition", "quantum_mathematics", "quantum_computing"],
  mathematics: ["math_foundations", "math_probability", "math_technology"],
  cybersecurity: ["cyber_foundations", "cyber_network_defense", "cyber_app_cloud"],
  human_biology_medicine: ["medicine_body", "medicine_disease", "medicine_evidence"]
};
const SAFETY_BY_DOMAIN = {
  cybersecurity: "cyber_defensive",
  human_biology_medicine: "medical_educational"
};
const ALLOWED_SAFETY = new Set([
  "standard",
  "cyber_defensive",
  "medical_educational",
  "financial_educational"
]);

const issues = [];
const catalog = await readJson(path.join(CATALOG_DIR, "catalog-index.json"));
const files = await readdir(CATALOG_DIR);
const stepKeys = new Set();
const objectiveCounts = new Map();
let totalSteps = 0;

for (const domainId of EXPECTED_DOMAINS) {
  if (!files.includes(`${domainId}.json`)) {
    issues.push(`Missing catalog file for ${domainId}`);
    continue;
  }

  const domainCatalog = await readJson(path.join(CATALOG_DIR, `${domainId}.json`));
  if (domainCatalog.domain_id !== domainId) {
    issues.push(`${domainId}.json has domain_id=${domainCatalog.domain_id}`);
  }

  const steps = Array.isArray(domainCatalog.steps) ? domainCatalog.steps : [];
  totalSteps += steps.length;
  let previousOrder = 0;

  for (const step of steps) {
    validateStep(step, domainId, previousOrder);
    previousOrder = typeof step.order === "number" ? step.order : previousOrder;
  }
}

for (const [domainId, objectiveIds] of Object.entries(EXPECTED_OBJECTIVES)) {
  for (const objectiveId of objectiveIds) {
    const count = objectiveCounts.get(objectiveId) ?? 0;
    if (count < 24) {
      issues.push(`${objectiveId} has ${count} eligible step(s), expected at least 24`);
    }
  }
}

if ((catalog.domains ?? []).length !== EXPECTED_DOMAINS.length) {
  issues.push("catalog-index.json must list exactly seven domains");
}
if (totalSteps < 245) {
  issues.push(`Catalog has ${totalSteps} distinct step(s), expected at least 245`);
}

if (issues.length > 0) {
  process.stderr.write(`Learning catalog validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Learning catalog validation passed: ${totalSteps} step(s), ${objectiveCounts.size} objective(s).\n`);
}

function validateStep(step, domainId, previousOrder) {
  const key = typeof step.key === "string" ? step.key : "";
  if (!key.startsWith(`${domainId}.`)) {
    issues.push(`Invalid key/domain pair: ${key}`);
  }
  if (stepKeys.has(key)) {
    issues.push(`Duplicate step key: ${key}`);
  }
  stepKeys.add(key);

  if (typeof step.order !== "number" || step.order <= previousOrder) {
    issues.push(`${key} has non-increasing order`);
  }
  if (typeof step.stage !== "number" || step.stage < 1 || step.stage > 5) {
    issues.push(`${key} has invalid stage`);
  }
  for (const field of [
    "title_fr",
    "title_en",
    "summary_fr",
    "summary_en",
    "tutor_focus_fr",
    "tutor_focus_en"
  ]) {
    if (typeof step[field] !== "string" || step[field].trim().length === 0) {
      issues.push(`${key} missing ${field}`);
    }
  }
  for (const field of ["learning_goals_fr", "learning_goals_en", "example_contexts_fr", "example_contexts_en"]) {
    if (!Array.isArray(step[field]) || step[field].length === 0) {
      issues.push(`${key} missing ${field}`);
    }
  }
  if (!ALLOWED_SAFETY.has(step.safety_category)) {
    issues.push(`${key} has invalid safety category ${step.safety_category}`);
  }
  if (SAFETY_BY_DOMAIN[domainId] && step.safety_category !== SAFETY_BY_DOMAIN[domainId]) {
    issues.push(`${key} must use ${SAFETY_BY_DOMAIN[domainId]}`);
  }
  if (!Array.isArray(step.objective_ids) || step.objective_ids.length === 0) {
    issues.push(`${key} has no objective_ids`);
    return;
  }
  for (const objectiveId of step.objective_ids) {
    if (!EXPECTED_OBJECTIVES[domainId].includes(objectiveId)) {
      issues.push(`${key} references invalid objective ${objectiveId}`);
    }
    objectiveCounts.set(objectiveId, (objectiveCounts.get(objectiveId) ?? 0) + 1);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
