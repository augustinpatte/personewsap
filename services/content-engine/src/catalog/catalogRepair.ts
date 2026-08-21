import {
  miniCaseTopicToContentTopics,
  type BusinessStoryEditorialMemoryEntry,
  type GeneratedContentItem,
  type Language,
  type MiniCaseTopicId,
  type RankedArticle,
  type TopicId
} from "../domain.js";
import type { ContentGenerator } from "../generation/types.js";
import type { MiniCaseEditorialMemoryRecord } from "../miniCase/editorialMemory.js";
import type { CatalogEntryVersionRecord, ContentRepository } from "../storage/contentRepository.js";
import { buildEntry, type BootstrapCatalogOptions } from "./bootstrapCatalog.js";
import { buildCanonicalCatalogPool } from "./canonicalSourcePool.js";
import { indexExistingVersions, referenceItemFromRecord, versionKey } from "./catalogResume.js";
import { resolveCatalogSourceArticles } from "./catalogSourceResolution.js";
import {
  assertPlanIntegrity,
  assertPlanShape,
  CATALOG_REPAIR_PLAN_VERSION,
  fingerprintCatalogVersion,
  hashPlannedEntry,
  stableHash,
  type CatalogRepairPlan,
  type PlannedCatalogEntry,
  type PlannedCatalogVersion
} from "./catalogRepairPlan.js";
import { validateCatalogLanguagePair } from "./catalogPairing.js";
import { validateEntryTitle } from "./bootstrapCatalog.js";
import {
  readProductionContentStrict,
  validateDailyDropPayload,
  validateDailyDropQuality
} from "../generation/validation.js";
import { toSafeModelRoutingSummary } from "../generation/modelRouting.js";
import {
  allocateBusinessStorySourcePackets,
  isSameSourceEvent,
  type BusinessStorySourcePacket
} from "./sourceEventAllocation.js";

/**
 * Targeted repair of individual catalog pairs.
 *
 * The launch catalog is 80 versions of real, paid-for content, and an editorial
 * audit found fifteen pairs worth changing out of forty. Deleting the catalog
 * and running it again would spend the other twenty-five for nothing and
 * introduce fresh risk in items nobody complained about. So the repair is
 * addressed: name the entries, say what is wrong with them, change those and
 * nothing else.
 *
 * Two modes, and the difference is the event:
 *
 *  - REWORK keeps the event. The source packet is read back from the links the
 *    original run wrote, and the pair is regenerated against the improved
 *    prompts, taxonomy rules and distractor contract. The source is not changed
 *    to manufacture novelty.
 *  - REPLACE discards the event. Its sources and its editorial identity are
 *    excluded, a different viable event is allocated from today's pool for the
 *    same slot, and the pair is rebuilt on it.
 *
 * What both share is the order of operations: the complete FR+EN candidate is
 * generated and passed through every validator BEFORE anything existing is
 * touched. A repair that cannot produce a valid pair leaves the catalog exactly
 * as it found it.
 *
 * And both are split in two commands, because an editorial repair is reviewed by
 * a human between them:
 *
 *   PREPARE generates once, validates, and writes the candidate to a plan file.
 *   APPLY reads that plan and writes exactly what is in it.
 *
 * Apply takes no generator and no source fetcher in its dependencies at all. It
 * cannot regenerate a candidate, because it has nothing to regenerate with —
 * which is the only way to guarantee that what was approved is what is written.
 */

export type CatalogRepairMode = "rework" | "replace";

export type CatalogRepairOptions = {
  runId: string;
  entryIds: string[];
  mode: CatalogRepairMode;
  dropDate: string;
  languages: Language[];
  contentStatus: "draft" | "review" | "published";
  useLlm: boolean;
  productionStrict?: boolean;
  catalogRecencyDays?: number;
};

export type CatalogRepairDependencies = {
  generator: ContentGenerator;
  repository: ContentRepository;
  loadArticles: (language: Language, recencyDays?: number) => Promise<RankedArticle[]>;
  onProgress?: (message: string, details: Record<string, unknown>) => void;
};

export type CatalogRepairOutcome = {
  entryId: string;
  mode: CatalogRepairMode;
  status: "repaired" | "planned" | "refused";
  /** Why a refusal happened, or what a dry run would have done. */
  reason: string;
  contentItemIds: string[];
  previousSourceUrls: string[];
  newSourceUrls: string[];
  newTitles: Record<string, string>;
};

export type CatalogRepairReport = {
  mode: "catalog-repair-prepare" | "catalog-repair-apply";
  runId: string;
  repairMode: CatalogRepairMode;
  repairId: string;
  persisted: boolean;
  dryRun: boolean;
  confirmation: "CONFIRM_CATALOG_REPAIR=true" | null;
  requestedEntryIds: string[];
  outcomes: CatalogRepairOutcome[];
  counts: {
    repaired: number;
    planned: number;
    refused: number;
  };
  /** Every catalog version this run did not name. Reported to prove it was left alone. */
  untouchedVersions: number;
};

export type CatalogRepairPrepareResult = {
  report: CatalogRepairReport;
  /** Null when nothing could be prepared: there is no plan worth writing. */
  plan: CatalogRepairPlan | null;
};

/**
 * Everything apply is allowed to touch.
 *
 * No generator. No `loadArticles`. This is not an oversight and must not be
 * "fixed": it is what makes "apply performs zero LLM calls and zero RSS fetches"
 * a property of the type rather than a promise in a comment.
 */
export type CatalogRepairApplyDependencies = {
  repository: ContentRepository;
  onProgress?: (message: string, details: Record<string, unknown>) => void;
};

/**
 * PHASE 1. Generate and validate the candidates, write nothing.
 *
 * Returns the plan alongside the report. The caller persists the plan to disk;
 * a human reads it; `applyCatalogRepairPlan` writes exactly it.
 */
export async function prepareCatalogRepair(
  options: CatalogRepairOptions,
  dependencies: CatalogRepairDependencies
): Promise<CatalogRepairPrepareResult> {
  assertRepairOptions(options);

  const { repository } = dependencies;
  repository.assertPersistenceAvailable();

  const allVersions = await repository.listCatalogEntryVersions({ runId: options.runId });
  const existing = indexExistingVersions(allVersions);
  const referenceLanguage = options.languages[0];
  const counterpartLanguages = options.languages.slice(1);

  const articlesByLanguage = new Map<Language, RankedArticle[]>();
  for (const language of options.languages) {
    articlesByLanguage.set(language, await dependencies.loadArticles(language, options.catalogRecencyDays));
  }
  const canonicalPool = buildCanonicalCatalogPool(articlesByLanguage);

  // Identities already in the catalog, so a replacement cannot land on a story
  // the run is already telling somewhere else.
  const seenIdentities = new Set<string>();
  const outcomes: CatalogRepairOutcome[] = [];
  const planned: PlannedCatalogEntry[] = [];
  const repairId = `${options.mode}-${options.dropDate}-${Date.now().toString(36)}`;

  for (const entryId of options.entryIds) {
    const result = await prepareOneEntry({
      entryId,
      options,
      dependencies,
      existing,
      allVersions,
      referenceLanguage,
      counterpartLanguages,
      articlesByLanguage,
      canonicalArticles: canonicalPool.articles,
      seenIdentities
    });

    outcomes.push(result.outcome);

    if (result.planned) {
      planned.push(result.planned);
    }

    dependencies.onProgress?.("catalog repair candidate", {
      entry_id: result.outcome.entryId,
      mode: result.outcome.mode,
      status: result.outcome.status,
      reason: result.outcome.reason
    });
  }

  const report: CatalogRepairReport = {
    mode: "catalog-repair-prepare",
    runId: options.runId,
    repairMode: options.mode,
    repairId,
    // Prepare never writes. That is the whole point of the phase.
    persisted: false,
    dryRun: true,
    confirmation: null,
    requestedEntryIds: options.entryIds,
    outcomes,
    counts: {
      repaired: 0,
      planned: outcomes.filter((outcome) => outcome.status === "planned").length,
      refused: outcomes.filter((outcome) => outcome.status === "refused").length
    },
    untouchedVersions: allVersions.length
  };

  if (planned.length === 0) {
    return { report, plan: null };
  }

  return {
    report,
    plan: {
      planVersion: CATALOG_REPAIR_PLAN_VERSION,
      repairId,
      createdAt: new Date().toISOString(),
      runId: options.runId,
      mode: options.mode,
      dropDate: options.dropDate,
      languages: options.languages,
      contentStatus: options.contentStatus,
      generator: {
        useLlm: options.useLlm,
        generatorLabel: options.useLlm ? "llm" : "deterministic",
        // Provider and model identifiers only. `toSafeModelRoutingSummary` is
        // the existing secret-free view; no key ever reaches the plan file.
        modelRouting: options.useLlm ? toSafeModelRoutingSummary() : {}
      },
      entries: planned
    }
  };
}

async function prepareOneEntry(input: {
  entryId: string;
  options: CatalogRepairOptions;
  dependencies: CatalogRepairDependencies;
  existing: Map<string, CatalogEntryVersionRecord>;
  allVersions: CatalogEntryVersionRecord[];
  referenceLanguage: Language;
  counterpartLanguages: Language[];
  articlesByLanguage: Map<Language, RankedArticle[]>;
  canonicalArticles: RankedArticle[];
  seenIdentities: Set<string>;
}): Promise<{ outcome: CatalogRepairOutcome; planned?: PlannedCatalogEntry }> {
  const { dependencies, entryId, options } = input;
  const languages = [input.referenceLanguage, ...input.counterpartLanguages];
  const records = languages.map((language) => input.existing.get(versionKey(entryId, language)));

  const refuse = (
    reason: string,
    contentItemIds: string[] = []
  ): { outcome: CatalogRepairOutcome } => ({
    outcome: {
      entryId,
      mode: options.mode,
      status: "refused",
      reason,
      contentItemIds,
      previousSourceUrls: [],
      newSourceUrls: [],
      newTitles: {}
    }
  });

  if (records.some((record) => !record)) {
    return refuse(
      `No complete ${languages.join("/")} pair exists for ${entryId} under run ${options.runId}. A repair replaces a pair; it never creates one.`
    );
  }

  const versions = records as CatalogEntryVersionRecord[];
  const contentItemIds = versions.map((record) => record.contentItemId);

  // Every safety check runs before a single token is spent.
  const notInReview = versions.filter((record) => record.status !== "review");
  if (notInReview.length > 0) {
    return refuse(
      `${entryId} has ${notInReview.length} version(s) with status ${[...new Set(notInReview.map((record) => record.status))].join(", ")}. Repair only ever touches content still in review.`,
      contentItemIds
    );
  }

  const assigned = await dependencies.repository.listAssignedContentItemIds(contentItemIds);
  if (assigned.length > 0) {
    return refuse(
      `${entryId} is attached to a daily drop (${assigned.length} version(s)). A reader has already been given it, so it is no longer catalog inventory to rewrite.`,
      contentItemIds
    );
  }

  const referenceRecord = versions[0];
  const previousItem = referenceItemFromRecord(referenceRecord);
  const previousSourceUrls = previousItem?.source_urls ?? [];
  const contentType = referenceRecord.contentType;
  const miniCaseTopic = readMiniCaseTopic(referenceRecord);
  const index = readEntryIndex(referenceRecord);

  // The sources the original run linked to this pair. Read in both modes: they
  // are the packet a rework rebuilds on, and the event a replace must get away
  // from.
  const persistedSources = await dependencies.repository.listSourceArticlesForContentItem({
    contentItemId: referenceRecord.contentItemId,
    topic: referenceRecord.topic ?? defaultTopicFor(contentType, miniCaseTopic)
  });

  let packet: BusinessStorySourcePacket | undefined;
  let approvedArticles: RankedArticle[];

  if (options.mode === "rework") {
    // Keep the event. Read back from the links rather than from today's feed, so
    // a source that has since left the RSS window does not block the repair.
    if (persistedSources.length === 0) {
      return refuse(
        `${entryId} has no source linked through content_item_sources, so there is no event to rework it on.`,
        contentItemIds
      );
    }

    approvedArticles = persistedSources;
    packet = { primary: persistedSources[0], supporting: persistedSources.slice(1), articles: persistedSources };
  } else {
    // Discard the event — the EVENT, not merely the URLs. The French and
    // English reports of one story are two URLs and one event, so excluding by
    // URL alone would let the replacement land back on the story it was asked
    // to leave. Events already carried by another entry of this run are out too.
    const excludedUrls = new Set([
      ...previousSourceUrls,
      ...input.allVersions
        .filter((record) => record.catalogEntryId !== entryId)
        .flatMap((record) => readSourceUrls(record))
    ]);
    const excludedArticles = [
      ...persistedSources,
      ...input.canonicalArticles.filter((article) => excludedUrls.has(article.url))
    ];
    const candidates = input.canonicalArticles.filter(
      (article) =>
        !excludedUrls.has(article.url) &&
        !excludedArticles.some((excluded) => isSameSourceEvent(excluded, article))
    );
    const topics = contentType === "mini_case" && miniCaseTopic
      ? miniCaseTopicToContentTopics(miniCaseTopic)
      : BUSINESS_STORY_TOPICS;

    const available = allocateBusinessStorySourcePackets({
      articles: candidates,
      topics,
      count: 1,
      requireBusinessMechanism: contentType === "business_story"
    });

    if (available.length === 0) {
      return refuse(
        `No replacement event is available for ${entryId} in ${topics.join("/")} once the previous event and every event already used by this run are excluded.`,
        contentItemIds
      );
    }

    packet = available[0];
    approvedArticles = packet.articles;
  }

  // The candidate pair: generated, paired and put through every validator with
  // NO repository, so this produces content and not a single write.
  const outcome = await buildEntry({
    entryId,
    contentType,
    miniCaseTopic,
    index,
    options: bootstrapOptionsFor(options, miniCaseTopic),
    dependencies: { generator: dependencies.generator, loadArticles: dependencies.loadArticles },
    repository: undefined,
    referenceLanguage: input.referenceLanguage,
    counterpartLanguages: input.counterpartLanguages,
    articlesByLanguage: input.articlesByLanguage,
    canonicalArticles: approvedArticles,
    businessStoryMemory: [] as BusinessStoryEditorialMemoryEntry[],
    miniCaseMemory: [] as MiniCaseEditorialMemoryRecord[],
    seenIdentities: input.seenIdentities,
    existingVersions: new Map(),
    skipped: [],
    usedSourceUrls: new Set(),
    businessStoryPacket: packet
  });

  if (outcome.kind !== "entry") {
    const reason =
      outcome.kind === "rejected"
        ? `${outcome.rejection.reason}: ${outcome.rejection.details.join(" | ")}`
        : "the entry produced nothing";

    return refuse(`Candidate pair for ${entryId} was refused before anything was changed (${reason}).`, contentItemIds);
  }

  const candidateVersions = outcome.entry.versions;
  const newSourceUrls = [...new Set(candidateVersions.flatMap((version) => version.item.source_urls))];

  if (options.mode === "replace" && newSourceUrls.some((url) => previousSourceUrls.includes(url))) {
    return refuse(
      `${entryId} was asked to replace its event but the candidate cites the same source. Nothing was changed.`,
      contentItemIds
    );
  }

  const newTitles = Object.fromEntries(
    candidateVersions.map((version) => [version.language, version.item.title])
  );

  // Fingerprint each row as it stands NOW. Apply compares against these and
  // refuses if anything moved in between.
  const plannedVersions: PlannedCatalogVersion[] = [];

  for (const candidate of candidateVersions) {
    const record = versions.find((entry) => entry.language === candidate.language);

    if (!record) {
      return refuse(`${entryId} has no stored ${candidate.language} version to replace.`, contentItemIds);
    }

    const linked = await dependencies.repository.listSourceArticlesForContentItem({
      contentItemId: record.contentItemId,
      topic: record.topic ?? defaultTopicFor(contentType, miniCaseTopic)
    });

    plannedVersions.push({
      language: candidate.language,
      contentItemId: record.contentItemId,
      item: candidate.item,
      itemHash: stableHash(candidate.item),
      originalRowHash: fingerprintCatalogVersion(record, linked.map((article) => article.url)),
      originalTitle: record.title,
      originalSourceUrls: linked.map((article) => article.url)
    });
  }

  const plannedWithoutHash: Omit<PlannedCatalogEntry, "entryHash"> = {
    entryId,
    mode: options.mode,
    contentType,
    miniCaseTopic,
    index,
    versions: plannedVersions,
    approvedSources: approvedArticles,
    approvedSourcesHash: stableHash(approvedArticles),
    sourceUrls: newSourceUrls,
    previousSourceUrls,
    sourceDecision:
      options.mode === "rework"
        ? "Reworked on the event the original run linked. The source was deliberately not changed: novelty is not a reason to move an entry off a sound event."
        : `Replaced: the previous event (${previousSourceUrls.join(", ") || "none recorded"}) was excluded by event identity, as was every event already carried by another entry of this run.`,
    validation: {
      itemValidation: "passed",
      pairValidation: "passed",
      checkedAt: new Date().toISOString()
    }
  };

  return {
    outcome: {
      entryId,
      mode: options.mode,
      status: "planned",
      reason: `A complete ${languages.join("/")} pair was generated and passed every validator. Nothing was written: it is recorded in the plan for review.`,
      contentItemIds,
      previousSourceUrls,
      newSourceUrls,
      newTitles
    },
    planned: { ...plannedWithoutHash, entryHash: hashPlannedEntry(plannedWithoutHash) }
  };
}

/**
 * PHASE 2. Write exactly the candidates recorded in the plan.
 *
 * Nothing here generates. `CatalogRepairApplyDependencies` carries a repository
 * and nothing else, so there is no generator to call and no feed to fetch: the
 * guarantee is structural, not a matter of discipline.
 *
 * The order is: check the file, check the database still matches what the file
 * was prepared against, re-run the deterministic validators over the frozen
 * candidate, and only then write.
 */
export async function applyCatalogRepairPlan(
  plan: CatalogRepairPlan,
  options: {
    persist: boolean;
    /** Apply only these entries. Empty means every entry in the plan. */
    onlyEntryIds?: string[];
  },
  dependencies: CatalogRepairApplyDependencies
): Promise<CatalogRepairReport> {
  assertPlanShape(plan);
  assertPlanIntegrity(plan);

  const { repository } = dependencies;
  repository.assertPersistenceAvailable();

  const selected = options.onlyEntryIds?.length
    ? plan.entries.filter((entry) => options.onlyEntryIds?.includes(entry.entryId))
    : plan.entries;

  // Naming an entry the plan does not hold is reported as exactly that, before
  // the emptier "selected nothing": never silently skip what was asked for.
  const missing = (options.onlyEntryIds ?? []).filter(
    (entryId) => !plan.entries.some((entry) => entry.entryId === entryId)
  );

  if (missing.length > 0) {
    throw new Error(
      `catalog-repair apply was asked for entries the plan does not contain: ${missing.join(", ")}. The plan holds: ${plan.entries.map((entry) => entry.entryId).join(", ")}.`
    );
  }

  if (selected.length === 0) {
    throw new Error(
      `catalog-repair apply selected no entries. The plan holds: ${plan.entries.map((entry) => entry.entryId).join(", ")}.`
    );
  }

  const allVersions = await repository.listCatalogEntryVersions({ runId: plan.runId });
  const existing = indexExistingVersions(allVersions);
  const outcomes: CatalogRepairOutcome[] = [];

  for (const entry of selected) {
    const outcome = await applyOneEntry({ entry, plan, options, repository, existing });

    outcomes.push(outcome);
    dependencies.onProgress?.("catalog repair applied", {
      entry_id: outcome.entryId,
      mode: outcome.mode,
      status: outcome.status,
      reason: outcome.reason
    });
  }

  const touched = new Set(
    outcomes.filter((outcome) => outcome.status === "repaired").flatMap((outcome) => outcome.contentItemIds)
  );

  return {
    mode: "catalog-repair-apply",
    runId: plan.runId,
    repairMode: plan.mode,
    repairId: plan.repairId,
    persisted: options.persist,
    dryRun: !options.persist,
    confirmation: options.persist ? "CONFIRM_CATALOG_REPAIR=true" : null,
    requestedEntryIds: selected.map((entry) => entry.entryId),
    outcomes,
    counts: {
      repaired: outcomes.filter((outcome) => outcome.status === "repaired").length,
      planned: outcomes.filter((outcome) => outcome.status === "planned").length,
      refused: outcomes.filter((outcome) => outcome.status === "refused").length
    },
    untouchedVersions: allVersions.filter((version) => !touched.has(version.contentItemId)).length
  };
}

async function applyOneEntry(input: {
  entry: PlannedCatalogEntry;
  plan: CatalogRepairPlan;
  options: { persist: boolean };
  repository: ContentRepository;
  existing: Map<string, CatalogEntryVersionRecord>;
}): Promise<CatalogRepairOutcome> {
  const { entry, plan, repository } = input;
  const contentItemIds = entry.versions.map((version) => version.contentItemId);

  const refuse = (reason: string): CatalogRepairOutcome => ({
    entryId: entry.entryId,
    mode: entry.mode,
    status: "refused",
    reason,
    contentItemIds,
    previousSourceUrls: entry.previousSourceUrls,
    newSourceUrls: entry.sourceUrls,
    newTitles: {}
  });

  const newTitles = Object.fromEntries(
    entry.versions.map((version) => [version.language, version.item.title])
  );

  // The database must still be where the plan left it.
  const currentRecords: CatalogEntryVersionRecord[] = [];

  for (const version of entry.versions) {
    const record = input.existing.get(versionKey(entry.entryId, version.language));

    if (!record) {
      return refuse(
        `${entry.entryId} no longer has a stored ${version.language} version under run ${plan.runId}. The plan is stale.`
      );
    }

    if (record.contentItemId !== version.contentItemId) {
      return refuse(
        `${entry.entryId} (${version.language}) is now content item ${record.contentItemId}, not ${version.contentItemId}. The plan is stale.`
      );
    }

    if (record.status !== "review") {
      return refuse(
        `${entry.entryId} (${version.language}) is now status ${record.status}. Repair only ever touches content still in review.`
      );
    }

    const linked = await repository.listSourceArticlesForContentItem({
      contentItemId: record.contentItemId,
      topic: record.topic ?? defaultTopicFor(entry.contentType, entry.miniCaseTopic)
    });
    const fingerprint = fingerprintCatalogVersion(record, linked.map((article) => article.url));

    if (fingerprint !== version.originalRowHash) {
      return refuse(
        `${entry.entryId} (${version.language}) has changed since the plan was prepared. Applying would silently discard whatever happened in between. Re-run prepare and review again.`
      );
    }

    currentRecords.push(record);
  }

  const assigned = await repository.listAssignedContentItemIds(contentItemIds);

  if (assigned.length > 0) {
    return refuse(
      `${entry.entryId} is now attached to a daily drop (${assigned.length} version(s)). A reader has been given it since the plan was prepared.`
    );
  }

  // Re-validate the frozen candidate. Deterministic only: same structural,
  // grounding and pair checks prepare ran, against the plan's own approved
  // source set, so the closure question is asked identically on both sides.
  const issues = validateFrozenCandidate(entry, plan);

  if (issues.length > 0) {
    return refuse(`${entry.entryId} failed re-validation at apply: ${issues.join(" | ")}`);
  }

  if (!input.options.persist) {
    return {
      entryId: entry.entryId,
      mode: entry.mode,
      status: "planned",
      reason: `The plan matches the database and the candidate re-validated. Nothing was written: --persist and CONFIRM_CATALOG_REPAIR=true were not both given.`,
      contentItemIds,
      previousSourceUrls: entry.previousSourceUrls,
      newSourceUrls: entry.sourceUrls,
      newTitles
    };
  }

  await writePairOrRestore({
    entryId: entry.entryId,
    options: {
      runId: plan.runId,
      entryIds: [entry.entryId],
      mode: entry.mode,
      dropDate: plan.dropDate,
      languages: plan.languages,
      contentStatus: plan.contentStatus,
      useLlm: plan.generator?.useLlm ?? false
    },
    repository,
    versions: currentRecords,
    candidateVersions: entry.versions.map((version) => ({
      language: version.language,
      item: version.item
    })),
    approvedArticles: entry.approvedSources,
    contentType: entry.contentType,
    miniCaseTopic: entry.miniCaseTopic,
    index: entry.index
  });

  return {
    entryId: entry.entryId,
    mode: entry.mode,
    status: "repaired",
    reason: `Both versions were replaced in place from the reviewed plan, keeping their content item ids.`,
    contentItemIds,
    previousSourceUrls: entry.previousSourceUrls,
    newSourceUrls: entry.sourceUrls,
    newTitles
  };
}

/**
 * The deterministic half of validation, re-run at apply.
 *
 * Nothing here calls a model or a feed. It re-asks the structural, grounding and
 * pair questions of the frozen candidate — most importantly whether every cited
 * URL still resolves inside the plan's own approved set, which is what stops a
 * URL hand-added to a plan from ever being written.
 */
function validateFrozenCandidate(entry: PlannedCatalogEntry, plan: CatalogRepairPlan): string[] {
  const issues: string[] = [];
  const strict = readProductionContentStrict();

  for (const version of entry.versions) {
    issues.push(
      ...validateEntryTitle(version.item, version.language, entry.entryId).map(
        (issue) => `${issue.path}: ${issue.message}`
      )
    );

    const payload = {
      drop_date: plan.dropDate,
      language: version.language,
      prompt_version: "catalog_repair",
      generator_version: "catalog_repair",
      items: [version.item]
    };

    issues.push(
      ...validateDailyDropPayload(payload).map((issue) => `${issue.path}: ${issue.message}`)
    );
    issues.push(
      ...validateDailyDropQuality(payload, {
        articles: entry.approvedSources,
        productionStrict: strict,
        miniCaseProductTopics: entry.miniCaseTopic ? [entry.miniCaseTopic] : undefined
      })
        .issues.filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.path}: ${issue.message}`)
    );

    // The closed set. A URL added to the plan by hand has no approved article
    // behind it and is refused here, whatever the hashes say.
    const resolved = resolveCatalogSourceArticles(version.item, entry.approvedSources);

    if (resolved.unresolved.length > 0) {
      issues.push(
        `${entry.entryId}.${version.language}.source_urls: cited source URL(s) outside the plan's approved material: ${resolved.unresolved.join(", ")}`
      );
    }
  }

  if (entry.versions.length >= 2) {
    issues.push(
      ...validateCatalogLanguagePair(
        { language: entry.versions[0].language, item: entry.versions[0].item },
        { language: entry.versions[1].language, item: entry.versions[1].item },
        entry.entryId
      ).map((issue) => `${issue.path}: ${issue.message}`)
    );
  }

  return issues;
}

/**
 * Write both halves, and put the first one back if the second fails.
 *
 * The Supabase client exposes no multi-statement transaction, so two updates
 * cannot be made genuinely atomic from here. What CAN be guaranteed is that the
 * pair never ends up half-new: every check runs first, the complete candidate is
 * validated first, and if the second write fails the first is restored from the
 * snapshot read before any of it started.
 *
 * The remaining boundary, stated plainly: if the compensating write ALSO fails —
 * the database is unreachable between the two calls — the pair is left with a
 * new reference version and an old counterpart, and the error names both content
 * item ids so it can be finished by hand. Nothing silently proceeds.
 */
async function writePairOrRestore(input: {
  entryId: string;
  options: CatalogRepairOptions;
  repository: ContentRepository;
  versions: CatalogEntryVersionRecord[];
  candidateVersions: Array<{ language: Language; item: GeneratedContentItem }>;
  approvedArticles: RankedArticle[];
  contentType: "business_story" | "mini_case";
  miniCaseTopic: MiniCaseTopicId | null;
  index: number;
}): Promise<void> {
  const byLanguage = new Map(input.versions.map((record) => [record.language, record]));
  const written: Array<{ record: CatalogEntryVersionRecord; item: GeneratedContentItem }> = [];

  for (const candidate of input.candidateVersions) {
    const record = byLanguage.get(candidate.language);

    if (!record) {
      continue;
    }

    const resolved = resolveCatalogSourceArticles(candidate.item, input.approvedArticles);

    try {
      await input.repository.replaceCatalogVersionContent({
        contentItemId: record.contentItemId,
        item: candidate.item,
        articles: resolved.articles,
        dropDate: input.options.dropDate,
        contentStatus: input.options.contentStatus,
        metadata: repairMetadata(input, record)
      });
      written.push({ record, item: candidate.item });
    } catch (error) {
      await restoreWritten(input.repository, written, input.options);

      throw new Error(
        `catalog-repair failed while writing ${input.entryId} (${candidate.language}, content item ${record.contentItemId}). ${written.length} earlier version(s) were restored. Original error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

async function restoreWritten(
  repository: ContentRepository,
  written: Array<{ record: CatalogEntryVersionRecord; item: GeneratedContentItem }>,
  options: CatalogRepairOptions
): Promise<void> {
  for (const entry of written) {
    const previous = referenceItemFromRecord(entry.record);

    if (!previous) {
      continue;
    }

    const previousArticles = await repository.listSourceArticlesForContentItem({
      contentItemId: entry.record.contentItemId,
      topic: entry.record.topic ?? "business"
    });

    await repository.replaceCatalogVersionContent({
      contentItemId: entry.record.contentItemId,
      item: previous,
      articles: previousArticles,
      dropDate: options.dropDate,
      contentStatus: "review",
      metadata: entry.record.metadata
    });
  }
}

/**
 * The repaired version's metadata.
 *
 * Everything that identifies the slot is carried over unchanged — run id, entry
 * id, index, content type, topic — because the repair replaces what an entry
 * says, never which entry it is. The dedup key is deliberately dropped: it was
 * computed from the old source fingerprint, and leaving it would let a later run
 * match this row to content it no longer holds.
 */
function repairMetadata(
  input: {
    options: CatalogRepairOptions;
    contentType: "business_story" | "mini_case";
    miniCaseTopic: MiniCaseTopicId | null;
    index: number;
    entryId: string;
  },
  record: CatalogEntryVersionRecord
): Record<string, unknown> {
  const { dedup_key: _key, dedup_run_id: _runId, source_url_fingerprint: _fingerprint, ...carried } =
    record.metadata as Record<string, unknown>;

  return {
    ...carried,
    scheduler_mode: "bootstrap-catalog",
    scheduler_run_id: input.entryId,
    bootstrap_run_id: input.options.runId,
    catalog_entry_id: input.entryId,
    catalog_entry_index: input.index,
    catalog_content_type: input.contentType,
    catalog_mini_case_topic: input.miniCaseTopic,
    content_status: input.options.contentStatus,
    use_llm: input.options.useLlm,
    catalog_repair_mode: input.options.mode,
    catalog_repaired_at: new Date().toISOString()
  };
}

function bootstrapOptionsFor(
  options: CatalogRepairOptions,
  miniCaseTopic: MiniCaseTopicId | null
): BootstrapCatalogOptions {
  return {
    dropDate: options.dropDate,
    languages: options.languages,
    businessStoryCount: 0,
    miniCaseCountPerTopic: 0,
    miniCaseTopics: miniCaseTopic ? [miniCaseTopic] : [],
    persist: false,
    contentStatus: options.contentStatus,
    runId: options.runId,
    useLlm: options.useLlm,
    productionStrict: options.productionStrict,
    catalogRecencyDays: options.catalogRecencyDays
  };
}

const BUSINESS_STORY_TOPICS: TopicId[] = ["business", "finance", "tech_ai"];

function readMiniCaseTopic(record: CatalogEntryVersionRecord): MiniCaseTopicId | null {
  const fromMetadata = record.metadata.catalog_mini_case_topic ?? record.metadata.product_topic;
  return typeof fromMetadata === "string" ? (fromMetadata as MiniCaseTopicId) : null;
}

function readEntryIndex(record: CatalogEntryVersionRecord): number {
  const value = record.metadata.catalog_entry_index;

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  // Fall back to the position encoded in the entry id: `...-mini-case-ai-04`.
  const match = /-(\d+)$/.exec(record.catalogEntryId);
  return match ? Math.max(0, Number(match[1]) - 1) : 0;
}

function readSourceUrls(record: CatalogEntryVersionRecord): string[] {
  const urls = record.metadata.source_urls;
  return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === "string") : [];
}

function defaultTopicFor(
  contentType: "business_story" | "mini_case",
  miniCaseTopic: MiniCaseTopicId | null
): TopicId {
  if (contentType === "mini_case" && miniCaseTopic) {
    return miniCaseTopicToContentTopics(miniCaseTopic)[0];
  }

  return BUSINESS_STORY_TOPICS[0];
}

function assertRepairOptions(options: CatalogRepairOptions): void {
  if (!options.runId) {
    throw new Error("catalog-repair requires --run-id.");
  }

  if (options.entryIds.length === 0) {
    throw new Error("catalog-repair requires at least one --entry-id.");
  }

  if (new Set(options.entryIds).size !== options.entryIds.length) {
    throw new Error("catalog-repair entry ids must be unique.");
  }

  for (const entryId of options.entryIds) {
    if (!entryId.startsWith(options.runId)) {
      throw new Error(
        `catalog-repair refused ${entryId}: an entry id must belong to run ${options.runId}. Repairing an entry from another run is never intended.`
      );
    }
  }

  if (options.mode !== "rework" && options.mode !== "replace") {
    throw new Error("catalog-repair --mode must be rework or replace.");
  }

  if (options.languages.length < 2) {
    throw new Error("catalog-repair repairs a language pair and needs at least two languages.");
  }
}
