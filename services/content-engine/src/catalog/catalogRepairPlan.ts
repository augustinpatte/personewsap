import type { GeneratedContentItem, Language, MiniCaseTopicId, RankedArticle } from "../domain.js";
import type { CatalogEntryVersionRecord } from "../storage/contentRepository.js";
import { sha256 } from "../utils/hash.js";

/**
 * A repair plan: the candidate content, frozen.
 *
 * The first version of `catalog-repair` generated candidates during the dry run,
 * printed them for review, and then generated them AGAIN when asked to persist.
 * With an LLM in the loop those are not the same content. A human would approve
 * candidate A and the tool would write candidate B — which makes the review
 * theatre rather than a gate.
 *
 * So repair is two commands. PREPARE generates once, validates, and writes the
 * candidate to a file. APPLY reads that file and writes exactly what is in it,
 * with no generator and no source fetcher anywhere in its dependencies — it
 * cannot regenerate anything, because it has nothing to regenerate with.
 *
 * The hashes here are integrity, not security. They exist to catch a plan edited
 * by hand into an inconsistent state, a plan applied twice, or a plan applied
 * against a database that has moved on since it was prepared. A determined
 * person with an editor can produce a consistent forgery, and that is out of
 * scope — the file lives on the operator's own machine.
 */

export const CATALOG_REPAIR_PLAN_VERSION = 1;

export type CatalogRepairMode = "rework" | "replace";

export type PlannedCatalogVersion = {
  language: Language;
  /** Preserved: the repair replaces what an entry says, never which row it is. */
  contentItemId: string;
  item: GeneratedContentItem;
  /** Hash of `item`. Recomputed at apply. */
  itemHash: string;
  /** The row as it stood at prepare time. Compared against the database at apply. */
  originalRowHash: string;
  originalTitle: string;
  originalSourceUrls: string[];
};

export type PlannedCatalogEntry = {
  entryId: string;
  mode: CatalogRepairMode;
  contentType: "business_story" | "mini_case";
  miniCaseTopic: MiniCaseTopicId | null;
  index: number;
  versions: PlannedCatalogVersion[];
  /**
   * The closed set of sources the candidate may cite, with full metadata.
   *
   * Carried in the plan so apply needs no RSS fetch and no database lookup to
   * know what was approved, and so the closure check at apply asks the same
   * question prepare asked.
   */
  approvedSources: RankedArticle[];
  approvedSourcesHash: string;
  sourceUrls: string[];
  previousSourceUrls: string[];
  /** Why this entry's event changed, or why it did not. Written for the reviewer. */
  sourceDecision: string;
  validation: {
    itemValidation: "passed";
    pairValidation: "passed";
    checkedAt: string;
  };
  /** Hash over everything above. Recomputed at apply. */
  entryHash: string;
};

export type CatalogRepairPlan = {
  planVersion: number;
  repairId: string;
  createdAt: string;
  runId: string;
  mode: CatalogRepairMode;
  dropDate: string;
  languages: Language[];
  contentStatus: "draft" | "review" | "published";
  /** Provider and prompt identifiers. Never a key, never a credential. */
  generator: {
    useLlm: boolean;
    generatorLabel: string;
    modelRouting: Record<string, unknown>;
  };
  entries: PlannedCatalogEntry[];
};

/** Stable hash of any JSON value: object key order never changes the result. */
export function stableHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
}

/**
 * Fingerprint of a persisted version as it stands right now.
 *
 * Everything a repair would overwrite, plus the sources it is linked to. If any
 * of it has moved since the plan was prepared — another repair ran, someone
 * edited the row, the catalog was published — the plan is stale and applying it
 * would silently discard whatever happened in between.
 */
export function fingerprintCatalogVersion(
  record: CatalogEntryVersionRecord,
  linkedSourceUrls: string[]
): string {
  return stableHash({
    contentItemId: record.contentItemId,
    language: record.language,
    contentType: record.contentType,
    title: record.title,
    summary: record.summary,
    bodyMd: record.bodyMd,
    difficulty: record.difficulty,
    status: record.status,
    topic: record.topic,
    metadata: record.metadata,
    linkedSourceUrls: [...linkedSourceUrls].sort()
  });
}

export function hashPlannedEntry(
  entry: Omit<PlannedCatalogEntry, "entryHash">
): string {
  return stableHash(entry);
}

/**
 * Recompute every hash in a plan and refuse it if any disagrees.
 *
 * Runs before anything else at apply: a plan that has been edited into an
 * inconsistent state must never reach the database, and the failure has to name
 * what disagreed rather than reporting "invalid plan".
 */
export function assertPlanIntegrity(plan: CatalogRepairPlan): void {
  if (plan.planVersion !== CATALOG_REPAIR_PLAN_VERSION) {
    throw new Error(
      `catalog-repair plan version ${plan.planVersion} is not supported by this build (expected ${CATALOG_REPAIR_PLAN_VERSION}). Re-run prepare.`
    );
  }

  if (!Array.isArray(plan.entries) || plan.entries.length === 0) {
    throw new Error("catalog-repair plan contains no entries.");
  }

  for (const entry of plan.entries) {
    for (const version of entry.versions) {
      const itemHash = stableHash(version.item);

      if (itemHash !== version.itemHash) {
        throw new Error(
          `catalog-repair plan is inconsistent: the ${version.language} candidate of ${entry.entryId} does not match its recorded hash. The content was edited after prepare, so what would be written is not what was reviewed.`
        );
      }
    }

    const sourcesHash = stableHash(entry.approvedSources);

    if (sourcesHash !== entry.approvedSourcesHash) {
      throw new Error(
        `catalog-repair plan is inconsistent: the approved source set of ${entry.entryId} does not match its recorded hash.`
      );
    }

    const { entryHash, ...withoutHash } = entry;

    if (hashPlannedEntry(withoutHash) !== entryHash) {
      throw new Error(
        `catalog-repair plan is inconsistent: ${entry.entryId} does not match its recorded hash.`
      );
    }
  }
}

/** Shape check, run before integrity so a malformed file fails clearly. */
export function assertPlanShape(value: unknown): asserts value is CatalogRepairPlan {
  if (!value || typeof value !== "object") {
    throw new Error("catalog-repair plan is not a JSON object.");
  }

  const plan = value as Partial<CatalogRepairPlan>;
  const required: Array<keyof CatalogRepairPlan> = [
    "planVersion",
    "repairId",
    "createdAt",
    "runId",
    "mode",
    "dropDate",
    "languages",
    "contentStatus",
    "entries"
  ];

  for (const field of required) {
    if (plan[field] === undefined) {
      throw new Error(`catalog-repair plan is missing "${field}".`);
    }
  }

  if (plan.mode !== "rework" && plan.mode !== "replace") {
    throw new Error(`catalog-repair plan has an unsupported mode "${String(plan.mode)}".`);
  }

  for (const entry of plan.entries as PlannedCatalogEntry[]) {
    if (!entry.entryId || !Array.isArray(entry.versions) || entry.versions.length === 0) {
      throw new Error("catalog-repair plan contains an entry with no versions.");
    }

    if (!Array.isArray(entry.approvedSources) || entry.approvedSources.length === 0) {
      throw new Error(
        `catalog-repair plan entry ${entry.entryId} carries no approved sources, so nothing could be grounded against it.`
      );
    }

    for (const version of entry.versions) {
      if (!version.contentItemId || !version.item) {
        throw new Error(
          `catalog-repair plan entry ${entry.entryId} has a version with no content item id or no candidate.`
        );
      }
    }
  }
}
