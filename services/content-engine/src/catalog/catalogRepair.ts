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
 */

export type CatalogRepairMode = "rework" | "replace";

export type CatalogRepairOptions = {
  runId: string;
  entryIds: string[];
  mode: CatalogRepairMode;
  dropDate: string;
  languages: Language[];
  contentStatus: "draft" | "review" | "published";
  /** Writes are opt-in and additionally gated on CONFIRM_CATALOG_REPAIR=true. */
  persist: boolean;
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
  mode: "catalog-repair";
  runId: string;
  repairMode: CatalogRepairMode;
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

export async function runCatalogRepair(
  options: CatalogRepairOptions,
  dependencies: CatalogRepairDependencies
): Promise<CatalogRepairReport> {
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

  for (const entryId of options.entryIds) {
    const outcome = await repairOneEntry({
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

    outcomes.push(outcome);
    dependencies.onProgress?.("catalog repair entry", {
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
    mode: "catalog-repair",
    runId: options.runId,
    repairMode: options.mode,
    persisted: options.persist,
    dryRun: !options.persist,
    confirmation: options.persist ? "CONFIRM_CATALOG_REPAIR=true" : null,
    requestedEntryIds: options.entryIds,
    outcomes,
    counts: {
      repaired: outcomes.filter((outcome) => outcome.status === "repaired").length,
      planned: outcomes.filter((outcome) => outcome.status === "planned").length,
      refused: outcomes.filter((outcome) => outcome.status === "refused").length
    },
    untouchedVersions: allVersions.filter((version) => !touched.has(version.contentItemId)).length
  };
}

async function repairOneEntry(input: {
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
}): Promise<CatalogRepairOutcome> {
  const { dependencies, entryId, options } = input;
  const languages = [input.referenceLanguage, ...input.counterpartLanguages];
  const records = languages.map((language) => input.existing.get(versionKey(entryId, language)));

  const refuse = (reason: string, contentItemIds: string[] = []): CatalogRepairOutcome => ({
    entryId,
    mode: options.mode,
    status: "refused",
    reason,
    contentItemIds,
    previousSourceUrls: [],
    newSourceUrls: [],
    newTitles: {}
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

  if (!options.persist) {
    return {
      entryId,
      mode: options.mode,
      status: "planned",
      reason: `A complete ${languages.join("/")} pair was generated and passed every validator. Nothing was written: this is a dry run.`,
      contentItemIds,
      previousSourceUrls,
      newSourceUrls,
      newTitles
    };
  }

  await writePairOrRestore({
    entryId,
    options,
    repository: dependencies.repository,
    versions,
    candidateVersions,
    approvedArticles,
    contentType,
    miniCaseTopic,
    index
  });

  return {
    entryId,
    mode: options.mode,
    status: "repaired",
    reason: `Both ${languages.join("/")} versions were replaced in place, keeping their content item ids.`,
    contentItemIds,
    previousSourceUrls,
    newSourceUrls,
    newTitles
  };
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
