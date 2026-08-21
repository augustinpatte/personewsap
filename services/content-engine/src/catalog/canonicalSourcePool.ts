import type { Language, RankedArticle, TopicId } from "../domain.js";
import {
  allocateBusinessStorySourcePackets,
  countBusinessStoryEventsByTopic
} from "./sourceEventAllocation.js";

/**
 * One source pool for the whole catalog, across every requested language.
 *
 * The bootstrap generates French first and English as its pair, and that made
 * the reference language decide which events were discoverable at all: the
 * French version could only be built from the French pool, so ten Business
 * Stories had to exist in French RSS or they did not exist. The previous run
 * rejected all ten for duplicate editorial identity — not because the day was
 * thin, but because only a fifth of the day was visible.
 *
 * Output language and source language are separate concerns. A pair is one
 * factual basis rendered twice, so the basis is chosen from everything the run
 * fetched, and the language it was written in is not part of the decision.
 *
 * This applies to reusable catalog content only. The Newsletter keeps selecting
 * within its own language.
 */

export type CanonicalCatalogPool = {
  articles: RankedArticle[];
  diagnostics: {
    byLanguage: Record<string, number>;
    total: number;
    /** Same event reached through more than one language pool. */
    crossLanguageDuplicatesRemoved: number;
  };
};

/**
 * Merge the per-language pools into one, keeping each event once.
 *
 * Ordering matters and is preserved: the pools arrive ranked, so interleaving
 * them by rank keeps the best material from every language near the front
 * rather than burying one language behind the whole of another.
 */
export function buildCanonicalCatalogPool(
  articlesByLanguage: Map<Language, RankedArticle[]>
): CanonicalCatalogPool {
  const byLanguage: Record<string, number> = {};
  const pools: RankedArticle[][] = [];

  for (const [language, articles] of articlesByLanguage) {
    byLanguage[language] = articles.length;
    pools.push(articles);
  }

  const seen = new Set<string>();
  const articles: RankedArticle[] = [];
  let crossLanguageDuplicatesRemoved = 0;
  const depth = Math.max(0, ...pools.map((pool) => pool.length));

  for (let rank = 0; rank < depth; rank += 1) {
    for (const pool of pools) {
      const article = pool[rank];

      if (!article) {
        continue;
      }

      const key = eventKey(article);

      if (seen.has(key)) {
        // The same article reached through two language pools is one event, and
        // must occupy one slot: counting it twice would let a single story fill
        // two catalog entries.
        crossLanguageDuplicatesRemoved += 1;
        continue;
      }

      seen.add(key);
      articles.push(article);
    }
  }

  return {
    articles,
    diagnostics: {
      byLanguage,
      total: articles.length,
      crossLanguageDuplicatesRemoved
    }
  };
}

/**
 * Event identity for pool merging: the canonical URL.
 *
 * Deliberately narrow. Two different outlets covering one event in two
 * languages share almost no headline vocabulary, so matching them here would
 * take a model call, and guessing would silently drop good material. That case
 * is still caught downstream, where `editorialIdentities` refuses a second entry
 * built on the same story. What this key must catch — and does — is the same
 * document appearing in both pools.
 */
function eventKey(article: RankedArticle): string {
  return article.normalized_url || article.url;
}

export type BusinessStoryCapacity = {
  requested: number;
  availablePackets: number;
  sufficient: boolean;
  /** Distinct events per topic, for the report when capacity is short. */
  byTopic: Record<string, number>;
};

/**
 * How many distinct Business Stories the pool can actually support.
 *
 * A Business Story *is* its source event: two stories built on the same article
 * are the same story, and the entry validator rejects the second. Counting
 * distinct eligible events up front turns ten wasted generation calls followed
 * by ten rejections into one refusal before the first call.
 */
export function assessBusinessStoryCapacity(input: {
  articles: RankedArticle[];
  topics: TopicId[];
  requested: number;
}): BusinessStoryCapacity {
  // Counted by the allocator itself, not by a parallel rule that agrees with it
  // by coincidence. A preflight that promises ten packets the allocator cannot
  // then produce is worse than no preflight: it spends the run's budget before
  // failing.
  const availablePackets = allocateBusinessStorySourcePackets({
    articles: input.articles,
    topics: input.topics
  }).length;

  return {
    requested: input.requested,
    availablePackets,
    sufficient: availablePackets >= input.requested,
    byTopic: countBusinessStoryEventsByTopic({ articles: input.articles, topics: input.topics })
  };
}

export class InsufficientCatalogSourceMaterialError extends Error {
  readonly reason = "insufficient_distinct_source_material";
  readonly requestedBusinessStories: number;
  readonly availableDistinctStoryPackets: number;
  readonly catalogWindowDays: number;
  readonly byTopic: Record<string, number>;

  constructor(input: {
    capacity: BusinessStoryCapacity;
    catalogWindowDays: number;
  }) {
    super(
      `bootstrap-catalog refused to start Business Stories: requested_business_stories=${input.capacity.requested}, available_distinct_story_packets=${input.capacity.availablePackets}, catalog_window_days=${input.catalogWindowDays}, reason=insufficient_distinct_source_material.`
    );
    this.name = "InsufficientCatalogSourceMaterialError";
    this.requestedBusinessStories = input.capacity.requested;
    this.availableDistinctStoryPackets = input.capacity.availablePackets;
    this.catalogWindowDays = input.catalogWindowDays;
    this.byTopic = input.capacity.byTopic;
  }
}
