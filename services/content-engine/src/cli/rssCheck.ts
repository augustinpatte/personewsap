import { LANGUAGES, TOPIC_IDS, type Language, type TopicId, isLanguage, isTopicId } from "../domain.js";
import { processArticles } from "../processing/pipeline.js";
import { CURATED_SOURCE_COVERAGE, CURATED_SOURCES } from "../sources/curatedSources.js";
import { RssFeedConnector, type RssFetchDiagnostics } from "../sources/rssFetcher.js";

export type RssCheckOptions = {
  languages: Language[];
  topics: TopicId[];
  since?: string;
  limitPerSource?: number;
};

export type RssCheckOutput = {
  mode: "rss-check";
  persisted: false;
  liveRss: true;
  status: "completed";
  request: {
    languages: Language[];
    topics: TopicId[];
    since: string | null;
    limitPerSource: number | null;
  };
  sourceCoverage: typeof CURATED_SOURCE_COVERAGE;
  activeSources: Array<{
    source_id: string;
    publisher: string;
    topic: TopicId;
    language: Language;
    rss_url: string;
  }>;
  diagnostics: RssFetchDiagnostics;
  fetchedArticles: number;
  processedArticles: number;
  topRankedSources: Array<{
    title: string;
    publisher: string;
    topic: TopicId;
    importance_score: number;
    url: string;
    published_at: string | null;
  }>;
};

export async function runRssCheck(options: RssCheckOptions): Promise<RssCheckOutput> {
  const activeSources = CURATED_SOURCES.filter(
    (source) => options.topics.includes(source.topic) && options.languages.includes(source.language) && source.rssUrl
  );

  if (activeSources.length === 0) {
    throw new Error(
      `No live RSS sources are configured for languages=${options.languages.join(",")} topics=${options.topics.join(",")}.`
    );
  }

  const connector = new RssFeedConnector(CURATED_SOURCES);
  const articles = await connector.fetchArticles({
    topics: options.topics,
    languages: options.languages,
    since: options.since,
    limitPerSource: options.limitPerSource
  });

  if (articles.length === 0) {
    throw new Error(
      "RSS check produced zero usable articles. See rss_source_health, rss_source_failed, and rss_source_skipped_no_usable_items logs."
    );
  }

  const rankedArticles = processArticles(articles);

  return {
    mode: "rss-check",
    persisted: false,
    liveRss: true,
    status: "completed",
    request: {
      languages: options.languages,
      topics: options.topics,
      since: options.since ?? null,
      limitPerSource: options.limitPerSource ?? null
    },
    sourceCoverage: CURATED_SOURCE_COVERAGE,
    activeSources: activeSources.map((source) => ({
      source_id: source.id,
      publisher: source.publisher,
      topic: source.topic,
      language: source.language,
      rss_url: source.rssUrl ?? ""
    })),
    diagnostics: connector.getLastDiagnostics(),
    fetchedArticles: articles.length,
    processedArticles: rankedArticles.length,
    topRankedSources: rankedArticles.slice(0, 10).map((article) => ({
      title: article.title,
      publisher: article.publisher,
      topic: article.topic,
      importance_score: article.importance_score,
      url: article.url,
      published_at: article.published_at ?? null
    }))
  };
}

export function parseRssCheckOptions(args: string[]): RssCheckOptions {
  const values = readFlags(args);
  const limitPerSource = readPositiveInteger(values.get("limit-per-source"), "--limit-per-source");

  return {
    languages: parseLanguages(values.get("languages") ?? values.get("language") ?? LANGUAGES.join(",")),
    topics: parseTopics(values.get("topics") ?? values.get("topic") ?? TOPIC_IDS.join(",")),
    since: values.get("since") ?? values.get("date"),
    limitPerSource
  };
}

function readFlags(args: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const nextValue = args[index + 1];

    if (inlineValue !== undefined) {
      values.set(rawKey, inlineValue);
      continue;
    }

    if (!nextValue || nextValue.startsWith("--")) {
      values.set(rawKey, "true");
      continue;
    }

    values.set(rawKey, nextValue);
    index += 1;
  }

  return values;
}

function parseLanguages(value: string): Language[] {
  const languages = value.split(",").map((language) => language.trim()).filter(Boolean);
  if (languages.length === 0 || languages.some((language) => !isLanguage(language))) {
    throw new Error(`--languages must contain approved languages: ${LANGUAGES.join(", ")}.`);
  }

  return languages as Language[];
}

function parseTopics(value: string): TopicId[] {
  const topics = value.split(",").map((topic) => topic.trim()).filter(Boolean);
  if (topics.length === 0 || topics.some((topic) => !isTopicId(topic))) {
    throw new Error(`--topics must use approved topic IDs: ${TOPIC_IDS.join(", ")}.`);
  }

  return topics as TopicId[];
}

function readPositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}
