import { TOPIC_IDS, type DailyDropSlot, type DailyDropStatus, type Language, type TopicId } from "../domain.js";
import type { ContentGenerator } from "../generation/types.js";
import { assertValidDailyDropPayload } from "../generation/validation.js";
import { processArticles } from "../processing/pipeline.js";
import type { SourceFetcher } from "../sources/sourceFetcher.js";
import type { ContentRepository } from "../storage/contentRepository.js";
import { redactIdentifier } from "../utils/redactIdentifier.js";
import {
  buildAssignmentPool,
  describeCatalogReuse,
  excludeAlreadyAssignedForUser,
  isCatalogReuseEnabled,
  resolveDailyGenerationSections
} from "../catalog/catalogInventory.js";
import { assembleDailyDropPayload, selectDailyDropItemsForUser } from "./dailyDropBuilder.js";

const REQUIRED_DAILY_DROP_SLOTS = ["newsletter", "business_story", "mini_case"] as const;

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
      const businessStoryMemory = persistenceRepository
        ? await persistenceRepository.listBusinessStoryMemoryContext({
            language,
            dropDate: options.dropDate
          })
        : undefined;

      // Editorial inventory prepared ahead of time (bootstrap-catalog). With
      // stock on the shelf the run asks the model for the newsletter only,
      // which is both the point of the catalog and where the API saving comes
      // from. With no inventory this resolves to every section, exactly as
      // before.
      const reuseEnabled = isCatalogReuseEnabled();
      const inventory =
        persistenceRepository && reuseEnabled
          ? await persistenceRepository.listReusableCatalogItems({ language })
          : [];
      const sections = resolveDailyGenerationSections({
        inventory,
        requestedSlots: [...REQUIRED_DAILY_DROP_SLOTS],
        reuseEnabled
      });

      console.info("[content-engine] catalog reuse", {
        language,
        drop_date: options.dropDate,
        ...describeCatalogReuse({ inventory, sections, reuseEnabled })
      });

      const payload = assembleDailyDropPayload(
        await this.generator.generateDailyDrop({
          dropDate: options.dropDate,
          language,
          articles: rankedArticles,
          newsletterTopics: topics,
          newsletterArticleCount: options.newsletterArticleCount ?? 8,
          businessStoryMemory,
          sections
        })
      );

      assertValidDailyDropPayload(payload, {
        articles: rankedArticles,
        businessStoryMemory
      });

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

        // What a reader may be offered today: this run's items plus the
        // inventory, minus anything they have already received.
        const assignmentPool = buildAssignmentPool({
          fresh: stored,
          inventory,
          reuseEnabled
        });
        const assignedByUser = reuseEnabled
          ? await persistenceRepository.listAssignedContentItemIdsByUser({
              userIds: preferences.map((preference) => preference.user_id)
            })
          : new Map<string, Set<string>>();

        for (const preference of preferences) {
          const userPool = excludeAlreadyAssignedForUser(
            assignmentPool,
            assignedByUser.get(preference.user_id) ?? new Set<string>()
          );
          const selection = selectDailyDropItemsForUser(preference, userPool, {
            dropDate: options.dropDate
          });
          const missingSlots = missingRequiredSlots(selection.items);
          console.info("[content-engine] assignment topic selection", {
            user_id: redactIdentifier(preference.user_id),
            language,
            newsletter_topics_selected: selection.diagnostics.newsletter.selectedTopicIds,
            mini_case_topics_selected: selection.diagnostics.miniCase.allowedTopicIds,
            newsletter_items_assigned: selection.diagnostics.newsletter.assignedItems.length,
            mini_case_topic_assigned: selection.diagnostics.miniCase.selectedTopicId
          });
          if (selection.diagnostics.miniCase.fallbackReason !== "none") {
            console.warn("[content-engine] mini-case topic fallback", {
              user_id: redactIdentifier(preference.user_id),
              language,
              mini_case_topics_selected: selection.diagnostics.miniCase.allowedTopicIds,
              requested_topic_id: selection.diagnostics.miniCase.requestedTopicId,
              selected_topic_id: selection.diagnostics.miniCase.selectedTopicId,
              fallback_reason: selection.diagnostics.miniCase.fallbackReason
            });
          }
          if (missingSlots.length > 0) {
            console.warn("[content-engine] daily drop assignment skipped incomplete selection", {
              user_id: redactIdentifier(preference.user_id),
              language,
              missing_slots: missingSlots,
              mini_case_topics: preference.mini_case_topics,
              newsletter_topics_selected: selection.diagnostics.newsletter.selectedTopicIds,
              mini_case_topics_selected: selection.diagnostics.miniCase.allowedTopicIds,
              newsletter_items_assigned: selection.diagnostics.newsletter.assignedItems.length,
              mini_case_topic_assigned: selection.diagnostics.miniCase.selectedTopicId,
              mini_case_fallback_reason: selection.diagnostics.miniCase.fallbackReason
            });
            continue;
          }
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

function missingRequiredSlots(selectedItems: Array<{ slot: DailyDropSlot }>) {
  const slots = new Set(selectedItems.map((item) => item.slot));

  return REQUIRED_DAILY_DROP_SLOTS.filter((slot) => !slots.has(slot));
}
