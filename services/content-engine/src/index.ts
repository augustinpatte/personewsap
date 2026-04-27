import { StructuredContentGenerator } from "./generation/structuredGenerator.js";
import { DailyContentJob } from "./scheduler/dailyJob.js";
import { CURATED_SOURCES } from "./sources/curatedSources.js";
import { CuratedSourceConnector } from "./sources/curatedSourceFetcher.js";
import { NewsApiConnector } from "./sources/newsApiFetcher.js";
import { RssFeedConnector } from "./sources/rssFetcher.js";
import { SourceFetcher } from "./sources/sourceFetcher.js";
import type { SourceConnector } from "./sources/types.js";
import { ContentRepository } from "./storage/contentRepository.js";
import { createServiceRoleSupabaseClient } from "./storage/supabaseClient.js";

export * from "./domain.js";
export * from "./sources/types.js";
export * from "./sources/curatedSources.js";
export * from "./sources/curatedSourceFetcher.js";
export * from "./sources/newsApiFetcher.js";
export * from "./sources/rssFetcher.js";
export * from "./sources/sourceFetcher.js";
export * from "./processing/pipeline.js";
export * from "./processing/deduplicate.js";
export * from "./processing/categorize.js";
export * from "./processing/rank.js";
export * from "./generation/types.js";
export * from "./generation/prompts.js";
export * from "./generation/structuredGenerator.js";
export * from "./generation/validation.js";
export * from "./storage/contentRepository.js";
export * from "./storage/supabaseClient.js";
export * from "./scheduler/index.js";

export function createContentEngine(options?: {
  persist?: boolean;
  newsApiKey?: string;
  newsApiEndpoint?: string;
  supabaseUrl?: string;
  serviceRoleKey?: string;
}) {
  const connectors: SourceConnector[] = [new RssFeedConnector(CURATED_SOURCES), new CuratedSourceConnector(CURATED_SOURCES)];
  const newsApiKey = options?.newsApiKey ?? process.env.NEWS_API_KEY;
  const newsApiEndpoint = options?.newsApiEndpoint ?? process.env.NEWS_API_ENDPOINT;

  if (newsApiKey && newsApiEndpoint) {
    connectors.push(
      new NewsApiConnector({
        apiKey: newsApiKey,
        endpoint: newsApiEndpoint
      })
    );
  }

  const sourceFetcher = new SourceFetcher(connectors);
  const generator = new StructuredContentGenerator();
  const repository =
    options?.persist === false
      ? undefined
      : new ContentRepository(
          createServiceRoleSupabaseClient({
            supabaseUrl: options?.supabaseUrl,
            serviceRoleKey: options?.serviceRoleKey
          })
        );

  const job = new DailyContentJob(sourceFetcher, generator, repository);

  return {
    sourceFetcher,
    generator,
    repository,
    runDailyContentJob: job.run.bind(job)
  };
}
