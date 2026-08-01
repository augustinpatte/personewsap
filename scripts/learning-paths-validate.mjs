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

const MIN_STEPS_PER_DOMAIN = 35;
const MIN_TOTAL_STEPS = 245;
const MIN_STEPS_PER_OBJECTIVE = 24;
const MIN_SPECIFIC_RATIO = 0.6;
const MIN_CONTEXTS = 3;

// A title, goal or context that is only a numbered placeholder ("étape 3",
// "concept 12", "student example 4") tells the tutor nothing about the concept.
const LABEL_WORDS =
  "étape|etape|step|concept|niveau|level|module|leçon|lecon|lesson|partie|part|unité|unite|unit|exemple|example|situation|contexte|context|item";
const NUMBERED_LABEL = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(?:${LABEL_WORDS})s?\\s*(?:numéro|numero|no\\.?|n°|#)?\\s*\\d+(?![\\p{L}\\p{N}])`,
  "iu"
);
// Same idea, one indirection further: "Exemple étudiant 4", "Situation produit 7".
const LABEL_THEN_INDEX = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${LABEL_WORDS})s?\\b[^.\\n]{0,24}\\s\\d+\\s*$`, "iu");
const PLACEHOLDER_LABEL = {
  test: (value) => NUMBERED_LABEL.test(value) || LABEL_THEN_INDEX.test(value)
};
// Wording that could be pasted onto any concept of any domain.
const GENERIC_PHRASE = new RegExp(
  [
    "idée principale",
    "idee principale",
    "main idea",
    "dans un exemple court",
    "in a short example",
    "brique claire",
    "building block of the",
    "faire progresser l'étudiant sans dépasser",
    "move the student forward without exceeding",
    "comprendre le sujet",
    "understand the topic",
    "en savoir plus sur",
    "learn more about"
  ].join("|"),
  "i"
);

const issues = [];
const catalog = await readJson(path.join(CATALOG_DIR, "catalog-index.json"));
const files = await readdir(CATALOG_DIR);
const stepKeys = new Set();
const objectiveCounts = new Map();
const specificCounts = new Map();
const seenText = new Map();
const stepsByKey = new Map();
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

  if (steps.length < MIN_STEPS_PER_DOMAIN) {
    issues.push(`${domainId} has ${steps.length} step(s), expected at least ${MIN_STEPS_PER_DOMAIN}`);
  }

  let previousOrder = 0;
  for (const step of steps) {
    stepsByKey.set(step.key, step);
    validateStep(step, domainId, previousOrder);
    previousOrder = typeof step.order === "number" ? step.order : previousOrder;
  }

  const sharedByAll = steps.filter(
    (step) =>
      Array.isArray(step.objective_ids) && step.objective_ids.length === EXPECTED_OBJECTIVES[domainId].length
  ).length;
  if (steps.length > 0 && sharedByAll / steps.length > 1 - MIN_SPECIFIC_RATIO) {
    issues.push(
      `${domainId} shares ${sharedByAll}/${steps.length} steps with every orientation, above the ${Math.round(
        (1 - MIN_SPECIFIC_RATIO) * 100
      )}% ceiling`
    );
  }
}

validateGraph();

for (const [domainId, objectiveIds] of Object.entries(EXPECTED_OBJECTIVES)) {
  for (const objectiveId of objectiveIds) {
    const count = objectiveCounts.get(objectiveId) ?? 0;
    const specific = specificCounts.get(objectiveId) ?? 0;
    if (count < MIN_STEPS_PER_OBJECTIVE) {
      issues.push(`${objectiveId} has ${count} eligible step(s), expected at least ${MIN_STEPS_PER_OBJECTIVE}`);
    }
    if (count > 0 && specific / count < MIN_SPECIFIC_RATIO) {
      issues.push(
        `${objectiveId} (${domainId}) is only ${Math.round(
          (specific / count) * 100
        )}% specific, expected at least ${Math.round(MIN_SPECIFIC_RATIO * 100)}%`
      );
    }
  }
}

if ((catalog.domains ?? []).length !== EXPECTED_DOMAINS.length) {
  issues.push("catalog-index.json must list exactly seven domains");
}
if (totalSteps < MIN_TOTAL_STEPS) {
  issues.push(`Catalog has ${totalSteps} distinct step(s), expected at least ${MIN_TOTAL_STEPS}`);
}

if (issues.length > 0) {
  process.stderr.write(`Learning catalog validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Learning catalog validation passed: ${totalSteps} step(s), ${objectiveCounts.size} objective(s), no generic or duplicated content.\n`
  );
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
  if (typeof step.required !== "boolean") {
    issues.push(`${key} must declare a boolean required flag`);
  }

  for (const field of [
    "title_fr",
    "title_en",
    "summary_fr",
    "summary_en",
    "tutor_focus_fr",
    "tutor_focus_en"
  ]) {
    const value = step[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      issues.push(`${key} missing ${field}`);
      continue;
    }
    if (PLACEHOLDER_LABEL.test(value)) {
      issues.push(`${key}.${field} reads like a numbered placeholder: "${value}"`);
    }
    if (GENERIC_PHRASE.test(value)) {
      issues.push(`${key}.${field} uses generic filler wording: "${value}"`);
    }
    if (field.startsWith("title") && value.trim().length < 12) {
      issues.push(`${key}.${field} is too short to name a concept: "${value}"`);
    }
    if (field.startsWith("summary") && value.trim().length < 40) {
      issues.push(`${key}.${field} is too short to describe a concept: "${value}"`);
    }
    // Titles, summaries and tutor instructions must be unique across the whole
    // catalog: two steps sharing one means at least one of them is filler.
    const normalized = `${field}:${value.trim().toLowerCase()}`;
    const owner = seenText.get(normalized);
    if (owner && owner !== key) {
      issues.push(`${key}.${field} duplicates ${owner}: "${value}"`);
    } else {
      seenText.set(normalized, key);
    }
  }

  for (const field of ["learning_goals_fr", "learning_goals_en"]) {
    const goals = step[field];
    if (!Array.isArray(goals) || goals.length < 2 || goals.length > 3) {
      issues.push(`${key}.${field} must hold two or three specific goals`);
      continue;
    }
    for (const goal of goals) {
      if (typeof goal !== "string" || goal.trim().length < 20) {
        issues.push(`${key}.${field} has a goal too short to be specific: "${goal}"`);
        continue;
      }
      if (PLACEHOLDER_LABEL.test(goal) || GENERIC_PHRASE.test(goal)) {
        issues.push(`${key}.${field} has a generic goal: "${goal}"`);
      }
    }
    if (new Set(goals.map((goal) => String(goal).trim().toLowerCase())).size !== goals.length) {
      issues.push(`${key}.${field} repeats the same goal twice`);
    }
  }

  for (const field of ["example_contexts_fr", "example_contexts_en"]) {
    const contexts = step[field];
    if (!Array.isArray(contexts) || contexts.length < MIN_CONTEXTS) {
      issues.push(`${key}.${field} must hold at least ${MIN_CONTEXTS} concrete contexts`);
      continue;
    }
    for (const context of contexts) {
      if (typeof context !== "string" || context.trim().length < 12) {
        issues.push(`${key}.${field} has a context too short to be concrete: "${context}"`);
        continue;
      }
      if (PLACEHOLDER_LABEL.test(context) || GENERIC_PHRASE.test(context)) {
        issues.push(`${key}.${field} has an artificially numbered context: "${context}"`);
      }
    }
    if (new Set(contexts.map((context) => String(context).trim().toLowerCase())).size !== contexts.length) {
      issues.push(`${key}.${field} repeats the same context twice`);
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
    if (step.objective_ids.length === 1) {
      specificCounts.set(objectiveId, (specificCounts.get(objectiveId) ?? 0) + 1);
    }
  }
}

function validateGraph() {
  for (const step of stepsByKey.values()) {
    for (const prerequisiteKey of step.prerequisite_keys ?? []) {
      const prerequisite = stepsByKey.get(prerequisiteKey);
      if (!prerequisite) {
        issues.push(`${step.key} references unknown prerequisite ${prerequisiteKey}`);
        continue;
      }
      if (prerequisite.domain_id !== step.domain_id) {
        issues.push(`${step.key} has a prerequisite from another domain`);
      }
      if (prerequisite.stage > step.stage || prerequisite.order >= step.order) {
        issues.push(`${step.key} has a prerequisite that does not come earlier`);
      }
      if (!prerequisite.objective_ids.some((id) => step.objective_ids.includes(id))) {
        issues.push(`${step.key} has a prerequisite from another orientation`);
      }
    }

    if (step.fallback_key === null || step.fallback_key === undefined) {
      if (step.stage > 1) {
        issues.push(`${step.key} is at stage ${step.stage} and must offer a simpler fallback`);
      }
      continue;
    }

    const fallback = stepsByKey.get(step.fallback_key);
    if (!fallback) {
      issues.push(`${step.key} references unknown fallback ${step.fallback_key}`);
      continue;
    }
    if (fallback.stage >= step.stage) {
      issues.push(`${step.key} has a fallback that is not simpler than itself`);
    }
    if (!fallback.objective_ids.some((id) => step.objective_ids.includes(id))) {
      issues.push(`${step.key} has a fallback from another orientation`);
    }
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
