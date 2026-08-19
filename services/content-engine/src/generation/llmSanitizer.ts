import { TOPIC_IDS, type DailyDropPayload, type GeneratedContentItem, type TopicId } from "../domain.js";

type SanitizerSource = {
  url: string;
  title: string;
  publisher: string;
  published_at?: string | null;
  retrieved_at: string;
  topic: TopicId;
};

const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;

const CONCEPT_TITLE_ANCHORS: Record<TopicId, { titlePrefix: string; matches: string[] }> = {
  business: {
    titlePrefix: "Pricing power",
    matches: ["business model", "pricing power", "pricing", "distribution"]
  },
  finance: {
    titlePrefix: "Risk",
    matches: ["rates", "rate", "capital", "risk"]
  },
  tech_ai: {
    titlePrefix: "AI adoption",
    matches: ["ai adoption", "ai", "compute", "model risk", "model"]
  },
  law: {
    titlePrefix: "Regulation",
    matches: ["regulation", "compliance", "legal risk", "legal"]
  },
  medicine: {
    titlePrefix: "Clinical evidence",
    matches: ["clinical evidence", "clinical", "health systems", "health"]
  },
  engineering: {
    titlePrefix: "Infrastructure",
    matches: ["infrastructure", "technical constraint", "technical", "constraint"]
  },
  sport_business: {
    titlePrefix: "Media rights",
    matches: ["sports business", "media rights", "sponsorship", "rights", "sponsor"]
  },
  culture_media: {
    titlePrefix: "Audience distribution",
    matches: ["media economics", "audience", "distribution", "media"]
  }
};

export function sanitizeLlmDailyDropPayload(
  payload: DailyDropPayload,
  sources: SanitizerSource[]
): DailyDropPayload {
  if (sources.length === 0) {
    return payload;
  }

  const allowedUrls = new Set(sources.map((source) => source.url));
  const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
  const canonicalUrlByNormalizedUrl = new Map(sources.map((source) => [normalizeUrlKey(source.url), source.url]));

  return {
    ...payload,
    items: payload.items.map((item) => sanitizeGeneratedItem(
      item,
      sources,
      allowedUrls,
      sourceByUrl,
      canonicalUrlByNormalizedUrl
    ))
  };
}

function sanitizeGeneratedItem(
  item: GeneratedContentItem,
  sources: SanitizerSource[],
  allowedUrls: Set<string>,
  sourceByUrl: Map<string, SanitizerSource>,
  canonicalUrlByNormalizedUrl: Map<string, string>
): GeneratedContentItem {
  const originalSourceUrls = sourceUrlsFor(item);
  const topic = topicFor(item.topic);
  const primarySource = selectPrimarySource(
    item,
    originalSourceUrls,
    sources,
    allowedUrls,
    sourceByUrl,
    canonicalUrlByNormalizedUrl
  );
  const sanitizedTopic = topic ?? primarySource.topic;
  const sanitizedSourceUrls = sanitizeSourceUrls(originalSourceUrls, primarySource, allowedUrls, canonicalUrlByNormalizedUrl);
  const citedSources = (sanitizedSourceUrls.length > 0 ? sanitizedSourceUrls : [primarySource.url])
    .map((url) => sourceByUrl.get(url))
    .filter((source): source is SanitizerSource => Boolean(source));
  // Every cited source, not just the first: the footer must account for the
  // whole packet the item actually drew on.
  const bodyMd = sanitizeBody(item.body_md, citedSources.length > 0 ? citedSources : [primarySource]);
  const sanitizedItem = {
    ...item,
    topic: sanitizedTopic,
    source_urls: sanitizedSourceUrls.length > 0 ? sanitizedSourceUrls : [primarySource.url],
    body_md: bodyMd
  } as GeneratedContentItem;

  if (sanitizedItem.content_type !== "concept") {
    return sanitizedItem;
  }

  return {
    ...sanitizedItem,
    category:
      sanitizedItem.category === "career" || sanitizedItem.category === sanitizedTopic
        ? sanitizedItem.category
        : sanitizedTopic,
    title: sanitizeConceptTitle(sanitizedItem.title, sanitizedTopic)
  };
}

function selectPrimarySource(
  item: GeneratedContentItem,
  originalSourceUrls: string[],
  sources: SanitizerSource[],
  allowedUrls: Set<string>,
  sourceByUrl: Map<string, SanitizerSource>,
  canonicalUrlByNormalizedUrl: Map<string, string>
): SanitizerSource {
  const topic = topicFor(item.topic);
  const firstAllowedSource = originalSourceUrls
    .map((url) => canonicalAllowedUrl(url, allowedUrls, canonicalUrlByNormalizedUrl))
    .filter((url): url is string => Boolean(url))
    .map((url) => sourceByUrl.get(url))
    .find((source): source is SanitizerSource => Boolean(source));
  const matchingTopicSource = topic ? sources.find((source) => source.topic === topic) : undefined;

  return firstAllowedSource ?? matchingTopicSource ?? sources[0];
}

function sanitizeSourceUrls(
  originalSourceUrls: string[],
  primarySource: SanitizerSource,
  allowedUrls: Set<string>,
  canonicalUrlByNormalizedUrl: Map<string, string>
): string[] {
  const validUrls = unique(
    originalSourceUrls
      .map((url) => canonicalAllowedUrl(url, allowedUrls, canonicalUrlByNormalizedUrl))
      .filter((url): url is string => Boolean(url))
  );
  const originalFirstUrl = originalSourceUrls[0];
  const originalFirstUrlAllowed = Boolean(
    originalFirstUrl && canonicalAllowedUrl(originalFirstUrl, allowedUrls, canonicalUrlByNormalizedUrl)
  );

  if (!originalFirstUrlAllowed) {
    return unique([primarySource.url, ...validUrls]);
  }

  return validUrls.length > 0 ? validUrls : [primarySource.url];
}

/**
 * Matches a trailing attribution block the model wrote itself, in either
 * language, so it can be replaced rather than appended to.
 *
 * Anchored to the end of the body: a "Sources :" line mid-article is prose, the
 * one that closes the piece is the footer.
 */
const MODEL_SOURCE_FOOTER_PATTERN =
  /\n+\s*(?:\*\*)?(?:sources?|source)\s*(?:\*\*)?\s*[:：][\s\S]*$/i;

/**
 * Replace whatever attribution the model produced with one built from real
 * source metadata.
 *
 * The proof showed the model closing articles with "Sources : Reuters (date),
 * Financial Times (date)" when the packet contained a single France24 item. No
 * prompt wording fully removes that risk, so the footer is not trusted at all:
 * it is stripped and rebuilt from the SanitizerSource records behind the
 * item's allowed source_urls. A publisher that is not in the packet has nothing
 * to be rebuilt from, so it cannot survive.
 */
function sanitizeBody(bodyMd: unknown, sources: SanitizerSource[]): string {
  const body = typeof bodyMd === "string" ? bodyMd.trim() : "";
  const withoutModelFooter = body.replace(MODEL_SOURCE_FOOTER_PATTERN, "").trim();
  const footer = canonicalSourceFooter(sources);

  return [withoutModelFooter, footer].filter(Boolean).join("\n\n");
}

/**
 * The canonical footer: publisher, published date when known, retrieved date
 * and the exact URL, for every source the item actually used.
 */
export function canonicalSourceFooter(sources: SanitizerSource[]): string {
  if (sources.length === 0) {
    return "";
  }

  const seen = new Set<string>();
  const lines: string[] = [];

  for (const source of sources) {
    if (seen.has(source.url)) {
      continue;
    }

    seen.add(source.url);
    lines.push(sourceLine(source));
  }

  return lines.join("\n");
}

function sourceLine(source: SanitizerSource): string {
  const publishedDate = source.published_at?.slice(0, 10) ?? null;
  const retrievedDate = source.retrieved_at.slice(0, 10);
  const dateText = publishedDate
    ? `published ${publishedDate}, retrieved ${retrievedDate}`
    : `retrieved ${retrievedDate}`;

  return `Source: ${source.publisher}, ${dateText}. ${source.url}`;
}

function sanitizeConceptTitle(title: string, topic: TopicId): string {
  const trimmedTitle = title.trim();
  const anchor = CONCEPT_TITLE_ANCHORS[topic];
  const normalizedTitle = normalizeForAnchorCheck(trimmedTitle);

  if (anchor.matches.some((match) => normalizedTitle.includes(match))) {
    return trimmedTitle || anchor.titlePrefix;
  }

  return trimmedTitle ? `${anchor.titlePrefix}: ${trimmedTitle}` : anchor.titlePrefix;
}

function sourceUrlsFor(item: GeneratedContentItem): string[] {
  if (!Array.isArray(item.source_urls)) {
    return [];
  }

  return item.source_urls
    .filter((url): url is string => typeof url === "string")
    .map((url) => url.trim())
    .filter(Boolean);
}

function topicFor(value: unknown): TopicId | null {
  return typeof value === "string" && TOPIC_IDS.includes(value as TopicId)
    ? (value as TopicId)
    : null;
}

function normalizeForAnchorCheck(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function canonicalAllowedUrl(
  value: string,
  allowedUrls: Set<string>,
  canonicalUrlByNormalizedUrl: Map<string, string>
): string | null {
  if (allowedUrls.has(value)) {
    return value;
  }

  return canonicalUrlByNormalizedUrl.get(normalizeUrlKey(value)) ?? null;
}

function bodyIncludesUrl(body: string, sourceUrl: string): boolean {
  if (body.includes(sourceUrl)) {
    return true;
  }

  try {
    if (body.includes(decodeURI(sourceUrl))) {
      return true;
    }
  } catch {
    // Fall through to normalized URL matching.
  }

  const normalizedSource = normalizeUrlKey(sourceUrl);
  const bodyUrls = Array.from(body.matchAll(/https?:\/\/[^\s)\]]+/gi)).map((match) => normalizeUrlKey(match[0]));
  return bodyUrls.includes(normalizedSource);
}

function normalizeUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const param of Array.from(url.searchParams.keys())) {
      if (isTrackingParam(param)) {
        url.searchParams.delete(param);
      }
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function isTrackingParam(param: string): boolean {
  const normalized = param.toLowerCase();
  return normalized.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid", "igshid"].includes(normalized);
}
