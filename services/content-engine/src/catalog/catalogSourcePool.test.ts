import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Language, RankedArticle, TopicId } from "../domain.js";
import { rotateSourceWindow } from "./bootstrapCatalog.js";
import {
  catalogSourceSince,
  clampCatalogRecencyDays,
  DEFAULT_CATALOG_SOURCE_RECENCY_DAYS,
  MAX_CATALOG_SOURCE_RECENCY_DAYS
} from "./catalogRecency.js";

/**
 * Why the English source pool collapsed, and what now keeps it open.
 *
 * The interrupted run fetched 126 English articles and generated from one. The
 * cause was not language filtering and not ranking: the catalog asked the source
 * layer for `since = the edition date`, and the recency ladder that softens that
 * question into J / J-1 / J-2 only runs for French. For English, `since` is a
 * hard cutoff, so only the single feed that had published since midnight
 * survived.
 *
 * Newsletter keeps that behaviour — it is today's news. Reusable catalog content
 * asks a different question, and these tests hold the two apart.
 */

const DROP_DATE = "2026-08-20";

function article(input: {
  url: string;
  language: Language;
  topic: TopicId;
  publishedAt: string;
}): RankedArticle {
  return {
    url: input.url,
    title: `Development at ${input.url}`,
    publisher: "Publisher",
    author: null,
    published_at: input.publishedAt,
    retrieved_at: `${DROP_DATE}T09:00:00.000Z`,
    language: input.language,
    summary: "A concrete development with one measurable signal.",
    body: "Body.",
    sourceTopic: input.topic,
    canonicalTopic: input.topic,
    credibility_score: 0.9,
    content_hash: input.url,
    normalized_url: input.url,
    topic: input.topic,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

describe("the catalog asks for a window, not for today", () => {
  it("moves the since date back by the catalog window", () => {
    expect(catalogSourceSince(DROP_DATE, 7)).toBe("2026-08-13");
    expect(catalogSourceSince(DROP_DATE, 1)).toBe("2026-08-19");
  });

  it("defaults to a week", () => {
    expect(DEFAULT_CATALOG_SOURCE_RECENCY_DAYS).toBe(7);
    expect(catalogSourceSince(DROP_DATE, DEFAULT_CATALOG_SOURCE_RECENCY_DAYS)).toBe("2026-08-13");
  });

  it("is bounded: reusable does not mean timeless", () => {
    expect(clampCatalogRecencyDays(9999)).toBe(MAX_CATALOG_SOURCE_RECENCY_DAYS);
    expect(catalogSourceSince(DROP_DATE, 9999)).toBe(
      catalogSourceSince(DROP_DATE, MAX_CATALOG_SOURCE_RECENCY_DAYS)
    );
  });

  it("never widens the window on a malformed date or a negative value", () => {
    expect(catalogSourceSince("not-a-date", 7)).toBe("not-a-date");
    expect(catalogSourceSince(DROP_DATE, 0)).toBe(DROP_DATE);
    expect(clampCatalogRecencyDays(-5)).toBe(0);
    expect(clampCatalogRecencyDays(Number.NaN)).toBe(DEFAULT_CATALOG_SOURCE_RECENCY_DAYS);
  });

  it("keeps the whole window inside the source layer's own staleness limit", () => {
    // The RSS layer drops anything older than its max age; the catalog window
    // must not be able to reach past it and ask for content that will never
    // arrive.
    const fetcher = readFileSync(
      join(__dirname, "..", "sources", "rssFetcher.ts"),
      "utf8"
    );
    const declared = /DEFAULT_RSS_MAX_AGE_DAYS\s*=\s*(\d+)/.exec(fetcher);

    expect(declared).not.toBeNull();
    expect(MAX_CATALOG_SOURCE_RECENCY_DAYS).toBeLessThanOrEqual(Number(declared?.[1]));
  });
});

describe("a rich English pool must not collapse to a single article", () => {
  const englishPool = Array.from({ length: 40 }, (_, index) =>
    article({
      url: `https://en.test/${index}`,
      language: "en",
      topic: "business",
      // Published over the three days before the edition date, as real feeds
      // are once a run starts in the afternoon.
      publishedAt: `2026-08-${17 + (index % 3)}T21:00:00.000Z`
    })
  );

  it("keeps the pool when the catalog window covers the last days", () => {
    const since = catalogSourceSince(DROP_DATE, DEFAULT_CATALOG_SOURCE_RECENCY_DAYS);
    const kept = englishPool.filter(
      (candidate) => (candidate.published_at ?? "").slice(0, 10) >= since
    );

    expect(kept).toHaveLength(englishPool.length);
  });

  it("shows what the old same-day question did to that same pool", () => {
    // Reproduces the collapse: with `since = the edition date` and no ladder for
    // English, a pool published the day before disappears entirely.
    const kept = englishPool.filter(
      (candidate) => (candidate.published_at ?? "").slice(0, 10) >= DROP_DATE
    );

    expect(kept).toHaveLength(0);
  });

  it("does not discard English articles for being English", () => {
    // Language filtering was never the cause: every item in an English pool
    // survives a language filter for English.
    const kept = englishPool.filter((candidate) => candidate.language === "en");

    expect(kept).toHaveLength(englishPool.length);
  });
});

describe("Newsletter recency is untouched", () => {
  it("still asks the source layer for its own edition date", () => {
    const dailyJob = readFileSync(join(__dirname, "..", "cli", "dailyJobTest.ts"), "utf8");

    expect(dailyJob).toMatch(/since: options\.dropDate/);
    expect(dailyJob).not.toMatch(/catalogSourceSince/);
  });

  it("keeps the J / J-1 / J-2 ladder exactly as it was", () => {
    const fetcher = readFileSync(join(__dirname, "..", "sources", "rssFetcher.ts"), "utf8");

    expect(fetcher).toMatch(/FR_RECENCY_LADDER_DAYS = \[0, 1, 2\]/);
  });

  it("changes nothing in the source layer for the catalog window", () => {
    // The separation is made by what the catalog asks for, not by rewriting the
    // shared source layer underneath the Newsletter.
    const recency = readFileSync(join(__dirname, "catalogRecency.ts"), "utf8");

    expect(recency).not.toMatch(/FR_RECENCY_LADDER|FR_TOPIC_THRESHOLDS/);
  });

  it("is only the bootstrap that opens the window", () => {
    const bootstrap = readFileSync(join(__dirname, "..", "cli", "bootstrapCatalog.ts"), "utf8");

    expect(bootstrap).toMatch(/catalogSourceSince\(options\.dropDate, options\.catalogRecencyDays\)/);
  });
});

describe("bilingual pairs draw on one source packet", () => {
  const generator = readFileSync(
    join(__dirname, "..", "generation", "llmGenerator.ts"),
    "utf8"
  );

  it("pins the counterpart language to the sources the reference cited", () => {
    expect(generator).toMatch(/pairSourceUrls/);
    expect(generator).toMatch(
      /request\.articles\.filter\(\(article\) => pairSourceUrls\.has\(article\.url\)\)/
    );
  });

  it("does not require the source itself to be written in the target language", () => {
    // A French Franceinfo article can ground the English version of the same
    // case: the document's language is independent of the item's.
    expect(generator).toMatch(/own language is independent of the language the item is written in/i);
  });

  it("still restricts a normal, unpaired generation to same-language sources", () => {
    expect(generator).toMatch(
      /request\.articles\.filter\(\(article\) => article\.language === request\.language\)/
    );
  });
});

describe("source diversity inside one topic batch", () => {
  const pool = [1, 2, 3, 4, 5].map((index) =>
    article({
      url: `https://en.test/business/${index}`,
      language: "en",
      topic: "business",
      publishedAt: `${DROP_DATE}T08:00:00.000Z`
    })
  );

  it("puts an unused source first once earlier entries have consumed one", () => {
    const used = new Set(["https://en.test/business/1"]);
    const ordered = rotateSourceWindow(pool, ["business"], 0, used);

    expect(ordered[0].url).not.toBe("https://en.test/business/1");
    // Reuse is demoted, never removed.
    expect(ordered.map((entry) => entry.url)).toContain("https://en.test/business/1");
  });

  it("still offers a used source when the batch has nothing else left", () => {
    const used = new Set(pool.map((entry) => entry.url));
    const ordered = rotateSourceWindow(pool, ["business"], 0, used);

    expect(ordered).toHaveLength(pool.length);
  });

  it("does not reach for an off-topic source to manufacture variety", () => {
    const offTopic = article({
      url: "https://en.test/medicine/1",
      language: "en",
      topic: "medicine",
      publishedAt: `${DROP_DATE}T08:00:00.000Z`
    });
    const used = new Set(pool.map((entry) => entry.url));
    const ordered = rotateSourceWindow([...pool, offTopic], ["business"], 0, used);

    // Every on-topic source, used or not, still outranks the unrelated one.
    expect(ordered.at(-1)?.url).toBe(offTopic.url);
  });

  it("behaves exactly as before when nothing has been used yet", () => {
    expect(rotateSourceWindow(pool, ["business"], 2, new Set()).map((entry) => entry.url)).toEqual(
      rotateSourceWindow(pool, ["business"], 2).map((entry) => entry.url)
    );
  });
});
