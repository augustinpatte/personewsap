import { isSafeExternalUrl } from "./readers/markdown";
import type { ContentLanguage, SourceMetadata } from "./contentTypes";

/**
 * A source as the reader should see it: only what is actually stored.
 *
 * Every field except `url` and `domain` is nullable on purpose. The reading
 * experience shows source transparency, not a tidy citation format — where the
 * record has no publisher or no publication date, the row is simply shorter.
 * Nothing here fills a gap with a plausible-looking value.
 */
export type DisplaySource = {
  id: string;
  url: string;
  /** The domain, always derivable from the URL, so a row can never be empty. */
  domain: string;
  publisher: string | null;
  title: string | null;
  publishedAt: string | null;
};

/**
 * Hosts that can never be a real published source.
 *
 * `example.com/.net/.org` are reserved by RFC 2606 precisely so that they can
 * be used as placeholders, and the seeded launch-catalog rows use them. They
 * are genuine rows in `public.sources`, but a reader shown
 * "PersoNewsAP Sample Desk — example.com" would reasonably read it as an
 * invented source, and the link resolves to nothing. Suppressing them shows
 * fewer sources, never a fake one; `.test`, `.invalid`, `.local` and
 * `.localhost` are reserved for the same kind of use by RFC 2606 / RFC 6761.
 */
const PLACEHOLDER_HOSTS = new Set(["example.com", "example.net", "example.org"]);
const PLACEHOLDER_SUFFIXES = [
  ".example",
  ".example.com",
  ".example.net",
  ".example.org",
  ".invalid",
  ".local",
  ".localhost",
  ".test"
];

const HOST_PATTERN = /^https?:\/\/([^/?#\s]+)/i;

/** The host of an http(s) URL, lowercased and without `www.`, or null. */
export function getSourceDomain(url: string): string | null {
  const match = HOST_PATTERN.exec(url.trim());

  if (!match) {
    return null;
  }

  // Strip credentials and port: neither belongs in a dateline.
  const host = match[1].split("@").pop()?.split(":")[0]?.toLowerCase() ?? "";
  const domain = host.replace(/^www\./, "");

  return domain.includes(".") ? domain : null;
}

export function isPlaceholderSourceDomain(domain: string): boolean {
  return (
    PLACEHOLDER_HOSTS.has(domain) ||
    PLACEHOLDER_SUFFIXES.some((suffix) => domain.endsWith(suffix)) ||
    domain === "localhost"
  );
}

/**
 * Whether a stored source is worth showing and safe to open.
 *
 * HTTPS is what the pipeline stores; plain HTTP is tolerated because a handful
 * of institutional archives still publish over it and dropping those would hide
 * a real citation. Every other scheme is refused outright — nothing from a
 * source record is ever handed to the OS as a custom scheme.
 */
export function isDisplayableSourceUrl(url: string | null | undefined): boolean {
  if (!url || !isSafeExternalUrl(url)) {
    return false;
  }

  const domain = getSourceDomain(url);

  return Boolean(domain) && !isPlaceholderSourceDomain(domain as string);
}

/**
 * The identity used to collapse repeats: scheme and host lowercased, `www.`,
 * the trailing slash and the fragment dropped.
 *
 * The query string is deliberately kept — for a great many publishers it is
 * what distinguishes one article from another, and collapsing on it would
 * silently hide a real citation.
 */
export function canonicalSourceUrl(url: string): string {
  const trimmed = url.trim().replace(/#.*$/, "");
  const match = /^(https?):\/\/([^/?#\s]+)(.*)$/i.exec(trimmed);

  if (!match) {
    return trimmed.toLowerCase();
  }

  const [, scheme, host, rest] = match;
  // `www.` is dropped for the same reason the displayed domain drops it: the
  // two spellings are one article, and a pipeline that stored both would
  // otherwise show it twice.
  const canonicalHost = host.toLowerCase().replace(/^www\./, "");
  const path = rest.replace(/\/$/, "");

  return `${scheme.toLowerCase()}://${canonicalHost}${path}`;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The sources of one content item, ready to render.
 *
 * Deduplicated by source id first and canonical URL second: one item can cite
 * the same record twice through two claims, and two records can point at the
 * same article. Two *different* articles from one publisher are two sources and
 * both survive — the publisher is never the dedup key.
 */
export function toDisplaySources(
  sources: SourceMetadata[] | null | undefined
): DisplaySource[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const displaySources: DisplaySource[] = [];

  for (const source of sources ?? []) {
    if (!isDisplayableSourceUrl(source?.url)) {
      continue;
    }

    const canonicalUrl = canonicalSourceUrl(source.url);

    if (seenIds.has(source.id) || seenUrls.has(canonicalUrl)) {
      continue;
    }

    seenIds.add(source.id);
    seenUrls.add(canonicalUrl);

    displaySources.push({
      id: source.id,
      url: source.url.trim(),
      domain: getSourceDomain(source.url) as string,
      publisher: blankToNull(source.publisher),
      title: blankToNull(source.title),
      publishedAt: blankToNull(source.published_at)
    });
  }

  return displaySources;
}

/**
 * The publication date in the reader's locale, or null when the record has
 * none or stores something unparseable. Only the *format* is localized: the
 * date itself is the source's own.
 */
export function formatSourceDate(
  publishedAt: string | null | undefined,
  language: ContentLanguage
): string | null {
  if (!publishedAt) {
    return null;
  }

  const parsed = new Date(publishedAt);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(parsed);
  } catch {
    return null;
  }
}

/**
 * The line under the title: publication date and domain, whichever exist.
 * Never a lone separator.
 */
export function formatSourceMeta(
  source: DisplaySource,
  language: ContentLanguage
): string {
  return [formatSourceDate(source.publishedAt, language), source.domain]
    .filter(Boolean)
    .join(" · ");
}

/**
 * What the source is called when it has to be named in one phrase — for the
 * link's accessibility label, and as the row's headline when the record has no
 * publisher. The domain is the fallback because it is the one thing every
 * displayable source has.
 */
export function getSourceName(source: DisplaySource): string {
  return source.publisher ?? source.domain;
}
