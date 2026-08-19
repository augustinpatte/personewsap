export type ParsedFeedItem = {
  publisher: string | null;
  rawDate: string | null;
  summary: string | null;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
};

type XmlElement = {
  attributes: Record<string, string>;
  innerXml: string;
  localName: string;
};

export function parseXmlFeed(xml: string): ParsedFeedItem[] {
  if (!xml.trim()) {
    return [];
  }

  const feedPublisher = readFeedPublisher(xml);

  return findElementsByLocalName(xml, "item")
    .concat(findElementsByLocalName(xml, "entry"))
    .flatMap((element) => {
      try {
        const rawDate = readText(element.innerXml, ["pubDate", "published", "updated", "date", "modified"]);

        return {
          publisher: readItemPublisher(element.innerXml) ?? feedPublisher,
          rawDate,
          summary: readFeedSummary(element.innerXml),
          title: sanitizeFeedTitle(readText(element.innerXml, ["title"])),
          url: readFeedUrl(element.innerXml),
          publishedAt: normalizePublishedAt(rawDate)
        };
      } catch {
        return [];
      }
    });
}

/**
 * A headline is one short line. When a feed ships a malformed item — an unclosed
 * tag, an escaped `<` inside the title — the scanner's closing-tag search runs
 * past the real end and the "title" swallows several entries' worth of text and
 * URLs. That is how a BBC item once produced a 1051-character title containing
 * three headlines and their links.
 *
 * Such a value is parse debris, not a headline. Returning null drops the item in
 * the fetcher (which requires a title), so garbage never reaches ranking,
 * generation, or the catalog.
 */
const MAX_FEED_TITLE_CHARS = 300;

export function sanitizeFeedTitle(rawTitle: string | null): string | null {
  if (!rawTitle) {
    return null;
  }

  const title = rawTitle.replace(/\s+/g, " ").trim();

  if (title.length === 0 || title.length > MAX_FEED_TITLE_CHARS) {
    return null;
  }

  if (/https?:\/\//i.test(title)) {
    return null;
  }

  return title;
}

function readFeedUrl(xml: string): string | null {
  const rssLink = readText(xml, ["link"]);
  if (rssLink && !rssLink.includes("<") && isLikelyUrl(rssLink)) {
    return cleanUrl(rssLink);
  }

  const atomLinks = findElementsByLocalName(xml, "link");
  const alternateLink =
    atomLinks.find((link) => !readAttribute(link, "rel") || readAttribute(link, "rel") === "alternate") ??
    atomLinks[0];
  const href = alternateLink ? readAttribute(alternateLink, "href") : null;
  if (href && isLikelyUrl(href)) {
    return cleanUrl(href);
  }

  const permalinkGuid = findElementsByLocalName(xml, "guid").find((guid) => readAttribute(guid, "isPermaLink") !== "false");
  const guidUrl = normalizeText(permalinkGuid?.innerXml ?? "");
  if (guidUrl && isLikelyUrl(guidUrl)) {
    return cleanUrl(guidUrl);
  }

  const id = readText(xml, ["id"]);
  return id && isLikelyUrl(id) ? cleanUrl(id) : null;
}

function readFeedPublisher(xml: string): string | null {
  const channel = findElementsByLocalName(xml, "channel").at(0);
  const feed = findElementsByLocalName(xml, "feed").at(0);
  const root = channel?.innerXml ?? feed?.innerXml ?? xml;

  return readText(root, ["title", "publisher"]) ?? readAuthor(root);
}

/**
 * The publisher of an item, and never its byline.
 *
 * `dc:creator` and `<author>` name the journalist, so reading them here filed
 * SCOTUSblog under "Amy Howe" and IEEE Spectrum under "Alexander Brem" in the
 * source footer. When an item carries no publisher of its own, the caller falls
 * back to the curated source's publisher, which is the accurate attribution.
 */
function readItemPublisher(xml: string): string | null {
  return readText(xml, ["source", "publisher"]);
}

function readAuthor(xml: string): string | null {
  const author = findElementsByLocalName(xml, "author").at(0);
  if (!author) {
    return null;
  }

  return readText(author.innerXml, ["name"]) ?? normalizeText(author.innerXml);
}

function readFeedSummary(xml: string): string | null {
  const summary = readText(xml, ["description", "summary", "subtitle"]);
  if (summary) {
    return limitSummary(summary);
  }

  const contentSnippet = readText(xml, ["encoded", "content"]);
  return contentSnippet ? limitSummary(contentSnippet) : null;
}

function readText(xml: string, names: string[]): string | null {
  for (const name of names) {
    const element = findElementsByLocalName(xml, name).at(0);
    const text = normalizeText(element?.innerXml ?? "");

    if (text) {
      return text;
    }
  }

  return null;
}

function findElementsByLocalName(xml: string, localName: string): XmlElement[] {
  const elements: XmlElement[] = [];
  const wantedName = normalizeName(localName);
  let cursor = 0;

  while (cursor < xml.length) {
    const openStart = xml.indexOf("<", cursor);
    if (openStart === -1) {
      break;
    }

    const tag = readOpeningTag(xml, openStart);
    if (!tag) {
      cursor = openStart + 1;
      continue;
    }

    cursor = tag.end + 1;

    if (tag.isClosing || tag.isComment || tag.isDeclaration || tag.localName !== wantedName) {
      continue;
    }

    if (tag.selfClosing) {
      elements.push({
        attributes: tag.attributes,
        innerXml: "",
        localName: tag.localName
      });
      continue;
    }

    const closeStart = findMatchingClose(xml, tag.rawName, tag.localName, tag.end + 1);
    if (closeStart === -1) {
      continue;
    }

    elements.push({
      attributes: tag.attributes,
      innerXml: xml.slice(tag.end + 1, closeStart),
      localName: tag.localName
    });

    cursor = closeStart + 1;
  }

  return elements;
}

function readOpeningTag(xml: string, start: number): {
  attributes: Record<string, string>;
  end: number;
  isClosing: boolean;
  isComment: boolean;
  isDeclaration: boolean;
  localName: string;
  rawName: string;
  selfClosing: boolean;
} | null {
  const end = findTagEnd(xml, start + 1);
  if (end === -1) {
    return null;
  }

  const rawTag = xml.slice(start + 1, end).trim();
  const isClosing = rawTag.startsWith("/");
  const isComment = rawTag.startsWith("!--");
  const isDeclaration = rawTag.startsWith("?") || rawTag.startsWith("!") || rawTag.toUpperCase().startsWith("DOCTYPE");
  const selfClosing = rawTag.endsWith("/");
  const body = rawTag.replace(/^\/+/, "").replace(/\/$/, "").trim();
  const rawName = body.split(/\s+/, 1)[0] ?? "";

  return {
    attributes: parseAttributes(body.slice(rawName.length)),
    end,
    isClosing,
    isComment,
    isDeclaration,
    localName: normalizeName(rawName),
    rawName,
    selfClosing
  };
}

function findMatchingClose(xml: string, rawName: string, localName: string, start: number): number {
  let cursor = start;
  let depth = 1;

  while (cursor < xml.length) {
    const tagStart = xml.indexOf("<", cursor);
    if (tagStart === -1) {
      return -1;
    }

    const tag = readOpeningTag(xml, tagStart);
    if (!tag) {
      cursor = tagStart + 1;
      continue;
    }

    cursor = tag.end + 1;

    if (tag.isComment || tag.isDeclaration || tag.localName !== localName) {
      continue;
    }

    if (tag.isClosing && (normalizeName(tag.rawName) === localName || tag.rawName === rawName)) {
      depth -= 1;
      if (depth === 0) {
        return tagStart;
      }
      continue;
    }

    if (!tag.selfClosing) {
      depth += 1;
    }
  }

  return -1;
}

function findTagEnd(xml: string, cursor: number): number {
  let quote: string | null = null;

  for (let index = cursor; index < xml.length; index += 1) {
    const character = xml[index];

    if ((character === "\"" || character === "'") && xml[index - 1] !== "\\") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }

    if (character === ">" && !quote) {
      return index;
    }
  }

  return -1;
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(value)) !== null) {
    attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  }

  return attributes;
}

function readAttribute(element: XmlElement, name: string): string | null {
  const wantedName = normalizeName(name);
  const entry = Object.entries(element.attributes).find(([attributeName]) => normalizeName(attributeName) === wantedName);
  return entry?.[1] ?? null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().split(":").at(-1) ?? name.toLowerCase();
}

function normalizeText(value: string): string | null {
  const text = decodeXml(stripCdata(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  return text || null;
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    // Numeric references, which several feeds use for accented characters.
    // Left raw they reached the published source footer as "franceinfo-
    // Sant&#xE9;".
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d{1,7});/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function normalizePublishedAt(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function cleanUrl(value: string): string {
  return decodeXml(value).trim();
}

function isLikelyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function limitSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 700) {
    return normalized;
  }

  return `${normalized.slice(0, 697).trimEnd()}...`;
}
