import { TOPIC_IDS, type DailyDropStatus, type Language, type TopicId } from "../domain.js";
import type { ContentGenerator } from "../generation/types.js";
import { assertValidDailyDropPayload } from "../generation/validation.js";
import { processArticles } from "../processing/pipeline.js";
import type { SourceFetcher } from "../sources/sourceFetcher.js";
import type { ContentRepository } from "../storage/contentRepository.js";
import { assembleDailyDropPayload, selectDailyDropItemsForUser } from "./dailyDropBuilder.js";

export type DailyContentJobOptions = {
  dropDate: string;
  languages: Language[];
  topics?: TopicId[];
  newsletterArticleCount?: number;
  publish?: boolean;
  persist?: boolean;
};

export type DailyContentJobResult = {
  dropDate: string;
  languages: Array<{
    language: Language;
    fetchedArticles: number;
    processedArticles: number;
    generatedItems: number;
    storedItems: number;
    userDropsCreated: number;
  }>;
};

export class DailyContentJob {
  constructor(
    private readonly sourceFetcher: SourceFetcher,
    private readonly generator: ContentGenerator,
    private readonly repository?: ContentRepository
  ) {}

  async run(options: DailyContentJobOptions): Promise<DailyContentJobResult> {
    const topics = options.topics ?? [...TOPIC_IDS];
    const results: DailyContentJobResult["languages"] = [];
    const repository = this.repository;
    let persistenceRepository: ContentRepository | undefined;

    if (options.persist === true) {
      if (!repository) {
        throw new Error(
          "DailyContentJob persistence requires persist=true and a server-side ContentRepository configured with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        );
      }

      repository.assertPersistenceAvailable();
      persistenceRepository = repository;
    }

    for (const language of options.languages) {
      const rawArticles = await this.sourceFetcher.fetch({
        topics,
        languages: [language],
        since: options.dropDate,
        limitPerTopic: 10
      });
      const rankedArticles = processArticles(rawArticles).filter((article) => article.language === language);
      const payload = assembleDailyDropPayload(
        await this.generator.generateDailyDrop({
          dropDate: options.dropDate,
          language,
          articles: rankedArticles,
          newsletterTopics: topics,
          newsletterArticleCount: options.newsletterArticleCount ?? 8
        })
      );

      assertValidDailyDropPayload(payload);

      let storedItems = 0;
      let userDropsCreated = 0;

      if (persistenceRepository) {
        const stored = await persistenceRepository.storeDailyPayload({
          payload,
          articles: rankedArticles,
          contentStatus: options.publish ? "published" : "review"
        });
        storedItems = stored.length;

        const preferences = await persistenceRepository.listUserDailyDropPreferences(language);
        const dropStatus: DailyDropStatus = options.publish ? "published" : "generated";

        for (const preference of preferences) {
          const selection = selectDailyDropItemsForUser(preference, stored);
          await persistenceRepository.createDailyDropForUser({
            userId: selection.userId,
            dropDate: options.dropDate,
            language,
            status: dropStatus,
            itemIds: selection.items
          });
          userDropsCreated += 1;
        }
      }

      results.push({
        language,
        fetchedArticles: rawArticles.length,
        processedArticles: rankedArticles.length,
        generatedItems: payload.items.length,
        storedItems,
        userDropsCreated
      });
    }

    return {
      dropDate: options.dropDate,
      languages: results
    };
  }
}
