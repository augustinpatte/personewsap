import type { GeneratedContentItem, RankedArticle } from "../domain.js";
import { normalizeUrl } from "../utils/hash.js";

/**
 * One source universe per catalog entry, used by generation, validation and
 * persistence alike.
 *
 * These three had drifted apart. Generation was widened to the canonical
 * cross-language pool, while validation and persistence still assembled their
 * own set from `articlesByLanguage[version] + articlesByLanguage[reference]` —
 * for a French reference version, French twice. So a French entry grounded in an
 * English FTC press release generated fine, paired fine, and then failed to
 * persist for "missing source metadata" on a URL that had been approved material
 * all along.
 *
 * The fix is not to loosen the check. The set of admissible sources stays
 * closed: exactly the articles handed to that entry, and nothing else. What
 * changes is that all three stages ask the same question of the same set.
 */

/** An entry's approved sources, prepared for lookup. */
export type ApprovedSourceIndex = {
  /**
   * Exact URL, as the article carries it. Always authoritative.
   *
   * Keyed by both `url` and `normalized_url` because either can be the string a
   * generated item cites back.
   */
  exact: Map<string, RankedArticle>;
  /**
   * Canonical key. `null` marks a key two different approved articles share,
   * which must never resolve: an ambiguous match is a wrong match.
   */
  canonical: Map<string, RankedArticle | null>;
};

export function buildApprovedSourceIndex(approved: readonly RankedArticle[]): ApprovedSourceIndex {
  const exact = new Map<string, RankedArticle>();
  const canonical = new Map<string, RankedArticle | null>();

  for (const article of approved) {
    for (const raw of [article.url, article.normalized_url]) {
      if (typeof raw === "string" && raw.length > 0 && !exact.has(raw)) {
        exact.set(raw, article);
      }
    }
  }

  for (const article of approved) {
    for (const raw of [article.url, article.normalized_url]) {
      if (typeof raw !== "string" || raw.length === 0) {
        continue;
      }

      const key = sourceUrlKey(raw);
      const existing = canonical.get(key);

      if (existing === undefined) {
        canonical.set(key, article);
        continue;
      }

      // Two distinct approved articles reduced to the same canonical form. The
      // canonicalization is too coarse to separate them, so it must not pick
      // between them: the key is burned and only an exact URL still resolves.
      if (existing !== null && existing.url !== article.url) {
        canonical.set(key, null);
      }
    }
  }

  return { exact, canonical };
}

/**
 * Resolve one cited URL to the approved article behind it, or null.
 *
 * Exact first, canonical second. Canonicalization only forgives what a link can
 * pick up in transit — a tracking parameter, a fragment, a trailing slash. It is
 * never by domain: a different article on ftc.gov is a different source, and
 * treating it as equivalent would let an unapproved document in through the
 * front door.
 */
export function resolveApprovedSource(url: string, index: ApprovedSourceIndex): RankedArticle | null {
  const trimmed = typeof url === "string" ? url.trim() : "";

  if (trimmed.length === 0) {
    return null;
  }

  const exact = index.exact.get(trimmed);

  if (exact) {
    return exact;
  }

  return index.canonical.get(sourceUrlKey(trimmed)) ?? null;
}

/**
 * Resolve an item's cited URLs to the approved articles behind them.
 *
 * `unresolved` is the important half of the return value: a URL that matches no
 * approved article is a URL the entry was never given, and the caller refuses
 * the entry rather than fetching it or inventing metadata for it.
 */
export function resolveCatalogSourceArticles(
  item: GeneratedContentItem,
  approved: readonly RankedArticle[]
): { articles: RankedArticle[]; unresolved: string[] } {
  const index = buildApprovedSourceIndex(approved);
  const cited = Array.isArray(item.source_urls) ? item.source_urls : [];
  const articles: RankedArticle[] = [];
  const seen = new Set<string>();
  const unresolved: string[] = [];

  for (const url of cited) {
    const match = resolveApprovedSource(url, index);

    if (!match) {
      if (!unresolved.includes(url)) {
        unresolved.push(url);
      }
      continue;
    }

    if (seen.has(match.url)) {
      continue;
    }

    seen.add(match.url);
    articles.push(match);
  }

  return { articles, unresolved };
}

/**
 * Rewrite an item's cited URLs to the exact approved article URLs.
 *
 * Persistence keys source metadata on `RankedArticle.url` by exact string, so a
 * citation differing only by a tracking parameter would look like an unknown
 * source and abort the write. Only URLs that already resolve are rewritten;
 * anything unresolved is left exactly as the generator produced it, so the
 * caller still sees it for what it is and refuses the entry.
 */
export function canonicalizeItemSourceUrls<Item extends GeneratedContentItem>(
  item: Item,
  approved: readonly RankedArticle[]
): Item {
  const index = buildApprovedSourceIndex(approved);
  const cited = Array.isArray(item.source_urls) ? item.source_urls : [];
  const rewritten: string[] = [];

  for (const url of cited) {
    const resolved = resolveApprovedSource(url, index)?.url ?? url;

    if (!rewritten.includes(resolved)) {
      rewritten.push(resolved);
    }
  }

  return { ...item, source_urls: rewritten };
}

/**
 * Canonical form used for matching only — never for storage.
 *
 * Deliberately conservative: it strips what a link picks up in transit
 * (fragment, tracking parameters, trailing slash, host case, a `www.` prefix)
 * and nothing that could change which document is meant. Path case is preserved,
 * because on many sites it is significant, and the query string is preserved,
 * because on many sites it *is* the article id.
 */
export function sourceUrlKey(url: string): string {
  const trimmed = url.trim();

  try {
    const parsed = new URL(normalizeUrl(trimmed));
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");

    // The scheme is dropped: http and https of the same document are the same
    // document, and a feed can hand back either.
    return `${host}${path}${parsed.search}`;
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}
