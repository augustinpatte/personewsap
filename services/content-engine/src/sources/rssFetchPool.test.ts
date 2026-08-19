import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CuratedSource } from "./types.js";
import {
  classifyFetchFailure,
  computeRetryDelayMs,
  createHttpStatusError,
  mapWithConcurrency
} from "./fetchPool.js";
import { RssFeedConnector } from "./rssFetcher.js";

/**
 * The English proof failed 44 feeds out of 44, every one of them at exactly the
 * timeout value. That signature is one process opening 44 sockets at once, not
 * 44 broken publishers: the timeout budget was spent queueing rather than
 * downloading.
 *
 * These tests pin the two properties that fix it — a hard ceiling on in-flight
 * requests, and a retry policy that spends attempts only where another attempt
 * can change the answer.
 */

function feed(index: number, language: "fr" | "en" = "en"): CuratedSource {
  return {
    id: `source-${index}`,
    publisher: `Publisher ${index}`,
    topic: "business",
    language,
    region: "global",
    rssUrl: `https://feeds.test/${index}.xml`
  } as CuratedSource;
}

function feedXml(title: string): string {
  const publishedAt = new Date().toUTCString();

  return `<?xml version="1.0"?><rss><channel>
    <item>
      <title>${title}</title>
      <link>https://feeds.test/${encodeURIComponent(title)}</link>
      <description>A sourced business development with revenue detail.</description>
      <pubDate>${publishedAt}</pubDate>
    </item>
  </channel></rss>`;
}

function okResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.RSS_FETCH_CONCURRENCY;
});

describe("mapWithConcurrency", () => {
  it("never exceeds the configured ceiling", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 6, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return value;
    });

    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  it("keeps input order and reports failures without rejecting", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) {
        throw new Error("boom");
      }
      return value * 10;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 30 });
  });

  it("handles an empty batch and a ceiling above the batch size", async () => {
    expect(await mapWithConcurrency([], 6, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1], 99, async (v) => v)).toEqual([
      { status: "fulfilled", value: 1 }
    ]);
  });
});

describe("failure classification", () => {
  it.each([
    [createHttpStatusError("rate limited", 429), "transient"],
    [createHttpStatusError("bad gateway", 502), "transient"],
    [createHttpStatusError("unavailable", 503), "transient"],
    [createHttpStatusError("gateway timeout", 504), "transient"],
    [createHttpStatusError("server error", 500), "transient"],
    [createHttpStatusError("not found", 404), "permanent"],
    [createHttpStatusError("forbidden", 403), "permanent"],
    [createHttpStatusError("gone", 410), "permanent"]
  ])("classifies %s", (error, kind) => {
    expect(classifyFetchFailure(error).kind).toBe(kind);
  });

  it("treats aborts and connection errors as transient", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });

    expect(classifyFetchFailure(abort)).toEqual({ kind: "transient", code: "timeout" });
    expect(classifyFetchFailure(new Error("ECONNRESET")).kind).toBe("transient");
    expect(classifyFetchFailure(new Error("fetch failed")).kind).toBe("transient");
  });

  it("treats a parse failure as permanent", () => {
    expect(classifyFetchFailure(new Error("RSS parse failed")).kind).toBe("permanent");
  });
});

describe("retry backoff", () => {
  it("grows exponentially and adds jitter", () => {
    expect(computeRetryDelayMs(1, 250, () => 0)).toBe(250);
    expect(computeRetryDelayMs(2, 250, () => 0)).toBe(500);
    expect(computeRetryDelayMs(1, 250, () => 1)).toBeGreaterThan(250);
    // Capped so a retry never stalls the batch.
    expect(computeRetryDelayMs(10, 250, () => 1)).toBeLessThanOrEqual(5_000);
  });
});

describe("the connector under load", () => {
  beforeEach(() => {
    process.env.RSS_FETCH_CONCURRENCY = "6";
  });

  it("completes a 44-source English batch without unbounded fan-out", async () => {
    let inFlight = 0;
    let peak = 0;

    globalThis.fetch = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return okResponse(feedXml("English business item"));
    }) as unknown as typeof fetch;

    const sources = Array.from({ length: 44 }, (_, index) => feed(index));
    const connector = new RssFeedConnector(sources, { concurrency: 6 });

    const articles = await connector.fetchArticles({
      topics: ["business"],
      languages: ["en"],
      since: new Date().toISOString().slice(0, 10),
      limitPerTopic: 10
    });

    const diagnostics = connector.getLastDiagnostics();

    // The regression this replaces: 44 attempted, 0 succeeded.
    expect(diagnostics.attempted).toBe(44);
    expect(diagnostics.succeeded).toBe(44);
    expect(diagnostics.failed).toBe(0);
    expect(articles.length).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(6);
  });

  it("retries a timeout exactly once", async () => {
    let attempts = 0;

    globalThis.fetch = vi.fn(async () => {
      attempts += 1;

      if (attempts === 1) {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }

      return okResponse(feedXml("Recovered after timeout"));
    }) as unknown as typeof fetch;

    const connector = new RssFeedConnector([feed(1)], { concurrency: 1 });
    await connector.fetchArticles({
      topics: ["business"],
      languages: ["en"],
      since: new Date().toISOString().slice(0, 10),
      limitPerTopic: 5
    });

    expect(attempts).toBe(2);
    expect(connector.getLastDiagnostics().succeeded).toBe(1);
  });

  it("retries a 503 exactly once", async () => {
    let attempts = 0;

    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      return attempts === 1
        ? new Response("busy", { status: 503 })
        : okResponse(feedXml("Recovered after 503"));
    }) as unknown as typeof fetch;

    const connector = new RssFeedConnector([feed(1)], { concurrency: 1 });
    await connector.fetchArticles({
      topics: ["business"],
      languages: ["en"],
      since: new Date().toISOString().slice(0, 10),
      limitPerTopic: 5
    });

    expect(attempts).toBe(2);
    expect(connector.getLastDiagnostics().succeeded).toBe(1);
  });

  it("does not retry a 404", async () => {
    let attempts = 0;

    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;

    const connector = new RssFeedConnector([feed(1), feed(2)], { concurrency: 2 });

    // Every eligible feed failed, so the connector fails loudly.
    await expect(
      connector.fetchArticles({
        topics: ["business"],
        languages: ["en"],
        since: new Date().toISOString().slice(0, 10),
        limitPerTopic: 5
      })
    ).rejects.toThrow(/All RSS sources failed/);

    // Two sources, one attempt each: a permanent answer is never repeated.
    expect(attempts).toBe(2);
  });

  it("keeps the good feeds when some fail", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      return String(url).includes("/1.xml")
        ? new Response("nope", { status: 404 })
        : okResponse(feedXml("Healthy feed item"));
    }) as unknown as typeof fetch;

    const connector = new RssFeedConnector([feed(1), feed(2), feed(3)], { concurrency: 3 });
    const articles = await connector.fetchArticles({
      topics: ["business"],
      languages: ["en"],
      since: new Date().toISOString().slice(0, 10),
      limitPerTopic: 5
    });

    const diagnostics = connector.getLastDiagnostics();

    expect(diagnostics.succeeded).toBe(2);
    expect(diagnostics.failed).toBe(1);
    expect(articles.length).toBeGreaterThan(0);
    // One bad feed must never take the batch down.
    expect(diagnostics.errors[0].source_id).toBe("source-1");
  });
});
