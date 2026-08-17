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
import { validateCatalogLanguagePair } from "./catalogPairing.js";

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
};

export type BootstrapCatalogDependencies = {
  generator: ContentGenerator;
  /** Ranked, same-language source material for one language. */
  loadArticles: (language: Language) => Promise<RankedArticle[]>;
  /** Omitted in dry-run. Required for persist mode. */
  repository?: ContentRepository;
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

  const articlesByLanguage = new Map<Language, RankedArticle[]>();
  for (const language of options.languages) {
    articlesByLanguage.set(language, await dependencies.loadArticles(language));
  }

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
  const seenIdentities = new Set<string>();

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
      businessStoryMemory,
      miniCaseMemory,
      seenIdentities
    });

    if (outcome.kind === "rejected") {
      rejected.push(outcome.rejection);
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
        businessStoryMemory,
        miniCaseMemory,
        seenIdentities
      });

      if (outcome.kind === "rejected") {
        rejected.push(outcome.rejection);
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

  return buildOutput({ options, referenceLanguage, entries, rejected });
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
  businessStoryMemory: BusinessStoryEditorialMemoryEntry[];
  miniCaseMemory: MiniCaseEditorialMemoryRecord[];
  seenIdentities: Set<string>;
};

type BuildEntryOutcome =
  | { kind: "entry"; entry: CatalogEntry }
  | { kind: "rejected"; rejection: RejectedCatalogEntry };

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

  const referenceArticles = input.articlesByLanguage.get(input.referenceLanguage) ?? [];
  if (referenceArticles.length === 0) {
    return reject("no_source_material", [`No ranked source articles available for ${input.referenceLanguage}.`]);
  }

  let referenceItem: GeneratedContentItem;
  try {
    referenceItem = await generateOne({
      input,
      language: input.referenceLanguage,
      articles: rotateSourceWindow(referenceArticles, newsletterTopicsForEntry(input), input.index),
      languagePair: undefined
    });
  } catch (error) {
    return reject("generation_failed", [errorMessage(error)]);
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

  const versions: Array<{ language: Language; item: GeneratedContentItem }> = [
    { language: input.referenceLanguage, item: referenceItem }
  ];

  for (const language of input.counterpartLanguages) {
    const counterpartArticles = dedupeArticles([
      ...sourceArticlesFor(referenceItem, referenceArticles),
      ...(input.articlesByLanguage.get(language) ?? [])
    ]);

    let counterpartItem: GeneratedContentItem;
    try {
      counterpartItem = await generateOne({
        input,
        language,
        articles: counterpartArticles,
        languagePair: { referenceLanguage: input.referenceLanguage, referenceItems: [referenceItem] }
      });
    } catch (error) {
      return reject("generation_failed", [`${language}: ${errorMessage(error)}`]);
    }

    const pairIssues = validateCatalogLanguagePair(
      { language: input.referenceLanguage, item: referenceItem },
      { language, item: counterpartItem },
      input.entryId
    );

    if (pairIssues.length > 0) {
      return reject("language_pair_failed", formatIssues(pairIssues));
    }

    versions.push({ language, item: counterpartItem });
  }

  const validationIssues = versions.flatMap(({ language, item }) => [
    ...validateEntryTitle(item, language, input.entryId),
    ...validateEntryItem(item, input, language)
  ]);
  if (validationIssues.length > 0) {
    return reject("validation_failed", formatIssues(validationIssues));
  }

  for (const identity of identities) {
    input.seenIdentities.add(identity);
  }

  const persistedVersions: CatalogEntryVersion[] = [];
  for (const { language, item } of versions) {
    const stored = input.repository
      ? await persistVersion({ input, language, item })
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
  languagePair: { referenceLanguage: Language; referenceItems: GeneratedContentItem[] } | undefined;
}): Promise<GeneratedContentItem> {
  const { input, language, articles, languagePair } = args;

  const payload = await input.dependencies.generator.generateDailyDrop({
    dropDate: input.options.dropDate,
    language,
    articles,
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
  language: Language
): ValidationIssue[] {
  const payload = {
    drop_date: input.options.dropDate,
    language,
    prompt_version: "bootstrap_catalog",
    generator_version: "bootstrap_catalog",
    items: [item]
  };
  const articles = dedupeArticles([
    ...(input.articlesByLanguage.get(language) ?? []),
    ...(input.articlesByLanguage.get(input.referenceLanguage) ?? [])
  ]);

  const quality = validateDailyDropQuality(payload, {
    articles,
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
}): Promise<{ contentItemId: string | null; reusedExistingContentItem: boolean }> {
  const { input, language, item } = args;
  const repository = input.repository;
  if (!repository) {
    return { contentItemId: null, reusedExistingContentItem: false };
  }

  const articles = dedupeArticles([
    ...(input.articlesByLanguage.get(language) ?? []),
    ...(input.articlesByLanguage.get(input.referenceLanguage) ?? [])
  ]);

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
  index: number
): RankedArticle[] {
  const allowed = new Set(topics);
  const relevant = articles.filter((article) => allowed.has(article.topic));
  const rest = articles.filter((article) => !allowed.has(article.topic));

  if (relevant.length === 0) {
    return articles;
  }

  const offset = index % relevant.length;
  return [...relevant.slice(offset), ...relevant.slice(0, offset), ...rest];
}

function sourceArticlesFor(item: GeneratedContentItem, pool: RankedArticle[]): RankedArticle[] {
  const urls = new Set(item.source_urls);
  return pool.filter((article) => urls.has(article.url));
}

function dedupeArticles(articles: RankedArticle[]): RankedArticle[] {
  const seen = new Set<string>();
  const unique: RankedArticle[] = [];

  for (const article of articles) {
    if (seen.has(article.url)) {
      continue;
    }
    seen.add(article.url);
    unique.push(article);
  }

  return unique;
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
}): BootstrapCatalogOutput {
  const { options, referenceLanguage, entries, rejected } = args;
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
