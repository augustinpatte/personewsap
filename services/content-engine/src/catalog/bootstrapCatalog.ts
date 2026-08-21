import {
  MINI_CASE_TOPIC_IDS,
  miniCaseTopicToContentTopics,
  type BusinessStory,
  type BusinessStoryEditorialMemoryEntry,
  type GeneratedContentItem,
  type Language,
  type MiniCaseChallenge,
  type MiniCaseTopicId,
  type RankedArticle,
  type TopicId
} from "../domain.js";
import {
  buildBusinessStoryEditorialMemory,
  buildBusinessStoryMemoryContext,
  normalizeMemoryKey,
  slugify
} from "../generation/editorialMemory.js";
import type { ContentGenerator } from "../generation/types.js";
import {
  readProductionContentStrict,
  validateDailyDropPayload,
  validateDailyDropQuality,
  type ValidationIssue
} from "../generation/validation.js";
import {
  buildMiniCaseMemoryContext,
  miniCaseMemoryFromItem,
  slugifyMiniCaseTitle,
  type MiniCaseEditorialMemoryRecord
} from "../miniCase/editorialMemory.js";
import type { ContentRepository } from "../storage/contentRepository.js";
import { alignCounterpartEditorialIdentity, validateCatalogLanguagePair } from "./catalogPairing.js";
import {
  allocateBusinessStorySourcePackets,
  type BusinessStorySourcePacket
} from "./businessStoryAllocation.js";
import {
  canonicalizeItemSourceUrls,
  resolveCatalogSourceArticles
} from "./catalogSourceResolution.js";
import {
  assessBusinessStoryCapacity,
  buildCanonicalCatalogPool,
  InsufficientCatalogSourceMaterialError
} from "./canonicalSourcePool.js";
import {
  clampCatalogRecencyDays,
  DEFAULT_CATALOG_SOURCE_RECENCY_DAYS,
  MAX_CATALOG_SOURCE_RECENCY_DAYS
} from "./catalogRecency.js";
import {
  indexExistingVersions,
  referenceItemFromRecord,
  versionKey
} from "./catalogResume.js";
import type { CatalogEntryVersionRecord } from "../storage/contentRepository.js";

/**
 * Catalog bootstrap: builds the INITIAL editorial inventory (Business Stories and
 * Mini Cases, each in FR and EN) so the product can be tested with real content
 * before automated production starts.
 *
 * Three deliberate boundaries:
 *
 *  - It reuses the production prompts and validators unchanged. This module is a
 *    batching layer AROUND the existing generator: it decides how many entries to
 *    ask for, feeds accumulated editorial memory back in between entries, and
 *    pairs the two language versions. It never rewrites editorial instructions.
 *  - It produces INVENTORY only. It stores content items and editorial memory; it
 *    never creates daily drops and never assigns content to a user. Assignment
 *    stays the daily job's responsibility, so the one-daily-drop principle holds.
 *  - It refuses rather than fabricates. When a generated entry duplicates an
 *    entry already in the batch, or fails validation, or fails FR/EN parity, the
 *    entry is dropped and reported with a reason.
 */

export const DEFAULT_BUSINESS_STORY_COUNT = 10;
export const DEFAULT_MINI_CASE_COUNT_PER_TOPIC = 5;

export type BootstrapCatalogOptions = {
  dropDate: string;
  /** First language is the reference version; the rest are generated as its pairs. */
  languages: Language[];
  businessStoryCount: number;
  miniCaseCountPerTopic: number;
  miniCaseTopics: MiniCaseTopicId[];
  /** Writes are opt-in and additionally gated on CONFIRM_BOOTSTRAP_CATALOG=true by the CLI. */
  persist: boolean;
  contentStatus: "draft" | "review" | "published";
  runId: string;
  useLlm: boolean;
  productionStrict?: boolean;
  /** Catalog source window in days. Widened only by the capacity preflight. */
  catalogRecencyDays?: number;
  /**
   * Continue an interrupted persisted run under the same runId.
   *
   * Every version already stored for this run is skipped whole: no LLM call, no
   * write, no touch to its rows or source links. Only the missing versions are
   * produced. Off by default, and meaningless without a repository.
   */
  resume?: boolean;
};

export type BootstrapCatalogDependencies = {
  generator: ContentGenerator;
  /**
   * Ranked source material for one language.
   *
   * `recencyDays` lets the capacity preflight widen the catalog window, within
   * the bounds catalogRecency enforces, when the default week cannot support
   * the requested number of Business Stories.
   */
  loadArticles: (language: Language, recencyDays?: number) => Promise<RankedArticle[]>;
  /** Omitted in dry-run. Required for persist mode. */
  repository?: ContentRepository;
  /**
   * Progress sink for events an aborted run would otherwise take with it.
   *
   * `rejected[]` is only returned when the run completes. A run that dies on the
   * last entry loses the record of why the first thirty were refused, which is
   * exactly how ten Business Stories disappeared without a trace.
   */
  onProgress?: (message: string, details: Record<string, unknown>) => void;
};

export type CatalogEntryVersion = {
  language: Language;
  item: GeneratedContentItem;
  contentItemId: string | null;
  reusedExistingContentItem: boolean;
};

export type CatalogEntry = {
  entryId: string;
  contentType: "business_story" | "mini_case";
  miniCaseTopic: MiniCaseTopicId | null;
  index: number;
  versions: CatalogEntryVersion[];
};

export type RejectedCatalogEntry = {
  entryId: string;
  contentType: "business_story" | "mini_case";
  miniCaseTopic: MiniCaseTopicId | null;
  index: number;
  reason:
    | "generation_failed"
    | "validation_failed"
    | "duplicate_editorial_identity"
    | "language_pair_failed"
    | "no_source_material";
  details: string[];
};

/** A version that already existed and was therefore not regenerated. */
export type SkippedCatalogVersion = {
  entryId: string;
  language: Language;
  contentItemId: string;
};

export type BootstrapCatalogOutput = {
  mode: "bootstrap-catalog";
  persisted: boolean;
  dryRun: boolean;
  confirmation: "CONFIRM_BOOTSTRAP_CATALOG=true" | null;
  runId: string;
  dropDate: string;
  languages: Language[];
  referenceLanguage: Language;
  generator: "llm" | "deterministic";
  contentStatus: BootstrapCatalogOptions["contentStatus"];
  requested: {
    businessStories: number;
    miniCasesPerTopic: number;
    miniCaseTopics: MiniCaseTopicId[];
    totalEntries: number;
    totalVersions: number;
  };
  counts: {
    businessStoryEntries: number;
    miniCaseEntries: number;
    totalEntries: number;
    versionsByContentTypeAndLanguage: Record<string, number>;
    miniCaseEntriesByTopic: Record<string, number>;
    miniCaseVersionsByTopicAndLanguage: Record<string, number>;
    persistedContentItems: number;
    reusedExistingContentItems: number;
    rejectedEntries: number;
  };
  entries: CatalogEntry[];
  rejected: RejectedCatalogEntry[];
  /** Versions found already persisted under this runId and left untouched. */
  skipped: SkippedCatalogVersion[];
  /** Always empty: the bootstrap never publishes an edition or assigns a user drop. */
  dailyDropsCreated: 0;
};

export async function runBootstrapCatalog(
  options: BootstrapCatalogOptions,
  dependencies: BootstrapCatalogDependencies
): Promise<BootstrapCatalogOutput> {
  assertOptions(options);

  const referenceLanguage = options.languages[0];
  const counterpartLanguages = options.languages.slice(1);
  const repository = options.persist ? requireRepository(dependencies.repository) : undefined;

  const loadPools = async (recencyDays: number | undefined): Promise<Map<Language, RankedArticle[]>> => {
    const pools = new Map<Language, RankedArticle[]>();

    for (const language of options.languages) {
      pools.set(language, await dependencies.loadArticles(language, recencyDays));
    }

    return pools;
  };

  const baseWindowDays = clampCatalogRecencyDays(
    options.catalogRecencyDays ?? DEFAULT_CATALOG_SOURCE_RECENCY_DAYS
  );
  let catalogWindowDays = baseWindowDays;
  let articlesByLanguage = await loadPools(options.catalogRecencyDays);

  // One pool for the whole catalog. Which events exist is decided before, and
  // independently of, which language an entry is written in.
  let canonicalPool = buildCanonicalCatalogPool(articlesByLanguage);

  let businessStoryCapacity = assessBusinessStoryCapacity({
    articles: canonicalPool.articles,
    topics: BUSINESS_STORY_SOURCE_TOPICS,
    requested: options.businessStoryCount
  });

  // Bounded widening: a week is the normal question, and the ceiling is the
  // source layer's own staleness limit. Only reached when the default window
  // genuinely cannot support the requested inventory.
  if (options.businessStoryCount > 0 && !businessStoryCapacity.sufficient && baseWindowDays < MAX_CATALOG_SOURCE_RECENCY_DAYS) {
    catalogWindowDays = MAX_CATALOG_SOURCE_RECENCY_DAYS;
    articlesByLanguage = await loadPools(catalogWindowDays);
    canonicalPool = buildCanonicalCatalogPool(articlesByLanguage);
    businessStoryCapacity = assessBusinessStoryCapacity({
      articles: canonicalPool.articles,
      topics: BUSINESS_STORY_SOURCE_TOPICS,
      requested: options.businessStoryCount
    });
  }

  // Refuse before the first Business Story call rather than generating ten
  // variants of seven events and letting the duplicate validator reject them.
  if (options.businessStoryCount > 0 && !businessStoryCapacity.sufficient) {
    throw new InsufficientCatalogSourceMaterialError({
      capacity: businessStoryCapacity,
      catalogWindowDays
    });
  }

  // The preflight's promise, made concrete. Ten viable events counted becomes
  // ten packets allocated, each built on a different primary event, before any
  // model is asked to write anything.
  const businessStoryPackets = allocateBusinessStorySourcePackets({
    articles: canonicalPool.articles,
    topics: BUSINESS_STORY_SOURCE_TOPICS,
    count: options.businessStoryCount
  });

  dependencies.onProgress?.("catalog source allocation ready", {
    canonical_articles: canonicalPool.articles.length,
    business_story_packets: businessStoryPackets.length,
    requested_business_stories: options.businessStoryCount,
    catalog_window_days: catalogWindowDays
  });

  // Editorial memory accumulates across the whole batch so entry N+1 sees every
  // entry already produced in this run. When persisting, existing production
  // memory is loaded first so the bootstrap does not repeat published content.
  const businessStoryMemory: BusinessStoryEditorialMemoryEntry[] = repository
    ? (await repository.listBusinessStoryMemoryContext({ language: referenceLanguage, dropDate: options.dropDate }))
        .recentStories
    : [];
  const miniCaseMemory: MiniCaseEditorialMemoryRecord[] = repository
    ? (await repository.listMiniCaseMemoryContext({ language: referenceLanguage, dropDate: options.dropDate }))
        .recentOverall
    : [];

  const entries: CatalogEntry[] = [];
  const rejected: RejectedCatalogEntry[] = [];
  const skipped: SkippedCatalogVersion[] = [];
  const seenIdentities = new Set<string>();
  // Source URLs already used, per topic batch. Business Stories share one
  // bucket; each Mini Case topic gets its own, so one topic exhausting its pool
  // never narrows another's.
  const usedSourceUrlsByBatch = new Map<string, Set<string>>();

  // Resume reads the whole run's existing inventory once, before any LLM call,
  // so every decision to skip is made from persisted fact rather than from a
  // failure encountered mid-generation.
  const existingVersions =
    options.resume && repository
      ? indexExistingVersions(await repository.listCatalogEntryVersions({ runId: options.runId }))
      : new Map<string, CatalogEntryVersionRecord>();

  for (let index = 0; index < options.businessStoryCount; index += 1) {
    const entryId = buildEntryId(options.runId, "business-story", null, index);
    const outcome = await buildEntry({
      entryId,
      contentType: "business_story",
      miniCaseTopic: null,
      index,
      options,
      dependencies,
      repository,
      referenceLanguage,
      counterpartLanguages,
      articlesByLanguage,
      canonicalArticles: canonicalPool.articles,
      businessStoryMemory,
      miniCaseMemory,
      seenIdentities,
      existingVersions,
      skipped,
      usedSourceUrls: sourceBatchFor(usedSourceUrlsByBatch, "business_story", null),
      businessStoryPacket: businessStoryPackets[index]
    });

    if (outcome.kind === "rejected") {
      rejected.push(outcome.rejection);
      reportRejection(dependencies, outcome.rejection);
      continue;
    }

    if (outcome.kind === "skipped") {
      continue;
    }

    entries.push(outcome.entry);
    for (const version of outcome.entry.versions) {
      if (version.item.content_type === "business_story") {
        businessStoryMemory.unshift(
          buildBusinessStoryEditorialMemory({
            item: version.item,
            contentItemId: version.contentItemId,
            publishedDate: options.dropDate
          })
        );
      }
    }
  }

  for (const miniCaseTopic of options.miniCaseTopics) {
    for (let index = 0; index < options.miniCaseCountPerTopic; index += 1) {
      const entryId = buildEntryId(options.runId, "mini-case", miniCaseTopic, index);
      const outcome = await buildEntry({
        entryId,
        contentType: "mini_case",
        miniCaseTopic,
        index,
        options,
        dependencies,
        repository,
        referenceLanguage,
        counterpartLanguages,
        articlesByLanguage,
        canonicalArticles: canonicalPool.articles,
        businessStoryMemory,
        miniCaseMemory,
        seenIdentities,
        existingVersions,
        skipped,
        usedSourceUrls: sourceBatchFor(usedSourceUrlsByBatch, "mini_case", miniCaseTopic),
        businessStoryPacket: undefined
      });

      if (outcome.kind === "rejected") {
        rejected.push(outcome.rejection);
        reportRejection(dependencies, outcome.rejection);
        continue;
      }

      if (outcome.kind === "skipped") {
        continue;
      }

      entries.push(outcome.entry);
      for (const version of outcome.entry.versions) {
        const record = miniCaseMemoryFromItem({
          item: version.item,
          contentItemId: version.contentItemId,
          publishedDate: options.dropDate
        });
        if (record) {
          miniCaseMemory.unshift(record);
        }
      }
    }
  }

  return buildOutput({ options, referenceLanguage, entries, rejected, skipped });
}

type BuildEntryInput = {
  entryId: string;
  contentType: "business_story" | "mini_case";
  miniCaseTopic: MiniCaseTopicId | null;
  index: number;
  options: BootstrapCatalogOptions;
  dependencies: BootstrapCatalogDependencies;
  repository: ContentRepository | undefined;
  referenceLanguage: Language;
  counterpartLanguages: Language[];
  articlesByLanguage: Map<Language, RankedArticle[]>;
  /** Every language's material as one pool: what an entry may be built from. */
  canonicalArticles: RankedArticle[];
  businessStoryMemory: BusinessStoryEditorialMemoryEntry[];
  miniCaseMemory: MiniCaseEditorialMemoryRecord[];
  seenIdentities: Set<string>;
  /** Versions already persisted for this run, keyed by `entryId::language`. */
  existingVersions: Map<string, CatalogEntryVersionRecord>;
  skipped: SkippedCatalogVersion[];
  /** Sources already used by earlier entries of this topic batch. */
  usedSourceUrls: Set<string>;
  /**
   * The distinct primary event allocated to this Business Story, with any
   * approved coverage of the same event. Undefined for a Mini Case, which may
   * legitimately build several scenarios on one source and therefore still
   * selects from the topic-scoped pool.
   */
  businessStoryPacket: BusinessStorySourcePacket | undefined;
};

type BuildEntryOutcome =
  | { kind: "entry"; entry: CatalogEntry }
  | { kind: "rejected"; rejection: RejectedCatalogEntry }
  /** Nothing to do: every language of this entry is already persisted. */
  | { kind: "skipped" };

async function buildEntry(input: BuildEntryInput): Promise<BuildEntryOutcome> {
  const reject = (reason: RejectedCatalogEntry["reason"], details: string[]): BuildEntryOutcome => ({
    kind: "rejected",
    rejection: {
      entryId: input.entryId,
      contentType: input.contentType,
      miniCaseTopic: input.miniCaseTopic,
      index: input.index,
      reason,
      details
    }
  });

  const requestedLanguages = [input.referenceLanguage, ...input.counterpartLanguages];
  const alreadyPersisted = requestedLanguages.filter((language) =>
    input.existingVersions.has(versionKey(input.entryId, language))
  );

  // Every language already stored: this entry is done. No generation, no write,
  // and nothing touched.
  if (alreadyPersisted.length === requestedLanguages.length) {
    for (const language of requestedLanguages) {
      const record = input.existingVersions.get(versionKey(input.entryId, language));

      if (record) {
        input.skipped.push({
          entryId: input.entryId,
          language,
          contentItemId: record.contentItemId
        });
      }
    }

    return { kind: "skipped" };
  }

  // The factual basis comes from the canonical pool, not from the reference
  // language's slice of it: an English event is as eligible as a French one for
  // an entry whose first version happens to be written in French.
  //
  // A Business Story gets the one event allocated to it. A Mini Case still gets
  // the topic-scoped pool, because several distinct cases can legitimately be
  // built on one source.
  const referenceArticles = input.businessStoryPacket
    ? input.businessStoryPacket.articles
    : rotateSourceWindow(
        input.canonicalArticles,
        newsletterTopicsForEntry(input),
        input.index,
        input.usedSourceUrls
      );
  const persistedReference = input.existingVersions.get(
    versionKey(input.entryId, input.referenceLanguage)
  );

  let referenceItem: GeneratedContentItem;

  if (persistedReference) {
    // Half-written pair: the reference version survived the interruption. It is
    // read back rather than regenerated, so the counterpart adapts the case that
    // actually exists in the catalog instead of a fresh one.
    const rehydrated = referenceItemFromRecord(persistedReference);

    if (!rehydrated) {
      return reject("no_source_material", [
        `Persisted ${input.referenceLanguage} version of ${input.entryId} cites no source URLs, so its counterpart cannot be paired to it.`
      ]);
    }

    referenceItem = rehydrated;
    input.skipped.push({
      entryId: input.entryId,
      language: input.referenceLanguage,
      contentItemId: persistedReference.contentItemId
    });
  } else {
    if (referenceArticles.length === 0) {
      return reject("no_source_material", [`No ranked source articles available for ${input.referenceLanguage}.`]);
    }

    try {
      referenceItem = await generateOne({
        input,
        language: input.referenceLanguage,
        articles: referenceArticles,
        crossLanguageSources: true,
        languagePair: undefined
      });
    } catch (error) {
      return reject("generation_failed", [errorMessage(error)]);
    }
  }

  // THE approved source universe for this entry, from here to the last write.
  //
  // A resumed reference was written against a pool this run no longer holds, so
  // its own sources are looked up across the whole canonical pool; a freshly
  // generated one is held to the packet it was given. Either way there is now
  // exactly one set, and generation, validation and persistence all read it.
  const approvedArticles = persistedReference ? input.canonicalArticles : referenceArticles;

  referenceItem = canonicalizeItemSourceUrls(referenceItem, approvedArticles);

  const referenceSources = resolveCatalogSourceArticles(referenceItem, approvedArticles);

  if (referenceSources.unresolved.length > 0) {
    // The item cites something it was never given. Not fetched, not looked up,
    // not invented metadata for — refused.
    return reject("validation_failed", [
      `${input.entryId}.${input.referenceLanguage}.source_urls: cited source URL(s) outside the approved material for this entry: ${referenceSources.unresolved.join(", ")}.`
    ]);
  }

  if (referenceSources.articles.length === 0) {
    return reject("no_source_material", [
      `The ${input.referenceLanguage} version of ${input.entryId} cites no source the entry was given.`
    ]);
  }

  const identities = editorialIdentities(referenceItem, input.miniCaseTopic);
  const collision = identities.find((identity) => input.seenIdentities.has(identity));
  if (collision) {
    // Refusing beats fabricating: the source pool did not support another
    // genuinely distinct entry at this position.
    return reject("duplicate_editorial_identity", [
      `An entry with the same editorial identity was already produced in this run (${collision}).`
    ]);
  }

  // `alreadyStored` versions take part in pairing but are never revalidated and
  // never rewritten: they are the rows that already exist.
  const versions: Array<{ language: Language; item: GeneratedContentItem; alreadyStored: boolean }> = [
    { language: input.referenceLanguage, item: referenceItem, alreadyStored: Boolean(persistedReference) }
  ];

  for (const language of input.counterpartLanguages) {
    const persistedCounterpart = input.existingVersions.get(versionKey(input.entryId, language));

    if (persistedCounterpart) {
      // This half of the pair is already stored; only the other half was missing.
      input.skipped.push({
        entryId: input.entryId,
        language,
        contentItemId: persistedCounterpart.contentItemId
      });
      continue;
    }

    // The counterpart is pinned to exactly the sources the reference cited,
    // whichever language those sources are written in. It is not shown the rest
    // of the pool: a counterpart offered a hundred other articles is a
    // counterpart that can wander onto a different story.
    let counterpartItem: GeneratedContentItem;
    try {
      counterpartItem = await generateOne({
        input,
        language,
        articles: referenceSources.articles,
        crossLanguageSources: true,
        languagePair: { referenceLanguage: input.referenceLanguage, referenceItems: [referenceItem] }
      });
    } catch (error) {
      return reject("generation_failed", [`${language}: ${errorMessage(error)}`]);
    }

    counterpartItem = canonicalizeItemSourceUrls(counterpartItem, approvedArticles);

    const counterpartSources = resolveCatalogSourceArticles(counterpartItem, approvedArticles);

    if (counterpartSources.unresolved.length > 0) {
      return reject("validation_failed", [
        `${input.entryId}.${language}.source_urls: cited source URL(s) outside the approved material for this entry: ${counterpartSources.unresolved.join(", ")}.`
      ]);
    }

    // One entry has one editorial identity, however many languages it is written
    // in. Inherited rather than re-derived, so a natively written English
    // counterpart cannot drift from its French reference on a prose identity
    // field and lose the whole entry to a parity mismatch.
    counterpartItem = alignCounterpartEditorialIdentity(referenceItem, counterpartItem);

    const pairIssues = validateCatalogLanguagePair(
      { language: input.referenceLanguage, item: referenceItem },
      { language, item: counterpartItem },
      input.entryId
    );

    if (pairIssues.length > 0) {
      return reject("language_pair_failed", formatIssues(pairIssues));
    }

    versions.push({ language, item: counterpartItem, alreadyStored: false });
  }

  const validationIssues = versions
    .filter((version) => !version.alreadyStored)
    .flatMap(({ language, item }) => [
      ...validateEntryTitle(item, language, input.entryId),
      ...validateEntryItem(item, input, language, approvedArticles)
    ]);
  if (validationIssues.length > 0) {
    return reject("validation_failed", formatIssues(validationIssues));
  }

  for (const identity of identities) {
    input.seenIdentities.add(identity);
  }

  for (const url of referenceItem.source_urls) {
    input.usedSourceUrls.add(url);
  }

  const persistedVersions: CatalogEntryVersion[] = [];
  for (const { language, item, alreadyStored } of versions) {
    if (alreadyStored) {
      // Already in the catalog: reported as reused, written again never.
      const existing = input.existingVersions.get(versionKey(input.entryId, language));

      persistedVersions.push({
        language,
        item,
        contentItemId: existing?.contentItemId ?? null,
        reusedExistingContentItem: true
      });
      continue;
    }

    const stored = input.repository
      ? await persistVersion({ input, language, item, approvedArticles })
      : { contentItemId: null, reusedExistingContentItem: false };

    persistedVersions.push({
      language,
      item,
      contentItemId: stored.contentItemId,
      reusedExistingContentItem: stored.reusedExistingContentItem
    });
  }

  return {
    kind: "entry",
    entry: {
      entryId: input.entryId,
      contentType: input.contentType,
      miniCaseTopic: input.miniCaseTopic,
      index: input.index,
      versions: persistedVersions
    }
  };
}

async function generateOne(args: {
  input: BuildEntryInput;
  language: Language;
  articles: RankedArticle[];
  crossLanguageSources?: boolean;
  languagePair: { referenceLanguage: Language; referenceItems: GeneratedContentItem[] } | undefined;
}): Promise<GeneratedContentItem> {
  const { input, language, articles, languagePair } = args;

  const payload = await input.dependencies.generator.generateDailyDrop({
    dropDate: input.options.dropDate,
    language,
    articles,
    crossLanguageSources: args.crossLanguageSources === true,
    // Newsletter topics are still required by the request shape for source
    // scoping, but no newsletter is generated: `sections` restricts this call to
    // the single content type this catalog entry needs.
    newsletterTopics: newsletterTopicsForEntry(input),
    newsletterArticleCount: 0,
    sections: [input.contentType],
    miniCaseProductTopics: input.miniCaseTopic ? [input.miniCaseTopic] : [],
    miniCaseMemory: buildMiniCaseMemoryContext({
      records: input.miniCaseMemory,
      dropDate: input.options.dropDate
    }),
    businessStoryMemory: buildBusinessStoryMemoryContext({
      entries: input.businessStoryMemory,
      dropDate: input.options.dropDate
    }),
    catalogVariantIndex: input.index,
    languagePair,
    productionStrict: input.options.productionStrict ?? readProductionContentStrict()
  });

  const items = payload.items.filter((item) => item.content_type === input.contentType);
  if (items.length !== 1) {
    throw new Error(`Expected exactly 1 ${input.contentType} item for ${language}, received ${items.length}.`);
  }

  return items[0];
}

/**
 * Titles are how the Library will let a reader find an entry later, so a catalog
 * title has to be a real title: precise, memorable, and free of raw feed debris.
 * A malformed upstream feed can hand the generator a "title" that is actually a
 * concatenated block of headlines and URLs; that entry is refused rather than
 * stored.
 */
const MAX_CATALOG_TITLE_CHARS = 140;
const MIN_CATALOG_TITLE_CHARS = 12;

export function validateEntryTitle(
  item: GeneratedContentItem,
  language: Language,
  path: string
): ValidationIssue[] {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const issue = (message: string): ValidationIssue => ({
    path: `${path}.${language}.title`,
    code: "catalog_title_unusable",
    message,
    severity: "error"
  });

  if (title.length < MIN_CATALOG_TITLE_CHARS) {
    return [issue(`Title is too short to identify the entry (${title.length} chars).`)];
  }

  if (title.length > MAX_CATALOG_TITLE_CHARS) {
    return [
      issue(
        `Title is ${title.length} chars, over the ${MAX_CATALOG_TITLE_CHARS}-char catalog limit. This usually means a malformed source feed leaked into the title.`
      )
    ];
  }

  if (/https?:\/\//i.test(title)) {
    return [issue("Title contains a URL, which means raw source text leaked into it.")];
  }

  if (/\n/.test(title)) {
    return [issue("Title contains a line break, which means raw source text leaked into it.")];
  }

  return [];
}

function validateEntryItem(
  item: GeneratedContentItem,
  input: BuildEntryInput,
  language: Language,
  approvedArticles: RankedArticle[]
): ValidationIssue[] {
  const payload = {
    drop_date: input.options.dropDate,
    language,
    prompt_version: "bootstrap_catalog",
    generator_version: "bootstrap_catalog",
    items: [item]
  };
  // The same approved set the entry generated from. Assembling a narrower one
  // here meant a French version grounded in an English source was validated
  // against French-only material and rejected for citing an approved source.
  const quality = validateDailyDropQuality(payload, {
    articles: approvedArticles,
    productionStrict: input.options.productionStrict ?? readProductionContentStrict(),
    miniCaseProductTopics: input.miniCaseTopic ? [input.miniCaseTopic] : undefined
  });

  return [...validateDailyDropPayload(payload), ...quality.issues.filter((issue) => issue.severity === "error")];
}

/**
 * Persists ONE language version as a standalone content item. `scheduler_run_id`
 * is the catalog entry id, so the existing dedup key
 * (run id + language + content type + topic + source fingerprint) makes a repeat
 * bootstrap with the same run id reuse rows instead of duplicating them.
 */
async function persistVersion(args: {
  input: BuildEntryInput;
  language: Language;
  item: GeneratedContentItem;
  approvedArticles: RankedArticle[];
}): Promise<{ contentItemId: string | null; reusedExistingContentItem: boolean }> {
  const { input, language, item } = args;
  const repository = input.repository;
  if (!repository) {
    return { contentItemId: null, reusedExistingContentItem: false };
  }

  // The sources this item actually cites, resolved out of the entry's approved
  // set — the same set validation used, and the same resolution rule. Every URL
  // the item carries therefore has metadata behind it, which is what
  // `assertDailyPayloadSourcesArePersistable` refused for the FTC press release
  // when persistence was assembling its own narrower pool.
  //
  // Only the cited sources are upserted: `sources` is the table of documents the
  // catalog actually stands on, not a dump of everything the run fetched.
  const resolved = resolveCatalogSourceArticles(item, args.approvedArticles);

  if (resolved.unresolved.length > 0) {
    throw new Error(
      `Cannot persist ${input.entryId} (${language}) because ${resolved.unresolved.length} cited source URL(s) are outside the entry's approved material: ${resolved.unresolved.join(", ")}`
    );
  }

  const articles = resolved.articles;

  const stored = await repository.storeDailyPayload({
    payload: {
      drop_date: input.options.dropDate,
      language,
      prompt_version: "bootstrap_catalog",
      generator_version: `bootstrap_catalog_${input.options.useLlm ? "llm" : "deterministic"}`,
      items: [item]
    },
    articles,
    contentStatus: input.options.contentStatus,
    metadata: {
      is_test_data: false,
      scheduler_mode: "bootstrap-catalog",
      scheduler_run_id: input.entryId,
      bootstrap_run_id: input.options.runId,
      catalog_entry_id: input.entryId,
      catalog_entry_index: input.index,
      catalog_content_type: input.contentType,
      catalog_mini_case_topic: input.miniCaseTopic,
      persisted_by: "services/content-engine npm run bootstrap-catalog",
      content_status: input.options.contentStatus,
      use_llm: input.options.useLlm,
      safe_persistence_note:
        "Initial catalog inventory. Not attached to any daily drop; assignment stays the daily job's job."
    }
  });

  const record = stored[0];
  return {
    contentItemId: record?.content_item_id ?? null,
    reusedExistingContentItem: Boolean(record?.reused_existing_content_item)
  };
}

/**
 * Editorial identity keys for an entry. An entry is a duplicate as soon as it
 * collides on ANY of its keys, so identity is deliberately over-specified.
 *
 * A Business Story IS its source event: two stories built on the same article,
 * or carrying the same title, are the same story however their metadata is
 * labelled. A Mini Case is a scenario, so the same source can legitimately power
 * several cases — but not with the same title or the same scenario/decision/
 * concept combination inside one topic.
 */
export function editorialIdentities(
  item: GeneratedContentItem,
  miniCaseTopic: MiniCaseTopicId | null
): string[] {
  if (item.content_type === "mini_case") {
    const miniCase = item as MiniCaseChallenge;
    const topic = miniCaseTopic ?? miniCase.product_topic;
    return [
      `mini_case|title|${topic}|${slugifyMiniCaseTitle(miniCase.title)}`,
      `mini_case|design|${topic}|${miniCase.scenario_type}|${miniCase.decision_type}|${miniCase.concept_tested}`
    ];
  }

  if (item.content_type === "business_story") {
    const story = item as BusinessStory;
    return [
      `business_story|title|${slugify(story.title)}`,
      `business_story|source|${sourceFingerprint(story.source_urls)}`,
      `business_story|entity|${normalizeMemoryKey(story.editorial_memory?.main_company ?? story.company_or_market)}|${normalizeMemoryKey(story.editorial_memory?.key_mechanism ?? "")}`
    ];
  }

  return [`${item.content_type}|title|${slugify(item.title)}`];
}

function sourceFingerprint(urls: string[]): string {
  return [...new Set((urls ?? []).map((url) => url.trim()).filter(Boolean))].sort().join(",");
}

/**
 * Orders the source pool for one entry: the articles that match the entry's
 * topics come first, rotated by the entry index so consecutive entries start
 * from a different article, then everything else as fallback. Nothing is
 * dropped, so a generator can always find material.
 */
export function rotateSourceWindow(
  articles: RankedArticle[],
  topics: TopicId[],
  index: number,
  usedSourceUrls: ReadonlySet<string> = new Set()
): RankedArticle[] {
  const allowed = new Set(topics);
  const relevant = articles.filter((article) => allowed.has(article.topic));
  const rest = articles.filter((article) => !allowed.has(article.topic));

  if (relevant.length === 0) {
    return articles;
  }

  const offset = index % relevant.length;
  const rotated = [...relevant.slice(offset), ...relevant.slice(0, offset)];

  // Diversity, without forcing it. Sources this topic has already built an entry
  // on move to the back of the packet rather than out of it: the generator still
  // prefers what it is shown first, so a fresh event wins while there is one,
  // and a reused source is still reachable when the pool has nothing else that
  // supports a distinct entry.
  const unused = rotated.filter((article) => !usedSourceUrls.has(article.url));
  const used = rotated.filter((article) => usedSourceUrls.has(article.url));

  return [...unused, ...used, ...rest];
}

/**
 * Emit a rejection as it happens, not only in the final report.
 *
 * `rejected[]` reaches the caller when the run finishes. A run that throws on
 * its last entry returns nothing at all, and the reasons the earlier entries
 * were refused die with it. Details are already short strings; nothing here
 * carries a payload or a credential.
 */
function reportRejection(
  dependencies: BootstrapCatalogDependencies,
  rejection: RejectedCatalogEntry
): void {
  dependencies.onProgress?.("catalog entry rejected", {
    entry_id: rejection.entryId,
    content_type: rejection.contentType,
    mini_case_topic: rejection.miniCaseTopic,
    index: rejection.index,
    reason: rejection.reason,
    details: rejection.details.slice(0, 5)
  });
}

/**
 * Topic scope for one entry. It drives source scoping only; `sections` already
 * guarantees no newsletter article is generated.
 */
function newsletterTopicsForEntry(input: BuildEntryInput): TopicId[] {
  if (input.contentType === "mini_case" && input.miniCaseTopic) {
    return miniCaseTopicToContentTopics(input.miniCaseTopic);
  }

  return BUSINESS_STORY_SOURCE_TOPICS;
}

const BUSINESS_STORY_SOURCE_TOPICS: TopicId[] = ["business", "finance", "tech_ai"];

function sourceBatchFor(
  buckets: Map<string, Set<string>>,
  contentType: "business_story" | "mini_case",
  miniCaseTopic: MiniCaseTopicId | null
): Set<string> {
  const key = miniCaseTopic ? `${contentType}:${miniCaseTopic}` : contentType;
  const existing = buckets.get(key);

  if (existing) {
    return existing;
  }

  const created = new Set<string>();
  buckets.set(key, created);

  return created;
}

function buildEntryId(
  runId: string,
  kind: "business-story" | "mini-case",
  miniCaseTopic: MiniCaseTopicId | null,
  index: number
): string {
  const position = String(index + 1).padStart(2, "0");
  return miniCaseTopic ? `${runId}-${kind}-${miniCaseTopic}-${position}` : `${runId}-${kind}-${position}`;
}

function buildOutput(args: {
  options: BootstrapCatalogOptions;
  referenceLanguage: Language;
  entries: CatalogEntry[];
  rejected: RejectedCatalogEntry[];
  skipped: SkippedCatalogVersion[];
}): BootstrapCatalogOutput {
  const { options, referenceLanguage, entries, rejected, skipped } = args;
  const versionsByContentTypeAndLanguage: Record<string, number> = {};
  const miniCaseEntriesByTopic: Record<string, number> = {};
  const miniCaseVersionsByTopicAndLanguage: Record<string, number> = {};
  let persistedContentItems = 0;
  let reusedExistingContentItems = 0;

  for (const topic of options.miniCaseTopics) {
    miniCaseEntriesByTopic[topic] = 0;
    for (const language of options.languages) {
      miniCaseVersionsByTopicAndLanguage[`${topic}.${language}`] = 0;
    }
  }

  for (const entry of entries) {
    if (entry.contentType === "mini_case" && entry.miniCaseTopic) {
      miniCaseEntriesByTopic[entry.miniCaseTopic] = (miniCaseEntriesByTopic[entry.miniCaseTopic] ?? 0) + 1;
    }

    for (const version of entry.versions) {
      const key = `${entry.contentType}.${version.language}`;
      versionsByContentTypeAndLanguage[key] = (versionsByContentTypeAndLanguage[key] ?? 0) + 1;

      if (entry.contentType === "mini_case" && entry.miniCaseTopic) {
        const topicKey = `${entry.miniCaseTopic}.${version.language}`;
        miniCaseVersionsByTopicAndLanguage[topicKey] = (miniCaseVersionsByTopicAndLanguage[topicKey] ?? 0) + 1;
      }

      if (version.contentItemId) {
        persistedContentItems += 1;
        if (version.reusedExistingContentItem) {
          reusedExistingContentItems += 1;
        }
      }
    }
  }

  const requestedEntries = options.businessStoryCount + options.miniCaseTopics.length * options.miniCaseCountPerTopic;

  return {
    mode: "bootstrap-catalog",
    persisted: options.persist,
    dryRun: !options.persist,
    confirmation: options.persist ? "CONFIRM_BOOTSTRAP_CATALOG=true" : null,
    runId: options.runId,
    dropDate: options.dropDate,
    languages: options.languages,
    referenceLanguage,
    generator: options.useLlm ? "llm" : "deterministic",
    contentStatus: options.contentStatus,
    requested: {
      businessStories: options.businessStoryCount,
      miniCasesPerTopic: options.miniCaseCountPerTopic,
      miniCaseTopics: options.miniCaseTopics,
      totalEntries: requestedEntries,
      totalVersions: requestedEntries * options.languages.length
    },
    counts: {
      businessStoryEntries: entries.filter((entry) => entry.contentType === "business_story").length,
      miniCaseEntries: entries.filter((entry) => entry.contentType === "mini_case").length,
      totalEntries: entries.length,
      versionsByContentTypeAndLanguage,
      miniCaseEntriesByTopic,
      miniCaseVersionsByTopicAndLanguage,
      persistedContentItems,
      reusedExistingContentItems,
      rejectedEntries: rejected.length
    },
    entries,
    rejected,
    skipped,
    dailyDropsCreated: 0
  };
}

function assertOptions(options: BootstrapCatalogOptions): void {
  if (options.languages.length === 0) {
    throw new Error("bootstrap-catalog requires at least one language (LANGUAGES=fr,en).");
  }

  if (new Set(options.languages).size !== options.languages.length) {
    throw new Error("bootstrap-catalog languages must be unique.");
  }

  if (!Number.isInteger(options.businessStoryCount) || options.businessStoryCount < 0) {
    throw new Error("BUSINESS_STORY_COUNT must be a non-negative integer.");
  }

  if (!Number.isInteger(options.miniCaseCountPerTopic) || options.miniCaseCountPerTopic < 0) {
    throw new Error("MINI_CASE_COUNT_PER_TOPIC must be a non-negative integer.");
  }

  for (const topic of options.miniCaseTopics) {
    if (!MINI_CASE_TOPIC_IDS.includes(topic)) {
      throw new Error(`Unknown mini-case topic: ${topic}. Allowed: ${MINI_CASE_TOPIC_IDS.join(", ")}.`);
    }
  }
}

function requireRepository(repository: ContentRepository | undefined): ContentRepository {
  if (!repository) {
    throw new Error(
      "bootstrap-catalog persistence requires a server-side ContentRepository configured with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  repository.assertPersistenceAvailable();
  return repository;
}

function formatIssues(issues: ValidationIssue[]): string[] {
  return issues.map((issue) => `${issue.path}: ${issue.message}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
