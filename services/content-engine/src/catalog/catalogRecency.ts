/**
 * How far back reusable catalog content may draw its source material.
 *
 * The Newsletter is today's news: it asks the source layer for `since = the
 * edition date` and relies on the FR recency ladder (J, then J-1, then a tightly
 * controlled J-2) to fill a thin day. That policy is right for a daily edition
 * and is left exactly as it is.
 *
 * Business Stories and Mini Cases are not daily news. They are reusable
 * inventory: a procurement threshold, a pricing decision, a regulatory
 * authorisation stay teachable for weeks. Asking the same "published today"
 * question of them is what collapsed the English pool from 126 fetched articles
 * to a single one — English has no recency ladder, so `since = today` is a hard
 * cutoff there, and only one English feed had published since midnight.
 *
 * The window is deliberately bounded rather than open: the RSS layer still drops
 * anything older than its own stale threshold, and this cannot reach past it. It
 * is a wider door, not an open one.
 */
export const DEFAULT_CATALOG_SOURCE_RECENCY_DAYS = 7;

/**
 * Hard ceiling. Reusable does not mean timeless.
 *
 * It stops at the source layer's own staleness limit on purpose: asking for
 * material older than the RSS layer will ever hand back would widen the window
 * on paper and change nothing in practice, which is the kind of setting that
 * later gets read as "the catalog accepts month-old sources".
 */
export const MAX_CATALOG_SOURCE_RECENCY_DAYS = 21;

export function clampCatalogRecencyDays(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CATALOG_SOURCE_RECENCY_DAYS;
  }

  return Math.max(0, Math.min(Math.trunc(value), MAX_CATALOG_SOURCE_RECENCY_DAYS));
}

/**
 * The `since` date a catalog run asks the source layer for: the edition date
 * moved back by the catalog window.
 *
 * Returns the drop date unchanged when it cannot be parsed or the window is
 * zero, so a malformed date can never silently widen the window.
 */
/** Local date normalisation: this module must not reach into the source layer. */
function normalizeDateOnly(value: string): string | null {
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function catalogSourceSince(dropDate: string, recencyDays: number): string {
  const base = normalizeDateOnly(dropDate);
  const days = clampCatalogRecencyDays(recencyDays);

  if (!base || days === 0) {
    return dropDate;
  }

  const shifted = new Date(`${base}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() - days);

  return shifted.toISOString().slice(0, 10);
}
