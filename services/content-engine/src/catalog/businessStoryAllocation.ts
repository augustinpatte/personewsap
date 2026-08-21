import type { RankedArticle, TopicId } from "../domain.js";

/**
 * Deterministic allocation of one distinct editorial event per Business Story.
 *
 * A Business Story *is* its source event. The previous design handed every one
 * of the ten generation calls the same broad, mostly-overlapping packet and
 * hoped the model would pick a different story each time. It does not: the most
 * attractive event in the packet stays the most attractive event on the tenth
 * call, and the duplicate guard then rejects nine entries the run had already
 * paid for.
 *
 * So the choice is made here, before the first call, and it is made once. Entry
 * 01 is allocated a primary event; every article covering that same event is
 * consumed with it; entry 02 is allocated the next unconsumed event. The model
 * still writes the story — it no longer picks which story.
 *
 * `editorialIdentities` stays in place downstream. This narrows what the model
 * is offered; that still refuses what the model produces.
 */

export type BusinessStorySourcePacket = {
  /** The one event this entry is about. */
  primary: RankedArticle;
  /**
   * Further approved coverage of the same event, or of the same named entities.
   *
   * Not padding: a merger is usually reported by the regulator and the trade
   * press in the same week, and a story that can cite both is better sourced
   * than one that cannot. Bounded, because a wide packet is how the model
   * wandered off the allocated event in the first place.
   */
  supporting: RankedArticle[];
  /** `primary` first, then `supporting`. The packet handed to generation. */
  articles: RankedArticle[];
};

/** Primary plus at most this many supporting articles. */
const MAX_SUPPORTING_SOURCES = 3;

/**
 * Allocate one packet per requested Business Story.
 *
 * Ranked order is respected, so the best event becomes entry 01 rather than
 * being spent at random. Omit `count` to allocate everything the pool supports,
 * which is how the capacity preflight and the allocator are kept in agreement:
 * both count the same clusters with the same rules.
 */
export function allocateBusinessStorySourcePackets(input: {
  articles: readonly RankedArticle[];
  topics: readonly TopicId[];
  count?: number;
}): BusinessStorySourcePacket[] {
  const allowed = new Set(input.topics);
  const eligible: RankedArticle[] = [];
  const seenEvents = new Set<string>();

  for (const article of input.articles) {
    if (!allowed.has(article.topic)) {
      continue;
    }

    const key = eventKey(article);

    if (seenEvents.has(key)) {
      continue;
    }

    seenEvents.add(key);
    eligible.push(article);
  }

  const limit = input.count ?? Number.POSITIVE_INFINITY;
  const consumed = new Set<string>();
  const packets: BusinessStorySourcePacket[] = [];

  for (const candidate of eligible) {
    if (packets.length >= limit) {
      break;
    }

    if (consumed.has(candidate.url)) {
      continue;
    }

    consumed.add(candidate.url);

    // Same event, different outlet. Consumed with the primary: allowing one of
    // these to become a later primary would produce two entries about one
    // transaction, which is the duplication this whole module exists to stop.
    const sameEvent = eligible.filter(
      (other) => !consumed.has(other.url) && isSameEvent(candidate, other)
    );

    for (const article of sameEvent) {
      consumed.add(article.url);
    }

    // Same named entities, different event. NOT consumed: it may still carry its
    // own story later, and it may support more than one primary. That is the
    // only way a supporting source is allowed to repeat.
    const related = eligible.filter(
      (other) =>
        other.url !== candidate.url &&
        !sameEvent.some((article) => article.url === other.url) &&
        sharesNamedEntities(candidate, other)
    );

    const supporting = [...sameEvent, ...related].slice(0, MAX_SUPPORTING_SOURCES);

    packets.push({
      primary: candidate,
      supporting,
      articles: [candidate, ...supporting]
    });
  }

  return packets;
}

/** Distinct primary events per topic, for the report when capacity is short. */
export function countBusinessStoryEventsByTopic(input: {
  articles: readonly RankedArticle[];
  topics: readonly TopicId[];
}): Record<string, number> {
  const byTopic: Record<string, number> = {};

  for (const topic of input.topics) {
    byTopic[topic] = 0;
  }

  for (const packet of allocateBusinessStorySourcePackets(input)) {
    byTopic[packet.primary.topic] = (byTopic[packet.primary.topic] ?? 0) + 1;
  }

  return byTopic;
}

/** Event identity for deduplication: the canonical URL of the document. */
function eventKey(article: RankedArticle): string {
  return article.normalized_url || article.url;
}

/**
 * Whether two approved articles report the SAME event.
 *
 * Conservative on purpose. Merging two genuinely different events silently costs
 * the run an entry it could have produced; failing to merge two reports of one
 * event costs nothing, because `editorialIdentities` still refuses the second
 * entry. So this errs towards keeping events apart, and only merges on a strong
 * signal: near-identical headline vocabulary carrying the same numbers.
 */
function isSameEvent(left: RankedArticle, right: RankedArticle): boolean {
  if (eventKey(left) === eventKey(right)) {
    return true;
  }

  const leftTokens = significantTokens(left.title);
  const rightTokens = significantTokens(right.title);

  if (leftTokens.size < 2 || rightTokens.size < 2) {
    return false;
  }

  // Figures are what separates "Q2 revenue up 12%" from "Q3 revenue up 4%".
  // Different numbers mean different events, whatever the words around them.
  if (!setsEqual(numericTokens(leftTokens), numericTokens(rightTokens))) {
    return false;
  }

  const shared = intersectionSize(leftTokens, rightTokens);
  const union = leftTokens.size + rightTokens.size - shared;

  return shared >= 2 && union > 0 && shared / union >= 0.6;
}

/**
 * Whether two articles are about the same companies or institutions.
 *
 * Matched on proper nouns and acronyms only — "FTC", "Loctite", "Henkel" — never
 * on the generic vocabulary every headline shares, which would relate every
 * business article to every other one.
 */
function sharesNamedEntities(left: RankedArticle, right: RankedArticle): boolean {
  const leftEntities = namedEntityTokens(left.title);
  const rightEntities = namedEntityTokens(right.title);

  if (leftEntities.size === 0 || rightEntities.size === 0) {
    return false;
  }

  return intersectionSize(leftEntities, rightEntities) >= 2;
}

const TITLE_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "their", "its", "has", "have",
  "was", "were", "will", "into", "over", "after", "before", "about", "than", "then",
  "les", "des", "une", "aux", "par", "pour", "avec", "dans", "sur", "son", "ses",
  "que", "qui", "est", "sont", "plus", "leur", "leurs", "cette", "après"
]);

function significantTokens(title: string): Set<string> {
  const tokens = (title ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

  return new Set(
    tokens.filter((token) => {
      if (/^\d+$/.test(token)) {
        return true;
      }

      return token.length >= 3 && !TITLE_STOPWORDS.has(token);
    })
  );
}

function numericTokens(tokens: Set<string>): Set<string> {
  return new Set([...tokens].filter((token) => /\d/.test(token)));
}

/**
 * Proper nouns and acronyms, as written in the headline.
 *
 * A leading token is kept only when it is an acronym, because the first word of
 * a sentence is capitalized whatever it is — but "FTC" leading a headline is
 * still the FTC.
 */
function namedEntityTokens(title: string): Set<string> {
  const words = (title ?? "").split(/[^\p{L}\p{N}&.'-]+/u).filter(Boolean);
  const entities = new Set<string>();

  words.forEach((word, index) => {
    const bare = word.replace(/[.'-]+$/, "");

    if (bare.length < 2) {
      return;
    }

    const isAcronym = bare.length <= 6 && bare === bare.toUpperCase() && /^\p{Lu}/u.test(bare);

    if (isAcronym) {
      entities.add(bare.toLowerCase());
      return;
    }

    if (index === 0 || bare.length < 3) {
      return;
    }

    if (/^\p{Lu}/u.test(bare) && !TITLE_STOPWORDS.has(bare.toLowerCase())) {
      entities.add(bare.toLowerCase());
    }
  });

  return entities;
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let shared = 0;

  for (const value of left) {
    if (right.has(value)) {
      shared += 1;
    }
  }

  return shared;
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
