#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CATALOG_DIR = path.join(ROOT, "content", "learning-paths", "v1");
const index = JSON.parse(await readFile(path.join(CATALOG_DIR, "catalog-index.json"), "utf8"));
const rows = [];

for (const domain of index.domains) {
  const catalog = JSON.parse(await readFile(path.join(CATALOG_DIR, domain.file), "utf8"));
  const objectiveCounts = new Map();
  for (const step of catalog.steps) {
    for (const objectiveId of step.objective_ids) {
      objectiveCounts.set(objectiveId, (objectiveCounts.get(objectiveId) ?? 0) + 1);
    }
  }
  rows.push({
    domain_id: domain.id,
    steps: catalog.steps.length,
    objectives: Object.fromEntries([...objectiveCounts.entries()].sort())
  });
}

process.stdout.write(`${JSON.stringify({ version: index.version, domains: rows }, null, 2)}\n`);
