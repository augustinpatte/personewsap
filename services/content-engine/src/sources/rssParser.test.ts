import { describe, expect, it } from "vitest";

import { parseXmlFeed, sanitizeFeedTitle } from "./rssParser.js";

describe("sanitizeFeedTitle", () => {
  it("keeps a normal headline", () => {
    expect(sanitizeFeedTitle("Ferrari's first ever electric car sold for record $40m")).toBe(
      "Ferrari's first ever electric car sold for record $40m"
    );
  });

  it("collapses whitespace and newlines inside a headline", () => {
    expect(sanitizeFeedTitle("  A headline\n   split across lines  ")).toBe("A headline split across lines");
  });

  it("drops a title that swallowed feed markup and URLs", () => {
    // Shape of the real BBC item that produced a 1051-character title.
    const debris = [
      "Ferrari's first ever electric car sold for record $40m The Luce's launch drew backlash.",
      "https://www.bbc.co.uk/news/articles/c77ggpgrp2do?at_medium=RSS Mon, 17 Aug 2026 02:22:04 GMT",
      "Instagram and Facebook could change forever if Meta loses child privacy trial"
    ].join(" ");

    expect(sanitizeFeedTitle(debris)).toBeNull();
  });

  it("drops an over-long title even without a URL", () => {
    expect(sanitizeFeedTitle("A".repeat(400))).toBeNull();
  });

  it("drops an empty or missing title", () => {
    expect(sanitizeFeedTitle("   ")).toBeNull();
    expect(sanitizeFeedTitle(null)).toBeNull();
  });
});

describe("parseXmlFeed title hardening", () => {
  it("keeps well-formed items and nulls out debris titles", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example Desk</title>
  <item>
    <title>Regional lender tightens its terms</title>
    <link>https://example.test/a</link>
    <pubDate>Mon, 17 Aug 2026 08:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Headline one https://example.test/one Headline two https://example.test/two</title>
    <link>https://example.test/b</link>
    <pubDate>Mon, 17 Aug 2026 09:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

    const items = parseXmlFeed(xml);

    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Regional lender tightens its terms");
    // The fetcher skips items without a title, so this one never reaches ranking.
    expect(items[1].title).toBeNull();
    expect(items[1].url).toBe("https://example.test/b");
  });
});

describe("publisher attribution in the source footer", () => {
  it("does not present a byline as the publisher", () => {
    const feed = `<?xml version="1.0"?><rss><channel><title>SCOTUSblog</title>
      <item>
        <title>Florida Republicans bring a Census challenge</title>
        <link>https://www.scotusblog.com/2026/08/census/</link>
        <pubDate>Tue, 19 Aug 2026 08:00:00 GMT</pubDate>
        <dc:creator>Amy Howe</dc:creator>
      </item></channel></rss>`;

    expect(parseXmlFeed(feed)[0].publisher).toBe("SCOTUSblog");
  });

  it("decodes numeric character references in a publisher name", () => {
    const feed = `<?xml version="1.0"?><rss><channel><title>franceinfo - Sant&#xE9;</title>
      <item>
        <title>Une enquête sur des publications</title>
        <link>https://www.franceinfo.fr/sante/etude.html</link>
        <pubDate>Tue, 19 Aug 2026 08:00:00 GMT</pubDate>
      </item></channel></rss>`;

    expect(parseXmlFeed(feed)[0].publisher).toBe("franceinfo - Santé");
  });
});
