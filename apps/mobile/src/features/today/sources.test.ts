import { describe, expect, it } from "vitest";

import { getSourcesCopy } from "./contentCopy";
import type { SourceMetadata } from "./contentTypes";
import {
  canonicalSourceUrl,
  formatSourceDate,
  formatSourceMeta,
  getSourceDomain,
  getSourceName,
  isDisplayableSourceUrl,
  isPlaceholderSourceDomain,
  toDisplaySources
} from "./sources";

/**
 * Showing a reader what a piece of editorial content was built from.
 *
 * The rule the whole feature turns on: everything displayed is a value stored
 * in `public.sources`, and nothing is ever stood in for. A record with no title
 * shows no title; an item with no usable record shows no Sources section at
 * all, rather than an empty heading or an invented citation.
 */

function source(overrides: Partial<SourceMetadata> = {}): SourceMetadata {
  return {
    id: "source-1",
    url: "https://www.reuters.com/business/finance/article-a",
    title: "Central bank holds rates",
    publisher: "Reuters",
    author: null,
    published_at: "2026-09-04T06:12:00+00:00",
    retrieved_at: "2026-09-04T07:00:00+00:00",
    language: "en",
    content_hash: "hash-1",
    ...overrides
  };
}

describe("getSourceDomain", () => {
  it("reads the host and drops the www", () => {
    expect(getSourceDomain("https://www.reuters.com/business/x")).toBe("reuters.com");
    expect(getSourceDomain("https://investor.ryanair.com/news")).toBe(
      "investor.ryanair.com"
    );
  });

  it("drops a port and any credentials", () => {
    expect(getSourceDomain("https://user:pass@sec.gov:8443/filing")).toBe("sec.gov");
  });

  it("refuses anything that is not an http(s) host", () => {
    for (const url of ["", "not a url", "mailto:a@b.c", "https://localhost/x"]) {
      expect(getSourceDomain(url), url).toBeNull();
    }
  });
});

describe("which sources may be shown and opened", () => {
  it("accepts the real publishers the pipeline stores", () => {
    for (const url of [
      "https://www.reuters.com/business/finance/x",
      "https://www.sec.gov/Archives/edgar/data/1/000.htm",
      "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
      "http://legacy-archive.gouv.fr/bulletin/1998"
    ]) {
      expect(isDisplayableSourceUrl(url), url).toBe(true);
    }
  });

  it("refuses every scheme that is not http or https", () => {
    // Nothing out of a source record is ever handed to the OS as a custom
    // scheme, whatever ends up in the column.
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "personewsap://reader/1",
      "mailto:desk@reuters.com",
      "ftp://reuters.com/x",
      "",
      null,
      undefined
    ]) {
      expect(isDisplayableSourceUrl(url as string), String(url)).toBe(false);
    }
  });

  it("refuses the reserved placeholder domains", () => {
    // These are real rows in public.sources — the seeded launch catalog cites
    // "PersoNewsAP Sample Desk" at example.com. They resolve to nothing, and
    // shown to a reader they would read as an invented source.
    for (const domain of [
      "example.com",
      "example.org",
      "example.net",
      "docs.example.com",
      "localhost",
      "desk.invalid",
      "newsroom.test"
    ]) {
      expect(isPlaceholderSourceDomain(domain), domain).toBe(true);
    }

    expect(isDisplayableSourceUrl("https://example.com/tech-ai/ai-chip-supply")).toBe(
      false
    );
  });

  it("does not mistake a real publisher for a placeholder", () => {
    for (const domain of [
      "example-domain.com",
      "reuters.com",
      "science.nasa.gov",
      "static.inditex.com"
    ]) {
      expect(isPlaceholderSourceDomain(domain), domain).toBe(false);
    }
  });
});

describe("toDisplaySources", () => {
  it("shows a single source", () => {
    const displayed = toDisplaySources([source()]);

    expect(displayed).toHaveLength(1);
    expect(displayed[0]).toMatchObject({
      domain: "reuters.com",
      publisher: "Reuters",
      title: "Central bank holds rates",
      url: "https://www.reuters.com/business/finance/article-a"
    });
  });

  it("shows every distinct source of a multi-source item", () => {
    const displayed = toDisplaySources([
      source({ id: "a" }),
      source({
        id: "b",
        publisher: "U.S. Securities and Exchange Commission",
        title: "Form 8-K",
        url: "https://www.sec.gov/Archives/edgar/data/1/000.htm"
      }),
      source({
        id: "c",
        publisher: "France 24",
        title: "La dette américaine passe le seuil",
        url: "https://www.france24.com/fr/eco-tech/20260820-dette"
      })
    ]);

    expect(displayed.map((entry) => entry.domain)).toEqual([
      "reuters.com",
      "sec.gov",
      "france24.com"
    ]);
  });

  it("keeps the stored order, which is the editorial one", () => {
    // The query orders by source_order; the display must not re-sort it.
    const displayed = toDisplaySources([
      source({ id: "b", url: "https://sec.gov/b" }),
      source({ id: "a", url: "https://reuters.com/a" })
    ]);

    expect(displayed.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("collapses a source associated twice with the same item", () => {
    const displayed = toDisplaySources([source({ id: "a" }), source({ id: "a" })]);

    expect(displayed).toHaveLength(1);
  });

  it("collapses two records pointing at the same article", () => {
    const displayed = toDisplaySources([
      source({ id: "a", url: "https://www.reuters.com/business/x/" }),
      source({ id: "b", url: "https://reuters.com/business/x#section" })
    ]);

    expect(displayed).toHaveLength(1);
  });

  it("keeps two different articles from the same publisher", () => {
    // The publisher is never the dedup key: dropping one of these would hide a
    // real citation.
    const displayed = toDisplaySources([
      source({ id: "a", url: "https://www.reuters.com/business/rates" }),
      source({ id: "b", url: "https://www.reuters.com/business/energy" })
    ]);

    expect(displayed).toHaveLength(2);
    expect(displayed.every((entry) => entry.publisher === "Reuters")).toBe(true);
  });

  it("keeps two articles that differ only in the query string", () => {
    const displayed = toDisplaySources([
      source({ id: "a", url: "https://desk.example-domain.com/article?id=1" }),
      source({ id: "b", url: "https://desk.example-domain.com/article?id=2" })
    ]);

    expect(displayed).toHaveLength(2);
  });

  it("returns nothing when the item has no sources", () => {
    // The component renders null on an empty list, so this is what stops an
    // empty "Sources" heading from ever appearing.
    expect(toDisplaySources([])).toEqual([]);
    expect(toDisplaySources(undefined)).toEqual([]);
    expect(toDisplaySources(null)).toEqual([]);
  });

  it("returns nothing when every source is a placeholder", () => {
    expect(
      toDisplaySources([
        source({
          id: "sample",
          publisher: "PersoNewsAP Sample Desk",
          url: "https://example.com/tech-ai/ai-chip-supply"
        })
      ])
    ).toEqual([]);
  });

  it("keeps a missing publisher, title or date missing", () => {
    const [displayed] = toDisplaySources([
      source({ publisher: null, title: null, published_at: null })
    ]);

    expect(displayed.publisher).toBeNull();
    expect(displayed.title).toBeNull();
    expect(displayed.publishedAt).toBeNull();
    // The domain is the one thing that is always real, so a row is never empty.
    expect(displayed.domain).toBe("reuters.com");
  });

  it("treats a blank stored value as missing rather than printing it", () => {
    const [displayed] = toDisplaySources([source({ publisher: "  ", title: "" })]);

    expect(displayed.publisher).toBeNull();
    expect(displayed.title).toBeNull();
  });
});

describe("canonicalSourceUrl", () => {
  it("ignores case, the trailing slash and the fragment", () => {
    expect(canonicalSourceUrl("HTTPS://WWW.Reuters.com/x/")).toBe(
      canonicalSourceUrl("https://www.reuters.com/x#top")
    );
  });

  it("does not ignore the query, which identifies the article", () => {
    expect(canonicalSourceUrl("https://a.com/x?id=1")).not.toBe(
      canonicalSourceUrl("https://a.com/x?id=2")
    );
  });
});

describe("the dateline", () => {
  it("formats the publication date in the reader's locale", () => {
    const displayed = toDisplaySources([source()])[0];

    expect(formatSourceDate(displayed.publishedAt, "fr")).toMatch(/2026/);
    expect(formatSourceDate(displayed.publishedAt, "en")).toMatch(/2026/);
    // The same instant, written the way each locale writes it.
    expect(formatSourceDate(displayed.publishedAt, "fr")).not.toBe(
      formatSourceDate(displayed.publishedAt, "en")
    );
  });

  it("shows no date rather than a wrong one", () => {
    expect(formatSourceDate(null, "en")).toBeNull();
    expect(formatSourceDate("not a date", "en")).toBeNull();
  });

  it("falls back to the domain alone when there is no date", () => {
    const [displayed] = toDisplaySources([source({ published_at: null })]);

    expect(formatSourceMeta(displayed, "en")).toBe("reuters.com");
  });

  it("never leaves a dangling separator", () => {
    const [displayed] = toDisplaySources([source({ published_at: null })]);

    expect(formatSourceMeta(displayed, "en")).not.toContain("·");
  });
});

describe("naming a source", () => {
  it("uses the publisher when the record has one", () => {
    const [displayed] = toDisplaySources([source()]);

    expect(getSourceName(displayed)).toBe("Reuters");
  });

  it("falls back to the domain, never to an invented name", () => {
    const [displayed] = toDisplaySources([source({ publisher: null })]);

    expect(getSourceName(displayed)).toBe("reuters.com");
    expect(getSourceName(displayed)).not.toMatch(/unknown/i);
  });
});

describe("the Sources UI copy", () => {
  it("is French for a French reader", () => {
    const copy = getSourcesCopy("fr");

    expect(copy.heading).toBe("Sources");
    expect(copy.openSource("Reuters")).toBe("Ouvrir la source Reuters");
    expect(copy.openFailed).toBe(
      "Impossible d'ouvrir cette source. Le lien a été copié."
    );
  });

  it("is English for an English reader", () => {
    const copy = getSourcesCopy("en");

    expect(copy.heading).toBe("Sources");
    expect(copy.openSource("Reuters")).toBe("Open Reuters source");
    expect(copy.openFailed).toBe(
      "This source could not be opened. The link has been copied."
    );
  });

  it("claims nothing about a source beyond its existence", () => {
    // Source transparency is not a guarantee of truth, and the app has no
    // system that would establish one.
    for (const language of ["en", "fr"] as const) {
      const rendered = JSON.stringify(getSourcesCopy(language)).toLowerCase();

      for (const claim of [
        "verified",
        "vérifié",
        "fact check",
        "fact-check",
        "trusted",
        "fiable",
        "source sûre"
      ]) {
        expect(rendered, `${language}: ${claim}`).not.toContain(claim);
      }
    }
  });

  it("localizes the controls and nothing the source itself said", () => {
    // Publisher, title and URL come back from the record untouched in both
    // languages: a Reuters headline stays in the language Reuters published it.
    const record = source({ publisher: "France 24", title: "La dette américaine" });
    const [displayed] = toDisplaySources([record]);

    expect(displayed.publisher).toBe("France 24");
    expect(displayed.title).toBe("La dette américaine");
    expect(displayed.url).toBe(record.url);
  });
});
