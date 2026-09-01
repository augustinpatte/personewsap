import type { TopicId } from "../../constants/product";
import { getUserLocalYear } from "../../lib/localDate";
import type { Language } from "../../types/domain";
import type { ContentType } from "../today/contentTypes";
import { resolveEditionType, type EditionType } from "../today/editionCadence";
import type { LibraryDropSummary, LibraryItemSummary } from "../library/libraryTypes";

/**
 * Pure selectors over the shared library archive (fetchLibraryDrops output).
 *
 * The four product modules read the same data through different lenses:
 *   Newsletter      -> editions browsed by DATE (never by free-text title)
 *   Business Story  -> items searched by TITLE + DATE
 *   Mini Case       -> items searched by TITLE + DATE
 *   Learning Path   -> its own session history (not served here)
 *
 * Everything in this file is pure and index-friendly: normalization happens
 * once per item, so the search scales linearly with a growing archive.
 */

export type NewsletterEditionSummary = {
  drop_id: string;
  drop_date: string;
  /**
   * Display-only: render this edition without its calendar date. Ordering below
   * and `editionType` still read drop_date — hiding the date never means an
   * undated edition.
   */
  hideDisplayDate: boolean;
  editionType: EditionType | null;
  topics: TopicId[];
  /** Newsletter articles in the edition, in archive order. */
  articles: LibraryItemSummary[];
  /** Historical non-newsletter attachments (e.g. legacy concepts) kept readable. */
  extras: LibraryItemSummary[];
  articleCount: number;
  readCount: number;
};

function itemsOfDrop(drop: LibraryDropSummary): LibraryItemSummary[] {
  return drop.items ?? [];
}

/**
 * Merge a newly fetched archive page into the ones already held, keeping every
 * edition unique and the list newest-first. Overlapping pages (a refetch, a
 * cursor landing on a boundary) must never produce a duplicate row.
 */
export function mergeArchivePages(
  current: LibraryDropSummary[],
  incoming: LibraryDropSummary[]
): LibraryDropSummary[] {
  const byId = new Map(current.map((drop) => [drop.drop_id, drop]));

  for (const drop of incoming) {
    byId.set(drop.drop_id, drop);
  }

  return [...byId.values()].sort((left, right) =>
    right.drop_date.localeCompare(left.drop_date)
  );
}

/** Newsletter archive: one entry per edition, most recent first. */
export function selectNewsletterEditions(
  drops: LibraryDropSummary[]
): NewsletterEditionSummary[] {
  return [...drops]
    .sort((left, right) => right.drop_date.localeCompare(left.drop_date))
    .map((drop) => {
      const items = itemsOfDrop(drop);
      const articles = items.filter(
        (item) => item.content_type === "newsletter_article"
      );
      const extras = items.filter(
        (item) => item.content_type === "key_concept"
      );

      return {
        drop_id: drop.drop_id,
        drop_date: drop.drop_date,
        hideDisplayDate: drop.hide_display_date === true,
        // Still derived from the real drop_date, hidden display or not.
        editionType: resolveEditionType(drop.drop_date),
        topics: drop.topics,
        articles,
        extras,
        articleCount: articles.length,
        readCount: articles.filter((item) => item.is_completed).length
      };
    })
    .filter((edition) => edition.articleCount > 0 || edition.extras.length > 0);
}

/** Flat, date-sorted list of a single content type across all editions. */
export function selectArchiveItems(
  drops: LibraryDropSummary[],
  contentType: ContentType
): LibraryItemSummary[] {
  return drops
    .flatMap((drop) => itemsOfDrop(drop))
    .filter((item) => item.content_type === contentType)
    .sort((left, right) => right.drop_date.localeCompare(left.drop_date));
}

/** Lowercased, diacritic-free text so "medecine" finds "Médecine". */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * The strings a date can be found by: ISO (2026-08-17) and the localized long
 * form with weekday ("lundi 17 août 2026" / "Monday, August 17, 2026").
 */
export function searchableDateText(dropDate: string, language: Language): string {
  const parsed = new Date(`${dropDate}T12:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return dropDate;
  }

  const longDate = new Intl.DateTimeFormat(language, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(parsed);

  return `${dropDate} ${longDate}`;
}

/**
 * Title + date search: every whitespace-separated token of the query must be
 * found in the item's normalized title or its searchable date text.
 */
export function matchesTitleOrDate(
  item: Pick<LibraryItemSummary, "title" | "drop_date">,
  query: string,
  language: Language
): boolean {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return true;
  }

  const haystack = normalizeSearchText(
    `${item.title} ${searchableDateText(item.drop_date, language)}`
  );

  return tokens.every((token) => haystack.includes(token));
}

export function searchArchiveItems(
  items: LibraryItemSummary[],
  query: string,
  language: Language
): LibraryItemSummary[] {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return items;
  }

  return items.filter((item) => matchesTitleOrDate(item, trimmed, language));
}

const MONTH_NAMES: Record<Language, string[]> = {
  en: [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ],
  fr: [
    "janvier",
    "fevrier",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "aout",
    "septembre",
    "octobre",
    "novembre",
    "decembre"
  ]
};

export type ArchiveQueryPlan = {
  /** Inclusive lower bound (YYYY-MM-DD), when the query names a period. */
  from: string | null;
  /** Exclusive upper bound (YYYY-MM-DD), when the query names a period. */
  toExclusive: string | null;
  /** Remaining words, searched against the title. */
  text: string;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function monthRange(year: number, month: number): { from: string; toExclusive: string } {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    from: `${year}-${pad(month)}-01`,
    toExclusive: `${nextYear}-${pad(nextMonth)}-01`
  };
}

function dayRange(year: number, month: number, day: number): { from: string; toExclusive: string } {
  const start = `${year}-${pad(month)}-${pad(day)}`;
  const next = new Date(`${start}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);

  return { from: start, toExclusive: next.toISOString().slice(0, 10) };
}

/**
 * Split a search query into an optional date period and the remaining words.
 *
 * This is what lets a title+date search reach the whole history from the
 * server: the period becomes a `drop_date` range filter and the words become a
 * title match, instead of scanning already-downloaded pages only.
 *
 * Understood: `2026`, `2026-05`, `2026-05-12`, `12/05/2026`, and month names in
 * FR/EN with an optional day and year (`mai 2026`, `12 mai 2026`, `may 2026`).
 */
export function parseArchiveQuery(query: string, language: Language): ArchiveQueryPlan {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const rest: string[] = [];
  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  let explicit: { from: string; toExclusive: string } | null = null;

  const monthNames = [...MONTH_NAMES[language], ...MONTH_NAMES[language === "fr" ? "en" : "fr"]];

  for (const token of tokens) {
    const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
    if (isoDay) {
      explicit = dayRange(Number(isoDay[1]), Number(isoDay[2]), Number(isoDay[3]));
      continue;
    }

    const isoMonth = /^(\d{4})-(\d{2})$/.exec(token);
    if (isoMonth) {
      explicit = monthRange(Number(isoMonth[1]), Number(isoMonth[2]));
      continue;
    }

    const slashed = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(token);
    if (slashed) {
      explicit = dayRange(Number(slashed[3]), Number(slashed[2]), Number(slashed[1]));
      continue;
    }

    if (/^\d{4}$/.test(token)) {
      year = Number(token);
      continue;
    }

    if (/^\d{1,2}$/.test(token) && Number(token) >= 1 && Number(token) <= 31) {
      day = Number(token);
      continue;
    }

    const monthIndex = monthNames.findIndex((name) => name.startsWith(token) && token.length >= 3);
    if (monthIndex !== -1) {
      month = (monthIndex % 12) + 1;
      continue;
    }

    rest.push(token);
  }

  if (explicit) {
    return { from: explicit.from, toExclusive: explicit.toExclusive, text: rest.join(" ") };
  }

  if (month !== null) {
    // The reader's year, not the UTC one: searching "decembre" on 31 December
    // at 22:00 in New Orleans must not resolve to the following year.
    const resolvedYear = year ?? getUserLocalYear();
    const range =
      day !== null ? dayRange(resolvedYear, month, day) : monthRange(resolvedYear, month);

    return { from: range.from, toExclusive: range.toExclusive, text: rest.join(" ") };
  }

  if (year !== null) {
    return { from: `${year}-01-01`, toExclusive: `${year + 1}-01-01`, text: rest.join(" ") };
  }

  // A bare day number is too ambiguous to be a period on its own; keep it as text.
  if (day !== null) {
    rest.push(String(day));
  }

  return { from: null, toExclusive: null, text: rest.join(" ") };
}
